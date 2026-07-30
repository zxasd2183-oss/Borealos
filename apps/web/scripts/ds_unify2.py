# -*- coding: utf-8 -*-
"""二次修正：空态 flex 居中 + label/控件成组防换行拆散 + lbl-seg 样式"""
import sys

PATH = r"D:\KIMI\work-ui\index.html"
s = open(PATH, encoding="utf-8").read()
errors = []

def rep(name, old, new, count=1, hard=True):
    global s
    n = s.count(old)
    if n != count:
        print(f"[{'FAIL' if hard else 'WARN'}] {name}: expect {count}, found {n}")
        if hard:
            errors.append(name)
            return
    if n:
        s = s.replace(old, new)
        print(f"[ok] {name} x{n}")

# 1. 画室画廊空态：block → flex（恢复 empty-illustration 的 flex 居中）
rep("empty-flex-1", 'empty.style.display = imgs.length ? "none" : "block";',
    'empty.style.display = imgs.length ? "none" : "flex";')
rep("empty-flex-2", 'gal.innerHTML = "";\n    empty.style.display = "block";',
    'gal.innerHTML = "";\n    empty.style.display = "flex";')

# 2. 画室参数行：label+seg 成组
rep("grp-s1", '<div class="studio-row">\n          <span class="lbl">风格</span>',
    '<div class="studio-row">\n          <span class="lbl-seg"><span class="lbl">风格</span>')
rep("grp-s2", '</div>\n          <span class="lbl">尺寸</span>',
    '</div></span>\n          <span class="lbl-seg"><span class="lbl">尺寸</span>')
rep("grp-s3", '</div>\n          <span class="lbl">质量</span>\n          <div class="seg" id="studio-quality-seg">',
    '</div></span>\n          <span class="lbl-seg"><span class="lbl">质量</span>\n          <div class="seg" id="studio-quality-seg">')
rep("grp-s4", '</div>\n          <span class="lbl">引擎</span>',
    '</div></span>\n          <span class="lbl-seg"><span class="lbl">引擎</span>')
rep("grp-s5", '</div>\n          <button id="studio-gen-btn">',
    '</div></span>\n          <button id="studio-gen-btn">')

# 3. 视频工坊参数行
rep("grp-v1", '<div class="studio-row" style="margin-top:14px">\n          <span class="lbl">比例</span>',
    '<div class="studio-row" style="margin-top:14px">\n          <span class="lbl-seg"><span class="lbl">比例</span>')
rep("grp-v2", '</div>\n          <span class="lbl">时长</span>',
    '</div></span>\n          <span class="lbl-seg"><span class="lbl">时长</span>')
rep("grp-v3", '</div>\n          <label class="vs-toggle"><input type="checkbox" id="vs-audio" checked> 生成音效</label>',
    '</div></span>\n          <label class="vs-toggle"><input type="checkbox" id="vs-audio" checked> 生成音效</label>')

# 4. 电商参数行（12 空格缩进）
rep("grp-e1", '<div class="studio-row">\n            <span class="lbl">质量</span>',
    '<div class="studio-row">\n            <span class="lbl-seg"><span class="lbl">质量</span>')
rep("grp-e2", '</div>\n            <button id="ecom-gen-btn">',
    '</div></span>\n            <button id="ecom-gen-btn">')

# 5. lbl-seg 样式补进 ds-unify
rep("css-lbl-seg", "/* 标签与控件基线：12px 灰标签、10-12px 间距 */",
    """/* 标签与控件基线：12px 灰标签、10-12px 间距 */
.lbl-seg { display: inline-flex; align-items: center; gap: 10px; }""")

if errors:
    print("\n!! 硬失败，未写入:", errors)
    sys.exit(1)
open(PATH, "w", encoding="utf-8", newline="").write(s)
print("\n写入完成")
