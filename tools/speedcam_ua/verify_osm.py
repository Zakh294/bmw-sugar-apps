#!/usr/bin/env python3
"""Cross-check data/speedcam_ua/cameras.json against OpenStreetMap (Nominatim reverse, 1 request/s, their usage policy):
the nearest road's name/ref and the oblast/city each point falls in. Writes data/speedcam_ua/osm_check.json."""
import json, os, sys, time, urllib.request, urllib.parse
root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
cams = json.load(open(os.path.join(root, 'data', 'speedcam_ua', 'cameras.json'), encoding='utf-8'))['cameras']
out_path = os.path.join(root, 'data', 'speedcam_ua', 'osm_check.json')
done = {}
if os.path.exists(out_path):
    done = {str(k): v for k, v in json.load(open(out_path, encoding='utf-8')).items()}
for c in cams:
    if str(c['id']) in done:
        continue
    q = urllib.parse.urlencode({'lat': c['lat'], 'lon': c['lon'], 'format': 'jsonv2', 'zoom': 17, 'addressdetails': 1,
                                'extratags': 1, 'namedetails': 0, 'accept-language': 'uk'})
    req = urllib.request.Request('https://nominatim.openstreetmap.org/reverse?' + q,
                                 headers={'User-Agent': 'speedcam-ua-dataset-check/0.1 (personal, one-off)'})
    for attempt in range(3):
        try:
            r = json.loads(urllib.request.urlopen(req, timeout=30).read().decode('utf-8'))
            break
        except Exception as e:
            r = {'error': str(e)}
            time.sleep(3)
    a = r.get('address', {})
    done[str(c['id'])] = {'road': a.get('road'), 'ref': (r.get('extratags') or {}).get('ref'), 'cls': r.get('category'),
                          'type': r.get('type'), 'state': a.get('state'), 'city': a.get('city') or a.get('town') or a.get('village'),
                          'display': r.get('display_name'), 'error': r.get('error')}
    json.dump(done, open(out_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
    time.sleep(1.1)
print('checked', len(done))
