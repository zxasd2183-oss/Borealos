# -*- coding: utf-8 -*-
# 程序化绘制 Nexa 应用图标：macOS 风圆角矩形 + 浅紫→浅蓝渐变 + 白色 N
from PIL import Image, ImageDraw, ImageFont
import math, os

OUT = r"D:\KIMI\work-ui\icons"
os.makedirs(OUT, exist_ok=True)

# 渐变两端色：浅紫 -> 浅蓝
C1 = (167, 139, 250)   # violet-400 浅紫
C2 = (96, 165, 250)    # blue-400 浅蓝

def lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))

def rounded_gradient(size, radius_ratio=0.225, maskable=False):
    """对角线渐变 + 圆角。maskable 时安全区内缩（图形占 80%）。"""
    S = size * 4  # 超采样抗锯齿
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    grad = Image.new("RGBA", (S, S))
    gd = ImageDraw.Draw(grad)
    # 对角线渐变（逐行 + 逐列插值太耗时，用对角参数化）
    for y in range(S):
        # 每行按 (x+y)/(2S) 渐变，这里先按行画，再在列方向叠加
        pass
    # 用 numpy 更快
    import numpy as np
    xx, yy = np.meshgrid(np.linspace(0, 1, S), np.linspace(0, 1, S))
    t = (xx + yy) / 2.0
    arr = np.zeros((S, S, 4), dtype=np.uint8)
    for i in range(3):
        arr[..., i] = (C1[i] + (C2[i] - C1[i]) * t).astype(np.uint8)
    arr[..., 3] = 255
    grad = Image.fromarray(arr, "RGBA")

    # 顶部高光：轻微白色径向提亮
    hi = Image.new("L", (S, S), 0)
    hd = ImageDraw.Draw(hi)
    hd.ellipse([-S * 0.35, -S * 0.55, S * 1.05, S * 0.55], fill=38)
    white = Image.new("RGBA", (S, S), (255, 255, 255, 255))
    grad = Image.composite(white, grad, hi.point(lambda v: v))

    # 圆角蒙版
    r = 0 if maskable else int(S * radius_ratio)  # maskable 必须满幅无透明角
    inset = 0 if not maskable else 0
    mask = Image.new("L", (S, S), 0)
    md = ImageDraw.Draw(mask)
    md.rounded_rectangle([inset, inset, S - 1 - inset, S - 1 - inset], radius=r, fill=255)
    img.paste(grad, (0, 0), mask)

    # 白色 B（竖杆 + 上下两个右半圆碗，圆头粗线）
    d = ImageDraw.Draw(img)
    # maskable 时图形缩到 80% 安全区
    scale = 0.80 if maskable else 1.0
    m = S * (1 - scale) / 2  # 边距
    usable = S * scale
    stroke = int(usable * 0.15)
    col = (255, 255, 255, 245)
    x0 = m + usable * 0.26          # 竖杆 x
    y0 = m + usable * 0.22
    y1 = m + usable * 0.78
    H = y1 - y0
    r1 = H * 0.245                  # 上碗半径
    r2 = H * 0.265                  # 下碗半径（略大，B 的经典比例）
    # 竖杆
    d.line([x0, y0, x0, y1], fill=col, width=stroke)
    # 上碗 / 下碗（右半圆，圆心在杆右缘）
    d.arc([x0, y0, x0 + 2 * r1, y0 + 2 * r1], start=-90, end=90, fill=col, width=stroke)
    d.arc([x0, y1 - 2 * r2, x0 + 2 * r2, y1], start=-90, end=90, fill=col, width=stroke)
    # 顶 / 中 / 底 三处横接头
    d.line([x0, y0, x0 + r1, y0], fill=col, width=stroke)
    d.line([x0, y0 + 2 * r1, x0 + r1, y0 + 2 * r1], fill=col, width=stroke)
    d.line([x0, y1, x0 + r2, y1], fill=col, width=stroke)

    return img.resize((size, size), Image.LANCZOS)

for sz in (192, 512):
    rounded_gradient(sz, maskable=False).save(os.path.join(OUT, f"icon-{sz}.png"))
    rounded_gradient(sz, maskable=True).save(os.path.join(OUT, f"icon-maskable-{sz}.png"))
    print("saved", sz)
