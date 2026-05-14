#!/usr/bin/env node
/**
 * Generate a random sample HTML page for spot-checking auto-applied dedup pairs.
 * Samples from ALL `dedup-reviewed-*.json` snapshots: pulls accepted pairs,
 * pulls their current image URLs from DB, renders side-by-side.
 *
 * Default sample: 20 pairs (skewed toward OCR-method since SHA matches are
 * trivially correct).
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/dedup-sample-review.mjs           # 20 pairs (default mix)
 *   node scripts/dedup-sample-review.mjs --ocr     # 20 OCR-only pairs
 *   node scripts/dedup-sample-review.mjs --n 50    # custom count
 */

import { MongoClient, ObjectId } from 'mongodb';
import { readdirSync, readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');

const args = process.argv.slice(2);
const N = parseInt(args[args.indexOf('--n') + 1] || '20', 10);
const OCR_ONLY = args.includes('--ocr');

const snapDir = resolve(REPO_ROOT, '.claude/docs/snapshots');
const files = readdirSync(snapDir).filter(f => f.startsWith('dedup-reviewed-') && f.endsWith('.json'));

const allPairs = [];
for (const f of files) {
  const s = JSON.parse(readFileSync(resolve(snapDir, f), 'utf8'));
  for (const d of s.decisions_in || []) {
    if (OCR_ONLY && d.method !== 'ocr') continue;
    allPairs.push({ book_id: s.book_id, slug: s.slug, ...d });
  }
}
console.log(`Total ${OCR_ONLY ? 'OCR' : ''} pairs across ${files.length} snapshots: ${allPairs.length}`);

// Random sample
const sample = [];
const seen = new Set();
while (sample.length < Math.min(N, allPairs.length)) {
  const i = Math.floor(Math.random() * allPairs.length);
  if (seen.has(i)) continue;
  seen.add(i);
  sample.push(allPairs[i]);
}

const c = new MongoClient(process.env.MONGODB_URI);
await c.connect();
const db = c.db('bookstore');

const rows = [];
for (const p of sample) {
  const [dup, canon] = await Promise.all([
    db.collection('pages').findOne({ _id: new ObjectId(p.dup_id) }, { projection: { page_number: 1, original_page_number: 1, page_type: 1, cropped_photo: 1, archived_photo: 1, photo: 1 } }),
    db.collection('pages').findOne({ _id: new ObjectId(p.canon_id) }, { projection: { page_number: 1, original_page_number: 1, page_type: 1, cropped_photo: 1, archived_photo: 1, photo: 1 } }),
  ]);
  rows.push({ ...p, dup, canon });
}
await c.close();

const html = `<!doctype html><meta charset=utf8><title>Dedup sample review</title>
<style>
body { font-family: system-ui; background: #1a1a1a; color: #ddd; padding: 1rem; max-width: 1400px; margin: 0 auto; }
h1 { font-size: 1.1rem; }
.summary { padding: 0.5rem 0; border-bottom: 1px solid #444; margin-bottom: 1rem; color: #aaa; font-size: 0.9rem; }
.pair { display: grid; grid-template-columns: 1fr 1fr 90px; gap: 1rem; margin: 1rem 0; padding: 1rem; background: #2a2a2a; border-radius: 8px; }
.pair img { width: 100%; max-height: 700px; object-fit: contain; background: #fff; }
.meta { font-size: 0.85rem; margin-bottom: 0.5rem; line-height: 1.4; }
.canon { color: #8f8; } .dup { color: #f88; }
.method-sha { background: #163; color: #afa; padding: 1px 5px; border-radius: 3px; font-size: 0.75rem; }
.method-ocr { background: #346; color: #cdf; padding: 1px 5px; border-radius: 3px; font-size: 0.75rem; }
.book-link { color: #8af; }
.actions { display: flex; flex-direction: column; gap: 0.4rem; }
.actions button { padding: 0.5rem; border: 1px solid #555; background: #3a3a3a; color: #fff; cursor: pointer; border-radius: 4px; }
.actions button.flag { background: #4a2a2a; color: #faa; }
.actions button[data-active] { background: #8a4a4a; }
img.zoom { position: fixed; top: 2%; left: 2%; width: 96%; height: 96%; background: #fff; z-index: 100; cursor: zoom-out; padding: 1rem; max-height: none; }
</style>
<h1>Dedup sample review — ${rows.length} random pairs ${OCR_ONLY ? '(OCR only)' : ''}</h1>
<div class="summary">If any pair looks WRONG, click "Flag" → I'll halt Phase 2 and re-evaluate. Click images to zoom.</div>
${rows.map((r, i) => `
<div class="pair" data-i=${i}>
  <div>
    <div class="meta canon">CANON <a class="book-link" href="https://sourcelibrary.org/book/${r.slug}?page=${r.canon?.page_number || ''}" target="_blank">${r.slug}</a> · pg ${r.canon?.page_number ?? '?'} · ${r.canon?.page_type ?? '?'}</div>
    <img src="${r.canon?.cropped_photo || r.canon?.photo || ''}" loading="lazy" onclick="zoom(this)">
  </div>
  <div>
    <div class="meta dup">DUP pg ${r.dup?.original_page_number ?? r.dup?.page_number ?? '?'} · ${r.dup?.page_type ?? '?'} · <span class="method-${r.method}">${r.method.toUpperCase()}${r.vision?.decision ? ' · vision:'+r.vision.decision : ''}</span></div>
    <img src="${r.dup?.cropped_photo || r.dup?.photo || ''}" loading="lazy" onclick="zoom(this)">
  </div>
  <div class="actions">
    <button class="flag" onclick="flag(${i})">⚑ Flag</button>
  </div>
</div>`).join('')}
<script>
const SAMPLE = ${JSON.stringify(rows.map(r => ({ book_id: r.book_id, slug: r.slug, method: r.method, dup_id: r.dup_id, canon_id: r.canon_id })))};
const flagged = JSON.parse(localStorage.getItem('dedup-flagged') || '[]');
function flag(i) {
  const idx = flagged.findIndex(f => f.dup_id === SAMPLE[i].dup_id);
  if (idx >= 0) flagged.splice(idx, 1); else flagged.push(SAMPLE[i]);
  localStorage.setItem('dedup-flagged', JSON.stringify(flagged));
  document.querySelector('[data-i="'+i+'"] .flag').toggleAttribute('data-active');
  console.log('flagged:', flagged.length);
}
function zoom(img) {
  if (img.classList.contains('zoom')) img.classList.remove('zoom');
  else { document.querySelectorAll('img.zoom').forEach(i => i.classList.remove('zoom')); img.classList.add('zoom'); }
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') document.querySelectorAll('img.zoom').forEach(i => i.classList.remove('zoom')); });
// On exit hint to copy flagged list
window.addEventListener('beforeunload', e => { if (flagged.length) console.log('Flagged pairs:', JSON.stringify(flagged, null, 2)); });
console.log('Tip: when done, run "JSON.stringify(JSON.parse(localStorage.getItem(\\'dedup-flagged\\')))" in console to copy flags');
</script>
`;

const outPath = `/tmp/dedup-sample-${OCR_ONLY ? 'ocr-' : ''}${Date.now()}.html`;
writeFileSync(outPath, html);
console.log(`Wrote: file://${outPath}`);
