# PRIOR ART: scripts/eval/nalanda-readiness/tib_summ2.py (rolls up the 09-30 draw by stratum x served verdict); this compares a re-draw with that draw and adds the dropped-line proxy.
# Summarise the 2026-10-01 confirmatory re-draw against the 2026-09-30 draw: identity by stratum, controls,
# and the dropped-line proxy (page OCR lines vs the book's median) that identity cannot see.
import json, statistics as st, collections, sys
D = '/root/tibetan-eval/redraw-2026-10-01/'
P = '/root/tibetan-eval/nalanda-2026-09-30/'
def load(f): return [json.loads(l) for l in open(f) if l.strip()]
def stats(v):
    v = sorted(v); n = len(v)
    return dict(n=n, median=round(st.median(v), 3), q1=round(v[n // 4], 3), q3=round(v[3 * n // 4], 3), ge09=sum(x >= 0.9 for x in v), lt05=sum(x < 0.5 for x in v))
out = {}
for tag, base in (('redraw_2026-10-01', D), ('draw_2026-09-30', P)):
    S = {r['id']: r for r in load(base + 'scores.jsonl')}
    M = {r['id']: r for r in load(base + 'tib-sample.jsonl')}
    g = collections.defaultdict(list)
    for i, r in S.items(): g[M[i]['stratum']].append(r['identity'])
    o = {k: stats(v) for k, v in g.items()}
    o['control_noise05'] = stats([r['identity'] for r in load(base + 'control.jsonl')])
    o['chance_shuffle'] = stats([r['identity'] for r in load(base + 'chance.jsonl')])
    if tag.startswith('redraw'):
        kj = [M[i] for i in S if M[i]['stratum'] == 'bl-kanjur']
        short = [m for m in kj if m['lines'] < m['book_median_lines']]
        very = [m for m in kj if m['lines'] <= m['book_median_lines'] - 2]
        o['kanjur_pages_below_book_median_lines'] = dict(n=len(kj), short=len(short), rate=round(len(short) / len(kj), 3), two_or_more_short=len(very))
        o['kanjur_identity_short_vs_full'] = dict(short=stats([S[m['id']]['identity'] for m in short]) if short else None, full=stats([S[m['id']]['identity'] for m in kj if m['lines'] >= m['book_median_lines']]))
        o['arms'] = dict(collections.Counter(m['arm'] for m in kj))
        o['leaf_break_pages'] = sum(1 for m in kj if m.get('leaf_breaks'))
        o['overlap_books_with_0930'] = len({M[i]['book_id'] for i in S} & {r['book_id'] for r in load(P + 'tib-sample.jsonl')})
        o['worst_kanjur'] = sorted([(round(S[m['id']]['identity'], 3), f"https://sourcelibrary.org/book/{m['book_id']}?page={m['page_number']}", m['lines'], m['book_median_lines']) for m in kj])[:6]
    out[tag] = o
json.dump(out, open(D + 'summary.json', 'w'), indent=1, ensure_ascii=False)
print(json.dumps(out, indent=1, ensure_ascii=False))
