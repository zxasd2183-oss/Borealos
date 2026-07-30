# -*- coding: utf-8 -*-
s = open(r"D:\KIMI\work-ui\index.html", encoding="utf-8").read()
i = s.find("#studio-prompt {")
start = s.rfind("<style", 0, i) + 7
end = s.find("</style>", i)
css = s[start:end]
n = len(css)
j = 0
count = 0

def skip_ws(j):
    while j < n:
        if css[j] in " \t\r\n":
            j += 1
        elif css.startswith("/*", j):
            k = css.find("*/", j)
            j = n if k < 0 else k + 2
        else:
            break
    return j

while j < n and count < 30:
    j = skip_ws(j)
    if j >= n:
        break
    c = css[j]
    if c == "}":
        print(count, "LONE }")
        j += 1
        count += 1
        continue
    st = j
    while j < n and css[j] not in "{};":
        if css[j] in "\"'":
            q = css[j]; j += 1
            while j < n and css[j] != q:
                j += 2 if css[j] == "\\" else 1
            continue
        j += 1
    print(count, "prelude->", repr(css[st:j][:70]), "next:", repr(css[j] if j < n else "EOF"))
    if j < n and css[j] == "{":
        depth = 0
        while j < n:
            cc = css[j]
            if cc in "\"'":
                q = cc; j += 1
                while j < n and css[j] != q:
                    j += 2 if css[j] == "\\" else 1
                continue
            elif cc == "{":
                depth += 1
            elif cc == "}":
                depth -= 1
                if depth == 0:
                    j += 1
                    break
            j += 1
    else:
        j += 1
    count += 1
