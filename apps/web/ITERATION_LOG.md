# CodeWork 迭代日志

## 2026-07-22 09:16 - 白色主题添加流畅动画效果（增强版）

**需求**: 在保持现有白色 macOS 风格的基础上，为 UI 添加流畅动画效果

**改动文件**:
- `D:\KIMI\work-ui\index.html` - 添加/增强 CSS 动画和过渡效果

**具体改动**:
1. **定义全局弹性缓动变量** - `:root` 新增 `--ease-bounce: cubic-bezier(.34,1.56,.64,1)`
2. **body 页面淡入** - `fadeInBody` 动画增强为 0.6s ease forwards
3. **brand-logo 呼吸动画** - `breathe` 动画增强，scale 1→1.06 配合粉色光晕，添加 `will-change`
4. **登录 logo 呼吸动画** - 同步添加 `breathe` 动画
5. **按钮悬停微动效**（全部使用 `--ease-bounce`）:
   - `#new-task-btn` - hover 时 translateX(4px) scale(1.02)
   - `#selfdev-btn` / `#chatmode-btn` - hover 时 translateX(3px)
   - `#model-btn` - hover 时 scale(1.03)
   - `.icon-btn` - hover 时 scale(1.12) rotate(5deg)
   - `#send-btn` - hover 时 scale(1.12) rotate(-5deg) + 粉色阴影
   - `#stop-btn` - hover 时 scale(1.1)
   - `.btn-primary` / `.btn-ghost` / `.btn` - hover 时 translateY(-1px) scale(1.02)，active 时 scale(.98)
   - `#clear-tasks-btn` - hover 时 translateX(3px)
   - `#attach-btn` - hover 时 scale(1.15) rotate(-10deg)
   - `#logout-btn` - hover 时 scale(1.1)
   - `#user-bar .uavatar` - hover 时 scale(1.15) rotate(5deg)
6. **任务项滑入动画** - `slideIn` 动画保留，stagger 延迟 0.02s~0.20s
7. **消息气泡弹出** - `msgPop` 动画增强为 0.45s 弹性缓动
8. **计划卡片显现** - `cardReveal` 动画增强，从 translateY(20px) scale(.96) 弹出
9. **输入框聚焦展开** - focus-within 时边框变色 + 光晕阴影 + translateY(-1px) scale(1.01)
10. **模态框缩放** - 重写为 opacity 过渡 + `modalCardPop` 弹性动画（0.4s）
    - `#settings-modal`, `#memory-modal`, `#usage-modal` 均支持
11. **登录卡片滑入** - `loginSlide` 动画增强，从 translateY(40px) scale(.95) 滑入
12. **文件项悬停** - translateX(4px) 滑动效果
13. **建议芯片弹出** - 新增 `chipPop` 动画，从 scale(.7) 弹性弹出
14. **模型菜单项悬停** - translateX(4px) 滑动效果
15. **速度切换按钮悬停** - scale(1.08) 效果
16. **输入框聚焦** - scale(1.01) 微放大效果

**验证结果**:
- ✅ JS 语法校验通过 (node --check)
- ✅ HTTP 200 验证通过 (http://127.0.0.1:18790/)

**备份文件**: `D:\KIMI\work-ui\index.html.bak-20260722-0847`

---

## 2026-07-22 08:47 - 深色主题升级（已回滚）

**需求**: 将 UI 改为深色主题风格

**改动文件**:
- `D:\KIMI\work-ui\index.html`

**回滚原因**: 用户要求保持白色 macOS 风格，改为添加动画效果

**备份文件**: `D:\KIMI\work-ui\index.html.bak-20260722-0847`

---

## 2026-07-25 - Nexa v5.0（内测）：品牌升级 + PWA + 全端响应式 + 动画系统

**需求**: CodeWork 4.0 → Nexa v5.0（内测）。只改 index.html，不重启服务器。

**改动文件**: 仅 D:\KIMI\work-ui\index.html（备份 index.html.bak-v50）

### 1. 品牌替换
- title / 侧栏品牌区 / 登录页 / topbar 标题后缀 / 系统提示词字符串 / iframe title 全部 CodeWork → Nexa，v4.0 → v5.0（内测）
- `</>` 字符 logo 全部换成纯 SVG「N」标识（侧栏、登录卡、聊天助手头像）
- `/2.0/` 代理路径与 ENG_* JS 常量未动

### 2. PWA 挂载
- head 加 manifest / theme-color #f5f5f7 / 苹果三件套；body 末尾注册 /sw.js（404 静默忽略）

### 3. 全端响应式（v5 CSS 独立 <style> 块，规避旧块历史残留乱码括号）
- viewport 加 viewport-fit=cover；四档断点：
  - <768px：侧栏改 fixed 抽屉（#nav-burger + #nav-scrim），新增底部 Tab 栏 #mobile-tabbar（对话/工程/画室/视频/更多，JS 代理 click 到原 .eng-nav-item），灵动岛收窄 min(284px,56vw)，输入区贴底 + env(safe-area-inset-*)，所有 .modal-card 全屏化（100dvh、圆角 0），网格 minmax 收窄，overflow-x 治理
  - 768–1366px：侧栏收窄 240px + 汉堡折叠（body.sb-collapsed），≤1200px 隐藏交付物面板（适配小米平板 1067 逻辑宽）
  - 1366–2560px：保持原布局
  - >2560px：#app max-width 2600px 居中，字阶/间距用 clamp() 放大，chat/input max-width 1100px
- 触摸目标 ≥44px；hover 位移/阴影包进 @media (hover:none) 反置

### 4. 动画系统
- 启动 splash（#nexa-splash：N logo 呼吸 + shimmer 进度条，load 后 0.4s 淡出移除，4s 兜底）
- 登录卡：spring 弹入 nxLoginIn / 错误抖动 nxShake（MutationObserver 零侵入）/ 注册切换交叉淡换 / 成功 bye 收缩淡出（sessionStorage nexa.enter 标记 → 刷新后主界面 scale 0.96 展开 + 模块 stagger）
- 视图切换 fade+slide（display 切换自动重播 nxViewIn）；模态 spring nxModalIn；按钮 active scale .97
- 加载态：11 处「加载中…」换成三点跳动 nx-dots；聊天等首 token 三点脉冲（.md.cursor-blink:empty::before）；.qbar/#isl-live-fill 进度条 shimmer
- 全部动画包 @media (prefers-reduced-motion: no-preference)；reduce 时 animation/transition 全关且卡片终态 opacity 1 不依赖 fill（headless/冻结时钟也可靠）

### 5. 登录强制
- #login-overlay z-index 提至 5000（仅 splash 9999 在上），未登录主界面不可见不可点；localStorage 保持登录、退出登录保留

### 顺手修复的存量 bug
- showEngView else 分支（工程类视图）漏隐藏 ip-view/video-studio-view/svgview/vector-wizard → 视图堆叠；并在函数顶部统一隐藏 video-studio-view 与 vector-wizard，覆盖所有直连跳转组合

### 验证（Edge headless + CDP，脚本 D:\KIMI\cdp-v5-test.py）
- 5 视口（375×812 DPR3 / 1067×712 DPR3 / 820×1180 / 1440×900 / 3840×2160）：console 错误全 0、无横向溢出、截图 D:\KIMI\shots\v5-*.png
- 真实表单登录 admin → 主界面 → 点画室/视频工坊/仪表盘视图切换成功、灵动岛可见、手机 Tab 栏代理点击+抽屉正常
- id 自检：0 个丢失，仅新增 4 个（nexa-splash/nav-burger/nav-scrim/mobile-tabbar，均在大 script 之前）
- node --check 两个内联脚本均通过

### 注意（遗留）
- 生产代理的 /sw.js 以 cache-first 预缓存「/」（CACHE=nexa-v5.0.0）：本次升级后**已注册过 SW 的客户端可能仍看到旧壳**，需在代理侧 bump CACHE 版本号或让用户清一次站点数据。测试前需 unregister SW + 清 CacheStorage（测试脚本已内置）。
- 工程 iframe 内的「CodeWork v2.0.0」字样来自后端 site/ 内容，不在本次范围。
- headless Edge 默认 prefers-reduced-motion: reduce 且与 metrics override 叠加会冻结动画时钟，属测试环境假象；真实浏览器动画完整（已用 CDP 强制 no-preference 验证动画跑完 550ms 终态正常）。


---

## 2026-07-27 01:40 - Borealos 大升级：画风分类 / 视频模板 / 电商视频 / 亚马逊广告 / 额度修复 / 任务常驻 / 数据清理

**备份**: `D:\KIMI\backups\upgrade-20260727-010034\`（server.js/index.html/quota.py 改前）、`D:\KIMI\backups\cleanup-20260727-013246\`（整个 work-users + work-ui 零散文件 + 嵌套遗留 work-ui\work-users 142M）

### A. AI 生图「画风分类」（server.js + index.html）
- server.js 新增常量 `GEN_STYLES`（二次元/真人/游戏人物/写景/Q宠，各配英文质量+风格 prompt 后缀，可扩展），`genStyleSuffix()` 拼入最终 prompt
- 新 API：`GET /api/image/styles`（前端胶囊数据源）
- `/api/image/generate`、`/api/ip/gen-image` 新增 `genStyle` 参数
- 前端：AI 画室单张创作 + IP 工坊向导第 1 步各加「画风」胶囊选择器（`.cap-seg`，默认/五种画风，非下拉）

### B. 视频模块四个内置模板
- server.js 新增常量 `VIDEO_TEMPLATES`（二次元/游戏 × 跳舞/小剧情，内置优化英文 prompt：跳舞=动作流畅+镜头稳定，小剧情=三拍分镜）
- 新 API：`GET /api/video/templates`；`/api/video/generate` 支持 `templateId` 透传（任务 JSON 可见）
- 前端：AI 视频工坊新增「模板」tab——模板卡片选择、人物来源（上传图片 / 复用作品库选择器 vs-lib，新增 tpl 槽位）、prompt 可编辑、走 qwen i2v（wan2.6-i2v）、进行中任务进度条（#vtpl-tasks，8s 轮询），完成进视频历史可播放

### C. 电商视频生成
- 新 API：`POST /api/ecom/video/analyze`（tokenPlan qwen3.8-max-preview 结构分析：链接抓标题/描述 + 用户补充描述 → 分镜/节奏/运镜/文案/卖点/videoPrompt JSON，落盘 shops/_video_analyses.json）、`GET /api/ecom/video/analyses`、`POST /api/ecom/video/generate`（产品图首帧 qwen i2v，prompt 强制"产品保持原样"）
- server.js 新增 `ANALYSIS_PROVIDER` 常量 + `tokenPlanChat()`（OpenAI 兼容 chat/completions）
- 前端：AI 画室新增「电商视频」tab，分步 UI：上传/链接+描述 → 分析（spinner）→ 确认脚本（可编辑）→ 上传产品图+生成（呼吸点+计时）→ 结果播放，历史分析可重载

### D. 亚马逊广告分析（新模块）
- 新 API：`POST /api/amazon/analyze`（X-File-Name 直传 csv/xlsx 限 30MB → `scripts/parse_ads.py`（pandas/openpyxl）解析汇总曝光/点击/CTR/花费/ACOS/ROAS/订单，按 campaign/keyword 维度 → tokenPlanChat 出诊断报告，落盘 amazon-reports/）、`GET /api/amazon/reports`、`GET /api/amazon/report?id=`
- 前端：侧栏新增「亚马逊广告」视图（amazon-view）——上传区、加载动画、总览指标卡、campaign 表、问题清单（高/中/低严重度色条）、优化动作三列（立即做/本周做/持续做）、历史报告回看

### E. Claude 额度修复（quota.py）
- 优先读 `C:\Users\Gateway\.claude\.credentials.json`（claudeAiOauth），过期则 POST `https://console.anthropic.com/v1/oauth/token` 刷新（直连失败走代理 127.0.0.1:7890），成功后备份 .bak 并原子写回；再调 usage（直连→代理）
- 实测：refresh_token 已被服务端拒（HTTP 403）→ 报错文案引导「重新登录 Claude CLI」，不拖垮 Codex/Kimi 两家（两家正常返回真实窗口数据）

### F. 任务常驻
- server.js：`loadVideoTasks` 重启后自动恢复 running/pending 视频任务（有 externalId 续轮询不重复提交，无则重走完整流程；videoResumeSet 防重入）；`runVideoGeneration` 跳过已提交任务的重复 submit
- 验证：注入 running 任务 → 重启 → 日志「服务重启，恢复任务（续轮询）」、任务列表原样回来
- 表情包/动图等 jobStore 模块原有「重启标记中断可重试」机制保持不变；eng tasks 由 2.0 引擎（18792）自行持久化，不在本服务范围
- 前端各模块列表沿用 nxSkel 骨架，新模块列表同样带骨架/加载态

### G. 清除测试数据
- 清空 video-tasks/anim-tasks/anim-batch-tasks/sticker-tasks 全部 json；清 admin/uploads 测试图、images 测试生成图、shops 测试分析、amazon-reports 测试报告
- work-ui 根目录 23 个开发垃圾文件 + 嵌套遗留 work-ui\work-users（142M）移入 cleanup 备份
- 保留：server.js/index.html/imagegen.js/quota.py/site/vendor/icons/manifest/favicon/README/ITERATION_LOG/重启脚本/scripts/客户端安装包；users.json、video-config.json、codework.db（4 条均为用户设置非测试数据）未动
- 重启验证：10 个模块历史列表全部为空且 HTTP 200

### 顺手修复
- `showToast` 在 index.html 中被多处调用但从未定义（删视频等操作必抛 ReferenceError）→ 新 script 中兜底实现 #nx-toast

### 验证
- `node -c server.js` 通过；内联 JS 全量语法校验通过（block0 为 HTML 注释内脚本的历史误报，改前已存在）
- 真测（烧额度）：/api/ip/gen-image 带 genStyle=qpet 出图成功（万相免费通道）；/api/amazon/analyze 全链路（解析+LLM 诊断，158s）；/api/ecom/video/analyze 全链路（24s，中文落盘正常）
- 未真测：视频生成（成本高）——链路以缺参/路由验证，模板与电商视频均走现有已验证的 qwen i2v 任务流
- Edge CDP（9318）：首页/画室/电商视频/模板/亚马逊五页 console 0 错误，截图 D:\KIMI\shots\v6-*.png，无乱码、视图切换无堆叠

### 遗留
- DeepSeek key 缺失：分析通道 ANALYSIS_PROVIDER 默认 tokenPlan qwen3.8-max-preview，拿到 key 后改常量即可
- seedance key 为空：通道代码保留，前端切 Seedance 会提示配置 key
- Claude refresh_token 失效：需用户在终端运行 claude 重新登录 CLI，之后 quota.py 自动刷新即可生效
- 亚马逊 LLM 诊断约 2-3 分钟（qwen3.8-max-preview + 2600 tokens），超时已放宽至 280s

## 2026-07-27 03:50 - 第二轮大升级：参考视频制作 + 图片 i2i/四模板 + 亚马逊全报告类型

**需求**: ① 参考视频制作（上传参考视频→抽帧→AI 分镜→参考图逐段重拍→ffmpeg 合成）；② 图片 i2i（参考图创作）+ 四个一键模板（抠图/换装/二次元/表情包）；③ 亚马逊报告识别扩展到全类型并按类型定制 LLM 诊断

**环境基建**:
- ffmpeg：BtbN GitHub  release（经代理）→ `D:\KIMI\ffmpeg\ffmpeg.exe + ffprobe.exe`（n7.1.5）
- rembg 2.0.77 + onnxruntime 1.28.0 + xlrd 2.0.2 装入托管 python；onnxruntime DLL 加载失败 → 应用本地修复：vcruntime140/140_1（daimon cpython-3.12）、msvcp140/concrt140/codecvt_ids（Edge 150 目录）、msvcp140_1（OneDrive 26.123 目录）拷入 `.venv\Lib\site-packages\onnxruntime\capi\`
- 新脚本：`scripts/cutout.py`（u2net 抠图，模型 176M 已缓存 ~/.u2net）、`scripts/make_refsheet.py`（人物+素材横排拼图）、`scripts/parse_ads.py` v2（14 种报告类型签名 + 中英列映射 + groups 分组聚合）

**后端（patch_server2.py + patch_server2b.py）**:
- 顶层：FFMPEG/FFPROBE 常量、runFf、ffprobeVideo、resolveUserImage（uploads 绝对路径自动拷入 images）、wanImageI2i（万相多模态带图，免费通道）、genImageI2i（万相失败回退 codex）、waitVideoTask
- refvid 引擎：jobStore("refvid") + 五步状态机（probe/keyframes/storyboard/generate/compose），LLM 分镜（tokenPlan 千问）失败退朴素均分，每步幂等断点续跑，重启自动恢复；skipGenerate 占位模式（关键帧循环出 mp4）不烧视频额度；合成先逐段规范 1280x720@30 再 concat
- 接口：/api/image/i2i、/api/image/cutout、/api/image/outfit（refsheet 拼图+换装 prompt）、/api/image/anime、/api/refvid/analyze|start|status|list、/api/eng/refvid；sticker/start 改走 resolveUserImage（支持 uploads 路径）
- 亚马逊：支持 .xls，TYPE_GUIDE 按 reportType 定制 LLM 指令，record 带 reportType/Name，reports 列表/详情返回 reportTypeName

**前端（patch_frontend2.py + patch_frontend2b.py）**:
- 视频工坊第 5 个 tab「参考视频」：上传视频→解析（关键帧条+可编辑分镜）→选参考图（上传/作品库）→开始重拍→4s 轮询步骤条+分段状态+成片播放器+历史任务
- AI 画室 +2 tab：「参考图」（上传+prompt+强度 seg+画风胶囊+生成）与「模板」（抠图/换装/二次元/表情包四卡片，换装支持人物+1~3 素材+补充要求；表情包卡一键起任务并跳转表情包页看进度）
- 亚马逊：reportTypeName 徽标、动态分组表（列按数据自动裁剪，campaigns 与 groups 相同则去重）、.xls 入口放开
- vsShowPicked ids map + ref 组；vsHandleFile 移除按钮改用 `"vs-file-"+key` 通用化；initGenStyles 覆盖 refimg-genstyle-seg

**验证**:
- `node -c server.js` 通过；9 个新接口缺参/空列表验证全对
- 真测：cutout（rembg 本地，透明 PNG ✅）；i2i（万相 wan2.7-image 多模态**真支持带图**，5s 出图，主体保持+星空背景替换成功 ✅，未走 codex 兜底）；refvid 全链路（12s 测试视频→analyze 25.7s 三步全绿 LLM 分镜 3 段→skipGenerate 合成 1280x720/12s mp4 ✅，关键帧 URL 200）；亚马逊预算样例 CSV 全链路（识别预算报告、budgetUtil 分组、LLM 按预算模板诊断 7 issues ✅，~2.9min）
- CDP（9318）：vref/refimg/imgtpl/amazon 四页 console 0 错误，截图 D:\KIMI\shots\v7-*.png

**遗留**:
- refvid 真生成路径（非 skipGenerate，qwen wan2.6-i2v 逐段）未烧额度未实测，链路按设计就绪
- rembg 冷导入约 70s（numba 预热），首次抠图较慢；后续进程内复用
- 亚马逊 LLM 诊断输出偶发 \uFFFD 替换字符（模型输出层，非 UI 编码问题）
- 前端上传路径含反斜杠，curl 手测需正确转义 JSON（前端 fetch 无此问题）

## 2026-07-27 04:35 - 安卓客户端 v5.1.3：WebView 文件上传/下载 + 灵动岛改原生常驻通知

**需求**: 修复 APK（com.nexa.app）两大问题：① WebView 无 WebChromeClient，网页 `<input type="file">` 全部无响应（第二轮新功能均依赖上传）；② 灵动岛从 SYSTEM_ALERT_WINDOW 悬浮窗改为原生系统形态（小米澎湃 OS 焦点通知）

**改动文件（D:\KIMI\nexa-apk）**:
- `MainActivity.java`：新增 WebChromeClient.onShowFileChooser（ACTION_GET_CONTENT */* + EXTRA_MIME_TYPES 按 acceptTypes + EXTRA_ALLOW_MULTIPLE 按 MODE_OPEN_MULTIPLE；旧回调先 null 结束、ActivityNotFound 回退 false）；onActivityResult 处理 clipData 多选/单选/取消三分支，取消必回调 null 防 WebView 上传永久卡死；onRestoreInstanceState 与 onDestroy 均清理 ValueCallback；setDownloadListener（http(s) 走 DownloadManager 到公共 Download 目录带 Cookie/UA，data:/blob: toast 提示长按保存）；WebSettings 补 allowFileAccess/javaScriptCanOpenWindowsAutomatically；删除 showOverlayPermissionDialog 与 canDrawOverlays 检查，onResume 直接 startIslandService
- `IslandService.java`：整体重写——删除全部 WindowManager 悬浮窗 UI（胶囊/卡片/RingView/淡入淡出），保留轮询（/api/eng/tasks，15s）与网络层（自签放行/cookie）；前台服务 + 同一 id 常驻通知：IMPORTANCE_DEFAULT 静音渠道、setOngoing/setOnlyAlertOnce、有任务时 setProgress + CATEGORY_PROGRESS（如「2 个任务进行中 · 进度 1/3」）、无任务「Borealos 在线」、断线「网关离线」、未登录引导；点通知回 MainActivity，「打开主站」action 开浏览器；澎湃焦点通知 best-effort vendor extras（miui.focus.*，try/catch）；onDestroy 清理 handler/io/stopForeground
- `AndroidManifest.xml`：移除 SYSTEM_ALERT_WINDOW（保留 FOREGROUND_SERVICE/DATA_SYNC/POST_NOTIFICATIONS）
- `res/drawable/ic_stat_notify.xml`：新增白色剪影闪电矢量通知小图标
- `app/build.gradle`：versionCode 5 / versionName "5.1.3"

**部署**:
- 构建：`gradle assembleDebug --offline` BUILD SUCCESSFUL（0 error）；aapt 验证 versionCode=5 versionName=5.1.3，无 ALERT 权限
- `work-ui/Borealos-v5.1.3.apk`（55 KB）替换旧 v5.1.2；server.js client-latest android 条目改 5.1.3（note 提及原生焦点通知+上传修复）；site/index.html 安卓下载块链接/文案改 5.1.3（删悬浮窗引导，改通知权限说明）
- 服务端重启验证：/api/client-latest android=5.1.3 且 sha256 与新包一致（4c041df5…）；公网 https://borealos.dev/Borealos-v5.1.3.apk Range 请求 206、完整下载 200/55436B、旧包 404

**遗留（无法真机验证）**:
- 文件选择/多选/取消分支、DownloadManager 落盘、通知在澎湃 OS 的焦点通知收成效果，均需真机确认；逻辑已按分支全覆盖自查
- 万相/万网视频下载链接为 24h 临时 URL，DownloadManager 携带 Cookie 但部分场景仍需登录态，真机留意
- 本地直连 18790 的 Range 返回 200（服务端静态路由不支持 Range），公网经隧道/CDN 为 206，验收以公网为准
- UpdateChecker.java 未动，自动更新链路保持原样

## 2026-07-27 05:40 - 安卓客户端 v5.1.5：焦点通知官方配方 + 自适应轮询防发热 + 结果图预览/下载修复

**真机反馈四问题**: ①澎湃焦点通知没生效 ②通知不及时 ③二次元等结果图不能下载预览 ④发热发烫

**焦点通知配方（查实）**: 小米开放平台《HyperOS 岛通知开发指南》(dev.mi.com pId=2131)——客户端发原生通知 + extras["miui.focus.param"]=param_v2 JSON（protocol/business 运营场景/updatable 持续通知/ticker OS2 状态栏文案/aodTitle 息屏文案/baseInfo 焦点数据/param_island OS3 岛数据），自定义图片走 extras["miui.focus.pics"] Icon 包；另有权限查询 content://miui.statusbar.notification.public#canShowFocus 与协议版本 Settings.System notification_focus_protocol（本次未用查询，直接全量发参数由系统取舍）

**APK 改动（D:\KIMI\nexa-apk）**:
- `IslandService.java` v2：渠道换新 id `borealos_island_v2` 升 IMPORTANCE_HIGH 且 setSound(null)/setVibrationPattern(null) 全静默（旧 DEFAULT 渠道系统缓存不可改）；按官方配方构建 param_v2（business=task_progress、updatable=true、ticker/aodTitle=标题、baseInfo、param_island 含 bigIslandArea.imageTextInfoLeft + smallIslandArea.picInfo，附图 Icon 包），try/catch 包裹；自适应轮询：有任务 10s / 空闲 45s / 断线 60s 指数退避至 120s（恢复即重置）；动态注册 ACTION_SCREEN_ON/OFF（33+ 用 RECEIVER_NOT_EXPORTED），熄屏停轮询、亮屏立即补一次；onDestroy 注销接收器+清 handler+停 io+stopForeground；无 WakeLock，网络全在单线程 io 池
- `MainActivity.java`：首次启动弹一次「开启灵动岛」引导（SharedPreferences 标记）：①设置→通知与状态栏→焦点通知→允许 ②自启动管理允许 ③正按钮直接 ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS（失败回退列表页）
- `AndroidManifest.xml`：+REQUEST_IGNORE_BATTERY_OPTIMIZATIONS
- `app/build.gradle`：versionCode 7 / versionName 5.1.5（期间另有 5.1.4 更新检测修复由他人部署，本版直接替换）

**网页改动（patch_frontend3.py）**:
- 结果图（参考图 i2i/换装/抠图/二次元）：确认结果本就是服务器 URL（/image/xxx.png 落盘），新增 nxResultHtml——点图开画室灯箱看大图 + 显式「⬇ 下载图片」按钮（服务器 URL + download 属性，安卓 DownloadManager 接管）；动图历史预览 window.open(_blank) 改 nxOpenLightbox（WebView 忽略新窗口问题）；桌面端统一走灯箱不退化
- 防发热：nxNetWrap 轮询包装器——document.hidden 时跳过网络轮询、visibilitychange 回前台立即补一次；覆盖 stkFetchStatus×3(2.5s)、gwHealth、islPoll、refreshEngCards、refreshFiles、ipArtPoll、vrefPoll×2(4s)；vsPoll/evGenPoll 两个 setTimeout 轮询隐藏时降频到 30s

**验证**:
- 构建 BUILD SUCCESSFUL 0 error；aapt：versionCode=7 versionName=5.1.5 含 REQUEST_IGNORE_BATTERY_OPTIMIZATIONS 无 ALERT
- 部署：Borealos-v5.1.5.apk(58KB) 替换 5.1.4；server.js android 条目 5.1.5；site/index.html 下载块更新；重启后 /api/client-latest android=5.1.5 sha256 一致；公网 Range 206、旧包 404
- CDP(9318)：模板页注入 nxResultHtml → 下载锚点 href/download 正确、点图灯箱开（删除按钮隐藏）、nxNetPollers 注册、console 0 错误，截图 D:\KIMI\shots\v8-anime-result.png

**遗留（真机不可验）**:
- 焦点通知是否被澎湃收成焦点/超级岛，取决于系统版本（OS1/2/3 模板差异）与用户三项开关（焦点通知权限/自启动/电池无限制），参数已按官方全量下发由系统取舍
- 熄屏暂停+电池豁免后的实际刷新及时性、发热改善幅度需真机观察
- canShowFocus/notification_focus_protocol 查询接口未接（可直接弹精准引导），后续可按需补

## 2026-07-27 05:50 - 安卓拆分手机版/平板版：Gradle product flavors 双安装包

**需求**: 手机版（com.nexa.app）与平板版（Borealos Pad，com.nexa.pad）分开——单独安装包可同机共存、官网分开放；平板适配 7~14 英寸、1K~4K、横竖屏、全芯片

**APK 改动（D:\KIMI\nexa-apk，flavors 不复制项目）**:
- `app/build.gradle`：flavorDimensions "device" + phone（com.nexa.app，UPDATE_CHANNEL="android"）/ pad（com.nexa.pad，UPDATE_CHANNEL="android-tablet"）两 flavor，versionCode 7 / versionName 5.1.5 由 defaultConfig 继承；buildFeatures.buildConfig true
- 应用名资源化：manifest label 改 @string/app_name；main/res/values/strings.xml「Borealos」，src/pad/res/values/strings.xml「Borealos Pad」（flavor 专属 res）
- `UpdateChecker.java`：平台 key 由写死 "android" 改 BuildConfig.UPDATE_CHANNEL（其余不动）——pad 端自动更新查 android-tablet 条目
- `MainActivity.java`：WebSettings 加 useWideViewPort/loadWithOverviewMode/supportZoom(false)（1K~4K 各 dpi 按 CSS 像素排版）；UA 追加 ` Borealos/5.1.5 Phone|Pad`（BuildConfig 区分，网页可识别终端）
- `AndroidManifest.xml`：activity configChanges 补 screenLayout|smallestScreenSize；supports-screens 原本已全，screenOrientation fullSensor 保持
- IslandService/引导对话框/其余 Java 两 flavor 共用未改；APK 无原生库（纯 Java WebView 壳），ARM64 全芯片（骁龙/联发科/玄戒O1）天然通吃，无需 ABI 分包

**服务端与官网**:
- server.js client-latest files 新增 "android-tablet" 条目（file Borealos-pad-v5.1.5.apk，version 5.1.5，note 平板专属），android（手机）条目不动
- site/index.html 安卓卡片新增绿色「平板版 APK（Borealos Pad v5.1.5）」按钮 + 适配范围文案（7~14 英寸 · 1K~4K · 骁龙/联发科/玄戒 · 横竖屏 · 独立包名可共存）

**验证**:
- 构建 BUILD SUCCESSFUL 0 error，双产物 app-phone-debug.apk / app-pad-debug.apk
- aapt：phone com.nexa.app「Borealos」7/5.1.5；pad com.nexa.pad「Borealos Pad」7/5.1.5 ✅
- 部署 phone→Borealos-v5.1.5.apk 覆盖、pad→Borealos-pad-v5.1.5.apk 新增；重启后 /api/client-latest 同时含 android 5.1.5 与 android-tablet 5.1.5 且 sha256 各自一致
- 公网：pad 裸链 206；手机带 ?v=5.1.5 链 206（裸链 200 系 CDN 边缘缓存早前完整响应，下载链接均带版本参数）
- CDP(9318)：下载页 3 个 apk 按钮、平板卡片文案完整、0 乱码 0 报错，截图 D:\KIMI\shots\v8-download-pad2.png

**遗留**:
- pad 真机（7~14 英寸各尺寸）横竖屏排版、焦点通知上岛效果需真机确认；UA 标记已下发，网页端如需按 Phone/Pad 差异化布局可后续做
- 两包同机共存已按独立 applicationId 保证，但更新通道各自独立（pad 查 android-tablet），发版需两端同步传包

## 2026-07-27 06:05 - 网页端平板专属布局（pad-mode，UA 标记驱动 + 触屏兜底）

**需求**: 网页识别 Pad APK（UA `Borealos/5.1.5 Pad`）后切换平板专属布局——侧栏加宽图标+文字常驻、横屏多栏、模块网格 3~4 列、字号 16~17px、触控 48px、灵动岛居中不拉满、竖屏退两栏/单栏不横滚、弹窗/灯箱/登录窗居中 560~640px；手机（Phone）与桌面鼠标零回归

**改动（仅 work-ui/index.html，两处插入，补丁 D:\KIMI\patches\patch_padlayout.py）**:
- `<head>` 最前插同步判定脚本：UA 含 `Borealos/` 且含 `Pad` → 强制 `<html class="pad-mode">`；含 `Phone` 绝不命中；无 Borealos 标记时兜底：触屏（ontouchstart/maxTouchPoints>0）且 screen 短边≥600 长边≥960 → 命中；桌面鼠标（无触屏）绝不命中；全程 try/catch，失败回退默认布局
- `</head>` 前插一段 `/* ===== PAD LAYOUT ===== */` <style>（约 130 行），全部 `html.pad-mode` 前缀作用域、只新增规则不改既有选择器、复用 CSS 变量：
  - 字号变量覆盖 --t-body 16.5px / --t-caption 14 / --t-heading 19 / --t-display 30（特异性高于 :root）
  - 侧栏 300px 常驻（覆盖 ≤1366px 的 240px 收窄与 sb-collapsed 负边距），#nav-burger 隐藏；nav-item 48px/16px、图标 20px
  - 主区：chat-inner/input-box 放宽 1100px，.msg .bubble .md 长文本限 70ch；#files-panel 340px 常驻并排（横屏天然双栏），≤1099px 竖屏退回单栏隐藏
  - 灵动岛：topbar 内 absolute left:50% 居中置顶，pill max-width min(78vw,480px) 不拉满，busy/open 宽度限 320/360px，展开 morph 动画全保留
  - 网格：video 300/vs-gallery 240/studio-gallery 200/ip 280/imgtpl 300/vtpl 260 minmax；.studio-card/.pg-head 限宽 880→1200px、.vec-card 780→1100px 让网格达到 3~4 列；≤719px 强制 2 列
  - 触控：btn/输入/发送/附件/icon-btn/chip/mp-item min 44~48px（min-* 不挤压文字）
  - 弹窗 .modal-card min(620px,100vw-64px) 居中 max-height 90vh；.login-card 560px；#video-modal-box 640px；灯箱 img min(84vw,640px)
  - 全向 overflow-x:hidden/clip 防横滚
- server.js 未动（静态文件每请求 createReadStream 现读，无需重启）

**验证（CDP 9318，脚本 D:\KIMI\cdp-pad-check.py，四场景 0 console error 0 乱码）**:
- pad 横屏 2560×1600 + Pad UA：pad-mode ✓、scrollWidth=innerWidth 无横滚 ✓、侧栏 300px、burger 隐藏、files-panel 340px 双栏、字号 16.5px、nav 48px、island 主区居中（left=960=1920/2）✓、网格 studio 5 列/ip 3 列/vtpl 3 列
- pad 竖屏 1600×2560：三栏保持、island 居中（480=960/2）✓、ip 退 2 列、无横滚 ✓
- 回归 393×873 + Phone UA：pad-mode=false ✓、汉堡/抽屉/底 Tab/14px/44px 与现状一致 ✓
- 回归桌面 1440×900 无标记 UA：pad-mode=false ✓、侧栏 260px、island relative 原位、14px 全一致 ✓
- 弹窗 settings-modal 620px @x=970（970+310=1280 屏中心）✓；island open 360px @x=1080（1080+180=1260 主区中心）✓
- 截图：D:\KIMI\shots\pad-h.png / pad-v.png / pad-modal.png / pad-island-open.png / phone-regression.png / desktop-regression.png
- curl 带认证头 GET / 200（667258 字节）；备份 D:\KIMI\backups\pad-20260727-055156\index.html

**遗留**:
- 灯箱 img 按需求限 640px，真机看大图若偏小可调 min(84vw,~1100px)
- vtpl-grid 3 列未达 4（其父容器另有 ~900px 限宽，非 .studio-card）；如需 4 列再追容器
- 真机（小米平板 7 Ultra，WebView DPR 高、CSS 视口可能 ~1067~1600px）横竖屏与安全区表现需真机确认；判定走 UA 标记不依赖视口，无风险

## 2026-07-27 06:40 - AI 画室新增内置模板「一键改字」（只改图内文字，其余像素级保持）

**需求**: 通用版图内文字编辑（电商图片翻译的泛化）：参考图支持本地上传/图片链接/画室历史选图；自由文字指令 + 可选「原文字」定位；输出尺寸必须与原图完全一致；除文字外一切不变；失败必须给明确原因

**后端（server.js +82 行，补丁 patches/patch_imgtextedit_server.py，node -c 通过，未重启——待重启窗口）**:
- 新端点 POST /api/imgtextedit：三种图源——① refPath（/api/upload 上传，USERS_ROOT 白名单校验）② image（画室历史 rel 名，复用 resolveUserImage 历史引用机制）③ imageUrl（http/https，服务端 downloadVideo 下载到 uploads 临时文件，用完即删）
- Pillow（scripts/imgtextedit_util.py，size/resize 两模式，runPy 通道）读原图精确尺寸，同时拦截 URL 下载的坏文件（cannot identify image file）
- 提示词强约束：只改文字内容，主体/背景/颜色/风格/构图/布局 100% 不变、不重绘非文字区域、保持原字体风格/字号/颜色/位置；有 srcText 时先定位「原文字」；声明输出尺寸必须 = 原图 W×H
- 生成链路：wanImageI2i 新增可选 sizeWH 形参（默认 "1024*1024" 不变，向后兼容）→ 优先 wan2.7-image i2i 按原图精确尺寸请求；通道拒尺寸回退标准 genImageI2i 链路（wan 默认尺寸 → codex 参考图）
- 尺寸保真双保险：生成后 Pillow 比对输出尺寸，不一致则 LANCZOS 重采样回原始精确尺寸再交付，响应带 resized 标志
- 结果存 images/te-<ts>.png 自动进画室历史；recordUsage imageGen；每个失败环节都有明确 error（下载失败/坏图/缺图源/生成失败带双通道原因）

**前端（index.html +81 行，补丁 patches/patch_imgtextedit_front.py，CRLF 0 乱码）**:
- AI 画室 → 图片模板 tab → 第 5 张卡片「一键改字」，与抠图/换装/二次元/表情包同 grid 同风格
- 三种图源互斥：① imgtpl-upload 复用通用上传机制 ② te-url 链接输入 + 载入按钮（即时预览）③ te-gallery-btn 从画室历史选图（复用 /api/image/history + wiz-gallery/.pk 全局样式）
- te-instruction 文字指令（必填，500 字上限后端校验）+ te-srctext 原文字（可选，不填全图自动识别）
- teRun：来源优先级 文件 > 历史 > 链接；成功显示通道/耗时/尺寸/是否校准 + nxResultHtml 预览下载 + loadStudioHistory 刷新历史；失败 throw 进通用 catch 显示红字，不静默
- 副标题「四个一键模板」→「五个一键模板」

**验证**:
- server.js node -c 通过（4840 行），未重启（用户在处理 cloudflared 隧道，重启窗口用户定）——**待重启**
- imgtextedit_util.py 单测：size 读尺寸 ✓、同尺寸短路 unchanged ✓、重采样 1024→1536×1024 ✓、坏文件明确报错 ✓
- CDP(9318)：图片模板 tab 5 张卡片、「一键改字」四元素齐全、teRun 已定义、画廊选择器 14 项可点、链接载入互斥置位正确、副标题已更新、0 console error，截图 D:\KIMI\shots\textedit-card.png
- 备份 D:\KIMI\backups\textedit-20260727-062818\（index.html + server.js）

**遗留**:
- **待重启 server.js** 后 /api/imgtextedit 才生效，真实生成 e2e（文字替换质量、尺寸保真）需重启后验证
- wan2.7-image 多模态 i2i 无显式 strength/噪声参数，"低改动"靠提示词强约束（与图片翻译同机制）；若真机文字编辑效果不达标（改字不净/误动背景），替代方案：qwen 图像编辑模型（需新增通道配置），未擅自换通道
- 超大图（>2048px）wan 可能拒尺寸走默认尺寸再放大回，清晰度略降；真机观察

## 2026-07-27 06:55 - 「一键改字」端到端真实生成验收（3/3 通过）

**环境**: server.js 用户已重启（本地 200 / 公网 borealos.dev 200）

**实测（POST /api/imgtextedit，UTF-8 文件载荷；shell 内联中文 JSON 会被吞，验证时发现并绕开）**:
| 图源 | 原图 | 指令 | 结果 | 尺寸校验 | resized | 通道 | 耗时 |
|---|---|---|---|---|---|---|---|
| 本地上传 | 1200×800「夏季新品上市」 | 标题改「冬日特惠」 | te-1785159733418.png | Pillow MATCH | false | wan2.7-image-i2i | 4.9s |
| 图片链接 | 800×1200「限时抢购」（公网 URL） | 主标题改「狂欢继续」 | te-1785159793777.png | Pillow MATCH | false | wan2.7-image-i2i | 4.9s |
| 画室历史 | 1500×1000「周年庆大促」 | 标题改「会员专享日」 | te-1785159879800.png | Pillow MATCH | false | wan2.7-image-i2i | 6.3s |

**质量目检**: 三张均——标题精确替换、副标题原样保留、渐变背景/装饰圆（主体元素）位置颜色零误动、字体风格颜色排版一致。wan2.7-image 按请求的原图精确尺寸直接输出，三张 resized=false（重采样校准机制待命未触发）
**历史**: /api/image/history 确认三张 te-*.png 全部在列（共 18 张），可预览可下载
**提示词**: 未改动，首轮即达标，未动用追加 2 张的额度
**结论**: 达到「只改文字其余不变」可交付标准，无需 qwen 替代通道

**截图**: D:\KIMI\shots\te-result-upload.png / te-result-url.png / te-result-history.png（请求载荷 te-req1/2/3.json 同目录留档）
**清理**: 公网测试文件 site/te-url-poster.png 与本地临时海报已删；画室里 4 张测试图（img-1785159627655.png + 3 张 te-*.png）保留待用户自删

## 2026-07-27 07:05 - 图片翻译挂载尺寸保真校准（与一键改字同款）

**需求**: /api/imgtranslate 输出尺寸必须逐像素等于原图；复用 imgtextedit_util.py 不另起炉灶

**改动（补丁 patches/patch_imgtr_sizekeep.py，备份 backups/imgtr-size-20260727-064828/，node -c 通过，已按标准流程重启 200）**:
- server.js /api/imgtranslate：生成前 runPy imgtextedit_util.py size 读原图精确尺寸（坏图 400 拦截，复用同一脚本同一 runPy 通道，无代码分叉）；请求阶段按宽高比挑最接近的通道尺寸声明（codex 仅三档：ar>1.2→1536x1024，ar<0.83→1024x1536，否则 1024x1024，genImageDual 通道本身不变）；交付前比对输出尺寸，不一致 LANCZOS 校准回原始精确尺寸再写历史，响应带 resized 标志 + width/height 为原图值
- index.html imgtr 模块：f.resized 存标志，结果 meta 行显示「W×H · 已校准回原图尺寸」（与一键改字一致）

**实测（1 张额度）**: 自制中文电商图 1400×900（产品瓶+面霜文案+¥129+立即抢购）→ targetLang en → tr-1785160349118.png：codex-image 通道 131.9s，**resized=true 校准真实触发**，Pillow 比对 1400×900 MATCH，已进历史。目检：四段中文全部准确翻译（Deep Moisturizing Cream / Hyaluronic Acid + Ceramides, Dual Repair / Suitable for Sensitive Skin · 48-Hour Long-Lasting Hydration / Shop Now），产品瓶/白圆/米色底/红色按钮/价格全部保留
**截图**: D:\KIMI\shots\tr-result-sizekeep.png（载荷 tr-req.json 同目录）

**测试图清理**: 精确删除 4 张一键改字测试图（img-1785159627655.png + te-1785159733418/793777/879800.png），历史 19→15，te-* 清零，用户其他历史未动

## 2026-07-27 07:20 - AI 画室新增「自由图生图」（纯图+词，codex 参考图编辑）

**需求（用户原话）**: 弄一个单纯的图生图功能，接入 codex，单靠指示词来控制——不做模板包装，不搞风格下拉/强度滑块

**后端（server.js +79 行，补丁 patches/patch_imgfree_server.py，备份 backups/imgfree-20260727-071403/，node -c 通过，已重启 200）**:
- 新端点 POST /api/imgfree：三来源图源（refPath 上传 / image 历史 rel / imageUrl 服务端下载，与一键改字同机制同校验）
- 通道：codex 参考图编辑优先（imagegen.generateImage + refB64 + 按宽高比挑 1536x1024/1024x1536/1024x1024 最接近档），失败转 wanImageI2i 带图兜底——两路都不丢参考图；提示词原样直传，无任何包装/前缀/风格注入
- 尺寸保真同款：读原图尺寸 → 交付前 Pillow 比对 → LANCZOS 校准回原始精确尺寸 → resized 标志

**前端（index.html +79 行，补丁 patches/patch_imgfree_front.py，CRLF 0 乱码）**:
- 图片模板 tab 第 6 张卡片「自由图生图」：三来源互斥（复用一键改字机制）+ fg-instruction 自由提示词（必填，800 字上限），无风格下拉无强度滑块
- fgRun：来源优先级 文件 > 历史 > 链接；结果显示通道/耗时/尺寸/校准标志 + nxResultHtml + loadStudioHistory；失败 throw 进通用 catch 红字
- 副标题「五个一键模板」→「六个模板」

**验证**:
- CDP(9318)：6 张卡片、「自由图生图」元素齐、fgRun 定义、画廊 16 项、副标题更新、0 console error，截图 D:\KIMI\shots\freegen-card.png
- e2e（1 张额度）：自制 1200×900 风景图（蓝天/青山/房子/太阳）→ 提示词「把天空换成日落橙红色调，太阳变成夕阳，加几只飞鸟，房子和山保持不变」→ fg-1785161892824.png：codex-image 65.8s，resized=true 校准触发，Pillow 1200×900 MATCH，已进历史
- 目检：天空→日落橙红渐变 ✓、太阳变夕阳带光晕 ✓、+4 只飞鸟 ✓、房子/山/草地构图颜色保持不变 ✓（codex 确实在做参考图编辑而非重新生成）
- 截图 D:\KIMI\shots\fg-result.png（载荷 fg-req.json 同目录）；临时测试图已清理

## 2026-07-27 07:50 - 画室 i2i 链路尺寸保真全统一（i2i/换装/二次元补齐）

**全量盘点（画室里涉及参考图输入的端点）**:
| 端点 | 用途 | 校准状态 |
|---|---|---|
| /api/imgtextedit | 一键改字 | ✅ 已有（06:40） |
| /api/imgtranslate | 图片翻译 | ✅ 已有（07:05） |
| /api/imgfree | 自由图生图 | ✅ 已有（07:20） |
| /api/image/i2i | 参考图创作 | 本次补齐 ✅ |
| /api/image/outfit | AI 换装（基准=人物图） | 本次补齐 ✅ |
| /api/image/anime | 一键二次元 | 本次补齐 ✅ |
| /api/image/cutout | 抠图 rembg | 原生保尺寸（脚本无缩放，输出=输入尺寸） |
| /api/gif/make | 动图本地合成 | 原生处理（>MAX_SIDE 等比缩小系性能保护，预期行为） |
| /api/vector/convert | 矢量化 | 非生成类，不涉及 |
| /api/sticker/start | 表情包整套 | 衍生生成（按用户选 job.size 出图，产品是整套新图非编辑原图，无需校准） |
| /api/image/generate、/api/ip/gen-image | 文生图 | 无参考图输入 |
| /api/ecom/*（亚马逊） | 电商图 job 体系 | 衍生生成（按模板尺寸出主图/横幅，非画室 tab，本次不动） |

**改动（补丁 patches/patch_i2i_sizekeep.py，备份 backups/i2i-size-20260727-073443/，node -c 通过，已重启 200）**:
- server.js 新增共用 helper：readImageSize / ensureSameSize（复用 imgtextedit_util.py，三处新端点共用，存量三端点内联逻辑不动避免churn）
- /api/image/i2i、/api/image/anime：读参考图尺寸 → genImageI2i sizeWH 按原图精确尺寸声明（wan 直出）→ ensureSameSize 校准 → 响应 width/height/resized
- /api/image/outfit：基准=人物参考图（非 refsheet 拼图），同样挂载
- index.html：refimg 结果行、换装分支、抠图/二次元通用分支均显示「尺寸 W×H · 已校准回原图尺寸/与原图一致」

**实测（3 张额度，同源 1024×1536 武将女子图）**:
- i2i「背景换樱花庭院」low 强度 → wan2.7-image-i2i 8.6s resized=false MATCH，人物/盔甲/姿势零误动
- outfit 换红色连衣裙 → wan2.7-image-pro-i2i 8.4s resized=false MATCH（基准人物图），脸/发型/背景全保，服装忠实素材
- anime 二次元化 → wan2.7-image-i2i 7.5s resized=false MATCH，五官/构图保持
- 三张全部进历史（total 23），CDP 画室 6 卡片/refimg pane/画廊 23 缩略图 0 console error
- 截图 D:\KIMI\shots\i2i-result-sizekeep.png / outfit-result-sizekeep.png / anime-result-sizekeep.png
## 2026-07-27 22:42 - 亚马逊广告全量混合分析与完整版 PDF

- 报告解析取消 Top-N 截断，全部有效行参与计算；每个聚合项生成稳定 `itemId`。
- 新增动态字符批处理、五类本地确定性规则、严格 AI 教学字段校验与批次覆盖率合并。
- AI 分析支持每批原子保存、断点恢复、JSON 自动修复、原批重试和失败范围追踪；仅覆盖率 100% 标记完整。
- 页面新增覆盖率、部分完成警告、优先路线图、全量搜索排序表和逐项教学卡，旧报告保持兼容。
- PDF 新增执行摘要、逐项教学、全部数据附录、重复表头、7/14/30 天复盘清单、方法和警告。
- 验证：125 项样例生成 40 页 PDF，附录 125/125；全量 Python/Node 测试、语法、PDF 文本完整性及 Poppler 全页渲染检查通过。
- 线上部署：备份 `D:\KIMI\work-ui\backups\amazon-full-20260727-224221`，服务重启 HTTPS 200，生产文件哈希与测试版本一致。
