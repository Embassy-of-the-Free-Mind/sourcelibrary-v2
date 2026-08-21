#!/usr/bin/env node
/**
 * keeper-choice-triage — #3730 §3: pre-classify the both-visible same-edition
 * clusters so choosing a keeper costs minutes.
 *
 * A "both-visible cluster" is 2+ visible books sharing one FULL-quality
 * edition_key — the same printing shown to readers twice. Resolving one means
 * hiding the loser with a duplicate_of pointer, which is a VISIBILITY change:
 * this script therefore recommends and never writes. Measured 2026-08-09:
 * 311 clusters / 662 books, mostly pairs; 308 clusters carry translation on
 * at least one member, so a careless choice throws away paid work.
 *
 * Buckets:
 *   SUSPECT_NOT_SAME  member page counts diverge (min/max < 0.85) — a 33-page
 *                     and a 5-page "copy" are not the same object. Likely an
 *                     edition-key collision (missing volume markers, partial
 *                     scans, sammelband parts). Recommend NOTHING; these are
 *                     candidates for key-level investigation, not hiding.
 *   MECHANICAL_KEEP   one member weakly dominates on every signal (pages,
 *                     OCR'd pages, translated pages, quality score) — keeping
 *                     it loses nothing that the other has.
 *   SCORED_KEEP       trade-offs exist; a weighted score (translation 3x,
 *                     OCR 1x, pages 0.5x) picks a leader by a >=10% margin.
 *                     The margin and both members' signals print so the
 *                     recommendation is checkable at a glance.
 *   TOSSUP            leader margin < 10% — either copy serves readers; human
 *                     picks (or leaves both, which costs nothing but tidiness).
 *
 * FT guard: if a non-recommended member carries is_first_translation, the
 * cluster is flagged — hiding a badge-holder has public-claim consequences
 * and always needs a human eye regardless of bucket.
 *
 *   set -a; source .env.production.local; set +a
 *   node scripts/audit/keeper-choice-triage.mjs [--json]
 */
import { MongoClient } from 'mongodb';
import fs from 'node:fs';
import path from 'node:path';

const JSON_OUT = process.argv.includes('--json');
const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db(process.env.MONGODB_DB || 'bookstore');

const clusters = await db.collection('books').aggregate([
  { $match: { visible: true, pages_count: { $gt: 0 }, edition_key: { $nin: [null, ''] }, edition_key_quality: 'full', content_type: { $ne: 'artwork' } } },
  { $group: { _id: '$edition_key', n: { $sum: 1 }, members: { $push: {
    id: '$id', slug: '$slug', title: '$title', pages: '$pages_count',
    ocr: { $ifNull: ['$pages_ocr', 0] }, trans: { $ifNull: ['$pages_translated', 0] },
    provider: '$image_source.provider', quality: { $ifNull: ['$quality_score', 0] },
    ft: { $ifNull: ['$is_first_translation', false] },
  } } } },
  { $match: { n: { $gt: 1 } } },
]).toArray();

const score = (m) => m.trans * 3 + m.ocr * 1 + m.pages * 0.5;
const dominates = (a, b) =>
  a.pages >= b.pages && a.ocr >= b.ocr && a.trans >= b.trans && a.quality >= b.quality &&
  (a.pages > b.pages || a.ocr > b.ocr || a.trans > b.trans || a.quality > b.quality);

const out = [];
for (const cl of clusters) {
  const ms = [...cl.members].sort((a, b) => score(b) - score(a));
  const pages = ms.map((m) => m.pages).sort((a, b) => a - b);
  const ratio = pages[0] / pages[pages.length - 1];
  let bucket, keeper = null, margin = null;
  if (ratio < 0.85) {
    bucket = 'SUSPECT_NOT_SAME';
  } else if (ms.slice(1).every((m) => dominates(ms[0], m))) {
    bucket = 'MECHANICAL_KEEP'; keeper = ms[0].id;
  } else {
    const s0 = score(ms[0]), s1 = score(ms[1]);
    margin = s1 === 0 ? 1 : (s0 - s1) / Math.max(s0, 1);
    if (margin >= 0.1) { bucket = 'SCORED_KEEP'; keeper = ms[0].id; }
    else bucket = 'TOSSUP';
  }
  const ftLosers = ms.filter((m) => m.ft && m.id !== keeper);
  out.push({
    bucket, edition_key: cl._id, keeper, margin: margin == null ? null : +margin.toFixed(2),
    page_ratio: +ratio.toFixed(2),
    ft_flag: keeper != null && ftLosers.length > 0,
    members: ms.map((m) => ({ id: m.id, pages: m.pages, ocr: m.ocr, trans: m.trans, quality: m.quality, provider: m.provider || null, ft: m.ft })),
  });
}

const order = ['MECHANICAL_KEEP', 'SCORED_KEEP', 'TOSSUP', 'SUSPECT_NOT_SAME'];
const stamp = new Date().toISOString().slice(0, 10);
const summary = order.map((b) => ({ bucket: b, clusters: out.filter((o) => o.bucket === b).length,
  books: out.filter((o) => o.bucket === b).reduce((s, o) => s + o.members.length, 0) }));
const ftFlagged = out.filter((o) => o.ft_flag).length;

const outDir = path.join(process.cwd(), 'scripts', 'output');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, `keeper-choice-triage-${stamp}.json`);
fs.writeFileSync(outPath, JSON.stringify({ generated: new Date().toISOString(), totals: { clusters: out.length }, summary, ft_flagged: ftFlagged, clusters: out }, null, 1));

if (JSON_OUT) {
  console.log(JSON.stringify({ totals: { clusters: out.length }, summary, ft_flagged: ftFlagged }, null, 2));
} else {
  console.log(`keeper-choice triage — ${stamp}: ${out.length} both-visible full-quality edition clusters`);
  for (const s of summary) console.log(`  ${s.bucket.padEnd(17)} ${String(s.clusters).padStart(4)} clusters  ${String(s.books).padStart(4)} books`);
  console.log(`  FT-flagged (a non-keeper carries a first-translation badge): ${ftFlagged} — always human`);
  console.log(`\n  nothing here writes anything; hiding a loser is a visibility change and needs sign-off.`);
  console.log(`  sample recommendations:`);
  for (const b of order) {
    for (const o of out.filter((x) => x.bucket === b).slice(0, 3)) {
      const desc = o.members.map((m) => `${m.id.slice(-6)}[p${m.pages} o${m.ocr} t${m.trans}${m.ft ? ' FT' : ''}]`).join(' vs ');
      console.log(`   [${b}] ${o.edition_key.slice(0, 48)} — ${desc}${o.keeper ? ` -> keep …${o.keeper.slice(-6)}` : ''}${o.ft_flag ? '  ⚠ FT' : ''}`);
    }
  }
  console.log(`\n  full detail: ${outPath}`);
}
await client.close();
