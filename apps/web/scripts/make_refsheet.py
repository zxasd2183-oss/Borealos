# -*- coding: utf-8 -*-
# make_refsheet.py — 一键换装：把人物图 + 1~3 张服装素材拼成一张参考大图
# 用法: python make_refsheet.py <人物图> <素材1> [素材2] [素材3] <输出png>（最后一个是输出）
# 输出: stdout 单行 JSON：{ok:true, width, height} 或 {error:"..."}
import json
import sys

def main():
    args = sys.argv[1:]
    if len(args) < 3:
        print(json.dumps({"error": "参数不足"}, ensure_ascii=False))
        return
    srcs, dst = args[:-1], args[-1]
    if len(srcs) > 4:
        srcs = srcs[:4]
    try:
        from PIL import Image, ImageDraw
        H = 1024
        LABEL_H = 56
        tiles = []
        labels = ["人物"] + ["素材%d" % i for i in range(1, len(srcs))]
        for p in srcs:
            img = Image.open(p).convert("RGB")
            w = int(img.width * H / img.height)
            tiles.append(img.resize((w, H), Image.LANCZOS))
        W = sum(t.width for t in tiles) + 20 * (len(tiles) + 1)
        sheet = Image.new("RGB", (W, H + LABEL_H + 20), (255, 255, 255))
        d = ImageDraw.Draw(sheet)
        x = 20
        for lab, t in zip(labels, tiles):
            d.rectangle([x, 10, x + 120, 10 + LABEL_H - 12], fill=(124, 58, 237))
            d.text((x + 14, 22), lab, fill=(255, 255, 255))
            sheet.paste(t, (x, LABEL_H + 10))
            x += t.width + 20
        # i2i 输入限制：宽度过大时整体缩到 2048 以内
        if sheet.width > 2048:
            nh = int(sheet.height * 2048 / sheet.width)
            sheet = sheet.resize((2048, nh), Image.LANCZOS)
        sheet.save(dst, "PNG")
        print(json.dumps({"ok": True, "width": sheet.width, "height": sheet.height}, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"error": str(e)[:300]}, ensure_ascii=False))

if __name__ == "__main__":
    main()
