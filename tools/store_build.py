#!/usr/bin/env python3
"""The MGU Store's build step for this repo (mgu-repo.json), run on the head unit itself:

    1. finds where this unit's firmware publishes the car's position: every field and event in the SOME/IP catalog
       (/etc/oap/someip/someip-interfaces.json) whose data type has a latitude and a longitude member, ranked
       (car / current / position names up, destinations, POIs and route lists down);
    2. adds the best ones to apps/<id>/app.json "signals" (each "_optional", read-only) and lists them in
       apps/<id>/position_candidates.js for the app (position.js watches them all and uses the one that moves);
    3. the same for the speed limit the car shows itself (sign recognition, the map's limit): fields and events whose
       name or members say "speed limit", "traffic sign", "SLI", "KAFAS"..., listed in apps/<id>/limit_candidates.js
       (car_limit.js), for an app that has that file;
    4. runs the App Kit's build (kit/tools/build.py) as usual.

Off the car (no catalog) step 1 finds nothing and the app is built without position sources.
    python3 tools/store_build.py speedcam_ua            # as the Store calls it
    python3 tools/store_build.py --scan [catalog.json]  # only print what step 1 finds
    python3 tools/store_build.py --scan-limits [catalog.json]  # only print what step 3 finds
"""
import json, os, re, subprocess, sys, time

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
CATALOG = os.environ.get('MGU_SOMEIP_CATALOG', '/etc/oap/someip/someip-interfaces.json')
MAX_CANDIDATES = 6
MAX_LIMITS = 8

LAT = re.compile(r'(^|[^a-z])lat(itude)?([^a-z]|$)|latitude|wgs84lat', re.I)
LON = re.compile(r'(^|[^a-z])(lon|lng)(gitude)?([^a-z]|$)|longitude|wgs84lon', re.I)
GOOD = re.compile(r'position|location|ccp|gnss|gps|geo|current|ownpos|carpos|vehiclepos|matched|ego|coordinate', re.I)
BAD = re.compile(r'dest|poi|route|maneuver|manoeuvre|search|address|favo|history|weather|charg|parking|traffic|'
                 r'geofence|lastmile|waypoint|stopover|contact|photo|picture|sms|calendar|tile|map(?!matched)|camera|'
                 r'event|incident|hazard|warning|share|send|import|export|request|set[A-Z]', re.I)


def words(name):
    return re.sub(r'([a-z0-9])([A-Z])', r'\1 \2', name).replace('_', ' ').lower()


def is_lat(n):
    w = words(n)
    return bool(LAT.search(w)) and 'lateral' not in w and 'relat' not in w and 'plate' not in w and 'translat' not in w


def is_lon(n):
    w = words(n)
    return bool(LON.search(w)) and 'longitudinal' not in w and 'long ' not in w + ' '


def leaves(db, ref, path, depth, out, seen):
    """(path, member name, in_array) for every member reachable from datatype ref."""
    types = db.get('datatypes') or {}
    d = types.get(ref) if isinstance(ref, str) else None
    if not isinstance(d, dict) or depth > 6 or (ref, depth) in seen:
        return
    seen.add((ref, depth))
    t = d.get('type')
    if t in ('struct', 'union'):
        members, dd, guard = [], d, 0
        while isinstance(dd, dict) and guard < 8:
            members = list(dd.get('members') or []) + members
            dd = types.get(dd.get('extends')) if dd.get('extends') else None
            guard += 1
        for m in members:
            if not isinstance(m, dict):
                continue
            name = m.get('name') or ''
            out.append((path, name, '[]' in path))
            leaves(db, m.get('dataRef'), path + '.' + name, depth + 1, out, seen)
    elif t == 'typedef':
        leaves(db, d.get('dataRef') or d.get('baseType'), path, depth, out, seen)
    elif t == 'array':
        leaves(db, d.get('elementDataRef'), path + '[]', depth + 1, out, seen)


def refs_in(entry):
    """Every dataRef-like value inside a field / event definition (its value, or its arguments)."""
    found = []

    def walk(x, depth):
        if depth > 5:
            return
        if isinstance(x, dict):
            for k, v in x.items():
                if k in ('dataRef', 'elementDataRef') and isinstance(v, str):
                    found.append(v)
                elif isinstance(v, (dict, list)):
                    walk(v, depth + 1)
        elif isinstance(x, list):
            for v in x:
                walk(v, depth + 1)
    walk(entry, 0)
    return found


def entries(part):
    if isinstance(part, dict):
        return [(k, v) for k, v in part.items() if isinstance(v, dict)]
    if isinstance(part, list):
        return [(e.get('name'), e) for e in part if isinstance(e, dict) and e.get('name')]
    return []


def has_id(x):
    return isinstance(x, dict) and bool(x.get('id', 1))


def scan(db):
    found = []
    inst_ids = db.get('instanceIDs') or {}
    for iface, d in (db.get('interfaces') or {}).items():
        if not isinstance(d, dict):
            continue
        insts = inst_ids.get(iface)
        names = [k for k, v in insts.items() if v is not None] if isinstance(insts, dict) else []
        if not names:
            continue
        inst = next((n for n in ('Main_Instance', '1', 'Inst1', 'Front') if n in names), names[0])
        for kind, part in (('field', 'fields'), ('event', 'events'), ('event', 'broadcasts')):
            for name, e in entries(d.get(part)):
                lv = []
                for r in refs_in(e):
                    leaves(db, r, '', 0, lv, set())
                by_parent = {}
                for p, n, arr in lv:
                    s = by_parent.setdefault(p, [False, False, arr])
                    s[0] = s[0] or is_lat(n)
                    s[1] = s[1] or is_lon(n)
                pairs = [p for p, s in by_parent.items() if s[0] and s[1]]
                if not pairs:
                    continue
                path = min(pairs, key=len)
                score = 50
                text = iface + '.' + name + ' ' + path
                if GOOD.search(text):
                    score += 30
                if re.search(r'current|ccp|ownpos|carpos|vehicleposition|egopos|matched', text, re.I):
                    score += 25
                if BAD.search(name) or BAD.search(path) or BAD.search(iface.split('.')[-1]):
                    score -= 120
                if re.search(r'navigation|positioning|gnss|location', iface, re.I):
                    score += 15
                if '[]' in path:
                    score -= 60
                score -= 3 * path.count('.')
                if kind == 'field':
                    notif, getter = has_id(e.get('notifier')), has_id(e.get('getter'))
                    if not notif and not getter:
                        continue
                    score += 20 if notif else 5
                    mode = ('r' if getter else '') + ('s' if notif else '')
                else:
                    notif, getter, mode = True, False, ''
                    score += 10
                found.append({'iface': iface, 'inst': inst, 'name': name, 'kind': kind, 'path': path or '.',
                              'poll': kind == 'field' and not notif, 'mode': mode, 'score': score})
    found.sort(key=lambda c: -c['score'])
    return found


LIMIT = re.compile(r'speed ?limit(?!er)|speedlim(?!iter)|tempo ?limit|v ?max\b|max(imum)? ?speed|legal ?speed|allowed ?speed|permitted ?speed|'
                   r'traffic ?sign|road ?sign|sign ?recogn|verkehrszeichen|\bsli|kafas|\btsr\b', re.I)
LIMIT_BAD = re.compile(r'limiter|set ?limit|user ?limit|offset|toler|threshold|config|setting|request|route|search|poi|history|tile|'
                       r'dest|charg|battery|trailer|tire|tyre|wiper|seat|volume|audio|media|zoom|scale|download|'
                       r'acc ?speed|cruise|set ?speed|desired|target|warn ?level|hmi ?setting|display ?setting', re.I)


def scan_limits(db):
    """Fields and events that look like the speed limit the car shows: best first."""
    found = []
    inst_ids = db.get('instanceIDs') or {}
    for iface, d in (db.get('interfaces') or {}).items():
        if not isinstance(d, dict):
            continue
        insts = inst_ids.get(iface)
        names = [k for k, v in insts.items() if v is not None] if isinstance(insts, dict) else []
        if not names:
            continue
        inst = next((n for n in ('Main_Instance', '1', 'Inst1', 'Front') if n in names), names[0])
        iw = words(iface.split('.')[-1])
        for kind, part in (('field', 'fields'), ('event', 'events'), ('event', 'broadcasts')):
            for name, e in entries(d.get(part)):
                nw = words(name)
                lv = []
                for r in refs_in(e):
                    leaves(db, r, '', 0, lv, set())
                members = [(p + '.' + n) for p, n, arr in lv if LIMIT.search(words(n))]
                in_name, in_iface = bool(LIMIT.search(nw)), bool(LIMIT.search(iw))
                if not in_name and not members:
                    continue
                score = 10 + (60 if in_name else 0) + (30 if in_iface else 0) + (25 if members else 0)
                path = min(members, key=len) if members else '.'
                if '[]' in path:
                    score -= 40
                if LIMIT_BAD.search(nw) or LIMIT_BAD.search(words(path)) or LIMIT_BAD.search(iw):
                    score -= 100
                if re.search(r'driver ?assist|adas|kafas|camera|guidance|navigation|vehicle|cluster|hud', iw):
                    score += 10
                if kind == 'field':
                    notif, getter = has_id(e.get('notifier')), has_id(e.get('getter'))
                    if not notif and not getter:
                        continue
                    score += 20 if notif else 5
                    mode = ('r' if getter else '') + ('s' if notif else '')
                else:
                    notif, mode = True, ''
                    score += 10
                found.append({'iface': iface, 'inst': inst, 'name': name, 'kind': kind, 'path': path,
                              'poll': kind == 'field' and not notif, 'mode': mode, 'score': score})
    found.sort(key=lambda c: -c['score'])
    return found


def apply(app_id, cands, note, fname='position_candidates.js',
          why='the car position for camera warnings (found on this unit by tools/store_build.py)', what='a latitude and a longitude'):
    adir = os.path.join(ROOT, 'apps', app_id)
    spec_path = os.path.join(adir, 'app.json')
    spec = json.load(open(spec_path, encoding='utf-8'))
    sig = spec.setdefault('signals', {})
    for c in cands:
        e = sig.setdefault(c['iface'], {})
        if not isinstance(e, dict):
            continue
        e.setdefault('_optional', why)
        if c['inst'] != '1':
            e['_instances'] = c['inst']
        if c['kind'] == 'field':
            e[c['name']] = c['mode']
        else:
            b = e.setdefault('_broadcasts', [])
            if c['name'] not in b:
                b.append(c['name'])
    with open(spec_path, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(spec, f, ensure_ascii=False, indent=2)
        f.write('\n')
    keep = ('iface', 'inst', 'name', 'kind', 'path', 'poll', 'score')
    body = {'list': [dict((k, c[k]) for k in keep) for c in cands], 'note': note,
            'built': time.strftime('%Y-%m-%d', time.gmtime())}
    with open(os.path.join(adir, fname), 'w', encoding='utf-8', newline='\n') as f:
        f.write("'use strict';\n// Written by tools/store_build.py on the car from its interface catalog: the fields and events with %s.\n" % what)
        f.write('module.exports = %s;\n' % json.dumps(body, indent=1))


def load_catalog(path):
    if not os.path.isfile(path):
        return None
    try:
        return json.load(open(path, encoding='utf-8'))
    except (OSError, ValueError):
        return None


def main():
    args = sys.argv[1:]
    if args and args[0] == '--scan-limits':
        db = load_catalog(args[1] if len(args) > 1 else CATALOG)
        if db is None:
            sys.exit('no catalog at ' + (args[1] if len(args) > 1 else CATALOG))
        for c in scan_limits(db)[:30]:
            print('%4d  %s.%s  [%s %s%s] inst %s at %s' % (c['score'], c['iface'], c['name'], c['kind'], c['mode'] or 'event',
                                                          ' poll' if c['poll'] else '', c['inst'], c['path']))
        return
    if args and args[0] == '--scan':
        db = load_catalog(args[1] if len(args) > 1 else CATALOG)
        if db is None:
            sys.exit('no catalog at ' + (args[1] if len(args) > 1 else CATALOG))
        for c in scan(db)[:30]:
            print('%4d  %s.%s  [%s %s%s] inst %s at %s' % (c['score'], c['iface'], c['name'], c['kind'], c['mode'] or 'event',
                                                          ' poll' if c['poll'] else '', c['inst'], c['path']))
        return
    app_ids = [a for a in args if not a.startswith('-')]
    db = load_catalog(CATALOG)
    for app_id in app_ids:
        if not os.path.exists(os.path.join(ROOT, 'apps', app_id, 'position_candidates.js')):
            continue
        if db is None:
            print('store_build: no interface catalog at %s: building %s without position sources' % (CATALOG, app_id))
            continue
        if os.path.exists(os.path.join(ROOT, 'apps', app_id, 'position.disable')):
            print('store_build: %s: position.disable is there: building without position sources' % app_id)
            continue
        try:
            found = scan(db)
            cands = [c for c in found if c['score'] > 0][:MAX_CANDIDATES]
            note = '%d of %d candidates on this unit' % (len(cands), len(found)) if found else 'no field with latitude + longitude in this unit\'s catalog'
            apply(app_id, cands, note)
            print('store_build: %s: %s' % (app_id, note))
            for c in cands:
                print('  %4d %s.%s (%s, %s) %s' % (c['score'], c['iface'], c['name'], c['kind'], c['inst'], c['path']))
        except Exception as e:      # never block the build: the app still installs, without positions
            print('store_build: position scan failed: %s' % e)
    for app_id in app_ids:
        if db is None or not os.path.exists(os.path.join(ROOT, 'apps', app_id, 'limit_candidates.js')):
            continue
        if os.path.exists(os.path.join(ROOT, 'apps', app_id, 'limit.disable')):
            print('store_build: %s: limit.disable is there: building without the car\'s speed limit' % app_id)
            continue
        try:
            found = scan_limits(db)
            cands = [c for c in found if c['score'] > 0][:MAX_LIMITS]
            note = '%d of %d candidates on this unit' % (len(cands), len(found)) if found else 'no speed-limit field in this unit\'s catalog'
            apply(app_id, cands, note, 'limit_candidates.js',
                  'the speed limit the car shows, so the HUD does not show it twice (found on this unit by tools/store_build.py)',
                  'a speed limit or a traffic sign')
            print('store_build: %s: car speed limit: %s' % (app_id, note))
            for c in cands:
                print('  %4d %s.%s (%s, %s) %s' % (c['score'], c['iface'], c['name'], c['kind'], c['inst'], c['path']))
        except Exception as e:      # never block the build: the app still installs, showing its own limit
            print('store_build: speed-limit scan failed: %s' % e)
    build = os.path.join(ROOT, 'kit', 'tools', 'build.py')
    sys.exit(subprocess.call([sys.executable, build] + args))


if __name__ == '__main__':
    main()
