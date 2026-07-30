# -*- coding: utf-8 -*-
"""
一键改字图像工具：尺寸探测 + 精确重采样回原尺寸
用法（stdout 最后一行输出单行 JSON，与 runPy 约定一致）：
  python imgtextedit_util.py size <img>                 -> {"ok":true,"width":W,"height":H,"format":"PNG"}
  python imgtextedit_util.py resize <src> <dst> <W> <H> -> 直接重采样到精确 W×H（兼容旧调用）
  python imgtextedit_util.py fit <src> <dst> <W> <H> cover -> 等比缩放后居中裁切，禁止拉伸
"""
import sys, os, json
from PIL import Image, ImageOps

Image.MAX_IMAGE_PIXELS = None  # 平板/电商大图不拦


def out(j):
    print(json.dumps(j, ensure_ascii=False))


def main():
    if len(sys.argv) < 3:
        out({"error": "参数不足"}); return
    mode = sys.argv[1]
    try:
        if mode == "size":
            with Image.open(sys.argv[2]) as im:
                im.verify()
            with Image.open(sys.argv[2]) as im:
                out({"ok": True, "width": im.width, "height": im.height, "format": im.format or "?"})
        elif mode == "resize":
            src, dst, w, h = sys.argv[2], sys.argv[3], int(sys.argv[4]), int(sys.argv[5])
            if w <= 0 or h <= 0 or w > 16384 or h > 16384:
                out({"error": "目标尺寸非法: %dx%d" % (w, h)}); return
            with Image.open(src) as im:
                if im.width == w and im.height == h:
                    if os.path.abspath(src) != os.path.abspath(dst):
                        im.save(dst, "PNG")
                    out({"ok": True, "width": w, "height": h, "bytes": os.path.getsize(dst), "unchanged": True}); return
                has_alpha = im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info)
                im2 = im.convert("RGBA" if has_alpha else "RGB")
                im2 = im2.resize((w, h), Image.LANCZOS)
                im2.save(dst, "PNG")
            out({"ok": True, "width": w, "height": h, "bytes": os.path.getsize(dst), "resampled": True})
        elif mode == "fit":
            if len(sys.argv) < 7:
                out({"error": "fit 参数不足"}); return
            src, dst, w, h = sys.argv[2], sys.argv[3], int(sys.argv[4]), int(sys.argv[5])
            fit_mode = sys.argv[6].lower()
            if w <= 0 or h <= 0 or w > 16384 or h > 16384:
                out({"error": "目标尺寸非法: %dx%d" % (w, h)}); return
            if fit_mode != "cover":
                out({"error": "未知 fit 模式: " + fit_mode}); return
            with Image.open(src) as im:
                has_alpha = im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info)
                base = im.convert("RGBA" if has_alpha else "RGB")
                fitted = ImageOps.fit(
                    base,
                    (w, h),
                    method=Image.Resampling.LANCZOS,
                    centering=(0.5, 0.5),
                )
                fitted.save(dst, "PNG")
            out({
                "ok": True,
                "width": w,
                "height": h,
                "bytes": os.path.getsize(dst),
                "mode": "cover",
                "aspectPreserved": True,
            })
        else:
            out({"error": "未知模式: " + mode})
    except Exception as e:
        out({"error": str(e)[:300]})


if __name__ == "__main__":
    main()
