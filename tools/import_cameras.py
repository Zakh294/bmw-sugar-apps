#!/usr/bin/env python3
"""Official list of automatic speed enforcement cameras (patrolpolice.gov.ua) -> data/cameras.json.

    python3 tools/import_cameras.py kaf.html            # the saved page
    python3 tools/import_cameras.py --fetch             # downloads the page

Source: https://patrolpolice.gov.ua/automatic_fixation/informatsiya-pro-vstanovleni-kaf/
(table: №, road index, region, km, location, speed limit, GPS). Fixes the few rows written with decimal commas
("50, 769657767, 25, 357070027") and Latin/Cyrillic look-alikes in road indexes (M-06 / М-06).
"""
import html, json, re, sys, urllib.request, datetime, os

URL = 'https://patrolpolice.gov.ua/automatic_fixation/informatsiya-pro-vstanovleni-kaf/'
LAT2CYR = str.maketrans({'M': 'М', 'H': 'Н', 'P': 'Р', 'T': 'Т', 'O': 'О'})


def coords(s):
    nums = re.findall(r'-?\d+(?:\.\d+)?', s)
    if len(nums) == 2:
        return float(nums[0]), float(nums[1])
    if len(nums) == 4:   # "50, 769657767, 25, 357070027": decimal commas
        return float(nums[0] + '.' + nums[1]), float(nums[2] + '.' + nums[3])
    raise ValueError('coordinates: %r' % s)


def parse(page):
    table = re.search(r'<table.*?</table>', page, re.S).group(0)
    out = []
    for tr in re.findall(r'<tr.*?</tr>', table, re.S):
        cells = [html.unescape(re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', c))).strip()
                 for c in re.findall(r'<t[dh][^>]*>(.*?)</t[dh]>', tr, re.S)]
        if len(cells) != 7 or not cells[0].isdigit():
            continue
        no, road, region, km, place, limit, gps = cells
        lat, lon = coords(gps)
        if not (44 < lat < 53 and 22 < lon < 41):
            raise ValueError('row %s outside Ukraine: %s' % (no, gps))
        out.append({
            'id': int(no),
            'lat': round(lat, 6), 'lon': round(lon, 6),
            'limit': int(limit) if limit.isdigit() else None,
            'road': road.upper().translate(LAT2CYR).replace(' ', '') or None,
            'km': km or None,
            'region': region,
            'place': place,
            'type': 'highway' if road else 'city',
        })
    return out


def main():
    if '--fetch' in sys.argv:
        req = urllib.request.Request(URL, headers={'User-Agent': 'Mozilla/5.0 speedcam-ua importer'})
        page = urllib.request.urlopen(req, timeout=60).read().decode('utf-8', 'replace')
    else:
        page = open(sys.argv[1], encoding='utf-8', errors='replace').read()
    cams = parse(page)
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
    meta = {'source': URL, 'fetched': datetime.date.today().isoformat(), 'count': len(cams)}
    os.makedirs(os.path.join(root, 'data'), exist_ok=True)
    json.dump({'meta': meta, 'cameras': cams}, open(os.path.join(root, 'data', 'cameras.json'), 'w', encoding='utf-8'),
              ensure_ascii=False, indent=1)
    print('%d cameras' % len(cams))


if __name__ == '__main__':
    main()
