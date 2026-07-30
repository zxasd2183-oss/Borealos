# make_anim.py — AI 真动画：4 个关键帧 → 240×240 循环 GIF
# 关键帧间交叉淡化（crossfade）补过渡帧，首尾相连无限循环，可程序叠字（黑体描边大字）
# 用法: python make_anim.py <spec.json>
# spec: {"frames": ["f0.png","f1.png","f2.png","f3.png"(绝对路径)], "caption": "叠字(可空)", "out": "输出.gif(绝对路径)"}
# stdout 打印 {"ok":true,"bytes":N,"frames":N,"colors":N,"ms":N} 或 {"error":"..."}
import sys
import os
import json
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from PIL import Image

# 复用 wechat_pack 的定版参数与叠字/编码函数（import 不触发 main）
from wechat_pack import (
    GIF_LIMIT, load_white_rgb, base_canvas, layout_text, draw_text,
)

DURATION_MS = 90  # 每帧 90ms


def keyframe_canvas(path):
    """读关键帧 → 压白底 → 缩进 200 盒 → 居中底对齐贴上 240 白画布。"""
    im = load_white_rgb(path, 200)
    base, _by = base_canvas(im)
    return base


def build_sequence(bases, caption, hold, blends):
    """hold=每个关键帧停留帧数；blends=到下一关键帧的淡化过渡帧数（首尾闭环）。"""
    seq = []
    n = len(bases)
    for i in range(n):
        cur, nxt = bases[i], bases[(i + 1) % n]
        for _ in range(hold):
            seq.append(cur)
        for b in range(1, blends + 1):
            seq.append(Image.blend(cur, nxt, b / (blends + 1)))
    if caption:
        lay = layout_text(caption, "caption")
        seq = [draw_text(fr, caption, "caption", "bottom", lay) for fr in seq]
    return seq


def encode_gif(frames, out_path, colors, dither):
    pal = frames[0].convert("P", palette=Image.ADAPTIVE, colors=colors)
    d = Image.FLOYDSTEINBERG if dither else Image.NONE
    fs = [pal] + [f.quantize(palette=pal, dither=d) for f in frames[1:]]
    fs[0].save(out_path, save_all=True, append_images=fs[1:],
               duration=DURATION_MS, loop=0, disposal=1, optimize=True)
    return os.path.getsize(out_path)


def save_within_limit(frames, out_path):
    for colors, dither in ((128, True), (128, False), (96, False), (64, False), (48, False)):
        size = encode_gif(frames, out_path, colors, dither)
        if size <= GIF_LIMIT:
            return size, colors
    return os.path.getsize(out_path), 48


def main():
    if len(sys.argv) != 2:
        print(json.dumps({"error": "用法: make_anim.py <spec.json>"}))
        return 2
    t0 = time.time()
    try:
        with open(sys.argv[1], "r", encoding="utf-8") as f:
            spec = json.load(f)
        paths = spec.get("frames") or []
        if len(paths) < 2:
            print(json.dumps({"error": "关键帧不足（至少 2 张）"}))
            return 2
        for p in paths:
            if not os.path.isfile(p):
                print(json.dumps({"error": "关键帧不存在: " + str(p)}))
                return 2
        caption = (spec.get("caption") or "").strip()[:12]
        out = spec["out"]
        bases = [keyframe_canvas(p) for p in paths]
        # 帧数自适应：16 帧（停留2+淡化2）→ 12 → 8 → 8 纯关键帧，直到 ≤500KB
        size, colors, seq_len = 0, 0, 0
        for hold, blends in ((2, 2), (1, 2), (1, 1), (2, 0)):
            seq = build_sequence(bases, caption, hold, blends)
            size, colors = save_within_limit(seq, out)
            seq_len = len(seq)
            if size <= GIF_LIMIT:
                break
        print(json.dumps({"ok": True, "bytes": size, "frames": seq_len, "colors": colors,
                          "withinLimit": size <= GIF_LIMIT,
                          "ms": int((time.time() - t0) * 1000)}, ensure_ascii=False))
        return 0
    except Exception as e:
        print(json.dumps({"error": "动画合成失败: %s" % e}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    sys.exit(main())
