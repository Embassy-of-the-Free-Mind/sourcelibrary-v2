#!/usr/bin/env python3
# PRIOR ART: scripts/eval/zh-gemini-reocr-7263/crosscheck.py (the method and its text folding; it compares a corrector to the stored text it
# corrected, so it has no way to set two arms against each other, which is the question here).
"""At each character where the fresh read F and the correction O differ, which side does Paddle's independent read take?
   crosscheck.py SCRATCH OUT.json   Paddle (Pu) saw neither text. Costs no model call. The judge is the same model as both readers, so this is the check not made of Opus."""
import json, re, sys, difflib, unicodedata, collections
SCR, OUT = sys.argv[1], sys.argv[2]
TAGS = re.compile(r'<(language|script|page-type|meta|header|page-num|image-desc|scan-quality|quality|vocab|warning|sig|catchword|columns|gloss)[^>]*>[\s\S]*?</\1>', re.I)
def han(t): return ''.join(c for c in TAGS.sub(' ', t) if re.match(r'[㐀-鿿豈-﫿぀-ヿ\U00020000-\U0002ffff]', c))
def fold(c): return unicodedata.normalize('NFKC', c)
res = {}
for st in ('one', 'ten'):
    P = json.load(open(f'{SCR}/{st}/plan.json')); tot = collections.Counter(); pages = []
    for s in P['selected']:
        rd = lambda a: han(open(f"{SCR}/{st}/texts/{s['key']}.{a}.txt", encoding='utf8').read())
        F, O, Pd = rd('F'), rd('O'), rd('Pu')
        map_p = {}
        for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, O, Pd, autojunk=False).get_opcodes():
            if tag == 'equal' or (tag == 'replace' and i2 - i1 == j2 - j1):
                for k in range(i2 - i1): map_p[i1 + k] = Pd[j1 + k]
        c = collections.Counter()
        for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, O, F, autojunk=False).get_opcodes():
            if tag == 'replace' and i2 - i1 == j2 - j1:
                for k in range(i2 - i1):
                    p = map_p.get(i1 + k)
                    if fold(O[i1 + k]) == fold(F[j1 + k]): continue
                    if p is None: c['no_paddle_char'] += 1
                    elif fold(p) == fold(F[j1 + k]): c['paddle_with_F'] += 1
                    elif fold(p) == fold(O[i1 + k]): c['paddle_with_O'] += 1
                    else: c['paddle_third_reading'] += 1
            elif tag == 'insert': c['F_only_chars'] += j2 - j1
            elif tag == 'delete': c['O_only_chars'] += i2 - i1
        tot.update(c); tot['chars_O'] += len(O); tot['chars_F'] += len(F); tot['chars_Paddle'] += len(Pd)
        pages.append({'key': s['key'], **c, 'chars_O': len(O), 'chars_F': len(F), 'chars_P': len(Pd)})
    res[st] = {'totals': dict(tot), 'pages': pages}
json.dump(res, open(OUT, 'w'), indent=1, ensure_ascii=False)
for st, r in res.items(): print(st, r['totals'])
