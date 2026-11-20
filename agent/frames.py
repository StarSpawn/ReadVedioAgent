"""Create timestamped contact sheets for visual inspection. All times are seconds."""
import argparse
import io
import math
from pathlib import Path
import subprocess

from PIL import Image, ImageDraw

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("video", type=Path)
parser.add_argument("directory", type=Path)
for name in ("start", "end", "step"):
    parser.add_argument(name, type=float)
parser.add_argument("--width", type=int, default=240)
args = parser.parse_args()
if not all(map(math.isfinite, (args.start, args.end, args.step))) or not (
    0 <= args.start < args.end and args.step > 0 and args.width > 0
):
    parser.error("expected 0 <= start < end, a positive step and width")
args.directory.mkdir(parents=True, exist_ok=False)
count = math.ceil((args.end - args.start) / args.step)
for index in range(count):
    timestamp = args.start + index * args.step
    data = subprocess.check_output([
        "ffmpeg", "-v", "error", "-ss", f"{timestamp:.6f}", "-i", str(args.video),
        "-map", "0:v:0", "-frames:v", "1", "-vf", f"scale={args.width}:-1",
        "-c:v", "mjpeg", "-f", "image2pipe", "pipe:1"
    ])
    if not data:
        raise SystemExit(f"No frame at {timestamp:.3f}s. Check the end time.")
    with Image.open(io.BytesIO(data)) as frame:
        slot = index % 12
        if slot == 0:
            height = frame.height + 22
            sheet = Image.new("RGB", (args.width * min(4, count - index),
                height * math.ceil(min(12, count - index) / 4)))
        x, y = slot % 4 * args.width, slot // 4 * height
        sheet.paste(frame.convert("RGB"), (x, y))
        ImageDraw.Draw(sheet).text((x + 4, y + height - 18), f"{timestamp:.3f} s")
    if slot == 11 or index + 1 == count:
        sheet.save(args.directory / f"sheet-{index // 12 + 1:04d}.jpg", quality=90)
