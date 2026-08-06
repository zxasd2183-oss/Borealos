// ============================================================
// Aurora SSH 模块 — 远程设备控制面板
// ------------------------------------------------------------
// 功能：
//   1. SSH 连接管理（密码/密钥认证）
//   2. 远程命令执行
//   3. 系统信息采集（CPU/内存/磁盘/网络/进程）
//   4. 连接配置持久化（JSON 存储到本地）
//   5. 多设备并行监控
// ============================================================

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, Manager};
use tokio::sync::Mutex;

// ---- russh 相关导入 ----
use russh::client::Config;
use russh::{ChannelMsg, Disconnect};

// ============================================================
// 数据结构
// ============================================================

/// SSH 连接配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshHost {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_type: String,     // "password" | "key"
    pub password: Option<String>,
    pub private_key_path: Option<String>,
    pub group: Option<String>,
    pub color: Option<String>,
}

/// 远程系统信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemInfo {
    pub hostname: String,
    pub os: String,
    pub kernel: String,
    pub uptime: String,
    pub cpu_model: String,
    pub cpu_cores: u32,
    pub cpu_usage: f64,
    pub mem_total: u64,
    pub mem_used: u64,
    pub mem_usage: f64,
    pub disk_total: u64,
    pub disk_used: u64,
    pub disk_usage: f64,
    pub swap_total: u64,
    pub swap_used: u64,
    pub load_avg: [f64; 3],
    pub network_rx: u64,
    pub network_tx: u64,
    pub processes: u32,
    pub ip_address: String,
    pub arch: String,
}

/// 连接状态
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HostStatus {
    pub id: String,
    pub connected: bool,
    pub last_seen: Option<String>,
    pub last_error: Option<String>,
    pub system_info: Option<SystemInfo>,
}

/// SSH 客户端 handler — 接受所有服务器密钥
struct SimpleHandler;

#[async_trait::async_trait]
impl russh::client::Handler for SimpleHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &russh_keys::key::PublicKey,
    ) -> Result<(russh_keys::key::PublicKey, bool), Self::Error> {
        // 接受所有密钥（后续可加 known_hosts 验证）
        Ok((_server_public_key.clone(), true))
    }
}

/// 全局连接池
pub struct SshManager {
    pub connections: Arc<Mutex<HashMap<String, russh::client::Handle<SimpleHandler>>>>,
    pub hosts: Arc<Mutex<Vec<SshHost>>>,
    pub config_path: String,
}

impl SshManager {
    pub fn new(app: &tauri::App) -> Self {
        let config_dir = app
            .path()
            .app_config_dir()
            .unwrap_or_else(|_| std::path::PathBuf::from("."));
        let config_path = config_dir.join("ssh_hosts.json").to_string_lossy().to_string();

        // 同步从文件加载主机配置（无需锁）
        let hosts = Self::load_hosts_from_file(&config_path);

        SshManager {
            connections: Arc::new(Mutex::new(HashMap::new())),
            hosts: Arc::new(Mutex::new(hosts)),
            config_path,
        }
    }

    fn load_hosts_from_file(config_path: &str) -> Vec<SshHost> {
        if let Ok(content) = std::fs::read_to_string(config_path) {
            if let Ok(hosts) = serde_json::from_str::<Vec<SshHost>>(&content) {
                // 加载时清除密码（安全）
                return hosts
                    .into_iter()
                    .map(|mut h| {
                        h.password = None;
                        h
                    })
                    .collect();
            }
        }
        Vec::new()
    }

    fn save_hosts(&self, hosts: &[SshHost]) {
        // 保存时清除密码
        let safe: Vec<SshHost> = hosts
            .iter()
            .map(|h| {
                let mut h = h.clone();
                h.password = None;
                h
            })
            .collect();

        if let Ok(json) = serde_json::to_string_pretty(&safe) {
            let _ = std::fs::write(&self.config_path, json);
        }
    }
}

// ============================================================
// Tauri 命令
// ============================================================

/// 获取所有已保存的 SSH 主机
#[tauri::command]
pub async fn ssh_list_hosts(app: AppHandle) -> Result<Vec<SshHost>, String> {
    let manager = app.state::<SshManager>();
    let hosts = manager.hosts.lock().await;
    Ok(hosts.clone())
}

/// 添加或更新 SSH 主机配置
#[tauri::command]
pub async fn ssh_save_host(app: AppHandle, host: SshHost) -> Result<(), String> {
    let manager = app.state::<SshManager>();
    let mut hosts = manager.hosts.lock().await;

    // 查找是否已存在（按 id 更新）
    if let Some(existing) = hosts.iter_mut().find(|h| h.id == host.id) {
        *existing = host;
    } else {
        hosts.push(host);
    }

    manager.save_hosts(&hosts);
    Ok(())
}

/// 删除 SSH 主机配置
#[tauri::command]
pub async fn ssh_delete_host(app: AppHandle, host_id: String) -> Result<(), String> {
    let manager = app.state::<SshManager>();
    let mut hosts = manager.hosts.lock().await;

    hosts.retain(|h| h.id != host_id);

    // 断开连接
    let mut conns = manager.connections.lock().await;
    if let Some(handle) = conns.remove(&host_id) {
        let _ = handle
            .disconnect(Disconnect::ByApplication, "", "en")
            .await;
    }

    manager.save_hosts(&hosts);
    Ok(())
}

/// 测试 SSH 连接
#[tauri::command]
pub async fn ssh_test_connection(host: SshHost) -> Result<String, String> {
    let config = Arc::new(Config::default());

    let mut session = russh::client::connect(config, (&host.host[..], host.port), SimpleHandler)
        .await
        .map_err(|e| format!("连接失败: {}", e))?;

    // 认证
    let auth_result = if host.auth_type == "key" {
        if let Some(key_path) = &host.private_key_path {
            let key_pair = russh_keys::load_secret_key(key_path, None)
                .map_err(|e| format!("加载密钥失败: {}", e))?;
            session
                .authenticate_publickey(&host.username, Arc::new(key_pair))
                .await
                .map_err(|e| format!("密钥认证失败: {}", e))?
        } else {
            return Err("未指定密钥路径".to_string());
        }
    } else {
        let password = host.password.unwrap_or_default();
        session
            .authenticate_password(&host.username, &password)
            .await
            .map_err(|e| format!("密码认证失败: {}", e))?
    };

    if auth_result {
        let _ = session
            .disconnect(Disconnect::ByApplication, "", "en")
            .await;
        Ok("连接成功".to_string())
    } else {
        Err("认证失败".to_string())
    }
}

/// 连接 SSH 主机并保存连接
#[tauri::command]
pub async fn ssh_connect(app: AppHandle, host: SshHost) -> Result<(), String> {
    let manager = app.state::<SshManager>();
    let host_id = host.id.clone();

    // 如果已有连接，先断开
    {
        let mut conns = manager.connections.lock().await;
        if let Some(handle) = conns.remove(&host_id) {
            let _ = handle
                .disconnect(Disconnect::ByApplication, "", "en")
                .await;
        }
    }

    let config = Arc::new(Config::default());

    let mut session = russh::client::connect(config, (&host.host[..], host.port), SimpleHandler)
        .await
        .map_err(|e| format!("连接失败: {}", e))?;

    // 认证
    let auth_result = if host.auth_type == "key" {
        if let Some(key_path) = &host.private_key_path {
            let key_pair = russh_keys::load_secret_key(key_path, None)
                .map_err(|e| format!("加载密钥失败: {}", e))?;
            session
                .authenticate_publickey(&host.username, Arc::new(key_pair))
                .await
                .map_err(|e| format!("密钥认证失败: {}", e))?
        } else {
            return Err("未指定密钥路径".to_string());
        }
    } else {
        let password = host.password.clone().unwrap_or_default();
        session
            .authenticate_password(&host.username, &password)
            .await
            .map_err(|e| format!("密码认证失败: {}", e))?
    };

    if !auth_result {
        return Err("认证失败".to_string());
    }

    let mut conns = manager.connections.lock().await;
    conns.insert(host_id, session);

    Ok(())
}

/// 断开 SSH 连接
#[tauri::command]
pub async fn ssh_disconnect(app: AppHandle, host_id: String) -> Result<(), String> {
    let manager = app.state::<SshManager>();
    let mut conns = manager.connections.lock().await;

    if let Some(handle) = conns.remove(&host_id) {
        let _ = handle
            .disconnect(Disconnect::ByApplication, "", "en")
            .await;
    }

    Ok(())
}

/// 在远程主机上执行命令并返回输出
#[tauri::command]
pub async fn ssh_exec(app: AppHandle, host_id: String, command: String) -> Result<String, String> {
    let manager = app.state::<SshManager>();
    let mut conns = manager.connections.lock().await;

    let handle = conns
        .get_mut(&host_id)
        .ok_or("未连接到该主机")?;

    let mut channel = handle
        .channel_open_session()
        .await
        .map_err(|e| format!("打开通道失败: {}", e))?;

    channel
        .exec(true, &command)
        .await
        .map_err(|e| format!("执行命令失败: {}", e))?;

    let mut output = String::new();

    loop {
        match channel.wait().await {
            Some(ChannelMsg::Data { ref data }) => {
                output.push_str(&String::from_utf8_lossy(data));
            }
            Some(ChannelMsg::ExtendedData { ref data, .. }) => {
                output.push_str(&String::from_utf8_lossy(data));
            }
            Some(ChannelMsg::ExitStatus { .. }) | None => break,
            _ => {}
        }
    }

    Ok(output.trim().to_string())
}

/// 获取远程主机的系统信息
#[tauri::command]
pub async fn ssh_system_info(app: AppHandle, host_id: String) -> Result<SystemInfo, String> {
    let manager = app.state::<SshManager>();

    // 检查连接
    {
        let conns = manager.connections.lock().await;
        if !conns.contains_key(&host_id) {
            return Err("未连接到该主机".to_string());
        }
    }

    // 采集各项系统信息
    let hostname = ssh_exec(app.clone(), host_id.clone(), "hostname".to_string())
        .await
        .unwrap_or_default();

    let os = ssh_exec(
        app.clone(),
        host_id.clone(),
        "cat /etc/os-release 2>/dev/null | grep PRETTY_NAME | cut -d'\"' -f2 || uname -s"
            .to_string(),
    )
    .await
    .unwrap_or_default();

    let kernel = ssh_exec(app.clone(), host_id.clone(), "uname -r".to_string())
        .await
        .unwrap_or_default();

    let arch = ssh_exec(app.clone(), host_id.clone(), "uname -m".to_string())
        .await
        .unwrap_or_default();

    let uptime = ssh_exec(
        app.clone(),
        host_id.clone(),
        "uptime -p 2>/dev/null | sed 's/up //' || echo unknown".to_string(),
    )
    .await
    .unwrap_or_default();

    // CPU 信息
    let cpu_model = ssh_exec(
        app.clone(),
        host_id.clone(),
        "grep 'model name' /proc/cpuinfo 2>/dev/null | head -1 | cut -d':' -f2 | sed 's/^ //'"
            .to_string(),
    )
    .await
    .unwrap_or_default();

    let cpu_cores = ssh_exec(
        app.clone(),
        host_id.clone(),
        "nproc 2>/dev/null || echo 1".to_string(),
    )
    .await
    .unwrap_or_default()
    .parse::<u32>()
    .unwrap_or(1);

    // CPU 使用率（采样 1 秒）
    let cpu_usage = ssh_exec(
        app.clone(),
        host_id.clone(),
        r#"top -bn1 2>/dev/null | grep 'Cpu(s)' | awk '{print $2}' | head -1 || echo 0"#.to_string(),
    )
    .await
    .unwrap_or_default()
    .trim()
    .parse::<f64>()
    .unwrap_or(0.0);

    // 内存信息
    let mem_info = ssh_exec(
        app.clone(),
        host_id.clone(),
        "free -b 2>/dev/null | grep Mem".to_string(),
    )
    .await
    .unwrap_or_default();

    let (mem_total, mem_used, mem_usage) = parse_mem_info(&mem_info);

    // Swap 信息
    let swap_info = ssh_exec(
        app.clone(),
        host_id.clone(),
        "free -b 2>/dev/null | grep Swap".to_string(),
    )
    .await
    .unwrap_or_default();

    let (swap_total, swap_used, _) = parse_mem_info(&swap_info);

    // 磁盘信息
    let disk_info = ssh_exec(
        app.clone(),
        host_id.clone(),
        "df -B1 / 2>/dev/null | tail -1".to_string(),
    )
    .await
    .unwrap_or_default();

    let (disk_total, disk_used, disk_usage) = parse_disk_info(&disk_info);

    // 负载均衡
    let load = ssh_exec(app.clone(), host_id.clone(), "cat /proc/loadavg".to_string())
        .await
        .unwrap_or_default();

    let load_avg = parse_loadavg(&load);

    // 网络流量
    let net_info = ssh_exec(
        app.clone(),
        host_id.clone(),
        "cat /proc/net/dev 2>/dev/null | grep -v lo | tail -1".to_string(),
    )
    .await
    .unwrap_or_default();

    let (network_rx, network_tx) = parse_net_info(&net_info);

    // 进程数
    let processes = ssh_exec(
        app.clone(),
        host_id.clone(),
        "ps aux 2>/dev/null | wc -l".to_string(),
    )
    .await
    .unwrap_or_default()
    .trim()
    .parse::<u32>()
    .unwrap_or(0);

    // IP 地址
    let ip_address = ssh_exec(
        app.clone(),
        host_id.clone(),
        "hostname -I 2>/dev/null | awk '{print $1}' || echo unknown".to_string(),
    )
    .await
    .unwrap_or_default();

    Ok(SystemInfo {
        hostname,
        os,
        kernel,
        uptime,
        cpu_model,
        cpu_cores,
        cpu_usage,
        mem_total,
        mem_used,
        mem_usage,
        disk_total,
        disk_used,
        disk_usage,
        swap_total,
        swap_used,
        load_avg,
        network_rx,
        network_tx,
        processes,
        ip_address,
        arch,
    })
}

/// 获取所有已连接主机的状态
#[tauri::command]
pub async fn ssh_all_status(app: AppHandle) -> Result<Vec<HostStatus>, String> {
    let manager = app.state::<SshManager>();
    let conns = manager.connections.lock().await;
    let hosts = manager.hosts.lock().await;

    let mut statuses = Vec::new();

    for host in hosts.iter() {
        let connected = conns.contains_key(&host.id);
        statuses.push(HostStatus {
            id: host.id.clone(),
            connected,
            last_seen: None,
            last_error: None,
            system_info: None,
        });
    }

    Ok(statuses)
}

// ============================================================
// 辅助解析函数
// ============================================================

fn parse_mem_info(info: &str) -> (u64, u64, f64) {
    let parts: Vec<&str> = info.split_whitespace().collect();
    if parts.len() >= 3 {
        let total = parts[1].parse::<u64>().unwrap_or(0);
        let used = parts[2].parse::<u64>().unwrap_or(0);
        let usage = if total > 0 {
            (used as f64 / total as f64) * 100.0
        } else {
            0.0
        };
        (total, used, usage)
    } else {
        (0, 0, 0.0)
    }
}

fn parse_disk_info(info: &str) -> (u64, u64, f64) {
    let parts: Vec<&str> = info.split_whitespace().collect();
    if parts.len() >= 4 {
        let total = parts[1].parse::<u64>().unwrap_or(0);
        let used = parts[2].parse::<u64>().unwrap_or(0);
        let usage = if total > 0 {
            (used as f64 / total as f64) * 100.0
        } else {
            0.0
        };
        (total, used, usage)
    } else {
        (0, 0, 0.0)
    }
}

fn parse_loadavg(info: &str) -> [f64; 3] {
    let parts: Vec<&str> = info.split_whitespace().collect();
    let mut result = [0.0; 3];
    for i in 0..3.min(parts.len()) {
        result[i] = parts[i].parse::<f64>().unwrap_or(0.0);
    }
    result
}

fn parse_net_info(info: &str) -> (u64, u64) {
    let parts: Vec<&str> = info.split_whitespace().collect();
    // 格式: iface: rx_bytes rx_packets ... tx_bytes tx_packets ...
    if parts.len() >= 10 {
        let rx = parts[1].parse::<u64>().unwrap_or(0);
        let tx = parts[9].parse::<u64>().unwrap_or(0);
        (rx, tx)
    } else {
        (0, 0)
    }
}
