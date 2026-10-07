#!/usr/bin/env node
// PRIOR ART: scripts/eval/engine-contest-5870/contest.mjs (draws A5 judged pages, not refused ones);
// scripts/eval/hidden-flash-5795 (draws hidden books' pages for a Gemini re-read, which is the engine
// that refuses these); benchmark-seal.mjs (seals strata drawn from the catalogue by language × period,
// it cannot select on `ocr.recitation_blocked`). None draws from the population Gemini REFUSED.
/**
 * draw.mjs — seal the 20-page refused-English stratum for #4686 (`refused-en-4686`).
 *
 *   node --env-file=.env.production.local scripts/eval/kraken-refused-4686/draw.mjs [--write]
 *
 * Population: pages stamped `ocr.recitation_blocked: true` by the pipeline that still have no
 * `ocr.data`, in the four hidden Philosophical Transactions volumes and the two Birch volumes the
 * Drebbel collection needs (#5811). Draw: per book, eligible pages sorted by page_number, split
 * into k equal bins, one seeded pick per bin (mulberry32, seed 4686) — so the pages spread across
 * each volume. Allocation: Phil Trans 4 + 4 + 4 + 5 (vols 11–12 is the largest), Birch every
 * eligible page (3). One spare per Phil Trans book, used only to replace a drawn page with no
 * printed text (plate or blank), as the stratum registry records.
 * Excluded: vol. 4 p. 9, used for the pre-design throughput probe (Kraken was run on it once to
 * time the lane; its output was never compared with anything).
 * Read-only: Mongo reads, writes the registry JSON only with --write.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { MongoClient } from 'mongodb';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WRITE = process.argv.includes('--write');
const SEED = 4686;
const STRATUM = 'refused-en-4686';
const BOOKS = [
  { id: '6ac39a92693fbfc19e37bb27', k: 4, short: 'PT4' },
  { id: '6ac39ad74bd5d854980237ff', k: 4, short: 'PT5' },
  { id: '6ac39abdb102376559ba75ed', k: 4, short: 'PT6' },
  { id: '6ac391b421755a8abfd8e653', k: 5, short: 'PT11-12' },
  { id: '6ac2798b02c7f994f85066f6', k: 'all', short: 'Birch-I' },
  { id: '6ac2798d02c7f994f8506911', k: 'all', short: 'Birch-II' },
];
const EXCLUDE = new Set(['6ac39a92693fbfc19e37bb27:9']);

function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');
const rand = rng(SEED);
const pages = [];
for (const b of BOOKS) {
  const book = await db.collection('books').findOne({ id: b.id }, { projection: { title: 1, year: 1, language: 1, ia_identifier: 1, visible: 1, hidden: 1, hidden_reason: 1 } });
  const elig = (await db.collection('pages').find({
    book_id: b.id, page_number: { $gt: 0 }, 'ocr.recitation_blocked': true,
    $or: [{ 'ocr.data': { $exists: false } }, { 'ocr.data': '' }, { 'ocr.data': null }],
  }).project({ id: 1, page_number: 1, archived_photo: 1, display_photo: 1, photo: 1, ocr: 1 }).sort({ page_number: 1 }).toArray())
    .filter(p => !EXCLUDE.has(`${b.id}:${p.page_number}`));
  const picks = [];
  if (b.k === 'all') picks.push(...elig.map(p => ({ p, spare: false })));
  else {
    const bin = elig.length / b.k;
    for (let i = 0; i < b.k; i++) {
      const lo = Math.floor(i * bin), hi = Math.floor((i + 1) * bin);
      picks.push({ p: elig[lo + Math.floor(rand() * (hi - lo))], spare: false });
    }
    const used = new Set(picks.map(x => x.p.page_number));
    const rest = elig.filter(p => !used.has(p.page_number));
    picks.push({ p: rest[Math.floor(rand() * rest.length)], spare: true });
  }
  console.log(`${b.short}: ${elig.length} eligible → ${picks.filter(x => !x.spare).map(x => x.p.page_number).join(', ')} (spare ${picks.filter(x => x.spare).map(x => x.p.page_number).join(', ') || '—'}) · visible=${book.visible} hidden=${book.hidden} hidden_reason=${book.hidden_reason || '—'}`);
  for (const { p, spare } of picks) {
    pages.push({
      slug: `rf-${b.id}-p${p.page_number}`, book_id: b.id, page_id: p.id, page_number: p.page_number,
      substratum: `English ${book.year < 1700 ? '1600s' : '1700s'}`, book_short: b.short,
      title: book.title, year: book.year, language: 'English', provider: 'Internet Archive', ia_identifier: book.ia_identifier,
      image_url: p.archived_photo || p.display_photo || p.photo,
      gemini: { recitation_blocked: true, recitation_count: p.ocr?.recitation_count ?? null, last_recitation_at: p.ocr?.last_recitation_at ?? null },
      spare,
    });
  }
}
await client.close();
const reg = {
  stratum: STRATUM, issue: 4686, seed: SEED, sealed_at: new Date().toISOString(),
  draw_rule: 'pages with ocr.recitation_blocked:true and no ocr.data in the 4 hidden Phil Trans volumes (k = 4, 4, 4, 5 equal page-number bins, one seeded pick per bin) and every such page in the 2 Birch volumes; vol. 4 p. 9 excluded (throughput probe). See scripts/eval/kraken-refused-4686/draw.mjs.',
  max_width: null,
  n: pages.filter(p => !p.spare).length, spares: pages.filter(p => p.spare).length,
  spare_rule: 'a drawn page with no printed text (plate or blank leaf, by eye) is replaced by its book\'s spare; the replacement is recorded here (retired / promoted).',
  substrata: [{ name: 'Gemini RECITATION-refused English print', n: null, reference: 'blind by-eye full-page transcription of the leaf (model-eye, Claude), made before any engine output was read; see PREREGISTRATION-kraken-refused-4686.md' }],
  pages,
};
const out = path.join(__dirname, '..', 'benchmark', `${STRATUM}.json`);
if (WRITE) { fs.writeFileSync(out, JSON.stringify(reg, null, 2) + '\n'); console.log(`wrote ${out}`); }
else console.log(`(dry) ${reg.n} pages + ${reg.spares} spares; --write to seal`);
