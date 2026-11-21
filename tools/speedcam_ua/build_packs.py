#!/usr/bin/env python3
"""Builds the camera packs the app ships and downloads: apps/speedcam_ua/packs/<code>.json + index.json.

    python3 tools/speedcam_ua/build_packs.py                 # everything: Ukraine + Europe + USA
    python3 tools/speedcam_ua/build_packs.py --only ua,pl    # some packs
    python3 tools/speedcam_ua/build_packs.py --offline       # Ukraine only, from data/speedcam_ua/cameras.json

Sources
    ua      the official list of the Patrol Police (data/speedcam_ua/cameras.json, tools/speedcam_ua/import_cameras.py)
    Europe  OpenStreetMap, nodes highway=speed_camera, one Overpass query per country
    USA     OpenStreetMap, one Overpass query and one pack per state (ISO 3166-2 of the state's area)
Overpass is often busy: a run reads the packs read longest ago first and stops starting queries after --minutes;
--fresh-days skips the ones read recently, so the workflow's runs on the first days of a month finish the set.
OpenStreetMap data (c) OpenStreetMap contributors, ODbL 1.0: the packs built from it are under the ODbL too.

A pack is a JSON array: [meta, row, row, ...], row = [id, lat, lon, limit km/h or null, label, direction deg or null].
index.json lists every pack with its count, bounding box, date and sha256, for the app's monthly update. A pack whose
rows did not change keeps its date (no churn in git); "checked" is always today's. A failed query leaves the pack
as it was; a query that suddenly finds nothing where there were more than 20 cameras is not trusted either.

Runs monthly on GitHub (.github/workflows/camera-packs.yml); needs only Python 3 (no packages).
"""
import argparse, datetime, hashlib, json, os, re, sys, time, urllib.parse, urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from countries import all_packs  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
OUT = os.path.join(ROOT, 'apps', 'speedcam_ua', 'packs')
UA_JSON = os.path.join(ROOT, 'data', 'speedcam_ua', 'cameras.json')
OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter',
            'https://overpass.kumi.systems/api/interpreter']
UA_AGENT = 'speedcam-packs/1.0 (+https://github.com/Zakh294/bmw-sugar-apps)'
OSM_NOTE = 'OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright)'
MPH = 1.609344


def query_country(iso):
    """All speed cameras of a country (a plain area query: the cheapest Overpass has)."""
    return ('[out:json][timeout:240];'
            'area["ISO3166-1"="%s"][admin_level=2][boundary=administrative]->.c;'
            'node(area.c)[highway=speed_camera];out qt;' % iso)


def query_state(iso2):
    """The speed cameras of one US state (ISO 3166-2, e.g. US-CA)."""
    return ('[out:json][timeout:180];'
            'area["ISO3166-2"="%s"][admin_level=4][boundary=administrative]->.s;'
            'node(area.s)[highway=speed_camera];out qt;' % iso2)


DEADLINE = [None]       # time.time() after which no new query starts (the workflow's time limit)


def overpass(q, log, fixture=None):
    if fixture is not None:
        return fixture(q)
    body = urllib.parse.urlencode({'data': q}).encode()
    last = None
    for attempt in range(3):
        if DEADLINE[0] and time.time() > DEADLINE[0]:
            raise RuntimeError('out of time')
        url = OVERPASS[attempt % len(OVERPASS)]
        try:
            req = urllib.request.Request(url, data=body, headers={'User-Agent': UA_AGENT})
            out = json.loads(urllib.request.urlopen(req, timeout=260).read().decode('utf-8'))
            # a query Overpass gave up on still answers 200, with a remark and no (or partial) elements
            if re.search(r'error|timed out|out of memory', str(out.get('remark', '')), re.I):
                raise RuntimeError('Overpass: ' + str(out['remark'])[:80])
            return out
        except Exception as e:  # noqa: BLE001 - any network / server error: try the next server, later
            last = e
            log('  %s: %s, again in %d s' % (url, e, 20 * (attempt + 1)))
            time.sleep(20 * (attempt + 1))
    raise RuntimeError('Overpass failed: %s' % last)


def limit_kmh(tags):
    m = re.match(r'^\s*(\d+(?:\.\d+)?)\s*(mph)?', tags.get('maxspeed', ''))
    if not m:
        return None
    v = float(m.group(1)) * (MPH if m.group(2) else 1)
    return round(v, 1) if m.group(2) else int(round(v))


def direction(tags):
    m = re.match(r'^\s*(\d{1,3})\s*$', tags.get('direction', ''))
    return int(m.group(1)) % 360 if m else None


def osm_rows(elements):
    """Overpass output (nodes, then area + ids per region) -> {region key: (region tags, [rows])}; key None: no region."""
    nodes, region_of, regions, cur = {}, {}, {}, None
    for e in elements:
        if e.get('type') == 'area':
            cur = e.get('id')
            regions[cur] = e.get('tags', {})
        elif e.get('type') == 'node' and 'lat' in e:
            if cur is None:
                nodes[e['id']] = e
            else:
                region_of.setdefault(e['id'], cur)
        elif e.get('type') == 'node' and cur is not None:
            region_of.setdefault(e['id'], cur)
    out, seen = {}, set()
    for nid, e in sorted(nodes.items()):
        t = e.get('tags', {})
        if t.get('disused') == 'yes' or t.get('highway') != 'speed_camera':
            continue
        key = (round(e['lat'], 5), round(e['lon'], 5))
        if key in seen:
            continue
        seen.add(key)
        rid = region_of.get(nid)
        rt = regions.get(rid, {})
        rname = rt.get('name:en') if rt.get('ISO3166-2', '').startswith('US-') else rt.get('name') or rt.get('name:en')
        what = t.get('name') or t.get('ref') or ''
        label = ' · '.join(x for x in (what, rname) if x)[:48] or 'OSM %d' % nid
        out.setdefault(rid, (rt, []))[1].append(['o%d' % nid, round(e['lat'], 6), round(e['lon'], 6), limit_kmh(t), label, direction(t)])
    return out


def ua_rows():
    src = json.load(open(UA_JSON, encoding='utf-8'))
    rows = []
    for c in src['cameras']:
        label = ('%s, км %s' % (c['road'], c['km'])) if c.get('road') else '%s, %s' % (re.sub(r'^м\.\s*', '', c['region']), c['place'])
        rows.append(['u%d' % c['id'], c['lat'], c['lon'], c['limit'], label, None])
    return rows, src['meta']


def bbox(rows):
    if not rows:
        return None
    return [min(r[1] for r in rows), min(r[2] for r in rows), max(r[1] for r in rows), max(r[2] for r in rows)]


SMALL = {'ad', 'mc', 'sm', 'li', 'mt', 'xk', 'is', 'me', 'ba', 'al', 'md', 'mk', 'cy', 'lu'}


def write_pack(p, rows, source, license_, today, log, fetched=None):
    path = os.path.join(OUT, p['code'] + '.json')
    old = None
    try:
        old = json.load(open(path, encoding='utf-8'))
    except (OSError, ValueError):
        pass
    old_rows = old[1:] if old else None
    if old_rows is not None and len(old_rows) > 20 and not rows:
        log('  %s: nothing found where there were %d, kept' % (p['code'], len(old_rows)))
        return old[0]
    rows = sorted(rows, key=lambda r: r[0])
    updated = old[0].get('updated') if old_rows is not None and old_rows == rows else today
    meta = dict(p, source=source, license=license_, updated=updated, count=len(rows), bbox=bbox(rows))
    if fetched:
        meta['fetched'] = fetched
    if old and old[0] == meta and old_rows == rows:
        return meta
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        f.write('[' + json.dumps(meta, ensure_ascii=False, sort_keys=True))
        for r in rows:
            f.write(',\n' + json.dumps(r, ensure_ascii=False))
        f.write(']\n')
    return meta


def write_index(today):
    packs = {}
    for p in all_packs():
        path = os.path.join(OUT, p['code'] + '.json')
        if not os.path.isfile(path):
            continue
        raw = open(path, 'rb').read()
        meta = json.loads(raw.decode('utf-8'))[0]
        packs[p['code']] = {k: meta.get(k) for k in ('iso', 'name', 'en', 'uk', 'group', 'units', 'legal', 'count', 'bbox', 'updated', 'fetched', 'source')}
        packs[p['code']].update(sha256=hashlib.sha256(raw).hexdigest(), bytes=len(raw))
    index = {'schema': 1, 'checked': today, 'packs': packs}
    with open(os.path.join(OUT, 'index.json'), 'w', encoding='utf-8', newline='\n') as f:
        json.dump(index, f, ensure_ascii=False, indent=1, sort_keys=True)
        f.write('\n')
    return index


def fetched_on(code):
    """The date a pack was last read from OpenStreetMap ('' if never)."""
    try:
        return json.load(open(os.path.join(OUT, code + '.json'), encoding='utf-8'))[0].get('fetched') or ''
    except (OSError, ValueError, IndexError):
        return ''


def build(only=None, offline=False, fixture=None, log=print, today=None, pause=5, fresh_days=0):
    """Ukraine, then the OpenStreetMap packs, the longest-unread first; a pack read less than fresh_days ago is
    skipped (the workflow runs on several days at the start of a month and goes on where the last run stopped)."""
    today = today or datetime.date.today().isoformat()
    os.makedirs(OUT, exist_ok=True)
    packs = [p for p in all_packs() if not only or p['code'] in only or (p['group'] == 'us' and 'us' in only)]
    failed = []
    if any(p['code'] == 'ua' for p in packs):
        rows, meta = ua_rows()
        write_pack(next(p for p in packs if p['code'] == 'ua'), rows, meta['source'], 'official list of the National Police of Ukraine', meta['fetched'], log)
        log('ua: %d cameras (patrolpolice.gov.ua, %s)' % (len(rows), meta['fetched']))
    if offline:
        return write_index(today), failed
    limit = (datetime.date.fromisoformat(today) - datetime.timedelta(days=fresh_days)).isoformat() if fresh_days else None
    osm = [p for p in packs if p['group'] in ('eu', 'us')]
    osm.sort(key=lambda p: fetched_on(p['code']))
    for p in osm:
        if limit and fetched_on(p['code']) > limit:
            continue
        try:
            q = query_state(p['iso']) if p['group'] == 'us' else query_country(p['iso'])
            got = osm_rows(overpass(q, log, fixture).get('elements', []))
            rows = [r for k in got for r in got[k][1]]
            if not rows and p['code'] not in SMALL and p['group'] == 'eu':
                raise RuntimeError('no cameras at all: not trusted')
            name = p['en'] if p['group'] == 'us' else p['name']
            for r in rows:
                if r[4].startswith('OSM '):
                    r[4] = name
                elif p['group'] == 'us' and name not in r[4]:
                    r[4] = (r[4] + ' · ' + name)[:48]
            write_pack(p, rows, 'OpenStreetMap (Overpass)', OSM_NOTE, today, log, fetched=today)
            log('%s: %d cameras' % (p['code'], len(rows)))
        except Exception as e:  # noqa: BLE001
            failed.append(p['code'])
            log('%s: FAILED %s (pack kept)' % (p['code'], e))
        time.sleep(pause)
    return write_index(today), failed


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--only', help='comma-separated pack codes (us = every state)')
    ap.add_argument('--offline', action='store_true', help='Ukraine only, no network')
    ap.add_argument('--minutes', type=float, default=0, help='start no new query after this many minutes (0: no limit)')
    ap.add_argument('--fresh-days', type=int, default=0, help='skip packs read from OpenStreetMap fewer days ago than this')
    a = ap.parse_args()
    if a.minutes:
        DEADLINE[0] = time.time() + a.minutes * 60
    index, failed = build(set(a.only.split(',')) if a.only else None, a.offline, fresh_days=a.fresh_days)
    print('index: %d packs, %d cameras; failed: %s' % (len(index['packs']), sum(p['count'] or 0 for p in index['packs'].values()), ', '.join(failed) or 'none'))
    # some packs failing is normal for a busy Overpass (they are kept, the next run tries them first)


if __name__ == '__main__':
    main()
