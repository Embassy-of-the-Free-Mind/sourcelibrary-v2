#!/usr/bin/env python3
"""
score.py — sign error rate for hieroglyph OCR against pairs.jsonl.

PRIOR ART: scripts/eval/lib/metrics.mjs has `levenshtein`, `cer`, `subsequenceCER`
and `windowedErrorRate` (JavaScript, word/char level, Latin/Han normalisation).
This benchmark needs a Python entry point (the baseline runs on Hetzner where the
repo's Node eval env is not set up) and a code-point filter for the Egyptian
Hieroglyphs block, so the two metrics are re-implemented here in ~40 lines rather
than shelling out to Node. No other Python scorer exists under scripts/eval.

Metrics (all over Unicode code points in U+13000–1342F; format controls
U+13430–1345F and everything else are stripped from both sides first):

  SER_anchored  For each ground-truth SEGMENT (see build_pairs.py), the Levenshtein
                distance to the best-matching window of the model output (semi-global
                alignment: free start/end in the output, Sellers 1980). Pair SER =
                Σ distance / Σ segment length. Robust to pages that carry other texts
                and to gaps in the ORAEC encoding; blind to hallucinated extra output,
                which the sign-count ratio reports.
  SER_full      Plain Levenshtein(ground truth, whole output) / |ground truth|. Only
                meaningful when the page carries nothing but this text and the ORAEC
                encoding covers it (page_exclusive AND token_coverage ≥ 0.95).
  count_ratio   |output signs| / |ground-truth signs| (page_exclusive pairs only).

Controls (--controls): ground truth scored against itself must give 0.0; against a
random shuffle of its own signs it must give > 0.5 on SER_full (an instrument that
cannot tell a page from its own shuffle cannot tell a good read from a bad one —
lesson "an empty set is not disagreement" / "a probe needs a positive control").

Usage:
  score.py --pairs pairs.jsonl --controls
  score.py --pairs pairs.jsonl --outputs results/<run>/  [--md report.md]
    where results/<run>/<pair_id>.json holds {"text": "...model output..."}.
"""
import argparse, json, os, random, statistics, sys

def signs(s):
    return ''.join(ch for ch in (s or '') if 0x13000 <= ord(ch) <= 0x1342F)

def levenshtein(a, b):
    if not a: return len(b)
    if not b: return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]

def anchored_distance(seg, out):
    """Min edit distance from seg to any substring of out (free start and end in out)."""
    if not seg: return 0
    if not out: return len(seg)
    prev = [0] * (len(out) + 1)          # free start: row 0 is all zeros
    for i, ca in enumerate(seg, 1):
        cur = [i]
        for j, cb in enumerate(out, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return min(prev)                     # free end

def looped(out, k=20, reps=4):
    """True if some k-sign window recurs >= reps times: the degenerate repetition the
    repo's OCR loop gate (#4850) catches on Latin/Han pages, seen here on the very first
    smoke pair (a 100-sign phrase repeated to MAX_TOKENS)."""
    if len(out) < k * reps: return False
    seen = {}
    for i in range(0, len(out) - k + 1):
        w = out[i:i + k]; seen[w] = seen.get(w, 0) + 1
        if seen[w] >= reps: return True
    return False

def score_pair(pair, out_text):
    out = signs(out_text)
    segs = pair['gt_segments']
    gt_len = sum(len(s) for s in segs)
    d_anch = sum(anchored_distance(s, out) for s in segs)
    r = {
        'pair_id': pair['pair_id'], 'edition': pair['edition'], 'sign_count': gt_len,
        'out_signs': len(out), 'looped': looped(out),
        'ser_anchored': round(d_anch / gt_len, 4) if gt_len else None,
        'ser_full': None, 'count_ratio': None,
        'full_valid': bool(pair.get('page_exclusive')) and pair.get('token_coverage', 0) >= 0.95,
    }
    if r['full_valid']:
        gt = ''.join(segs)
        r['ser_full'] = round(levenshtein(gt, out) / len(gt), 4)
        r['count_ratio'] = round(len(out) / len(gt), 3)
    return r

def summarise(rows):
    def w(rs, key):
        rs = [x for x in rs if x[key] is not None]
        if not rs: return None
        return round(sum(x[key] * x['sign_count'] for x in rs) / sum(x['sign_count'] for x in rs), 4)
    def med(rs, key):
        v = [x[key] for x in rs if x[key] is not None]
        return round(statistics.median(v), 4) if v else None
    s = {'pairs': len(rows), 'signs': sum(r['sign_count'] for r in rows),
         'ser_anchored_signweighted': w(rows, 'ser_anchored'), 'ser_anchored_median': med(rows, 'ser_anchored'),
         'ser_full_signweighted': w([r for r in rows if r['full_valid']], 'ser_full'),
         'ser_full_median': med(rows, 'ser_full'), 'count_ratio_median': med(rows, 'count_ratio'),
         'looped': sum(1 for r in rows if r.get('looped')), 'status_counts': {},
         'by_edition': {}}
    for r in rows:
        st = r.get('status', 'ok'); s['status_counts'][st] = s['status_counts'].get(st, 0) + 1
    for ed in sorted({r['edition'] for r in rows}):
        rs = [r for r in rows if r['edition'] == ed]
        s['by_edition'][ed] = {'pairs': len(rs), 'signs': sum(r['sign_count'] for r in rs),
                               'ser_anchored_signweighted': w(rs, 'ser_anchored'), 'ser_anchored_median': med(rs, 'ser_anchored'),
                               'ser_full_signweighted': w([r for r in rs if r['full_valid']], 'ser_full')}
    return s

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--pairs', required=True)
    ap.add_argument('--outputs', help='dir of <pair_id>.json with a "text" field')
    ap.add_argument('--controls', action='store_true')
    ap.add_argument('--md', help='write a per-pair markdown table here')
    ap.add_argument('--json', help='write scores + summary here')
    a = ap.parse_args()
    pairs = [json.loads(l) for l in open(a.pairs) if l.strip()]

    if a.controls:
        random.seed(1)
        ok = True
        for p in pairs:
            gt = ''.join(p['gt_segments'])
            ident = score_pair(p, gt)
            sh = list(gt); random.shuffle(sh)
            shuf = score_pair(dict(p, page_exclusive=True, token_coverage=1.0), ''.join(sh))
            flag = '' if (ident['ser_anchored'] == 0 and (shuf['ser_full'] or 0) > 0.5) else '  <-- FAIL'
            if flag: ok = False
            print(f"{p['pair_id']:<24} n={p['sign_count']:>4}  identity anchored={ident['ser_anchored']}  shuffled full={shuf['ser_full']} anchored={shuf['ser_anchored']}{flag}")
        print('controls', 'PASS' if ok else 'FAIL')
        sys.exit(0 if ok else 1)

    rows = []
    for p in pairs:
        f = os.path.join(a.outputs, p['pair_id'] + '.json')
        if not os.path.exists(f):
            rows.append({'pair_id': p['pair_id'], 'edition': p['edition'], 'sign_count': p['sign_count'], 'out_signs': 0,
                         'ser_anchored': None, 'ser_full': None, 'count_ratio': None, 'full_valid': False, 'missing': True})
            continue
        o = json.load(open(f))
        r = score_pair(p, o.get('text', ''))
        r['status'] = o.get('status', 'ok')
        rows.append(r)
    scored = [r for r in rows if not r.get('missing')]
    summ = summarise(scored)
    summ['missing'] = len(rows) - len(scored)
    print(json.dumps(summ, indent=1))
    if a.md:
        with open(a.md, 'w') as f:
            f.write('| pair | edition | GT signs | out signs | SER anchored | SER full | count ratio | looped | status |\n|---|---|---:|---:|---:|---:|---:|---|---|\n')
            for r in rows:
                f.write(f"| {r['pair_id']} | {r['edition']} | {r['sign_count']} | {r['out_signs']} | {r['ser_anchored'] if r['ser_anchored'] is not None else '—'} | {r['ser_full'] if r['ser_full'] is not None else '—'} | {r['count_ratio'] if r['count_ratio'] is not None else '—'} | {'yes' if r.get('looped') else ''} | {r.get('status', 'missing')} |\n")
            f.write('\n```\n' + json.dumps(summ, indent=1) + '\n```\n')
    if a.json:
        json.dump({'summary': summ, 'rows': rows}, open(a.json, 'w'), indent=1)

if __name__ == '__main__':
    main()
