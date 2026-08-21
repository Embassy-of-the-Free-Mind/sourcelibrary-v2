#!/usr/bin/env python3
"""
Generate the paper's figures as inline SVG.

SVG rather than raster so the figures stay crisp and, more importantly, so every
fill can be a CSS custom property — the figures then re-colour themselves for the
reader's light or dark theme instead of shipping a baked-in background.

Every figure carries direct value labels, because three of the categorical slots
sit below 3:1 contrast on a light surface and the relief rule requires visible
labels or a table. Each figure also has a table beneath it in the paper.
"""
import json, collections, math

HERE = '/private/tmp/claude-501/-Users-dereklomas-sourcelibrary/b4cc9f10-7660-4f2b-b3cf-554d4017f8f7/scratchpad'
d2 = json.load(open(f'{HERE}/map-data-v2.json')); M2 = d2['meta']
dc = json.load(open(f'{HERE}/map-data-compare.json')); MC = dc['meta']
base = [json.loads(l) for l in open(f'{HERE}/baseline-classified.jsonl')]
c3 = [json.loads(l) for l in open(f'{HERE}/classified-v3.jsonl')]
cj = [json.loads(l) for l in open(f'{HERE}/classified-jhana.jsonl')]
v1 = json.load(open(f'{HERE}/map-data.json'))

esc = lambda s: (str(s).replace('&','&amp;').replace('<','&lt;').replace('>','&gt;'))
FIG = {}

INK   = 'var(--fig-ink)'
MUTE  = 'var(--fig-mute)'
GRID  = 'var(--fig-grid)'
S1, S2, S3, S4 = 'var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)'

def frame(w, h, body, title=''):
    return (f'<svg viewBox="0 0 {w} {h}" width="100%" role="img" aria-label="{esc(title)}" '
            f'style="max-width:100%;height:auto;font-family:var(--ff-data);font-size:11px">{body}</svg>')

def txt(x, y, s, fill=INK, anchor='start', size=11, weight='400', ls='0'):
    return (f'<text x="{x:.1f}" y="{y:.1f}" fill="{fill}" text-anchor="{anchor}" '
            f'font-size="{size}" font-weight="{weight}" letter-spacing="{ls}">{esc(s)}</text>')

def rect(x, y, w, h, fill, rx=0):
    return f'<rect x="{x:.1f}" y="{y:.1f}" width="{max(0,w):.1f}" height="{max(0,h):.1f}" fill="{fill}" rx="{rx}"/>'

# ---------------------------------------------------------------- F1 languages
def fig_languages():
    corpus = collections.Counter(r.get('book_language') or '?' for r in base)
    nb = sum(corpus.values())
    v1c = collections.Counter(p['lang'] for p in v1['points']); n1 = len(v1['points'])
    v4c = collections.Counter(p['lang'] for p in d2['points']); n4 = len(d2['points'])
    langs = [l for l, _ in corpus.most_common(9)]
    for l, _ in v4c.most_common(9):
        if l not in langs: langs.append(l)
    langs = langs[:12]
    rows = [(l, 100*corpus[l]/nb, 100*v1c.get(l,0)/n1, 100*v4c.get(l,0)/n4) for l in langs]
    rows.sort(key=lambda r: -r[1])

    LH, PAD_L, TOP = 40, 116, 46
    w, h = 720, TOP + LH*len(rows) + 26
    mx = max(max(r[1], r[2], r[3]) for r in rows)
    scale = (w - PAD_L - 74) / mx
    b = [txt(0, 14, 'SHARE OF PASSAGES  (%)', MUTE, size=10, ls='.12em')]
    leg = [('Corpus (random sample)', S3), ('Retrieval v1 — global search', S4), ('Retrieval v2 — stratified', S1)]
    lx = 0
    for lab, col in leg:
        b.append(rect(lx, 24, 9, 9, col)); b.append(txt(lx+13, 32, lab, MUTE, size=10)); lx += 13 + len(lab)*5.6 + 18
    for i, (l, a, bb, c) in enumerate(rows):
        y = TOP + i*LH
        b.append(txt(PAD_L-8, y+16, l, INK, anchor='end', size=11.5))
        for j, (val, col) in enumerate(((a, S3), (bb, S4), (c, S1))):
            yy = y + j*9
            b.append(rect(PAD_L, yy, val*scale, 7, col))
            b.append(txt(PAD_L + val*scale + 5, yy+7, f'{val:.1f}', MUTE, size=9.5))
    return frame(w, h, ''.join(b), 'Language composition: corpus versus two retrieval strategies'), rows

# ---------------------------------------------------------------- F2 enrichment
def fig_enrichment():
    B = M2['baseline']
    bars = [('Random corpus pages', B['experientialPct'], S3),
            ('Retrieved by modern probes', B['retrievedExperientialPct'], S1),
            ('Claimed by the Visuddhimagga model', MC['vism']['matchRatePct'], S4)]
    w, h, PAD_L = 720, 200, 250
    scale = (w - PAD_L - 80) / 40.0
    b = [txt(0, 14, 'PASSAGES DESCRIBING EXPERIENCE FROM THE INSIDE  (%)', MUTE, size=10, ls='.12em')]
    for i, (lab, v, col) in enumerate(bars):
        y = 40 + i*44
        b.append(txt(PAD_L-10, y+17, lab, INK, anchor='end', size=11.5))
        b.append(rect(PAD_L, y, v*scale, 22, col))
        b.append(txt(PAD_L + v*scale + 8, y+17, f'{v}%', INK, size=13, weight='500'))
    y = 40 + 3*44 + 8
    b.append(f'<line x1="{PAD_L}" y1="{y}" x2="{w-40}" y2="{y}" stroke="{GRID}" stroke-width="1"/>')
    b.append(txt(PAD_L, y+20, f"6.7× enrichment over chance · projected {B['projectedLowK']:,}–{B['projectedHighK']:,}K experiential pages corpus-wide", MUTE, size=10.5))
    return frame(w, h, ''.join(b), 'Experiential rate: baseline, modern probes, indigenous model'), bars

# ---------------------------------------------------------------- F3 register
def fig_register():
    rows = []
    for r in M2['registerSplit']:
        if r['n'] < 40: continue
        rows.append((r['dim'], 100*r['instruction']/r['n'], 100*r['testimony']/r['n'], r['n']))
    rows.sort(key=lambda r: (r[1]-r[2]))
    rows = rows[:6] + rows[-6:]
    w, PAD_C, LH = 720, 300, 26
    h = 60 + LH*len(rows)
    scale = 2.0
    b = [txt(PAD_C, 14, 'INSTRUCTION  ←   → TESTIMONY', MUTE, anchor='middle', size=10, ls='.12em'),
         txt(PAD_C-8, 30, 'share of passages retrieved by that probe theme', MUTE, anchor='end', size=9.5)]
    b.append(f'<line x1="{PAD_C}" y1="38" x2="{PAD_C}" y2="{h-14}" stroke="{GRID}" stroke-width="1"/>')
    for i, (dim, inst, test, n) in enumerate(rows):
        y = 46 + i*LH
        b.append(txt(8, y+13, dim.replace('_',' '), INK, size=11))
        b.append(txt(w-6, y+13, str(n), MUTE, anchor='end', size=9.5))
        b.append(rect(PAD_C - inst*scale, y+2, inst*scale, 13, S3))
        b.append(rect(PAD_C, y+2, test*scale, 13, S1))
        if inst >= 6: b.append(txt(PAD_C - inst*scale - 5, y+12, f'{inst:.0f}%', MUTE, anchor='end', size=9.5))
        if test >= 6: b.append(txt(PAD_C + test*scale + 5, y+12, f'{test:.0f}%', MUTE, size=9.5))
    return frame(w, h, ''.join(b), 'Instruction versus testimony by probe theme'), rows

# ---------------------------------------------------------------- F4 ladder (central)
def fig_ladder():
    li, lo = MC['vism']['ladderInside'], MC['vism']['ladderOutside']
    g = lambda o, k: o.get(k, {'n':0,'pct':0})
    groups = [('Inside the Buddhist tradition', MC['vism']['inside'], li),
              ('Outside the tradition', MC['vism']['outside'], lo)]
    cats = [('Concentration ladder','concentration',S1),
            ('The dark passage (stages 6–11)','dark-night',S4),
            ('Other insight stages','insight-other',S2)]
    w, h, PAD_L = 760, 250, 262
    scale = (w - PAD_L - 96) / 70.0
    b = [txt(0, 14, 'SHARE OF STAGE MATCHES  (%)', MUTE, size=10, ls='.12em')]
    lx = 0
    for lab, _, col in cats:
        b.append(rect(lx, 24, 9, 9, col)); b.append(txt(lx+13, 32, lab, MUTE, size=10)); lx += 13 + len(lab)*5.3 + 16
    for gi, (glab, gn, o) in enumerate(groups):
        y0 = 56 + gi*92
        b.append(txt(PAD_L-12, y0+14, glab, INK, anchor='end', size=11.5))
        b.append(txt(PAD_L-10, y0+30, f'n = {gn}', MUTE, anchor='end', size=10))
        for ci, (clab, key, col) in enumerate(cats):
            v = g(o, key)
            y = y0 + ci*24
            b.append(rect(PAD_L, y, v['pct']*scale, 18, col))
            b.append(txt(PAD_L + v['pct']*scale + 7, y+13, f"{v['pct']}%  ({v['n']})", INK, size=11))
    c = MC['vism']
    b.append(txt(0, h-8, 'χ²(1) = 14.61, p < .001, odds ratio 3.1  (concentration vs dark passage × inside vs outside, n = 265)', MUTE, size=10))
    return frame(w, h, ''.join(b), 'Ladder asymmetry inside versus outside the tradition'), groups

# ---------------------------------------------------------------- F5 neighbours
def fig_neighbours():
    rows = [('Same source book', 13.3, 1.1, 12.4), ('Same language', 34.8, 6.8, 5.1),
            ('Same tradition', 47.3, 19.9, 2.4), ('Same phenomenological feature', 25.9, 8.7, 3.0)]
    rows.sort(key=lambda r: -r[3])
    w, PAD_L, LH = 720, 230, 40
    h = 56 + LH*len(rows) + 14
    scale = (w - PAD_L - 110) / 13.0
    b = [txt(0, 14, 'LIFT OVER CHANCE AMONG THE TEN NEAREST NEIGHBOURS', MUTE, size=10, ls='.12em')]
    x1 = PAD_L + 1*scale
    b.append(f'<line x1="{x1:.1f}" y1="34" x2="{x1:.1f}" y2="{h-20}" stroke="{GRID}" stroke-width="1" stroke-dasharray="3 3"/>')
    b.append(txt(x1+4, 30, 'chance = 1×', MUTE, size=9.5))
    for i, (lab, obs, ch, lift) in enumerate(rows):
        y = 44 + i*LH
        col = S4 if 'feature' in lab else S1
        b.append(txt(PAD_L-10, y+15, lab, INK, anchor='end', size=11.5))
        b.append(rect(PAD_L, y+2, lift*scale, 19, col))
        b.append(txt(PAD_L + lift*scale + 7, y+16, f'{lift}×', INK, size=12, weight='500'))
        b.append(txt(PAD_L + lift*scale + 40, y+16, f'({obs}% vs {ch}% expected)', MUTE, size=9.5))
    b.append(txt(0, h-4, 'Source text and language organise the space more strongly than described experience does.', MUTE, size=10))
    return frame(w, h, ''.join(b), 'What nearest neighbours share, against chance'), rows

# ---------------------------------------------------------------- F6 stages
def fig_stages():
    BUD = {'theravada','tibetan-buddhist','mahayana','buddhist','zen','chan'}
    matched = [r for r in cj if r['stage'] != 'none' and r['experiential'] and r['fit'] in ('native','analogical')]
    outside = [r for r in matched if (r['tradition'] or '') not in BUD]
    inside = [r for r in matched if (r['tradition'] or '') in BUD]
    order = list(MC['stageLabels'].keys())
    DARK = {'nana_06','nana_07','nana_08','nana_09','nana_10','nana_11'}
    CONC = {'access_concentration','jhana_1','jhana_2','jhana_3','jhana_4','base_space',
            'base_consciousness','base_nothingness','base_neither','cessation'}
    oc, ic = collections.Counter(r['stage'] for r in outside), collections.Counter(r['stage'] for r in inside)
    rows = [(s, MC['stageLabels'][s]['label'], MC['stageLabels'][s]['pali'], ic.get(s,0), oc.get(s,0)) for s in order]
    rows = [r for r in rows if r[3]+r[4] > 0]
    w, PAD_L, LH = 760, 276, 21
    h = 56 + LH*len(rows) + 12
    mx = max(max(r[3], r[4]) for r in rows) or 1
    scale = (w - PAD_L - 96) / mx
    b = [txt(0, 14, 'STAGE MATCHES BY SOURCE', MUTE, size=10, ls='.12em')]
    b.append(rect(0, 24, 9, 9, S2)); b.append(txt(13, 32, 'Inside the tradition', MUTE, size=10))
    b.append(rect(150, 24, 9, 9, S4)); b.append(txt(163, 32, 'Outside the tradition', MUTE, size=10))
    for i, (sid, lab, pali, ni, no) in enumerate(rows):
        y = 46 + i*LH
        band = S4 if sid in DARK else (S1 if sid in CONC else S2)
        b.append(rect(0, y+3, 3, 13, band))
        b.append(txt(PAD_L-12, y+13, f'{lab}', INK, anchor='end', size=10.5))
        b.append(rect(PAD_L, y+2, ni*scale, 6, S2))
        b.append(rect(PAD_L, y+9, no*scale, 6, S4))
        b.append(txt(PAD_L + max(ni,no)*scale + 6, y+13, f'{ni} / {no}', MUTE, size=9.5))
    b.append(txt(0, h-2, 'Left rule marks the ladder: blue = concentration, amber = the dark passage, green = other insight stages.', MUTE, size=9.5))
    return frame(w, h, ''.join(b), 'Matches per canonical stage, inside versus outside the tradition'), rows

# ---------------------------------------------------------------- F7 scatter panels
def fig_scatter():
    pts = dc['points']
    west = [p for p in pts if p['src'] == 'west']
    vism = [p for p in pts if p['src'] == 'vism']
    DARKSET = {'dark-night'}
    panels = [('Inside the Buddhist tradition', [p for p in vism if p.get('inside')]),
              ('Outside the tradition', [p for p in vism if not p.get('inside')])]
    PW, PH, GAP = 348, 300, 24
    w, h = PW*2 + GAP, PH + 46
    b = []
    for pi, (lab, sel) in enumerate(panels):
        ox = pi*(PW+GAP)
        b.append(f'<rect x="{ox}" y="26" width="{PW}" height="{PH}" fill="var(--fig-well)" stroke="{GRID}"/>')
        b.append(txt(ox, 16, lab.upper(), MUTE, size=10, ls='.12em'))
        b.append(txt(ox+PW, 16, f'n = {len(sel)}', MUTE, anchor='end', size=10))
        for p in west:
            x = ox + 6 + (p['x']/1000)*(PW-12); y = 32 + (p['y']/1000)*(PH-12)
            b.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="1.1" fill="{MUTE}" opacity=".28"/>')
        for p in sel:
            x = ox + 6 + (p['x']/1000)*(PW-12); y = 32 + (p['y']/1000)*(PH-12)
            col = S4 if p.get('ladder') in DARKSET else (S1 if p.get('ladder')=='concentration' else S2)
            b.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="2.5" fill="{col}" opacity=".92"/>')
    b.append(txt(0, h-4, 'Grey: the 1,952-passage atlas. Blue: concentration stages. Amber: the dark passage. Green: other insight stages.', MUTE, size=9.5))
    return frame(w, h, ''.join(b), 'Where claimed passages fall, inside versus outside the tradition'), None

for name, fn in [('languages', fig_languages), ('enrichment', fig_enrichment),
                 ('register', fig_register), ('ladder', fig_ladder),
                 ('neighbours', fig_neighbours), ('stages', fig_stages), ('scatter', fig_scatter)]:
    svg, data = fn()
    FIG[name] = svg
    print(f'  {name}: {len(svg)//1024}KB')

# ------------------------------------------------------- tabular data for the paper
BUD = {'theravada','tibetan-buddhist','mahayana','buddhist','zen','chan'}
matched = [r for r in cj if r['stage'] != 'none' and r['experiential'] and r['fit'] in ('native','analogical')]
tables = {
  'languages': [[l, round(100*c/len(base),1)] for l, c in collections.Counter(r.get('book_language') or '?' for r in base).most_common(12)],
  'registers_atlas': M2['registers'],
  'registers_baseline': M2['baseline']['baselineRegisters'],
  'registerSplit': M2['registerSplit'],
  'ladder': {'inside': MC['vism']['ladderInside'], 'outside': MC['vism']['ladderOutside'],
             'insideN': MC['vism']['inside'], 'outsideN': MC['vism']['outside']},
  'outsideTraditions': MC['vism']['outsideTraditions'],
  'triggers': M2['triggers'], 'agents': M2['agents'], 'aftermaths': M2['aftermaths'],
  'centuries': M2['centuries'],
  'stageLabels': MC['stageLabels'],
}

# compact machine-readable release: one row per plotted atlas passage
release = [{
  'quote': p['q'], 'book': p['t'], 'author': p.get('a'), 'year': p.get('yr'),
  'language': p.get('lang'), 'tradition': p.get('tr'), 'register': p.get('reg'),
  'features': ';'.join(p.get('f') or []), 'trigger': p.get('tg'), 'aftermath': p.get('af'),
  'agent': p.get('ag'), 'contested': bool(p.get('ct')), 'first_person': bool(p.get('fp')),
  'url': p['u'],
} for p in d2['points']]
vism_release = [{
  'quote': p['q'], 'book': p['t'], 'author': p.get('a'), 'year': p.get('yr'),
  'language': p.get('lang'), 'tradition': p.get('tr'), 'stage': p.get('stage'),
  'stage_label': p.get('stageLabel'), 'pali': p.get('pali'), 'ladder': p.get('ladder'),
  'inside_tradition': bool(p.get('inside')), 'url': p['u'],
} for p in dc['points'] if p['src']=='vism']

json.dump({'figures': FIG, 'tables': tables,
           'release': release, 'vism_release': vism_release,
           'numbers': json.load(open(f'{HERE}/paper-numbers.json'))},
          open(f'{HERE}/paper-assets.json','w'))
print(f'\nrelease rows: atlas {len(release)}, visuddhimagga {len(vism_release)}')
print('wrote paper-assets.json')
