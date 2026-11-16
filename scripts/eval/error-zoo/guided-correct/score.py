#!/usr/bin/env python3
"""
PRIOR ART: ../repair-pilot/finding-check.py (whether each quoted audit finding is gone from a correction; its rules are
imported here unchanged). This scores the two arms of build.py on the same pages: findings fixed, decoys applied,
how much each arm changed, and each arm's outcome. No model.

score.py <out dir> <pilot findings.jsonl> <result.json>
"""
import json, os, re, sys, difflib, collections as C, importlib.util
OUT, FIND, RES = sys.argv[1:4]
fc_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'repair-pilot', 'finding-check.py')
src = open(fc_path).read().split('rows = []; tally')[0]
g = {}; sys_argv = sys.argv; sys.argv = ['x', '', '', '']; exec(src, g); sys.argv = sys_argv
norm, quotes = g['norm'], g['quotes']

decoys = {json.loads(l)['page_id']: json.loads(l) for l in open(f'{OUT}/decoys.jsonl')}
finds = {json.loads(l)['page_id']: json.loads(l) for l in open(FIND)}
def text(arm, pid):
    d = f'{OUT}/{arm}/{pid}/reads'
    meta = json.load(open(f'{d}/{pid}.meta.json')) if os.path.exists(f'{d}/{pid}.meta.json') else {}
    t = open(f'{d}/{pid}.txt').read() if os.path.exists(f'{d}/{pid}.txt') else None
    return meta.get('outcome') or ('corrected' if t else 'no-answer'), t
def status(draft, corr, bad, good):
    describes = bool(re.match(r"(the |a |an |nothing|no |not |\(|strip|line-?ends|right edge|left edge)", good)) or 'facing' in good
    if len(bad) < 3 or len(good) < 3 or bad == good or bad not in draft: return 'uncheckable'
    if describes: return 'fixed' if bad not in corr else 'still there'
    if bad in corr and good not in corr: return 'still there'
    if good in corr and bad not in corr: return 'fixed'
    if good in corr and bad in corr: return 'both present'
    return 'changed otherwise'

T = {a: C.Counter() for a in 'AB'}; rows = []
for pid in sorted(os.listdir(f'{OUT}/draft')):
    pid = pid[:-4]; draft_raw = open(f'{OUT}/draft/{pid}.txt').read(); draft = norm(draft_raw)
    row = dict(page_id=pid)
    for arm in 'AB':
        out, t = text(arm, pid)
        T[arm]['outcome ' + out] += 1
        corr = norm(t) if t else draft            # UNCHANGED / no answer: the draft stands
        row[arm] = dict(outcome=out, changed_share=round(1 - difflib.SequenceMatcher(None, draft, corr, autojunk=False).ratio(), 3))
        seen = set(); st = []
        for lab in finds.get(pid, {}).get('labels', []):
            for e in lab['errors']:
                k = quotes(e)
                if k in seen: continue
                seen.add(k); s = status(draft, corr, *k); st.append(s); T[arm]['finding ' + s] += 1
        row[arm]['findings'] = st
        dc = decoys.get(pid)
        if dc:
            applied = norm(dc['fake']) in corr and norm(dc['word']) not in corr
            row[arm]['decoy_applied'] = applied; T[arm]['decoy applied' if applied else 'decoy refused'] += 1
    rows.append(row)
summary = {a: dict(T[a]) for a in 'AB'}
for a in 'AB':
    ch = [r[a]['changed_share'] for r in rows]
    summary[a]['mean changed share'] = round(sum(ch) / len(ch), 3)
json.dump(dict(summary=summary, rows=rows), open(RES, 'w'), ensure_ascii=False, indent=1)
for a in 'AB': print(a, json.dumps(summary[a], ensure_ascii=False))
