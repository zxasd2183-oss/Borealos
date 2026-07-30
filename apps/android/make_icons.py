from PIL import Image
import os

src = Image.open(r"D:\KIMI\work-ui\icons\icon-512.png").convert("RGBA")
sizes = {
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192,
}
base = r"D:\KIMI\nexa-apk\app\src\main\res"
for folder, px in sizes.items():
    d = os.path.join(base, folder)
    os.makedirs(d, exist_ok=True)
    img = src.resize((px, px), Image.LANCZOS)
    img.save(os.path.join(d, "ic_launcher.png"), "PNG")
    print(folder, px, "ok")
