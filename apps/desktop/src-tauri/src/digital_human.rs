// ============================================================
// Aurora 数字人引擎 — Rust 侧桥接模块
// ------------------------------------------------------------
// 职责：
//   1. 管理 Python 推理服务子进程的生命周期（启动 / 健康检查 / 关闭）
//   2. 通过 HTTP (reqwest) 与 Python 服务通信
//   3. 将生成 / 下载进度通过 Tauri 事件推送到前端
//   4. 管理模型下载
//   5. 向前端暴露 Tauri 命令
//
// 架构：
//   前端 (React) ──invoke──> Rust (本模块) ──HTTP──> Python (server.py)
//                                   ├── 启动/管理 Python 子进程
//                                   ├── 转发 API 请求
//                                   └── 推送进度事件到前端
//
// 说明：
//   - 本模块仅在桌面端编译。模块声明位于 lib.rs：
//         #[cfg(not(target_os = "android"))] mod digital_human;
//   - Android 平台不支持本地子进程与 GPU 推理，对应命令亦不注册，
//     前端通过 app_info().is_desktop 判断后再调用。
// ============================================================

use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

// ============================================================
// 常量
// ============================================================

/// Python 服务固定监听端口（与 digital-human/config.py 中 ServerConfig.PORT 一致）
const SERVICE_PORT: u16 = 7861;

/// Python 服务监听地址（仅本机访问，安全考虑）
const SERVICE_HOST: &str = "127.0.0.1";

/// 服务就绪最大等待时间（秒）
const READY_TIMEOUT_SECS: u64 = 30;

/// 就绪轮询间隔（毫秒）
const READY_POLL_INTERVAL_MS: u64 = 500;

/// 生成进度轮询间隔（毫秒）
const GENERATE_POLL_INTERVAL_MS: u64 = 1000;

/// 下载进度轮询间隔（毫秒）
const DOWNLOAD_POLL_INTERVAL_MS: u64 = 1000;

/// 生成任务最大等待时间（秒）
const GENERATE_DEADLINE_SECS: u64 = 3600;

/// 模型下载最大等待时间（秒）
const DOWNLOAD_DEADLINE_SECS: u64 = 7200;

// ============================================================
// 数据结构
// ============================================================

/// 数字人生成请求参数（前端传入）
#[derive(Deserialize, Clone, Serialize)]
pub struct DigitalHumanRequest {
    /// 头像图片路径
    pub avatar_path: String,
    /// 模型类型：musetalk / sadtalker / wav2lip / echomimic / hallo2
    pub model_type: String,
    /// 音频来源：tts（TTS 合成）/ upload（上传音频）
    pub audio_source: String,
    /// TTS 文本（audio_source == "tts" 时必填）
    pub tts_text: Option<String>,
    /// TTS 语音 ID（如 zh-CN-XiaoxiaoNeural）
    pub tts_voice: Option<String>,
    /// 上传音频路径（audio_source == "upload" 时必填）
    pub audio_path: Option<String>,
    /// 输出分辨率（如 "512"）
    pub output_resolution: Option<String>,
    /// 输出帧率
    pub fps: Option<u32>,
}

/// 生成结果
#[derive(Serialize, Clone, Deserialize)]
pub struct GenerationResult {
    /// 生成的视频文件路径
    pub video_path: String,
    /// 视频时长（秒）
    pub duration: f64,
    /// 分辨率描述
    pub resolution: String,
    /// 实际使用的模型
    pub model_used: String,
    /// 处理耗时（秒）
    pub processing_time: f64,
}

/// 系统信息（GPU / CUDA / ffmpeg / Python）
#[derive(Serialize, Clone, Deserialize)]
pub struct SystemInfo {
    pub gpu_available: bool,
    pub gpu_name: String,
    pub vram_total: String,
    pub vram_free: String,
    pub cuda_version: String,
    pub ffmpeg_available: bool,
    pub python_version: String,
}

/// 模型信息
#[derive(Serialize, Clone, Deserialize)]
pub struct ModelInfo {
    pub id: String,
    pub name: String,
    pub installed: bool,
    pub size: String,
    pub description: String,
}

/// 生成进度事件载荷（推送到前端 "dh-progress" 事件）
#[derive(Serialize, Clone)]
struct GenerateProgressPayload {
    /// 进度 0.0 ~ 1.0
    progress: f64,
    /// 人类可读的进度描述
    message: String,
    /// 任务状态（queued / processing / completed / error ...）
    status: String,
}

/// 下载进度事件载荷（推送到前端 "dh-download-progress" 事件）
#[derive(Serialize, Clone)]
struct DownloadProgressPayload {
    /// 模型类型
    model_type: String,
    /// 进度 0.0 ~ 1.0
    progress: f64,
    /// 人类可读的进度描述
    message: String,
    /// 下载状态
    status: String,
}

// ---- Python 服务响应结构（反序列化用，字段尽量可选以增强健壮性）----

/// POST /generate 的响应：可能直接返回结果，或返回任务 ID 供轮询
#[derive(Deserialize)]
struct GenerateResponse {
    #[serde(default)]
    task_id: Option<String>,
    #[serde(default)]
    status: Option<String>,
    // 以下字段在同步返回或完成时可能存在
    #[serde(default)]
    video_path: Option<String>,
    #[serde(default)]
    duration: Option<f64>,
    #[serde(default)]
    resolution: Option<String>,
    #[serde(default)]
    model_used: Option<String>,
    #[serde(default)]
    processing_time: Option<f64>,
    #[serde(default)]
    message: Option<String>,
    #[serde(default)]
    error: Option<String>,
}

/// GET /generate/status 的响应
#[derive(Deserialize)]
struct GenerateStatus {
    #[serde(default)]
    status: String,
    #[serde(default)]
    progress: Option<f64>,
    #[serde(default)]
    message: Option<String>,
    #[serde(default)]
    video_path: Option<String>,
    #[serde(default)]
    duration: Option<f64>,
    #[serde(default)]
    resolution: Option<String>,
    #[serde(default)]
    model_used: Option<String>,
    #[serde(default)]
    processing_time: Option<f64>,
    #[serde(default)]
    error: Option<String>,
}

/// POST /models/download 的响应
#[derive(Deserialize)]
struct DownloadResponse {
    #[serde(default)]
    task_id: Option<String>,
    #[serde(default)]
    status: Option<String>,
    #[serde(default)]
    message: Option<String>,
}

/// GET /models/download/status 的响应
#[derive(Deserialize)]
struct DownloadStatus {
    #[serde(default)]
    status: String,
    #[serde(default)]
    progress: Option<f64>,
    #[serde(default)]
    message: Option<String>,
    #[serde(default)]
    model_type: Option<String>,
    #[serde(default)]
    error: Option<String>,
}

/// POST /tts/synthesize 的响应（兼容不同字段名）
#[derive(Deserialize)]
struct TtsResponse {
    #[serde(default)]
    audio_path: Option<String>,
    #[serde(default)]
    path: Option<String>,
    #[serde(default)]
    url: Option<String>,
}

/// GET /health 的响应
#[derive(Deserialize)]
struct HealthResponse {
    #[serde(default)]
    status: Option<String>,
    #[serde(default)]
    ok: Option<bool>,
}

// ============================================================
// Python 服务管理器
// ============================================================

/// Python 推理服务管理器
///
/// 负责：
/// - 启动 / 停止 Python 子进程（server.py）
/// - 通过 HTTP 与之通信
/// - 转发生成 / 下载请求并推送进度事件
///
/// 该实例由 `app.manage(Mutex<DigitalHumanService>)` 注册为 Tauri State，
/// 各 Tauri 命令通过 `tauri::State<'_, Mutex<DigitalHumanService>>` 访问。
pub struct DigitalHumanService {
    /// Python 子进程句柄（None 表示未启动）
    child: Option<Child>,
    /// 服务监听端口
    port: u16,
    /// 服务基础 URL（如 http://127.0.0.1:7861）
    base_url: String,
    /// 共享的 HTTP 客户端（连接池复用）
    client: reqwest::Client,
}

impl DigitalHumanService {
    /// 创建服务管理器实例（未启动）
    ///
    /// 端口固定为 7861，初始状态为未启动。
    pub fn new() -> Self {
        let client = reqwest::Client::builder()
            // 单个请求最长 1 小时（兼容同步生成的大模型任务）
            .timeout(Duration::from_secs(3600))
            .connect_timeout(Duration::from_secs(10))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());

        DigitalHumanService {
            child: None,
            port: SERVICE_PORT,
            base_url: format!("http://{}:{}", SERVICE_HOST, SERVICE_PORT),
            client,
        }
    }

    /// 服务是否已启动（存在子进程句柄）
    pub fn is_running(&self) -> bool {
        self.child.is_some()
    }

    /// 创建一个仅用于发起 HTTP 请求的轻量视图
    ///
    /// 共享连接池（`reqwest::Client` 内部为 Arc，克隆开销极低）与 base_url，
    /// 不包含子进程句柄（`child: None`）。
    ///
    /// 用途：Tauri 命令是 async 的，而 State 使用的是 `std::sync::Mutex`。
    /// `std::sync::MutexGuard` 是 `!Send`，不能跨 `.await` 持有。
    /// 因此命令在持锁期间提取出该视图后立即释放锁，再在无锁状态下进行异步 HTTP 请求。
    ///
    /// 注意：视图的 `child` 为 `None`，其 `Drop` 不会影响任何真实子进程。
    fn http_view(&self) -> DigitalHumanService {
        DigitalHumanService {
            child: None,
            port: self.port,
            base_url: self.base_url.clone(),
            client: self.client.clone(),
        }
    }

    // -------------------- 生命周期管理 --------------------

    /// 确保服务运行
    ///
    /// 流程：
    /// 1. 若已有子进程且端口可连通 → 视为已运行，直接返回
    /// 2. 若端口可连通（可能是外部启动的服务）→ 设置 base_url 后返回
    /// 3. 查找 Python 可执行文件与 server.py 脚本
    /// 4. 启动子进程：`python server.py --port 7861`
    /// 5. 轮询端口直到服务就绪（最多等待 `READY_TIMEOUT_SECS` 秒）
    /// 6. 超时则终止子进程并返回错误
    ///
    /// 说明：本方法是同步的（启动子进程与端口探测均为阻塞操作）。
    /// 在 `dh_start_engine` 命令中调用时持锁，正常情况下 Python 服务 1~3 秒内即可就绪。
    pub fn ensure_running(&mut self, app: &AppHandle) -> Result<(), String> {
        // 1. 已有子进程且端口可连通 → 已运行
        if self.child.is_some() && port_listening(SERVICE_HOST, self.port) {
            return Ok(());
        }

        // 2. 端口可连通（外部已启动服务）→ 视为就绪
        if port_listening(SERVICE_HOST, self.port) {
            self.base_url = format!("http://{}:{}", SERVICE_HOST, self.port);
            return Ok(());
        }

        // 3. 端口被占用但无法连通 → 冲突
        if !check_port_available(self.port) {
            return Err(format!(
                "端口 {} 已被其他程序占用且无法连通，请释放该端口后重试",
                self.port
            ));
        }

        // 4. 查找 Python 可执行文件
        let python = find_python()?;

        // 5. 查找 server.py 脚本
        let script = find_server_script(app)?;

        // 6. 准备日志文件（重定向子进程 stdout/stderr，避免管道写满阻塞子进程）
        let log_file = open_service_log_file();

        // 7. 启动子进程：python server.py --port 7861
        let mut cmd = Command::new(&python);
        cmd.arg(&script)
            .arg("--port")
            .arg(self.port.to_string())
            .env("PYTHONUNBUFFERED", "1")
            .env("PYTHONIOENCODING", "utf-8");

        // 重定向输出到日志文件；若打开失败则丢弃输出（仍避免管道阻塞）
        if let Some(file) = log_file {
            let stderr_file = file
                .try_clone()
                .map_err(|e| format!("复制日志文件句柄失败: {}", e))?;
            cmd.stdout(Stdio::from(file));
            cmd.stderr(Stdio::from(stderr_file));
        } else {
            cmd.stdout(Stdio::null());
            cmd.stderr(Stdio::null());
        }

        let child = cmd.spawn().map_err(|e| {
            format!(
                "启动 Python 服务失败（{} {}）: {}",
                python.display(),
                script.display(),
                e
            )
        })?;

        let pid = child.id();
        self.child = Some(child);
        self.base_url = format!("http://{}:{}", SERVICE_HOST, self.port);

        eprintln!(
            "[Aurora][数字人] Python 服务已启动，等待就绪: {} {} (pid={:?})",
            python.display(),
            script.display(),
            pid
        );

        // 8. 轮询端口直到就绪
        let deadline = Instant::now() + Duration::from_secs(READY_TIMEOUT_SECS);
        loop {
            std::thread::sleep(Duration::from_millis(READY_POLL_INTERVAL_MS));
            if port_listening(SERVICE_HOST, self.port) {
                eprintln!("[Aurora][数字人] Python 服务已就绪: {}", self.base_url);
                return Ok(());
            }
            if Instant::now() >= deadline {
                break;
            }
        }

        // 9. 超时：清理子进程并返回错误
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        Err(format!(
            "数字人引擎启动超时（{} 秒内未就绪），请检查 Python 环境与依赖是否安装完整",
            READY_TIMEOUT_SECS
        ))
    }

    /// 停止服务
    ///
    /// 终止子进程并等待其退出，回收资源。
    pub fn stop(&mut self) {
        if let Some(mut child) = self.child.take() {
            eprintln!(
                "[Aurora][数字人] 正在停止 Python 服务 (pid={:?})",
                child.id()
            );
            // 终止子进程（Unix 下发送 SIGKILL，Windows 下调用 TerminateProcess）
            let _ = child.kill();
            // 等待进程退出，避免僵尸进程
            let _ = child.wait();
        }
    }

    // -------------------- HTTP 通信 --------------------

    /// 通用 HTTP 请求封装
    ///
    /// - `method`: HTTP 方法（GET / POST ...）
    /// - `path`: 接口路径（如 "/system/info"）
    /// - `body`: 请求体（None 表示无请求体；GET 请求通常为 None）
    ///
    /// 返回反序列化后的 `T`。
    pub async fn request<T: DeserializeOwned>(
        &self,
        method: reqwest::Method,
        path: &str,
        body: Option<serde_json::Value>,
    ) -> Result<T, String> {
        let url = format!("{}{}", self.base_url, path);
        let mut req = self.client.request(method.clone(), &url);
        if let Some(b) = body {
            req = req.json(&b);
        }

        let resp = req
            .send()
            .await
            .map_err(|e| format!("请求 {} 失败: {}", url, e))?;

        let status = resp.status();
        if !status.is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(format!("服务返回错误（{} {}）: {}", method, status, text));
        }

        resp.json::<T>()
            .await
            .map_err(|e| format!("解析响应失败（{}）: {}", url, e))
    }

    /// 获取系统信息（GET /system/info）
    pub async fn get_system_info(&self) -> Result<SystemInfo, String> {
        self.request(reqwest::Method::GET, "/system/info", None)
            .await
    }

    /// 列出所有可用模型（GET /models/list）
    pub async fn list_models(&self) -> Result<Vec<ModelInfo>, String> {
        self.request(reqwest::Method::GET, "/models/list", None)
            .await
    }

    /// 健康检查（GET /health）
    ///
    /// 成功且服务正常返回 Ok(true)；连接失败或服务异常返回 Ok(false)。
    pub async fn health_check(&self) -> Result<bool, String> {
        match self
            .request::<HealthResponse>(reqwest::Method::GET, "/health", None)
            .await
        {
            Ok(h) => Ok(h.ok.unwrap_or_else(|| h.status.as_deref() == Some("ok"))),
            Err(_) => Ok(false),
        }
    }

    /// 生成数字人视频（POST /generate + 轮询 /generate/status）
    ///
    /// - 若 POST 同步返回最终结果，直接返回
    /// - 否则通过返回的 `task_id` 轮询 `/generate/status`
    /// - 进度通过 `app.emit("dh-progress", payload)` 推送到前端
    pub async fn generate(
        &self,
        app: &AppHandle,
        req: DigitalHumanRequest,
    ) -> Result<GenerationResult, String> {
        let model_type_for_fallback = req.model_type.clone();
        let resolution_for_fallback = req.output_resolution.clone();

        let body =
            serde_json::to_value(&req).map_err(|e| format!("序列化生成请求失败: {}", e))?;

        // 1. 发起生成请求
        let resp: GenerateResponse = self
            .request(reqwest::Method::POST, "/generate", Some(body))
            .await?;

        // 推送初始进度
        let _ = app.emit(
            "dh-progress",
            &GenerateProgressPayload {
                progress: 0.0,
                message: resp
                    .message
                    .clone()
                    .unwrap_or_else(|| "已提交生成任务".to_string()),
                status: resp
                    .status
                    .clone()
                    .unwrap_or_else(|| "queued".to_string()),
            },
        );

        // 2. 失败：直接返回错误
        if let Some(err) = resp.error.clone() {
            let _ = app.emit(
                "dh-progress",
                &GenerateProgressPayload {
                    progress: 0.0,
                    message: err.clone(),
                    status: "error".to_string(),
                },
            );
            return Err(err);
        }

        // 3. 同步返回了最终结果 → 直接构造返回
        if let Some(video_path) = resp.video_path.clone() {
            return Ok(GenerationResult {
                video_path,
                duration: resp.duration.unwrap_or(0.0),
                resolution: resp
                    .resolution
                    .clone()
                    .unwrap_or_else(|| resolution_for_fallback.unwrap_or_default()),
                model_used: resp
                    .model_used
                    .clone()
                    .unwrap_or_else(|| model_type_for_fallback),
                processing_time: resp.processing_time.unwrap_or(0.0),
            });
        }

        // 4. 通过 task_id 轮询状态
        let task_id = match resp.task_id.clone() {
            Some(id) => id,
            None => {
                return Err(
                    resp.error
                        .unwrap_or_else(|| "生成任务未返回 task_id 或结果".to_string()),
                )
            }
        };

        let deadline = Instant::now() + Duration::from_secs(GENERATE_DEADLINE_SECS);
        loop {
            if Instant::now() >= deadline {
                let _ = app.emit(
                    "dh-progress",
                    &GenerateProgressPayload {
                        progress: 0.0,
                        message: "生成超时".to_string(),
                        status: "error".to_string(),
                    },
                );
                return Err(format!(
                    "数字人生成超时（已等待 {} 秒）",
                    GENERATE_DEADLINE_SECS
                ));
            }

            tokio::time::sleep(Duration::from_millis(GENERATE_POLL_INTERVAL_MS)).await;

            let path = format!("/generate/status?task_id={}", url_encode(&task_id));
            let st: GenerateStatus = match self.request(reqwest::Method::GET, &path, None).await {
                Ok(s) => s,
                Err(e) => {
                    // 单次轮询失败不致命，记录后继续重试
                    eprintln!("[Aurora][数字人] 查询生成状态失败（将重试）: {}", e);
                    continue;
                }
            };

            let progress = st.progress.unwrap_or(0.0);
            let message = st.message.clone().unwrap_or_else(|| {
                format!("生成中... {:.0}%", progress * 100.0)
            });
            let _ = app.emit(
                "dh-progress",
                &GenerateProgressPayload {
                    progress,
                    message,
                    status: st.status.clone(),
                },
            );

            let status_lower = st.status.to_lowercase();
            if status_lower == "completed"
                || status_lower == "done"
                || status_lower == "success"
                || status_lower == "succeeded"
            {
                let video_path = st
                    .video_path
                    .ok_or_else(|| "生成完成但未返回视频路径".to_string())?;
                return Ok(GenerationResult {
                    video_path,
                    duration: st.duration.unwrap_or(0.0),
                    resolution: st
                        .resolution
                        .clone()
                        .unwrap_or_else(|| resolution_for_fallback.unwrap_or_default()),
                    model_used: st
                        .model_used
                        .unwrap_or_else(|| model_type_for_fallback),
                    processing_time: st.processing_time.unwrap_or(0.0),
                });
            }

            if status_lower == "error" || status_lower == "failed" {
                return Err(st
                    .error
                    .or(st.message)
                    .unwrap_or_else(|| "生成失败".to_string()));
            }
        }
    }

    /// 下载模型（POST /models/download + 轮询 /models/download/status）
    ///
    /// - POST 后若返回 `task_id` 则按 task_id 轮询，否则按 model_type 轮询
    /// - 进度通过 `app.emit("dh-download-progress", payload)` 推送到前端
    pub async fn download_model(
        &self,
        app: &AppHandle,
        model_type: String,
    ) -> Result<(), String> {
        let body = serde_json::json!({ "model_type": model_type });

        let resp: DownloadResponse = self
            .request(reqwest::Method::POST, "/models/download", Some(body))
            .await?;

        let _ = app.emit(
            "dh-download-progress",
            &DownloadProgressPayload {
                model_type: model_type.clone(),
                progress: 0.0,
                message: resp
                    .message
                    .clone()
                    .unwrap_or_else(|| format!("开始下载模型: {}", model_type)),
                status: resp
                    .status
                    .clone()
                    .unwrap_or_else(|| "downloading".to_string()),
            },
        );

        let task_id = resp.task_id.clone();
        let deadline = Instant::now() + Duration::from_secs(DOWNLOAD_DEADLINE_SECS);
        loop {
            if Instant::now() >= deadline {
                let _ = app.emit(
                    "dh-download-progress",
                    &DownloadProgressPayload {
                        model_type: model_type.clone(),
                        progress: 0.0,
                        message: "下载超时".to_string(),
                        status: "error".to_string(),
                    },
                );
                return Err(format!(
                    "模型 {} 下载超时（已等待 {} 秒）",
                    model_type, DOWNLOAD_DEADLINE_SECS
                ));
            }

            tokio::time::sleep(Duration::from_millis(DOWNLOAD_POLL_INTERVAL_MS)).await;

            let path = match &task_id {
                Some(id) => format!("/models/download/status?task_id={}", url_encode(id)),
                None => format!(
                    "/models/download/status?model_type={}",
                    url_encode(&model_type)
                ),
            };

            let st: DownloadStatus = match self.request(reqwest::Method::GET, &path, None).await {
                Ok(s) => s,
                Err(e) => {
                    eprintln!("[Aurora][数字人] 查询下载状态失败（将重试）: {}", e);
                    continue;
                }
            };

            let progress = st.progress.unwrap_or(0.0);
            let mt = st
                .model_type
                .clone()
                .unwrap_or_else(|| model_type.clone());
            let _ = app.emit(
                "dh-download-progress",
                &DownloadProgressPayload {
                    model_type: mt,
                    progress,
                    message: st
                        .message
                        .clone()
                        .unwrap_or_else(|| format!("下载中... {:.0}%", progress * 100.0)),
                    status: st.status.clone(),
                },
            );

            let status_lower = st.status.to_lowercase();
            if status_lower == "completed"
                || status_lower == "done"
                || status_lower == "success"
                || status_lower == "installed"
            {
                return Ok(());
            }
            if status_lower == "error" || status_lower == "failed" {
                return Err(st
                    .error
                    .or(st.message)
                    .unwrap_or_else(|| format!("模型 {} 下载失败", model_type)));
            }
        }
    }

    /// TTS 合成（POST /tts/synthesize）
    ///
    /// 返回合成的音频文件路径。
    pub async fn synthesize_tts(&self, text: String, voice: String) -> Result<String, String> {
        let body = serde_json::json!({ "text": text, "voice": voice });
        let resp: TtsResponse = self
            .request(reqwest::Method::POST, "/tts/synthesize", Some(body))
            .await?;

        resp.audio_path
            .or(resp.path)
            .or(resp.url)
            .ok_or_else(|| "TTS 合成未返回音频路径".to_string())
    }
}

impl Default for DigitalHumanService {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for DigitalHumanService {
    fn drop(&mut self) {
        // 仅当本实例真实持有子进程时才终止（http_view 视图的 child 为 None，此处为空操作）
        if let Some(mut child) = self.child.take() {
            eprintln!(
                "[Aurora][数字人] 服务实例销毁，终止 Python 子进程 (pid={:?})",
                child.id()
            );
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

// ============================================================
// Tauri 命令
// ============================================================

/// 获取数字人引擎系统信息
#[tauri::command]
pub async fn dh_system_info(
    state: tauri::State<'_, Mutex<DigitalHumanService>>,
) -> Result<SystemInfo, String> {
    let view = {
        let svc = state.lock().map_err(|e| e.to_string())?;
        if !svc.is_running() {
            return Err("数字人引擎服务未运行，请先启动引擎".to_string());
        }
        svc.http_view()
    };
    view.get_system_info().await
}

/// 列出所有可用模型
#[tauri::command]
pub async fn dh_list_models(
    state: tauri::State<'_, Mutex<DigitalHumanService>>,
) -> Result<Vec<ModelInfo>, String> {
    let view = {
        let svc = state.lock().map_err(|e| e.to_string())?;
        if !svc.is_running() {
            return Err("数字人引擎服务未运行，请先启动引擎".to_string());
        }
        svc.http_view()
    };
    view.list_models().await
}

/// 生成数字人视频
#[tauri::command]
pub async fn dh_generate(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<DigitalHumanService>>,
    request: DigitalHumanRequest,
) -> Result<GenerationResult, String> {
    let view = {
        let svc = state.lock().map_err(|e| e.to_string())?;
        if !svc.is_running() {
            return Err("数字人引擎服务未运行，请先启动引擎".to_string());
        }
        svc.http_view()
    };
    view.generate(&app, request).await
}

/// 下载模型
#[tauri::command]
pub async fn dh_download_model(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<DigitalHumanService>>,
    model_type: String,
) -> Result<(), String> {
    let view = {
        let svc = state.lock().map_err(|e| e.to_string())?;
        if !svc.is_running() {
            return Err("数字人引擎服务未运行，请先启动引擎".to_string());
        }
        svc.http_view()
    };
    view.download_model(&app, model_type).await
}

/// TTS 合成
#[tauri::command]
pub async fn dh_tts(
    state: tauri::State<'_, Mutex<DigitalHumanService>>,
    text: String,
    voice: String,
) -> Result<String, String> {
    let view = {
        let svc = state.lock().map_err(|e| e.to_string())?;
        if !svc.is_running() {
            return Err("数字人引擎服务未运行，请先启动引擎".to_string());
        }
        svc.http_view()
    };
    view.synthesize_tts(text, voice).await
}

/// 检查引擎服务是否运行（HTTP 健康检查）
#[tauri::command]
pub async fn dh_health_check(
    state: tauri::State<'_, Mutex<DigitalHumanService>>,
) -> Result<bool, String> {
    let view = {
        let svc = state.lock().map_err(|e| e.to_string())?;
        svc.http_view()
    };
    view.health_check().await
}

/// 启动引擎服务
#[tauri::command]
pub async fn dh_start_engine(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<DigitalHumanService>>,
) -> Result<(), String> {
    let mut svc = state.lock().map_err(|e| e.to_string())?;
    svc.ensure_running(&app)?;
    Ok(())
}

/// 停止引擎服务
#[tauri::command]
pub async fn dh_stop_engine(
    state: tauri::State<'_, Mutex<DigitalHumanService>>,
) -> Result<(), String> {
    let mut svc = state.lock().map_err(|e| e.to_string())?;
    svc.stop();
    Ok(())
}

// ============================================================
// 自研编排管线命令
// ============================================================

/// 管线运行请求参数（前端传入）
#[derive(Deserialize, Clone, Serialize)]
pub struct PipelineRunRequest {
    pub script: String,
    pub avatar_path: String,
    pub voice: Option<String>,
    pub tts_rate: Option<String>,
    pub tts_volume: Option<String>,
    pub tts_pitch: Option<String>,
    pub provider_id: Option<String>,
    pub model_name: Option<String>,
    pub resolution: Option<String>,
    pub enable_script_optimization: Option<bool>,
    pub script_style: Option<String>,
    pub llm_api_key: Option<String>,
    pub add_watermark: Option<bool>,
    pub add_subtitles: Option<bool>,
    pub extra_params: Option<serde_json::Value>,
}

/// 管线运行响应
#[derive(Deserialize, Clone, Serialize)]
pub struct PipelineRunResponse {
    pub task_id: String,
    pub status: String,
    pub message: String,
}

/// 云端提供商信息
#[derive(Deserialize, Clone, Serialize)]
pub struct CloudProviderInfo {
    pub id: String,
    pub name: String,
    pub requires_api_key: bool,
    pub china_available: bool,
    pub docs_url: String,
    pub configured: bool,
    pub models: Vec<serde_json::Value>,
}

/// 成本估算
#[derive(Deserialize, Clone, Serialize)]
pub struct CostEstimate {
    pub cost: f64,
    pub currency: String,
    pub detail: String,
}

/// 文案优化风格
#[derive(Deserialize, Clone, Serialize)]
pub struct ScriptStyle {
    pub id: String,
    pub name: String,
}

/// 启动自研编排管线
#[tauri::command]
pub async fn dh_pipeline_run(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<DigitalHumanService>>,
    request: PipelineRunRequest,
) -> Result<PipelineRunResponse, String> {
    let view = {
        let svc = state.lock().map_err(|e| e.to_string())?;
        if !svc.is_running() {
            return Err("数字人引擎服务未运行，请先启动引擎".to_string());
        }
        svc.http_view()
    };

    let body = serde_json::to_value(&request)
        .map_err(|e| format!("序列化管线请求失败: {}", e))?;

    let resp: PipelineRunResponse = view
        .request(reqwest::Method::POST, "/pipeline/run", Some(body))
        .await?;

    // 启动后台轮询管线进度
    let task_id = resp.task_id.clone();
    let app_clone = app.clone();

    tokio::spawn(async move {
        // 从 Tauri State 重新获取轻量视图（避免 Clone 整个 Service）
        let state = app_clone.state::<std::sync::Mutex<DigitalHumanService>>();
        let view = {
            let svc = match state.lock() {
                Ok(guard) => guard,
                Err(_) => return,
            };
            if !svc.is_running() {
                return;
            }
            svc.http_view()
        };
        let _ = poll_pipeline_progress(&app_clone, &view, &task_id).await;
    });

    Ok(resp)
}

/// 轮询管线进度并推送到前端
async fn poll_pipeline_progress(
    app: &AppHandle,
    view: &DigitalHumanService,
    task_id: &str,
) -> Result<(), String> {
    let url = format!("/pipeline/status?task_id={}", task_id);
    let deadline = Instant::now() + Duration::from_secs(GENERATE_DEADLINE_SECS);

    loop {
        if Instant::now() > deadline {
            let _ = app.emit(
                "dh-pipeline-error",
                &serde_json::json!({
                    "task_id": task_id,
                    "error": "管线任务超时",
                }),
            );
            break;
        }

        // 使用 reqwest 发送 SSE 请求（简化版：直接 GET 获取当前状态）
        let client = &view.base_url;
        let full_url = format!("{}{}", client, url);

        match reqwest::get(&full_url).await {
            Ok(resp) => {
                if resp.status().is_success() {
                    // 对于 SSE，我们改为定期轮询状态
                    // 这里简化处理：直接解析返回的 JSON
                    if let Ok(text) = resp.text().await {
                        if let Ok(data) = serde_json::from_str::<serde_json::Value>(&text) {
                            let status = data["status"].as_str().unwrap_or("");
                            let progress = data["global_progress"].as_i64().unwrap_or(0);
                            let stage = data["current_stage"].as_str().unwrap_or("");
                            let message = data["message"].as_str().unwrap_or("");

                            let _ = app.emit(
                                "dh-pipeline-progress",
                                &serde_json::json!({
                                    "task_id": task_id,
                                    "status": status,
                                    "progress": progress,
                                    "stage": stage,
                                    "message": message,
                                }),
                            );

                            if status == "completed" || status == "failed" {
                                let _ = app.emit(
                                    "dh-pipeline-done",
                                    &serde_json::json!({
                                        "task_id": task_id,
                                        "status": status,
                                        "result": data.get("result"),
                                        "error": data.get("error"),
                                    }),
                                );
                                break;
                            }
                        }
                    }
                }
            }
            Err(_) => {}
        }

        tokio::time::sleep(Duration::from_millis(GENERATE_POLL_INTERVAL_MS)).await;
    }

    Ok(())
}

/// 取消管线任务
#[tauri::command]
pub async fn dh_pipeline_cancel(
    state: tauri::State<'_, Mutex<DigitalHumanService>>,
    task_id: String,
) -> Result<(), String> {
    let view = {
        let svc = state.lock().map_err(|e| e.to_string())?;
        if !svc.is_running() {
            return Err("数字人引擎服务未运行".to_string());
        }
        svc.http_view()
    };

    let url = format!("/pipeline/cancel?task_id={}", task_id);
    view.request::<serde_json::Value>(reqwest::Method::POST, &url, None)
        .await?;
    Ok(())
}

/// 列出云端提供商
#[tauri::command]
pub async fn dh_list_cloud_providers(
    state: tauri::State<'_, Mutex<DigitalHumanService>>,
) -> Result<Vec<CloudProviderInfo>, String> {
    let view = {
        let svc = state.lock().map_err(|e| e.to_string())?;
        if !svc.is_running() {
            return Err("数字人引擎服务未运行，请先启动引擎".to_string());
        }
        svc.http_view()
    };

    #[derive(Deserialize)]
    struct ProvidersResponse {
        providers: Vec<CloudProviderInfo>,
    }

    let resp: ProvidersResponse = view
        .request(reqwest::Method::GET, "/cloud/providers", None)
        .await?;

    Ok(resp.providers)
}

/// 配置云端提供商
#[tauri::command]
pub async fn dh_configure_cloud_provider(
    state: tauri::State<'_, Mutex<DigitalHumanService>>,
    provider_id: String,
    config: serde_json::Value,
) -> Result<(), String> {
    let view = {
        let svc = state.lock().map_err(|e| e.to_string())?;
        if !svc.is_running() {
            return Err("数字人引擎服务未运行".to_string());
        }
        svc.http_view()
    };

    let body = serde_json::json!({
        "provider_id": provider_id,
        "config": config,
    });

    view.request::<serde_json::Value>(reqwest::Method::POST, "/cloud/configure", Some(body))
        .await?;
    Ok(())
}

/// 获取云端模型列表
#[tauri::command]
pub async fn dh_list_cloud_models(
    state: tauri::State<'_, Mutex<DigitalHumanService>>,
    provider_id: String,
) -> Result<Vec<serde_json::Value>, String> {
    let view = {
        let svc = state.lock().map_err(|e| e.to_string())?;
        if !svc.is_running() {
            return Err("数字人引擎服务未运行".to_string());
        }
        svc.http_view()
    };

    let path = format!("/cloud/models?provider_id={}", provider_id);
    
    #[derive(Deserialize)]
    struct ModelsResponse {
        models: Vec<serde_json::Value>,
    }

    let resp: ModelsResponse = view
        .request(reqwest::Method::GET, &path, None)
        .await?;

    Ok(resp.models)
}

/// 估算云端生成成本
#[tauri::command]
pub async fn dh_estimate_cost(
    state: tauri::State<'_, Mutex<DigitalHumanService>>,
    provider_id: String,
    model_name: String,
    duration_seconds: f64,
) -> Result<CostEstimate, String> {
    let view = {
        let svc = state.lock().map_err(|e| e.to_string())?;
        if !svc.is_running() {
            return Err("数字人引擎服务未运行".to_string());
        }
        svc.http_view()
    };

    let path = format!(
        "/cloud/estimate?provider_id={}&model_name={}&duration_seconds={}",
        provider_id, model_name, duration_seconds
    );

    view.request::<CostEstimate>(reqwest::Method::GET, &path, None)
        .await
}

/// 获取文案优化风格列表
#[tauri::command]
pub async fn dh_list_script_styles(
    state: tauri::State<'_, Mutex<DigitalHumanService>>,
) -> Result<Vec<ScriptStyle>, String> {
    let view = {
        let svc = state.lock().map_err(|e| e.to_string())?;
        if !svc.is_running() {
            return Err("数字人引擎服务未运行".to_string());
        }
        svc.http_view()
    };

    #[derive(Deserialize)]
    struct StylesResponse {
        styles: Vec<ScriptStyle>,
    }

    let resp: StylesResponse = view
        .request(reqwest::Method::GET, "/script/styles", None)
        .await?;

    Ok(resp.styles)
}

/// 优化脚本文案
#[tauri::command]
pub async fn dh_optimize_script(
    state: tauri::State<'_, Mutex<DigitalHumanService>>,
    text: String,
    style: Option<String>,
    api_key: String,
) -> Result<String, String> {
    let view = {
        let svc = state.lock().map_err(|e| e.to_string())?;
        if !svc.is_running() {
            return Err("数字人引擎服务未运行".to_string());
        }
        svc.http_view()
    };

    let body = serde_json::json!({
        "text": text,
        "style": style.unwrap_or_else(|| "natural".to_string()),
        "api_key": api_key,
        "backend": "qwen",
    });

    #[derive(Deserialize)]
    struct OptimizeResponse {
        optimized_text: String,
    }

    let resp: OptimizeResponse = view
        .request(reqwest::Method::POST, "/script/optimize", Some(body))
        .await?;

    Ok(resp.optimized_text)
}

// ============================================================
// 辅助函数
// ============================================================

/// 查找系统 Python 可执行文件
///
/// 优先级：
///   1. 虚拟环境中的 Python（$VIRTUAL_ENV）
///   2. python3 / python
/// 找到后校验版本 >= 3.9。
fn find_python() -> Result<PathBuf, String> {
    // 1. 虚拟环境
    if let Ok(venv) = std::env::var("VIRTUAL_ENV") {
        let venv_path = PathBuf::from(venv);
        let python = if cfg!(target_os = "windows") {
            venv_path.join("Scripts").join("python.exe")
        } else {
            venv_path.join("bin").join("python")
        };
        if python.is_file() && check_python_version(&python) {
            return Ok(python);
        }
    }

    // 2. 候选名称
    let candidates: &[&str] = if cfg!(target_os = "windows") {
        &["python.exe", "python3.exe"]
    } else {
        &["python3", "python"]
    };

    for name in candidates {
        if let Some(path) = which(name) {
            if check_python_version(&path) {
                return Ok(path);
            }
        }
    }

    Err("未找到可用的 Python（要求版本 >= 3.9），请安装 Python 并加入 PATH".to_string())
}

/// 在 PATH 中查找可执行文件
fn which(name: &str) -> Option<PathBuf> {
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        let full = dir.join(name);
        if full.is_file() {
            return Some(full);
        }
    }
    None
}

/// 校验 Python 版本 >= 3.9
fn check_python_version(python: &PathBuf) -> bool {
    let output = Command::new(python).arg("--version").output();
    match output {
        Ok(out) => {
            // Python 3.x 输出到 stdout，旧版输出到 stderr
            let ver = if out.stdout.is_empty() {
                String::from_utf8_lossy(&out.stderr)
            } else {
                String::from_utf8_lossy(&out.stdout)
            };
            match parse_python_version(&ver) {
                Some((major, minor)) => major > 3 || (major == 3 && minor >= 9),
                None => false,
            }
        }
        Err(_) => false,
    }
}

/// 解析 "Python 3.11.5" 形式的版本号，返回 (主版本, 次版本)
fn parse_python_version(s: &str) -> Option<(u32, u32)> {
    let s = s.trim();
    let s = s.strip_prefix("Python ").unwrap_or(s);
    let mut parts = s.split('.');
    let major = parts.next()?.parse::<u32>().ok()?;
    // 次版本号可能附带非数字后缀（如 9rc1），取前导数字部分
    let minor_raw = parts.next()?;
    let minor_digits: String = minor_raw.chars().take_while(|c| c.is_ascii_digit()).collect();
    let minor = minor_digits.parse::<u32>().ok()?;
    Some((major, minor))
}

/// 查找 digital-human/server.py 脚本路径
///
/// 查找顺序：
///   1. 应用资源目录（生产环境）：resource_dir/digital-human/server.py
///   2. 开发环境源码目录：CARGO_MANIFEST_DIR/digital-human/server.py
///   3. 可执行文件同级目录：exe_dir/digital-human/server.py
///   4. 当前工作目录：./digital-human/server.py
fn find_server_script(app: &AppHandle) -> Result<PathBuf, String> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    // 1. 应用资源目录（生产环境）
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("digital-human").join("server.py"));
    }

    // 2. 开发环境：相对编译期 Cargo.toml 目录
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    candidates.push(manifest_dir.join("digital-human").join("server.py"));

    // 3. 可执行文件同级目录
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            candidates.push(parent.join("digital-human").join("server.py"));
        }
    }

    // 4. 当前工作目录
    candidates.push(PathBuf::from("digital-human").join("server.py"));

    for candidate in candidates {
        if candidate.is_file() {
            return Ok(candidate);
        }
    }

    Err("未找到 digital-human/server.py 脚本，请确认数字人引擎已正确安装".to_string())
}

/// 检查指定端口是否可连通（用于判断 Python 服务是否已启动）
fn port_listening(host: &str, port: u16) -> bool {
    use std::net::{SocketAddr, TcpStream};
    use std::str::FromStr;

    let addr_str = format!("{}:{}", host, port);
    let sock_addr = match SocketAddr::from_str(&addr_str) {
        Ok(a) => a,
        Err(_) => return false,
    };
    TcpStream::connect_timeout(&sock_addr, Duration::from_millis(500)).is_ok()
}

/// 检查端口是否可用（可绑定）
fn check_port_available(port: u16) -> bool {
    use std::net::TcpListener;
    TcpListener::bind(("127.0.0.1", port)).is_ok()
}

/// 从指定端口开始查找可用端口（用于动态端口分配场景）
#[allow(dead_code)]
fn find_available_port(start: u16) -> u16 {
    for port in start..=u16::MAX {
        if check_port_available(port) {
            return port;
        }
    }
    start
}

/// 简易 URL 编码（用于 query 参数编码）
fn url_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char);
            }
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

/// 打开数字人服务日志文件（~/.aurora/logs/digital_human.log）
///
/// 用于重定向 Python 子进程的 stdout / stderr，避免管道写满导致子进程阻塞。
fn open_service_log_file() -> Option<std::fs::File> {
    let dir = dirs::home_dir()?.join(".aurora").join("logs");
    let _ = std::fs::create_dir_all(&dir);
    let path = dir.join("digital_human.log");
    std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .ok()
}
