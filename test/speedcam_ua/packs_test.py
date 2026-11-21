#!/usr/bin/env python3
"""tools/speedcam_ua/build_packs.py with a made-up Overpass: python3 test/speedcam_ua/packs_test.py"""
import json, os, shutil, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', '..', 'tools', 'speedcam_ua'))
import build_packs as bp  # noqa: E402

n = 0


def ok(c, m):
    global n
    if not c:
        print('FAIL ' + m)
        sys.exit(1)
    n += 1
    print('ok   ' + m)


def fake(q):
    if '"ISO3166-1"="PL"' in q:
        return {'elements': [
            {'type': 'node', 'id': 11, 'lat': 52.2297, 'lon': 21.0122, 'tags': {'highway': 'speed_camera', 'maxspeed': '50'}},
            {'type': 'node', 'id': 12, 'lat': 50.0647, 'lon': 19.945, 'tags': {'highway': 'speed_camera', 'ref': 'A4', 'direction': '275'}},
            {'type': 'node', 'id': 13, 'lat': 50.0647, 'lon': 19.945, 'tags': {'highway': 'speed_camera'}},           # same place: dropped
            {'type': 'node', 'id': 14, 'lat': 51.0, 'lon': 17.0, 'tags': {'highway': 'speed_camera', 'disused': 'yes'}},
        ]}
    if '"ISO3166-2"="US-CA"' in q:
        return {'elements': [{'type': 'node', 'id': 21, 'lat': 34.05, 'lon': -118.24, 'tags': {'highway': 'speed_camera', 'maxspeed': '35 mph'}}]}
    if '"ISO3166-2"="US-NY"' in q:
        return {'elements': [{'type': 'node', 'id': 22, 'lat': 40.71, 'lon': -74.0, 'tags': {'highway': 'speed_camera', 'maxspeed': '25 mph', 'name': 'Broadway'}}]}
    if '"ISO3166-1"="DE"' in q:
        raise RuntimeError('Overpass busy')
    return {'elements': []}


tmp = tempfile.mkdtemp()
bp.OUT = tmp
logs = []
index, failed = bp.build({'ua', 'pl', 'de', 'us'}, fixture=fake, log=logs.append, today='2026-12-01', pause=0)
pl = json.load(open(os.path.join(tmp, 'pl.json'), encoding='utf-8'))
ok(pl[0]['code'] == 'pl' and pl[0]['count'] == 2 and pl[0]['legal'] == 'ok' and 'ODbL' in pl[0]['license'], 'pl pack: 2 cameras (a duplicate and a disused one dropped), ODbL')
row = {r[0]: r for r in pl[1:]}
ok(row['o11'][3] == 50 and row['o11'][4] == 'Polska' and row['o12'][4] == 'A4' and row['o12'][5] == 275 and pl[0]['fetched'] == '2026-12-01',
   'pl rows: limit, label (the name or ref, else the country), direction; the date it was read')
ca = json.load(open(os.path.join(tmp, 'us-ca.json'), encoding='utf-8'))
ok(ca[0]['units'] == 'mph' and ca[1][3] == 56.3 and ca[1][4] == 'California', 'us-ca: 35 mph kept as 56.3 km/h, state as label')
ok(failed == ['de'] and not os.path.exists(os.path.join(tmp, 'de.json')), 'a failed country is reported and no pack is written')
ua = json.load(open(os.path.join(tmp, 'ua.json'), encoding='utf-8'))
ok(ua[0]['count'] > 400 and ua[1][0].startswith('u'), 'ua pack from the police list (%d)' % ua[0]['count'])
ny = json.load(open(os.path.join(tmp, 'us-ny.json'), encoding='utf-8'))
ok(ny[1][4] == 'Broadway · New York', 'us-ny: the name and the state as label')
ok(index['packs']['pl']['sha256'] and index['packs']['us-ny']['count'] == 1 and index['checked'] == '2026-12-01', 'index: sha256, counts, checked')

# the next month, nothing changed: dates stay, only "checked" moves; a country that finds nothing keeps its cameras
before = json.load(open(os.path.join(tmp, 'pl.json'), encoding='utf-8'))
index2, _ = bp.build({'pl'}, fixture=fake, log=logs.append, today='2027-01-01', pause=0)
after = json.load(open(os.path.join(tmp, 'pl.json'), encoding='utf-8'))
ok(after[1:] == before[1:] and index2['packs']['pl']['updated'] == '2026-12-01' and after[0]['fetched'] == '2027-01-01' and index2['checked'] == '2027-01-01',
   'unchanged cameras: same rows, same date; only the read date and "checked" move')
calls = []
bp.build({'pl', 'us'}, fixture=lambda q: calls.append(q) or fake(q), log=logs.append, today='2027-01-05', pause=0, fresh_days=20)
ok(not any('"PL"' in q for q in calls) and any('US-CA' in q for q in calls), 'fresh-days: a pack read 4 days ago is skipped, the rest are read')
fake_pl_empty = lambda q: {'elements': []} if '"PL"' in q else fake(q)  # noqa: E731
big = [pl[0]] + [['o%d' % i, 50 + i / 1000, 20, None, 'x', None] for i in range(30)]
json.dump(big, open(os.path.join(tmp, 'pl.json'), 'w'))
bp.build({'pl'}, fixture=fake_pl_empty, log=logs.append, today='2027-02-01', pause=0)
ok(len(json.load(open(os.path.join(tmp, 'pl.json')))) == 31, 'a query that suddenly finds nothing does not wipe 30 cameras')
shutil.rmtree(tmp)
print('packs: %d checks passed' % n)
