//! AI 模型代理模块
//!
//! 负责将客户端请求转发到上游 AI 服务（阿里云百炼 API），
//! 支持非流式和流式两种代理模式。
//!
//! - 非流式模式：等待上游完整响应后返回 JSON
//! - 流式模式：通过 channel 转发上游 SSE 字节流

use std::time::Duration;

use bytes::Bytes;
use futures::stream::{Stream, StreamExt};
use reqwest::Client;

use crate::config::Config;
use crate::error::GatewayError;
use crate::models::{ChatRequest, ChatResponse, ModelListResponse};

/// 构建带有连接池和超时配置的 HTTP 客户端
///
/// 该客户端复用连接池，避免每次请求重新建立 TCP 连接。
/// `reqwest::Client` 内部使用 `Arc`，克隆开销极低。
pub fn build_client(config: &Config) -> Result<Client, GatewayError> {
    Client::builder()
        .pool_max_idle_per_host(config.max_connections)
        .timeout(Duration::from_secs(config.timeout_secs))
        .build()
        .map_err(|e| GatewayError::InternalError(format!("构建 HTTP 客户端失败: {}", e)))
}

/// 非流式聊天代理
///
/// 将聊天请求转发到上游 API，等待完整响应后返回。
///
/// # 参数
/// - `req`: 聊天请求体
/// - `client`: 复用的 HTTP 客户端
/// - `config`: 网关配置
///
/// # 返回
/// 成功返回 `ChatResponse`，失败返回 `GatewayError`
pub async fn proxy_chat(
    req: ChatRequest,
    client: &Client,
    config: &Config,
) -> Result<ChatResponse, GatewayError> {
    tracing::info!(
        "代理聊天请求 - 模型: {}, 消息数: {}",
        req.model,
        req.messages.len()
    );

    let url = config.chat_completions_url();

    // 发送请求到上游 API，自动添加 Authorization header
    let response = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", config.api_key))
        .header("Content-Type", "application/json")
        .json(&req)
        .send()
        .await
        .map_err(|e| {
            if e.is_timeout() {
                GatewayError::Timeout
            } else {
                GatewayError::UpstreamError(format!("请求上游失败: {}", e))
            }
        })?;

    let status = response.status();

    // 检查上游响应状态码
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        tracing::warn!("上游返回错误状态码: {} - {}", status, body);
        return Err(GatewayError::UpstreamError(format!(
            "上游返回状态码 {}: {}",
            status, body
        )));
    }

    // 解析上游响应 JSON
    let chat_response = response
        .json::<ChatResponse>()
        .await
        .map_err(|e| GatewayError::UpstreamError(format!("解析上游响应失败: {}", e)))?;

    tracing::info!("聊天请求完成");
    Ok(chat_response)
}

/// 流式聊天代理
///
/// 将聊天请求转发到上游 API，返回字节流供 SSE 转发模块处理。
/// 内部使用 `tokio::sync::mpsc` channel 实现异步流式转发，
/// 避免了 `reqwest::Response::bytes_stream()` 的生命周期问题。
///
/// # 参数
/// - `req`: 聊天请求体（会自动设置 `stream = true`）
/// - `client`: 复用的 HTTP 客户端
/// - `config`: 网关配置
///
/// # 返回
/// 返回一个 `Send + 'static` 的字节流，每个元素为 `Result<Bytes, GatewayError>`
pub async fn proxy_chat_stream(
    req: ChatRequest,
    client: &Client,
    config: &Config,
) -> impl Stream<Item = Result<Bytes, GatewayError>> + Send + 'static {
    // 创建 channel 用于异步转发字节流
    let (tx, rx) = tokio::sync::mpsc::channel::<Result<Bytes, GatewayError>>(64);

    let url = config.chat_completions_url();
    let api_key = config.api_key.clone();

    // 克隆请求并强制设置 stream 为 true
    let mut stream_req = req.clone();
    stream_req.stream = true;

    // 克隆客户端（内部为 Arc，开销极低）
    let client = client.clone();

    // 启动异步任务处理上游请求和流式转发
    tokio::spawn(async move {
        tracing::info!("代理流式聊天请求 - 模型: {}", stream_req.model);

        // 发送请求到上游 API
        let response = match client
            .post(&url)
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .json(&stream_req)
            .send()
            .await
        {
            Ok(resp) => resp,
            Err(e) => {
                let error = if e.is_timeout() {
                    GatewayError::Timeout
                } else {
                    GatewayError::UpstreamError(format!("请求上游失败: {}", e))
                };
                let _ = tx.send(Err(error)).await;
                return;
            }
        };

        let status = response.status();

        // 检查上游响应状态码
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            tracing::warn!("上游返回错误状态码: {} - {}", status, body);
            let _ = tx
                .send(Err(GatewayError::UpstreamError(format!(
                    "上游返回状态码 {}: {}",
                    status, body
                ))))
                .await;
            return;
        }

        // 逐块读取上游 SSE 响应并转发到 channel
        let mut byte_stream = response.bytes_stream();
        while let Some(chunk_result) = byte_stream.next().await {
            match chunk_result {
                Ok(bytes) => {
                    // 发送数据块到 channel，如果接收端已关闭则停止
                    if tx.send(Ok(bytes)).await.is_err() {
                        tracing::info!("客户端断开连接，停止转发");
                        break;
                    }
                }
                Err(e) => {
                    let _ = tx
                        .send(Err(GatewayError::UpstreamError(format!(
                            "读取上游流失败: {}",
                            e
                        ))))
                        .await;
                    break;
                }
            }
        }

        tracing::info!("流式转发完成");
    });

    // 返回 channel 接收端作为 Stream
    tokio_stream::wrappers::ReceiverStream::new(rx)
}

/// 获取上游模型列表
///
/// 转发 GET 请求到上游 `/v1/models` 端点。
pub async fn proxy_list_models(
    client: &Client,
    config: &Config,
) -> Result<ModelListResponse, GatewayError> {
    tracing::info!("代理模型列表请求");

    let url = config.models_url();

    let response = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", config.api_key))
        .send()
        .await
        .map_err(|e| {
            if e.is_timeout() {
                GatewayError::Timeout
            } else {
                GatewayError::UpstreamError(format!("请求上游失败: {}", e))
            }
        })?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(GatewayError::UpstreamError(format!(
            "上游返回状态码 {}: {}",
            status, body
        )));
    }

    let model_list = response
        .json::<ModelListResponse>()
        .await
        .map_err(|e| GatewayError::UpstreamError(format!("解析模型列表失败: {}", e)))?;

    Ok(model_list)
}
