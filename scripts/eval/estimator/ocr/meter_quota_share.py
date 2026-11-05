#!/usr/bin/env python3
# PRIOR ART: /root/agy-quota/meter.py + report.sh on Hetzner main (the passive agy meter: calls per model per hour and
# the calls before each 429, summarised on #6331) and climits (`~/.claude-limits/history.jsonl`, weekly points per
# account). Neither turns a reading into a share of the plan per call; this does, for route-costs.json (#6740).
"""Quota share per call for the subscription routes, from the meters (#6740).

  python3 scripts/eval/estimator/ocr/meter_quota_share.py [--calls /root/agy-quota/calls.csv]

agy (one Google account, every model in one pool as the meter counts it): the plan's realised capacity is the
number of calls that succeeded over a metered stretch in which the account also hit its cap (so the stretch used the
whole allowance), scaled to a 30-day month. A cross-check is the 5-hour ceiling: the calls in the 5 h before each
429 burst (status.json past_bursts), times the 5-hour windows in a month. A call's quota share is 1 / capacity.

Claude (`claude -p`, per account): one point = 1% of an account's weekly limit. There is no per-call OCR reading;
the only measured calibration is sealed Sonnet text calls (66 calls = +2 weekly points, 2026-10-14, #6721), passed
in by hand with --claude-points-per-call. Re-measure on image calls before routing on it.
"""
import argparse, csv, datetime as dt, json, sys


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--calls', default='/root/agy-quota/calls.csv')
    ap.add_argument('--status', default='/root/agy-quota/status.json')
    ap.add_argument('--claude-points-per-call', type=float, default=2 / 66)
    a = ap.parse_args()
    rows = list(csv.DictReader(open(a.calls)))
    t = [dt.datetime.fromisoformat(r['start_utc']) for r in rows]
    days = (t[-1] - t[0]).total_seconds() / 86400
    if days <= 0:
        sys.exit(f'{a.calls}: fewer than two distinct call times; no rate to read')
    ok = sum(1 for r in rows if not r['quota_429_resets_in'])
    capped = sum(1 for r in rows if r['quota_429_resets_in'])
    cap_month = ok / days * 30
    bursts = [b['prev5h'] for b in json.load(open(a.status)).get('past_bursts', []) if b.get('prev5h')]
    five_h = sorted(bursts)[len(bursts) // 2] if bursts else None
    out = dict(
        agy=dict(metered_from=rows[0]['start_utc'], metered_to=rows[-1]['start_utc'], days=round(days, 2),
                 calls_ok=ok, calls_429=capped, capacity_per_30d=round(cap_month),
                 share_per_call=1 / cap_month,
                 cross_check_5h=dict(median_calls_before_429=five_h, bursts=bursts,
                                     capacity_per_30d=round(five_h * 30 * 24 / 5) if five_h else None)),
        claude=dict(points_per_call=a.claude_points_per_call, share_per_call=a.claude_points_per_call / 100,
                    basis='weekly points; 66 sealed Sonnet text calls = +2 points (2026-10-14, #6721); not an OCR reading'))
    print(json.dumps(out, indent=1))


if __name__ == '__main__':
    main()
