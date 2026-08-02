//! SSE 流式转发模块
//!
//! 解析上游 SSE 响应并转发给客户端。
//!
//! 工作流程:
//! 1. 从上游字节流中累积数据
//! 2. 按 `\n\n` 分隔符提取完整 SSE 事件
//! 3. 提取 `data:` 行内容，重新封装为 Axum SSE 事件
//! 4. 检测 `[DONE]` 信号，自动结束流

use std::convert::Infallible;

use axum::response::sse::{Event, KeepAlive, Sse};
use bytes::Bytes;
use futures::stream::{Stream, StreamExt};

use crate::error::GatewayError;

/// 将上游字节流转换为 Axum SSE 响应
///
/// 接收 `proxy::proxy_chat_stream` 返回的字节流，
/// 解析其中的 SSE 事件并重新封装为 Axum `Sse` 响应。
///
/// # 参数
/// - `byte_stream`: 上游返回的字节流
///
/// # 返回
/// Axum `Sse` 响应，可直接作为 HTTP 响应返回
pub fn forward_sse<S>(
    byte_stream: S,
) -> Sse<impl Stream<Item = Result<Event, Infallible>> + Send + 'static>
where
    S: Stream<Item = Result<Bytes, GatewayError>> + Send + 'static,
{
    let event_stream = parse_sse_events(byte_stream).boxed();
    Sse::new(event_stream).keep_alive(KeepAlive::default())
}

/// 从字节流中解析 SSE 事件
///
/// 使用 `futures::stream::unfold` 实现有状态的流式解析:
/// - 状态: `(Pin<Box<S>>, String)` - 源流和字符串缓冲区
/// - 每次迭代尝试从缓冲区提取一个完整的 SSE 事件
/// - 缓冲区不足时从源流读取更多数据
///
/// # SSE 事件格式
/// ```text
/// data: {"id":"...","choices":[...]}\n\n
/// data: [DONE]\n\n
/// ```
fn parse_sse_events<S>(
    byte_stream: S,
) -> impl Stream<Item = Result<Event, Infallible>> + Send + 'static
where
    S: Stream<Item = Result<Bytes, GatewayError>> + Send + 'static,
{
    // 将流 pin 到堆上，使其满足 Unpin 约束（unfold 内部需要调用 next()）
    let pinned_stream = Box::pin(byte_stream);

    futures::stream::unfold(
        (pinned_stream, String::new()),
        |(mut stream, mut buffer)| async move {
            loop {
                // 尝试从缓冲区解析完整的 SSE 事件（以 \n\n 分隔）
                if let Some(pos) = buffer.find("\n\n") {
                    let event_str = buffer[..pos].to_string();
                    // 保留剩余数据在缓冲区
                    buffer = buffer[pos + 2..].to_string();

                    // 检测 [DONE] 信号，结束流
                    if event_str.contains("[DONE]") {
                        tracing::info!("收到 [DONE] 信号，结束 SSE 流");
                        return None;
                    }

                    // 提取 data: 行内容（可能有多行 data）
                    let data_lines: Vec<&str> = event_str
                        .lines()
                        .filter_map(|line| {
                            line.strip_prefix("data: ")
                                .or_else(|| line.strip_prefix("data:"))
                        })
                        .collect();

                    if !data_lines.is_empty() {
                        // 合并多行 data，生成 SSE 事件
                        let data = data_lines.join("\n");
                        return Some((Ok(Event::default().data(data)), (stream, buffer)));
                    }

                    // 没有 data 行的事件（如注释行），跳过继续解析
                    continue;
                }

                // 缓冲区中没有完整事件，从上游读取更多数据
                match stream.next().await {
                    Some(Ok(bytes)) => {
                        // 将字节追加到缓冲区（使用 lossy 转换处理非 UTF-8）
                        buffer.push_str(&String::from_utf8_lossy(&bytes));
                    }
                    Some(Err(e)) => {
                        // 上游错误，作为 SSE 错误事件发送给客户端
                        let escaped = e.to_string().replace('\\', "\\\\").replace('"', "\\\"");
                        let error_json = format!(
                            r#"{{"error":{{"message":"{}","type":"upstream_error"}}}}"#,
                            escaped
                        );
                        tracing::warn!("SSE 流中发生错误: {}", e);
                        return Some((
                            Ok(Event::default().data(error_json)),
                            (stream, buffer),
                        ));
                    }
                    None => {
                        // 上游流结束
                        tracing::info!("上游流结束");
                        return None;
                    }
                }
            }
        },
    )
}
