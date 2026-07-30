# make_gif.py — 静态表情图 + 程序动效模板 → GIF（Pillow，不走 AI）
# 用法: python make_gif.py <输入PNG> <effect> <输出GIF>
# effect ∈ bounce / shake / sway / pulse / nod / flash
# 输出: stdout 打印 JSON {"ok":true,"frames":N,"ms":M} 或 {"error":"..."}
import sys
import os
import json
import math
import time

from PIL import Image, ImageEnhance

EFFECTS = ("bounce", "shake", "sway", "pulse", "nod", "flash")
N_FRAMES = 12
DURATION_MS = 70  # 每帧 70ms，一圈约 0.84 秒
MAX_SIDE = 480    # 源图常为 1-2K 分辨率，GIF 前先降到 480px 控制文件体积


def load_white_rgba(path):
    """读图并压到白底（输入是白底图，保持白底）。"""
    im = Image.open(path)
    if im.mode in ("RGBA", "LA", "P"):
        im = im.convert("RGBA")
        bg = Image.new("RGBA", im.size, (255, 255, 255, 255))
        bg.paste(im, (0, 0), im)
        im = bg
    im = im.convert("RGB")
    if max(im.size) > MAX_SIDE:
        r = MAX_SIDE / max(im.size)
        im = im.resize((max(1, int(im.width * r)), max(1, int(im.height * r))), Image.LANCZOS)
    return im


def make_canvas(im, margin_ratio=0.18):
    """放大画布防变换裁边，白底。"""
    w, h = im.size
    m = int(max(w, h) * margin_ratio)
    cv = Image.new("RGB", (w + 2 * m, h + 2 * m), (255, 255, 255))
    cv.paste(im, (m, m))
    return cv, m


def frame_bounce(im, m, t, W, H):
    """弹跳：单周期上下跳（sin 天然缓动），底部压扁回弹（体积补偿）。
    底边锚定 + 固定画布尺寸（GIF 要求各帧同尺寸，否则部分解码器出现花屏）。"""
    hop = math.sin(math.pi * t)  # 0→1→0
    squash = 1.0 - 0.16 * (1.0 - hop) ** 3  # 落地瞬间 0.84，空中回 1
    sx = 1.0 + (1.0 - squash) * 0.7  # 压扁变宽
    nw, nh = max(1, int(W * sx)), max(1, int(H * squash))
    img = im.resize((nw, nh), Image.LANCZOS)
    cv, mm = make_canvas(im, 0.10)  # im 固定 → 画布尺寸固定
    dy = int(-H * 0.09 * hop)
    out = Image.new("RGB", cv.size, (255, 255, 255))
    out.paste(img, ((cv.width - nw) // 2, mm + H - nh + dy))  # 底边对齐原图底边
    return out


def frame_shake(im, m, t, W, H):
    """左右抖动：一圈 3 次快速小幅横移。"""
    dx = int(W * 0.022 * math.sin(2 * math.pi * 3 * t))
    cv, _ = make_canvas(im, 0.05)
    out = Image.new("RGB", cv.size, (255, 255, 255))
    out.paste(im, ((cv.width - W) // 2 + dx, (cv.height - H) // 2))
    return out


def frame_sway(im, m, t, W, H):
    """摇头摇摆：绕底部中心 ±8°，sin 缓动。"""
    ang = 8.0 * math.sin(2 * math.pi * t)
    cv, mm = make_canvas(im)
    return cv.rotate(ang, resample=Image.BICUBIC, center=(cv.width // 2, cv.height - mm // 2), fillcolor=(255, 255, 255))


def frame_pulse(im, m, t, W, H):
    """脉冲放大：1.0→1.15→1.0 呼吸缩放（cos 缓动）。"""
    s = 1.0 + 0.15 * (0.5 - 0.5 * math.cos(2 * math.pi * t))
    nw, nh = max(1, int(W * s)), max(1, int(H * s))
    img = im.resize((nw, nh), Image.LANCZOS)
    cv, _ = make_canvas(im)
    out = Image.new("RGB", cv.size, (255, 255, 255))
    out.paste(img, ((cv.width - nw) // 2, (cv.height - nh) // 2))
    return out


def frame_nod(im, m, t, W, H):
    """点头：一圈两次小俯身（垂直 cos 缓动）+ 绕顶部微旋。"""
    dip = 0.5 - 0.5 * math.cos(4 * math.pi * t)  # 两次下潜
    ang = 4.0 * math.sin(4 * math.pi * t)
    dy = int(H * 0.03 * dip)
    cv, mm = make_canvas(im)
    out = Image.new("RGB", cv.size, (255, 255, 255))
    out.paste(im, (mm, mm + dy))
    return out.rotate(ang, resample=Image.BICUBIC, center=(cv.width // 2, mm), fillcolor=(255, 255, 255))


def frame_flash(im, m, t, W, H):
    """闪烁发光：亮度 0.7→1.35 周期变化（sin 缓动）。"""
    factor = 1.0 + 0.35 * math.sin(2 * math.pi * t)
    cv, _ = make_canvas(im, 0.05)
    return ImageEnhance.Brightness(cv).enhance(factor)


FRAME_FN = {
    "bounce": frame_bounce,
    "shake": frame_shake,
    "sway": frame_sway,
    "pulse": frame_pulse,
    "nod": frame_nod,
    "flash": frame_flash,
}


def main():
    if len(sys.argv) != 4:
        print(json.dumps({"error": "参数数量不对"}))
        return 2
    inp, effect, outp = sys.argv[1], sys.argv[2], sys.argv[3]
    if effect not in EFFECTS:
        print(json.dumps({"error": "未知动效: " + effect}))
        return 2
    if not os.path.isfile(inp):
        print(json.dumps({"error": "输入文件不存在"}))
        return 2
    t0 = time.time()
    try:
        im = load_white_rgba(inp)
        W, H = im.size
        fn = FRAME_FN[effect]
        rgb_frames = [fn(im, 0, i / N_FRAMES, W, H) for i in range(N_FRAMES)]
        # 全部帧共享同一调色板（逐帧独立调色板 + 部分帧优化会导致部分解码器花屏）
        pal = rgb_frames[0].convert("P", palette=Image.ADAPTIVE, colors=256)
        frames = [pal] + [fr.quantize(palette=pal, dither=Image.FLOYDSTEINBERG) for fr in rgb_frames[1:]]
        os.makedirs(os.path.dirname(outp), exist_ok=True)
        frames[0].save(
            outp,
            save_all=True,
            append_images=frames[1:],
            duration=DURATION_MS,
            loop=0,       # 无限循环
            disposal=1,   # 全帧覆盖，不清屏
            optimize=True,
        )
        print(json.dumps({"ok": True, "frames": len(frames), "ms": int((time.time() - t0) * 1000)}))
        return 0
    except Exception as e:
        print(json.dumps({"error": "GIF 合成失败: %s" % e}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
