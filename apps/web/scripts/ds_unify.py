# -*- coding: utf-8 -*-
"""Borealos 模块页设计系统统一改造（只动视觉层）。
对每个替换做精确匹配断言，任一失败即中止，不写文件。"""
import re, sys, urllib.parse

PATH = r"D:\KIMI\work-ui\index.html"
s = open(PATH, encoding="utf-8").read()
orig = s
errors = []

def rep(name, old, new, count=1, hard=True):
    global s
    n = s.count(old)
    if n != count:
        msg = f"[{'FAIL' if hard else 'WARN'}] {name}: expect {count}, found {n}"
        print(msg)
        if hard:
            errors.append(name)
            return
    if n:
        s = s.replace(old, new)
        print(f"[ok] {name} x{n}")

def rep_re(name, pat, new, count=1, flags=0, hard=True):
    global s
    n = len(re.findall(pat, s, flags))
    if n != count:
        print(f"[{'FAIL' if hard else 'WARN'}] {name}: expect {count}, found {n}")
        if hard:
            errors.append(name)
            return
    if n:
        s = re.sub(pat, new, s, flags=flags)
        print(f"[ok] {name} x{n}")

# ---------- SVG 片段 ----------
def IC(inner, size=14, mr=5):
    return (f'<svg width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
            f'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" '
            f'style="vertical-align:-2.5px;margin-right:{mr}px">{inner}</svg>')

DL      = IC('<path d="M12 4v11m0 0l-4-4m4 4l4-4"/><path d="M4 17v1a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1"/>')
DL_SM   = IC('<path d="M12 4v11m0 0l-4-4m4 4l4-4"/><path d="M4 17v1a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1"/>', 12, 3)
UL      = IC('<path d="M12 16V5m0 0l-4 4m4-4l4 4"/><path d="M4 17v1a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1"/>')
UL_BIG  = ('<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" '
           'stroke-linecap="round" stroke-linejoin="round" style="color:var(--text-3)">'
           '<path d="M12 16V5m0 0l-4 4m4-4l4 4"/><path d="M4 17v1a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1"/></svg>')
PLUS    = IC('<path d="M12 5v14M5 12h14"/>')
PEN     = IC('<path d="M12 19l7-7-4-4-7 7-1 5z"/><path d="M15 8l-6.5 6.5"/><path d="M19 5l-1.5 1.5"/>')
REFRESH = IC('<path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M18 3v4h-4"/>')
TRASH   = IC('<path d="M4 7h16"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/>')
TRASH_SM= IC('<path d="M4 7h16"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/>', 12, 3)
SPARK   = IC('<path d="M12 3l1.9 4.6 4.6 1.4-4.6 1.9L12 15.5l-1.9-4.6L5.5 9l4.6-1.4z"/><path d="M18 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>')
SAVE    = IC('<path d="M5 4h11l3 3v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z"/><path d="M8 4v5h7V4"/><path d="M8 20v-6h8v6"/>')

def BADGE(inner):
    return ('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" '
            f'stroke-linecap="round" stroke-linejoin="round">{inner}</svg>')

PALETTE = ('<path d="M12 3a9 9 0 1 0 0 18c1.5 0 2-.8 2-1.7 0-1-.7-1.3-.7-2.3 0-1.2 1-2 2.3-2H18a3 3 0 0 0 3-3c0-4.5-4-7-9-7z"/>'
           '<circle cx="7.5" cy="10.5" r=".6" fill="currentColor"/><circle cx="10.5" cy="7.5" r=".6" fill="currentColor"/>'
           '<circle cx="14.5" cy="7.5" r=".6" fill="currentColor"/>')
SMILE   = ('<circle cx="12" cy="12" r="9"/><path d="M8.5 14s1.2 1.8 3.5 1.8 3.5-1.8 3.5-1.8"/>'
           '<circle cx="9" cy="9.5" r=".6" fill="currentColor"/><circle cx="15" cy="9.5" r=".6" fill="currentColor"/>')
PENB    = '<path d="M12 19l7-7-4-4-7 7-1 5z"/><path d="M15 8l-6.5 6.5"/><path d="M19 5l-1.5 1.5"/>'
EYE     = '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z"/><circle cx="12" cy="12" r="3"/>'
FILM    = '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 9h16M4 15h16M9 4v16M15 4v16"/>'
CAM     = '<rect x="3" y="5" width="13" height="14" rx="2"/><path d="M16 10l5-3v10l-5-3z"/>'
CHAT    = '<path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 4z"/>'

def pghead(badge, title, desc):
    return (f'<div class="pg-head"><div class="pg-badge">{BADGE(badge)}</div>'
            f'<div class="pg-head-t"><div class="pg-title">{title}</div>'
            f'<div class="pg-desc">{desc}</div></div></div>')

# ---------- 1. 标准页头注入 ----------
rep("pghead-studio", '<div id="studio-view">',
    '<div id="studio-view">\n      ' + pghead(PALETTE, "AI 画室", "描述你想要的画面，AI 帮你画出来；单张创作、电商图、表情包三种模式"))
rep("pghead-ip", '<div id="ip-view">',
    '<div id="ip-view">\n      ' + pghead(SMILE, "IP 工坊", "虚拟角色的「灵魂档案」——性格、口头禅、画风、参考图，保证角色始终一致"))
rep("pghead-vector", '<div id="vector-wizard-view">',
    '<div id="vector-wizard-view">\n      ' + pghead(PENB, "矢量工坊", "四步把位图变成可缩放矢量图，支持 SVG / EPS / PDF / DXF 导出"))
rep("pghead-videostudio", '<div id="video-studio-view">',
    '<div id="video-studio-view">\n      ' + pghead(CAM, "AI 视频工坊", "文生视频、图生视频、首尾帧过渡，Seedance 与万相双引擎"))
rep("pghead-video", '<div id="video-view" style="display:none">',
    '<div id="video-view" style="display:none">\n        ' + pghead(FILM, "视频历史", "你生成过的视频都存在这里（按时间倒序），点击卡片可预览"))

# 矢量查看器侧栏页头（保留原 h2，套壳）
rep("pghead-svgview",
    '<div class="studio-title-row"><h2 style="font-size: var(--t-body);margin:0">矢量查看器</h2></div>',
    '<div class="pg-head"><div class="pg-badge">' + BADGE(EYE) + '</div>'
    '<div class="pg-head-t"><h2 class="pg-title" style="font-size: var(--t-body);margin:0">矢量查看器</h2>'
    '<div class="pg-desc">预览、改色、改尺寸并导出</div></div></div>')

# 闲聊模式空状态加徽章
rep("chat-badge",
    '<div id="empty-state">\n        <h1>',
    '<div id="empty-state">\n        <div class="pg-badge pg-badge-lg">' + BADGE(CHAT) + '</div>\n        <h1>')

# ---------- 2. 隐藏被页头取代的旧 h2 ----------
rep("dup-studio", '<h2 class="section-title">AI 画室</h2>', '<h2 class="section-title pg-dup">AI 画室</h2>')
rep("dup-ip", '<h2 class="section-title">IP 工坊</h2>', '<h2 class="section-title pg-dup">IP 工坊</h2>')
rep("dup-videostudio", '<h2 class="section-title">AI 视频工坊</h2>', '<h2 class="section-title pg-dup">AI 视频工坊</h2>')

# ---------- 3. 上传区空图标位填 SVG ----------
rep("upload-icon-s2", '<div style="font-size: var(--t-display);margin-bottom: var(--s-2)"></div>',
    '<div style="font-size: var(--t-display);margin-bottom: var(--s-2)">' + UL_BIG + '</div>', count=3)
rep("upload-icon-s1", '<div style="font-size: var(--t-display);margin-bottom: var(--s-1)"></div>',
    '<div style="font-size: var(--t-display);margin-bottom: var(--s-1)">' + UL_BIG + '</div>', count=2)

# ---------- 4. emoji 清理：分段控件/标签 ----------
for old, new, cnt in [
    ("> 真实动物<", ">真实动物<", 3),
    (">️ 简笔线条<", ">简笔线条<", 3),
    (">Q 版插画<", ">Q 版插画<", 3),
    ("> 万相 · 免费<", ">万相 · 免费<", 1),
    ("> Codex<", ">Codex<", 1),
    ("> 主图<", ">主图<", 1),
    ("> 详情页<", ">详情页<", 1),
    ("> 服饰鞋包<", ">服饰鞋包<", 1),
    ("> 食品饮料<", ">食品饮料<", 1),
    ("> 美妆个护<", ">美妆个护<", 1),
    ("> 家居日用<", ">家居日用<", 1),
    ("> 数码家电<", ">数码家电<", 1),
    ("> 母婴玩具<", ">母婴玩具<", 1),
    (">⬆ 本地上传<", ">本地上传<", 1),
    ("> 文生视频<", ">文生视频<", 1),
    ("> Seedance 2.0<", ">Seedance 2.0<", 1),
    ("> Qwen Wanxiang<", ">Qwen Wanxiang<", 1),
]:
    rep("seg:" + old[1:6], old, new, count=cnt, hard=False)

# 步骤指示器文字（①②③④ → 纯文字，序号由 CSS 圆点接管）
for old, new in [
    (">① 选择图片<", ">选择图片<"), (">② 效果设置<", ">效果设置<"),
    (">③ 正在转换<", ">正在转换<"), (">④ 转换完成<", ">转换完成<"),
    (">① 出形象图<", ">出形象图<"), (">② 确认设定<", ">确认设定<"), (">③ 完成<", ">完成<"),
    (">① 选择图片类型<", ">选择图片类型<"), (">② 选择平台尺寸模板<", ">选择平台尺寸模板<"),
    (">③ 选择商品类目（影响生成风格）<", ">选择商品类目（影响生成风格）<"),
    (">④ 上传商品参考图（保持商品一致）<", ">上传商品参考图（保持商品一致）<"),
    (">⑤ 描述画面<", ">描述画面<"),
    (">① 选择主角（点一个 IP 快捷带入，或从画室里点一张）<", ">选择主角（点一个 IP 快捷带入，或从画室里点一张）<"),
    (">② 表情清单（4-12 个，点文字可改、可删可加）<", ">表情清单（4-12 个，点文字可改、可删可加）<"),
    (">③ 图上文字<", ">图上文字<"),
    ("> 最近转换<", ">最近转换<"),
]:
    rep("step:" + old[1:5], old, new, count=1, hard=False)

# ---------- 5. 乱码修复（vw 第三步） ----------
rep_re("moji-elapsed", r'id="vw-gen-elapsed">[^<]*</div>', 'id="vw-gen-elapsed">已用时 0s</div>')
rep_re("moji-cancel", r'(id="vw-gen-cancel"[^>]*)>[^<]*</button>', r'\1>取消转换</button>')

# vw 阶段圆点：emoji → 数字
_phase_n = [0]
def _phase_sub(m):
    _phase_n[0] += 1
    return f'<div class="vw-phase-dot">{_phase_n[0]}</div>'
s, _n = re.subn(r'<div class="vw-phase-dot">[^<]*</div>', _phase_sub, s)
print(f"[ok] vw-phase-dots x{_n}" if _n == 4 else f"[WARN] vw-phase-dots x{_n}")

# ---------- 6. 按钮 emoji → SVG ----------
rep("btn-vw-dl", '<button class="primary" id="vw-dl-btn">⬇ 下载</button>',
    '<button class="primary" id="vw-dl-btn">' + DL + '下载</button>')
rep("btn-vw-retry", '<button class="ghost" id="vw-retry-btn">↻ 换参数重来</button>',
    '<button class="ghost" id="vw-retry-btn">' + REFRESH + '换参数重来</button>')
rep("btn-ip-new", '<button id="ip-new-btn" class="vbtn" type="button">＋ 新建 IP</button>',
    '<button id="ip-new-btn" class="vbtn" type="button">' + PLUS + '新建 IP</button>')
rep("btn-ip-art", '<button id="ip-art-start" type="button">️ 生成推文</button>',
    '<button id="ip-art-start" type="button">' + PEN + '生成推文</button>')
rep("btn-svgv-upload", '<button id="svgv-upload" class="vbtn" type="button">⬆ 上传 SVG 查看</button>',
    '<button id="svgv-upload" class="vbtn" type="button">' + UL + '上传 SVG 查看</button>')
rep("btn-svgv-dl-svg", '<button class="vbtn" id="svgv-dl-svg" type="button">⬇ 下载编辑后 SVG</button>',
    '<button class="vbtn" id="svgv-dl-svg" type="button">' + DL + '下载编辑后 SVG</button>')
rep("btn-svgv-dl-png", '<button class="vbtn" id="svgv-dl-png" type="button">⬇ 导出 PNG</button>',
    '<button class="vbtn" id="svgv-dl-png" type="button">' + DL + '导出 PNG</button>')
rep("btn-svgv-save", '> 保存副本到服务器</button>', '>' + SAVE + '保存副本到服务器</button>')
rep("btn-studio-dl", '>⬇ 下载图片</a>', '>' + DL + '下载图片</a>', count=2)
rep("btn-vs-dl", '>⬇ 下载视频</a>', '>' + DL + '下载视频</a>')
rep("btn-lb-dl", '<a id="studio-lb-dl" href="#" download>⬇ 下载</a>',
    '<a id="studio-lb-dl" href="#" download>' + DL + '下载</a>')
rep("btn-lb-del", '<button id="studio-lb-del" style="color:#c00"> 删除</button>',
    '<button id="studio-lb-del" style="color:#c00">' + TRASH + '删除</button>')
rep("btn-stk-start", '<button id="stk-start" type="button"> 开始生成整套</button>',
    '<button id="stk-start" type="button">' + SPARK + '开始生成整套</button>')
rep("btn-stk-add", '<button id="stk-add-expr" class="stk-add" type="button">＋ 添加表情</button>',
    '<button id="stk-add-expr" class="stk-add" type="button">' + PLUS + '添加表情</button>')
rep("btn-stk-dlall", '>⬇ 打包下载全部</button>', '>' + DL + '打包下载全部</button>')
rep("btn-wiz-regen", '<button class="btn btn-ghost" id="wiz-regen-btn" style="display:none">↻ 换一张</button>',
    '<button class="btn btn-ghost" id="wiz-regen-btn" style="display:none">' + REFRESH + '换一张</button>')
rep("btn-wiz-reprofile", '>↻ 换一版设定（不重生成图）</button>', '>' + REFRESH + '换一版设定（不重生成图）</button>')
rep("btn-wx-redo", '>↻ 换个设置重导</button>', '>' + REFRESH + '换个设置重导</button>')

# JS 模板里的视频卡片按钮（字符串内容，不动逻辑）
rep("js-video-dl", '<button class="btn-download">⬇ 下载</button>',
    '<button class="btn-download">' + DL_SM + '下载</button>', count=2)
rep("js-video-del", '<button class="btn-danger btn-delete"> 删除</button>',
    '<button class="btn-danger btn-delete">' + TRASH_SM + '删除</button>', count=2)

# IP 卡菜单按钮文字（textContent，纯文本化）
rep("js-mk-article", 'mk("️ 写推文"', 'mk("写推文"')
rep("js-mk-regen", 'mk("↻ 换参考图"', 'mk("换参考图"')
rep("js-mk-regen2", 'b.textContent = "↻ 换参考图"', 'b.textContent = "换参考图"')
rep_re("js-mk-del", r'mk\("[^"]*", "", "删除这个 IP', 'mk("删除", "", "删除这个 IP')
rep("js-art-copy", '> 复制 HTML（粘贴进公众号编辑器）', '>复制 HTML（粘贴进公众号编辑器）', hard=False)

# IP 列表空态：纯文字 → 统一空状态组件
rep("js-ip-empty",
    "box.innerHTML = '<div class=\"ip-empty\">还没有 IP 档案。<br>点上方「＋ 新建 IP」，三步创造一个角色 </div>';",
    "box.innerHTML = '<div class=\"ip-empty empty-illustration\"><div class=\"ei-icon\"></div>"
    "<div class=\"ei-title\">还没有 IP 档案</div><div class=\"ei-desc\">三步创造一个专属角色，生成表情包、插画和故事</div>"
    "<button class=\"ei-action\" onclick=\"openIPWizard()\">新建 IP</button></div>';")

# ---------- 7. 表单控件统一（class 化，去内联长 style） ----------
TA_STYLE = ('width:100%;min-height:76px;resize:vertical;box-sizing:border-box;border:1px solid var(--border);'
            'border-radius: var(--r-btn);padding: var(--s-2) var(--s-3);font-size: var(--t-body);font-family:inherit;'
            'background:var(--bg-2);outline:none;transition:border-color var(--dur-fast),box-shadow var(--dur-fast)')
rep("ta-t2v", f'style="{TA_STYLE}"', 'class="nx-ta"', count=1)
rep("ta-i2v", f'style="{TA_STYLE.replace("min-height:76px", "min-height:60px")};margin-top: var(--s-2)"',
    'class="nx-ta" style="margin-top: var(--s-2)"', count=1)
rep("ta-fl", f'style="{TA_STYLE.replace("min-height:76px", "min-height:60px")}"', 'class="nx-ta"', count=1)
rep("in-ip-topic",
    '<input id="ip-art-topic" placeholder="推文主题，例如：周一上班的心情" style="flex:1;border:1px solid var(--border-2);border-radius: var(--r-btn);padding: var(--s-2) var(--s-3);font-size: var(--t-body);background:var(--bg);color:var(--text);font-family:inherit">',
    '<input id="ip-art-topic" placeholder="推文主题，例如：周一上班的心情" class="nx-in" style="flex:1">')
rep("in-ecom-num",
    'style="width:80px;border:1px solid var(--border-2);border-radius: var(--r-btn);padding: var(--s-2) 10px;font-size: var(--t-body);background:var(--bg);color:var(--text);font-family:inherit"',
    'class="nx-in nx-num"', count=2)

# ---------- 8. 骨架屏：加载函数注入 ----------
rep("skel-helper", '</body>',
    '<script>window.nxSkel=function(n,c){var h="";for(var i=0;i<n;i++)h+=\'<div class="nx-skeleton \'+c+\'"></div>\';return h;};</script>\n</body>')
rep("skel-studio",
    'const gal = document.getElementById("studio-gallery");\n  const empty = document.getElementById("studio-gallery-empty");\n  try {',
    'const gal = document.getElementById("studio-gallery");\n  const empty = document.getElementById("studio-gallery-empty");\n'
    '  gal.innerHTML = window.nxSkel ? window.nxSkel(6, "sk-thumb") : "";\n  empty.style.display = "none";\n  try {')
rep("skel-ip",
    'const box = document.getElementById("ip-list");\n  try {',
    'const box = document.getElementById("ip-list");\n  box.innerHTML = window.nxSkel ? window.nxSkel(4, "sk-ip") : "";\n  try {')
rep("skel-svgv",
    'const box = document.getElementById("svgv-list");\n  try {',
    'const box = document.getElementById("svgv-list");\n  box.innerHTML = window.nxSkel ? window.nxSkel(5, "sk-row") : "";\n  try {')
rep("skel-vs",
    'const gal = document.getElementById("vs-gallery");\n  const empty = document.getElementById("vs-gallery-empty");\n  try {',
    'const gal = document.getElementById("vs-gallery");\n  const empty = document.getElementById("vs-gallery-empty");\n'
    '  gal.innerHTML = window.nxSkel ? window.nxSkel(4, "sk-vid") : "";\n  empty.style.display = "none";\n  try {')
rep("skel-videos",
    'async function loadVideos() {\n  try {',
    'async function loadVideos() {\n'
    '  if (window.nxSkel) { $videoGrid.style.display = "grid"; $videoEmpty.style.display = "none"; $videoGrid.innerHTML = window.nxSkel(4, "sk-vid"); }\n  try {')
# loadVideos 失败时让骨架收敛为空态，避免 shimmer 卡死
rep("skel-videos-fail", 'if (!d.ok) return;\n    videoList = d.videos || [];',
    'if (!d.ok) { videoList = videoList || []; renderVideos(); return; }\n    videoList = d.videos || [];')
rep("skel-videos-catch", '} catch (e) { console.error("load videos failed", e); }',
    '} catch (e) { console.error("load videos failed", e); videoList = videoList || []; renderVideos(); }')

# ---------- 9. 统一 CSS 注入 ----------
def mask_uri(inner):
    svg = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="black" '
           f'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">{inner}</svg>')
    return 'url("data:image/svg+xml,' + urllib.parse.quote(svg) + '")'

IMG_ICON = '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M4 18l5-5 3 3 4-4 4 4"/>'
CUBE = '<path d="M12 3l8 4v10l-8 4-8-4V7z"/><path d="M12 12l8-5M12 12v10M12 12L4 7"/>'

CSS = """
<style id="ds-unify">
/* ================= 模块页设计系统统一 ================= */
/* 标准页头：24px 渐变徽章 + 17px/600 标题 + 13px 灰描述 */
.pg-head { display: flex; align-items: center; gap: 12px; width: 100%; max-width: 880px; margin: 0 auto 20px; }
#video-view .pg-head, #ip-view .pg-head, #vector-wizard-view .pg-head { margin-bottom: var(--s-1); }
#vector-wizard-view .pg-head { max-width: 860px; }
#video-view .pg-head { max-width: 1080px; }
#svgv-side .pg-head { max-width: none; margin: 0 0 10px; }
.pg-badge { width: 24px; height: 24px; border-radius: 8px; flex: none; display: flex; align-items: center; justify-content: center;
  color: #fff; background: linear-gradient(135deg, var(--accent), var(--accent-2)); box-shadow: 0 2px 8px rgba(124,58,237,.28); }
.pg-badge svg { width: 14px; height: 14px; display: block; }
.pg-badge-lg { width: 48px; height: 48px; border-radius: 14px; }
.pg-badge-lg svg { width: 24px; height: 24px; }
.pg-head-t { min-width: 0; }
.pg-title { font-size: 17px; font-weight: 600; color: var(--text); letter-spacing: -.01em; line-height: 1.3; }
#svgv-side .pg-title { font-size: 15px; }
.pg-desc { font-size: 13px; color: var(--text-3); line-height: 1.5; margin-top: 2px; }
#svgv-side .pg-desc { font-size: 12px; }
.pg-dup { display: none !important; }
/* 页头就位后，卡片内标题降为 15px 实色小节标题 */
#studio-view .section-title:not(.pg-dup), #video-studio-view .section-title, #ip-view .section-title:not(.pg-dup),
#vector-wizard-view .vw-card h2, #svgview-view h2:not(.pg-title), #ip-wizard .section-title {
  background: none; -webkit-text-fill-color: currentColor; color: var(--text);
  font-size: 15px; font-weight: 600; letter-spacing: -.01em; margin: 0 0 var(--s-1);
}
.studio-title-row:has(.pg-dup) { justify-content: flex-end; margin-bottom: 6px; }
#video-view .video-grid { width: 100%; max-width: 1080px; margin-left: auto; margin-right: auto; }

/* 表单控件统一：40px 高、12px 圆角 */
.nx-in { height: 40px; border: 1px solid var(--border-2); border-radius: 12px; padding: 0 12px;
  font-size: var(--t-body); background: var(--input-bg); color: var(--text); font-family: inherit;
  outline: none; box-sizing: border-box; transition: border-color var(--dur-fast), box-shadow var(--dur-fast); }
.nx-in:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(124,58,237,.12); }
.nx-num { width: 84px; flex: none; }
.nx-ta { display: block; width: 100%; min-height: 76px; resize: vertical; box-sizing: border-box;
  border: 1px solid var(--border); border-radius: 12px; padding: 10px 12px; font-size: var(--t-body);
  line-height: 1.6; font-family: inherit; background: var(--input-bg); color: var(--text);
  outline: none; transition: border-color var(--dur-fast), box-shadow var(--dur-fast); }
.nx-ta:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(124,58,237,.12); }
#studio-prompt, #ecom-prompt { border-radius: 12px; padding: 10px 12px; line-height: 1.6; }
#competitor-url { height: 40px; border-radius: 12px; }
#vector-wizard-view select, #vector-wizard-view input[type="number"],
#svgv-edit select, #svgv-edit input[type="number"] {
  height: 36px; border: 1px solid var(--border-2); border-radius: 10px; padding: 0 10px;
  font-size: var(--t-body); background: var(--bg); color: var(--text); font-family: inherit;
  outline: none; box-sizing: border-box; }
#svgv-width { width: 140px; }

/* 标签与控件基线：12px 灰标签、10-12px 间距 */
#studio-view .studio-row, #video-studio-view .studio-row, #ip-view .studio-row { gap: 10px 12px; }
#studio-view .studio-row .seg + .lbl, #video-studio-view .studio-row .seg + .lbl { margin-left: var(--s-2); }
#svgv-edit .svgv-row .lbl { font-size: 12px; font-weight: 400; color: var(--text-3); width: 46px; }
#vw-adv-body .vw-adv-row label { font-size: 12px; color: var(--text-3); width: 72px; }
#video-studio-view .vs-mode-desc { font-size: 13px; color: var(--text-3); margin-bottom: 10px; }

/* 主按钮统一：渐变胶囊 40px */
#stk-start, #ip-art-start, #competitor-analyze-btn {
  border: none; border-radius: 999px; height: 40px; padding: 0 22px;
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  background: linear-gradient(120deg, var(--accent), #5e5ce6); color: #fff;
  font-size: var(--t-body); font-weight: 600; font-family: inherit; cursor: pointer;
  white-space: nowrap; transition: all var(--dur-normal); box-shadow: 0 1px 3px rgba(124,58,237,.22); }
#stk-start:hover:not(:disabled), #ip-art-start:hover:not(:disabled), #competitor-analyze-btn:hover:not(:disabled) {
  transform: translateY(-1px); box-shadow: 0 2px 8px rgba(124,58,237,.26); }
#stk-start:disabled, #ip-art-start:disabled, #competitor-analyze-btn:disabled { opacity: .55; cursor: not-allowed; }
#studio-gen-btn, #vs-gen-btn, #ecom-gen-btn {
  height: 40px; padding: 0 24px; display: inline-flex; align-items: center; justify-content: center; }
/* 生成中：spinner + 禁用文案 */
#studio-gen-btn:disabled, #vs-gen-btn:disabled, #ecom-gen-btn:disabled,
#stk-start:disabled, #ip-art-start:disabled, #competitor-analyze-btn:disabled {
  opacity: .85; cursor: wait; position: relative; padding-left: 38px; }
#studio-gen-btn:disabled::before, #vs-gen-btn:disabled::before, #ecom-gen-btn:disabled::before,
#stk-start:disabled::before, #ip-art-start:disabled::before, #competitor-analyze-btn:disabled::before {
  content: ""; position: absolute; left: 16px; top: 50%; width: 13px; height: 13px; margin-top: -7px;
  border: 2px solid rgba(255,255,255,.45); border-top-color: #fff; border-radius: 50%;
  animation: spin .8s linear infinite; }

/* 骨架屏（shimmer 常开） */
.nx-skeleton { animation: nxShimmer 1.3s linear infinite; }
.sk-thumb { aspect-ratio: 1; border-radius: var(--r-card); }
.sk-vid { height: 196px; border-radius: var(--r-card); }
.sk-ip { height: 248px; border-radius: var(--r-card); }
.sk-row { height: 44px; border-radius: 12px; }
#svgv-list .sk-row { margin-bottom: var(--s-2); }

/* 空状态统一：40px 灰图标（mask） */
.studio-empty::before { display: none; }
.empty-illustration .ei-icon {
  --ei-icon: __IMG__;
  width: 40px; height: 40px; font-size: 0; opacity: .45; filter: none; margin-bottom: var(--s-2);
  background: var(--text-3);
  -webkit-mask-image: var(--ei-icon); mask-image: var(--ei-icon);
  -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat;
  -webkit-mask-position: center; mask-position: center;
  -webkit-mask-size: contain; mask-size: contain; }
#studio-gallery-empty .ei-icon { --ei-icon: __PALETTE__; }
#video-view .ei-icon, #vs-gallery-empty .ei-icon { --ei-icon: __FILM__; }
#ip-list .ei-icon { --ei-icon: __SMILE__; }
#svgv-list .ei-icon { --ei-icon: __PEN__; }
#files-list .ei-icon { --ei-icon: __CUBE__; }

/* 步骤指示器：数字圆点（vw + wiz） */
.vw-steps, .wiz-steps { counter-reset: dsstep; }
.vw-steps .ws, .wiz-steps .ws { display: flex; align-items: center; justify-content: center; gap: 6px; font-size: 12px; }
.vw-steps .ws::before, .wiz-steps .ws::before {
  counter-increment: dsstep; content: counter(dsstep);
  width: 20px; height: 20px; border-radius: 50%; flex: none;
  display: inline-flex; align-items: center; justify-content: center;
  background: var(--bg-3); color: var(--text-3); font-size: 11px; font-weight: 600;
  transition: all var(--dur-normal); }
.vw-steps .ws.on::before, .wiz-steps .ws.on::before {
  background: linear-gradient(120deg, var(--accent), #5e5ce6); color: #fff; box-shadow: 0 2px 6px rgba(124,58,237,.3); }
.vw-steps .ws.done::before, .wiz-steps .ws.done::before { content: "\\2713"; background: var(--green); color: #fff; }
.vw-phase.done .vw-phase-dot { font-size: 0; }
.vw-phase.done .vw-phase-dot::after { content: "\\2713"; font-size: 15px; }

/* 电商步骤：数字徽章 */
#pane-ecom { counter-reset: ecomstep; }
#pane-ecom .ecom-step { display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 600; color: var(--text-2); margin: var(--s-4) 0 var(--s-2); }
#pane-ecom .ecom-step::before {
  counter-increment: ecomstep; content: counter(ecomstep);
  width: 20px; height: 20px; border-radius: 50%; flex: none;
  display: inline-flex; align-items: center; justify-content: center;
  background: rgba(124,58,237,.1); color: var(--accent); font-size: 11px; font-weight: 700; }
#pane-sticker .stk-step { font-size: 12px; font-weight: 600; color: var(--text-2); margin: var(--s-4) 0 var(--s-2); }

/* 闲聊模式空状态 */
#empty-state .pg-badge-lg { margin-bottom: var(--s-2); }
#empty-state h1 { margin: 0; text-align: center; }
#empty-state p { margin: 0; max-width: 420px; text-align: center; line-height: 1.6; }
</style>
</head>"""
CSS = (CSS.replace("__IMG__", mask_uri(IMG_ICON)).replace("__PALETTE__", mask_uri(PALETTE))
          .replace("__FILM__", mask_uri(FILM)).replace("__SMILE__", mask_uri(SMILE))
          .replace("__PEN__", mask_uri(PENB)).replace("__CUBE__", mask_uri(CUBE)))
rep("css-inject", "</head>", CSS)

# ---------- 结果 ----------
if errors:
    print("\n!! 有硬失败项，未写入文件：", errors)
    sys.exit(1)
if s == orig:
    print("\n!! 无变化，未写入")
    sys.exit(1)
open(PATH, "w", encoding="utf-8", newline="").write(s)
print(f"\n写入完成：{PATH}（{len(orig)} -> {len(s)} 字符）")

# 剩余 emoji 扫描（仅提示）
left = re.findall(r'[\U0001F000-\U0001FAFF\u2600-\u27BF\uFE0F\u2B50\u3030]', s)
print("剩余 emoji 类字符（含 JS 提示语/角标，供人工复核）:", len(left), "".join(sorted(set(left)))[:80])
