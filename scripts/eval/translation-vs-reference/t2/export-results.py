#!/usr/bin/env python3
# PRIOR ART: translation-vs-reference/score.mjs writes results.json (per arm, per stratum it knows) and gallery.mjs a
# gallery by score only; neither knows T2's extra strata (print vs manuscript, edition period, page script), the
# image-checked cause labels, or the six-dimension pass. This joins them into the publishable per-page rows (#5531).
"""Export #5695 T2 results: pages.jsonl (one row per page x arm, reference metadata, private text withheld), strata, cause shares, six-dimension profile, gallery.md."""
import json, glob, random, collections, math, os, re, sys
W = sys.argv[1]; OUT = sys.argv[2]
def jl(f): return [json.loads(l) for l in open(f) if l.strip()]
pid = lambda r: f"{r['book_id']}_{int(r['page_number']):05d}"
REC = {pid(r): r for r in jl(f'{W}/records-arms.jsonl')}
CORE = {pid(r): r for r in jl(f'{W}/records.jsonl')}
drawn = {d['book_id']: d for d in json.load(open(f'{W}/drawn.json'))}
rs = json.load(open(f'{OUT}/results-served.json')); ra = json.load(open(f'{OUT}/results-arms.json'))
S = {p['id']: p for p in rs['per_page']}; A = {p['id']: p for p in ra['per_page']}
cause = {c['id']: c for c in jl(f'{W}/cause/all.jsonl')}
cgroup = {x['id']: x['group'] for f in glob.glob(f'{W}/cause/in-*.json') for x in json.load(open(f))}
key6 = json.load(open(f'{W}/sixdim/key.json')); six = {s['id']: s for f in glob.glob(f'{W}/sixdim/out-*.jsonl') for s in jl(f)}
gal = json.load(open(f'{W}/gallery-ids.json'))
words = lambda t, n: ' '.join(str(t).split()[:n]) + (' …' if len(str(t).split()) > n else '')
def bucket(r):
    b = drawn[r['book_id']]['bucket']; return 'manuscript' if r['page_kind'] == 'manuscript' else {'<1450': 'print (date unknown)', '?': 'print (date unknown)'}.get(b, 'print ' + b)
def wilson(k, n, z=1.96):
    if not n: return None
    p = k / n; d = 1 + z*z/n; c = (p + z*z/(2*n)) / d; h = z * math.sqrt(p*(1-p)/n + z*z/(4*n*n)) / d
    return [round(c-h, 3), round(c+h, 3)]
rng = random.Random(5695)
def boot(v):
    if len(v) < 2: return None
    b = sorted(sum(rng.choices(v, k=len(v)))/len(v) for _ in range(5000)); return [round(b[125], 2), round(b[4874], 2)]

# ── pages.jsonl: one row per page x arm ─────────────────────────────────────────────────────────────
rows = []
for i, r in REC.items():
    m = r['reference_meta']; core = CORE[i]; c = cause.get(i)
    base = dict(track='T2', id=i, book_id=r['book_id'], page_number=r['page_number'], page_url=f"https://sourcelibrary.org/book/{r['book_id']}?page={r['page_number']}",
        image=next(x['image'] for x in drawn[r['book_id']]['pages'] if x['page_number'] == r['page_number']),
        book=r['book'], lang=r['lang'], period_of_work=r['period'], edition_stratum=bucket(r), page_kind=r['page_kind'], page_language=r['page_language'],
        licences=r['licences'], reference=dict(title=m['title'], translator=m['translator'], year=m.get('year'), licence=m['licence'], publishable=not m['private'], style=m['style'],
            canonical=bool(m.get('canonical')), located=m.get('located'), url=m.get('url'), edition_note=m.get('edition_note'), coverage_note=core['reference_meta'].get('coverage_note'),
            text=(core['reference_text'] if not m['private'] else None), text_withheld=bool(m['private'])),
        alignment_confidence=r.get('alignment_confidence'), reference_fit=S[i]['reference_fit'],
        cause=(dict(group=cgroup[i], primary_cause=c['primary_cause'], ocr_quality=c['ocr_quality'], share_of_error_from_ocr=c['share_of_error_from_ocr'], diagnosis=c['diagnosis'], causes=c['causes'], n_corrections=c.get('n_corrections'), corrected_from=c.get('corrected_from')) if c else None),
        gallery=next((g for g, ids in gal.items() if i in ids), None))
    for cand in r['candidates']:
        arm = cand['arm']; a = A[i]['arms'].get(arm)
        row = dict(base, arm=arm, model=cand.get('model'), prompt_version=cand.get('prompt_version'), text=cand['text'], cost_usd=cand.get('cost_usd'),
            source_text=(r['source_text'] if arm == 'lite-corr' else core['source_text']), source_is_corrected_transcription=(arm == 'lite-corr'),
            arms_packet=dict(judge='j1', judged_against=('corrected transcription' if r.get('source_corrected') else 'ocr'), **({k: a['by_judge']['j1'][k] for k in ('fidelity', 'omission', 'reversal', 'span', 'invention', 'defects')} if a else {})))
        if arm == 'served':
            s = S[i]['arms']['served']; row['core_packet'] = dict(fidelity_mean=s['fidelity'], by_judge=s['by_judge'], reasons=S[i]['reasons'])
            if i in six:
                L = next(k for k, v in key6[i].items() if v == 'served'); Lr = 'B' if L == 'A' else 'A'
                row['six_dimensions'] = dict(served=dict(fidelity=s['fidelity'], **six[i][L]), reference=dict(fidelity=None, **six[i][Lr]), different_legitimate_choices=six[i].get('different_legitimate_choices'), choice=six[i].get('choice'))
        if arm != 'served':  # the page-level blocks live once, on the served row
            row['cause'] = None; row['reference'] = dict(row['reference'], text=None, text_on='served row')
        rows.append(row)
open(f'{OUT}/pages.jsonl', 'w').write('\n'.join(json.dumps(x, ensure_ascii=False) for x in rows) + '\n')

# ── strata on the core (two-judge) served score ─────────────────────────────────────────────────────
def strat(keyfn):
    g = collections.defaultdict(list)
    for i, p in S.items():
        f = p['arms']['served']['fidelity']
        if f is not None: g[keyfn(i)].append(f)
    return {k: dict(n=len(v), fidelity_mean=round(sum(v)/len(v), 2), ci=boot(v) if len(v) >= 10 else None, share_le3=round(sum(x <= 3 for x in v)/len(v), 2), reported=len(v) >= 10) for k, v in sorted(g.items())}
strata = dict(
    page_kind=strat(lambda i: REC[i]['page_kind']), edition_stratum=strat(lambda i: bucket(REC[i])), period_of_work=strat(lambda i: REC[i]['period']),
    page_language=strat(lambda i: REC[i]['page_language']), served_model=strat(lambda i: 'lite' if 'lite' in CORE[i]['candidates'][0]['model'] else 'flash'),
    reference_style=strat(lambda i: REC[i]['reference_meta']['style']), canonical=strat(lambda i: 'canonical' if REC[i]['reference_meta'].get('canonical') else 'non-canonical'),
    reference_publishable=strat(lambda i: 'open' if not REC[i]['reference_meta']['private'] else 'private'))
# ── causes ──────────────────────────────────────────────────────────────────────────────────────────
def shares(g):
    cs = [c for i, c in cause.items() if cgroup[i] == g]; n = len(cs); cnt = collections.Counter(c['primary_cause'] for c in cs)
    return dict(n=n, primary_cause={k: dict(pages=v, share=round(v/n, 2), wilson95=wilson(v, n)) for k, v in cnt.most_common()}, ocr_quality=dict(collections.Counter(c['ocr_quality'] for c in cs)),
        by_page_kind={k: dict(collections.Counter(c['primary_cause'] for i, c in cause.items() if cgroup[i] == g and REC[i]['page_kind'] == k)) for k in ('printed', 'manuscript')},
        by_edition_stratum={b: dict(collections.Counter(c['primary_cause'] for i, c in cause.items() if cgroup[i] == g and bucket(REC[i]) == b)) for b in sorted({bucket(REC[i]) for i in cause})})
def fa(i, arm): a = A[i]['arms'].get(arm); return a['fidelity'] if a else None
corr = [i for i in cause if cause[i]['corrected_transcription']]
def corr_block(ids):
    b = [fa(i, 'lite-a') for i in ids]; a = [fa(i, 'lite-corr') for i in ids]
    return dict(n=len(ids), lite_on_ocr=round(sum(b)/len(b), 2), lite_on_corrected=round(sum(a)/len(a), 2), delta=round(sum(a)/len(a)-sum(b)/len(b), 2), delta_ci=boot([x-y for x, y in zip(a, b)]), pages_ge4_before=sum(x >= 4 for x in b), pages_ge4_after=sum(x >= 4 for x in a))
causes = dict(method='image opened for every page the two judges scored <= 3 (n=22) and 10 seeded random others; one Opus reader per page, quoting the image; 2 pages re-read by the job owner', low=shares('low'), random=shares('random'),
    corrected_transcription_arm=dict(all=corr_block(corr), low_pages=corr_block([i for i in corr if cgroup[i] == 'low']), random_pages=corr_block([i for i in corr if cgroup[i] == 'random']),
        by_primary_cause={pc: corr_block([i for i in corr if cause[i]['primary_cause'] == pc]) for pc in ('ocr_misread', 'translation', 'page_seam') if any(cause[i]['primary_cause'] == pc for i in corr)}))
# ── six dimensions ──────────────────────────────────────────────────────────────────────────────────
dims = ['readability', 'register', 'terminology', 'ambiguity', 'transparency']
prof = {w: collections.defaultdict(list) for w in ('served', 'reference')}; stance = {w: collections.Counter() for w in prof}
for i, s in six.items():
    for L in 'AB':
        w = key6[i][L]; stance[w][s[L]['stance']] += 1
        for d in dims: prof[w][d].append(s[L][d])
fid6 = [S[i]['arms']['served']['fidelity'] for i in six if S[i]['arms']['served']['fidelity'] is not None]
sixdim = dict(n=len(six), pages='15 gallery + 15 seeded random', judge='one Opus judge, translations blinded as A/B', profile={w: dict(fidelity=(round(sum(fid6)/len(fid6), 2) if w == 'served' else None), **{d: round(sum(v)/len(v), 2) for d, v in prof[w].items()}) for w in prof}, stance={w: dict(stance[w]) for w in stance},
    different_legitimate_choices=sum(1 for s in six.values() if s.get('different_legitimate_choices')))
# ── arms ────────────────────────────────────────────────────────────────────────────────────────────
def paired(a, b, ids): d = [fa(i, a) - fa(i, b) for i in ids]; return dict(n=len(ids), delta=round(sum(d)/len(d), 2), ci=boot(d), a_better=sum(x > 0 for x in d), b_better=sum(x < 0 for x in d))
unc = [i for i in REC if not REC[i].get('source_corrected')]
retest = [A[i]['arms']['served']['fidelity'] - S[i]['arms']['served']['by_judge']['j1']['fidelity'] for i in unc if S[i]['arms']['served']['by_judge']['j1']['fidelity'] is not None]
costs = collections.defaultdict(list)
for r in REC.values():
    for c in r['candidates']:
        if c.get('cost_usd') is not None: costs[c['arm']].append(c['cost_usd'])
arms = dict(note='one Opus judge (j1); on the 26 image-checked pages with a corrected transcription every arm was judged against the corrected text, so those scores are fidelity to the PAGE, not to the OCR',
    gate_override='planted control fell on a page whose base candidate already scored 1 against the corrected source (floor); the judge located the planted word. Core packet gate: 6/6 controls per judge passed.',
    x1_noise_floor=dict(model_side='lite-a and lite-b byte-identical on 75/75 pages (temperature 0, thinking off): no sampling noise', judge_retest=dict(n=len(retest), mean_diff=round(sum(retest)/len(retest), 3), exact=round(sum(x == 0 for x in retest)/len(retest), 2), mean_abs=round(sum(abs(x) for x in retest)/len(retest), 2))),
    per_arm={a: dict(pages=v['pages'], fidelity=v['fidelity']['mean'], ci=v['fidelity']['ci'], omission=v['omission']['rate'], reversals_per_100pp=round(100*v['reversal']['rate'], 1), boundary=v['invention_by_kind']['boundary']['rate'], unreadable_fill=v['invention_by_kind']['unreadable_fill']['rate']) for a, v in ra['arms'].items()},
    flash_vs_lite=dict(all=paired('flash', 'lite-a', list(REC)), printed=paired('flash', 'lite-a', [i for i in REC if REC[i]['page_kind'] == 'printed']), manuscript=paired('flash', 'lite-a', [i for i in REC if REC[i]['page_kind'] == 'manuscript']), source_not_corrected=paired('flash', 'lite-a', unc)),
    opus_ceiling=dict(vs_lite=paired('opus', 'lite-a', [i for i in REC if fa(i, 'opus') is not None]), vs_flash=paired('opus', 'flash', [i for i in REC if fa(i, 'opus') is not None])),
    cost_per_page_usd={a: round(sum(v)/len(v), 5) for a, v in costs.items()}, api_spend_usd=round(sum(sum(v) for v in costs.values()), 3))
json.dump(dict(strata=strata, causes=causes, six_dimensions=sixdim, arms=arms, gallery=gal), open(f'{OUT}/summary.json', 'w'), indent=1, ensure_ascii=False)
# causes + corrected transcriptions (our own work, publishable)
open(f'{OUT}/cause-by-image.jsonl', 'w').write('\n'.join(json.dumps(dict(c, group=cgroup[i]), ensure_ascii=False) for i, c in sorted(cause.items())) + '\n')

# ── gallery.md ──────────────────────────────────────────────────────────────────────────────────────
G = ['# T2 gallery: Ancient & Byzantine Greek, served English vs a published translation (#5695)', '',
     'Five best, five median, five worst. All 15 have an OPEN reference (`publishable: true`). The worst five are the lowest-scoring page for each distinct cause (the five lowest by score alone are all manuscripts with the same cause). Scores are the mean of two blind Opus judges, 1–5.', '']
def clean(t): return re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', t)).strip()
for g in ('best', 'median', 'worst'):
    G.append(f'## {g.capitalize()}'); G.append('')
    for i in gal[g]:
        r = CORE[i]; m = r['reference_meta']; c = cause.get(i); s = S[i]['arms']['served']
        dcls = collections.Counter(d['class'] for j in s['by_judge'].values() for d in j['defects'])
        G += [f"### {r['book']['title'][:80]} — p. {r['page_number']} ({m.get('located', '')[:90]})",
              f"- fidelity **{s['fidelity']}** · {bucket(REC[i])} · page language {r['page_language']} · [page]({'https://sourcelibrary.org/book/' + r['book_id'] + '?page=' + str(r['page_number'])}) · publishable: true",
              f"- reference: {m['translator']} ({m.get('year')}), {m['style']}, {m['licence']}",
              f"- defect classes (judges): {', '.join(f'{k}×{v}' for k, v in dcls.most_common(4)) or 'none'}",
              f"- cause (image opened): **{c['primary_cause']}** — {c['diagnosis']}" if c else f"- diagnosis (judges): {S[i]['reasons']['j1'][:300]}",
              f"- source: {words(clean(r['source_text']), 30)}", f"- ours: {words(clean(re.sub(r'<(summary|keywords|note|meta)>.*?</\\1>', ' ', r['candidates'][0]['text'], flags=re.S)), 45)}",
              f"- reference: {words(clean(r['reference_text'].replace('[context]', '')), 45)}"]
        if i in six and six[i].get('different_legitimate_choices'): G.append(f"- different legitimate choice: {six[i]['choice']}")
        G.append('')
open(f'{OUT}/gallery.md', 'w').write('\n'.join(G))
print(len(rows), 'rows;', json.dumps(strata['edition_stratum']), json.dumps(causes['low']['primary_cause']))
