#!/usr/bin/env python3
"""tools/speedcam_ua/release_stats.py with made-up releases: python3 test/speedcam_ua/stats_test.py"""
import os, sys, tempfile

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'tools', 'speedcam_ua'))
import release_stats as rs  # noqa: E402

rels = [
    {'tag_name': 'packs-2026-12-02', 'published_at': '2026-12-02T03:40:00Z', 'assets': [{'name': 'index.json', 'download_count': 40}]},
    {'tag_name': 'packs-2026-12-05', 'published_at': '2026-12-05T03:40:00Z', 'assets': [{'name': 'index.json', 'download_count': 7}, {'name': 'x.zip', 'download_count': 99}]},
    {'tag_name': 'packs-2027-01-02', 'published_at': '2027-01-02T03:40:00Z', 'assets': [{'name': 'index.json', 'download_count': 55}]},
    {'tag_name': 'v1.0', 'published_at': '2026-12-10T00:00:00Z', 'assets': [{'name': 'index.json', 'download_count': 1000}]},
]
months, rows = rs.summarise(rels)
assert months == {'2026-12': 47, '2027-01': 55}, months
assert [r['tag'] for r in rows] == ['packs-2026-12-02', 'packs-2026-12-05', 'packs-2027-01-02']
d = tempfile.mkdtemp()
rs.OUT_MD, rs.OUT_JSON = os.path.join(d, 'S.md'), os.path.join(d, 's.json')
rs.write(months, rows, '2027-01-03')
md = open(rs.OUT_MD, encoding='utf-8').read()
assert '| 2027-01 | 55 |' in md and '| 2026-12 | 47 |' in md and md.index('2027-01') < md.index('| 2026-12 |')
print('stats: 3 checks passed')
