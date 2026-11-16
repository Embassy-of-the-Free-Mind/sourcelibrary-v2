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
import collections, datetime, json, os, subprocess, sys, time, urllib.error, urllib.parse, urllib.request

QUOTA_PROJECT = 'velvety-height-278414'  # Derek's gcloud project; Search Console API enabled
SITE = 'sc-domain:sourcelibrary.org'
SAMPLE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'gsc-sample-urls.txt')
BRAND = ('source library', 'sourcelibrary', 'source-library')

BASE = f'https://www.googleapis.com/webmasters/v3/sites/{urllib.parse.quote(SITE, safe="")}'
INSPECT_URL = 'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect'
UNKNOWN = 'URL is unknown to Google'
FAILED = 'inspection failed'
_token = None


class ApiError(Exception):
    """An HTTP error from the API, with its status, so a caller can tell a rate limit from a refusal."""
    def __init__(self, code, msg, retry_after=None):
        super().__init__(msg)
        self.code, self.retry_after = code, retry_after


def token():
    global _token
    if _token is None:
        _token = subprocess.check_output(['gcloud', 'auth', 'application-default', 'print-access-token'],
                                         stderr=subprocess.DEVNULL).decode().strip()
    return _token


def call(method, url, body=None):
    req = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body else None,
                                 headers={'Authorization': f'Bearer {token()}', 'x-goog-user-project': QUOTA_PROJECT,
                                          'Content-Type': 'application/json'})
    try:
        return json.load(urllib.request.urlopen(req, timeout=120))
    except urllib.error.HTTPError as e:
        raise ApiError(e.code, f'{method} {url} -> {e.code} {e.read().decode()[:300]}', e.headers.get('Retry-After'))


# URL Inspection is rate-limited per minute (#78: on 2026-11-12, 31 of 48
# inspections failed and the report still read "0/48 known"). Retry a rate
# limit, a server error or a network error with a growing wait; a 4xx refusal
# (bad URL, no permission) will not change on retry and is recorded at once.
# Once one URL has used every retry (a daily quota, an outage), the rest get a
# single attempt each, so a bad week costs minutes, not 48 x 3 minutes.
INSPECT_WAITS = (5, 20, 60, 90)  # seconds before attempts 2..5
sleep = time.sleep  # replaced in tests
_exhausted = False


def _retryable(e):
    if isinstance(e, ApiError):
        return e.code == 429 or e.code >= 500
    return isinstance(e, (OSError, ValueError))  # URLError, timeouts, a truncated JSON body


def inspect(path):
    """coverageState for one sample URL, or 'inspection failed (<why>)' after the retries."""
    global _exhausted
    last = None
    for attempt, wait in enumerate((0,) + (() if _exhausted else INSPECT_WAITS)):
        if wait:
            ra = getattr(last, 'retry_after', None)
            sleep(max(wait, int(ra)) if ra and str(ra).isdigit() else wait)
        try:
            r = call('POST', INSPECT_URL, {'inspectionUrl': f'https://sourcelibrary.org/{path}', 'siteUrl': SITE})
            _exhausted = False
            return r.get('inspectionResult', {}).get('indexStatusResult', {}).get('coverageState', '?')
        except (ApiError, OSError, ValueError) as e:
            last = e
            if not _retryable(e):
                break
    else:
        _exhausted = _exhausted or bool(last and _retryable(last))
    why = f'HTTP {last.code}' if isinstance(last, ApiError) else type(last).__name__
    return f'{FAILED} ({why}, {attempt + 1} attempts)'


def inspection_summary(states, sample_size):
    """Headline that keeps failures out of the denominator: a failed inspection is not "unknown"."""
    failed = sum(n for (_, s), n in states.items() if s.startswith(FAILED))
    inspected = sum(states.values()) - failed
    known = sum(n for (_, s), n in states.items() if s != UNKNOWN and not s.startswith(FAILED))
    line = (f'URL Inspection, fixed {sample_size}-URL sample: **{inspected} inspected, {known} known to Google, '
            f'{failed} failed** (2026-10-20 baseline: 2/48 known).')
    if failed:
        line += f' The {failed} failed are not measured: read "known" against {inspected}, not {sample_size}.'
    return line


def search(start, end, dims, limit=25000):
    return call('POST', f'{BASE}/searchAnalytics/query',
                {'startDate': str(start), 'endDate': str(end), 'dimensions': dims, 'rowLimit': limit}).get('rows', [])


def main():
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

    states = collections.Counter()
    sample = [l.strip() for l in open(SAMPLE) if l.strip()]
    for path in sample:
        st = inspect(path)
        states[('book/page' if '/page/' in path else path.split('/')[0], st)] += 1
    out += ['', inspection_summary(states, len(sample)), '']
    out += [f'- {k}: {n} × {s}' for (k, s), n in sorted(states.items())]

    return '\n'.join(out)


if __name__ == '__main__':
    try:
        report = main()
    except ApiError as e:
        raise SystemExit(str(e))
    print(report)
    if '--post' in sys.argv:
        issue = sys.argv[sys.argv.index('--post') + 1]
        subprocess.run(['gh', 'issue', 'comment', issue, '--repo', 'Embassy-of-the-Free-Mind/sourcelibrary-v2', '--body', report], check=True)
