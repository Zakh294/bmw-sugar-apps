#!/usr/bin/env python3
"""How many cars use SpeedCam, roughly: the downloads of the monthly camera index.

Every car with "Update the databases monthly" on reads index.json once a month (and when its owner presses "Check for
updates now"). The monthly workflow publishes that file as an asset of a GitHub release (tag packs-YYYY-MM-DD), and
GitHub counts the asset's downloads. No server, no id, nothing about the car: GitHub only counts a download.

    GITHUB_TOKEN=... python3 tools/speedcam_ua/release_stats.py      # writes docs/speedcam_ua/STATS.md and stats.json

The count is "at least": cars with the update off or without internet are not in it, and a manual check counts twice.
A month = the releases published in it (each is the "latest" one cars get until the next).
"""
import json, os, sys, urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
REPO = os.environ.get('GITHUB_REPOSITORY', 'Zakh294/bmw-sugar-apps')
OUT_MD = os.path.join(ROOT, 'docs', 'speedcam_ua', 'STATS.md')
OUT_JSON = os.path.join(ROOT, 'docs', 'speedcam_ua', 'stats.json')


def releases(token, fetch=None):
    if fetch:
        return fetch()
    out, page = [], 1
    while True:
        req = urllib.request.Request('https://api.github.com/repos/%s/releases?per_page=100&page=%d' % (REPO, page),
                                     headers={'Accept': 'application/vnd.github+json', 'User-Agent': 'speedcam-stats',
                                              **({'Authorization': 'Bearer ' + token} if token else {})})
        got = json.loads(urllib.request.urlopen(req, timeout=60).read().decode('utf-8'))
        out += got
        if len(got) < 100:
            return out
        page += 1


def summarise(rels):
    """{month: downloads of index.json in the releases published that month}, the releases themselves."""
    rows = []
    for r in rels:
        if not str(r.get('tag_name', '')).startswith('packs-'):
            continue
        n = sum(a.get('download_count', 0) for a in r.get('assets', []) if a.get('name') == 'index.json')
        rows.append({'tag': r['tag_name'], 'published': (r.get('published_at') or r.get('created_at') or '')[:10], 'downloads': n})
    rows.sort(key=lambda x: x['published'])
    months = {}
    for x in rows:
        months[x['published'][:7]] = months.get(x['published'][:7], 0) + x['downloads']
    return months, rows


def write(months, rows, today):
    md = ['# SpeedCam — how many cars (roughly)', '',
          '*Українською нижче.*', '',
          'Downloads of the monthly camera index (`index.json`, an asset of the `packs-…` releases). Every car with the',
          'monthly update on reads it once a month, so a month\'s number is about the cars that used SpeedCam that month:',
          'at least that many (cars with the update off or offline are not counted; a manual check counts again).',
          'Nothing else is collected. Updated by the monthly workflow; last %s.' % today, '',
          '| Month | Downloads ≈ cars |', '|---|---|']
    md += ['| %s | %d |' % (m, months[m]) for m in sorted(months, reverse=True)] or ['| – | – |']
    md += ['', '<details><summary>Releases</summary>', '', '| Release | Published | Downloads |', '|---|---|---|']
    md += ['| %s | %s | %d |' % (x['tag'], x['published'], x['downloads']) for x in reversed(rows)]
    md += ['', '</details>', '', '---', '',
           '**Скільки машин (приблизно).** Кількість завантажень щомісячного індексу баз камер. Кожна машина з',
           'увімкненим щомісячним оновленням читає його раз на місяць, тож число за місяць ≈ машини, що користувались',
           'SpeedCam того місяця (не менше: машини без оновлення чи без інтернету не враховуються). Більше нічого не',
           'збирається.', '']
    os.makedirs(os.path.dirname(OUT_MD), exist_ok=True)
    open(OUT_MD, 'w', encoding='utf-8', newline='\n').write('\n'.join(md))
    json.dump({'updated': today, 'months': months, 'releases': rows}, open(OUT_JSON, 'w', encoding='utf-8'), indent=1, sort_keys=True)


def main():
    import datetime
    months, rows = summarise(releases(os.environ.get('GITHUB_TOKEN') or os.environ.get('GH_TOKEN')))
    write(months, rows, datetime.date.today().isoformat())
    print('stats: %s' % ', '.join('%s %d' % (m, months[m]) for m in sorted(months)) or 'no releases yet')


if __name__ == '__main__':
    sys.exit(main())
