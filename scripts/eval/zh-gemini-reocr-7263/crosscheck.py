#!/usr/bin/env python3
# PRIOR ART: scripts/eval/flash-reread-5924/fc-judge.mjs (a second-family model judge: a further model call, and a judge's preference);
# this asks the third reader's text instead, at no model cost. Paddle reads pixels and never saw S or O.
"""At each character where the Opus correction O changed the stored text S, which side does Paddle's independent read take?
   crosscheck.py SCRATCH OUT.json. Aligns Han + kana only (difflib on S/O, then S to Paddle). Paddle text = Pu (print), P (siku)."""
import json, re, sys, difflib, unicodedata, collections
SCR, OUT = sys.argv[1], sys.argv[2]
TAGS = re.compile(r'<(language|script|page-type|meta|header|page-num|image-desc|scan-quality|quality|vocab|warning|sig|catchword|columns)[^>]*>[\s\S]*?</\1>', re.I)
def han(t): return ''.join(c for c in TAGS.sub(' ', t) if re.match(r'[㐀-鿿豈-﫿぀-ヿ\U00020000-\U0002ffff]', c))
def fold(c): return unicodedata.normalize('NFKC', c)
res = {}
for st, parm in (('print', 'Pu'), ('siku', 'P')):
    P = json.load(open(f'{SCR}/{st}/plan.json')); tot = collections.Counter(); pages = []
    for s in P['selected']:
        rd = lambda a: han(open(f"{SCR}/{st}/texts/{s['key']}.{a}.txt", encoding='utf8').read())
        S, O, Pd = rd('served'), rd('O'), rd(parm)
        if S == O or S == Pd: pages.append({'key': s['key'], 'skip': 'O or Paddle equals S'}); tot['pages_skipped'] += 1; continue
        map_p = {}   # S index -> Paddle char where the two align
        for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, S, Pd, autojunk=False).get_opcodes():
            if tag == 'equal' or (tag == 'replace' and i2 - i1 == j2 - j1):
                for k in range(i2 - i1): map_p[i1 + k] = Pd[j1 + k]
        c = collections.Counter(); unconfirmed = []
        for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, S, O, autojunk=False).get_opcodes():
            if tag == 'replace' and i2 - i1 == j2 - j1:
                for k in range(i2 - i1):
                    p = map_p.get(i1 + k)
                    if p is None: c['no_paddle_char'] += 1
                    elif fold(p) == fold(O[j1 + k]): c['paddle_with_opus'] += 1
                    elif fold(p) == fold(S[i1 + k]): c['paddle_with_stored'] += 1
                    else: c['paddle_third_reading'] += 1
            elif tag == 'insert':
                c['opus_inserted_chars'] += j2 - j1
                run = O[j1:j2]
                # an inserted run a reader of the pixels also has (bigrams) is on the leaf; one Paddle lacks may be recited or restored
                if len(run) >= 4:
                    bg = [run[i:i + 2] for i in range(len(run) - 1)]; hit = sum(b in Pd for b in bg) / len(bg)
                    c['inserted_runs4'] += 1; c['inserted_chars_in_runs4'] += len(run)
                    if hit >= 0.5: c['inserted_chars_paddle_has'] += len(run)
                    else: unconfirmed.append({'key': s['key'][-8:], 'run': run[:60], 'len': len(run), 'bigram_hit': round(hit, 2)})
            elif tag == 'delete': c['opus_deleted_chars'] += i2 - i1
        tot.update(c); tot['chars_S'] += len(S)
        pages.append({'key': s['key'], **c, 'unconfirmed_inserts': unconfirmed, 'chars_S': len(S), 'chars_O': len(O), 'chars_P': len(Pd)})
    res[st] = {'totals': dict(tot), 'pages': pages}
json.dump(res, open(OUT, 'w'), indent=1, ensure_ascii=False)
for st, r in res.items(): print(st, r['totals'])
