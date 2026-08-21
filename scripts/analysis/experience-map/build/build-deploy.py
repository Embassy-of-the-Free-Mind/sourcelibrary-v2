#!/usr/bin/env python3
"""
Assemble the deployable site: restyle the paper in Source Library's identity,
add the examples section, retheme the two interactive maps, and write a deploy
directory Vercel can serve as static files.

Design note: the page takes Source Library's identity (cream ground, Cormorant /
Newsreader, rust accent) but the CHARTS keep the validated categorical palette.
The brand accents were tested as a chart palette and failed — sage and gold-dark
read as grey (chroma below floor) and sit 3.9 ΔE apart under deuteranopia. Brand
identity lives in the typography and ground; discriminability lives in the marks.
"""
import json, os, re, shutil

HERE = '/private/tmp/claude-501/-Users-dereklomas-sourcelibrary/b4cc9f10-7660-4f2b-b3cf-554d4017f8f7/scratchpad'
OUT = f'{HERE}/deploy'
os.makedirs(OUT, exist_ok=True)

FONTS = ('<link rel="preconnect" href="https://fonts.googleapis.com">'
         '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
         '<link href="https://fonts.googleapis.com/css2?'
         'family=Cormorant+Garamond:wght@400;500;600&'
         'family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;1,6..72,400&'
         'family=Inter:wght@400;500;600&display=swap" rel="stylesheet">')

SL_STYLE = """
<style>
  :root {
    --cream:#fdfcf9; --warm:#f5f0e8; --dark:#1a1612;
    --rust:#9e4a3a; --gold:#c9a86c; --sage:#8b9a7d; --violet:#7c5db5;
    --sage-dark:#5e6d52; --gold-dark:#9e7c3c;
    --text-primary:#1a1612; --text-secondary:#444; --text-muted:#6b6560; --text-faint:#8a8480;
    --border-light:#e8e4dc; --border-medium:#d4cfc4;
    /* charts keep the validated categorical palette — brand accents failed the gates */
    --s1:#2a78d6; --s2:#008300; --s3:#e87ba4; --s4:#eda100;
    --fig-ink:#1a1612; --fig-mute:#6b6560; --fig-grid:#d4cfc4; --fig-well:#f5f0e8;
    --ff-display:"Cormorant Garamond",Garamond,Georgia,serif;
    --ff-body:"Newsreader","Iowan Old Style",Palatino,Georgia,serif;
    --ff-ui:"Inter",ui-sans-serif,-apple-system,"Helvetica Neue",Arial,sans-serif;
    --ff-data:ui-monospace,"SF Mono",Menlo,Consolas,monospace;
  }
  * { box-sizing:border-box; }
  html { scroll-behavior:smooth; }
  h2,h3,.exgroup { scroll-margin-top:74px; }
  html { -webkit-text-size-adjust:100%; }
  body { margin:0; background:var(--cream); color:var(--text-primary);
    font-family:var(--ff-body); font-size:18px; line-height:1.7; -webkit-font-smoothing:antialiased; }
  .wrap { max-width:800px; margin:0 auto; padding:0 26px 96px; }

  nav.site { border-bottom:1px solid var(--border-light); background:var(--cream);
    position:sticky; top:0; z-index:20; }
  nav.site .inner { max-width:1120px; margin:0 auto; padding:12px 26px; display:flex;
    align-items:baseline; gap:8px 20px; flex-wrap:wrap; }
  nav.site .inner .spacer { flex:1 1 auto; }
  nav.site a { font-family:var(--ff-ui); font-size:13.5px; color:var(--text-muted);
    text-decoration:none; }
  nav.site a:hover { color:var(--rust); }
  nav.site a.brand { font-family:var(--ff-display); font-size:19px; font-weight:600;
    color:var(--text-primary); letter-spacing:.01em; }
  nav.site a.brand:hover { color:var(--rust); }

  .eyebrow { font-family:var(--ff-ui); font-size:11.5px; letter-spacing:.15em;
    text-transform:uppercase; color:var(--text-faint); margin:0 0 16px; }
  h1 { font-family:var(--ff-display); font-weight:500; font-size:clamp(34px,5.4vw,54px);
    line-height:1.06; letter-spacing:-.01em; margin:0 0 12px; text-wrap:balance; }
  h1 + .sub { font-family:var(--ff-body); font-size:clamp(17px,2vw,21px); line-height:1.45;
    color:var(--text-secondary); margin:0 0 26px; font-style:italic; text-wrap:balance; }
  header.paper { padding:54px 0 28px; border-bottom:1px solid var(--border-light); }
  .draftflag { font-family:var(--ff-ui); font-size:13.5px; line-height:1.6; background:var(--warm);
    border:1px solid var(--border-light); border-left:3px solid var(--rust);
    padding:14px 16px; color:var(--text-secondary); }
  h2 { font-family:var(--ff-display); font-weight:500; font-size:30px; margin:56px 0 14px;
    letter-spacing:-.005em; }
  h3 { font-family:var(--ff-ui); font-weight:600; font-size:15px; margin:32px 0 10px;
    letter-spacing:.005em; color:var(--text-primary); }
  p { margin:0 0 17px; }
  .abstract { background:var(--warm); border:1px solid var(--border-light); padding:24px 26px; margin:30px 0 0; }
  .abstract h2 { margin:0 0 12px; font-family:var(--ff-ui); font-size:12px; font-weight:600;
    letter-spacing:.13em; text-transform:uppercase; color:var(--text-muted); }
  .abstract p { font-size:17px; }
  em.pali { font-style:italic; }
  a { color:var(--rust); text-decoration-thickness:1px; text-underline-offset:3px; }
  a:hover { color:var(--text-primary); }
  sup.warn { font-family:var(--ff-ui); font-size:11px; color:var(--gold-dark); cursor:help; }

  figure { margin:36px 0; padding:0; }
  figure .plot { background:var(--warm); border:1px solid var(--border-light);
    padding:20px 20px 14px; overflow-x:auto; }
  figcaption { font-family:var(--ff-ui); font-size:13.5px; line-height:1.6;
    color:var(--text-secondary); margin-top:12px; }
  figcaption b { font-family:var(--ff-ui); font-size:11.5px; letter-spacing:.11em;
    text-transform:uppercase; color:var(--text-faint); font-weight:600; display:block; margin-bottom:5px; }
  details.tbl { margin-top:10px; }
  details.tbl summary { cursor:pointer; font-family:var(--ff-ui); font-size:11.5px;
    letter-spacing:.1em; text-transform:uppercase; color:var(--text-muted); }
  .tblwrap { overflow-x:auto; border:1px solid var(--border-light); margin-top:10px; background:var(--cream); }
  table { border-collapse:collapse; width:100%; font-family:var(--ff-ui); font-size:13.5px; }
  th,td { text-align:left; padding:8px 12px; border-bottom:1px solid var(--border-light); }
  th { font-family:var(--ff-ui); font-size:11px; letter-spacing:.1em; text-transform:uppercase;
    color:var(--text-faint); font-weight:600; }
  td.num { text-align:right; font-family:var(--ff-data); font-variant-numeric:tabular-nums; }
  tbody tr:last-child td { border-bottom:0; }
  blockquote { margin:0 0 18px; padding-left:18px; border-left:2px solid var(--gold);
    color:var(--text-secondary); font-style:italic; }
  ol.refs { font-family:var(--ff-ui); font-size:13.5px; color:var(--text-secondary); padding-left:20px; }
  ol.refs li { margin-bottom:8px; }
  ul.lim { font-family:var(--ff-ui); font-size:15px; line-height:1.65;
    color:var(--text-secondary); padding-left:20px; }
  ul.lim li { margin-bottom:11px; }
  .dl { display:flex; flex-wrap:wrap; gap:10px; margin:18px 0 0; }
  .dl button { font-family:var(--ff-ui); font-size:13.5px; padding:10px 16px; cursor:pointer;
    background:var(--warm); color:var(--text-primary); border:1px solid var(--border-medium); }
  .dl button:hover { border-color:var(--rust); color:var(--rust); }
  .dl button:focus-visible, a:focus-visible, summary:focus-visible { outline:2px solid var(--rust); outline-offset:2px; }
  .statrow { display:flex; flex-wrap:wrap; gap:0 40px; margin:26px 0 6px; }
  .statrow div { display:flex; flex-direction:column; gap:3px; }
  .statrow b { font-family:var(--ff-display); font-size:34px; font-weight:500; letter-spacing:-.01em;
    font-variant-numeric:lining-nums tabular-nums; font-feature-settings:"lnum" 1,"tnum" 1; }
  .statrow span { font-family:var(--ff-ui); font-size:10.5px; letter-spacing:.11em;
    text-transform:uppercase; color:var(--text-faint); max-width:20ch; }
  footer { margin-top:66px; padding-top:26px; border-top:1px solid var(--border-light);
    font-family:var(--ff-ui); font-size:13px; line-height:1.65; color:var(--text-muted); }


  ol.hyp { font-family:var(--ff-ui); font-size:15.5px; line-height:1.65; color:var(--text-secondary);
    padding-left:22px; }
  ol.hyp li { margin-bottom:18px; }
  ol.hyp b { color:var(--text-primary); }
  ol.hyp .test { display:block; margin-top:5px; font-size:13.5px; color:var(--text-muted);
    border-left:2px solid var(--gold); padding-left:11px; }
  .exloc { margin:0 0 26px; }
  .exloc h3 { font-family:var(--ff-display); font-weight:500; font-size:22px; margin:0 0 10px; }
  .exrow { border-left:2px solid var(--border-medium); padding:1px 0 1px 16px; margin:0 0 13px; }
  .exrow .phrase { font-family:var(--ff-body); font-size:17.5px; color:var(--text-primary); }
  .exrow .who { font-family:var(--ff-ui); font-size:12.5px; color:var(--text-muted); margin-top:5px; }
  .exrow .who a { color:var(--text-muted); text-decoration:none; border-bottom:1px solid var(--border-medium); }
  .exrow .who a:hover { color:var(--rust); border-bottom-color:var(--rust); }
  .exrow .sys { color:var(--sage-dark); }
  /* ---- examples ---- */
  .exgroup { margin:0 0 34px; }
  .exgroup h3 { font-family:var(--ff-display); font-weight:500; font-size:23px;
    margin:0 0 4px; color:var(--text-primary); letter-spacing:-.005em; }
  .exgroup .themetag { font-family:var(--ff-ui); font-size:11px; letter-spacing:.11em;
    text-transform:uppercase; color:var(--text-faint); margin:0 0 14px; }
  .ex { border-left:2px solid var(--border-medium); padding:2px 0 2px 18px; margin:0 0 18px; }
  .ex:hover { border-left-color:var(--rust); }
  .ex q { display:block; font-family:var(--ff-body); font-size:18.5px; line-height:1.6;
    color:var(--text-primary); quotes:'“' '”'; }
  .ex .cite { font-family:var(--ff-ui); font-size:12.5px; color:var(--text-muted); margin-top:7px; }
  .ex .cite a { color:var(--text-muted); text-decoration:none; border-bottom:1px solid var(--border-medium); }
  .ex .cite a:hover { color:var(--rust); border-bottom-color:var(--rust); }
  .ex .cite .badge { display:inline-block; font-size:10.5px; letter-spacing:.08em;
    text-transform:uppercase; color:var(--sage-dark); margin-left:8px; }
  .toc { columns:2; column-gap:28px; font-family:var(--ff-ui); font-size:13.5px; margin:18px 0 28px; }
  .toc a { display:block; padding:3px 0; color:var(--text-secondary); text-decoration:none; }
  .toc a:hover { color:var(--rust); }
  @media (max-width:620px) { .toc { columns:1; } body { font-size:17px; } }
  @media (prefers-reduced-motion:reduce) { * { transition:none!important; } }
</style>
"""

NAV = """
<nav class="site"><div class="inner">
  <a class="brand" href="/">A Map of Conscious Experiences</a>
  <a href="/atlas">The Atlas</a>
  <a href="/compare">Visuddhimagga comparison</a>
  <a href="/bodies">Subtle bodies</a>
  <a href="/peace">PEACE response</a>
  <a href="#examples">Passages</a>
  <span class="spacer"></span>
  <a href="#data">Data</a>
  <a href="https://sourcelibrary.org">Source Library&nbsp;↗</a>
</div></nav>
"""

# ---------------------------------------------------------------- examples block
ex = json.load(open(f'{HERE}/examples.json'))
STAGE = {d['id']: d for d in json.load(open(f'{HERE}/probes-jhana.json'))['dimensions']}

def esc(s):
    return (str(s if s is not None else '')
            .replace('&','&amp;').replace('<','&lt;').replace('>','&gt;').replace('"','&quot;'))

toc = ''.join(f'<a href="#ex-{g["theme"]}">{esc(g["title"])}</a>' for g in ex)
blocks = []
for g in ex:
    items = []
    for it in g['items']:
        meta = ' · '.join(x for x in [
            esc(it['t'][:64]), esc(it.get('a') or ''), esc(it.get('yr') or 'n.d.'), esc(it.get('lang') or '')
        ] if x)
        badge = ''
        if g['theme'] == '_vism':
            lab = STAGE.get(it.get('stage'), {})
            if lab: badge = f'<span class="badge">matched to {esc(lab.get("label"))} · {esc(lab.get("pali"))}</span>'
        elif it.get('tg') and it['tg'] not in ('not-stated','spontaneous'):
            badge = f'<span class="badge">brought on by {esc(it["tg"].replace("-"," "))}</span>'
        items.append(
            f'<div class="ex"><q>{esc(it["q"])}</q>'
            f'<div class="cite"><a href="{esc(it["u"])}" target="_blank" rel="noopener">{meta}</a>{badge}</div></div>')
    blocks.append(
        f'<div class="exgroup" id="ex-{g["theme"]}"><h3>{esc(g["title"])}</h3>'
        f'<p class="themetag">{esc(g["theme"].replace("_"," ").strip())}</p>{"".join(items)}</div>')

n_ex = sum(len(g['items']) for g in ex)
EXAMPLES = f"""
<h2 id="examples">What the record actually says</h2>
<p>
  Every passage below was retrieved by one of the probe sets, judged to describe an experience from the
  inside, and checked character-for-character against the page it was transcribed from. Each links to the
  scan of that page, so nothing here has to be taken on trust. These {n_ex} are a sample; the full release
  of {{ATLAS_N}} is at the foot of the page.
</p>
<div class="toc">{toc}</div>
{''.join(blocks)}
"""

# ---------------------------------------------------------------- assemble paper
tpl = open(f'{HERE}/paper-template.html').read()
body = tpl[tpl.index('<div class="wrap">'):tpl.index('<script id="assets"')]
script = tpl[tpl.index('<script id="assets"'):]

# insert examples just before the Data section
anchor = '<h2>8. Data</h2>'
body = body.replace(anchor, EXAMPLES + '\n<h2 id="data">9. Data</h2>')
body = body.replace('<h2>7. Roadmap</h2>', '<h2 id="roadmap">7. Roadmap</h2>')

A = json.load(open(f'{HERE}/paper-assets.json'))
body = body.replace('{ATLAS_N}', f"{len(A['release']):,}")
for k, v in A['figures'].items():
    body = body.replace('__FIG_' + k.upper() + '__', v)

assets = {'tables': A['tables'], 'numbers': A['numbers'],
          'release': A['release'], 'vism_release': A['vism_release']}
blob = json.dumps(assets, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')
script = script.replace('__ASSETS__', blob)

head = ('<!doctype html><html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        '<title>Towards a Map of Conscious Experiences Across History</title>'
        '<meta name="description" content="A working paper on assembling the historical record of '
        'described inner experience: the size of the field, the requirements such a map must meet, and '
        'what two independent instruments reveal when run over the same corpus.">'
        + FONTS + SL_STYLE + '</head><body>' + NAV)

open(f'{OUT}/index.html', 'w').write(head + body + script + '</body></html>')
print(f'index.html — {n_ex} example passages, {os.path.getsize(f"{OUT}/index.html")//1024}KB')

# ---------------------------------------------------------------- retheme the maps

def strip_dark_blocks(css):
    """Source Library is a single, light identity. The map pages were authored
    dual-theme; on the deployed site their dark blocks are removed so the cream
    ground holds everywhere. The map's own well stays dark by design — that is a
    component colour, not a theme."""
    for marker in ('@media (prefers-color-scheme: dark) {', ':root[data-theme="dark"] {'):
        while marker in css:
            i = css.index(marker)
            depth, j = 0, i
            while j < len(css):
                if css[j] == '{': depth += 1
                elif css[j] == '}':
                    depth -= 1
                    if depth == 0: break
                j += 1
            css = css[:i] + css[j+1:]
    return css

SWAP = [
    ('--paper:#e3e5e0', '--paper:#fdfcf9'), ('--paper-raised:#edeeea', '--paper-raised:#f5f0e8'),
    ('--ink:#131719', '--ink:#1a1612'), ('--ink-soft:#4a5257', '--ink-soft:#444'),
    ('--ink-mute:#737d82', '--ink-mute:#6b6560'), ('--rule:#c3c7c1', '--rule:#e8e4dc'),
    ('--focus:#3987e5', '--focus:#9e4a3a'),
    ('--ff-display:"Iowan Old Style","Palatino Linotype",Palatino,"Book Antiqua",Georgia,serif',
     '--ff-display:"Cormorant Garamond",Garamond,Georgia,serif'),
    ('--ff-ui:ui-sans-serif,-apple-system,"Helvetica Neue",Arial,sans-serif',
     '--ff-ui:"Inter",ui-sans-serif,-apple-system,Arial,sans-serif'),
]
for src, dst, title in [('experience-map-v2.html', 'atlas.html', 'The Atlas of Described Experience'),
                        ('compare-map.html', 'compare.html', 'Whose Map? The Visuddhimagga Against the Questionnaire')]:
    t = open(f'{HERE}/{src}').read()
    for a, b in SWAP:
        t = t.replace(a, b)
    t = strip_dark_blocks(t)
    # quotations should read in the reading face, as they do on Source Library
    t = t.replace('.detail blockquote { margin:0; font-family:var(--ff-display);',
                  '.detail blockquote { margin:0; font-family:"Newsreader",Georgia,serif;')
    t = ('<!doctype html><html lang="en"><head><meta charset="utf-8">'
         '<meta name="viewport" content="width=device-width, initial-scale=1">'
         f'<title>{title}</title>' + FONTS +
         '<style>:root{color-scheme:light}body{font-family:"Inter",ui-sans-serif,system-ui,Arial,sans-serif}</style>'
         '</head><body>' + NAV + t + '</body></html>')
    open(f'{OUT}/{dst}', 'w').write(t)
    print(f'{dst} — {os.path.getsize(f"{OUT}/{dst}")//1024}KB')


# ---------------------------------------------------------------- subtle-body page
BA = json.load(open(f'{HERE}/body-assets.json'))
bb = open(f'{HERE}/bodies-body.html').read()
for k, v in BA['figures'].items():
    bb = bb.replace('__FIG_' + k.upper() + '__', v)

HYP = [
 ("Convergence tracks interoceptive traffic, not metaphysics.",
  "The loci all ten systems share — heart, throat, gut — are the ones with the strongest interoceptive "
  "and motor signal in the body. Agreement between traditions may be agreement about where the body is "
  "loud, not about a hidden anatomy.",
  "Test: score each locus for interoceptive salience independently (cardiac, respiratory, gastric, "
  "laryngeal afferents) and see whether that predicts cross-traditional attestation better than any "
  "doctrinal variable does."),
 ("The ladder is an imaginative technology with two felt anchors.",
  "Experiential reports concentrate at the heart and the sensory organs; the crown, navel and base are "
  "predominantly things practitioners are told to visualise. The chakra system may be less a chart of "
  "felt energy than a structured imagination exercise, pinned at the few points that do produce sensation.",
  "Test: in contemporary practitioners, sample felt-sensation reports by locus during practice. The "
  "prediction is a heart/gut peak and a crown trough — the inverse of what the popular picture implies."),
 ("Verticality is a regional convention, and it travels with experiential claims.",
  "Stated order correlates strongly with height in the Indic systems (+0.73 Hindu, +0.76 Tibetan), "
  "weakly in Daoist and Kabbalistic ones. Ascent may be a South Asian narrative form exported later, "
  "rather than a universal shape of inner experience.",
  "Test: check whether systems with weak vertical ordering also lack ascent narratives in their "
  "first-person material — and whether translations into European languages strengthen the ordering."),
 ("The rainbow is post-corpus, and the real convergence is white at the crown.",
  "Only 12% of colour assignments match the modern scheme, equally before and after 1875, so the "
  "rainbow is later than the Theosophical literature usually blamed for it. Meanwhile white at the "
  "crown recurs across traditions with no shared colour vocabulary.",
  "Test: date the first appearance of the full red-to-violet series in printed sources; and check "
  "whether white-at-crown survives in traditions with different colour semantics, which would suggest "
  "a phosphene-level rather than a symbolic origin."),
 ("A map's function determines its content more than its culture does.",
  "Daoist inner alchemy and channel-and-point medicine chart the same body in the same civilisation and "
  "produce almost opposite profiles — 70% physiological versus 43% therapeutic, with experiential "
  "records at 6% and 1%. Purpose, not culture, appears to be the stronger predictor of what a body map "
  "contains.",
  "Test: hold culture fixed and vary purpose across more pairs (Ayurvedic marma versus tantric cakra; "
  "Galenic anatomy versus hesychast prayer) and see whether the function profile clusters by purpose."),
 ("Convergence claims in this whole project need a null model, not a chance baseline.",
  "The atlas reports lift over chance. But 'chance' is the wrong comparison when the thing being mapped "
  "is a shared human body with shared afferent structure. Two traditions agreeing that something happens "
  "in the chest may be no more surprising than two agreeing that the sun is bright.",
  "Test: build an interoceptive-salience null and re-express every convergence in the atlas as lift over "
  "THAT, not over uniform chance. This would change how the headline findings should be read."),
]
hyp_html = ''.join(
    f'<li><b>{esc(h)}</b> {esc(d)}<span class="test">{esc(x)}</span></li>' for h, d, x in HYP)

ex_html = []
for g in BA['examples']:
    rows = []
    for it in g['items']:
        url = it.get('url')
        who = (f'<span class="sys">{esc(it["system"])}</span> · {esc(it["name"][:44])} · '
               f'{esc(it["book"][:46])}' + (f' · {esc(it["yr"])}' if it.get('yr') else '')
               + (f' · {esc(it["lang"])}' if it.get('lang') else ''))
        who = f'<a href="{esc(url)}" target="_blank" rel="noopener">{who}</a>' if url else who
        rows.append(f'<div class="exrow"><div class="phrase">{esc(it["experience"])}</div>'
                    f'<div class="who">{who}</div></div>')
    ex_html.append(f'<div class="exloc"><h3>At the {esc(g["nice"])}</h3>{"".join(rows)}</div>')

bodies_script = """<script>
(function(){
  const T=%s;
  document.getElementById('statrow').innerHTML=[[T.records.toLocaleString(),'centres extracted'],
    [T.books.toLocaleString(),'books'],[T.systems,'traditions reconstructed'],
    ['10/10','systems place a centre at the heart']]
    .map(x=>'<div><b>'+x[0]+'</b><span>'+x[1]+'</span></div>').join('');
  document.getElementById('hyp').innerHTML=%s;
  document.getElementById('examples').innerHTML=%s;
  document.getElementById('foot').innerHTML='<p><b>Method.</b> Probes written in each tradition’s own '+
    'idiom retrieved passages across the corpus; every centre a passage locates on the body was extracted '+
    'with its name, locus, colour, element, stated total and function. Systems were aligned only on body '+
    'location — never on names — so the comparison does not presuppose its own result. Channel-and-point '+
    'medicine was retrieved as a control.</p>'+
    '<p>Companion to the <a href="/">working paper</a> and the <a href="/atlas">Atlas of Described Experience</a>.</p>';
})();
</script>""" % (json.dumps(BA['totals']), json.dumps(hyp_html), json.dumps(''.join(ex_html)))

bodies_head = ('<!doctype html><html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        '<title>The Same Body, Ten Times — reconstructing subtle-body maps</title>'
        '<meta name="description" content="Ten traditions charted centres on the human body. '
        'Reconstructed from their own sources: where they agree, where they do not, and which parts '
        'anyone ever claimed to feel.">'
        + FONTS + SL_STYLE + '</head><body>' + NAV)
open(f'{OUT}/bodies.html', 'w').write(bodies_head + bb + bodies_script + '</body></html>')
print(f'bodies.html — {len(BA["figures"])} figures, {sum(len(g["items"]) for g in BA["examples"])} examples, '
      f'{os.path.getsize(f"{OUT}/bodies.html")//1024}KB')



# ---------------------------------------------------------------- PEACE response
PA = json.load(open(f'{HERE}/peace-assets.json'))
pb = open(f'{HERE}/peace-body.html').read().replace('__FIG_PRIOR__', PA['fig'])
ind = {r['pali']: r for r in PA['indic']}
trow = ''.join(
    '<tr><td>' + esc(r['pali']) + ' <span style="color:var(--text-faint)">' + esc(r['eng']) + '</span></td>'
    '<td class="num">' + str(r['n']) + '</td>'
    '<td class="num">' + str(r['exp']) + '%</td>'
    '<td class="num">' + str(ind.get(r['pali'], {}).get('exp', '—')) + '%</td>'
    '<td class="num">' + str(r['rit']) + '%</td>'
    '<td class="num">' + str(r['trads']) + '/10</td>'
    '<td class="num">' + str(r['tradsExp']) + '/10</td></tr>' for r in PA['rows'])
peace_script = """<script>
(function(){
  document.getElementById('statrow').innerHTML=[['3,888','centres extracted'],['10','traditions reconstructed'],
    ['33.1%','of heart records are experiential'],['10/10','traditions feel the heart'],['6','chakras in the source text']]
    .map(x=>'<div><b>'+x[0]+'</b><span>'+x[1]+'</span></div>').join('');
  document.getElementById('tbl-prior').innerHTML='<table><thead><tr>'+
    ['Chakra','Records','Experiential (all)','Experiential (Indic only)','Ritual','Traditions placing','Traditions feeling']
      .map(function(h){return '<th scope=\"col\">'+h+'</th>';}).join('')+
    '</tr></thead><tbody>__TROW__</tbody></table>';
  document.getElementById('foot').innerHTML='<p><b>Sources.</b> Lyon, A. (2026). Mystical entropy: an '+
    'introduction to the psychedelic-kundalini thesis and the PEACE framework for contemplative research. '+
    '<i>Philosophical Psychology</i> 39(5), 1691–1716. Lyon, A. &amp; Vaidya, A. (forthcoming). Witnessing '+
    'Kundalini: Introducing the PEACE framework for psychedelic and meditation research, in <i>Indian '+
    'Spirituality in Contemporary Philosophy</i> (OUP). Bartels, J. (2025), MSc thesis, Oldenburg, cited in Lyon (2026).</p>'+
    '<p>Method and full data: <a href="/">the working paper</a> · <a href="/bodies">the subtle-body reconstruction</a> · '+
    '<a href="/atlas">the Atlas</a>. Every figure here is computed from files released on those pages.</p>';
})();
</script>""".replace('__TROW__', trow)
peace_head = ('<!doctype html><html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        '<title>A Corpus for PEACE — response to Lyon &amp; Vaidya</title>'
        '<meta name="description" content="What disciplined cross-traditional comparison looks like over '
        '3.9 million pages of primary sources: a historical prior for the seven chakras, and what the '
        'Sat-cakra-nirupana actually says.">'
        + FONTS + SL_STYLE + '</head><body>' + NAV)
open(f'{OUT}/peace.html', 'w').write(peace_head + pb + peace_script + '</body></html>')
print(f'peace.html — {os.path.getsize(f"{OUT}/peace.html")//1024}KB')


json.dump({"cleanUrls": True}, open(f'{OUT}/vercel.json', 'w'))
print('\ndeploy dir:', OUT, '->', os.listdir(OUT))
