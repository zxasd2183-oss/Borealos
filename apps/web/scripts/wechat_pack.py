# wechat_pack.py — 微信表情开放平台投稿包批量合成
# 主图 240x240 GIF（无限循环，≤500KB）+ 缩略图 120x120 PNG（≤200KB）+ 打包 zip
# 三件套：cover.png 240x240 ≤60KB（居中裁剪）、icon.png 50x50 ≤30KB（头部区域裁剪）、banner 750x400 ≤500KB（缩放裁剪）
# 用法: python wechat_pack.py <spec.json> <输出目录>          → 批量模式
#       python wechat_pack.py banner <输入图> <输出.png>       → 仅 banner 缩放（AI 生成图 → 750x400）
# spec.json: {"items":[{"input":"绝对路径","text":"文案(可空)","effect":"bounce","position":"bottom","style":"stroke"}],
#             "extras":{"cover_from":"参考图路径","icon_from":"参考图路径","banner_file":"banner.png(输出目录内已有文件,可选)"}}
# effect ∈ bounce/shake/sway/pulse/nod/flash；position ∈ top/bottom；style ∈ stroke(描边大字)/bubble(气泡框)/none(不叠字)
# stdout 打印 {"ok":true,...} 或 {"error":"..."}
import sys
import os
import json
import math
import time
import shutil
import zipfile

from PIL import Image, ImageEnhance, ImageDraw, ImageFont

EFFECTS = ("bounce", "shake", "sway", "pulse", "nod", "flash")
CANVAS = 240          # 主图边长
THUMB = 120           # 缩略图边长
FIT = 200             # 角色在画布内的最大边（留 20px 边距防动效裁切）
N_FRAMES = 8          # 小画布减帧：8 帧足够顺滑
DURATION_MS = 90      # 每帧 90ms，一圈 0.72s
GIF_LIMIT = 500 * 1024
THUMB_LIMIT = 200 * 1024
COVER_LIMIT = 60 * 1024    # 表情封面图 240×240 ≤60KB
ICON_LIMIT = 30 * 1024     # 聊天页图标 50×50 ≤30KB
BANNER_LIMIT = 500 * 1024  # 详情页横幅 750×400 ≤500KB

FONT_CANDIDATES = [
    "C:\\Windows\\Fonts\\simhei.ttf",   # 黑体，经典表情包字体
    "C:\\Windows\\Fonts\\msyh.ttc",     # 微软雅黑兜底
]


def load_font(size):
    for p in FONT_CANDIDATES:
        if os.path.isfile(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                continue
    return ImageFont.load_default()


def load_white_rgb(path, box):
    """读图 → 压白底 → 等比缩进 box×box 的角色图。"""
    im = Image.open(path)
    if im.mode in ("RGBA", "LA", "P"):
        im = im.convert("RGBA")
        bg = Image.new("RGBA", im.size, (255, 255, 255, 255))
        bg.paste(im, (0, 0), im)
        im = bg
    im = im.convert("RGB")
    r = box / max(im.size)
    if r < 1:
        im = im.resize((max(1, int(im.width * r)), max(1, int(im.height * r))), Image.LANCZOS)
    return im


def base_canvas(im):
    """角色居中贴在 240 白画布上（底部对齐，符合表情包构图）。"""
    cv = Image.new("RGB", (CANVAS, CANVAS), (255, 255, 255))
    cv.paste(im, ((CANVAS - im.width) // 2, CANVAS - 12 - im.height))  # 底边留 12px
    return cv, CANVAS - 12 - im.height  # 返回角色底边 y


# ---------- 动效帧（全部输出固定 240×240，防解码器花屏） ----------
def frame_bounce(im, base, by, t):
    hop = math.sin(math.pi * t)
    squash = 1.0 - 0.15 * (1.0 - hop) ** 3
    sx = 1.0 + (1.0 - squash) * 0.7
    W, H = im.size
    nw, nh = max(1, int(W * sx)), max(1, int(H * squash))
    img = im.resize((nw, nh), Image.LANCZOS)
    dy = int(-H * 0.10 * hop)
    out = Image.new("RGB", (CANVAS, CANVAS), (255, 255, 255))
    out.paste(img, ((CANVAS - nw) // 2, by + H - nh + dy))
    return out


def frame_shake(im, base, by, t):
    dx = int(im.width * 0.03 * math.sin(2 * math.pi * 3 * t))
    out = Image.new("RGB", (CANVAS, CANVAS), (255, 255, 255))
    out.paste(im, ((CANVAS - im.width) // 2 + dx, by))
    return out


def frame_sway(im, base, by, t):
    ang = 7.0 * math.sin(2 * math.pi * t)
    return base.rotate(ang, resample=Image.BICUBIC, center=(CANVAS // 2, by + im.height - 4), fillcolor=(255, 255, 255))


def frame_pulse(im, base, by, t):
    s = 1.0 + 0.12 * (0.5 - 0.5 * math.cos(2 * math.pi * t))
    W, H = im.size
    nw, nh = max(1, int(W * s)), max(1, int(H * s))
    img = im.resize((nw, nh), Image.LANCZOS)
    out = Image.new("RGB", (CANVAS, CANVAS), (255, 255, 255))
    out.paste(img, ((CANVAS - nw) // 2, by + H - nh))  # 底边锚定
    return out


def frame_nod(im, base, by, t):
    dip = 0.5 - 0.5 * math.cos(4 * math.pi * t)
    ang = 4.0 * math.sin(4 * math.pi * t)
    dy = int(im.height * 0.04 * dip)
    out = Image.new("RGB", (CANVAS, CANVAS), (255, 255, 255))
    out.paste(im, ((CANVAS - im.width) // 2, by + dy))
    return out.rotate(ang, resample=Image.BICUBIC, center=(CANVAS // 2, by), fillcolor=(255, 255, 255))


def frame_flash(im, base, by, t):
    factor = 1.0 + 0.3 * math.sin(2 * math.pi * t)
    return ImageEnhance.Brightness(base).enhance(factor)


FRAME_FN = {
    "bounce": frame_bounce, "shake": frame_shake, "sway": frame_sway,
    "pulse": frame_pulse, "nod": frame_nod, "flash": frame_flash,
}


# ---------- 文字叠加 ----------
def layout_text(text, style):
    """把文案排成 (font, lines, 总高, 每行宽)。
    caption=字幕小字：单行、自动缩小到一行放下；其余=经典大字：单行优先最多两行。"""
    if style == "caption":
        max_w = CANVAS - 24
        for size in (32, 30, 28, 26, 24, 22, 20, 18, 16, 14):  # ~13% 画布起，字多自动缩
            font = load_font(size)
            w = font.getlength(text)
            if w <= max_w:
                return font, [text], size + 4, [w]
        font = load_font(14)
        return font, [text], 18, [font.getlength(text)]
    max_w = CANVAS - 36
    for size in (42, 38, 34, 30, 26, 22, 18):
        font = load_font(size)
        # 先试单行
        w = font.getlength(text)
        if w <= max_w:
            return font, [text], size + 8, [w]
        # 两行均分（按字数切，尽量均衡）
        mid = (len(text) + 1) // 2
        l1, l2 = text[:mid], text[mid:]
        w1, w2 = font.getlength(l1), font.getlength(l2)
        if w1 <= max_w and w2 <= max_w:
            return font, [l1, l2], (size + 6) * 2, [w1, w2]
    font = load_font(18)
    mid = (len(text) + 1) // 2
    return font, [text[:mid], text[mid:]], 48, [font.getlength(text[:mid]), font.getlength(text[mid:])]


def draw_text(frame, text, style, position, layout):
    """在帧上叠文字。caption=字幕小字（白字细黑边，电影字幕感）；stroke=经典大字（黑字白粗描边）；bubble=圆角半透明白底框+黑字。"""
    if not text or style == "none":
        return frame
    font, lines, total_h, widths = layout
    line_h = font.size + 6
    pad = 8
    if style == "caption":
        d = ImageDraw.Draw(frame)
        sw = 2 if font.size >= 24 else 1  # 细黑边，不是粗白边
        total = line_h * len(lines)
        ty = pad if position == "top" else CANVAS - total - pad + 2
        for ln in lines:
            d.text((CANVAS / 2, ty), ln, font=font, fill=(255, 255, 255), anchor="ma",
                   stroke_width=sw, stroke_fill=(15, 15, 15))
            ty += line_h
        return frame
    if style == "bubble":
        box_w = int(max(widths)) + 28
        box_h = total_h + 14
        y0 = pad if position == "top" else CANVAS - box_h - pad
        overlay = Image.new("RGBA", frame.size, (0, 0, 0, 0))
        od = ImageDraw.Draw(overlay)
        od.rounded_rectangle([(CANVAS - box_w) // 2, y0, (CANVAS + box_w) // 2, y0 + box_h],
                             radius=12, fill=(255, 255, 255, 217))  # ~85% 白
        frame = Image.alpha_composite(frame.convert("RGBA"), overlay).convert("RGB")
        d = ImageDraw.Draw(frame)
        ty = y0 + 7
        for i, ln in enumerate(lines):
            d.text((CANVAS / 2, ty), ln, font=font, fill=(25, 25, 25), anchor="ma")
            ty += line_h
        return frame
    # stroke 描边大字
    d = ImageDraw.Draw(frame)
    sw = max(2, font.size // 7)
    total = line_h * len(lines)
    ty = pad + 2 if position == "top" else CANVAS - total - pad
    for ln in lines:
        d.text((CANVAS / 2, ty), ln, font=font, fill=(25, 25, 25), anchor="ma",
               stroke_width=sw, stroke_fill=(255, 255, 255))
        ty += line_h
    return frame


# ---------- GIF 体积自适应压缩 ----------
def encode_gif(rgb_frames, out_path, colors, dither):
    pal_src = rgb_frames[0]
    pal = pal_src.convert("P", palette=Image.ADAPTIVE, colors=colors)
    d = Image.FLOYDSTEINBERG if dither else Image.NONE
    frames = [pal] + [fr.quantize(palette=pal, dither=d) for fr in rgb_frames[1:]]
    frames[0].save(out_path, save_all=True, append_images=frames[1:],
                   duration=DURATION_MS, loop=0, disposal=1, optimize=True)
    return os.path.getsize(out_path)


def save_gif_within_limit(rgb_frames, out_path):
    """逐级降压：128 色抖动 → 128 色不抖动 → 64 色 → 48 色，直到 ≤500KB。"""
    for colors, dither in ((128, True), (128, False), (96, False), (64, False), (48, False)):
        size = encode_gif(rgb_frames, out_path, colors, dither)
        if size <= GIF_LIMIT:
            return size, colors
    return os.path.getsize(out_path), 48  # 兜底（理论上到不了）


def make_one(item, idx, out_dir):
    """合成一张：返回 {gif, gifBytes, png, pngBytes, frames, colors, src}"""
    stem = "%02d" % idx
    gif_path = os.path.join(out_dir, stem + ".gif")
    png_path = os.path.join(out_dir, stem + ".png")
    # ✨ AI 真动画版主图：直接拷贝（已叠字，绝不再叠），缩略图取 GIF 中间帧
    anim_gif = item.get("anim_gif")
    if anim_gif and os.path.isfile(anim_gif):
        shutil.copyfile(anim_gif, gif_path)
        gif_bytes = os.path.getsize(gif_path)
        im = Image.open(gif_path)
        n = getattr(im, "n_frames", 1)
        im.seek(n // 2)
        thumb = im.convert("RGB").resize((THUMB, THUMB), Image.LANCZOS)
        thumb.save(png_path, optimize=True)
        png_bytes = os.path.getsize(png_path)
        return {
            "gif": stem + ".gif", "gifBytes": gif_bytes, "png": stem + ".png", "pngBytes": png_bytes,
            "frames": n, "colors": None, "text": None, "src": "anim",
            "gifOk": gif_bytes <= GIF_LIMIT, "pngOk": png_bytes <= THUMB_LIMIT,
        }
    # ⚡ 模板版：程序动效 + 程序叠字
    effect = item.get("effect") if item.get("effect") in EFFECTS else "bounce"
    position = "top" if item.get("position") == "top" else "bottom"
    style = item.get("style") if item.get("style") in ("caption", "stroke", "bubble", "none") else "caption"
    text = (item.get("text") or "").strip()[:12]
    im = load_white_rgb(item["input"], FIT)
    base, by = base_canvas(im)
    fn = FRAME_FN[effect]
    layout = layout_text(text, style) if text and style != "none" else None
    rgb_frames = []
    for i in range(N_FRAMES):
        fr = fn(im, base, by, i / N_FRAMES)
        fr = draw_text(fr, text, style, position, layout)
        rgb_frames.append(fr)
    gif_bytes, colors = save_gif_within_limit(rgb_frames, gif_path)
    # 缩略图：取中间帧 → 120×120 PNG
    thumb = rgb_frames[N_FRAMES // 2].resize((THUMB, THUMB), Image.LANCZOS)
    thumb.save(png_path, optimize=True)
    png_bytes = os.path.getsize(png_path)
    return {
        "gif": stem + ".gif", "gifBytes": gif_bytes, "png": stem + ".png", "pngBytes": png_bytes,
        "frames": N_FRAMES, "colors": colors, "text": text or None, "src": "template",
        "gifOk": gif_bytes <= GIF_LIMIT, "pngOk": png_bytes <= THUMB_LIMIT,
    }


# ---------- 三件套（cover / icon / banner） ----------
def load_flat(path):
    """读图压白底转 RGB（不缩放）。"""
    im = Image.open(path)
    if im.mode in ("RGBA", "LA", "P"):
        im = im.convert("RGBA")
        bg = Image.new("RGBA", im.size, (255, 255, 255, 255))
        bg.paste(im, (0, 0), im)
        im = bg
    return im.convert("RGB")


def save_png_within_limit(im, out_path, limit):
    """PNG 落盘，超限逐级降色（256→128→64）。返回实际字节数。"""
    im.save(out_path, optimize=True)
    if os.path.getsize(out_path) <= limit:
        return os.path.getsize(out_path)
    for colors in (256, 128, 64):
        q = im.convert("P", palette=Image.ADAPTIVE, colors=colors)
        q.save(out_path, optimize=True)
        if os.path.getsize(out_path) <= limit:
            return os.path.getsize(out_path)
    return os.path.getsize(out_path)


def center_square(im, top_ratio=None):
    """居中裁正方形；top_ratio 给定时从顶部取（裁头部区域，icon 用）。"""
    w, h = im.size
    if top_ratio is None:
        side = min(w, h)
        x, y = (w - side) // 2, (h - side) // 2
    else:
        side = min(w, int(h * top_ratio))
        x, y = (w - side) // 2, 0
    return im.crop((x, y, x + side, y + side))


def make_cover(src, out_path):
    """表情封面图：居中裁方 → 240×240 PNG ≤60KB。"""
    im = center_square(load_flat(src)).resize((240, 240), Image.LANCZOS)
    return save_png_within_limit(im, out_path, COVER_LIMIT)


def make_icon(src, out_path):
    """聊天页图标：顶部 62% 取头部区域裁方 → 50×50 PNG ≤30KB。"""
    im = center_square(load_flat(src), 0.62).resize((50, 50), Image.LANCZOS)
    return save_png_within_limit(im, out_path, ICON_LIMIT)


def make_banner(src, out_png):
    """详情页横幅：cover 式缩放裁剪 → 750×400 ≤500KB（PNG 优先，超限降色，再不行退 JPEG）。
    返回 (实际文件名, 字节数)。"""
    im = load_flat(src)
    tw, th = 750, 400
    r = max(tw / im.width, th / im.height)
    im = im.resize((int(im.width * r + 0.5), int(im.height * r + 0.5)), Image.LANCZOS)
    x, y = (im.width - tw) // 2, (im.height - th) // 2
    im = im.crop((x, y, x + tw, y + th))
    size = save_png_within_limit(im, out_png, BANNER_LIMIT)
    if size <= BANNER_LIMIT:
        return os.path.basename(out_png), size
    # PNG 降色后仍超限 → 规范允许 JPEG，退 JPEG
    jpg = out_png[:-4] + ".jpg"
    im.save(jpg, quality=88, optimize=True)
    if os.path.getsize(jpg) > BANNER_LIMIT:
        im.save(jpg, quality=72, optimize=True)
    try:
        os.remove(out_png)
    except OSError:
        pass
    return os.path.basename(jpg), os.path.getsize(jpg)


def banner_mode(src, out_png):
    """CLI 子命令：AI 生成的横幅原图 → 750×400。"""
    try:
        fname, size = make_banner(src, out_png)
        print(json.dumps({"ok": True, "file": fname, "bytes": size, "withinLimit": size <= BANNER_LIMIT}))
        return 0
    except Exception as e:
        print(json.dumps({"error": "banner 合成失败: %s" % e}, ensure_ascii=False))
        return 1


def main():
    if len(sys.argv) == 4 and sys.argv[1] == "banner":
        return banner_mode(sys.argv[2], sys.argv[3])
    if len(sys.argv) != 3:
        print(json.dumps({"error": "用法: wechat_pack.py <spec.json> <输出目录> | wechat_pack.py banner <输入图> <输出.png>"}))
        return 2
    spec_path, out_dir = sys.argv[1], sys.argv[2]
    t0 = time.time()
    try:
        with open(spec_path, "r", encoding="utf-8") as f:
            spec = json.load(f)
        items = spec.get("items") or []
        if not items:
            print(json.dumps({"error": "spec 里没有条目"}))
            return 2
        os.makedirs(out_dir, exist_ok=True)
        files = []
        for i, item in enumerate(items, 1):
            if not os.path.isfile(item.get("input", "")):
                print(json.dumps({"error": "输入文件不存在: " + str(item.get("input"))}))
                return 2
            files.append(make_one(item, i, out_dir))
        # 三件套：cover/icon 程序合成；banner 用输出目录里已有的文件（export-banner 事先生成）
        extras = spec.get("extras") or {}
        extra_files = []
        if extras.get("cover_from") and os.path.isfile(extras["cover_from"]):
            b = make_cover(extras["cover_from"], os.path.join(out_dir, "cover.png"))
            extra_files.append({"file": "cover.png", "bytes": b, "ok": b <= COVER_LIMIT})
        if extras.get("icon_from") and os.path.isfile(extras["icon_from"]):
            b = make_icon(extras["icon_from"], os.path.join(out_dir, "icon.png"))
            extra_files.append({"file": "icon.png", "bytes": b, "ok": b <= ICON_LIMIT})
        banner_file = extras.get("banner_file")
        if banner_file and banner_file in ("banner.png", "banner.jpg") and os.path.isfile(os.path.join(out_dir, banner_file)):
            b = os.path.getsize(os.path.join(out_dir, banner_file))
            extra_files.append({"file": banner_file, "bytes": b, "ok": b <= BANNER_LIMIT})
        # 打包 zip（01.gif/01.png… 按序 + 三件套，微信投稿直接可用）
        zip_name = "wechat-pack.zip"
        zip_path = os.path.join(out_dir, zip_name)
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
            for f in files:
                z.write(os.path.join(out_dir, f["gif"]), f["gif"])
                z.write(os.path.join(out_dir, f["png"]), f["png"])
            for e in extra_files:
                z.write(os.path.join(out_dir, e["file"]), e["file"])
        print(json.dumps({"ok": True, "files": files, "extras": extra_files, "zip": zip_name,
                          "zipBytes": os.path.getsize(zip_path),
                          "ms": int((time.time() - t0) * 1000)}, ensure_ascii=False))
        return 0
    except Exception as e:
        print(json.dumps({"error": "投稿包合成失败: %s" % e}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    sys.exit(main())
