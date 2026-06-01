#!/usr/bin/env node
/**
 * From the collision audit JSON (in-progress or final), sample N random
 * "SAME" verdicts and render side-by-side HTML for human spot-check.
 */
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');

const N = parseInt(process.argv[2] || '30', 10);
const audit = JSON.parse(readFileSync(resolve(REPO_ROOT, '.claude/docs/all-collision-vision-audit.json'), 'utf8'));

const samePairs = [];
for (const b of audit) {
  for (const p of b.pairs) {
    if (p.verdict === 'same') samePairs.push({ slug: b.slug, ...p });
  }
}
console.log(`Total SAME verdicts so far: ${samePairs.length}, sampling ${Math.min(N, samePairs.length)}`);

const sample = [];
const seen = new Set();
while (sample.length < Math.min(N, samePairs.length)) {
  const i = Math.floor(Math.random() * samePairs.length);
  if (seen.has(i)) continue;
  seen.add(i);
  sample.push(samePairs[i]);
}

const html = `<!doctype html><meta charset=utf8><title>Spot-check SAME collision verdicts</title>
<style>
body { font-family: system-ui; background: #1a1a1a; color: #ddd; padding: 1rem; max-width: 1500px; margin: 0 auto; }
.pair { display: grid; grid-template-columns: 1fr 1fr 80px; gap: 1rem; margin: 1rem 0; padding: 1rem; background: #2a2a2a; border-radius: 8px; }
.pair img { width: 100%; max-height: 700px; object-fit: contain; background: #fff; cursor: zoom-in; }
.meta { font-size: 0.85rem; margin-bottom: 0.5rem; color: #aaa; }
.bk { color: #8af; font-weight: bold; }
.actions button { padding: 0.6rem; border: 1px solid #555; cursor: pointer; border-radius: 4px; width: 100%; margin-bottom: 0.4rem; }
.flag { background: #4a2a2a; color: #faa; }
.flag[data-active] { background: #8a4a4a; }
img.zoom { position: fixed; top: 2%; left: 2%; width: 96%; height: 96%; background: #fff; z-index: 100; cursor: zoom-out; padding: 1rem; max-height: none; }
</style>
<h1>Spot-check: ${sample.length} random SAME-verdict pairs</h1>
<p>Gemini said both pages in each pair are the same content. If you see any that look DIFFERENT, click ⚑ Flag — I'll halt the dedup.</p>
<div>Flagged: <b id=count>0</b></div>
${sample.map((p, i) => `
<div class="pair" data-i=${i}>
  <div>
    <div class="meta"><span class="bk">${p.slug}</span> · pg ${p.page_number} · keep (earlier doc)</div>
    <img src="${p.keep_url}" loading="lazy" onclick="zoom(this)">
  </div>
  <div>
    <div class="meta">dup (later doc) — would be hidden</div>
    <img src="${p.dup_url}" loading="lazy" onclick="zoom(this)">
  </div>
  <div class="actions">
    <button class="flag" onclick="toggleFlag(${i})">⚑ Flag</button>
  </div>
</div>`).join('')}
<script>
const SAMPLE = ${JSON.stringify(sample.map(p => ({ slug: p.slug, page_number: p.page_number, dup_id: p.dup_id })))};
const flagged = new Set();
function toggleFlag(i) {
  if (flagged.has(i)) flagged.delete(i); else flagged.add(i);
  document.querySelector('[data-i="'+i+'"] .flag').toggleAttribute('data-active');
  document.getElementById('count').textContent = flagged.size;
  if (flagged.size) console.log('Flagged:', [...flagged].map(i => SAMPLE[i]));
}
function zoom(img) {
  if (img.classList.contains('zoom')) img.classList.remove('zoom');
  else { document.querySelectorAll('img.zoom').forEach(i => i.classList.remove('zoom')); img.classList.add('zoom'); }
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') document.querySelectorAll('img.zoom').forEach(i => i.classList.remove('zoom')); });
</script>
`;
const out = `/tmp/spot-check-same-${Date.now()}.html`;
writeFileSync(out, html);
console.log(`Open: file://${out}`);
