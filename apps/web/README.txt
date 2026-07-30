CodeWork（多用户远程开发平台）
================================
这台电脑 = 网关/服务器。用户从任意设备打开公网地址登录使用，
每人拥有独立的工作区（工作目录/上传/交付物/任务列表互相隔离）。

入口
  本机:   http://127.0.0.1:18790
  公网:   http://8.148.237.155:18790   (经阿里云 frp 映射)

账号
  初始管理员: admin / codework2026   ← 请尽快改密码
  改密码:     编辑 D:\KIMI\work-users\users.json（pass 为 sha256 十六进制）
  添加用户:   admin 登录 → 右上角齿轮 → 底部"添加/重置用户"
  测试账号:   test1 / test1234（不需要可在 users.json 删除）

用户数据（按用户名隔离）
  D:\KIMI\work-users\<用户名>\projects\     工作目录（代码项目）
  D:\KIMI\work-users\<用户名>\uploads\      上传文件（输入框 📎）
  D:\KIMI\work-users\<用户名>\deliverables\ 交付物（右侧面板）
  D:\KIMI\work-users\<用户名>\memory\       AI 长期记忆（INDEX.md 索引 + 记忆文件）
  记忆机制: 提示词只带一句使用说明，AI 需要回忆时才读索引和相关文件，
            学到重要信息自行写入——平时零 token 占用
  浏览器端任务列表/设置也按用户名隔离（localStorage 命名空间）
  注: 早期单用户数据已迁移到 admin 名下

组成
  index.html  单文件前端（白色 macOS 风格），改完刷新即生效
  server.js   纯 Node 标准库，端口 18790：静态页 + 登录/用户管理 +
              上传(/api/upload) + 交付物(/api/files, /files/*) +
              用量统计(/api/usage)，全部按用户隔离
              登录成功自动下发网关地址和 token，用户无需手动配置
              开机自启: 启动文件夹 shasha-work-ui.vbs

功能
  三种模式: ＋新任务(干活) / 💬闲聊 / 🧬自迭代(改本系统源码)
  运行中插话: 任务运行时发消息会排队，当前轮结束后自动接上
  🧠 记忆查看器: 顶栏 🧠 查看 AI 长期记忆文件
  📊 用量统计: 顶栏 📊 弹窗分两区
    ① 订阅限额: /api/quota → 运行 quota.py, 从网关凭据库
       (state\agents\main\agent\openclaw-agent.sqlite 的 auth_profile_store 表)
       读 OAuth token, 经代理 127.0.0.1:7890 实时查询官方接口——
       Claude: api.anthropic.com/api/oauth/usage (5小时/7天窗口利用率)
       Codex:  chatgpt.com/backend-api/wham/usage (窗口利用率+套餐类型)
       与 CLI /usage 命令同源的真实数据; Kimi 无公开配额接口故只显示说明
    ② Token 流水: /api/usage 解析网关会话日志
       (state\agents\main\sessions\*.jsonl, 排除 *.trajectory.jsonl 防重复),
       按模型聚合 input/output/cacheRead/cacheWrite/totalTokens + 近 14 天柱状
  📁 项目模式(流水线): 侧栏"＋新项目"填名称+目标 → AI 自动拆解(规划器会话
    planner-*, 输出严格 JSON 3~8 步并为每步配模型, 已实测) → 总览可手动
    增删改步骤 → ▶连跑: 顺序执行, 每步独立对话+指定模型, 前序步骤摘要自动
    衔接; 出错停在该步红字写明原因, 进对话插话调试(成功自动转绿)、单步重跑
    或断点续跑; 代码统一放 工作目录\<项目名>\;
    数据存 localStorage shasha.work.projects
    (steps: {id,title,prompt,model,status,taskId,error})

后端
  OpenClaw Gateway  ws://127.0.0.1:18789 (公网 8.148.237.155:18789)
  聊天协议: WS connect(role operator) -> chat.send -> 流式 delta -> chat:final
  会话 key 带用户名前缀: work-<用户名>-<id>

模型（16 个，全部通过真实对话实测，顶栏下拉切换）
  Kimi:   kimi-for-coding(主脑) / kimi-for-coding-highspeed / k3
  Claude: sonnet-5 / opus-4-8 / opus-4-7 / sonnet-4-6 / opus-4-6 / haiku-4-5
  GPT:    gpt-5.6-sol(旗舰) / gpt-5.6-terra / gpt-5.6-luna / gpt-5.5 / gpt-5.4-codex / gpt-5.4 / gpt-5.4-mini
  Claude/GPT 走订阅 OAuth + 美国 VPS 代理(127.0.0.1:7890)，Kimi 直连
  每个模型支持不同的思考档位(thinkingLevel)，前端已按实测结果显示
  已排除: claude-fable-5(持续限流) / claude 4.5·4.1 家族(订阅不含, 401) / gpt-5.3-codex(上游下线)

运维
  看门狗 watchdog\watchdog.ps1 每分钟巡检 gateway / work-ui / frpc / 代理隧道,
  并将所有 node.exe 优先级压为 BelowNormal(RustDesk 远程保护: AI 满负载时
  远程桌面仍优先抢 CPU, 2026-07-22 实测自动生效)
  重启 UI 服务: powershell -File D:\KIMI\work-ui\restart-server.ps1
  重启网关:    powershell -File D:\KIMI\work-ui\restart-gateway.ps1

自迭代（AI 改 AI）
  侧栏"🧬 迭代本系统"→ 输入改进需求 → Agent 直接改本系统源码
  规则: 改前先备份 .bak-时间戳、改后验证语法和 HTTP 200、
        记录到 ITERATION_LOG.md、只许用 restart-*.ps1 重启服务

已知限制
  公网为 HTTP 明文传输（密码 hash 后存储，但传输过程不加密），
  不要复用重要密码；后续可上 HTTPS（域名 + Caddy/frp tls）。

── CodeWork 2.0 独立站点（2026-07-23 新增）──────────────────
  目录: D:\KIMI\codework2-site\   （源自 work-users\admin\projects\CodeWork 2.0 的部署副本，互不影响）
  本机: https://127.0.0.1:18792   （2026-07-23 起改为 HTTPS 自签名，浏览器点"继续"）
  HTTP 入口: http://127.0.0.1:18793 会 301 跳 HTTPS
  公网: https://8.148.237.155:18792   （frp 映射 codework2，需访问密钥）
  访问密钥: 通过 BOREALOS_CW2_KEY 环境变量配置（不要写入仓库）
  启动: 开机自启 Startup\codework2-site.vbs （启动 ui\https-server.js，不是旧的 ui\server.js）
  重启: powershell -File D:\KIMI\codework2-site\restart-server.ps1
        （自检返回 401 属正常 = 服务在跑且密码门生效）
  注意: 项目原目录是"开发副本"，codework2-site 是"线上副本"，改了代码要同步两边

── 工程模块（2026-07-23 新增）──────────────────────────────
  1.0 侧边栏"🛠 工程模块"按钮内嵌 2.0 看板（iframe 指向 https://主机:18792），
  一个入口同时使用两代；若 iframe 里出现 2.0 密钥页，输入一次密钥即可。

── 自动路由 + 工程任务卡片（2026-07-23 深夜新增）────────────────
  输入框说话自动分流：Kimi 高速先判断意图（带最近对话上下文，30s 兜底），
  干活 → 派给 2.0 工程引擎（/api/eng/dispatch，密钥只存服务端），
  闲聊 → 正常陪聊，拿不准 → 先聊并留"一键转工程"按钮。
  工程对话里追问会重新路由，续作自动沿用原工作目录（改之前的产出）。
  派发后对话里留任务卡片，每 15 秒轮询状态，完成自动写回 AI 总结。
  2.0 侧新增 /api/plan/adhoc：任务进 PLAN.md"💬 用户需求"阶段，
  引擎空闲立即跑，忙时排队自动接；adhoc 任务豁免框架测试套件。
  注意：2.0 线上跑的是 ui\https-server.js（不是 ui\server.js），
  改 2.0 后端两个文件要同步（adhoc 代码两边都有）。

── 1.0 上 HTTPS（2026-07-23 深夜）──────────────────────────────
  18790 已改 HTTPS（复用 2.0 自签名证书），18791 为 HTTP→HTTPS 跳转陪跑。
  公网: https://8.148.237.155:18790   （旧 http 收藏请改用 18791 跳转）
  浏览器有自签名证书警告，点"继续"即可。
  frp 新增 work-ui-http-redirect 映射（18791）。

── 矢量工坊（2026-07-23 新增，第一个"工具"板块）────────────────
  位图(PNG/JPG/WEBP/BMP/GIF) → 真矢量 SVG，本机 vtracer 引擎（pip 版），
  免费无限次、图片不出本机；流程步骤化显示（上传→校验→AI生成路径→完成）。
  目录: D:\KIMI\vector-site\（app.py + restart.ps1）
  本机: https://127.0.0.1:18795   公网: https://8.148.237.155:18795
  访问密钥: vec-8f2a1c9d4e7b3a（首次带 ?key= 后 cookie 记 180 天）
  1.0 侧边栏 → 工具 → 🧭 矢量工坊（iframe embed 无壳模式，密钥已带在网址里）
  重启: powershell -File D:\KIMI\vector-site\restart.ps1
  frp 映射名: vector-site（18795）；HTTPS 复用 2.0 自签名证书

── 对话里发图转矢量（2026-07-23 新增）──────────────────────────
  1.0 对话框 📎 附图片 + 文字带"矢量/SVG/vector"（说"黑白/剪影"自动切单色），
  自动派给矢量工坊：结果卡片显示步骤耗时/路径数/预览，可下载/复制/跳转模块。
  多张图一次多卡。大 SVG(>400KB) 不存对话，走 /api/vector/file 代理取回。
  安全：/api/vector/convert 只允许转换 work-users 下已上传文件（越界 403）。

── 矢量工坊同源内置（2026-07-23 晚，修"模块白屏没反应"）─────────
  病因：iframe 直连 18795 自签名证书未被浏览器单独信任 → 静默白屏。
  根治：矢量工坊改为 /vector/ 同源代理（server.js 注入密钥，页面全部相对路径），
  iframe 走同端口同证书同登录态，浏览器零额外操作。
  注意：2.0 各板块 iframe 仍直连 18792，若白屏，先手动开一次
  https://8.148.237.155:18792 点"继续"信任证书即可（每浏览器一次）。

── 矢量工坊双引擎（2026-07-23 晚）───────────────────────────
  引擎下拉：本机 vtracer（默认，免费无限）/ Vectorizer.ai（高质量）。
  Vectorizer.ai 未实测（无 key）：key 填 D:\KIMI\vector-site\config.json
  {"vectorizer_key":"...","vectorizer_secret":"..."} 后重启即可用，
  走其官方 API POST /api/v1/vectorize（Basic Auth，output.file_format=svg）。

── WSS 隧道 + 真假 token 双 bug 修复（2026-07-23 深夜）─────────
  大坑1: GATEWAY_TOKEN 曾存成打码假值"7fb3d3…44a2"，登录下发的token一直是错的。
  大坑2: 1.0 升 HTTPS 后浏览器禁连明文 ws://18789 → 网关全断("地址无效")。
  修复: server.js 加 WS 隧道(wss://本端口/gateway → 本地 18789 TCP转发)，
  登录和 /api/gateway-config 动态下发同源 wss 地址；前端 ensureGatewayConfig
  每次启动对账(缺补/错纠)。已验证公网握手 101 + connect.challenge 正常。

── 补回「＋ 新项目」入口（2026-07-23 深夜）────────────────────
  项目引擎（AI拆解/流水线/总览）一直在，创建按钮此前被误删。
  侧边栏「🗂 ＋ 新项目」→ 填名+目标 → 自动 AI 拆解步骤并分配模型。

── 美国VPS重装恢复（2026-07-24 凌晨）─────────────────────────
  VPS被重装(指纹变/秘钥失效/PubkeyAuthentication no)。已修：
  清旧指纹、开公钥登录、新 ed25519 密钥(~/.ssh/vps_ed25519)双保险、
  start-tunnel.cmd 改用新密钥、7890 代理恢复(出口=192.220.44.206)。
  RustDesk 服务器新公钥: LyeXctQwQG3UiP1aVKnWonDzH4GmtQsLbkXrUoc+MmA=
  本机 RustDesk2.toml 已更新并重启；Mac/其他控制端也要改同一个 key！

── 高质量引擎改接 etoolbox（2026-07-24 凌晨）───────────────────
  矢量工坊"高质量引擎"改接 https://vectorizer-api.etoolbox.cn（x-api-key 认证）。
  Key 填 D:\KIMI\vector-site\config.json {"vectorizer_key":"..."}（不再需要 secret）。
  面板新增"绘制样式(fill/stroke/strokeEdges)""拟合精度(0.3/0.1/0.03/0.01)"，
  选中高质量引擎时自动显示剩余额度(走 /credit 代理 → /v1/credit)。
  像素上限 3,145,728，超限自动压缩；180s 超时；额度/充值接口文档在会话附件。
  2026-07-24 02:40 key 已配好并实测：首次高质量转换 200（4.3s），额度 50→49。
