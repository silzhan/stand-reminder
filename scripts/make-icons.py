from pathlib import Path
import math

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / "build"
BUILD.mkdir(exist_ok=True)

SIZE = 1024
img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)

# Rounded pine background with a subtle vertical gradient.
for y in range(SIZE):
    t = y / (SIZE - 1)
    r = round(20 * (1 - t) + 11 * t)
    g = round(66 * (1 - t) + 43 * t)
    b = round(57 * (1 - t) + 37 * t)
    draw.line([(0, y), (SIZE, y)], fill=(r, g, b, 255))
mask = Image.new("L", (SIZE, SIZE), 0)
ImageDraw.Draw(mask).rounded_rectangle((0, 0, SIZE - 1, SIZE - 1), radius=226, fill=255)
img.putalpha(mask)

draw = ImageDraw.Draw(img)
cream = (244, 238, 217, 255)
cream_soft = (225, 218, 193, 255)
amber = (231, 174, 92, 255)

# A calm halo and a progress-like arc.
draw.ellipse((194, 162, 830, 798), fill=(255, 255, 255, 16))
draw.ellipse((250, 218, 774, 742), outline=(244, 238, 217, 54), width=12)
draw.arc((230, 198, 794, 762), start=292, end=603, fill=amber, width=24)
draw.ellipse((783, 178, 843, 238), fill=amber)

# Abstract person standing tall.
draw.ellipse((470, 294, 554, 378), fill=cream)
line = 34
# Torso and spine
draw.line([(512, 402), (500, 552)], fill=cream, width=line)
draw.ellipse((500 - line // 2, 402 - line // 2, 500 + line // 2, 402 + line // 2), fill=cream)
# Arms
draw.line([(502, 450), (388, 402)], fill=cream, width=line)
draw.line([(502, 450), (630, 396)], fill=cream, width=line)
draw.ellipse((354, 376, 410, 432), fill=cream)
draw.ellipse((612, 370, 668, 426), fill=cream)
# Legs
draw.line([(500, 548), (424, 706)], fill=cream, width=line)
draw.line([(500, 548), (590, 704)], fill=cream, width=line)
draw.line([(424, 706), (402, 742)], fill=cream_soft, width=line)
draw.line([(590, 704), (608, 742)], fill=cream_soft, width=line)

# Small grounding arc.
draw.arc((330, 668, 694, 862), start=20, end=160, fill=(244, 238, 217, 120), width=16)

# Draw at a supersampled output then produce sharp small sizes.
icon_256 = img.resize((256, 256), Image.Resampling.LANCZOS)
icon_256.save(BUILD / "icon.png", "PNG")
sizes = [16, 24, 32, 48, 64, 128, 256]
frames = [img.resize((s, s), Image.Resampling.LANCZOS) for s in sizes]
frames[-1].save(
    BUILD / "icon.ico",
    format="ICO",
    sizes=[(s, s) for s in sizes],
    append_images=frames[:-1],
)

# A simplified high-contrast mark that stays legible at 16 px in the tray.
TRAY = 128
tray = Image.new("RGBA", (TRAY, TRAY), (0, 0, 0, 0))
tray_draw = ImageDraw.Draw(tray)
tray_draw.rounded_rectangle((2, 2, TRAY - 3, TRAY - 3), radius=30, fill=(20, 66, 57, 255))
scale = TRAY / 64
tray_draw.ellipse(
    (28 * scale, 11 * scale, 37 * scale, 20 * scale),
    fill=cream,
)
tray_draw.line(
    [(32.5 * scale, 22 * scale), (32.5 * scale, 40 * scale)],
    fill=cream,
    width=round(5 * scale),
)
tray_draw.line(
    [(32.5 * scale, 28 * scale), (22 * scale, 23 * scale)],
    fill=cream,
    width=round(5 * scale),
)
tray_draw.line(
    [(32.5 * scale, 28 * scale), (43 * scale, 22 * scale)],
    fill=cream,
    width=round(5 * scale),
)
tray_draw.line(
    [(32.5 * scale, 39 * scale), (24 * scale, 52 * scale)],
    fill=cream,
    width=round(5 * scale),
)
tray_draw.line(
    [(32.5 * scale, 39 * scale), (41 * scale, 52 * scale)],
    fill=cream,
    width=round(5 * scale),
)
tray_draw.ellipse(
    (44 * scale, 8 * scale, 53 * scale, 17 * scale),
    fill=amber,
)
tray_64 = tray.resize((64, 64), Image.Resampling.LANCZOS)
tray_64.save(BUILD / "tray.png", "PNG")
tray.resize((32, 32), Image.Resampling.LANCZOS).save(BUILD / "tray-32.png", "PNG")

print(
    f"created {BUILD / 'icon.png'}, {BUILD / 'icon.ico'} "
    f"and {BUILD / 'tray.png'}"
)
