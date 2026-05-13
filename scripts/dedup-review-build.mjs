#!/usr/bin/env node
/**
 * Generate per-book HTML review pages from dedup proposals.
 *
 * For each book scanned by scripts/dedup-scan-strict.mjs:
 *   - Reads .claude/docs/dedup-proposals/<book_id>.json
 *   - Writes /tmp/dedup-review/<book_id>.html with side-by-side images
 *
 * Also writes /tmp/dedup-review/index.html — list of books with proposal
 * counts; click to review.
 *
 * Each page has accept/reject buttons per pair. Saves decisions to
 * localStorage. "Export decisions" downloads JSON the user can paste
 * back so scripts/dedup-apply-approved.mjs can apply the accepted pairs.
 *
 * Usage:
 *   node scripts/dedup-review-build.mjs
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');
const PROPOSAL_DIR = resolve(REPO_ROOT, '.claude/docs/dedup-proposals');
const OUT_DIR = '/tmp/dedup-review';
mkdirSync(OUT_DIR, { recursive: true });

const files = readdirSync(PROPOSAL_DIR).filter(f => f.endsWith('.json'));
const books = [];
for (const f of files) {
  const p = JSON.parse(readFileSync(resolve(PROPOSAL_DIR, f), 'utf8'));
  if (!p.groups?.length) continue;
  books.push(p);
}
books.sort((a, b) => b.groups.reduce((s, g) => s + g.members.length - 1, 0) - a.groups.reduce((s, g) => s + g.members.length - 1, 0));

// Per-book HTML
for (const p of books) {
  const dupCount = p.groups.reduce((s, g) => s + g.members.length - 1, 0);
  const pairs = [];
  for (const g of p.groups) {
    const sorted = [...g.members].sort((a, b) => a.page_number - b.page_number);
    const canon = sorted[0];
    for (const d of sorted.slice(1)) pairs.push({ method: g.method, sha: g.sha || null, canon, dup: d });
  }
  const html = `<!doctype html><meta charset=utf8><title>${p.slug}</title>
<style>
body { font-family: system-ui; background: #1a1a1a; color: #ddd; padding: 1rem; max-width: 1400px; margin: 0 auto; }
h1 { font-size: 1.2rem; margin: 0.3rem 0; }
.summary { display: flex; gap: 1rem; padding: 0.5rem 0; border-bottom: 1px solid #444; margin-bottom: 1rem; flex-wrap: wrap; }
.summary > div { background: #2a2a2a; padding: 0.4rem 0.8rem; border-radius: 4px; }
.toolbar { position: sticky; top: 0; background: #1a1a1a; padding: 0.5rem 0; z-index: 10; display: flex; gap: 0.5rem; align-items: center; border-bottom: 1px solid #444; margin-bottom: 1rem; }
.toolbar button { padding: 0.4rem 0.8rem; background: #3a3a3a; border: 1px solid #555; color: #fff; cursor: pointer; border-radius: 4px; }
.toolbar button:hover { background: #4a4a4a; }
.toolbar .accepted { color: #6c6; }
.toolbar .rejected { color: #c66; }
.pair { display: grid; grid-template-columns: 1fr 1fr auto; gap: 1rem; margin: 1rem 0; padding: 1rem; background: #2a2a2a; border-radius: 8px; border: 2px solid transparent; transition: border 0.2s; }
.pair[data-decision=accept] { border-color: #6c6; background: #2a3a2a; }
.pair[data-decision=reject] { border-color: #c66; background: #3a2a2a; }
.pair img { width: 100%; max-height: 700px; object-fit: contain; background: #fff; cursor: zoom-in; }
.meta { font-size: 0.85rem; margin-bottom: 0.5rem; line-height: 1.4; }
.canon { color: #8f8; } .dup { color: #f88; }
.method-sha { background: #163; padding: 1px 5px; border-radius: 3px; font-size: 0.75rem; }
.method-ocr { background: #346; padding: 1px 5px; border-radius: 3px; font-size: 0.75rem; }
.ocr { background: #1a1a1a; padding: 0.4rem; font-size: 0.7rem; max-height: 100px; overflow: auto; margin-top: 0.3rem; color: #aaa; font-family: monospace; }
.actions { display: flex; flex-direction: column; gap: 0.4rem; align-items: stretch; }
.actions button { padding: 0.6rem 1rem; border: 1px solid #555; cursor: pointer; border-radius: 4px; min-width: 90px; }
.actions button.acc { background: #2a4a2a; color: #afa; }
.actions button.acc:hover, .actions button.acc[data-active] { background: #4a8a4a; }
.actions button.rej { background: #4a2a2a; color: #faa; }
.actions button.rej:hover, .actions button.rej[data-active] { background: #8a4a4a; }
img.zoom { position: fixed; top: 5%; left: 5%; width: 90%; height: 90%; background: #fff; z-index: 100; cursor: zoom-out; padding: 1rem; }
</style>
<h1>${p.title || p.slug}</h1>
<div class="summary">
  <div><strong>Pages:</strong> ${p.pages_count}</div>
  <div><strong>Scanned:</strong> ${p.scanned}</div>
  <div><strong>SHA groups:</strong> ${p.groups.filter(g => g.method === 'sha').length}</div>
  <div><strong>OCR groups:</strong> ${p.groups.filter(g => g.method === 'ocr').length}</div>
  <div><strong>Total proposed dupes:</strong> ${dupCount}</div>
  <div><a href="https://sourcelibrary.org/book/${p.slug}" target="_blank" style="color:#8af">open book →</a></div>
</div>
<div class="toolbar">
  <button onclick="acceptAll()">Accept all</button>
  <button onclick="acceptAllSha()">Accept all SHA</button>
  <button onclick="rejectAll()">Reject all</button>
  <button onclick="exportDecisions()">Copy decisions JSON</button>
  <button onclick="downloadDecisions()">Download JSON</button>
  <span style="margin-left:1rem"><span class="accepted">accepted: <b id=accCount>0</b></span> · <span class="rejected">rejected: <b id=rejCount>0</b></span> · undecided: <b id=undCount>${pairs.length}</b></span>
</div>
${pairs.map((pair, i) => `
<div class="pair" data-i=${i} data-method="${pair.method}" data-dup-id="${pair.dup._id}" data-canon-id="${pair.canon._id}">
  <div>
    <div class="meta canon">CANON pg ${pair.canon.page_number} · printed ${pair.canon.printed_pg ?? '?'} · ${pair.canon.page_type}</div>
    <img src="${pair.canon.cropped_photo}" loading="lazy" onclick="zoom(this)">
    <div class="ocr">${(pair.canon.ocr_snippet || '').replace(/</g, '&lt;')}</div>
  </div>
  <div>
    <div class="meta dup">DUP pg ${pair.dup.page_number} · printed ${pair.dup.printed_pg ?? '?'} · ${pair.dup.page_type} · <span class="method-${pair.method}">${pair.method.toUpperCase()}${pair.dup.sim ? ' '+pair.dup.sim.toFixed(2) : ''}</span></div>
    <img src="${pair.dup.cropped_photo}" loading="lazy" onclick="zoom(this)">
    <div class="ocr">${(pair.dup.ocr_snippet || '').replace(/</g, '&lt;')}</div>
  </div>
  <div class="actions">
    <button class="acc" onclick="decide(${i}, 'accept')">✓ Dupe</button>
    <button class="rej" onclick="decide(${i}, 'reject')">✗ Different</button>
  </div>
</div>`).join('')}
<script>
const BOOK_ID = ${JSON.stringify(p.book_id)};
const PAIRS = ${JSON.stringify(pairs.map(p => ({ dup_id: p.dup._id, canon_id: p.canon._id, method: p.method })))};
const KEY = 'dedup-decisions-' + BOOK_ID;
let decisions = JSON.parse(localStorage.getItem(KEY) || '{}');

function refresh() {
  let acc = 0, rej = 0, und = 0;
  for (let i = 0; i < PAIRS.length; i++) {
    const d = decisions[i];
    const el = document.querySelector('[data-i="'+i+'"]');
    el.dataset.decision = d || '';
    el.querySelector('.acc').toggleAttribute('data-active', d === 'accept');
    el.querySelector('.rej').toggleAttribute('data-active', d === 'reject');
    if (d === 'accept') acc++;
    else if (d === 'reject') rej++;
    else und++;
  }
  document.getElementById('accCount').textContent = acc;
  document.getElementById('rejCount').textContent = rej;
  document.getElementById('undCount').textContent = und;
}
function decide(i, v) {
  decisions[i] = decisions[i] === v ? undefined : v;
  if (!decisions[i]) delete decisions[i];
  localStorage.setItem(KEY, JSON.stringify(decisions));
  refresh();
}
function acceptAll() { for (let i = 0; i < PAIRS.length; i++) decisions[i] = 'accept'; localStorage.setItem(KEY, JSON.stringify(decisions)); refresh(); }
function acceptAllSha() { for (let i = 0; i < PAIRS.length; i++) if (PAIRS[i].method === 'sha') decisions[i] = 'accept'; localStorage.setItem(KEY, JSON.stringify(decisions)); refresh(); }
function rejectAll() { for (let i = 0; i < PAIRS.length; i++) decisions[i] = 'reject'; localStorage.setItem(KEY, JSON.stringify(decisions)); refresh(); }
function exportDecisions() {
  const out = { book_id: BOOK_ID, decisions: Object.entries(decisions).filter(([_,v]) => v).map(([i,v]) => ({ ...PAIRS[i], decision: v })) };
  navigator.clipboard.writeText(JSON.stringify(out, null, 2)).then(() => alert('Copied ' + out.decisions.length + ' decisions to clipboard'));
}
function downloadDecisions() {
  const out = { book_id: BOOK_ID, decisions: Object.entries(decisions).filter(([_,v]) => v).map(([i,v]) => ({ ...PAIRS[i], decision: v })) };
  const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'decisions-' + BOOK_ID + '.json';
  a.click();
}
function zoom(img) {
  if (img.classList.contains('zoom')) { img.classList.remove('zoom'); return; }
  document.querySelectorAll('img.zoom').forEach(i => i.classList.remove('zoom'));
  img.classList.add('zoom');
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') document.querySelectorAll('img.zoom').forEach(i => i.classList.remove('zoom'));
});
refresh();
</script>
`;
  writeFileSync(resolve(OUT_DIR, `${p.book_id}.html`), html);
}

// Index page
const idxHtml = `<!doctype html><meta charset=utf8><title>Dedup review</title>
<style>
body { font-family: system-ui; background: #1a1a1a; color: #ddd; padding: 1rem; max-width: 900px; margin: 0 auto; }
h1 { font-size: 1.3rem; }
.book { display: grid; grid-template-columns: 1fr auto auto auto auto; gap: 0.8rem; padding: 0.6rem; border-bottom: 1px solid #333; align-items: center; }
.book:hover { background: #252525; }
.book a { color: #8af; text-decoration: none; }
.book a:hover { text-decoration: underline; }
.cnt { font-variant-numeric: tabular-nums; }
.note { color: #aaa; font-size: 0.9rem; margin: 0.5rem 0 1rem; }
</style>
<h1>Dedup review — ${books.length} books with proposals</h1>
<p class="note">Click a book to review its proposed duplicate pairs side-by-side. Decisions are saved in your browser. Use "Copy decisions JSON" or "Download JSON" to send approvals back.</p>
<div class="book" style="border-bottom:2px solid #555;font-weight:bold">
  <div>Title</div><div class="cnt">SHA</div><div class="cnt">OCR</div><div class="cnt">Total</div><div>Live</div>
</div>
${books.map(p => {
  const sha = p.groups.filter(g => g.method === 'sha').length;
  const ocr = p.groups.filter(g => g.method === 'ocr').length;
  const dupes = p.groups.reduce((s, g) => s + g.members.length - 1, 0);
  return `<div class="book">
    <div><a href="${p.book_id}.html">${p.title || p.slug}</a> <span style="color:#666;font-size:0.8rem">(${p.pages_count}p)</span></div>
    <div class="cnt">${sha}</div>
    <div class="cnt">${ocr}</div>
    <div class="cnt">${dupes}</div>
    <div><a href="https://sourcelibrary.org/book/${p.slug}" target="_blank">↗</a></div>
  </div>`;
}).join('')}
`;
writeFileSync(resolve(OUT_DIR, 'index.html'), idxHtml);
console.log(`Wrote ${books.length} review pages to ${OUT_DIR}/`);
console.log(`Open: file://${OUT_DIR}/index.html`);
