#!/usr/bin/env python3
# PRIOR ART: score.py — its judge loading, `decode` and `fid` are imported per round, not copied. Nothing else picks a
# SUBSET of the #6545 pages: build-packet.py always takes whole panels (it now reads this file's output via --uids).
"""
select-pages.py [--hard 8] [--ceiling 2] [--seed fable] — $0, no model call.

Picks the pages for a follow-up round on the #6545 panels from the scores that round already has:
  hard     per language, the N pages where the stored OPUS translation scored lowest (mean of the Opus and Pro judges'
           fidelity; ties broken by the mean of the Gemini arms FP, C38, C38S, lowest first, then uid)
  ceiling  per language, M random pages where both judges gave the stored OPUS translation a 5

Selecting on the stored OPUS draw means a FRESH Opus run will score higher on these pages by regression alone, so a
follow-up must compare a new arm with a fresh Opus arm, never with the stored one.

Writes $W/follow-up-uids.json {uid: {lang, stratum, opus_o, opus_p, gemini_mean}} and prints the counts.
"""
import importlib.util, json, os, random, sys

HERE = os.path.dirname(os.path.abspath(__file__))
argv = sys.argv[1:]
opt = lambda k, d: argv[argv.index(f'--{k}') + 1] if f'--{k}' in argv else d
N_HARD, N_CEIL, SEED = int(opt('hard', '8')), int(opt('ceiling', '2')), opt('seed', 'fable')


def load_round(name):
    """score.py reads its round from argv at import; load it once per round under its own module name."""
    sys.argv = ['score.py', name]
    spec = importlib.util.spec_from_file_location(f'score_{name}', os.path.join(HERE, 'score.py'))
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    return m


mean = lambda xs: sum(xs) / len(xs) if xs else None
pages = {}
for rnd in ('r1s1', 'r1s2'):
    m = load_round(rnd)
    for i, k in m.ITEMS.items():
        if k['kind'] != 'ARMS': continue
        o, p = m.fid('opus', i, 'OPUS'), m.fid('pro', i, 'OPUS')
        if o is None or p is None: continue
        gem = [m.fid(j, i, a) for j in ('opus', 'pro') for a in ('FP', 'C38', 'C38S')]
        pages[k['page_id']] = {'lang': k['lang'], 'opus_o': o, 'opus_p': p, 'gemini_mean': round(mean([x for x in gem if x is not None]), 2)}

from common import W  # noqa: E402  (after score.py has put this directory on sys.path)

out = {}
for L in sorted({v['lang'] for v in pages.values()}):
    rows = sorted(((u, v) for u, v in pages.items() if v['lang'] == L), key=lambda x: ((x[1]['opus_o'] + x[1]['opus_p']) / 2, x[1]['gemini_mean'], x[0]))
    hard = rows[:N_HARD]
    top = [r for r in rows[N_HARD:] if r[1]['opus_o'] == 5 and r[1]['opus_p'] == 5]
    ceil = random.Random(f'{SEED}-{L}').sample(top, min(N_CEIL, len(top)))
    for u, v in hard: out[u] = {**v, 'stratum': 'hard'}
    for u, v in ceil: out[u] = {**v, 'stratum': 'ceiling'}
    print(f"{L:9s} pages {len(rows):3d}  both-5 {sum(1 for _, v in rows if v['opus_o'] == 5 and v['opus_p'] == 5):3d}  "
          f"hard {len(hard)} (stored OPUS mean {mean([(v['opus_o'] + v['opus_p']) / 2 for _, v in hard]):.2f}, Gemini arms {mean([v['gemini_mean'] for _, v in hard]):.2f})  ceiling {len(ceil)}")
json.dump(out, open(f'{W}/follow-up-uids.json', 'w'), indent=1)
print(len(out), 'pages ->', f'{W}/follow-up-uids.json')
