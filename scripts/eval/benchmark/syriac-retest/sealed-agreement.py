# PRIOR ART: benchmark-score.mjs — scores the sealed strata against CBETA/Kanripo windows and the two house tiers; it has no PAGE-XML reader, no order-free line-level CER and no RTL normalisation, which this Syriac retest needs (#4746, #4883).
#!/usr/bin/env python3
"""Per-page word-set agreement on the 28 sealed Syriac pages: print-model consensus (omnisyr~qoruyo-estrangela),
Sophro~omnisyr, flash~omnisyr, lite~flash; with the registry's substratum and the eye-checked class."""
import os, glob, re, unicodedata, json, statistics as st
P = re.compile(r'[ܰ-݊̀-ͯ]'); PU = re.compile(r'[܀-܍\.\,\:\;\!\?\(\)\[\]0-9]+')
def n(s): s = unicodedata.normalize('NFC', s); s = re.sub(r'<[^>]+>', ' ', s); s = PU.sub(' ', P.sub('', s)); return re.sub(r'\s+', ' ', s).strip()
def dice(a, b): A, B = set(a.split()), set(b.split()); return 2 * len(A & B) / max(1, len(A) + len(B))
F = 'gemini-3-flash-preview'; L = 'gemini-3.1-flash-lite'; d = '/root/ocr-bench/images/syriac'
E = ['sophro-defaultseg', 'omnisyr', 'qoruyo-estrangela', 'qoruyo-eastern', F, L]
slugs = sorted(os.path.basename(p)[:-4] for p in glob.glob(d + '/*.jpg'))
T = {e: {s: n(open(f'{d}/out/{e}/{s}.txt').read()) for s in slugs if os.path.exists(f'{d}/out/{e}/{s}.txt')} for e in E}
reg = {}
rp = '/root/ocr-bench/syriac-retest/syriac-registry.json'
if os.path.exists(rp):
    for p in json.load(open(rp))['pages']: reg[p['slug']] = (p.get('substratum'), p.get('observed_substratum'), (p.get('title') or '')[:28], p.get('spare'), p.get('promoted'), p.get('retired'))
print(f"{'slug':22s} {'drawn':10s} {'eye':10s} {'title':28s} print-cons sophro~omni flash~omni lite~flash | chars omni/sophro/flash")
for s in slugs:
    if not all(s in T[e] for e in E): continue
    r = reg.get(s, ('?', '?', '?', None, None, None))
    live = '' if (r[3] and not r[4]) or r[5] else '*'
    print(f"{s:22s} {str(r[0]):10s} {str(r[1]):10s} {r[2]:28s} {dice(T['omnisyr'][s], T['qoruyo-estrangela'][s]):.2f}       {dice(T['sophro-defaultseg'][s], T['omnisyr'][s]):.2f}        {dice(T[F][s], T['omnisyr'][s]):.2f}       {dice(T[L][s], T[F][s]):.2f}      | {len(T['omnisyr'][s])}/{len(T['sophro-defaultseg'][s])}/{len(T[F][s])} {live}")
