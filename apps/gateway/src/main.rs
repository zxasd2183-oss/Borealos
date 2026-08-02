//! BorealOS AI 网关入口
//!
//! 启动 Axum HTTP 服务器，监听端口 8787，
//! 提供 AI 模型调用的代理服务（转发到阿里云百炼 API）。
//!
//! ## 功能
//! - 非流式聊天代理 (`POST /api/chat`)
//! - 流式聊天代理 SSE (`POST /api/chat/stream`)
//! - 模型列表查询 (`GET /api/models`)
//! - 健康检查 (`GET /health`)
//! - 用量统计 (`GET /api/usage`)
//!
//! ## 启动流程
//! 1. 初始化日志（tracing-subscriber）
//! 2. 加载 .env 环境变量
//! 3. 读取配置
//! 4. 构建 HTTP 客户端（连接池）
//! 5. 构建路由和中间件
//! 6. 启动服务器并监听 0.0.0.0:8787
//! 7. 等待 Ctrl+C / SIGTERM 信号优雅关闭

mod config;
mod error;
mod handlers;
mod middleware;
mod models;
mod proxy;
mod stream;

use std::sync::Arc;

use axum::middleware::from_fn;
use axum::routing::{get, post};
use axum::Router;
use tokio::net::TcpListener;
use tokio::sync::Mutex;

use config::{Config, UsageStatsData};
use config::AppState;

#[tokio::main]
async fn main() {
    // 1. 初始化日志系统
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,borealos_gateway=debug".into()),
        )
        .init();

    // 2. 加载 .env 文件（如果存在）
    dotenvy::dotenv().ok();

    // 3. 读取配置
    let config = Config::from_env();
    tracing::info!(
        "网关配置: 端口={}, 上游={}, 连接池={}, 超时={}s",
        config.port,
        config.upstream_url,
        config.max_connections,
        config.timeout_secs
    );

    // 检查 API Key 是否已配置
    if config.api_key.is_empty() {
        tracing::warn!("未配置 DASHSCOPE_API_KEY，上游请求将失败！");
    }

    // 4. 构建 HTTP 客户端（复用连接池）
    let client = proxy::build_client(&config).expect("构建 HTTP 客户端失败");

    // 5. 创建应用共享状态
    let state = AppState {
        config: config.clone(),
        client,
        start_time: std::time::Instant::now(),
        usage_stats: Arc::new(Mutex::new(UsageStatsData::default())),
    };

    // 6. 构建路由
    let app = build_router(state);

    // 7. 启动服务器
    let addr = format!("0.0.0.0:{}", config.port);
    tracing::info!("BorealOS AI 网关启动在 http://{}", addr);

    let listener = TcpListener::bind(&addr).await.expect("绑定端口失败");
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .expect("服务器运行错误");

    tracing::info!("BorealOS AI 网关已关闭");
}

/// 构建路由
///
/// 定义所有 API 端点并注册中间件。
///
/// ## 路由
/// - `GET /health` - 健康检查
/// - `GET /api/models` - 获取模型列表
/// - `POST /api/chat` - 非流式聊天代理
/// - `POST /api/chat/stream` - 流式聊天代理（SSE）
/// - `GET /api/usage` - 用量统计
///
/// ## 中间件（从外到内）
/// 1. `TraceLayer` - HTTP 追踪
/// 2. `CorsLayer` - CORS 跨域
/// 3. `request_logger` - 请求日志
fn build_router(state: AppState) -> Router {
    Router::new()
        // 健康检查
        .route("/health", get(handlers::health))
        // 模型列表
        .route("/api/models", get(handlers::list_models))
        // 非流式聊天代理
        .route("/api/chat", post(handlers::chat))
        // 流式聊天代理（SSE）
        .route("/api/chat/stream", post(handlers::chat_stream))
        // 用量统计
        .route("/api/usage", get(handlers::usage))
        // 注册中间件（注意：后注册的先执行，即更靠外层）
        .layer(from_fn(middleware::request_logger))
        .layer(middleware::cors_layer())
        .layer(middleware::trace_layer())
        // 注入共享状态
        .with_state(state)
}

/// 优雅关闭信号处理
///
/// 监听 Ctrl+C（SIGINT）和 SIGTERM 信号，
/// 收到信号后返回，触发 Axum 的优雅关闭流程。
async fn shutdown_signal() {
    // 监听 Ctrl+C (SIGINT)
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("安装 Ctrl+C 信号处理器失败");
    };

    // 在 Unix 系统上额外监听 SIGTERM
    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("安装 SIGTERM 信号处理器失败")
            .recv()
            .await;
    };

    // 在非 Unix 系统上，SIGTERM 监听永远等待
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    // 等待任意一个信号到达
    tokio::select! {
        _ = ctrl_c => {
            tracing::info!("收到 Ctrl+C 信号，开始优雅关闭...");
        }
        _ = terminate => {
            tracing::info!("收到 SIGTERM 信号，开始优雅关闭...");
        }
    }
}
