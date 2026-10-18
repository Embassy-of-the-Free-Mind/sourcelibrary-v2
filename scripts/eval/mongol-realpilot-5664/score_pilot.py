#!/usr/bin/env python3
"""
PRIOR ART: scripts/eval/mongol-synth-5664/cer.py (synthetic held-out only, per-column mean) and the realgt v23
baseline (PR #6960: pooled CER, align.py norm). This scores every set of the 07-mongol-real-pilot reads the same
pooled way, so its v23 number is directly comparable with the 55.5 % baseline.

  python3 score_pilot.py --refs RUN/realeval/refs.jsonl --pairs R/body-pairs.jsonl \
      reads-a-reread.jsonl reads-pilot.jsonl  > cer.json

Pooled CER = sum of edit distances / sum of reference letters, after norm() (letters and word breaks only).
Prints scores only, never a reference or read string, so its output may be committed. Runs on gex45 beside the labels.
"""
import argparse, json, os, re, sys

PUNCT = '᠂᠃᠄᠅'


def norm(s):   # = align.py norm()
    s = re.sub(r'[᠋-᠏ ]', ' ', s or '')
    s = re.sub('[' + PUNCT + r'᠀᠁‍]', ' ', s)
    return re.sub(r'\s+', ' ', s).strip()


try:
    from rapidfuzz.distance import Levenshtein as _L
    lev = _L.distance
except ImportError:
    def lev(a, b):
        prev = list(range(len(b) + 1))
        for i, ca in enumerate(a, 1):
            cur = [i]
            for j, cb in enumerate(b, 1):
                cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
            prev = cur
        return prev[-1]


def rows(p):
    return [json.loads(l) for l in open(p, encoding='utf8') if l.strip()]


def pooled(pairs):
    e = sum(lev(norm(h), norm(r)) for h, r in pairs)
    n = sum(len(norm(r)) for _, r in pairs)
    return {'n': len(pairs), 'cer': round(e / max(1, n), 4)}


def score(reads, refs):
    out = {}
    subsets = {
        'v23_all': lambda r: r['set'] == 'real-prose',
        'v23_confirmed': lambda r: r['set'] == 'real-prose' and r.get('confirmed'),
        'v23_clean3': lambda r: r['set'] == 'real-prose' and r.get('clean3'),
        'real_train': lambda r: r['set'] == 'real-train',
        'real_title_heldout': lambda r: r['set'] == 'real-title',
        'synth_heldout': lambda r: r['set'] == 'synth-heldout',
    }
    for name, f in subsets.items():
        pairs = [(reads[i]['text'], r['ref']) for i, r in refs.items() if f(r) and i in reads]
        if pairs:
            out[name] = pooled(pairs)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--refs', required=True)
    ap.add_argument('--pairs', help='realgt body-pairs.jsonl: its `read` field is the 55.5 % baseline read')
    ap.add_argument('reads', nargs='*')
    a = ap.parse_args()
    refs = {r['id']: r for r in rows(a.refs)}
    res = {}
    if a.pairs:
        base = {r['id']: {'text': r['read']} for r in rows(a.pairs)}
        res['baseline_realgt_read'] = score(base, refs)
    for p in a.reads:
        rd = {r['id']: r for r in rows(p)}
        rf = dict(refs)
        for i, r in rd.items():   # synthetic held-out rows carry their own ref
            if r.get('set') == 'synth-heldout' and r.get('ref'):
                rf[i] = {'id': i, 'set': 'synth-heldout', 'ref': r['ref']}
        res[os.path.basename(p)] = score(rd, rf)
    json.dump(res, sys.stdout, indent=1)
    print()


if __name__ == '__main__':
    main()
