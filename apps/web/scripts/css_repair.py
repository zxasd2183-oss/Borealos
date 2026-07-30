# -*- coding: utf-8 -*-
"""修复 index.html 中 <style> 块里被历史乱码脚本留下的 CSS 垃圾断片。
这些断片（形如 `prop: value; }` 尾随在上一条规则之后）会让浏览器把紧接着的
下一条合法规则整条丢弃（如 #studio-prompt、.studio-card），造成控件比例失调。
只删除垃圾断片，不改动任何有效规则文本。"""
import re, sys

PATH = r"D:\KIMI\work-ui\index.html"
s = open(PATH, encoding="utf-8").read()

def clean_css(css, tag=""):
    """扫描一段 CSS，返回 (清理后文本, 删除片段列表)。"""
    out = []
    removed = []
    i, n = 0, len(css)

    def skip_ws_comments(j):
        while j < n:
            if css[j] in " \t\r\n":
                j += 1
            elif css.startswith("/*", j):
                k = css.find("*/", j)
                j = n if k < 0 else k + 2
            else:
                break
        return j

    def copy_block(j):
        """j 指向 '{'，返回整块（含引号感知）结束后的位置。"""
        depth = 0
        while j < n:
            c = css[j]
            if c in "\"'":
                q = c; j += 1
                while j < n and css[j] != q:
                    j += 2 if css[j] == "\\" else 1
            elif c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    return j + 1
            j += 1
        return j

    def scan(j, recurse_at):
        """扫描至 j_end（由调用者控制），就地追加到 out。"""
        nonlocal i
        while True:
            ws_start = j
            j = skip_ws_comments(j)
            if j >= n:
                out.append(css[ws_start:j])
                return j
            out.append(css[ws_start:j])  # 保留空白/注释
            c = css[j]
            if c == "}":
                # 游离的右括号 = 垃圾断片尾巴
                removed.append("lone-}")
                j += 1
                continue
            # 读取 prelude 直到 '{'，期间检测垃圾
            start = j
            garbage = False
            while j < n:
                c = css[j]
                if c in "\"'":
                    q = c; j += 1
                    while j < n and css[j] != q:
                        j += 2 if css[j] == "\\" else 1
                    j += 1  # 跳过收尾引号
                    continue
                if c == ";":
                    # at 语句（@import/@charset）合法；否则 prelude 含分号 = 垃圾
                    head = css[start:start + 16]
                    if head.lstrip().startswith("@") and "{" not in css[start:j]:
                        j += 1
                        out.append(css[start:j])  # 保留 at 语句
                        break
                    garbage = True
                    j += 1
                    continue
                if c == "}":
                    garbage = True
                    j += 1
                    removed.append(css[start:j].strip()[:90])
                    break
                if c == "{":
                    break
                j += 1
            else:
                out.append(css[start:j])
                return j
            if garbage:
                # 丢弃垃圾段，重新从当前位置扫描
                continue
            if css[j - 1] == ";" and css[start] == "@":
                continue  # 已输出 at 语句
            if j >= n or css[j] != "{":
                continue
            # 干净 prelude + '{'
            prelude = css[start:j]
            out.append(prelude)
            out.append("{")
            j += 1
            is_at = prelude.lstrip().startswith("@")
            if is_at and recurse_at:
                # @media/@keyframes 等：递归清理内部规则
                depth = 1
                inner_start = j
                # 找到匹配的内部区间，递归处理
                k = j
                while k < n and depth:
                    c = css[k]
                    if c in "\"'":
                        q = c; k += 1
                        while k < n and css[k] != q:
                            k += 2 if css[k] == "\\" else 1
                        k += 1  # 跳过收尾引号
                        continue
                    if c == "{":
                        depth += 1
                    elif c == "}":
                        depth -= 1
                        if depth == 0:
                            break
                    k += 1
                inner = css[inner_start:k]
                cleaned, rem2 = clean_css(inner, tag + "/at")
                removed.extend(rem2)
                out.append(cleaned)
                out.append("}")
                j = k + 1
            else:
                end = copy_block(j - 1)  # 从 '{' 起
                out.append(css[j:end])
                j = end
        return j

    scan(0, True)
    return "".join(out), removed

# 找所有 <style> 块
parts = re.split(r"(<style[^>]*>|</style>)", s)
assert len(parts) > 1, "no style blocks found"
res = []
in_style = False
total_removed = []
for p in parts:
    if p.startswith("<style"):
        in_style = True
        res.append(p)
    elif p == "</style>":
        in_style = False
        res.append(p)
    elif in_style:
        cleaned, rem = clean_css(p)
        total_removed.extend(rem)
        res.append(cleaned)
    else:
        res.append(p)
new = "".join(res)

print("删除的垃圾断片：", len(total_removed))
for r in total_removed:
    print("  -", repr(r))
if new == s:
    print("无变化"); sys.exit(0)
open(PATH, "w", encoding="utf-8", newline="").write(new)
print(f"已写入（{len(s)} -> {len(new)} 字符）")
