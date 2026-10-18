#!/usr/bin/env python3
"""assemble.py (zh-confirm-6871 copy: writes refs.jsonl HERE, for the fresh draw) — build the final reference set (refs.jsonl) from passes A, B, C and summarise reliability per class.

PRIOR ART: ../zh-residue-refs-6871/assemble.py, copied with only the output dir and date changed; compare.py there — this reuses its han()/rate()/bag(); it adds the final pick and reader-vs-final.

  python3 assemble.py reads draw.json reads/replacements.json reads/pairs_map.json > reliability.json   (writes refs.jsonl)

Final text = pass C where the Han strings of A and B differed (or page_kind did), else pass A (A and B agree).
"""
import json, sys, os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'zh-residue-refs-6871'))
from compare import han, rate, bag, load  # noqa: E402

rd, draw, rep, pmap = sys.argv[1], json.load(open(sys.argv[2])), json.load(open(sys.argv[3])), json.load(open(sys.argv[4]))
here = os.path.dirname(os.path.abspath(__file__))
L = lambda p, pid: load(rd, p, pid)
QWJ = ('qing-wen-jian', lambda t: '清文鑑' in t)  # Manchu–Chinese dictionary pages, a sub-type that crosses classes

refs, rows = [], []
for d in draw['draws']:
    if d['spare']: continue
    pid = rep.get(d['page_id'], d['page_id'])
    A, B = L('A', pid), L('B', pid)
    hasC = load(rd, 'C', pid) is not None
    F = L('C', pid) if hasC else A
    fa, fb, ff = han(A['text'], False), han(B['text'], False), han(F['text'], False)
    agreed_changed = 0
    if hasC:  # characters where A and B agreed but the resolver wrote something else (correlated-error evidence)
        agreed_changed = sum(1 for r in F.get('resolutions', []) if (r.get('X') or '') == (r.get('Y') or '') and r.get('final') != r.get('X'))
    rows.append(dict(cls=d['class'], qwj=QWJ[1](d['title']), page_id=pid, chars=len(ff), kind=F['page_kind'],
        ab=rate(fa, fb), ab_bag=bag(fa, fb), a_f=rate(fa, ff), b_f=rate(fb, ff),
        unres=F.get('unresolvable', 0) if hasC else 0, conf=F['confidence'], agreed_changed=agreed_changed,
        box=F['text'].count('□'), unenc=F['text'].count('▣'), foreign=len(F.get('foreign') or []),
        foreign_read=sum(1 for f in (F.get('foreign') or []) if f.get('translit'))))
    refs.append(dict(page_id=pid, book_id=d['book_id'], title=d['title'], page=next((a['page'] for a in d['alternates'] if a['page_id'] == pid), d['page']) if pid != d['page_id'] else d['page'],
        image_url=next((a['photo'] for a in d['alternates'] if a['page_id'] == pid), d['photo']) if pid != d['page_id'] else d['photo'],
        cls=d['class'], replaced=d['page_id'] if pid != d['page_id'] else None,
        page_kind=F['page_kind'], layout=F['layout'], layout_note=F.get('layout_note'), text=F['text'], margin=F.get('margin'),
        foreign=F.get('foreign') or [], n_han=len(ff), uncertain=F.get('uncertain') or [],
        confidence=F['confidence'], confidence_A=A['confidence'], confidence_B=B['confidence'],
        readers=['opus-A', 'opus-B'] + (['opus-C-resolver'] if hasC else []), resolved=hasC,
        resolutions=F.get('resolutions') if hasC else [], unresolvable_chars=F.get('unresolvable', 0) if hasC else 0,
        ab_cer=rate(fa, fb), model='claude-opus-5-5 (Claude Code subagents, image opened)', date='2026-10-18'))

with open(os.path.join(here, 'refs.jsonl'), 'w') as f:
    for r in refs: f.write(json.dumps(r, ensure_ascii=False) + '\n')

def summ(rs):
    t = [r for r in rs if r['chars'] >= 20 and r['ab'] is not None]
    w = lambda k: round(sum((r[k] or 0) * r['chars'] for r in t) / max(1, sum(r['chars'] for r in t)), 4)
    return dict(pages=len(rs), text_pages=len(t), chars=sum(r['chars'] for r in t),
        ab_cer=w('ab'), ab_bag=w('ab_bag'), a_vs_final=w('a_f'), b_vs_final=w('b_f'),
        pages_ab_over_10pct=sum(1 for r in t if r['ab'] > 0.10),
        unresolvable_chars=sum(r['unres'] for r in rs), agreed_but_corrected=sum(r['agreed_changed'] for r in rs),
        illegible_box=sum(r['box'] for r in rs), unencodable=sum(r['unenc'] for r in rs),
        foreign_spans=sum(r['foreign'] for r in rs), foreign_with_translit=sum(r['foreign_read'] for r in rs),
        mean_conf=round(sum(r['conf'] for r in t) / max(1, len(t)), 3),
        kinds={k: sum(1 for r in rs if r['kind'] == k) for k in sorted({r['kind'] for r in rs})})

out = {c: summ([r for r in rows if r['cls'] == c]) for c in ['table', 'mixed', 'seal', 'reverted', 'other']}
out['_subtype_qing_wen_jian'] = summ([r for r in rows if r['qwj']])
out['_reverted_without_qwj'] = summ([r for r in rows if r['cls'] == 'reverted' and not r['qwj']])
out['_mixed_without_qwj'] = summ([r for r in rows if r['cls'] == 'mixed' and not r['qwj']])
print(json.dumps(out, ensure_ascii=False, indent=1))
