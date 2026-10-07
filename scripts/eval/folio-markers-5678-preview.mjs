#!/usr/bin/env node
// PRIOR ART: scripts/eval/folio-markers-5678.mjs writes the per-page JSON this reads; no other
// preview generator in scripts/eval/ renders a page view beside a continuous view.
/**
 * Build scripts/eval/results/folio-markers-5678/preview.html — one self-contained page for the
 * reviewers of #5678: the woodblock image, the Tibetan e-text, the NEW page span (carried
 * half-sentences greyed and labelled), the OLD served English, and below them the whole stretch
 * as continuous English with folio markers in the margin. $0, no network, no secrets: data is
 * inlined, images are their public images.sourcelibrary.org URLs.
 *
 *   node scripts/eval/folio-markers-5678-preview.mjs
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'results', 'folio-markers-5678');
const STRETCHES = [
  { id: 'v96a', vol: 96, from: 28, to: 43, title: 'Derge Tengyur vol. 96 (dbu ma, tsa), ff. 14b–22b: Mūlamadhyamakakārikā 23–27, then the Yuktiṣaṣṭikā' },
  { id: 'v96b', vol: 96, from: 113, to: 124, title: 'Derge Tengyur vol. 96, ff. 57a–63a: commentary on MMK 12–16' },
  { id: 'v113a', vol: 113, from: 116, to: 126, title: 'Derge Tengyur vol. 113, ff. 59a–64a: commentary on the Buddha’s qualities' },
  { id: 'v113b', vol: 113, from: 224, to: 234, title: 'Derge Tengyur vol. 113, ff. 113a–118a: commentary on the Daśabhūmika' },
  { id: 'v33', vol: 33, from: 170, to: 180, title: 'Derge Tengyur vol. 33, ff. 86a–91a: tantric commentary' },
];
const KNOWN = [
  { key: 'v96-p35', label: 'vol 96 p35 (f. 18a): served English showed 7 of ~21 verses' },
  { key: 'v96-p34', label: 'vol 96 p34 (f. 17b): served English overran into p35' },
  { key: 'v96-p119', label: 'vol 96 p119 (f. 60b): served English dropped the top, imported the next verse' },
  { key: 'v113-p122', label: 'vol 113 p122 (f. 62a): served English missing its first 60%' },
  { key: 'v113-p230', label: 'vol 113 p230 (f. 116a): served English at 0.30 words/syllable' },
  { key: 'v33-p176', label: 'vol 33 p176 (f. 89a): served English invented a lead-in' },
  { key: 'v96-p123', label: 'NEW run fails: vol 96 p123 (f. 62b): no marker, run together with p122' },
  { key: 'v96-p117', label: 'NEW run misplaces: vol 96 p117 (f. 59b): ~3 verse lines landed on p116' },
  { key: 'v33-p173', label: 'NEW run misplaces: vol 33 p173 (f. 87b): ~2 sentences landed on p172' },
  { key: 'v96-p36', label: 'NEW run completes: vol 96 p36 (f. 18b): “would be established” on both pages' },
];

const pages = readdirSync(join(OUT, 'pages')).filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(OUT, 'pages', f), 'utf8')))
  .sort((a, b) => a.vol - b.vol || a.page_number - b.page_number);
const check = JSON.parse(readFileSync(join(OUT, 'check.json'), 'utf8'));
const turnOf = new Map(check.turns.map((t) => [`v${t.vol}-p${t.page_number}`, t]));

const data = STRETCHES.map((s) => ({
  ...s,
  pages: pages.filter((p) => p.vol === s.vol && p.page_number >= s.from && p.page_number <= s.to).map((p) => {
    const key = `v${p.vol}-p${p.page_number}`;
    const t = turnOf.get(key);
    return {
      key, vol: p.vol, n: p.page_number, label: p.page_label, img: p.image,
      bo: p.tibetan, syl: p.syllables, span: p.span, head: p.head, tail: p.tail, headFrom: p.head_from, tailOn: p.tail_on,
      old: p.old_translation, nw: p.new_words, ow: p.old_words, block: p.block, bi: p.block_index,
      turn: t ? { src: t.src_frac, nf: t.new_frac, of: t.old_frac, ns: t.new_err_sentences, os: t.old_err_sentences } : null,
    };
  }),
}));
const s = check.summary;
const summary = { n: s.n_pages, turns: s.n_turns, newMed: s.new.median_abs_err, oldMed: s.old.median_abs_err, newP90: s.new.p90_abs_err, oldP90: s.old.p90_abs_err };

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Folio markers in continuous English: Derge Tengyur preview (#5678)</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Serif+Tibetan:wght@400;600&display=swap" rel="stylesheet">
<style>
  :root { --ink:#1f1d1a; --muted:#6b665e; --rule:#ddd8cf; --paper:#fbfaf7; --carried:#9a958c; --accent:#8a3b12; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--paper); color:var(--ink); font:17px/1.6 Georgia, 'Times New Roman', serif; }
  header, main { max-width: 1280px; margin: 0 auto; padding: 0 20px; }
  header { padding-top: 20px; }
  h1 { font-size: 1.35rem; margin: 0 0 4px; font-weight: 600; }
  h2 { font-size: 1.05rem; margin: 0 0 8px; font-weight: 600; }
  .lede { color: var(--muted); font-size: .95rem; margin: 0 0 12px; max-width: 70ch; }
  .bar { border-bottom:1px solid var(--rule); position:sticky; top:0; background:var(--paper); z-index:5; }
  .bar-in { max-width:1280px; margin:0 auto; padding:10px 20px; display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
  .bar button, .bar select { font: inherit; font-size: .9rem; padding: 6px 10px; border:1px solid var(--rule); background:#fff; border-radius:4px; color:var(--ink); }
  .bar button { cursor:pointer; min-width: 44px; }
  .bar select { max-width: 100%; flex: 1 1 280px; }
  .bar .where { font-size:.95rem; font-weight:600; margin-right:auto; }
  .scan { margin: 14px 0 6px; background:#fff; border:1px solid var(--rule); }
  .scan img { display:block; width:100%; height:auto; }
  .scan figcaption { font-size:.8rem; color:var(--muted); padding:4px 8px; }
  .cols { display:grid; grid-template-columns: 1fr 1.15fr 1fr; gap: 18px; margin: 10px 0 24px; }
  .col { min-width:0; }
  .col h3 { font-size:.78rem; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); margin:0 0 6px; font-weight:600; }
  .col .meta { font-size:.8rem; color:var(--muted); margin-top:6px; }
  .bo { font-family:'Noto Serif Tibetan', serif; font-size: 1.15rem; line-height: 2.0; white-space: pre-line; }
  .en { white-space: pre-line; }
  .new { background:#fff; border:1px solid var(--rule); padding:10px 12px; border-radius:4px; }
  .old { color:#3d3a35; }
  .carried { color: var(--carried); }
  .carried-label { display:block; font-size:.75rem; font-style:normal; color:var(--carried); letter-spacing:.03em; margin: 2px 0; }
  .note { color: var(--muted); font-size:.88em; }
  .note::before { content:'('; } .note::after { content:')'; }
  .term { font-style: italic; }
  .gloss { color: var(--muted); }
  .gloss::before { content:' ('; } .gloss::after { content:')'; }
  .warn { color: var(--accent); font-size: .9rem; }
  .flow { background:#fff; border:1px solid var(--rule); border-radius:4px; padding: 16px 20px 16px 92px; position:relative; margin-bottom: 28px; }
  .flow .en { max-width: 72ch; }
  .pb { color: var(--accent); font-size: .7em; vertical-align: super; padding: 0 1px; }
  .pb-m { position:absolute; left: 14px; font-size:.75rem; color:var(--accent); cursor:pointer; text-decoration: none; white-space: nowrap; font-family: Georgia, serif; font-style: normal; }
  .pb-m:hover { text-decoration: underline; }
  .cur { background: #f6efe1; }
  .gap { display:block; color: var(--muted); font-size:.85rem; font-style: italic; margin: 6px 0; }
  .measure { font-size:.85rem; color:var(--muted); border-top:1px solid var(--rule); padding: 10px 0 30px; }
  @media (max-width: 900px) {
    .cols { grid-template-columns: 1fr; }
    .scan a { display:block; overflow-x:auto; -webkit-overflow-scrolling:touch; }
    .scan img { width:auto; height:200px; max-width:none; }
    .flow { padding-left: 64px; }
    .pb-m { left: 8px; }
    body { font-size: 16px; }
  }
</style>
</head>
<body>
<header>
  <h1>Folio markers in continuous English: a Derge Tengyur preview</h1>
  <p class="lede">The English is translated as one continuous text across each block of pages. The model marks where each woodblock page begins inside the English, mid-sentence if the page turns there. The page view shows this page’s words at full strength; a sentence carried over from or onto a neighbouring folio is greyed and labelled. Machine translation (gemini-3-flash-preview), not reviewed by a Tibetologist. This is a preview only; nothing here is served on Source Library yet. Issue #5678.</p>
</header>
<div class="bar" role="navigation"><div class="bar-in">
  <span class="where" id="where"></span>
  <button id="prev" aria-label="Previous page">←</button>
  <button id="next" aria-label="Next page">→</button>
  <select id="pick" aria-label="Jump to a page"></select>
</div></div>
<main>
  <figure class="scan"><a id="imglink" target="_blank" rel="noopener"><img id="img" alt=""></a><figcaption id="cap"></figcaption></figure>
  <div class="cols">
    <section class="col"><h3>Tibetan e-text (Esukhia Derge Tengyur)</h3><div class="bo" id="bo" lang="bo"></div><div class="meta" id="bometa"></div></section>
    <section class="col"><h3>New: this page’s English</h3><div class="new en" id="new"></div><div class="meta" id="newmeta"></div></section>
    <section class="col"><h3>Old: the pilot English served today</h3><div class="old en" id="old"></div><div class="meta" id="oldmeta"></div></section>
  </div>
  <h2 id="flowtitle"></h2>
  <div class="flow"><div class="en" id="flow"></div></div>
  <p class="measure" id="measure"></p>
</main>
<script>
const DATA = ${JSON.stringify(data).replace(/</g, '\\u003c')};
const KNOWN = ${JSON.stringify(KNOWN)};
const SUMMARY = ${JSON.stringify(summary)};
const ALL = DATA.flatMap((s) => s.pages.map((p) => ({ ...p, stretch: s })));
const byKey = new Map(ALL.map((p, i) => [p.key, i]));
const $ = (id) => document.getElementById(id);
const esc = (t) => String(t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function en(t) {
  return esc(t)
    .replace(/&lt;note&gt;([\\s\\S]*?)&lt;\\/note&gt;/g, '<span class="note">$1</span>')
    .replace(/&lt;term&gt;([\\s\\S]*?)&lt;\\/term&gt;/g, '<span class="term">$1</span>')
    .replace(/&lt;gloss&gt;([\\s\\S]*?)&lt;\\/gloss&gt;/g, '<span class="gloss">$1</span>')
    .replace(/&lt;(summary|keywords|meta|vocab|warning)&gt;[\\s\\S]*?&lt;\\/\\1&gt;/g, '')
    .replace(/&lt;\\/?[a-z-]+\\/?&gt;/g, '')
    .replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>')
    .trim();
}
const bo = (t) => esc(String(t || '').replace(/\\\\?#/g, ''));
const pct = (x) => (x == null ? '–' : (100 * x).toFixed(1) + '%');
function show(i, push = true) {
  i = Math.max(0, Math.min(ALL.length - 1, i));
  const p = ALL[i];
  cur = i;
  $('where').textContent = 'Vol. ' + p.vol + ', p. ' + p.n + ' (' + p.label + ')';
  $('img').src = p.img; $('img').alt = 'Woodblock print, Derge Tengyur vol. ' + p.vol + ', ' + p.label;
  $('imglink').href = p.img;
  $('cap').textContent = 'Woodblock print (BDRC W23703), vol. ' + p.vol + ', ' + p.label + '. Tap to open full size' + (window.innerWidth <= 900 ? '; swipe to scroll along the leaf.' : '.');
  $('bo').innerHTML = bo(p.bo);
  $('bometa').textContent = p.syl + ' syllables';
  if (p.span) {
    let h = '';
    if (p.head) h += '<span class="carried"><span class="carried-label">continues from ' + esc(p.headFrom) + '</span>' + en(p.head) + '</span> ';
    h += en(p.span);
    if (p.tail) h += ' <span class="carried">' + en(p.tail) + '<span class="carried-label">continues on ' + esc(p.tailOn) + '</span></span>';
    $('new').innerHTML = h;
  } else {
    $('new').innerHTML = '<p class="warn">No marker for this page. The model ran this page’s English together with the page before it, on both attempts, so this page has no span of its own. The continuous view below shows where its text went.</p>';
  }
  $('newmeta').textContent = !p.span ? 'no marker, so no position to measure' : p.nw + ' words' + (p.turn ? ' · page begins at ' + pct(p.turn.nf) + ' of the block’s English; the source page begins at ' + pct(p.turn.src) + ' of its syllables' : '');
  $('old').innerHTML = en(p.old);
  $('oldmeta').textContent = p.ow + ' words' + (p.turn ? ' · page begins at ' + pct(p.turn.of) + ' of the same pages’ English' : '');
  renderFlow(p);
  $('pick').value = p.key;
  if (push) history.replaceState(null, '', '#' + p.key);
}
function renderFlow(p) {
  const s = p.stretch;
  $('flowtitle').textContent = 'Continuous view: ' + s.title;
  let h = '';
  let prevN = null; let prevBlock = null;
  for (const q of s.pages) {
    if (prevN != null && q.n !== prevN + 1) h += '<span class="gap">[no e-text for the pages between p. ' + prevN + ' and p. ' + q.n + '; the text resumes here]</span>';
    else if (prevBlock && q.block !== prevBlock && q.bi === 0) h += '';
    const mark = '<a class="pb-m" data-k="' + q.key + '">' + esc(q.label) + '</a><span class="pb">' + esc(q.label.replace('f. ', '')) + '</span>';
    const body = q.span ? en(q.span) : '<span class="warn">[no marker for ' + esc(q.label) + ': its text is inside the previous folio]</span>';
    h += mark + '<span' + (q.key === p.key ? ' class="cur"' : '') + '>' + body + '</span> ';
    prevN = q.n; prevBlock = q.block;
  }
  $('flow').innerHTML = h;
  $('flow').querySelectorAll('.pb-m').forEach((a) => a.addEventListener('click', () => { show(byKey.get(a.dataset.k)); window.scrollTo({ top: 0, behavior: 'smooth' }); }));
}
let cur = 0;
const pick = $('pick');
const og1 = document.createElement('optgroup'); og1.label = 'Known problem pages';
KNOWN.forEach((k) => { const o = document.createElement('option'); o.value = k.key; o.textContent = k.label; og1.appendChild(o); });
pick.appendChild(og1);
DATA.forEach((s) => { const og = document.createElement('optgroup'); og.label = 'Vol. ' + s.vol + ', pp. ' + s.from + '–' + s.to; s.pages.forEach((p) => { const o = document.createElement('option'); o.value = p.key; o.textContent = 'Vol. ' + p.vol + ' p. ' + p.n + ' (' + p.label + ')'; og.appendChild(o); }); pick.appendChild(og); });
pick.addEventListener('change', () => show(byKey.get(pick.value)));
$('prev').addEventListener('click', () => show(cur - 1));
$('next').addEventListener('click', () => show(cur + 1));
document.addEventListener('keydown', (e) => { if (e.target.tagName === 'SELECT') return; if (e.key === 'ArrowLeft') show(cur - 1); if (e.key === 'ArrowRight') show(cur + 1); });
$('measure').textContent = 'Measured over ' + SUMMARY.n + ' pages and ' + SUMMARY.turns + ' page turns inside blocks: where the page begins in the English versus where it begins in the Tibetan, as a share of the block. Median miss: new ' + pct(SUMMARY.newMed) + ', old ' + pct(SUMMARY.oldMed) + '; 90th percentile: new ' + pct(SUMMARY.newP90) + ', old ' + pct(SUMMARY.oldP90) + '. A rough measure, since English does not expand evenly across a page. Read the pages above for the real answer.';
window.addEventListener('hashchange', () => { const k = location.hash.slice(1); if (byKey.has(k) && byKey.get(k) !== cur) show(byKey.get(k), false); });
show(byKey.has(location.hash.slice(1)) ? byKey.get(location.hash.slice(1)) : byKey.get('v96-p35'), false);
</script>
</body>
</html>
`;
writeFileSync(join(OUT, 'preview.html'), html);
console.log(`wrote ${join(OUT, 'preview.html')} (${(html.length / 1024).toFixed(0)} KB, ${ALL_COUNT()} pages)`);
function ALL_COUNT() { return data.reduce((n, x) => n + x.pages.length, 0); }
