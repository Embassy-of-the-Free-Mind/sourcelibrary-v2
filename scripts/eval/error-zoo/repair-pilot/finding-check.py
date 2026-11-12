#!/usr/bin/env python3
"""
PRIOR ART: scripts/batch/ocr-convergence/driver.mjs audit-score (a blind judge prefers stored or corrected text, page
level); it does not ask whether the SPECIFIC error an audit found is gone. This does, per finding, with no model: each
audit finding that quoted the misread ("bad") and what the scan shows ("good") is looked up in the stored text and
in the correction. Findings without both quotes are counted as uncheckable, never as fixed.

finding-check.py <set-dir> <findings.jsonl> <out.json>
"""
import json, re, sys, unicodedata, collections as C
SET, FIND, OUT = sys.argv[1:4]
def norm(s):
    s = unicodedata.normalize('NFC', s or '').replace('ſ', 's').replace('­', '')
    s = re.sub(r'<[^>]+>', ' ', s); s = re.sub(r'-\s*\n\s*', '', s)
    return re.sub(r'\s+', ' ', s).strip().lower()
def quotes(e):
    bad, good = e.get('bad') or '', e.get('good') or ''
    if not (bad and good):
        m = re.search(r"['‘\"](.+?)['’\"]\s*[—–-]+\s*image\s*['‘\"](.+?)['’\"]", e.get('problem') or '')
        if m: bad, good = m.group(1), m.group(2)
    good = re.split(r'\s*\(', good)[0]  # drop a gloss after the reading: "cōtinētia visus (continentia …)"
    return norm(bad), norm(good)
rows = []; tally = C.Counter()
for l in open(FIND):
    f = json.loads(l); pid = f['page_id']
    stored = norm(open(f'{SET}/stored/{pid}.txt').read()); corr = norm(open(f'{SET}/reads/{pid}.txt').read())
    seen = set()
    for lab in f['labels']:
        for e in lab['errors']:
            bad, good = quotes(e)
            key = (bad, good)
            if key in seen: continue
            seen.add(key)
            # "good" that describes instead of reads (a facing-page strip, nothing on the leaf): the fix is removal
            describes = bool(re.match(r"(the |a |an |nothing|no |not |\(|strip|line-?ends|right edge|left edge)", good)) or 'facing' in good
            if len(bad) < 3 or len(good) < 3 or bad == good: st = 'uncheckable (no quoted misread and reading)'
            elif bad not in stored: st = 'uncheckable (quoted misread not found in the stored text)'
            elif describes: st = 'fixed (removed: the audit said it is not on the leaf)' if bad not in corr else 'still there'
            elif bad in corr and good not in corr: st = 'still there'
            elif good in corr and bad not in corr: st = 'fixed'
            elif good in corr and bad in corr: st = 'both present'
            else: st = 'changed, but not to the reading the audit gave'
            tally[st] += 1
            rows.append(dict(page_id=pid, source=lab['source'], cls=e.get('class'), bad=bad[:80], good=good[:80], status=st))
json.dump(dict(tally=dict(tally), rows=rows), open(OUT, 'w'), ensure_ascii=False, indent=1)
print(dict(tally))
