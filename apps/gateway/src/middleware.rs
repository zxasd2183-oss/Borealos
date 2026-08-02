//! 中间件模块
//!
//! 提供 CORS、请求日志和 HTTP 追踪中间件。
//! 错误处理通过 `GatewayError` 的 `IntoResponse` 实现统一处理，
//! 无需额外中间件。

use std::time::{Duration, Instant};

use axum::extract::Request;
use axum::middleware::Next;
use axum::response::Response;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;

/// 创建 CORS 中间件层
///
/// 允许所有来源、所有 HTTP 方法和所有请求头，
/// 适用于开发环境。生产环境应限制 `allow_origin`。
pub fn cors_layer() -> CorsLayer {
    CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any)
        .allow_credentials(false)
        .max_age(Duration::from_secs(3600))
}

/// 创建 HTTP 追踪层
///
/// 基于 `tower-http` 的 `TraceLayer`，自动记录请求和响应的追踪信息。
pub fn trace_layer() -> TraceLayer {
    TraceLayer::new_for_http()
}

/// 请求日志中间件
///
/// 记录每个请求的 HTTP 方法、路径、响应状态码和耗时。
/// 通过 `axum::middleware::from_fn` 注册。
///
/// # 日志格式
/// ```text
/// GET /health - 200 OK - 1.23ms
/// POST /api/chat - 200 OK - 456.78ms
/// ```
pub async fn request_logger(req: Request, next: Next) -> Response {
    let method = req.method().clone();
    let path = req.uri().path().to_string();
    let start = Instant::now();

    // 调用下游处理器
    let response = next.run(req).await;

    let elapsed = start.elapsed();
    let status = response.status();

    tracing::info!("{} {} - {} - {:?}", method, path, status, elapsed);

    response
}
