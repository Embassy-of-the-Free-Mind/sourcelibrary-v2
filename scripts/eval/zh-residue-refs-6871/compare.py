#!/usr/bin/env python3
"""compare.py — agreement between two independent Opus reference reads (passes A and B), per page and per class.

PRIOR ART: scripts/eval/lib has CER helpers for Latin text (whitespace/ſ folding) that do not fit Han text with
our ⟨⟩/〔〕/| markers; this is a 60-line Han-only comparison, nothing else.

  python3 compare.py reads <draw.json> <replacements.json> [--pair A B] > agreement.json

Han string = every CJK ideograph in `text` (incl. inside ⟨⟩ and 〔〕), plus □ and ○/〇 (folded to 〇), in reading order.
  ▣ (visible but unencodable, pass-C convention) is not a character here.
  cer_order  = Levenshtein(A, B) / max(len A, len B)        — what a scorer would see
  cer_nobox  = cer_order with □ removed from both (illegible/unnamed placeholders do not count)
  cer_bag    = 1 − |multiset A ∩ multiset B| / max(len)     — character identity only; cer_order − cer_bag ≈
                                                              disagreement that is ORDER only (table direction,
                                                              note sub-column order)
  seal_heads = the ⟨⟩ contents compared as a sequence (seal/clerical head glyphs)
"""
import json, os, re, sys
from collections import Counter

HAN = re.compile(r'[㐀-䶿一-鿿豈-﫿\U00020000-\U0003134f□○〇]')
HEAD = re.compile(r'⟨([^⟩]*)⟩')

def han(t, box=True):
    h = ''.join(HAN.findall(t or '')).replace('○', '〇')  # printed zero/circle: one symbol, two code points
    return h if box else h.replace('□', '')
def heads(t): return ''.join(h if h else '□' for h in HEAD.findall(t or ''))

_cache = {}
def load(rd, p, pid):
    """One read: <rd>/<p>/<pid>.json (scratch layout) or <rd>/<p>.jsonl (committed layout)."""
    f = f'{rd}/{p}/{pid}.json'
    if os.path.exists(f): return json.load(open(f))
    if (rd, p) not in _cache:
        _cache[(rd, p)] = {r['page_id']: r for r in map(json.loads, open(f'{rd}/{p}.jsonl'))} if os.path.exists(f'{rd}/{p}.jsonl') else {}
    return _cache[(rd, p)].get(pid)

def lev(a, b):
    if len(a) < len(b): a, b = b, a
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]

def rate(a, b):
    n = max(len(a), len(b))
    return None if n == 0 else lev(a, b) / n

def bag(a, b):
    n = max(len(a), len(b))
    return None if n == 0 else 1 - sum((Counter(a) & Counter(b)).values()) / n

def main():
    rd, draw, rep = sys.argv[1], json.load(open(sys.argv[2])), json.load(open(sys.argv[3]))
    pa, pb = (sys.argv[sys.argv.index('--pair') + 1], sys.argv[sys.argv.index('--pair') + 2]) if '--pair' in sys.argv else ('A', 'B')
    rows = []
    for d in draw['draws']:
        if d['spare']: continue
        pid = rep.get(d['page_id'], d['page_id'])
        A = load(rd, pa, pid); B = load(rd, pb, pid)
        ha, hb = han(A['text']), han(B['text'])
        sa, sb = heads(A['text']), heads(B['text'])
        rows.append(dict(cls=d['class'], page_id=pid, book_id=d['book_id'], title=d['title'],
            kind=[A['page_kind'], B['page_kind']], layout=[A['layout'], B['layout']],
            len=[len(ha), len(hb)], cer_order=rate(ha, hb), cer_bag=bag(ha, hb),
            cer_nobox=rate(han(A['text'], False), han(B['text'], False)),
            box=[ha.count('□'), hb.count('□')], heads=[len(sa), len(sb)], cer_heads=rate(sa, sb),
            foreign=[len(A.get('foreign') or []), len(B.get('foreign') or [])],
            conf=[A['confidence'], B['confidence']]))
    out = {'pair': [pa, pb], 'pages': rows, 'classes': {}}
    for c in ['table', 'mixed', 'seal', 'reverted', 'other']:
        r = [x for x in rows if x['cls'] == c]
        t = [x for x in r if x['cer_order'] is not None and max(x['len']) >= 20]
        tot = lambda k: sum(x[k] * max(x['len']) for x in t) / max(1, sum(max(x['len']) for x in t))
        sh = [x for x in r if x['cer_heads'] is not None]
        med = lambda v: sorted(v)[len(v) // 2] if v else None
        out['classes'][c] = dict(pages=len(r), text_pages=len(t), chars=sum(max(x['len']) for x in t),
            cer_order_pooled=round(tot('cer_order'), 4) if t else None, cer_bag_pooled=round(tot('cer_bag'), 4) if t else None,
            cer_nobox_pooled=round(tot('cer_nobox'), 4) if t else None,
            cer_order_median=med([x['cer_order'] for x in t]), pages_over_10pct=sum(1 for x in t if x['cer_order'] > 0.10),
            kind_disagree=sum(1 for x in r if x['kind'][0] != x['kind'][1]),
            head_pages=len(sh), heads=sum(max(x['heads']) for x in sh),
            cer_heads_pooled=round(sum(x['cer_heads'] * max(x['heads']) for x in sh) / max(1, sum(max(x['heads']) for x in sh)), 4) if sh else None,
            box_share=round(sum(sum(x['box']) for x in t) / max(1, sum(sum(x['len']) for x in t)), 4))
    print(json.dumps(out, ensure_ascii=False, indent=1))

if __name__ == '__main__':
    main()
