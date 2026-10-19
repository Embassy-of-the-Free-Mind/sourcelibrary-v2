# Lexicons for the lexicon-hit numbers (#5664, mongol-selfgt). PRIOR ART: shapekey.py (session research) — the
# training-label lexicon is built exactly as there; MC2 is added per Derek's inbox note (2026-10-18T19:38Z).
import json
from collections import Counter, defaultdict
from align import mwords
C = {}
for chs, k in [('ᠠᠡᠨ', 'A'), ('ᠣᠤᠥᠦᠸ', 'O'), ('ᠲᠳ', 'T'), ('ᠬᠭᠺᠻᠾ', 'Q'), ('ᠵᠶᠽ', 'J'), ('ᠪᠫᠹ', 'B'), ('ᠢᠧ', 'I'), ('ᠰᠱ', 'S'), ('ᠴᠼ', 'C')]:
    for ch in chs: C[ch] = k
C.update({'ᠩ': 'AQ', 'ᠮ': 'M', 'ᠯ': 'L', 'ᠷ': 'R'})
def key(w): return ''.join(C.get(c, '?') for c in w)
LABELS = '/root/jobs/mongol-synth-5664/data/labels.jsonl'
MC2 = '/root/jobs/mongol-selfgt-5664/lexicon-mc2.tsv'
def load(name):
    lex = Counter()
    if name == 'labels':
        for l in open(LABELS):
            for w in mwords(json.loads(l)['text']): lex[w] += 1
    else:
        for l in open(MC2):
            w, c = l.rstrip('\n').split('\t'); lex[w] = int(c)
    lk = defaultdict(Counter)
    for w, n in lex.items(): lk[key(w)][w] += n
    return lex, lk
