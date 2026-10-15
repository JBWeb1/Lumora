"""Builds the Android launcher icons and splash screens from assets/logo-512.png.

Run from apps/android after changing the logo:  python3 make-icons.py
"""
import glob
import os

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
RES = os.path.join(HERE, 'android', 'app', 'src', 'main', 'res')
LOGO = Image.open(os.path.join(HERE, '..', '..', 'assets', 'logo-512.png')).convert('RGBA')
NAVY = (1, 17, 50, 255)

DENSITIES = {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}


def logo(size):
    return LOGO.resize((size, size), Image.LANCZOS)


def on_navy(width, height, logo_size):
    canvas = Image.new('RGBA', (width, height), NAVY)
    canvas.alpha_composite(logo(logo_size), ((width - logo_size) // 2, (height - logo_size) // 2))
    return canvas


def round_mask(img):
    mask = Image.new('L', img.size, 0)
    ImageDraw.Draw(mask).ellipse((0, 0, img.size[0] - 1, img.size[1] - 1), fill=255)
    out = Image.new('RGBA', img.size, (0, 0, 0, 0))
    out.paste(img, (0, 0), mask)
    return out


for name, scale in DENSITIES.items():
    folder = os.path.join(RES, f'mipmap-{name}')
    legacy = round(48 * scale)
    on_navy(legacy, legacy, legacy).save(os.path.join(folder, 'ic_launcher.png'))
    round_mask(on_navy(legacy, legacy, legacy)).save(os.path.join(folder, 'ic_launcher_round.png'))
    # Adaptive icons: Android crops a 108dp layer to its own shape; keep the logo in the 66dp safe zone.
    full = round(108 * scale)
    on_navy(full, full, round(66 * scale)).save(os.path.join(folder, 'ic_launcher_foreground.png'))

for path in glob.glob(os.path.join(RES, 'drawable*', 'splash.png')):
    width, height = Image.open(path).size
    on_navy(width, height, min(width, height) // 3).convert('RGB').save(path)

with open(os.path.join(RES, 'values', 'ic_launcher_background.xml'), 'w') as f:
    f.write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#011132</color>\n</resources>\n')

print('Icons and splash screens updated.')
