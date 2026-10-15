#!/usr/bin/env python3
"""
Assemble the aliveness ontology (#6720): ontology.json (in the repo) and aliveness-ontology.html (static page for
the experience-atlas site).

PRIOR ART: ../build/assemble-aliveness-page.py — the /aliveness page; this borrows its approach (head + nav from the
live peace.html, house CSS, no framework) but builds a different page from different data, so it is a sibling, not
an extension.

Inputs (OUT = $JOB_SCRATCH/ontology unless given):
  seed-nodes.json, seed-edges.json            hand-authored concepts, relations, chains (this directory)
  OUT/counts.json                             measure.mjs counts
  OUT/cand-passages.jsonl, OUT/cand-edges.jsonl  measure.mjs passages / edges
  OUT/term-candidates.jsonl                   terms.py
  ./verdicts/{terms,passages,edges}-*.jsonl   judges' verdicts, committed (JUDGE-RUBRIC for terms; see JUDGING.md)
  SITE/peace.html                             the live page, for <head> and nav
Outputs: ./ontology.json, SITE/aliveness-ontology.html
  python3 build.py [OUT] [SITE] [--patch-nav]
"""
import datetime, glob, html, json, math, os, re, sys, unicodedata
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
args = [a for a in sys.argv[1:] if not a.startswith('--')]
OUT = args[0] if args else os.path.join(os.environ.get('JOB_SCRATCH', '/tmp'), 'ontology')
SITE = args[1] if len(args) > 1 else os.path.join(OUT, 'site')
PATCH_NAV = '--patch-nav' in sys.argv
MODEL_BG = 'claude-opus-5-5'

seed = json.load(open(os.path.join(HERE, 'seed-nodes.json')))
seed_e = json.load(open(os.path.join(HERE, 'seed-edges.json')))
NODES = seed['nodes']
BY = {n['id']: n for n in NODES}
counts = json.load(open(os.path.join(OUT, 'counts.json')))
jl = lambda p: [json.loads(l) for l in open(p) if l.strip()] if os.path.exists(p) else []
cand_p = {r['node']: r for r in jl(os.path.join(OUT, 'cand-passages.jsonl'))}
cand_e = {r['key']: r for r in jl(os.path.join(OUT, 'cand-edges.jsonl'))}
term_c = {r['node']: r for r in jl(os.path.join(OUT, 'term-candidates.jsonl'))}
bl_p = os.path.join(OUT, 'baseline.json')
baseline = json.load(open(bl_p)) if os.path.exists(bl_p) else None


def verdicts(kind):
    rows = []
    for f in sorted(glob.glob(os.path.join(HERE, 'verdicts', f'{kind}-*.jsonl'))):  # committed: the judges' record
        rows += jl(f)
    return rows


v_terms = {r['node']: r for r in verdicts('terms')}
v_pass = {r['node']: r for r in verdicts('passages')}
v_edge = {r['key']: r for r in verdicts('edges')}

SENT = re.compile('[\u0001-\u0004]')
plain = lambda q: q.replace('\u0001', '').replace('\u0002', '').replace('\u0003', '[').replace('\u0004', ']')


def cent_label(c):
    if c < 0:
        return f'{-c // 100}th c. BCE' if -c // 100 > 3 else f'{-c // 100}{["", "st", "nd", "rd"][-c // 100]} c. BCE'
    n = c // 100 + 1
    suf = 'th' if 10 <= n % 100 <= 20 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')
    return f'{n}{suf} c.'


def yr(y):
    return f'{-y} BCE' if y < 0 else str(y)


# ------------------------------------------------------------------ nodes
out_nodes = []
for n in NODES:
    c = counts.get(n['id'], {})
    books = c.get('books', [])
    live = [b for b in books if b.get('live')]
    dated = [b for b in live if b.get('year') is not None and -1500 <= b['year'] <= 2030]
    by_c, by_t, basis = Counter(), Counter(), Counter()
    for b in dated:
        by_c[(b['year'] // 100) * 100] += b['pages']
        basis[b['basis'].split(':')[0] if b['basis'].startswith('dated-works') else b['basis']] += b['pages']
    for b in live:
        by_t[b.get('tradition') or (b.get('language') and f"{b['language']} (language)") or 'unclassified'] += b['pages']
    first = min(dated, key=lambda b: b['year']) if dated else None
    last = max(dated, key=lambda b: b['year']) if dated else None
    faceted_pages = sum(b['pages'] for b in books)
    # The middle 90% of dated pages, and the peak century: robust to one modern editor's note in an ancient work,
    # which is what a bare earliest/latest picks up.
    span = None
    if dated:
        ds = sorted(dated, key=lambda b: b['year'])
        tot = sum(b['pages'] for b in ds)
        acc, lo, hi = 0, None, None
        for b in ds:
            acc += b['pages']
            if lo is None and acc >= 0.05 * tot:
                lo = b['year']
            if hi is None and acc >= 0.95 * tot:
                hi = b['year']
        span = {'from': lo, 'to': hi, 'peak_century': max(by_c, key=by_c.get)}
    counts_out = {
        'pages': c.get('pages', 0), 'pages_translation': c.get('pages_en', 0), 'books_faceted': c.get('books_faceted', 0),
        'books_capped_at_1000': c.get('books_capped', False), 'per_phrase': c.get('per_phrase', {}),
        'live_books': len(live), 'live_pages': sum(b['pages'] for b in live),
        'dated_pages': sum(b['pages'] for b in dated), 'faceted_pages': faceted_pages,
        'by_century': {str(k): v for k, v in sorted(by_c.items())},
        'by_tradition': dict(by_t.most_common(8)), 'date_basis_pages': dict(basis),
        'span_90': span,
        'first_note': 'earliest/latest dated live book that prints a phrase; may be an editor\'s note in an edition of an older work',
        'first': first and {'year': first['year'], 'book_id': first['id'], 'basis': first['basis']},
        'last': last and {'year': last['year'], 'book_id': last['id'], 'basis': last['basis']},
    }
    # passages: the judges' picks, in their order; each re-checked to be one of the verified candidates
    cands = cand_p.get(n['id'], {}).get('candidates', [])
    picks = []
    vp = v_pass.get(n['id'])
    if vp:
        for p in vp.get('picks', []):
            i = p.get('idx')
            if isinstance(i, int) and 0 <= i < len(cands):
                q = dict(cands[i])
                q['why'] = p.get('why', '')
                picks.append(q)
    passages = [{'quote': plain(q['quote']), 'quote_marked': q['quote'], 'cut': q['cut'], 'url': q['url'], 'book_id': q['book_id'], 'page': q['page'],
                 'title': q['title'], 'author': q['author'], 'work_year': q['year'], 'date_basis': q['basis'], 'edition_year': q.get('edition_year'),
                 'chosen_because': q.get('why', '')} for q in picks[:5]]
    # terms
    tc = term_c.get(n['id'], {})
    seed_surf = {s['term_key']: s for s in tc.get('seed_forms', [])}
    forms = []
    for term, lang in n['forms']:
        k = term.lower()
        s = seed_surf.get(k)
        forms.append({'term': term, 'language': lang, 'tagged_pages': s['tagged_pages'] if s else 0})
    tiers = {'variant': [], 'equivalent': [], 'related': []}
    cur = tc.get('curated')
    if cur:
        for t in ('variant', 'equivalent', 'related'):
            for term in cur[t + 's' if t != 'related' else 'related']:
                tiers[t].append({'term': term, 'source': f"concept-aliases.json ({cur['concept']})"})
    vt = v_terms.get(n['id'])
    rejected_seed = []
    if vt:
        cmap = {x['term_key']: x for x in tc.get('candidates', [])}
        for v in vt.get('verdicts', []):
            tier = v.get('tier') or v.get('verdict')
            k = v.get('term_key')
            if tier in tiers and (k in cmap or k in seed_surf):
                src = cmap.get(k) or seed_surf.get(k)
                term = src.get('term') or (src.get('surfaces') or [k])[0]
                if any(x['term'].lower() == term.lower() for x in tiers[tier]):
                    continue
                if k in seed_surf and tier == 'variant':
                    continue  # seed forms are already listed
                tiers[tier].append({'term': term, 'confidence': v.get('confidence'), 'reason': v.get('reason', ''), 'source': 'page-terms harvest, judged'})
            elif tier == 'reject' and k in seed_surf:
                rejected_seed.append({'term_key': k, 'reason': v.get('reason', '')})
    # One entry per word: case, diacritics, æ/œ and a trailing Latin/Greek case ending of a form already listed are
    # the same word, so they drop from later tiers (a translator's ELIXIR Vitae is the elixir vitae of the forms).
    def fold(t):
        t = unicodedata.normalize('NFD', t.lower().replace('æ', 'ae').replace('œ', 'oe'))
        return re.sub(r'[\W_]+', '', ''.join(ch for ch in t if unicodedata.category(ch) != 'Mn'))
    seen = {fold(f['term']) for f in forms}
    for t in ('variant', 'equivalent', 'related'):
        kept = []
        for x in tiers[t]:
            k = fold(x['term'])
            if k and k not in seen:
                seen.add(k)
                kept.append(x)
        tiers[t] = kept
    out_nodes.append({
        'id': n['id'], 'label': n['label'], 'kind': n['kind'], 'senses': n['senses'], 'tradition': n['tradition'], 'era': n['era'],
        'gloss': n['gloss'], 'gloss_provenance': f'scholarly background ({MODEL_BG})', 'broad': bool(n.get('broad')),
        'search_phrases': n['search'], 'forms': forms, 'terms': tiers, 'seed_forms_rejected': rejected_seed,
        'counts': counts_out, 'passages': passages,
    })
ON = {n['id']: n for n in out_nodes}

# ------------------------------------------------------------------ edges
out_edges = []
for e in seed_e['edges']:
    key = f"{e['from']}|{e['type']}|{e['to']}"
    ce = cand_e.get(key, {})
    v = v_edge.get(key)
    prov = {'kind': 'background', 'model': MODEL_BG, 'claim': e['claim']}
    if v and v.get('verdict') == 'stated':
        i = v.get('idx')
        cs = ce.get('candidates', [])
        if isinstance(i, int) and 0 <= i < len(cs):
            q = cs[i]
            prov = {'kind': 'passage', 'claim': e['claim'], 'judge': v.get('judge', MODEL_BG), 'reason': v.get('reason', ''),
                    'passage': {'quote': plain(q['quote']), 'quote_marked': q['quote'], 'cut': q['cut'], 'url': q['url'], 'title': q['title'],
                                'author': q['author'], 'work_year': q['year'], 'date_basis': q['basis']}}
    out_edges.append({'from': e['from'], 'to': e['to'], 'type': e['type'], 'cooccurring_pages': ce.get('cooccur_pages'), 'provenance': prov})
EK = {(e['from'], e['to']): e for e in out_edges}

chains = []
for ch in seed_e.get('chains', []):
    links = []
    for a, b in zip(ch['nodes'], ch['nodes'][1:]):
        e = EK.get((a, b)) or EK.get((b, a))
        links.append({'from': a, 'to': b, 'edge': f"{e['from']}|{e['type']}|{e['to']}", 'provenance': e['provenance']['kind']})
    chains.append({'title': ch['title'], 'nodes': ch['nodes'], 'links': links})

prov_tally = Counter(e['provenance']['kind'] for e in out_edges)
ontology = {
    'about': {
        'issue': 'https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/6720',
        'built': datetime.date.today().isoformat(),
        'what': 'Concepts, doctrines, practices, states and opposites of aliveness, with the terms the library uses for them, '
                'corpus counts by work date and tradition, verbatim passages, and typed relations each carrying provenance.',
        'counts': 'Pages that print any of a node\'s search phrases (Atlas Search phrase match, translation and OCR text, page_number > 0, '
                  'case-folded, not accent-folded). The book facet returns the top 1,000 books by matching pages; dates and traditions '
                  'are computed over live books in that facet. `pages_translation` counts the English translation alone.',
        'work_dates': 'Per book, the first of: /root/aliveness/dated-works.jsonl (#6652; basis title_page | model_knowledge), '
                      'books.source_work_dates when it holds exactly one composition and no compilation, books.original_work_year, '
                      'the edition year. Each count records its basis.',
        'gloss_and_edges': f'Node glosses, traditions and eras, and every edge claim, are scholarly background written by {MODEL_BG}. '
                           'An edge is `passage` only when a judge found a page in the library that states it; the passage is quoted '
                           'verbatim and linked.',
        'terms': 'Forms are the seed spellings with their tagged-page counts in the page-terms harvest (#4695). Variants, equivalents '
                 'and related terms come from src/data/concept-aliases.json where the node is a curated concept, otherwise from '
                 'term-gloss bridges judged under .claude/docs/concept-aliases/JUDGE-RUBRIC.md. Related terms are never merged.',
        'quotes': 'Every quote is a verbatim substring of the page\'s English translation after editorial wrappers and translator '
                  'notes are removed; [square brackets] are the translator\'s inline glosses.',
    },
    'senses': seed['senses'], 'kinds': seed['kinds'],
    'tallies': {'nodes': len(out_nodes), 'edges': len(out_edges), 'edges_by_provenance': dict(prov_tally),
                'edges_by_type': dict(Counter(e['type'] for e in out_edges)), 'nodes_by_kind': dict(Counter(n['kind'] for n in out_nodes)),
                'nodes_with_passages': sum(1 for n in out_nodes if n['passages']), 'passages': sum(len(n['passages']) for n in out_nodes)},
    'baseline': baseline and {'what': 'pages of live books by century of the work, same dating rule', 'books': baseline['books'],
                              'by_century': baseline['by_century'], 'date_basis_pages': baseline['basis']},
    'nodes': out_nodes, 'edges': out_edges, 'chains': chains,
}
json.dump(ontology, open(os.path.join(HERE, 'ontology.json'), 'w'), ensure_ascii=False, indent=1)
print('ontology.json', ontology['tallies'])

# ------------------------------------------------------------------ page
os.makedirs(SITE, exist_ok=True)
peace_p = os.path.join(SITE, 'peace.html')
if not os.path.exists(peace_p):
    sys.exit(f'{peace_p} missing: download https://experience-atlas.vercel.app/peace into SITE first')
peace = open(peace_p).read()
head = peace[:peace.index('</head>')]
TITLE = 'The vocabulary of aliveness'
DESC = 'Pneuma, spiritus, qi, prāṇa, the archeus, the élan vital: what each word meant, how they descend from one another, what people did with them, and where the Source Library uses them.'
head = re.sub(r'<title>.*?</title>', f'<title>{TITLE} — An Atlas of Aliveness</title>', head, flags=re.S)
head = re.sub(r'<meta name="description" content="[^"]*">', f'<meta name="description" content="{html.escape(DESC)}">', head)
EXTRA_CSS = """
  .node { margin:0 0 40px; scroll-margin-top:74px; }
  .node h4 { font-family:var(--ff-display); font-weight:500; font-size:24px; margin:0 0 2px; letter-spacing:-.005em; }
  .node .meta { font-family:var(--ff-ui); font-size:12.5px; color:var(--text-muted); margin:0 0 10px; }
  .node .meta .kind { letter-spacing:.1em; text-transform:uppercase; font-size:10.5px; color:var(--text-faint); margin-right:8px; }
  .node .forms { font-family:var(--ff-body); font-size:16px; color:var(--text-secondary); margin:0 0 8px; }
  .node .forms .f { display:inline-block; margin-right:12px; white-space:nowrap; }
  .node .forms .f small { font-family:var(--ff-ui); font-size:11px; color:var(--text-faint); margin-left:3px; }
  .node .gl { margin:0 0 10px; }
  .node .alias { font-family:var(--ff-ui); font-size:13px; color:var(--text-muted); margin:0 0 10px; line-height:1.55; }
  .node .rel { font-family:var(--ff-ui); font-size:13.5px; color:var(--text-secondary); margin:0 0 12px; line-height:1.6; }
  .node .rel a, .chain a { color:var(--text-secondary); text-decoration:none; border-bottom:1px solid var(--border-medium); }
  .node .rel a:hover, .chain a:hover { color:var(--rust); border-bottom-color:var(--rust); }
  .strip { display:flex; flex-wrap:wrap; align-items:center; gap:6px 12px; margin:4px 0 12px; font-family:var(--ff-ui); font-size:12px; color:var(--text-muted); }
  .strip svg { flex:0 0 auto; display:block; max-width:100%; }
  .strip span { flex:1 1 220px; }
  .ex q em { font-style:italic; }
  .ex q .g { color:var(--text-muted); font-size:.92em; }
  .chain { font-family:var(--ff-ui); font-size:14px; line-height:1.9; margin:0 0 18px; padding:12px 16px; background:var(--warm); border:1px solid var(--border-light); }
  .chain b { display:block; font-family:var(--ff-display); font-weight:500; font-size:19px; margin-bottom:2px; }
  .chain .arr { color:var(--text-faint); margin:0 6px; }
  .chain .src { font-size:10px; vertical-align:super; color:var(--sage-dark); margin-left:1px; }
  .chain .bg { color:var(--text-faint); }
  .kindhead { font-family:var(--ff-ui); font-size:11.5px; letter-spacing:.12em; text-transform:uppercase; color:var(--text-faint); margin:30px 0 14px; border-top:1px solid var(--border-light); padding-top:14px; }
  .edgeq { font-family:var(--ff-body); font-size:15.5px; color:var(--text-secondary); margin:4px 0 0 0; }
"""
head = head.replace('</style>', EXTRA_CSS + '</style>', 1)
nav = peace[peace.index('<nav class="site">'):peace.index('</nav>') + 6]
nav = re.sub(r'\s*<a href="#examples">Passages</a>', '', nav)
if '/aliveness-ontology' not in nav:
    nav = nav.replace('<a href="/aliveness">Aliveness</a>', '<a href="/aliveness">Aliveness</a>\n  <a href="/aliveness-ontology">Vocabulary</a>', 1)

E = html.escape
fmt = lambda v: f'{v:,}'
SENSE_ORDER = ['felt', 'world', 'made', 'inhabited', 'prolonged']
KIND_ORDER = ['principle', 'doctrine', 'practice', 'state', 'opposite']
KIND_HEAD = {'principle': 'Principles', 'doctrine': 'Doctrines and schools', 'practice': 'Practices', 'state': 'States', 'opposite': 'Opposites'}
TYPE_OUT = {'translates': 'renders', 'analogue': 'is compared with', 'descends': 'descends from', 'belongs': 'belongs to',
            'cultivates': 'cultivates', 'opposes': 'is set against'}
TYPE_IN = {'translates': 'rendered as', 'analogue': 'is compared with', 'descends': 'gave rise to', 'belongs': 'includes',
           'cultivates': 'cultivated by', 'opposes': 'is set against'}


def quote_html(marked):
    s = E(marked)
    s = s.replace('\u0001', '<em>').replace('\u0002', '</em>').replace('\u0003', '<span class="g">[').replace('\u0004', ']</span>')
    return s


def cite(p):
    when = ''
    if p.get('work_year') is not None:
        b = p.get('date_basis', '')
        tag = 'work dated' if b.startswith('dated-works') or b in ('source_work_dates', 'original_work_year') else 'book dated'
        when = f' · {tag} {yr(p["work_year"])}'
    who = f'{E(p["author"].strip())}, ' if p.get('author', '').strip() else ''
    return f'{who}<i>{E(p["title"])}</i>{when} · <a href="{E(p["url"])}">page {p.get("page", "")}</a>' if 'page' in p else \
        f'{who}<i>{E(p["title"])}</i>{when} · <a href="{E(p["url"])}">open the page</a>'


CMIN, CMAX = -800, 2000
NB = (CMAX - CMIN) // 100


def strip_svg(by_c):
    w, h, bw = 280, 26, 280 / NB
    vals = {int(k): v for k, v in by_c.items()}
    mx = max(vals.values()) if vals else 1
    rects = []
    for i in range(NB):
        c = CMIN + i * 100
        v = vals.get(c, 0)
        if v:
            hh = max(2, math.sqrt(v / mx) * (h - 4))  # square root: log flattens the shape, linear hides the thin centuries
            rects.append(f'<rect x="{i * bw:.1f}" y="{h - 2 - hh:.1f}" width="{bw - 1:.1f}" height="{hh:.1f}" fill="var(--rust)" opacity=".85"><title>{cent_label(c)}: {fmt(v)} pages</title></rect>')
    ticks = ''.join(f'<line x1="{(t - CMIN) / 100 * bw:.1f}" x2="{(t - CMIN) / 100 * bw:.1f}" y1="{h - 2}" y2="{h}" stroke="var(--fig-mute)" stroke-width="1"/>' for t in (0, 1000, 1500, 2000) if t <= CMAX)
    base = f'<line x1="0" x2="{w}" y1="{h - 2}" y2="{h - 2}" stroke="var(--fig-grid)" stroke-width="1"/>'
    return f'<svg width="{w}" height="{h + 12}" viewBox="0 0 {w} {h + 12}" role="img" aria-label="Pages by century of the work">{base}{"".join(rects)}{ticks}' \
           f'<text x="{(0 - CMIN) / 100 * bw:.1f}" y="{h + 11}" font-size="9" fill="var(--fig-mute)" text-anchor="middle" font-family="Inter,sans-serif">0</text>' \
           f'<text x="{(1000 - CMIN) / 100 * bw:.1f}" y="{h + 11}" font-size="9" fill="var(--fig-mute)" text-anchor="middle" font-family="Inter,sans-serif">1000</text>' \
           f'<text x="{(1500 - CMIN) / 100 * bw:.1f}" y="{h + 11}" font-size="9" fill="var(--fig-mute)" text-anchor="middle" font-family="Inter,sans-serif">1500</text>' \
           f'<text x="{w - 1}" y="{h + 11}" font-size="9" fill="var(--fig-mute)" text-anchor="end" font-family="Inter,sans-serif">2000</text></svg>'


def nlink(i):
    return f'<a href="#{i}">{E(ON[i]["label"])}</a>'


def relations(nid):
    groups = defaultdict(list)
    for e in out_edges:
        mark = '<sup class="src" title="stated in a linked passage">p</sup>' if e['provenance']['kind'] == 'passage' else ''
        if e['from'] == nid:
            groups[TYPE_OUT[e['type']]].append(nlink(e['to']) + mark)
        elif e['to'] == nid:
            groups[TYPE_IN[e['type']]].append(nlink(e['from']) + mark)
    order = ['renders', 'rendered as', 'descends from', 'gave rise to', 'belongs to', 'includes', 'cultivates', 'cultivated by', 'is set against', 'is compared with']
    return '; '.join(f'{k} {", ".join(groups[k])}' for k in order if groups.get(k))


def node_html(n):
    c = n['counts']
    forms = ''.join(f'<span class="f">{E(f["term"])}<small>{E(f["language"])}</small></span>' for f in n['forms'])
    eq = [t['term'] for t in n['terms']['equivalent']][:10]
    rl = [t['term'] for t in n['terms']['related']][:8]
    va = [t['term'] for t in n['terms']['variant']][:8]
    alias = []
    if va:
        alias.append('Also spelled: ' + ', '.join(E(x) for x in va))
    if eq:
        alias.append('Translators also write: ' + ', '.join(E(x) for x in eq))
    if rl:
        alias.append('Related, not the same: ' + ', '.join(E(x) for x in rl))
    stat = f'{fmt(c["pages"])} pages'
    if c['books_capped_at_1000']:
        stat += ' in more than 1,000 books'
    else:
        stat += f' in {fmt(c["books_faceted"])} books'
    span = ''
    if c.get('span_90') and c['span_90']['from'] is not None:
        sp = c['span_90']
        span = f'; 90% of dated pages fall between {yr(sp["from"])} and {yr(sp["to"])}, most in the {cent_label(sp["peak_century"])}'
    trad = ', '.join(E(k) for k in list(c['by_tradition'])[:3])
    broad = ' <span title="the search phrases are common words; counts include every use">(broad phrase)</span>' if n['broad'] else ''
    share = f'{round(100 * c["dated_pages"] / c["faceted_pages"])}% of pages dated' if c['faceted_pages'] else ''
    strip = f'<div class="strip">{strip_svg(c["by_century"])}<span>{stat}{span}{broad}<br>{share}{" · mostly " + trad if trad else ""}</span></div>' if c['pages'] else \
        '<div class="strip"><span>No page in the library prints these phrases.</span></div>'
    quotes = ''.join(f'<div class="ex"><q>{"… " if p["cut"][0] else ""}{quote_html(p["quote_marked"])}{" …" if p["cut"][1] else ""}</q><div class="cite">{cite(p)}</div></div>' for p in n['passages'][:3])
    rel = relations(n['id'])
    other = [s for s in n['senses'][1:]]
    tags = (' · also ' + ', '.join(seed['senses'][s].lower() for s in other)) if other else ''
    return f'''<div class="node" id="{n["id"]}"><h4>{E(n["label"])}</h4>
<div class="meta"><span class="kind">{E(n["kind"])}</span>{E(n["tradition"])} · {E(n["era"])}{E(tags)}</div>
<div class="forms">{forms}</div>
<p class="gl">{E(n["gloss"])}</p>
{('<p class="alias">' + '<br>'.join(alias) + '</p>') if alias else ''}
{strip}
{('<p class="rel">' + rel + '</p>') if rel else ''}
{quotes}
</div>'''


T = ontology['tallies']
pb = T['edges_by_provenance'].get('passage', 0)
parts = []
parts.append(f'''<div class="wrap"><header class="paper"><p class="eyebrow">An Atlas of Aliveness · Vocabulary</p>
<h1>{TITLE}</h1><p class="sub">What pneuma, spiritus, qi, prāṇa, the archeus and the élan vital meant, which ideas descend from which, what people did with them, and where the books in the Source Library use them.</p>
<div class="statrow"><div><b>{T["nodes"]}</b><span>concepts, doctrines and practices</span></div><div><b>{T["edges"]}</b><span>relations between them</span></div><div><b>{pb}</b><span>relations stated in a linked passage</span></div><div><b>{T["passages"]}</b><span>quoted passages</span></div></div>
</header>
<p>The <a href="/aliveness">Atlas of Aliveness</a> collects passages in which something is felt or said to be alive. This page is its vocabulary. Each entry gives a word in the scripts the sources use, the tradition and century it belongs to, a short account of what it meant, a strip showing how many pages in the library use it by the date of the work, and two or three passages to read, each linked to its page.</p>
<p>The entries are grouped by the five senses the atlas uses: feeling alive, the world as alive, made things as alive, the inhabited world, and prolonged life (more time in the life one has). Under each sense come the principles said to make things alive, the doctrines and schools that held them, the practices that cultivated them, the states they produced, and their opposites. An entry that belongs to more than one sense is listed under its first.</p>
{('<div class="strip">' + strip_svg(baseline['by_century']) + '<span>The library itself: pages of ' + fmt(baseline['books']) + ' readable books by century of the work. Every strip below leans toward the 16th and 17th centuries partly because the library does.</span></div>') if baseline else ''}
<p>Each relation names its source. A small <sup style="color:var(--sage-dark);font-family:var(--ff-ui);font-size:10px">p</sup> means a page in the library states it, and the passage is quoted in the data. Relations without the mark are standard scholarly background and have not yet been found stated in the library's own books.</p>
<nav class="toc" aria-label="Sections"><a href="#chains">Lines of descent</a>{"".join(f'<a href="#s-{s}">{E(seed["senses"][s])}</a>' for s in SENSE_ORDER)}<a href="#method">How this was made</a><a href="#data">Data</a></nav>
<h2 id="chains">Lines of descent</h2>
<p>Some words were translated or reworked from one tradition into the next. Each line below follows one such path, oldest first.</p>''')
for ch in chains:
    seq = []
    for i, nid in enumerate(ch['nodes']):
        if i:
            l = ch['links'][i - 1]
            seq.append(f'<span class="arr">→</span>' + ('<sup class="src" title="stated in a linked passage">p</sup>' if l['provenance'] == 'passage' else ''))
        seq.append(nlink(nid))
    ex = ''
    for l in ch['links']:
        e = next(x for x in out_edges if f"{x['from']}|{x['type']}|{x['to']}" == l['edge'])
        if e['provenance']['kind'] == 'passage':
            p = e['provenance']['passage']
            ex = f'<div class="edgeq">“{"… " if p["cut"][0] else ""}{quote_html(p["quote_marked"])}{" …" if p["cut"][1] else ""}” <span class="cite" style="font-family:var(--ff-ui);font-size:12px;color:var(--text-muted)">{cite(p)}</span></div>'
            break
    parts.append(f'<div class="chain"><b>{E(ch["title"])}</b>{"".join(seq)}{ex}</div>')

placed = set()
for s in SENSE_ORDER:
    members = [n for n in out_nodes if n['senses'][0] == s]
    parts.append(f'<h2 id="s-{s}">{E(seed["senses"][s])}</h2>')
    for k in KIND_ORDER:
        ms = [n for n in members if n['kind'] == k]
        if not ms:
            continue
        parts.append(f'<div class="kindhead">{KIND_HEAD[k]}</div>')
        for n in sorted(ms, key=lambda n: -n['counts']['pages']):
            parts.append(node_html(n))
            placed.add(n['id'])
    also = [n for n in out_nodes if s in n['senses'][1:]]
    if also:
        parts.append('<p class="alias">Also part of this sense: ' + ', '.join(nlink(n['id']) for n in also) + '.</p>')
assert placed == set(ON), 'every node is placed once'

basis_tot = Counter()
for n in out_nodes:
    for k, v in n['counts']['date_basis_pages'].items():
        basis_tot[k] += v
bt = sum(basis_tot.values()) or 1
basis_line = ', '.join(f'{k.replace("_", " ")} {round(100 * v / bt)}%' for k, v in basis_tot.most_common())
parts.append(f'''<h2 id="method">How this was made</h2>
<ul class="lim">
<li><b>Concepts.</b> {T["nodes"]} entries were chosen by hand to cover the five senses ({", ".join(f"{v} {k}s" for k, v in T["nodes_by_kind"].items())}). The account of each, its tradition and its era are scholarly background written by {MODEL_BG}, not findings from the corpus.</li>
<li><b>Words.</b> The spellings in original scripts are checked against the terms translators tagged on 5.56 million pages (the page-terms harvest). Other spellings and translations come from the library's curated concept list where one exists, or from terms that share a translator's gloss, judged one by one: a variant is the same word, an equivalent is another language's word for it, and a related term is a neighbour that is never merged with it.</li>
<li><b>Counts.</b> A page counts if its text or translation prints one of the entry's search phrases (listed in the data). Broad phrases (death, vigour, longevity, Daoist, spiritus) count every use, including ones that have nothing to do with aliveness, and are marked. Chinese phrases match single characters, so 氣 counts every page that prints it.</li>
<li><b>Dates.</b> The strips place pages by the date of the WORK, not the printed edition, where the catalogue gives one; otherwise by the edition. Across all entries the dates come from: {basis_line}. A 1950 edition of a Daoist classic with no work date counts in the 20th century. Only the 1,000 books with the most matching pages are dated for each entry.</li>
<li><b>Passages.</b> Candidate pages were drawn from live books, spread across centuries, and a reader chose the two to five that say what the concept is or what was done with it. Every quotation is word for word from the page's English translation; words in [brackets] are the translator's glosses.</li>
<li><b>Relations.</b> {T["edges"]} relations of six kinds ({", ".join(f"{v} {k}" for k, v in T["edges_by_type"].items())}). For each, the library was searched for pages naming both ends, and a judge read up to six such pages to decide whether one states the relation. {pb} do; the remaining {T["edges"] - pb} rest on scholarly background, named as such in the data.</li>
</ul>
<h2 id="data">Data</h2>
<p>Everything on this page is in <code>ontology.json</code> (in the Source Library repository at <code>scripts/analysis/experience-map/ontology/</code>, with the scripts that built it): each entry's search phrases, page counts by century and tradition with the basis of each date, the passages with their links, and every relation with its provenance.</p>
<footer>Built {ontology["about"]["built"]} from the Source Library corpus. Tracking issue <a href="{ontology["about"]["issue"]}">#6720</a>.</footer>
</div>''')

body = '\n'.join(parts)
page = head + '</head><body>' + nav + body + '</body></html>'
left = re.findall(r'__[A-Z_]+__', page)
if left:
    sys.exit(f'unfilled placeholders {left}')
if SENT.search(page):
    sys.exit('control sentinel leaked into the page')
open(os.path.join(SITE, 'aliveness-ontology.html'), 'w').write(page)
print(f'aliveness-ontology.html {len(page) // 1024}KB')
if PATCH_NAV:
    LINK = '<a href="/aliveness-ontology">Vocabulary</a>'
    for f in ['index.html', 'atlas.html', 'compare.html', 'bodies.html', 'peace.html', 'aliveness.html']:
        p = os.path.join(SITE, f)
        if not os.path.exists(p):
            continue
        s = open(p).read()
        if LINK not in s:
            s = s.replace('<a href="/aliveness">Aliveness</a>', '<a href="/aliveness">Aliveness</a>\n  ' + LINK, 1)
            open(p, 'w').write(s)
