# -*- coding: utf-8 -*-
"""三次修正：.vbtn 基础样式 + 矢量向导页闲聊区隐藏 + vw 网格空态居中"""
import sys

PATH = r"D:\KIMI\work-ui\index.html"
s = open(PATH, encoding="utf-8").read()
errors = []

def rep(name, old, new, count=1):
    global s
    n = s.count(old)
    if n != count:
        print(f"[FAIL] {name}: expect {count}, found {n}")
        errors.append(name)
        return
    s = s.replace(old, new)
    print(f"[ok] {name}")

rep("css-fix3", "/* 闲聊模式空状态 */",
    """/* 通用幽灵按钮 .vbtn（此前无基础样式，退化成系统默认灰钮） */
.vbtn { display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  height: 36px; padding: 0 16px; border: 1px solid var(--border-2); border-radius: 999px;
  background: var(--bg); color: var(--text-2); font-size: var(--t-body); font-family: inherit;
  cursor: pointer; white-space: nowrap; text-decoration: none; transition: all var(--dur-fast); }
.vbtn:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); background: rgba(124,58,237,.04); }
.vbtn:disabled { opacity: .55; cursor: not-allowed; }
/* 矢量向导开启时隐藏闲聊空状态与输入区（vwHookNav 直绑 showVectorWizard，未走 showEngView 的隐藏逻辑） */
#chat-scroll:has(#vector-wizard-view.on) #empty-state,
#chat-scroll:has(#vector-wizard-view.on) #input-area { display: none !important; }
/* vw 选图网格里的空态/加载态占满整行 */
#vw-gallery-grid .studio-empty, #vw-sticker-grid .studio-empty, #vw-ip-grid .studio-empty { grid-column: 1 / -1; }

/* 闲聊模式空状态 */""")

if errors:
    print("!! 失败，未写入:", errors)
    sys.exit(1)
open(PATH, "w", encoding="utf-8", newline="").write(s)
print("写入完成")
