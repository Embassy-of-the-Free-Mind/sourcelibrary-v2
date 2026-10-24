#!/usr/bin/env python3
"""Weekly Search Console snapshot for sourcelibrary.org (#3755).

Answers one question a week: is Google discovering and showing the library?
  - clicks / impressions for the last 4 complete weeks
  - clicks and impressions by section (book, author, collections, ...), 28 days
  - share of clicks from brand queries ("source library")
  - sitemap status (submitted, downloaded, pending)
  - URL Inspection on a FIXED sample (scripts/seo/gsc-sample-urls.txt, 48 URLs,
    8 per page type, drawn 2026-10-20 when 46/48 were "unknown to Google")

Runs on Derek's laptop (launchd, weekly). Auth is gcloud application-default
credentials with the webmasters scope, which exist only there:
  gcloud auth application-default login \
    --scopes=https://www.googleapis.com/auth/webmasters,https://www.googleapis.com/auth/cloud-platform

usage: gsc-snapshot.py            print the report
       gsc-snapshot.py --post N   also post it as a comment on GitHub issue N
"""
import collections, datetime, json, os, subprocess, sys, urllib.error, urllib.parse, urllib.request

QUOTA_PROJECT = 'velvety-height-278414'  # Derek's gcloud project; Search Console API enabled
SITE = 'sc-domain:sourcelibrary.org'
SAMPLE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'gsc-sample-urls.txt')
BRAND = ('source library', 'sourcelibrary', 'source-library')

TOKEN = subprocess.check_output(['gcloud', 'auth', 'application-default', 'print-access-token'],
                                stderr=subprocess.DEVNULL).decode().strip()
BASE = f'https://www.googleapis.com/webmasters/v3/sites/{urllib.parse.quote(SITE, safe="")}'


def call(method, url, body=None):
    req = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body else None,
                                 headers={'Authorization': f'Bearer {TOKEN}', 'x-goog-user-project': QUOTA_PROJECT,
                                          'Content-Type': 'application/json'})
    try:
        return json.load(urllib.request.urlopen(req, timeout=120))
    except urllib.error.HTTPError as e:
        raise SystemExit(f'{method} {url} -> {e.code} {e.read().decode()[:300]}')


def search(start, end, dims, limit=25000):
    return call('POST', f'{BASE}/searchAnalytics/query',
                {'startDate': str(start), 'endDate': str(end), 'dimensions': dims, 'rowLimit': limit}).get('rows', [])


end = datetime.date.today() - datetime.timedelta(days=3)  # GSC data lags ~2-3 days
out = [f'**Search Console snapshot, {datetime.date.today()}** (`scripts/seo/gsc-snapshot.py`, data to {end})', '']

weeks = collections.OrderedDict()
for r in search(end - datetime.timedelta(days=34), end, ['date']):
    d = datetime.date.fromisoformat(r['keys'][0])
    k = f'{d.isocalendar()[0]}-W{d.isocalendar()[1]:02}'
    w = weeks.setdefault(k, [0, 0]); w[0] += r['clicks']; w[1] += r['impressions']
out += ['| week | clicks | impressions |', '|---|---|---|']
out += [f'| {k} | {int(c)} | {int(i)} |' for k, (c, i) in list(weeks.items())[-5:]]

start28 = end - datetime.timedelta(days=27)
sec = collections.defaultdict(lambda: [0, 0, 0])
for r in search(start28, end, ['page']):
    p = urllib.parse.urlparse(r['keys'][0]).path.split('/')
    k = p[1] if len(p) > 1 and p[1] else '(home)'
    if k == 'book' and len(p) > 3 and p[3] == 'page':
        k = 'book/*/page'
    s = sec[k]; s[0] += r['clicks']; s[1] += r['impressions']; s[2] += 1
out += ['', '28 days by section:', '', '| section | clicks | impressions | URLs shown |', '|---|---|---|---|']
out += [f'| {k} | {int(c)} | {int(i)} | {n} |' for k, (c, i, n) in sorted(sec.items(), key=lambda x: -x[1][1])[:8]]

q = search(start28, end, ['query'])
total = sum(r['clicks'] for r in q) or 1
brand = sum(r['clicks'] for r in q if any(b in r['keys'][0].lower() for b in BRAND))
out += ['', f'Brand-query share of clicks (28d): {brand / total:.0%} ({int(brand)}/{int(total)}, named queries only).']

out += ['', 'Sitemaps:']
for s in call('GET', f'{BASE}/sitemaps').get('sitemap', []):
    out.append(f"- {s['path']}: submitted {s.get('lastSubmitted', '')[:10]}, downloaded {str(s.get('lastDownloaded', '-'))[:10]}, "
               f"pending {s.get('isPending')}, errors {s.get('errors')}")

def inspect(path):
    # One retry, then record the failure: a single timeout must not lose the week.
    for attempt in (1, 2):
        try:
            r = call('POST', 'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect',
                     {'inspectionUrl': f'https://sourcelibrary.org/{path}', 'siteUrl': SITE})
            return r.get('inspectionResult', {}).get('indexStatusResult', {}).get('coverageState', '?')
        except (OSError, SystemExit) as e:
            if attempt == 2:
                return f'inspection failed ({type(e).__name__})'


states = collections.Counter()
for path in [l.strip() for l in open(SAMPLE) if l.strip()]:
    st = inspect(path)
    states[('book/page' if '/page/' in path else path.split('/')[0], st)] += 1
known = sum(n for (k, s), n in states.items() if s != 'URL is unknown to Google' and not s.startswith('inspection failed'))
out += ['', f'URL Inspection, fixed 48-URL sample: **{known}/48 known to Google** (2026-10-20 baseline: 2/48).', '']
out += [f'- {k}: {n} × {s}' for (k, s), n in sorted(states.items())]

report = '\n'.join(out)
print(report)
if '--post' in sys.argv:
    issue = sys.argv[sys.argv.index('--post') + 1]
    subprocess.run(['gh', 'issue', 'comment', issue, '--repo', 'Embassy-of-the-Free-Mind/sourcelibrary-v2', '--body', report], check=True)
