#!/usr/bin/env python3
"""
Draw the second-rater sample for the aliveness instrument (#6652): 20 judge-CONFIRMED, 20 judge-REJECTED and 20
screen-NEGATIVE passages from the lexical lane, seeded, each with an excerpt around its evidence sentence (or around
the matched phrase for screen negatives). A second rater (a different model family from the Gemini judge) marks each
yes/no per layer WITHOUT seeing the judge's verdict, written to second-rater.jsonl; agreement is computed by
build-aliveness.py. PRIOR ART: none for this instrument; the July paper named "no second rater" as its blocker.
  python3 build/second-rater-sample.py <dir>  → <dir>/second-rater-sample.txt (blind) + second-rater-key.json
"""
import json, os, random, sys, re
D = sys.argv[1]; random.seed(66520)
S = {json.loads(l)['page_id']: json.loads(l) for l in open(os.path.join(D, 'classified-lex.jsonl'))}
J = {json.loads(l)['page_id']: json.loads(l) for l in open(os.path.join(D, 'judged-lex.jsonl'))}
T = {json.loads(l)['page_id']: json.loads(l)['text'] for l in open(os.path.join(D, 'hits-lex-dedup.jsonl'))}
L3 = ['felt', 'world', 'made']
conf = [p for p, j in J.items() if any(j[L] for L in L3)]
rej = [p for p, j in J.items() if not any(j[L] for L in L3)]
neg = [p for p, r in S.items() if not any(r[L] for L in L3)]
pick = [(p, 'confirmed') for p in random.sample(conf, 20)] + [(p, 'rejected') for p in random.sample(rej, 20)] + [(p, 'screen-negative') for p in random.sample(neg, 20)]
random.shuffle(pick)
def window(t, s, w=450):
    i = t.lower().find((s or '').lower()[:60]) if s else -1
    if i < 0: return t[:2 * w]
    return ('…' if i > w else '') + t[max(0, i - w):i + len(s) + w] + ('…' if i + len(s) + w < len(t) else '')
out = []; key = []
for k, (p, g) in enumerate(pick, 1):
    r = S[p]; ev = next((r.get(L + '_quote') for L in L3 if r.get(L + '_quote')), None) or r.get('probe')
    out.append(f"### {k}  [{r['book_title'][:60]}, {r['book_year']}]  phrase: \"{r['probe']}\"\n{window(T[p], ev)}\n")
    key.append({'k': k, 'page_id': p, 'group': g, 'judge': {L: J.get(p, {}).get(L) for L in L3}})
open(os.path.join(D, 'second-rater-sample.txt'), 'w').write('\n'.join(out))
json.dump(key, open(os.path.join(D, 'second-rater-key.json'), 'w'), indent=0)
print(len(out), 'items;', sum(len(x) for x in out), 'chars')
