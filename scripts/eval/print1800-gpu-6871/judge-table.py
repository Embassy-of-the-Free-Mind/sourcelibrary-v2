#!/usr/bin/env python3
"""judge-table.py — #6871: the preregistered judged rules for (a) fr/it/de and (b) en/de/fr.

PRIOR ART: scripts/eval/euro-gpu-correct-7567/judge-table.py (E2's table over judge.mjs verdicts and the arm key;
the same fault classes). A version not shown (no read, or a guard refusal) counts as misleading.
  judge-table.py <panel dir> <set a|b> <ARMNAME>
"""
import json, os, sys
D, SET, ARM = sys.argv[1:4]
key = json.load(open(f'{D}/judge-key.json'))
FAULTS = ['omissions', 'additions', 'cross_page_bleed', 'order_errors', 'misreads']
res = {}
for s, k in key.items():
    lang = k['lang']; r = res.setdefault(lang, {'n': 0, 'mis': {}, 'more': {}, 'invented': 0, 'usable': 0, 'shown': 0, 'not_delivered': 0, 'no_verdict': 0})
    r['n'] += 1
    f = f'{D}/judge-run/judge/out/{s}.json'
    v = json.load(open(f))['verdict'] if os.path.exists(f) else None
    per = {}
    for a in k['not_delivered']: per[a] = {'usable': False, 'faults': 99, 'shown': False}
    if k['labels'] and not v: r['no_verdict'] += 1; continue
    for lab, arms in k['labels'].items():
        x = v['versions'][lab]
        nf = sum(len(x.get(c) or []) for c in FAULTS)
        for a in arms: per[a] = {'usable': bool(x.get('usable')), 'faults': nf, 'shown': True, 'inv': bool((x.get('additions') or []) + (x.get('cross_page_bleed') or []))}
    for a, x in per.items(): r['mis'][a] = r['mis'].get(a, 0) + (not x['usable'])
    if SET == 'a':
        L, E = per.get('L'), per.get(ARM)
        if L and E:
            if E['faults'] > L['faults']: r['more'][ARM] = r['more'].get(ARM, 0) + 1
            if L['faults'] > E['faults']: r['more']['L'] = r['more'].get('L', 0) + 1
    else:
        E = per[ARM]
        if not E['shown']: r['not_delivered'] += 1
        else:
            r['shown'] += 1; r['usable'] += E['usable']; r['invented'] += E.get('inv', False)
out = {}
for lang, r in sorted(res.items()):
    if SET == 'a':
        ok = r['mis'].get(ARM, 0) <= r['mis'].get('L', 0) and r['more'].get(ARM, 0) <= r['more'].get('L', 0)
        print(f"{lang}: n={r['n']} misleading L {r['mis'].get('L',0)} / {ARM} {r['mis'].get(ARM,0)}; more faults: {ARM} {r['more'].get(ARM,0)} vs L {r['more'].get('L',0)}  {'PASS' if ok else 'fail'}")
    else:
        share = r['usable'] / r['n'] if r['n'] else 0
        ok = r['invented'] <= 1 and share >= 0.8
        print(f"{lang}: n={r['n']} shown {r['shown']} usable {r['usable']} ({share:.0%} of all) invented/bleed {r['invented']} not delivered {r['not_delivered']}  {'PASS' if ok else 'fail'}")
    out[lang] = {**r, 'pass': ok}
json.dump(out, open(f'{D}/judge-table.json', 'w'), indent=1)
