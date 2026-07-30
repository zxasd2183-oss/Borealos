# -*- coding: utf-8 -*-
# cutout.py — 一键抠图（本地 rembg u2net，输出透明背景 PNG）
# 用法: python cutout.py <输入图片> <输出png>
# 输出: stdout 单行 JSON：{ok:true, bytes, width, height} 或 {error:"..."}
import json
import sys

def main():
    if len(sys.argv) < 3:
        print(json.dumps({"error": "参数不足"}, ensure_ascii=False))
        return
    src, dst = sys.argv[1], sys.argv[2]
    try:
        from PIL import Image
        from rembg import remove
        img = Image.open(src).convert("RGBA")
        out = remove(img)  # 首次运行自动下载 u2net 模型（走环境代理）
        out.save(dst, "PNG")
        import os
        print(json.dumps({"ok": True, "bytes": os.path.getsize(dst),
                          "width": out.width, "height": out.height}, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"error": str(e)[:300]}, ensure_ascii=False))

if __name__ == "__main__":
    main()
