#!/usr/bin/env python3
# PRIOR ART: none for this signal: the brief defines it and an after-the-fact check on #8017's set A found it. Nothing in
# scripts/eval computes a difflib disagreement over two arms' texts (zh-print-arms-7263/pairs.py compares characters of two
# texts against a third reader's choice, and zh-gemini-reocr-7263/crosscheck.py the same).
"""The mixed route's signal (#7263): keep Han plus 丨 and ｜ in the PFL text and the stored text; 1 - SequenceMatcher ratio.
  signal.py freeze SETA_DIR            top-third cutoff on set A, per page rows, as JSON
  signal.py apply  SET_DIR CUTOFF      per page rows and the pages at or above CUTOFF
Set dirs are plan.json + texts/<key>.<arm>.txt. PFL's text is what the arm serves; stored is `lite`."""
import json, os, re, sys
from difflib import SequenceMatcher

KEEP = re.compile(r'[㐀-䶿一-鿿豈-﫿\U00020000-\U0003ffff丨｜]')
def keep(t): return ''.join(KEEP.findall(t))
def signal(a, b): return 1 - SequenceMatcher(None, keep(a), keep(b), autojunk=False).ratio()

def rows(d):
    P = json.load(open(os.path.join(d, 'plan.json')))
    rd = lambda k, a: open(os.path.join(d, 'texts', f'{k}.{a}.txt'), encoding='utf8').read()
    return [{'key': s['key'], 'signal': round(signal(rd(s['key'], 'PFL'), rd(s['key'], 'lite')), 6)} for s in P['selected']]

if __name__ == '__main__':
    r = rows(sys.argv[2])
    s = sorted(x['signal'] for x in r)
    if sys.argv[1] == 'freeze':
        cut = s[len(s) - len(s) // 3]   # the smallest signal among the top third
        print(json.dumps({'n': len(r), 'top_third': len(s) // 3, 'cutoff': cut, 'rule': 'a page goes to Opus when signal >= cutoff', 'rows': r}, indent=1))
    else:
        cut = float(sys.argv[3])
        print(json.dumps({'n': len(r), 'cutoff': cut, 'sent': sum(x['signal'] >= cut for x in r), 'rows': [{**x, 'send': x['signal'] >= cut} for x in r]}, indent=1))
