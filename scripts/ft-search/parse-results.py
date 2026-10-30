#!/usr/bin/env python3
"""Parse a batch directory's claude -p outputs into results.jsonl and check prior links (#7598).

A result file can hold more than one JSON line when two runs wrote the same id; keep the
LAST line that carries a verdict (the 2026-10-28 run silently dropped about 5% otherwise).
Then curl each prior URL and write urlcheck.txt ("<id> <http status>").

    python3 -I scripts/ft-search/parse-results.py <dir>
"""
import datetime
import json
import os
import re
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

d = sys.argv[1]
ids = open(os.path.join(d, 'ids.txt')).read().split()
out, fails, missing = [], [], 0
for i in ids:
    p = os.path.join(d, f'{i}.json')
    if not os.path.exists(p):
        missing += 1
        continue
    best = None
    for line in open(p).read().splitlines():
        try:
            j = json.loads(line)
        except ValueError:
            continue
        r = j.get('result') or ''
        if 'hit your' in r:
            continue
        m = re.search(r'\{.*\}', r, re.S)
        if not m:
            continue
        try:
            o = json.loads(m.group(0))
        except ValueError:
            continue
        if 'verdict' in o:
            best = (o, j)
    if not best:
        fails.append(i)
        continue
    o, j = best
    o['_book'] = i
    o['_model'] = (list((j.get('modelUsage') or {}).keys()) or ['claude-sonnet-5-5'])[0]
    o['_date'] = datetime.datetime.fromtimestamp(os.path.getmtime(p), datetime.UTC).strftime('%Y-%m-%dT%H:%M:%SZ')
    out.append(o)

with open(os.path.join(d, 'results.jsonl'), 'w') as f:
    for o in out:
        f.write(json.dumps(o) + '\n')
with open(os.path.join(d, 'parse-failures.txt'), 'w') as f:
    f.write('\n'.join(fails))


def status(item):
    i, url = item
    try:
        c = subprocess.run(['curl', '-s', '-o', '/dev/null', '-L', '-m', '20', '-A', 'Mozilla/5.0', '-w', '%{http_code}', url],
                           capture_output=True, text=True, timeout=30).stdout.strip()
    except subprocess.TimeoutExpired:
        c = '000'
    return f'{i} {c}'


links = [(o['_book'], o['prior']['url']) for o in out
         if o.get('verdict') == 'prior_translation_found' and (o.get('prior') or {}).get('url')]
with ThreadPoolExecutor(16) as ex:
    checks = list(ex.map(status, links))
with open(os.path.join(d, 'urlcheck.txt'), 'w') as f:
    f.write('\n'.join(checks) + '\n')

verdicts = {}
for o in out:
    verdicts[o.get('verdict')] = verdicts.get(o.get('verdict'), 0) + 1
ok = sum(1 for c in checks if c.split()[-1] in ('200', '202'))
print(f'parsed {len(out)} of {len(ids)} (unparseable {len(fails)}, not run {missing}); verdicts {verdicts}; links {ok}/{len(links)} load')
