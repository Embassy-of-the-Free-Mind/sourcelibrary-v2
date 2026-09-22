#!/usr/bin/env node
// PRIOR ART: scripts/maintenance/wikidata-artwork-crossref.mjs — also links artworks to other records,
// but resolves Wikidata QIDs onto artworks, never `source_book`; scripts/maintenance/backfill-artwork-metadata.mjs —
// writes artwork fields from Commons, no book join. Neither writes `source_book`, and nothing else does: the six
// existing rows were hand-set. This is the apply half of `scratchpad/artwork-source-links/match.mjs` (the matcher,
// #4037 Phase 1), which deliberately writes nothing.
/**
 * apply-artwork-source-links.mjs — set `books.source_book` on artworks whose stated provenance
 * resolved to a held book (#4037 Phase 1).
 *
 * ── What this writes, and why it is a public claim ─────────────────────────
 * `source_book = { id, slug, title }` is the field `ArtworkInfo` renders as the "From this
 * manuscript — read the full text with translation" card. Every row written becomes that
 * sentence on a public page, so the gate is the first-translation bar: only rows the
 * matcher put in `write_lane: clean` (identity join, readable target, volume resolved), and
 * only after Derek's OK on the #4037 comment (given 2026-09-14: "write").
 *
 * ── Provenance ─────────────────────────────────────────────────────────────
 * One `sweep_log` row per artwork (`recordSweepAction`, sweep `artwork-source-links-2026-09`)
 * carrying the proposal row — stated text, match basis, confidence, evidence — so a wrong link
 * can be traced to the statement that produced it and reverted by sweep name. No new field on
 * `books` (`source_book` is already in books-known-fields.json). Inside `source_book`, an
 * optional `stated_year` is kept when the artwork's own caption dates the plate to an edition
 * other than the one we hold (the 15 Kircher *Mundus* maps that say 1665 but link to our
 * readable 1678 copy); the card can show it, and nothing else reads it.
 *
 * ── Safety ─────────────────────────────────────────────────────────────────
 * Dry-run by default. Never overwrites an existing `source_book` (the six hand-set rows stay).
 * Re-checks at write time that the artwork is still a visible artwork and the target is still
 * visible with OCR — the proposals were made from a snapshot. Compares matchedCount to the
 * expected count and reports every skip by reason.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/apply-artwork-source-links.mjs
 *   node --env-file=.env.production.local scripts/maintenance/apply-artwork-source-links.mjs --apply
 *   node --env-file=.env.production.local scripts/maintenance/apply-artwork-source-links.mjs --revert   (by sweep name)
 */
import fs from 'node:fs';
import path from 'node:path';
import { withMongo } from '../lib/mongo.mjs';
import { recordSweepAction } from '../lib/sweep-log.mjs';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const REVERT = args.includes('--revert');
const argv = (n, d) => { const i = args.indexOf(n); return i > -1 ? args[i + 1] : d; };
const FILE = argv('--file', path.resolve('scratchpad/artwork-source-links/proposals.jsonl'));
const SWEEP = 'artwork-source-links-2026-09';

// A stated EDITION year is one that sits right after the work's title — "'Mundus Subterraneus' (1665)",
// "Dictionnaire Infernal (1863)" — not any year in the caption: a first pass caught "1514" from a
// sentence about Vesalius's birth. Only kept when it differs from the edition we link to.
const statedYear = (r) => {
  const text = String(r.stated_source_text || '');
  const m = text.match(/['’"“”]\s*\(?\s*(1[4-9]\d\d)\s*\)?/) || text.match(/\)\s*\((1[4-9]\d\d)\)/);
  const y = m ? Number(m[1]) : null;
  return y && r.book_year && y !== Number(r.book_year) ? y : null;
};
// The card prints `title`. Prefer the catalogue title over a bare shelfmark or a translated gloss
// (display_title "harley ms 4751", "Musical Treatise") when the catalogue title is the fuller name.
const cardTitle = (t, r) => {
  const dt = (t.display_title || '').trim(), ct = (t.title || '').trim();
  if (!dt) return ct || r.book_title || '';
  if (!ct) return dt;
  if (dt.length < 20 && ct.length > dt.length) return ct;
  if (/^(harley|ms\b|cod\.?|bl\b)/i.test(dt)) return ct;
  return dt;
};

await withMongo(async (db) => {
  const books = db.collection('books');

  if (REVERT) {
    const rows = await db.collection('sweep_log').find({ sweep: SWEEP, action: 'set-source-book' }).toArray();
    console.log(`revert: ${rows.length} sweep rows`);
    if (!APPLY) { console.log('dry run — pass --apply with --revert to unset'); return; }
    let n = 0;
    for (const row of rows) {
      const r = await books.updateOne({ id: row.book_id, 'source_book.id': row.detail?.book_id }, { $unset: { source_book: '' } });
      n += r.modifiedCount;
      await recordSweepAction(db, { sweep: SWEEP, book_id: row.book_id, action: 'unset-source-book', detail: { reverted_row: row._id } });
    }
    console.log(`unset ${n}`);
    return;
  }

  const rows = fs.readFileSync(FILE, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const clean = rows.filter((r) => r.write_lane === 'clean');
  console.log(`${rows.length} proposals, ${clean.length} clean, ${rows.length - clean.length} hold (skipped)`);

  const skips = {};
  const skip = (why, r) => { (skips[why] ||= []).push(r.artwork_slug); };
  const plan = [];

  const artIds = clean.map((r) => r.artwork_id);
  const bookIds = [...new Set(clean.map((r) => r.book_id))];
  const arts = new Map((await books.find({ id: { $in: artIds } }, { projection: { id: 1, content_type: 1, visible: 1, deleted: 1, source_book: 1 } }).toArray()).map((d) => [d.id, d]));
  const targets = new Map((await books.find({ id: { $in: bookIds } }, { projection: { id: 1, slug: 1, title: 1, display_title: 1, visible: 1, pages_ocr: 1, hidden: 1 } }).toArray()).map((d) => [d.id, d]));

  for (const r of clean) {
    const a = arts.get(r.artwork_id);
    const t = targets.get(r.book_id);
    if (!a) { skip('artwork not found', r); continue; }
    if (a.content_type !== 'artwork' || a.visible !== true || a.deleted === true) { skip('artwork no longer a visible artwork', r); continue; }
    if (a.source_book) { skip(a.source_book.id === r.book_id ? 'already set to this book' : 'already set to a DIFFERENT book (kept)', r); continue; }
    if (!t) { skip('target book not found', r); continue; }
    if (t.visible !== true || t.hidden === true || !(t.pages_ocr > 0)) { skip('target no longer visible with OCR', r); continue; }
    const title = cardTitle(t, r);
    const sb = { id: t.id, slug: t.slug, title };
    const y = statedYear(r);
    if (y) sb.stated_year = y;
    plan.push({ r, sb });
  }

  console.log(`\nplan: ${plan.length} writes`);
  for (const [why, list] of Object.entries(skips)) console.log(`  skip ${list.length.toString().padStart(4)}  ${why}${list.length <= 5 ? '  ' + list.join(', ') : ''}`);
  const byBook = {};
  for (const { sb } of plan) byBook[sb.title] = (byBook[sb.title] || 0) + 1;
  for (const [t, n] of Object.entries(byBook).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${t.slice(0, 70)}`);
  console.log(`  with stated_year kept: ${plan.filter((p) => p.sb.stated_year).length}`);

  if (!APPLY) { console.log('\ndry run — pass --apply to write'); return; }

  let written = 0, matched = 0;
  for (const { r, sb } of plan) {
    const res = await books.updateOne(
      { id: r.artwork_id, content_type: 'artwork', source_book: { $exists: false } },
      { $set: { source_book: sb, updated_at: new Date() } },
    );
    matched += res.matchedCount; written += res.modifiedCount;
    if (res.modifiedCount === 1) {
      await recordSweepAction(db, {
        sweep: SWEEP, book_id: r.artwork_id, action: 'set-source-book',
        detail: {
          book_id: sb.id, book_slug: sb.slug, match_basis: r.match_basis, confidence: r.confidence,
          stated_by: r.evidence?.stated_by, stated_source_text: String(r.stated_source_text || '').slice(0, 400),
          stated_year: sb.stated_year ?? null, source: 'scratchpad/artwork-source-links/proposals.jsonl', issue: 4037,
        },
      });
    }
  }
  console.log(`\nexpected ${plan.length} · matched ${matched} · modified ${written}`);
  if (written !== plan.length) console.log('MISMATCH — a row changed between plan and write; read the skips and the sweep_log before re-running');
  const now = await books.countDocuments({ content_type: 'artwork', source_book: { $exists: true } });
  console.log(`artworks with source_book now: ${now}`);
});
