#!/usr/bin/env python3
"""tools/store_build.py's catalog scans on a made-up catalog: python3 test/speedcam_ua/store_build_test.py"""
import os, sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'tools'))
import store_build as sb  # noqa: E402

DB = {
    'instanceIDs': {
        'de.bmw.nav.Positioning': {'1': 1}, 'de.bmw.adas.TrafficSignInfo': {'1': 1}, 'de.bmw.drive.SpeedLimiter': {'1': 1},
        'de.bmw.nav.Guidance': {'1': 1}, 'de.bmw.media.Player': {'1': 1},
    },
    'datatypes': {
        'Pos': {'type': 'struct', 'members': [{'name': 'latitude', 'dataRef': 'Int32'}, {'name': 'longitude', 'dataRef': 'Int32'}]},
        'Sign': {'type': 'struct', 'members': [{'name': 'speedLimitValue', 'dataRef': 'UInt8'}, {'name': 'unit', 'dataRef': 'UInt8'}]},
        'Segs': {'type': 'array', 'elementDataRef': 'Seg'},
        'Seg': {'type': 'struct', 'members': [{'name': 'maxSpeed', 'dataRef': 'UInt8'}]},
    },
    'interfaces': {
        'de.bmw.nav.Positioning': {'fields': {'currentPosition': {'dataRef': 'Pos', 'notifier': {'id': 1}}}},
        'de.bmw.adas.TrafficSignInfo': {'fields': {'detectedSign': {'dataRef': 'Sign', 'notifier': {'id': 2}},
                                                    'speedLimit': {'dataRef': 'UInt8', 'getter': {'id': 3}}}},
        'de.bmw.drive.SpeedLimiter': {'fields': {'speedLimiterSetSpeed': {'dataRef': 'UInt8', 'notifier': {'id': 4}}}},
        'de.bmw.nav.Guidance': {'fields': {'routeSegments': {'dataRef': 'Segs', 'notifier': {'id': 5}}}},
        'de.bmw.media.Player': {'fields': {'volume': {'dataRef': 'UInt8', 'notifier': {'id': 6}}}},
    },
}

n = 0


def ok(c, m):
    global n
    assert c, m
    n += 1


pos = sb.scan(DB)
ok(pos and pos[0]['name'] == 'currentPosition' and not any(c['name'] in ('detectedSign', 'speedLimit') for c in pos), 'position scan: only the position')
lim = [c for c in sb.scan_limits(DB) if c['score'] > 0]
names = [c['name'] for c in lim]
ok(names[:2] == ['detectedSign', 'speedLimit'] or names[:2] == ['speedLimit', 'detectedSign'], 'limit scan: the traffic-sign fields first: %s' % names)
ok('speedLimiterSetSpeed' not in names and 'volume' not in names, 'limit scan: not the limiter, not the volume')
ok(next(c for c in lim if c['name'] == 'speedLimit')['poll'], 'limit scan: a getter-only field is polled')
ok(all(c['score'] < next(x for x in lim if x['name'] == 'detectedSign')['score'] for c in lim if c['name'] == 'routeSegments'), 'limit scan: route lists rank low')
print('store_build: %d checks passed' % n)
