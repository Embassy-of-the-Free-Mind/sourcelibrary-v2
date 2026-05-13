#!/usr/bin/env node
/**
 * Generate an HTML review page for ambiguous OCR pairs that Gemini vision
 * couldn't confirm. User clicks Accept/Reject per pair; decisions are saved
 * to localStorage. Exports a JSON the apply-approved script can consume.
 *
 * Usage:
 *   node scripts/dedup-review-queue-build.mjs
 *   open /tmp/dedup-review/queue.html
 */

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');

const queueDir = resolve(REPO_ROOT, '.claude/docs/dedup-review-queue');
const outPath = '/tmp/dedup-review/queue.html';
mkdirSync(dirname(outPath), { recursive: true });

const files = readdirSync(queueDir).filter(f => f.endsWith('.json'));
const books = files.map(f => JSON.parse(readFileSync(resolve(queueDir, f), 'utf8')));

const allPairs = [];
for (const b of books) {
  for (const it of b.items || []) allPairs.push({ book_id: b.book_id, slug: b.slug, ...it });
}

const html = `<!doctype html><meta charset=utf8><title>Ambiguous dedup review</title>
<style>
body { font-family: system-ui; background: #1a1a1a; color: #ddd; padding: 1rem; max-width: 1400px; margin: 0 auto; }
h1 { font-size: 1.2rem; }
.summary { padding: 0.5rem 0; border-bottom: 1px solid #444; margin-bottom: 1rem; color: #aaa; font-size: 0.9rem; }
.toolbar { position: sticky; top: 0; background: #1a1a1a; padding: 0.5rem 0; z-index: 10; display: flex; gap: 0.5rem; border-bottom: 1px solid #444; margin-bottom: 1rem; }
.toolbar button { padding: 0.4rem 0.8rem; background: #3a3a3a; border: 1px solid #555; color: #fff; cursor: pointer; border-radius: 4px; }
.pair { display: grid; grid-template-columns: 1fr 1fr 100px; gap: 1rem; margin: 1rem 0; padding: 1rem; background: #2a2a2a; border-radius: 8px; border: 2px solid transparent; }
.pair[data-decision=accept] { border-color: #6c6; background: #2a3a2a; }
.pair[data-decision=reject] { border-color: #c66; background: #3a2a2a; }
.pair img { width: 100%; max-height: 700px; object-fit: contain; background: #fff; cursor: zoom-in; }
.meta { font-size: 0.85rem; margin-bottom: 0.5rem; line-height: 1.4; }
.canon { color: #8f8; } .dup { color: #f88; }
.vision { background: #444; padding: 1px 5px; border-radius: 3px; font-size: 0.75rem; }
.actions button { padding: 0.6rem 0.8rem; border: 1px solid #555; cursor: pointer; border-radius: 4px; display: block; width: 100%; margin-bottom: 0.4rem; }
.acc { background: #2a4a2a; color: #afa; }
.acc[data-active], .acc:hover { background: #4a8a4a; }
.rej { background: #4a2a2a; color: #faa; }
.rej[data-active], .rej:hover { background: #8a4a4a; }
img.zoom { position: fixed; top: 2%; left: 2%; width: 96%; height: 96%; background: #fff; z-index: 100; cursor: zoom-out; padding: 1rem; max-height: none; }
.book-link { color: #8af; }
</style>
<h1>Ambiguous OCR pairs — ${allPairs.length} need your eye (${books.length} books)</h1>
<div class="summary">These pairs had OCR text ≥ 95% identical but Gemini vision said DIFFERENT or UNSURE. You decide. Click ✓ if they're really the same printed page, ✗ if different. Click images to zoom.</div>
<div class="toolbar">
  <button onclick="exportApproved()">Export approved as JSON</button>
  <span style="margin-left:1rem">accepted: <b id=accCount>0</b> · rejected: <b id=rejCount>0</b> · undecided: <b id=undCount>${allPairs.length}</b></span>
</div>
${allPairs.map((p, i) => `
<div class="pair" data-i=${i}>
  <div>
    <div class="meta canon"><a class="book-link" href="https://sourcelibrary.org/book/${p.slug}" target="_blank">${p.slug}</a> · CANON pg ${p.canon?.page_number ?? '?'} (${p.canon?.page_type ?? '?'})</div>
    <img src="${p.canon?.cropped_photo || ''}" loading="lazy" onclick="zoom(this)">
  </div>
  <div>
    <div class="meta dup">DUP pg ${p.dup?.page_number ?? '?'} (${p.dup?.page_type ?? '?'}) · <span class="vision">vision: ${p.vision?.decision || '?'}</span></div>
    <img src="${p.dup?.cropped_photo || ''}" loading="lazy" onclick="zoom(this)">
  </div>
  <div class="actions">
    <button class="acc" onclick="decide(${i},'accept')">✓ Dupe</button>
    <button class="rej" onclick="decide(${i},'reject')">✗ Different</button>
  </div>
</div>`).join('')}
<script>
const PAIRS = ${JSON.stringify(allPairs.map(p => ({ book_id: p.book_id, slug: p.slug, dup_id: p.dup_id, canon_id: p.canon_id, method: 'ocr' })))};
const KEY = 'dedup-queue-decisions';
let decisions = JSON.parse(localStorage.getItem(KEY) || '{}');

function refresh() {
  let acc=0,rej=0,und=0;
  for (let i=0;i<PAIRS.length;i++) {
    const d = decisions[i];
    const el = document.querySelector('[data-i="'+i+'"]');
    el.dataset.decision = d || '';
    el.querySelector('.acc').toggleAttribute('data-active', d === 'accept');
    el.querySelector('.rej').toggleAttribute('data-active', d === 'reject');
    if (d === 'accept') acc++; else if (d === 'reject') rej++; else und++;
  }
  document.getElementById('accCount').textContent = acc;
  document.getElementById('rejCount').textContent = rej;
  document.getElementById('undCount').textContent = und;
}
function decide(i,v) {
  decisions[i] = decisions[i] === v ? undefined : v;
  if (!decisions[i]) delete decisions[i];
  localStorage.setItem(KEY, JSON.stringify(decisions));
  refresh();
}
function exportApproved() {
  // Group accepted pairs by book_id
  const byBook = {};
  for (const [i, v] of Object.entries(decisions)) {
    if (v !== 'accept') continue;
    const p = PAIRS[i];
    if (!byBook[p.book_id]) byBook[p.book_id] = { book_id: p.book_id, decisions: [] };
    byBook[p.book_id].decisions.push({ dup_id: p.dup_id, canon_id: p.canon_id, method: 'ocr', decision: 'accept' });
  }
  const out = Object.values(byBook);
  navigator.clipboard.writeText(JSON.stringify(out, null, 2)).then(() => alert('Copied ' + out.length + ' books / ' + out.reduce((s,b)=>s+b.decisions.length,0) + ' approved decisions'));
}
function zoom(img) {
  if (img.classList.contains('zoom')) img.classList.remove('zoom');
  else { document.querySelectorAll('img.zoom').forEach(i => i.classList.remove('zoom')); img.classList.add('zoom'); }
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') document.querySelectorAll('img.zoom').forEach(i => i.classList.remove('zoom')); });
refresh();
</script>
`;
writeFileSync(outPath, html);
console.log(`Wrote: file://${outPath}`);
