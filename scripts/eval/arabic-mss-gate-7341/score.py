#!/usr/bin/env python3
# PRIOR ART: scripts/eval/mss-thinking-6544/score.py (failed-read rules, Flash-Lite envelope stripping, mean page CER
# with a by-work interval: imported, not copied). Its `fold` is Latin-shaped (case, MUFI, abbreviation marks) and
# scores one fold; #7341 scores Arabic under two normalisations (marks kept / consonantal skeleton with hamza, alef,
# yā and tāʾ marbūṭa folded), per cell (manuscript / print), against KEY-O and KEY-G from build-keys.py.
"""
CER of each arm against the model-adjudicated keys, Arabic gate (#7341).

  python3 scripts/eval/arabic-mss-gate-7341/score.py [--root $JOB_SCRATCH/g] [--json out.json]

Arms: lite (Flash-Lite, production prompt, API), pro.jsonl = f38l (Gemini 3.8 Flash low, agy), opus (claude -p).
Normalisations (letters only; digits, punctuation, spaces and the reader's [?] dropped):
  marks  every letter and combining mark kept (ḥarakāt, shadda, hamza seats as written), NFC
  skel   marks dropped; أ إ آ ٱ → ا, ى ی → ي, ة → ه, ک → ك, ؤ → و, ئ → ي, bare ء dropped
Failed reads are counted, never scored (#6523); "fail=1" is the same mean with every failed read at CER 1.0.
Intervals: 95%, resampled by BOOK (pages of a book are not independent).
"""
import argparse, collections, importlib.util, json, os, re, sys, unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'replicate-6547'))
from textmetrics import lev  # noqa: E402
from disagree import load  # noqa: E402
spec = importlib.util.spec_from_file_location('s6544', os.path.join(HERE, '..', 'mss-thinking-6544', 'score.py'))
s6544 = importlib.util.module_from_spec(spec); spec.loader.exec_module(s6544)

ARMS = {'lite': 'lite', 'f38l': 'pro', 'opus': 'opus'}  # arm -> out file stem
SKEL = str.maketrans({'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ٱ': 'ا', 'ى': 'ي', 'ی': 'ي', 'ة': 'ه', 'ک': 'ك', 'ؤ': 'و', 'ئ': 'ي', 'ء': None})


def letters(t, mode):
    t = unicodedata.normalize('NFC', t or '').replace('ـ', '')
    t = re.sub(r'\[\?\]', ' ', t)
    if mode == 'skel':
        t = ''.join(c for c in unicodedata.normalize('NFD', t) if not unicodedata.category(c).startswith('M'))
        t = unicodedata.normalize('NFC', t).translate(SKEL)
        return ''.join(c for c in t if unicodedata.category(c).startswith('L'))
    return ''.join(c for c in t if unicodedata.category(c)[0] in 'LM')


def page_cer(h, r, mode):
    a, b = letters(h, mode), letters(r, mode)
    return {'cd': lev(a, b), 'cl': len(b)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--root', default=os.path.join(os.environ.get('JOB_SCRATCH', ''), 'g'))
    ap.add_argument('--json')
    a = ap.parse_args()
    S = os.path.join(a.root, 'setB')
    picks = json.load(open(os.path.join(S, 'draw.json')))['picks']
    book = {p['uid']: p['book_id'] for p in picks}
    cell = {p['uid']: p['cell'] for p in picks}
    keys = {k: json.load(open(os.path.join(S, 'keys', f'key-{k}.json'))) for k in ('o', 'g') if os.path.exists(os.path.join(S, 'keys', f'key-{k}.json'))}
    out = {'n_pages': len(picks), 'cells': {}}
    per_page = collections.defaultdict(dict)
    for c in ('ar-ms', 'ar-print'):
        uids = [p['uid'] for p in picks if p['cell'] == c]
        res = {}
        for arm, stem in ARMS.items():
            rows = load(os.path.join(S, 'out', f'{stem}.jsonl'))
            texts, fails, secs = s6544.reads('lite' if arm == 'lite' else arm, rows, uids)
            r = {'given': len(uids), 'read': len(texts), 'failed': fails, 'median_secs': sorted(secs)[len(secs) // 2] if secs else None}
            for kn, key in keys.items():
                for mode in ('marks', 'skel'):
                    per = {u: page_cer(t, key[u], mode) for u, t in texts.items() if u in key}
                    for u, v in per.items():
                        per_page[u][f'{arm}|{kn}|{mode}'] = round(v['cd'] / max(1, v['cl']), 4)
                    m = s6544.mean_ci(per, book)
                    failed_units = {u: {'cd': 1, 'cl': 1} for u in uids if u not in texts and u in key}
                    m1 = s6544.mean_ci({**per, **failed_units}, book)
                    r[f'key-{kn}|{mode}'] = {'mean': m, 'fail=1': m1, 'n': len(per)}
            res[arm] = r
        pairs = {}
        for kn, key in keys.items():
            for mode in ('marks', 'skel'):
                P = {}
                for arm, stem in ARMS.items():
                    texts, _, _ = s6544.reads('lite' if arm == 'lite' else arm, load(os.path.join(S, 'out', f'{stem}.jsonl')), uids)
                    P[arm] = {u: page_cer(t, key[u], mode) for u, t in texts.items() if u in key}
                for x, y in (('opus', 'lite'), ('f38l', 'lite'), ('opus', 'f38l')):
                    pairs[f'{x}-{y}|key-{kn}|{mode}'] = s6544.paired_mean(P[x], P[y], book)
        out['cells'][c] = {'arms': res, 'paired': pairs, 'books': len({book[u] for u in uids})}
    out['per_page'] = per_page
    if a.json:
        json.dump(out, open(a.json, 'w'), ensure_ascii=False, indent=1)
    pct = lambda m: '—' if not m or m[0] is None else f'{100 * m[0]:.1f} [{100 * m[1]:.1f}, {100 * m[2]:.1f}]'
    for c, v in out['cells'].items():
        print(f'\n## {c} ({v["books"]} books)')
        for arm, r in v['arms'].items():
            print(arm, f"read {r['read']}/{r['given']}", r['failed'] or '', '|', ' | '.join(f"{k}: {pct(x['mean'])} fail=1 {pct(x['fail=1'])}" for k, x in r.items() if k.startswith('key-')))
        for k, d in v['paired'].items():
            print('  ', k, '—' if not d else f'{100 * d[0]:+.1f} [{100 * d[1]:+.1f}, {100 * d[2]:+.1f}] n={d[3]}')


if __name__ == '__main__':
    main()
