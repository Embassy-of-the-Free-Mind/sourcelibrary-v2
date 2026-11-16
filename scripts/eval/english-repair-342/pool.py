# PRIOR ART: scripts/eval/error-zoo/labels.mjs (spare_audit section) — the same reading of the weekly audit's Opus
# reviews, kept in Python without its Mongo half so the pool can be built from one box's folder with no DB call.
"""Weekly-audit random served pages, Opus reader, one row per (run, page): stage of each serious finding.
   python3 pool.py <spare-audit dir> <out.jsonl>"""
import sys, os, json, re
sa, out = sys.argv[1:3]
rows = []
for run in sorted(os.listdir(sa)):
    base = os.path.join(sa, run)
    if not re.match(r'^(spare-audit-\d{8}-\d+|\d{4}-\d{2}-\d{2})$', run) or not os.path.exists(os.path.join(base, 'draw.json')):
        continue
    draw = json.load(open(os.path.join(base, 'draw.json')))
    byp = {p.get('packet'): p for p in draw['pages']}
    rd = os.path.join(base, 'readers', 'opus', 'reviews')
    if not os.path.isdir(rd): continue
    for f in sorted(os.listdir(rd)):
        if not f.endswith('.json'): continue
        pkt = f[:-5]; d = byp.get(pkt)
        if not d: continue
        try:
            rev = json.load(open(os.path.join(rd, f)))[0]; pk = json.load(open(os.path.join(base, 'packets', f)))[0]
        except Exception: continue
        p = (rev or {}).get('pages', [None])[0]
        if not p: continue
        pp = (pk.get('pages') or [{}])[0]
        errs = []
        for key, st in (('ocr_errors', 'ocr'), ('tr_errors', 'translation'), ('other', 'other')):
            for e in p.get(key) or []:
                errs.append(dict(stage=st, cls=e.get('class'), severity=e.get('severity'), problem=e.get('problem') or e.get('note'),
                                 bad=e.get('ocr') if st == 'ocr' else e.get('english') if st == 'translation' else None,
                                 good=e.get('image') if st == 'ocr' else e.get('source') if st == 'translation' else None))
        ser = [e for e in errs if e['severity'] == 'serious']
        st = {e['stage'] for e in ser}
        wrong = p.get('right_page') == 'no'
        if wrong or 'other' in st and not st & {'ocr', 'translation'}: group = 'other'
        elif st == {'translation'}: group = 'en_only'
        elif st >= {'ocr', 'translation'}: group = 'both'
        elif st == {'ocr'}: group = 'ocr_only'
        elif not ser: group = 'clean'
        else: group = 'other'
        rows.append(dict(run=run, packet=pkt, selection=d.get('stratum'), book_id=d['book_id'], page_number=d['page_number'],
                         language=d.get('language') or (pk.get('book') or {}).get('language'), published=(pk.get('book') or {}).get('published'),
                         title=(pk.get('book') or {}).get('title'), drawn_at=draw.get('drawn_at'), group=group, right_page=p.get('right_page'),
                         image=os.path.join(base, pp['image_file']) if pp.get('image_file') else None,
                         ocr=pp.get('ocr'), translation=pp.get('translation'), errors=errs, tr_score=p.get('tr_score'), ocr_score=p.get('ocr_score')))
with open(out, 'w') as w:
    for r in rows: w.write(json.dumps(r, ensure_ascii=False) + '\n')
import collections as C
print(len(rows), C.Counter((r['selection'], r['group']) for r in rows).most_common())
