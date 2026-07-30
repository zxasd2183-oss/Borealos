# -*- coding: utf-8 -*-
"""带打印的 clean_css 跟踪版"""
s = open(r"D:\KIMI\work-ui\index.html", encoding="utf-8").read()
i = s.find("#studio-prompt {")
start = s.rfind("<style", 0, i) + 7
end = s.find("</style>", i)
css = s[start:end]
n = len(css)

out = []
removed = []

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
    depth = 0
    while j < n:
        c = css[j]
        if c in "\"'":
            q = c; j += 1
            while j < n and css[j] != q:
                j += 2 if css[j] == "\\" else 1
            continue
        elif c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return j + 1
        j += 1
    return j

j = 0
step = 0
while True:
    ws_start = j
    j = skip_ws_comments(j)
    if j >= n:
        break
    c = css[j]
    if c == "}":
        removed.append("lone-}")
        j += 1
        continue
    st = j
    garbage = False
    while j < n:
        c = css[j]
        if c in "\"'":
            q = c; j += 1
            while j < n and css[j] != q:
                j += 2 if css[j] == "\\" else 1
            continue
        if c == ";":
            head = css[st:st + 16]
            if head.lstrip().startswith("@") and "{" not in css[st:j]:
                j += 1
                break
            garbage = True
            j += 1
            continue
        if c == "}":
            garbage = True
            j += 1
            removed.append(css[st:j].strip()[:90])
            break
        if c == "{":
            break
        j += 1
    if garbage:
        if step < 40:
            print(step, "GARBAGE:", repr(css[st:j][:80]))
        step += 1
        continue
    if j >= n or css[j] != "{":
        if step < 40:
            print(step, "ODD:", repr(css[st:j][:80]))
        step += 1
        continue
    prelude = css[st:j]
    if step < 40:
        print(step, "RULE:", repr(prelude[:60]))
    step += 1
    j += 1
    j = copy_block(j - 1)

print("total steps:", step, "removed:", len(removed))
