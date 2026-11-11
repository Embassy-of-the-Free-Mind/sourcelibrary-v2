# MC2 lexicon (#5664, mongol-selfgt; Derek's inbox note 2026-10-18T19:38Z): word + frequency from the CC0 MC2
# traditional-script crawl (pkupie/mc2_corpus, mn-crawl-only-release-20231127.jsonl). Modern web text.
# PRIOR ART: shapekey.py (session research) builds the 18K training-label lexicon the same way; this adds a second one.
import json, sys
from collections import Counter
sys.path.insert(0, '.'); from align import mwords
lex = Counter(); n = 0
for l in open('mc2/mn-crawl-only-release-20231127.jsonl'):
    try: t = json.loads(l).get('text', '')
    except Exception: continue
    for w in mwords(t): lex[w] += 1
    n += 1
with open('lexicon-mc2.tsv', 'w') as f:
    for w, c in lex.most_common():
        if c >= 2: f.write(f'{w}\t{c}\n')
print('docs', n, 'types', len(lex), 'types freq>=2', sum(1 for c in lex.values() if c >= 2), 'tokens', sum(lex.values()))
