#!/usr/bin/env python3
"""The glyphs SpeedCam's languages need, in the kit's font atlases (kit/runtime/fonts/*.json).

    python3 tools/bake_fonts_i18n.py path/to/ubuntu-fonts-folder     (Ubuntu-Regular/Bold/Light.ttf; Pillow needed)

The kit draws text from pre-baked atlases: "label", "bold", "light" have printable ASCII only, "cyrillic" (picked
for any text with a Cyrillic letter) the Ukrainian alphabet. German, Polish, Czech, French, Italian, Spanish and
the camera labels of Europe need more: Latin-1 letters, Latin Extended-A (ą ł ő ž ...), ș ț, and Serbian /
Macedonian / Bulgarian Cyrillic. This tool

  - re-bakes "cyrillic" (Ubuntu Bold, 48 px) with all of Cyrillic U+0400-045F, those Latin letters and every letter
    used in the camera packs' labels;
  - adds the same Latin letters to "label", "bold" and "light" WITHOUT touching a glyph already there: the new ones
    are drawn from the static Ubuntu fonts (Regular 400, Bold 700, Light 300), narrowed to the atlases' 85 % width,
    and packed below the existing atlas. Running it again changes nothing.

Fonts: Ubuntu, Ubuntu Font Licence 1.0 (kit/runtime/fonts/UFL-Ubuntu.txt), https://github.com/google/fonts/tree/main/ufl/ubuntu
"""
import base64, glob, hashlib, importlib.util, json, os, sys, zlib

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
FONTS = os.path.join(ROOT, 'kit', 'runtime', 'fonts')
LATIN = ''.join(chr(c) for c in range(0xC0, 0x180) if chr(c).isalpha()) + 'ȘșȚțẞ' + '„“”‘’«»¡¿'
CYR = ''.join(chr(c) for c in range(0x400, 0x460)) + 'ҐґʼЁ'
EXTRA = '’ʼ«»–—№…·°×→←↑↓▸◂✓'
WIDTH = 0.85
STATIC = {'label': 'Ubuntu-Regular.ttf', 'bold': 'Ubuntu-Bold.ttf', 'light': 'Ubuntu-Light.ttf'}


def pack_chars():
    """Letters used in the camera packs and data files (labels: region names of Europe)."""
    s = set()
    for p in glob.glob(os.path.join(ROOT, 'apps', 'speedcam_ua', 'packs', '*.json')) + glob.glob(os.path.join(ROOT, 'data', '*', '*.json')):
        for ch in open(p, encoding='utf-8').read():
            if ord(ch) > 0x7e and (ch.isalpha() or ch in EXTRA):
                s.add(ch)
    return s


def render(font, ch, squeeze):
    try:
        bbox = font.getbbox(ch, anchor='ls')
    except Exception:  # noqa: BLE001
        return None
    adv = font.getlength(ch)
    w, h = max(0, bbox[2] - bbox[0]), max(0, bbox[3] - bbox[1])
    im = None
    if w and h:
        im = Image.new('L', (w, h), 0)
        ImageDraw.Draw(im).text((-bbox[0], -bbox[1]), ch, font=font, fill=255, anchor='ls')
        if squeeze != 1:
            im = im.resize((max(1, round(w * squeeze)), h), Image.LANCZOS)
    return im, round(bbox[0] * squeeze), bbox[1], round(adv * squeeze, 2)


def extend(fam, ttf, chars):
    path = os.path.join(FONTS, fam + '.json')
    data = json.load(open(path, encoding='utf-8'))
    added = 0
    for s in data['sizes']:
        have = set(int(k) for k in s['glyphs'])
        todo = [ch for ch in sorted(chars) if ord(ch) not in have]
        if not todo:
            continue
        font = ImageFont.truetype(ttf, s['size'])
        W, H = s['atlasW'], s['atlasH']
        old = Image.frombytes('L', (W, H), zlib.decompress(base64.b64decode(s['alpha'])))
        got = [(ch, render(font, ch, WIDTH)) for ch in todo]
        got = [(ch, r) for ch, r in got if r]
        x, y, rowh, place = 0, H + 1, 0, {}
        for ch, (im, ox, oy, adv) in got:
            if im is None:
                place[ch] = (0, 0, 0, 0)
                continue
            if x + im.width > W:
                x, y, rowh = 0, y + rowh + 1, 0
            place[ch] = (x, y, im.width, im.height)
            x += im.width + 1
            rowh = max(rowh, im.height)
        H2 = y + rowh + 1
        atlas = Image.new('L', (W, H2), 0)
        atlas.paste(old, (0, 0))
        for ch, (im, ox, oy, adv) in got:
            px, py, pw, ph = place[ch]
            if im is not None:
                atlas.paste(im, (px, py))
            s['glyphs'][str(ord(ch))] = [px, py, pw, ph, ox, oy, adv]
        s['atlasH'] = H2
        s['alpha'] = base64.b64encode(zlib.compress(atlas.tobytes(), 9)).decode()
        added += len(got)
    if added:
        with open(path, 'w', encoding='utf-8', newline='\n') as f:
            json.dump(data, f, separators=(',', ':'))
    print('%s: +%d glyphs (%d KiB)' % (fam, added, os.path.getsize(path) // 1024))


def cyrillic(fontdir, chars):
    spec = importlib.util.spec_from_file_location('bake_fonts', os.path.join(ROOT, 'kit', 'tools', 'bake_fonts.py'))
    baker = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(baker)
    baker.FONTDIR = fontdir
    allc = ''.join(sorted(set(baker.TEXT) | set(CYR) | set(chars)))
    atlas = baker.bake('Ubuntu-Bold.ttf', None, 48, allc)
    key = hashlib.sha256(json.dumps(atlas, separators=(',', ':')).encode()).hexdigest()[:16]
    data = {'family': 'cyrillic', 'source': 'Ubuntu Bold (Ubuntu Font Licence 1.0)', 'cacheKey': key, 'sizes': [atlas]}
    out = os.path.join(FONTS, 'cyrillic.json')
    with open(out, 'w', encoding='utf-8', newline='\n') as f:
        f.write(json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n')
    print('cyrillic: %d glyphs, %dx%d px, %d KiB' % (len(atlas['glyphs']), atlas['atlasW'], atlas['atlasH'], os.path.getsize(out) // 1024))


def main():
    fontdir = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else '/usr/share/fonts/truetype/ubuntu'
    for f in STATIC.values():
        if not os.path.isfile(os.path.join(fontdir, f)):
            raise SystemExit('no %s in %s' % (f, fontdir))
    letters = set(LATIN) | set(EXTRA) | pack_chars()
    latin = set(ch for ch in letters if not ('Ѐ' <= ch <= 'ӿ'))
    cyrillic(fontdir, letters)
    for fam, ttf in STATIC.items():
        extend(fam, os.path.join(fontdir, ttf), latin)


if __name__ == '__main__':
    main()
