#!/usr/bin/env python3
"""#6740 read-surface, Amendment 6 (efficiency (b) and (d)): the quota a priced dollar buys, bounded from /quota readings,
and the backlog projection: weeks of quota to first-read each scans-only queue at live and at the best setting.

The bound: between two readings of the default pool's weekly remaining fraction, this job's own calls spent a priced $X
(agy's usage on every call, list rates) and the pool fell by d. Other jobs shared the pool, so this job's share of d is
at most d: one week's allowance is worth AT LEAST X / d priced dollars. Weeks to read a queue = queue $ / capacity are
therefore AT MOST the figure printed, if the lane had the whole pool.

PRIOR ART: scripts/eval/estimator/ocr/meter_quota_share.py (the pool's capacity in calls from 429 bursts, not in priced
  tokens); analysis6.py (this directory: cost per accepted page). Nothing converts token cost to quota weeks.

    py/bin/python backlog.py --analysis=analysis6.json --quota-dir=WORK/quota --runs=WORK/runs,WORK-IB/runs \
        --queue=de:797772:3131,la:4741905:15356,en:204822:1305 > backlog.json
"""
import argparse, glob, json, os, re, datetime as dt

ap = argparse.ArgumentParser()
ap.add_argument('--analysis'); ap.add_argument('--quota-dir'); ap.add_argument('--runs'); ap.add_argument('--queue')
a = ap.parse_args()
RATE = {'input': 0.75e-6, 'cached': 0.075e-6, 'output': 3.75e-6}
usd = lambda u: ((u.get('input') or 0) - (u.get('cache_read') or 0)) * RATE['input'] + (u.get('cache_read') or 0) * RATE['cached'] + (u.get('output') or 0) * RATE['output']
ts = lambda s: dt.datetime.fromisoformat(s.replace('Z', '+00:00'))

readings = []
for f in sorted(glob.glob(os.path.join(a.quota_dir, '*-default.json'))):
    t = dt.datetime.strptime(os.path.basename(f)[:15], '%Y%m%dT%H%M%S').replace(tzinfo=dt.timezone.utc)
    m = re.search(r'"id": ?"gemini-weekly"[^}]*?"remaining_fraction": ?([0-9.]+)', open(f).read())
    if m: readings.append((t, float(m.group(1))))
spend = []   # (time, $) for every call this job made, block calls and calls of pages read alone
for root in a.runs.split(','):
    for d in glob.glob(os.path.join(root, '*', '*')):
        for line in open(os.path.join(d, 'calls.jsonl')) if os.path.exists(os.path.join(d, 'calls.jsonl')) else []:
            c = json.loads(line); spend.append((ts(c['ts']), sum(usd(u) for u in (c.get('usage') or []) if u)))
        for f in glob.glob(os.path.join(d, '*.meta.json')):
            m = json.load(open(f))
            if not m.get('call_id') and m.get('usage'): spend.append((ts(m['finished_at']), sum(usd(u) for u in m['usage'] if u)))
bounds = []
for (t0, f0), (t1, f1) in zip(readings, readings[1:]):
    x = sum(s for t, s in spend if t0 < t <= t1); d = f0 - f1
    if d > 0.002 and x > 0: bounds.append({'from': t0.isoformat(), 'to': t1.isoformat(), 'pool_fell': d, 'job_usd': x, 'week_at_least_usd': x / d})
cap = max((b['week_at_least_usd'] for b in bounds), default=None)
A = json.load(open(a.analysis))
rows = []
for spec in a.queue.split(','):
    lang, pages, books = spec.split(':'); pages, books = int(pages), int(books)
    R = A['langs'].get(lang)
    if not R: continue
    S = R['weighted'] if R.get('weighted') else R['unweighted']
    live = next(c for c in S['cells'] if c['live'])
    best = next((c for c in S['cells'] if c['name'] == S['optimum']), live)
    if best['saving_vs_live'] < A['min_saving']: best = live
    usd_live = pages / 1000 * live['usd_per_1k_accepted']; usd_best = pages / 1000 * best['usd_per_1k_accepted']
    rows.append({'lang': lang, 'pages': pages, 'books': books, 'best': best['name'], 'usd_live': usd_live, 'usd_best': usd_best,
                 'weeks_live': usd_live / cap if cap else None, 'weeks_best': usd_best / cap if cap else None,
                 'reader_hours_live': pages / live['accepted_per_hour_one_reader'], 'reader_hours_best': pages / best['accepted_per_hour_one_reader']})
json.dump({'built_by': 'scripts/eval/read-surface-6740/backlog.py', 'readings': [(t.isoformat(), f) for t, f in readings], 'bounds': bounds,
           'week_of_quota_at_least_usd': cap, 'queue_measured': '2026-10-31, frame.mjs (visible books held as scans only, the first-read lane frame; unread pages = pages_count - pages_ocr)',
           'note': 'weeks are an upper bound (the capacity is a lower bound: other jobs shared the pool) for one lane with the whole default pool', 'rows': rows}, open(1, 'w'), indent=1, default=str)
