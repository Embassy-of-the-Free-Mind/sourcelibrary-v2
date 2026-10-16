#!/usr/bin/env node
// PRIOR ART: scripts/audit/translation-leaf-shift.mjs — the book-level detector; it judges a whole
// book with both neighbours of every page in hand. This measures the WRITE-TIME gate
// (blockLeafShiftRuns in scripts/lib/leaf-shift.mjs), which sees one 8-page block and nothing past
// its edges, so its recall and its false alarms have to be measured on blocks, not books.
/**
 * leaf-shift-gate-controls-5021 — positive and false-alarm controls for the block gate (#5021).
 * $0 and read-only: Mongo reads, no model, no writes.
 *
 *   positive     the 12 pages withheld on 2026-10-13 as wrong-leaf English (each read against its
 *                scan). Their English is rebuilt from page_revisions as it stood before the
 *                withhold (--as-of), and every 8-page block alignment that contains the page is
 *                run through the gate. A page counts as caught when the gate rejects the block.
 *   false-alarm  translated books whose pages all came from the single-page lane (prompt v1-v6),
 *                which cannot put one leaf's text on another. Every such book's pages are cut into
 *                8-page blocks at page 1 and run through the gate; any rejection is a false alarm.
 *
 * Usage: node --env-file=.env.production.local scripts/audit/leaf-shift-gate-controls-5021.mjs
 *          [--as-of 2026-10-13T15:45:00Z] [--books 300] [--seed 5021] [--out <file.json>]
 */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
import { blockLeafShiftRuns } from '../lib/leaf-shift.mjs';

const BLOCK = 8;
const argv = process.argv.slice(2);
const arg = (n, d = null) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const AS_OF = new Date(arg('--as-of', '2026-10-13T15:45:00Z'));

/** The 12 wrong-leaf pages confirmed by eye on #5021 (2026-10-13). */
export const POSITIVES = [
  ['6a2441500f0e4f405e6389db', 12], ['6a43a5f0c3ccb765a98447bc', 30], ['69a5f046b29703bc86eb5323', 136],
  ['69ee9196b713c277fb8211d3', 109], ['69afd049ae982b9d51d6dd32', 351], ['69d7e0bce9e5e67989c3600d', 2443],
  ['69c8a2e26c6f3cc53c85e51f', 314], ['69b2f4a2f9f1ad2b3b1548b3', 1423], ['69c808636c6f3cc53c845d1a', 630],
  ['69c815276c6f3cc53c8484be', 129], ['6a2199594b61907ea5ffb864', 110], ['6a0853d249638a50931bded0', 26],
];

const toBlock = (pages) => ({ pages: pages.map(p => ({ page_number: p.page_number, ocr: { data: p.ocr?.data || '' } })), tr: new Map(pages.map(p => [p.page_number, p.translation?.data || ''])) });

async function pagesAsOf(db, bookId, lo, hi, asOf) {
  const pages = await db.collection('pages').find({ book_id: bookId, page_number: { $gte: lo, $lte: hi } }, { projection: { id: 1, page_number: 1, 'ocr.data': 1, 'translation.data': 1 } }).sort({ page_number: 1 }).toArray();
  const revs = await db.collection('page_revisions').find({ page_id: { $in: pages.map(p => p.id || String(p._id)) }, field: 'translation', created_at: { $gt: asOf } }, { projection: { page_id: 1, data: 1, created_at: 1 } }).sort({ created_at: 1 }).toArray();
  const first = new Map();
  for (const r of revs) if (!first.has(r.page_id)) first.set(r.page_id, r);
  // A revision row holds the value it REPLACED, so the first one after as-of is the text as-of.
  for (const p of pages) { const r = first.get(p.id || String(p._id)); if (r && typeof r.data === 'string') p.translation = { data: r.data }; }
  return pages;
}

function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const client = await MongoClient.connect(process.env.MONGODB_URI, { readPreference: 'secondaryPreferred' });
const db = client.db('bookstore');
const out = { as_of: AS_OF.toISOString(), positive: [], falseAlarm: null };
try {
  for (const [bookId, pn] of POSITIVES) {
    const pages = await pagesAsOf(db, bookId, pn - BLOCK, pn + BLOCK, AS_OF);
    let caught = 0, alignments = 0;
    for (let start = pn - BLOCK + 1; start <= pn; start++) {
      const win = pages.filter(p => p.page_number >= start && p.page_number < start + BLOCK);
      if (!win.some(p => p.page_number === pn)) continue;
      alignments++;
      const { pages: bp, tr } = toBlock(win);
      if (blockLeafShiftRuns(bp, tr).length) caught++;
    }
    out.positive.push({ book_id: bookId, page: pn, alignments, caught });
    console.log(`positive ${bookId} p.${pn}: caught in ${caught}/${alignments} block alignments`);
  }

  // False alarm: books translated only by the single-page lane.
  const N = Number(arg('--books', '300'));
  const cand = await db.collection('books').find({ pages_translated: { $gte: BLOCK } }, { projection: { id: 1 } }).toArray();
  const rnd = mulberry32(Number(arg('--seed', '5021')));
  for (let i = cand.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [cand[i], cand[j]] = [cand[j], cand[i]]; }
  let books = 0, blocks = 0, flagged = 0, tried = 0; const hits = [];
  for (const b of cand) {
    if (books >= N || tried > N * 40) break;
    tried++;
    const bookId = b.id || String(b._id);
    const pages = await db.collection('pages').find({ book_id: bookId }, { projection: { page_number: 1, 'ocr.data': 1, 'translation.data': 1, 'translation.prompt_version': 1 } }).sort({ page_number: 1 }).toArray();
    const tr = pages.filter(p => p.translation?.data);
    if (!tr.length || !tr.every(p => /^v?[1-6]$/i.test(String(p.translation.prompt_version ?? '')))) continue;
    books++;
    for (let i = 0; i < pages.length; i += BLOCK) {
      const win = pages.slice(i, i + BLOCK);
      if (win.filter(p => p.translation?.data).length < 2) continue;
      blocks++;
      const { pages: bp, tr: m } = toBlock(win);
      const runs = blockLeafShiftRuns(bp, m);
      if (runs.length) { flagged++; hits.push({ book_id: bookId, block: `${win[0].page_number}-${win[win.length - 1].page_number}`, runs: runs.map(r => ({ dir: r.dir, start: r.start, end: r.end, strong: r.strong })) }); }
    }
  }
  out.falseAlarm = { books, blocks, flagged, strong: hits.filter(h => h.runs.some(r => r.strong)).length, rate: blocks ? flagged / blocks : null, hits };
  console.log(`false-alarm: ${books} single-page-lane books, ${blocks} blocks, ${flagged} rejected (${hits.filter(h => h.runs.some(r => r.strong)).length} strong)`);
  if (arg('--out')) fs.writeFileSync(arg('--out'), JSON.stringify(out, null, 2));
} finally {
  await client.close();
}
