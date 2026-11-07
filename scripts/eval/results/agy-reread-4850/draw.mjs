#!/usr/bin/env node
// PRIOR ART: scripts/eval/agy-ocr-per-call-6740/draw.mjs — a different frame and design; the seeded shuffle is the
// same mulberry32 every eval here uses.
/**
 * The #4850 draw (seed 4850): 30 pages, at most one per book. Strata: Greek MS 8, Latin MS 6, Latin print 6, Korean MS 2,
 * Armenian MS 2, Hebrew print 2, and 4 from the rest; Chinese skipped (it routes to PaddleOCR). A page whose stored read
 * carries no <script> tag is counted as print for Latin/Greek/Hebrew (the dry-run composition in the brief does the same).
 *   node scripts/eval/results/agy-reread-4850/draw.mjs FRAME.json OUT.json
 */
import fs from 'node:fs';
const [FRAME, OUT] = process.argv.slice(2);
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rnd = mulberry32(4850);
const shuffle = (xs) => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const stratum = (r) => {
  const ms = r.ms === '?' && ['Latin', 'Greek', 'Hebrew'].includes(r.language) ? 'print' : r.ms;
  const k = `${r.language} ${ms}`;
  if (['Greek MS', 'Latin MS', 'Latin print', 'Korean MS', 'Armenian MS', 'Hebrew print'].includes(k)) return k;
  if (r.language === 'Chinese') return null;
  return 'other';
};
const QUOTA = { 'Greek MS': 8, 'Latin MS': 6, 'Latin print': 6, 'Korean MS': 2, 'Armenian MS': 2, 'Hebrew print': 2, other: 4 };
const frame = JSON.parse(fs.readFileSync(FRAME, 'utf8')).filter((r) => r.page_id && !r.human && r.image)
  .sort((a, b) => (a.page_id < b.page_id ? -1 : 1)).map((r) => ({ ...r, stratum: stratum(r) })).filter((r) => r.stratum);
const used = new Set(), drawn = [];
for (const s of Object.keys(QUOTA)) {
  for (const r of shuffle(frame.filter((x) => x.stratum === s))) {
    if (drawn.filter((d) => d.stratum === s).length >= QUOTA[s]) break;
    if (used.has(r.book)) continue;
    used.add(r.book); drawn.push(r);
  }
}
const counts = {}; for (const r of frame) counts[r.stratum] = (counts[r.stratum] || 0) + 1;
fs.writeFileSync(OUT, JSON.stringify({ seed: 4850, frame_counts: counts, drawn }, null, 1));
console.log(JSON.stringify(counts));
for (const d of drawn) console.log(d.stratum.padEnd(13), d.book, String(d.page_number).padStart(5), d.language, d.ocr_model, d.chars);
