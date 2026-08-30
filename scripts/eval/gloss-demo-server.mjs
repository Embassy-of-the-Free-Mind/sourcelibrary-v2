#!/usr/bin/env node
// "Touch the Greek" — local prototype of the reader gloss (issues #4320/#4332).
//
// The experience: you are READING a real Greek page from Source Library
// (Aldine Plato, the Septuagint, Proclus…). Select any span of the Greek and
// the tuned house model (sl-greek-translator-v1) glosses exactly that span in
// a popover — provenance-labeled, with a link to the real page and an
// optional compare-with-base expander. The paste box of v1 survives only as
// a tucked-away "free-form" mode.
//
// Prep once (extracts ~40 showcase pages from the exported pairs):
//   node scripts/eval/gloss-demo-server.mjs --prepare \
//     --pairs /path/to/pairs-greek.jsonl.gz
// Run:
//   node scripts/eval/gloss-demo-server.mjs   → http://localhost:7788
//
// Local only (binds 127.0.0.1); auth via `gcloud auth print-access-token`.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const arg = (f, d) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : d; };
const PORT = 7788;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PASSAGES = path.join(HERE, 'gloss-demo-passages.json');

const LOC = 'us-central1', PN = '877864597985';
const API = `https://${LOC}-aiplatform.googleapis.com/v1`;
const TUNED = `projects/${PN}/locations/${LOC}/endpoints/6705829608584904704`;
const BASE = `projects/${PN}/locations/${LOC}/publishers/google/models/gemini-2.5-flash-lite`;
const SYSTEM = 'You are a translator for Source Library, a digital library of historical primary sources. Translate the given text into clear, accurate English, preserving the structure, register, and meaning of the original.';

// ---------------------------------------------------------------- prepare --
// Showcase pages: famous books first (matched on SLUG only — a title
// mentioning "Platonis" must not outrank the Aldine itself), clean unflagged
// pages of readable size, continuous prose (marginalia-index pages rejected).
const PRIORITY = [
  /omnia-platonis-opera|hapanta-platonos/i,
  /platonis-dialogi|plato-de-legibus|plato-platon/i,
  /iliad|homer|odyss/i,
  /septuagint/i,
  /procli|proclus|plotin/i,
  /aristot/i,
];
// Reader-facing cleanup: the pairs keep transcription apparatus (<margin>,
// <note>, …) because a TRAINING corpus wants it; a READING pane does not.
// Blocks are removed whole; any straggler tag is dropped; interiors bounded.
const readerClean = (text) => text
  .replace(/<(margin|note|insert|footnote|caption|image-desc)>[\s\S]{0,4000}?<\/\1>/gi, '')
  .replace(/<[^<>]{1,60}>/g, '')
  .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
const greekRatio = (s) => {
  let g = 0, l = 0;
  for (const ch of s) { if (/\p{L}/u.test(ch)) { l++; if (/[Ͱ-Ͽἀ-῿]/.test(ch)) g++; } }
  return l ? g / l : 0;
};
async function prepare(pairsPath) {
  const perBook = new Map();
  const rl = readline.createInterface({
    input: fs.createReadStream(pairsPath).pipe(zlib.createGunzip()),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line) continue;
    const r = JSON.parse(line);
    if (r.flags || r.ratio < 0.9 || r.ratio > 2.5) continue;
    const greek = readerClean(r.source_text);
    const english = readerClean(r.translation_en);
    if (greek.length < 800 || greek.length > 2600) continue;
    if (greekRatio(greek) < 0.85) continue; // continuous Greek prose only
    const prio = PRIORITY.findIndex((re) => re.test(r.book_slug));
    const cur = perBook.get(r.book_id);
    // keep up to 2 pages per book, prefer mid-book pages (past front matter)
    const title = (r.title || r.book_slug).split(/ [:=] /)[0].slice(0, 90);
    const entry = { prio: prio === -1 ? 99 : prio, title, author: r.author, year: r.year, slug: r.book_slug, page: r.page_number, url: r.url, greek, english };
    if (!cur) perBook.set(r.book_id, [entry]);
    else if (cur.length < 2 && r.page_number > 20) cur.push(entry);
  }
  const all = [...perBook.values()].flat().sort((a, b) => a.prio - b.prio || a.slug.localeCompare(b.slug));
  const famous = all.filter((e) => e.prio < 99).slice(0, 30);
  const filler = all.filter((e) => e.prio === 99).slice(0, 10);
  const picked = [...famous, ...filler];
  fs.writeFileSync(PASSAGES, JSON.stringify(picked, null, 1));
  console.log(`[prepare] wrote ${picked.length} passages (${famous.length} priority) → ${PASSAGES}`);
  for (const p of picked.slice(0, 12)) console.log(`  [${p.prio}] ${p.slug} p${p.page} — ${(p.title || '').slice(0, 60)}`);
}

// ------------------------------------------------------------------ model --
let tok = { v: null, at: 0 };
const token = () => {
  if (!tok.v || Date.now() - tok.at > 45 * 60e3) tok = { v: execFileSync('gcloud', ['auth', 'print-access-token']).toString().trim(), at: Date.now() };
  return tok.v;
};
async function generate(target, text) {
  const t0 = Date.now();
  const r = await fetch(`${API}/${target}:generateContent`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { role: 'system', parts: [{ text: SYSTEM }] },
      contents: [{ role: 'user', parts: [{ text: `Translate this Ancient Greek text into English:\n\n${text}` }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 2048 },
    }),
  });
  const j = await r.json();
  const out = j.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? `(model error: ${JSON.stringify(j.error || j).slice(0, 200)})`;
  return { text: out, ms: Date.now() - t0 };
}

// -------------------------------------------------------------------- page --
const PAGE = () => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Touch the Greek — Source Library</title>
<style>
  :root { color-scheme: light dark; --accent:#8b5e34; --ink: CanvasText; }
  * { box-sizing: border-box; }
  body { font-family: Georgia, 'Times New Roman', serif; margin: 0; display: flex; min-height: 100vh; }
  #shelf { width: 300px; flex: none; border-right: 1px solid color-mix(in srgb, CanvasText 15%, transparent); padding: 1.1rem .9rem; overflow-y: auto; height: 100vh; position: sticky; top: 0; }
  #shelf h1 { font-size: 1.05rem; margin: 0 0 .2rem; }
  #shelf .sub { font-size: .8rem; opacity: .65; line-height: 1.45; margin-bottom: 1rem; }
  .book { display: block; width: 100%; text-align: left; background: none; border: none; font: inherit; color: inherit;
          padding: .5rem .55rem; border-radius: 7px; cursor: pointer; line-height: 1.3; }
  .book:hover { background: color-mix(in srgb, CanvasText 7%, transparent); }
  .book.active { background: color-mix(in srgb, var(--accent) 18%, transparent); }
  .book .t { font-size: .88rem; display: block; }
  .book .m { font-size: .74rem; opacity: .6; }
  #main { flex: 1; max-width: 46rem; margin: 0 auto; padding: 2.2rem 2rem 6rem; }
  #passhead { margin-bottom: 1.4rem; }
  #passhead h2 { font-size: 1.15rem; margin: 0 0 .15rem; font-style: italic; }
  #passhead .meta { font-size: .82rem; opacity: .65; }
  #passhead a { color: var(--accent); }
  #hint { font-size: .85rem; padding: .5rem .8rem; border-left: 3px solid var(--accent);
          background: color-mix(in srgb, var(--accent) 8%, transparent); border-radius: 0 6px 6px 0; margin-bottom: 1.2rem; }
  #greek { font-size: 1.22rem; line-height: 1.85; white-space: pre-wrap; }
  #greek::selection, #greek *::selection { background: color-mix(in srgb, var(--accent) 35%, transparent); }
  #entoggle { margin-top: 2rem; font-size: .85rem; }
  #entoggle summary { cursor: pointer; opacity: .7; }
  #english { white-space: pre-wrap; line-height: 1.6; opacity: .85; margin-top: .6rem; }
  #pop { position: absolute; z-index: 10; max-width: 30rem; min-width: 16rem; background: Canvas; color: CanvasText;
         border: 1px solid color-mix(in srgb, CanvasText 25%, transparent); border-radius: 10px;
         box-shadow: 0 8px 30px rgba(0,0,0,.25); padding: .9rem 1rem .7rem; display: none; }
  #pop .gloss { line-height: 1.55; white-space: pre-wrap; }
  #pop .foot { display: flex; gap: .8rem; align-items: baseline; margin-top: .65rem; font-size: .72rem; opacity: .65;
               border-top: 1px solid color-mix(in srgb, CanvasText 12%, transparent); padding-top: .5rem; flex-wrap: wrap; }
  #pop .foot a { color: var(--accent); cursor: pointer; }
  #pop .spin { opacity: .6; font-style: italic; }
  #basecmp { margin-top: .5rem; font-size: .85rem; opacity: .8; white-space: pre-wrap; display: none;
             border-top: 1px dashed color-mix(in srgb, CanvasText 20%, transparent); padding-top: .5rem; }
  #freeform { margin-top: 3rem; font-size: .85rem; }
  #freeform summary { cursor: pointer; opacity: .55; }
  #freeform textarea { width: 100%; min-height: 90px; font: inherit; font-size: 1rem; margin: .5rem 0; padding: .5rem; }
  @media (max-width: 760px) { #shelf { display: none; } #main { padding: 1.2rem 1rem 5rem; } }
</style>
<nav id="shelf"><h1>Touch the Greek</h1>
  <div class="sub">A prototype of the Source Library reader gloss. Pick a page, then <b>select any Greek phrase</b> — the house model translates exactly what you touched.</div>
  <div id="books"></div>
</nav>
<main id="main">
  <div id="passhead"></div>
  <div id="hint">Select a word, a line, or a whole passage below — a translation appears where you lift the mouse. <span id="modelstate" style="opacity:.7"></span></div>
  <div id="greek"></div>
  <details id="entoggle"><summary>Show the full page translation (from the library)</summary><div id="english"></div></details>
  <details id="freeform"><summary>Free-form: translate Greek from elsewhere</summary>
    <textarea id="fftext" placeholder="Ἐν ἀρχῇ ἦν ὁ λόγος…"></textarea>
    <button id="ffgo">Translate</button>
    <div id="ffout" style="white-space:pre-wrap;margin-top:.6rem"></div>
  </details>
</main>
<div id="pop"><div class="gloss"></div><div id="basecmp"></div>
  <div class="foot"><span>machine gloss — Source Library model v1 · <span id="ms"></span></span>
  <a id="cmp">compare with base model</a><a id="srclink" target="_blank">this page in the library ↗</a></div></div>
<script>
let passages = [], current = null, lastSel = '';
const $ = (id) => document.getElementById(id);

async function init() {
  passages = await (await fetch('/passages')).json();
  const byBook = new Map();
  passages.forEach((p, i) => { const k = p.slug; if (!byBook.has(k)) byBook.set(k, []); byBook.get(k).push(i); });
  $('books').innerHTML = [...byBook.entries()].map(([slug, idxs]) => {
    const p = passages[idxs[0]];
    return idxs.map((i, j) => '<button class="book" data-i="' + i + '"><span class="t">' + esc(p.title || slug) + (idxs.length > 1 ? ' — leaf ' + passages[i].page : '') + '</span><span class="m">' + esc(p.author || '') + (p.year ? ' · ' + p.year : '') + '</span></button>').join('');
  }).join('');
  document.querySelectorAll('.book').forEach((b) => b.onclick = () => show(+b.dataset.i));
  show(0);
  const s = await (await fetch('/status')).json();
  $('modelstate').textContent = s.tuned ? '' : '(tuned model unavailable — using base)';
}
function esc(s){return (s||'').replace(/[&<>"]/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
function show(i) {
  current = passages[i];
  document.querySelectorAll('.book').forEach((b) => b.classList.toggle('active', +b.dataset.i === i));
  $('passhead').innerHTML = '<h2>' + esc(current.title) + '</h2><div class="meta">' + esc(current.author || '') + (current.year ? ' · ' + current.year : '') + ' · leaf ' + current.page + ' · <a href="' + current.url + '" target="_blank">read in the library ↗</a></div>';
  $('greek').textContent = current.greek;
  $('english').textContent = current.english;
  $('entoggle').open = false; hidePop();
  window.scrollTo(0, 0);
}
function hidePop(){ $('pop').style.display = 'none'; $('basecmp').style.display = 'none'; $('basecmp').textContent=''; }
document.addEventListener('mousedown', (e) => { if (!$('pop').contains(e.target)) hidePop(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hidePop(); });

$('greek').addEventListener('mouseup', async () => {
  const sel = window.getSelection();
  const text = sel.toString().trim();
  if (!text || text.length < 2 || !$('greek').contains(sel.anchorNode)) return;
  lastSel = text;
  const rect = sel.getRangeAt(0).getBoundingClientRect();
  const pop = $('pop');
  pop.style.display = 'block';
  pop.querySelector('.gloss').innerHTML = '<span class="spin">translating…</span>';
  $('ms').textContent = ''; $('srclink').href = current.url;
  const top = rect.bottom + window.scrollY + 8;
  pop.style.top = top + 'px';
  pop.style.left = Math.max(12, Math.min(rect.left + window.scrollX, window.innerWidth - pop.offsetWidth - 16)) + 'px';
  const r = await (await fetch('/gloss', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) })).json();
  if (window.getSelection().toString().trim() !== text) return; // stale
  pop.querySelector('.gloss').textContent = r.gloss.text;
  $('ms').textContent = r.gloss.ms + 'ms';
});
$('cmp').onclick = async () => {
  $('basecmp').style.display = 'block'; $('basecmp').textContent = 'asking the base model…';
  const r = await (await fetch('/gloss', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: lastSel, base: true }) })).json();
  $('basecmp').textContent = 'base flash-lite: ' + r.gloss.text;
};
$('ffgo').onclick = async () => {
  const text = $('fftext').value.trim(); if (!text) return;
  $('ffout').textContent = 'translating…';
  const r = await (await fetch('/gloss', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) })).json();
  $('ffout').textContent = r.gloss.text;
};
init();
</script>`;

// ------------------------------------------------------------------ serve --
async function serve() {
  if (!fs.existsSync(PASSAGES)) {
    console.error(`[gloss] ${PASSAGES} missing — run with --prepare --pairs <pairs-greek.jsonl.gz> first`);
    process.exit(1);
  }
  const passages = JSON.parse(fs.readFileSync(PASSAGES, 'utf8'));
  let tunedOk = true;
  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(PAGE());
      } else if (req.method === 'GET' && req.url === '/passages') {
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(passages));
      } else if (req.method === 'GET' && req.url === '/status') {
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ tuned: tunedOk }));
      } else if (req.method === 'POST' && req.url === '/gloss') {
        let body = '';
        for await (const c of req) body += c;
        const { text, base } = JSON.parse(body);
        if (!text || text.length > 8000) { res.writeHead(400).end('{"error":"bad text"}'); return; }
        const g = await generate(base ? BASE : TUNED, text);
        if (!base && g.text.startsWith('(model error')) tunedOk = false;
        // The model learned our transcription apparatus (<note>, <margin>…)
        // from the training pairs; a gloss popover wants prose only.
        if (!g.text.startsWith('(model error')) g.text = readerClean(g.text);
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ gloss: g }));
      } else res.writeHead(404).end();
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: String(e).slice(0, 300) }));
    }
  });
  server.listen(PORT, '127.0.0.1', () => console.log(`touch-the-greek → http://localhost:${PORT} (${passages.length} passages)`));
  // warm the tuned endpoint so the first real selection isn't a 15s cold start
  generate(TUNED, 'χαῖρε').then((r) => console.log(`[warm] tuned endpoint ready (${r.ms}ms)`)).catch(() => {});
}

if (process.argv.includes('--prepare')) {
  await prepare(arg('--pairs', '/Users/dereklomas/sourcelibrary/scripts/output/training-pairs-v1/pairs-greek.jsonl.gz'));
} else {
  await serve();
}
