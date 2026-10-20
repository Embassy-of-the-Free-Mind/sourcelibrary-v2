#!/usr/bin/env python3
"""
Figures and tables for the paper's "v5 (September 2026)" section, as inline SVG with CSS-variable fills.

PRIOR ART: build/make-figures.py — same frame/txt/rect helpers and the validated categorical palette
(--s1..--s4); its figures are the July paper's and are NOT regenerated (their inputs are the paper's data
and are kept as deployed). This file draws only what v5 adds: the lane overlap, the experiential rate and
register mix per lane, the rate per probe language, the language composition, and the §6 neighbour test
re-run — July values are carried alongside from the paper's own figure (fig_neighbours) for comparison.

  V5_OUT=… python3 build/make-figures-v5.py   → v5-assets.json {figures, tables, numbers}
"""
import json, os, collections

V5 = os.environ.get('V5_OUT') or os.path.expanduser('~/sourcelibrary/scripts/output/experience-map/v5')
JULY = os.environ.get('JULY_OUT') or os.path.join(V5, '..')
d = json.load(open(f'{V5}/map-data-v5.json')); M = d['meta']; LN = M['lanes']; LP = LN['profiles']
base = [json.loads(l) for l in open(f'{JULY}/baseline-classified.jsonl') if l.strip()]
allcls = [json.loads(l) for l in open(f'{V5}/classified-v5.jsonl') if l.strip()]

esc = lambda s: (str(s).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;'))
INK, MUTE, GRID = 'var(--fig-ink)', 'var(--fig-mute)', 'var(--fig-grid)'
S1, S2, S3, S4 = 'var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)'

def frame(w, h, body, title=''):
    return (f'<svg viewBox="0 0 {w} {h}" width="100%" role="img" aria-label="{esc(title)}" '
            f'style="max-width:100%;height:auto;font-family:var(--ff-data);font-size:11px">{body}</svg>')
def txt(x, y, s, fill=INK, anchor='start', size=11, weight='400', ls='0'):
    return (f'<text x="{x:.1f}" y="{y:.1f}" fill="{fill}" text-anchor="{anchor}" '
            f'font-size="{size}" font-weight="{weight}" letter-spacing="{ls}">{esc(s)}</text>')
def rect(x, y, w, h, fill, rx=0, op=1):
    return f'<rect x="{x:.1f}" y="{y:.1f}" width="{max(0,w):.1f}" height="{max(0,h):.1f}" fill="{fill}" rx="{rx}" opacity="{op}"/>'

FIG = {}
P = LN['perLane']; sOnly, lOnly, both = P.get('semantic', 0), P.get('lexical', 0), P.get('semantic+lexical', 0)

# ---------------------------------------------------------------- lane overlap
def fig_lanes():
    rows = [('Only the English probe sentences', sOnly, S1), ('Only the native-language terms', lOnly, S2), ('Both lanes', both, S4)]
    w, h, PAD_L = 720, 170, 250
    mx = max(r[1] for r in rows) or 1
    scale = (w - PAD_L - 110) / mx
    b = [txt(0, 14, f'CANDIDATE PAGES  (of {LN["candidates"]:,})', MUTE, size=10, ls='.12em')]
    for i, (lab, v, col) in enumerate(rows):
        y = 34 + i * 40
        b.append(txt(PAD_L - 10, y + 16, lab, INK, anchor='end', size=11.5))
        b.append(rect(PAD_L, y, v * scale, 22, col))
        b.append(txt(PAD_L + v * scale + 8, y + 16, f'{v:,}  ({100*v/LN["candidates"]:.1f}%)', INK, size=12, weight='500'))
    b.append(txt(0, h - 6, 'The two instruments searched the same library and agreed on 1.4% of what they found.', MUTE, size=10))
    return frame(w, h, ''.join(b), 'Pages found by each retrieval lane')

# ---------------------------------------------------------------- experiential rate per lane
def fig_rate():
    B = M['baseline']
    rows = [('Random corpus pages (July sample)', B['experientialPct'], S3)]
    for lab, key, col in [('Found only by English probes', 'semantic', S1), ('Found only by native terms', 'lexical', S2), ('Found by both', 'both', S4)]:
        if LP.get(key): rows.append((lab + f'  (n = {LP[key]["n"]:,})', LP[key]['experientialPct'], col))
    w, h, PAD_L = 720, 60 + 44 * len(rows), 300
    scale = (w - PAD_L - 80) / 100.0
    b = [txt(0, 14, 'PASSAGES DESCRIBING EXPERIENCE FROM THE INSIDE  (%)', MUTE, size=10, ls='.12em')]
    for i, (lab, v, col) in enumerate(rows):
        y = 34 + i * 44
        b.append(txt(PAD_L - 10, y + 17, lab, INK, anchor='end', size=11.5))
        b.append(rect(PAD_L, y, v * scale, 22, col))
        b.append(txt(PAD_L + v * scale + 8, y + 17, f'{v}%', INK, size=13, weight='500'))
    return frame(w, h, ''.join(b), 'Experiential rate by retrieval lane, against the random baseline')

# ---------------------------------------------------------------- register mix per lane (stacked)
REGS = [('testimony', 'Testimony', S1), ('vision-narrative', 'Vision narrative', S2), ('instruction', 'Instruction', S3),
        ('doctrine', 'Doctrine', S4), ('fiction', 'Fiction', MUTE)]
def fig_register():
    rows = [(lab, LP[key]) for lab, key in [('English probes only', 'semantic'), ('Native terms only', 'lexical'), ('Both lanes', 'both')] if LP.get(key)]
    w, PAD_L, LH = 720, 170, 46
    h = 56 + LH * len(rows) + 10
    scale = (w - PAD_L - 30) / 100.0
    b = [txt(0, 14, 'REGISTER OF THE PASSAGES EACH LANE RETRIEVED  (% of passages classified)', MUTE, size=10, ls='.12em')]
    lx = 0
    for _, lab, col in REGS:
        b.append(rect(lx, 24, 9, 9, col)); b.append(txt(lx + 13, 32, lab, MUTE, size=10)); lx += 13 + len(lab) * 5.6 + 18
    for i, (lab, p) in enumerate(rows):
        y = 46 + i * LH
        b.append(txt(PAD_L - 10, y + 15, lab, INK, anchor='end', size=11.5))
        b.append(txt(PAD_L - 10, y + 29, f'n = {p["n"]:,}', MUTE, anchor='end', size=9.5))
        x = PAD_L
        for key, _, col in REGS:
            v = p['registerPct'].get(key, 0)
            b.append(rect(x, y + 2, v * scale, 20, col))
            if v >= 7: b.append(txt(x + v * scale / 2, y + 16, f'{v:.0f}%', '#fff' if col != MUTE else INK, anchor='middle', size=10, weight='500'))
            x += v * scale
    return frame(w, h, ''.join(b), 'Register mix by retrieval lane')

# ---------------------------------------------------------------- rate per probe language (lexical lane)
def fig_probelang():
    rows = sorted([p for p in LN['byProbeLanguage'] if p['n'] >= 100], key=lambda p: -p['experientialPct'])[:16]
    w, PAD_L, LH = 720, 150, 24
    h = 40 + LH * len(rows) + 10
    scale = (w - PAD_L - 150) / 100.0
    b = [txt(0, 14, 'EXPERIENTIAL RATE BY THE LANGUAGE THE SEARCH TERM WAS WRITTEN IN  (%)', MUTE, size=10, ls='.12em')]
    for i, p in enumerate(rows):
        y = 30 + i * LH
        b.append(txt(PAD_L - 10, y + 14, p['probe_lang'], INK, anchor='end', size=11))
        b.append(rect(PAD_L, y + 3, p['experientialPct'] * scale, 15, S2))
        b.append(txt(PAD_L + p['experientialPct'] * scale + 6, y + 14, f'{p["experientialPct"]}%   n = {p["n"]:,}   testimony {p["registerPct"]["testimony"]:.0f}%', MUTE, size=9.5))
    return frame(w, h, ''.join(b), 'Experiential rate by probe language, lexical lane')

# ---------------------------------------------------------------- language composition
def fig_languages():
    corpus = collections.Counter(r.get('book_language') or '?' for r in base); nb = sum(corpus.values())
    cls = collections.Counter(r.get('book_language') or '?' for r in allcls); nc = sum(cls.values())
    plotted = dict(M['languages']); npl = sum(plotted.values())
    langs = [l for l, _ in corpus.most_common(9)]
    for l, _ in cls.most_common(12):
        if l not in langs: langs.append(l)
    langs = langs[:14]
    rows = [(l, 100 * corpus[l] / nb, 100 * cls.get(l, 0) / nc, 100 * plotted.get(l, 0) / npl) for l in langs]
    rows.sort(key=lambda r: -r[1])
    LH, PAD_L, TOP = 40, 116, 46
    w, h = 720, TOP + LH * len(rows) + 26
    mx = max(max(r[1], r[2], r[3]) for r in rows); scale = (w - PAD_L - 74) / mx
    b = [txt(0, 14, 'SHARE OF PASSAGES  (%)', MUTE, size=10, ls='.12em')]
    lx = 0
    for lab, col in [('Corpus (July random sample)', S3), ('v5 candidates, both lanes', S4), ('v5 atlas points', S1)]:
        b.append(rect(lx, 24, 9, 9, col)); b.append(txt(lx + 13, 32, lab, MUTE, size=10)); lx += 13 + len(lab) * 5.6 + 18
    for i, (l, a, bb, c) in enumerate(rows):
        y = TOP + i * LH
        b.append(txt(PAD_L - 8, y + 16, l, INK, anchor='end', size=11.5))
        for j, (val, col) in enumerate(((a, S3), (bb, S4), (c, S1))):
            yy = y + j * 9
            b.append(rect(PAD_L, yy, val * scale, 7, col)); b.append(txt(PAD_L + val * scale + 5, yy + 7, f'{val:.1f}', MUTE, size=9.5))
    return frame(w, h, ''.join(b), 'Language composition: corpus, v5 candidates, v5 atlas'), rows

# ---------------------------------------------------------------- §6 neighbours, July vs v5
JULY_NEIGH = {'Same source book': 12.4, 'Same language': 5.1, 'Same tradition': 2.4, 'Same phenomenological feature': 3.0}
def fig_neighbours():
    rows = [(n['what'], JULY_NEIGH.get(n['what']), n['lift']) for n in LN['neighbours'] if n['what'] in JULY_NEIGH]
    rows.sort(key=lambda r: -(r[1] or 0))
    w, PAD_L, LH = 720, 230, 40
    h = 56 + LH * len(rows) + 16
    mx = max(max(r[1] or 0, r[2] or 0) for r in rows) or 1
    scale = (w - PAD_L - 110) / mx
    b = [txt(0, 14, 'LIFT OVER CHANCE AMONG THE TEN NEAREST NEIGHBOURS', MUTE, size=10, ls='.12em')]
    b.append(rect(0, 24, 9, 9, S3)); b.append(txt(13, 32, 'July 2026 (1,952 points)', MUTE, size=10))
    b.append(rect(180, 24, 9, 9, S1)); b.append(txt(193, 32, f'v5 ({M["countAll"]:,} points)', MUTE, size=10))
    x1 = PAD_L + 1 * scale
    b.append(f'<line x1="{x1:.1f}" y1="40" x2="{x1:.1f}" y2="{h-22}" stroke="{GRID}" stroke-width="1" stroke-dasharray="3 3"/>')
    for i, (lab, jl, vl) in enumerate(rows):
        y = 46 + i * LH
        b.append(txt(PAD_L - 10, y + 15, lab, INK, anchor='end', size=11.5))
        b.append(rect(PAD_L, y + 1, (jl or 0) * scale, 9, S3)); b.append(txt(PAD_L + (jl or 0) * scale + 6, y + 9, f'{jl}×', MUTE, size=9.5))
        b.append(rect(PAD_L, y + 12, (vl or 0) * scale, 9, S1)); b.append(txt(PAD_L + (vl or 0) * scale + 6, y + 20, f'{vl}×', INK, size=10, weight='500'))
    NB = LN.get('neighboursByLane', {})
    if NB.get('semantic') and NB.get('lexical'):
        b.append(txt(0, h - 4, f'Same-language pull among the ten nearest neighbours: {NB["semantic"]["lift"]}× for passages the English probes found, {NB["lexical"]["lift"]}× for those the native terms found.', MUTE, size=10))
    return frame(w, h, ''.join(b), 'What nearest neighbours share: July against v5')

FIG['v5_lanes'] = fig_lanes()
FIG['v5_rate'] = fig_rate()
FIG['v5_register'] = fig_register()
FIG['v5_probelang'] = fig_probelang()
FIG['v5_languages'], lang_rows = fig_languages()
FIG['v5_neighbours'] = fig_neighbours()
for k, v in FIG.items(): print(f'  {k}: {len(v)//1024}KB')

tables = {
    'lanes': {k: {kk: v[kk] for kk in ('n', 'experiential', 'experientialPct', 'quoteVerifiedPct', 'firstPersonPct', 'registers', 'registerPct')} for k, v in LP.items() if v},
    'byProbeLanguage': [{k: p[k] for k in ('probe_lang', 'n', 'experiential', 'experientialPct', 'registerPct', 'traditions')} for p in LN['byProbeLanguage']],
    'byLanguage': LN['byLanguage'],
    'neighbours': LN['neighbours'], 'neighboursByLane': LN.get('neighboursByLane', {}),
    'languages': [[l, round(a, 1), round(b, 1), round(c, 1)] for l, a, b, c in lang_rows],
    'perLane': P,
}
numbers = json.load(open(f'{V5}/v5-numbers.json'))
json.dump({'figures': FIG, 'tables': tables, 'numbers': numbers}, open(f'{V5}/v5-assets.json', 'w'), ensure_ascii=False)
print('wrote v5-assets.json')
