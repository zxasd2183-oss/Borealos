//! 配置管理模块
//!
//! 从环境变量读取网关配置，提供合理的默认值。
//! 同时定义了应用共享状态 `AppState` 和用量统计数据结构。

use std::env;
use std::sync::Arc;
use std::time::Instant;

use tokio::sync::Mutex;

/// 网关配置
///
/// 从环境变量加载，包含端口、上游地址、API Key 等配置项。
#[derive(Debug, Clone)]
pub struct Config {
    /// 监听端口，默认 8787
    pub port: u16,
    /// 上游 AI 服务 API 地址（阿里云百炼 Token Plan）
    pub upstream_url: String,
    /// API Key（阿里云百炼 DASHSCOPE_API_KEY）
    pub api_key: String,
    /// 连接池大小（每个上游主机的最大空闲连接数），默认 100
    pub max_connections: usize,
    /// 请求超时时间（秒），默认 120
    pub timeout_secs: u64,
}

impl Config {
    /// 从环境变量加载配置
    ///
    /// 环境变量:
    /// - `GATEWAY_PORT` - 监听端口
    /// - `UPSTREAM_URL` - 上游 API 地址
    /// - `DASHSCOPE_API_KEY` - API Key
    /// - `MAX_CONNECTIONS` - 连接池大小
    /// - `TIMEOUT_SECS` - 超时时间
    pub fn from_env() -> Self {
        Config {
            port: env::var("GATEWAY_PORT")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(8787),
            upstream_url: env::var("UPSTREAM_URL").unwrap_or_else(|_| {
                "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1"
                    .to_string()
            }),
            api_key: env::var("DASHSCOPE_API_KEY").unwrap_or_default(),
            max_connections: env::var("MAX_CONNECTIONS")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(100),
            timeout_secs: env::var("TIMEOUT_SECS")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(120),
        }
    }

    /// 获取聊天补全 API 的完整 URL
    pub fn chat_completions_url(&self) -> String {
        format!("{}/chat/completions", self.upstream_url)
    }

    /// 获取模型列表 API 的完整 URL
    pub fn models_url(&self) -> String {
        format!("{}/models", self.upstream_url)
    }
}

impl Default for Config {
    fn default() -> Self {
        Self::from_env()
    }
}

/// 用量统计数据
///
/// 在内存中聚合网关处理的请求统计信息。
#[derive(Debug, Default)]
pub struct UsageStatsData {
    /// 总请求数
    pub total_requests: u64,
    /// 总 token 数
    pub total_tokens: u64,
    /// 提示 token 数
    pub prompt_tokens: u64,
    /// 生成 token 数
    pub completion_tokens: u64,
    /// 流式请求数
    pub stream_requests: u64,
    /// 错误请求数
    pub error_count: u64,
}

/// 应用共享状态
///
/// 通过 Axum 的 `State` 提取器在所有处理器之间共享。
/// 包含配置、HTTP 客户端（复用连接池）、启动时间和用量统计。
#[derive(Clone)]
pub struct AppState {
    /// 网关配置
    pub config: Config,
    /// HTTP 客户端（内部使用 Arc，克隆开销极低，复用连接池）
    pub client: reqwest::Client,
    /// 服务启动时间（用于计算运行时长）
    pub start_time: Instant,
    /// 用量统计（异步互斥锁保护）
    pub usage_stats: Arc<Mutex<UsageStatsData>>,
}
