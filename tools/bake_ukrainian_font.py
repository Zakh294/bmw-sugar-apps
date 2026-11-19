#!/usr/bin/env python3
"""Bake kit/runtime/fonts/cyrillic.json: the glyphs the kit's canvas uses for any text with Cyrillic letters
(kit/runtime/fonts.js picks the "cyrillic" family for it), here with the whole Ukrainian alphabet, which the kit's
Russian atlas lacks (і ї є ґ ʼ), plus Latin, digits and the punctuation the camera list uses.

    python3 tools/bake_ukrainian_font.py path/to/Ubuntu-Bold.ttf      (Pillow needed; the atlas is committed)

Font: Ubuntu Bold, Ubuntu Font Licence 1.0 (kit/runtime/fonts/UFL-Ubuntu.txt),
https://github.com/google/fonts/tree/main/ufl/ubuntu
"""
import hashlib, importlib.util, json, os, sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
UA = 'АБВГҐДЕЄЖЗИІЇЙКЛМНОПРСТУФХЦЧШЩЬЮЯабвгґдеєжзиіїйклмнопрстуфхцчшщьюя'
EXTRA = 'ЁЫЭЪёыэъ' + '’ʼ«»–—№…·°×→←↑↓'
SIZE = 48


def main():
    font = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else '/usr/share/fonts/truetype/ubuntu/Ubuntu-B.ttf'
    if not os.path.isfile(font):
        raise SystemExit('pass the path to Ubuntu-Bold.ttf')
    spec = importlib.util.spec_from_file_location('bake_fonts', os.path.join(ROOT, 'kit', 'tools', 'bake_fonts.py'))
    baker = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(baker)
    baker.FONTDIR = os.path.dirname(font)
    # the place names of the camera list too, so every one of them draws
    cams = json.load(open(os.path.join(ROOT, 'data', 'cameras.json'), encoding='utf-8'))['cameras']
    names = ''.join(c['place'] + c['region'] + (c['road'] or '') + (c['km'] or '') for c in cams)
    chars = ''.join(sorted(set(baker.TEXT + UA + EXTRA + names)))
    atlas = baker.bake(os.path.basename(font), None, SIZE, chars)
    missing = sorted(set(UA) - set(chr(int(k)) for k in atlas['glyphs']))
    if missing:
        print('warning: no glyph for', ''.join(missing))
    key = hashlib.sha256(json.dumps(atlas, separators=(',', ':')).encode()).hexdigest()[:16]
    data = {'family': 'cyrillic', 'source': 'Ubuntu Bold (Ubuntu Font Licence 1.0)', 'cacheKey': key, 'sizes': [atlas]}
    out = os.path.join(ROOT, 'kit', 'runtime', 'fonts', 'cyrillic.json')
    with open(out, 'w', encoding='utf-8', newline='\n') as f:
        f.write(json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n')
    print('cyrillic: %d glyphs, %dx%d px, %d bytes' % (len(chars), atlas['atlasW'], atlas['atlasH'], os.path.getsize(out)))


if __name__ == '__main__':
    main()
