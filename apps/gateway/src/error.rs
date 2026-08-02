//! 网关错误类型定义
//!
//! 定义了网关处理过程中可能出现的错误类型，
//! 并实现了 Axum 的 `IntoResponse` trait 以统一错误响应格式。

use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Serialize;

/// 网关错误类型
#[derive(Debug)]
pub enum GatewayError {
    /// 上游 API 返回错误（状态码非 2xx 或解析失败）
    UpstreamError(String),
    /// 请求超时
    Timeout,
    /// 请求参数错误
    BadRequest(String),
    /// 未授权（API Key 缺失或无效）
    Unauthorized,
    /// 网关内部错误
    InternalError(String),
}

/// 错误响应体结构（OpenAI 兼容格式）
#[derive(Debug, Serialize)]
pub struct ErrorBody {
    /// 错误详情
    pub error: ErrorDetail,
}

/// 错误详情
#[derive(Debug, Serialize)]
pub struct ErrorDetail {
    /// 错误消息
    pub message: String,
    /// 错误类型标识
    #[serde(rename = "type")]
    pub error_type: String,
    /// 错误代码（可选）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
}

impl std::fmt::Display for GatewayError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            GatewayError::UpstreamError(msg) => write!(f, "上游 API 错误: {}", msg),
            GatewayError::Timeout => write!(f, "请求超时"),
            GatewayError::BadRequest(msg) => write!(f, "请求参数错误: {}", msg),
            GatewayError::Unauthorized => write!(f, "未授权"),
            GatewayError::InternalError(msg) => write!(f, "网关内部错误: {}", msg),
        }
    }
}

impl std::error::Error for GatewayError {}

/// 为 GatewayError 实现 IntoResponse，统一错误响应格式
///
/// 每种错误类型映射到对应的 HTTP 状态码，
/// 响应体为 OpenAI 兼容的错误 JSON 格式。
impl IntoResponse for GatewayError {
    fn into_response(self) -> Response {
        let (status, error_type, message) = match &self {
            GatewayError::UpstreamError(msg) => {
                (StatusCode::BAD_GATEWAY, "upstream_error", msg.clone())
            }
            GatewayError::Timeout => {
                (StatusCode::GATEWAY_TIMEOUT, "timeout", "请求超时".to_string())
            }
            GatewayError::BadRequest(msg) => {
                (StatusCode::BAD_REQUEST, "invalid_request_error", msg.clone())
            }
            GatewayError::Unauthorized => {
                (StatusCode::UNAUTHORIZED, "authentication_error", "API Key 无效或缺失".to_string())
            }
            GatewayError::InternalError(msg) => {
                (StatusCode::INTERNAL_SERVER_ERROR, "internal_error", msg.clone())
            }
        };

        tracing::warn!("请求处理错误: {} - {}", error_type, message);

        let body = ErrorBody {
            error: ErrorDetail {
                message,
                error_type: error_type.to_string(),
                code: None,
            },
        };

        (status, Json(body)).into_response()
    }
}

/// 从 reqwest::Error 转换为 GatewayError
///
/// 自动区分超时错误和其他网络错误。
impl From<reqwest::Error> for GatewayError {
    fn from(err: reqwest::Error) -> Self {
        if err.is_timeout() {
            GatewayError::Timeout
        } else {
            GatewayError::UpstreamError(err.to_string())
        }
    }
}

/// 从 serde_json::Error 转换为 GatewayError
impl From<serde_json::Error> for GatewayError {
    fn from(err: serde_json::Error) -> Self {
        GatewayError::InternalError(format!("JSON 序列化/反序列化错误: {}", err))
    }
}
