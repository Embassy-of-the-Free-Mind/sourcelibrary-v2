"""Loop-scan rows by OCR model and by book: does the model, not the text type, explain the loop rate?"""
import json, collections, statistics
D = '/Users/dereklomas/sourcelibrary/scratchpad/syriac-vs-published'
rows = [json.loads(l) for l in open(f'{D}/out/2026-09-16-syriac-loop-pages.jsonl')]
books = {b['id']: b for b in json.load(open(f'{D}/syriac-books.json'))}
rows = [r for r in rows if r['loop'] is not None]
print('scored pages', len(rows))
by = collections.defaultdict(list)
for r in rows: by[r['model']].append(r)
for m, rs in sorted(by.items(), key=lambda x: -len(x[1])):
    lp = sum(r['loop'] >= .5 for r in rs) / len(rs); lv = sum(r['uniqRatio'] <= .25 for r in rs) / len(rs)
    print(f'  model {str(m):32s} pages {len(rs):6d} looped {lp:5.1%} low-variety {lv:5.1%} translated {sum(r["hasTr"] for r in rs) / len(rs):.0%}')
# within-book comparison: books that have BOTH models with >=20 pages each
print('\nbooks with both models (>=20 pages each): looped% flash vs lite')
bb = collections.defaultdict(lambda: collections.defaultdict(list))
for r in rows: bb[r['bid']][r['model']].append(r)
for bid, d in bb.items():
    f, l = d.get('gemini-3-flash-preview', []), d.get('gemini-3.1-flash-lite-preview', [])
    if len(f) >= 20 and len(l) >= 20:
        print(f"  {books.get(bid, {}).get('title', bid)[:45]:45s} flash {sum(r['loop'] >= .5 for r in f) / len(f):5.1%} (n={len(f)})  lite {sum(r['loop'] >= .5 for r in l) / len(l):5.1%} (n={len(l)})")
# the 25-page preview pattern: pages 1-25 are flash in most lite books; compare pages 26-50 lite vs 1-25 flash is confounded by front matter, so skip.
# per-book table for the report: loop rate and share of pages with a served translation
print('\nper-book: looped% | translated pages | model mix')
tbl = []
for bid, d in bb.items():
    rs = [r for m in d.values() for r in m]
    tbl.append((sum(r['loop'] >= .5 for r in rs) / len(rs), len(rs), sum(r['hasTr'] for r in rs), books.get(bid, {}).get('title', bid)[:48], bid,
                {str(m)[7:18]: len(v) for m, v in d.items()}))
tbl.sort(reverse=True)
for lp, n, t, title, bid, mix in tbl: print(f'  {lp:5.1%} | {n:5d} pages | {t:5d} tr | {title:48s} | {bid} | {mix}')
