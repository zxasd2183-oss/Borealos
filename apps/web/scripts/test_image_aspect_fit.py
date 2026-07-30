import json
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw


def run_tool(*args):
    tool = Path(__file__).with_name("imgtextedit_util.py")
    result = subprocess.run(
        [sys.executable, str(tool), *map(str, args)],
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(result.stdout.strip().splitlines()[-1])


def main():
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        source = root / "source.png"
        output = root / "output.png"

        image = Image.new("RGB", (600, 900), "white")
        draw = ImageDraw.Draw(image)
        draw.rectangle((100, 250, 500, 650), fill="black")
        image.save(source)

        status = run_tool("fit", source, output, 600, 1300, "cover")
        assert status["ok"]
        assert status["width"] == 600
        assert status["height"] == 1300
        assert status["mode"] == "cover"
        assert status["aspectPreserved"] is True

        with Image.open(output) as fitted:
            assert fitted.size == (600, 1300)
            # The central square remains square. A direct 600x900 -> 600x1300
            # stretch would turn it into a tall rectangle.
            pixels = fitted.load()
            black_x = [x for x in range(fitted.width) if pixels[x, fitted.height // 2][0] < 10]
            black_y = [y for y in range(fitted.height) if pixels[fitted.width // 2, y][0] < 10]
            assert abs(len(black_x) - len(black_y)) <= 3


if __name__ == "__main__":
    main()
    print("image aspect-fit tests passed")
