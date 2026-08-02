//! 数据模型定义
//!
//! 定义了聊天请求/响应、模型信息、用量统计等数据结构。
//! 所有结构体与 OpenAI 兼容 API 格式保持一致，可直接序列化/反序列化。

use serde::{Deserialize, Serialize};

/// 聊天请求
///
/// 对应 OpenAI 兼容的 `/v1/chat/completions` 请求体。
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ChatRequest {
    /// 模型名称，如 "qwen-plus"、"qwen-turbo" 等
    pub model: String,
    /// 消息列表（对话上下文）
    pub messages: Vec<ChatMessage>,
    /// 是否启用流式响应（SSE）
    #[serde(default)]
    pub stream: bool,
    /// 温度参数，控制生成随机性（0.0 - 2.0）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f32>,
    /// 最大生成 token 数
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_tokens: Option<u32>,
}

/// 聊天消息
///
/// 对应对话中的一条消息。
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ChatMessage {
    /// 角色：`system` / `user` / `assistant`
    pub role: String,
    /// 消息内容
    pub content: String,
}

/// 非流式聊天响应
///
/// 对应 OpenAI 兼容的 `/v1/chat/completions` 非流式响应体。
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ChatResponse {
    /// 响应唯一 ID
    pub id: String,
    /// 对象类型，如 "chat.completion"
    #[serde(default)]
    pub object: Option<String>,
    /// 创建时间戳（Unix 秒）
    #[serde(default)]
    pub created: Option<u64>,
    /// 使用的模型名称
    #[serde(default)]
    pub model: Option<String>,
    /// 响应选项列表（通常只有一个）
    pub choices: Vec<Choice>,
    /// 用量统计
    #[serde(default)]
    pub usage: Option<UsageStats>,
}

/// 响应选项
///
/// 包含模型生成的消息内容。
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Choice {
    /// 选项索引
    pub index: u32,
    /// 生成的消息
    pub message: ChatMessage,
    /// 完成原因：`stop` / `length` / `content_filter`
    #[serde(default)]
    pub finish_reason: Option<String>,
}

/// 模型信息
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ModelInfo {
    /// 模型 ID
    pub id: String,
    /// 对象类型，如 "model"
    #[serde(default)]
    pub object: Option<String>,
    /// 创建时间戳（Unix 秒）
    #[serde(default)]
    pub created: Option<u64>,
    /// 模型拥有者
    #[serde(default)]
    pub owned_by: Option<String>,
}

/// 模型列表响应
///
/// 对应 OpenAI 兼容的 `/v1/models` 响应体。
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ModelListResponse {
    /// 对象类型，如 "list"
    pub object: String,
    /// 模型列表
    pub data: Vec<ModelInfo>,
}

/// 用量统计
///
/// 记录一次请求的 token 消耗。
#[derive(Debug, Clone, Deserialize, Serialize, Default)]
pub struct UsageStats {
    /// 提示 token 数（输入）
    pub prompt_tokens: u32,
    /// 生成 token 数（输出）
    pub completion_tokens: u32,
    /// 总 token 数
    pub total_tokens: u32,
}

/// 错误响应
///
/// 对应 OpenAI 兼容的错误响应格式。
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ErrorResponse {
    /// 错误详情
    pub error: ErrorDetail,
}

/// 错误详情
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ErrorDetail {
    /// 错误消息
    pub message: String,
    /// 错误类型
    #[serde(rename = "type", default)]
    pub error_type: String,
    /// 错误代码（可选）
    #[serde(default)]
    pub code: Option<String>,
}

/// 健康检查响应
#[derive(Debug, Serialize)]
pub struct HealthResponse {
    /// 服务状态
    pub status: String,
    /// 服务名称
    pub service: String,
    /// 版本号
    pub version: String,
    /// 运行时长（秒）
    pub uptime_secs: u64,
}
