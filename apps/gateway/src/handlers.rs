//! HTTP 路由处理器
//!
//! 定义了网关的所有 HTTP 端点处理器。
//!
//! ## API 端点
//! | 方法 | 路径 | 说明 |
//! |------|------|------|
//! | GET | `/health` | 健康检查 |
//! | GET | `/api/models` | 获取模型列表 |
//! | POST | `/api/chat` | 非流式聊天代理 |
//! | POST | `/api/chat/stream` | 流式聊天代理（SSE） |
//! | GET | `/api/usage` | 用量统计 |

use axum::extract::State;
use axum::response::{IntoResponse, Response};
use axum::Json;
use std::time::Instant;

use crate::config::AppState;
use crate::error::GatewayError;
use crate::models::{ChatRequest, ChatResponse, HealthResponse, ModelListResponse};
use crate::proxy;
use crate::stream;

/// 健康检查端点
///
/// `GET /health`
///
/// 返回服务状态、版本号和运行时长。
pub async fn health(State(state): State<AppState>) -> impl IntoResponse {
    Json(HealthResponse {
        status: "ok".to_string(),
        service: "borealos-gateway".to_string(),
        version: "0.1.0".to_string(),
        uptime_secs: state.start_time.elapsed().as_secs(),
    })
}

/// 获取模型列表
///
/// `GET /api/models`
///
/// 转发请求到上游 `/v1/models` 端点，返回可用模型列表。
pub async fn list_models(
    State(state): State<AppState>,
) -> Result<Json<ModelListResponse>, GatewayError> {
    let response = proxy::proxy_list_models(&state.client, &state.config).await?;
    Ok(Json(response))
}

/// 非流式聊天代理
///
/// `POST /api/chat`
///
/// 将聊天请求转发到上游 API，等待完整响应后返回 JSON。
/// 自动记录用量统计。
pub async fn chat(
    State(state): State<AppState>,
    Json(req): Json<ChatRequest>,
) -> Result<Json<ChatResponse>, GatewayError> {
    // 强制设置 stream 为 false（非流式端点）
    let mut req = req;
    req.stream = false;

    let start = Instant::now();
    let result = proxy::proxy_chat(req, &state.client, &state.config).await;
    let elapsed = start.elapsed();

    match result {
        Ok(response) => {
            // 更新用量统计
            if let Some(usage) = &response.usage {
                let mut stats = state.usage_stats.lock().await;
                stats.total_requests += 1;
                stats.total_tokens += usage.total_tokens as u64;
                stats.prompt_tokens += usage.prompt_tokens as u64;
                stats.completion_tokens += usage.completion_tokens as u64;
            } else {
                let mut stats = state.usage_stats.lock().await;
                stats.total_requests += 1;
            }

            tracing::info!("非流式聊天请求完成，耗时: {:?}", elapsed);
            Ok(Json(response))
        }
        Err(e) => {
            // 记录错误计数
            let mut stats = state.usage_stats.lock().await;
            stats.total_requests += 1;
            stats.error_count += 1;
            Err(e)
        }
    }
}

/// 流式聊天代理（SSE）
///
/// `POST /api/chat/stream`
///
/// 将聊天请求转发到上游 API，返回 SSE 流式响应。
/// 客户端通过 EventSource 或 fetch 接收流式数据。
pub async fn chat_stream(State(state): State<AppState>, Json(req): Json<ChatRequest>) -> Response {
    tracing::info!("流式聊天请求 - 模型: {}", req.model);

    // 更新用量统计（流式请求计数）
    {
        let mut stats = state.usage_stats.lock().await;
        stats.total_requests += 1;
        stats.stream_requests += 1;
    }

    // 获取上游字节流
    let byte_stream = proxy::proxy_chat_stream(req, &state.client, &state.config).await;

    // 转换为 SSE 响应并返回
    let sse_response = stream::forward_sse(byte_stream);
    sse_response.into_response()
}

/// 用量统计端点
///
/// `GET /api/usage`
///
/// 返回网关运行以来的请求统计信息，包括:
/// - 总请求数
/// - 总 token 数
/// - 提示/生成 token 分项
/// - 流式请求数
/// - 错误请求数
pub async fn usage(State(state): State<AppState>) -> impl IntoResponse {
    let stats = state.usage_stats.lock().await;
    Json(serde_json::json!({
        "total_requests": stats.total_requests,
        "total_tokens": stats.total_tokens,
        "prompt_tokens": stats.prompt_tokens,
        "completion_tokens": stats.completion_tokens,
        "stream_requests": stats.stream_requests,
        "error_count": stats.error_count,
    }))
}
