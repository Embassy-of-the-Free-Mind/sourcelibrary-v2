#!/usr/bin/env python3
"""card-table.py — fold the arms of the GEX45 capability card (#6871) into one JSON + a markdown table.

PRIOR ART: scripts/gpu/ocr-bakeoff-r3-5660/table.js (folds QUALITY scores per arm; this folds speed/VRAM only).

  card-table.py <job dir> > card.md      (also writes <job dir>/card.json)
"""
import glob, json, os, sys

J = sys.argv[1]
TOTAL = 24467  # MiB on the card


def peak(csv):
    try:
        v = [int(l.split(',')[0]) for l in open(csv) if l.strip() and l.split(',')[0].strip().isdigit()]
        return max(v) if v else None
    except FileNotFoundError:
        return None


def items_rate(d):
    """run.json if the pass finished; else the rate from items.jsonl (a pass cut by its 600 s timeout)."""
    rj = os.path.join(d, 'run.json')
    if os.path.exists(rj):
        return json.load(open(rj))
    ij = os.path.join(d, 'items.jsonl')
    if not os.path.exists(ij):
        return None
    recs = [json.loads(l) for l in open(ij) if l.strip()]
    return {'partial': True, 'ok': sum('error' not in r for r in recs), 'errors': sum('error' in r for r in recs)}


rows = []
for R in sorted(glob.glob(os.path.join(J, 'arms', '*'))):
    arm = os.path.basename(R)
    row = {'arm': arm}
    if arm.startswith('paddle-vl'):
        for L in ('0', '1'):
            f = os.path.join(R, f'run-l{L}.json')
            if os.path.exists(f):
                r = json.load(open(f))
                row[f'layout{L}'] = {**r, 'items_per_hour': round(r['pages'] / r['wall_secs_after_load'] * 3600) if r.get('wall_secs_after_load') else None,
                                     'peak_mib': peak(os.path.join(R, f'vram-l{L}.csv'))}
    elif os.path.exists(os.path.join(R, 'run.json')) and not os.path.isdir(os.path.join(R, 'full')):
        row['full'] = {**json.load(open(os.path.join(R, 'run.json'))), 'peak_mib': peak(os.path.join(R, 'vram-full.csv'))}
    else:
        passes = [p for p in ('full', 'beside') if os.path.isdir(os.path.join(R, p)) or os.path.exists(os.path.join(R, f'{p}.notrun.json'))]
        passes += sorted(d for d in os.listdir(R) if d.startswith('ll-') and os.path.isdir(os.path.join(R, d)))
        for p in passes:
            r = items_rate(os.path.join(R, p))
            if r is not None:
                row[p] = {**r, 'peak_mib': peak(os.path.join(R, f'vram-{p}.csv'))}
                ls = os.path.join(R, f'load-secs-{p}')
                if os.path.exists(ls): row[p]['load_secs'] = int(open(ls).read().strip())
                kv = os.path.join(R, f'kv-{p}.txt')
                if os.path.exists(kv): row[p]['kv'] = open(kv).read().strip()[-160:]
            elif os.path.exists(os.path.join(R, f'{p}.notrun.json')):
                row[p] = json.load(open(os.path.join(R, f'{p}.notrun.json')))
    rows.append(row)
json.dump(rows, open(os.path.join(J, 'card.json'), 'w'), indent=1)
print('| arm | pass | items/h | s/item | peak VRAM MiB | notes |')
print('|---|---|---|---|---|---|')
for r in rows:
    for k, v in r.items():
        if k == 'arm': continue
        print(f"| {r['arm']} | {k} | {v.get('items_per_hour', '')} | {v.get('secs_per_item', '')} | {v.get('peak_mib', '')} | "
              f"{ {kk: vv for kk, vv in v.items() if kk in ('errors', 'hit_cap', 'mean_out_tok', 'not_run', 'partial', 'load_secs', 'dim', 'gpu_only_items_per_s', 'torch_peak_reserved_mib', 'median_tokens')} } |")
