#!/usr/bin/env node
// PRIOR ART: scripts/maintenance/apply-artwork-source-links.mjs — the Phase 1 writer; it applies every
// `write_lane: clean` row of a matcher proposals file on one blanket OK, looks artworks up by `id` only, and
// writes no page. This lane needs a per-row human decision, `id`-or-`_id` lookup (visual candidates come
// from the CLIP index, which keys some artworks by `_id`), and `page_id`/`page_number` in `source_book`.
// scripts/artwork-links/build-review-queue.mjs builds a queue and writes nothing.
/**
 * apply-reviewed-links.mjs — write `books.source_book` for the artwork→book links Derek APPROVED on the
 * #4037 review page (phases 1b + 2: visual identity, volume resolution, new stated-source rows).
 *
 * A written `source_book` renders as "From this book — read the full text with translation" on the
 * public artwork page, so it is a public claim: only rows with an explicit `approve` decision are
 * written; undecided and rejected rows are not.
 *
 * Inputs
 *   --batch <review-batch.json>   the batch the review page was built from (one row per artwork, `n`,
 *                                 `artwork.id`, `proposed.{id,slug,title,page_id,page_number}`, evidence)
 *   --decisions <dir>             the review page's `decisions` collection, exported with ArtifactData
 *                                 `list` + `out_dir` (one <artwork_id>.json per decided row)
 *
 * Safety: dry-run by default. Never overwrites an existing `source_book`. Re-checks at write time that
 * the artwork is still a visible artwork and the target still visible with OCR, and that the decision
 * names the same book slug as the batch row. One `sweep_log` row per write (sweep
 * `artwork-source-links-2026-09b`); `--revert --apply` unsets by sweep name.
 *
 *   node --env-file=.env.production.local scripts/artwork-links/apply-reviewed-links.mjs --batch B --decisions D
 *   ... --apply
 *   node --env-file=.env.production.local scripts/artwork-links/apply-reviewed-links.mjs --revert [--apply]
 */
import fs from 'node:fs';
import path from 'node:path';
import { withMongo } from '../lib/mongo.mjs';
import { recordSweepAction } from '../lib/sweep-log.mjs';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const REVERT = args.includes('--revert');
const argv = (n) => { const i = args.indexOf(n); return i > -1 ? args[i + 1] : null; };
const SWEEP = 'artwork-source-links-2026-09b';

function readDecisions(dir) {
  const out = new Map();
  const walk = (d) => {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, f.name);
      if (f.isDirectory()) walk(p);
      else if (f.name.endsWith('.json')) {
        const doc = JSON.parse(fs.readFileSync(p, 'utf8'));
        const body = doc.data ?? doc;
        out.set(f.name.replace(/\.json$/, ''), body);
      }
    }
  };
  walk(dir);
  return out;
}

await withMongo(async (db) => {
  const books = db.collection('books');
  const byIdOrOid = (ids) => ({ $or: [{ id: { $in: ids } }, { _id: { $in: ids } }] });

  if (REVERT) {
    const rows = await db.collection('sweep_log').find({ sweep: SWEEP, action: 'set-source-book' }).toArray();
    console.log(`revert: ${rows.length} sweep rows`);
    if (!APPLY) { console.log('dry run — pass --apply with --revert to unset'); return; }
    let n = 0;
    for (const row of rows) {
      const r = await books.updateOne({ $or: [{ id: row.book_id }, { _id: row.book_id }], 'source_book.id': row.detail?.book_id }, { $unset: { source_book: '' } });
      n += r.modifiedCount;
      await recordSweepAction(db, { sweep: SWEEP, book_id: row.book_id, action: 'unset-source-book', detail: { reverted_row: row._id } });
    }
    console.log(`unset ${n}`);
    return;
  }

  const BATCH = argv('--batch'), DEC = argv('--decisions');
  if (!BATCH || !DEC) { console.error('need --batch <review-batch.json> and --decisions <dir>'); process.exit(1); }
  const batch = JSON.parse(fs.readFileSync(BATCH, 'utf8'));
  const decisions = readDecisions(DEC);
  const counts = { approve: 0, reject: 0, other: 0 };
  for (const d of decisions.values()) counts[d.decision === 'approve' || d.decision === 'reject' ? d.decision : 'other']++;
  console.log(`batch ${batch.length} rows · decisions ${decisions.size} (approve ${counts.approve}, reject ${counts.reject}, other ${counts.other}) · undecided ${batch.length - decisions.size}`);

  const approved = batch.filter((r) => decisions.get(r.artwork.id)?.decision === 'approve');
  const skips = {};
  const skip = (why, r) => { (skips[why] ||= []).push(`#${r.n} ${r.artwork.slug}`); };
  const artIds = approved.map((r) => r.artwork.id);
  const bookIds = [...new Set(approved.map((r) => r.proposed.id))];
  const arts = new Map();
  for (const d of await books.find(byIdOrOid(artIds), { projection: { id: 1, content_type: 1, visible: 1, deleted: 1, source_book: 1 } }).toArray()) {
    if (d.id) arts.set(String(d.id), d); arts.set(String(d._id), d);
  }
  const targets = new Map();
  for (const d of await books.find(byIdOrOid(bookIds), { projection: { id: 1, slug: 1, title: 1, display_title: 1, visible: 1, pages_ocr: 1, hidden: 1 } }).toArray()) {
    if (d.id) targets.set(String(d.id), d); targets.set(String(d._id), d);
  }

  const plan = [];
  for (const r of approved) {
    const dec = decisions.get(r.artwork.id);
    const a = arts.get(r.artwork.id), t = targets.get(r.proposed.id);
    if (dec.book_slug && dec.book_slug !== r.proposed.slug) { skip('decision names a different book than the batch row', r); continue; }
    if (!a) { skip('artwork not found', r); continue; }
    if (a.content_type !== 'artwork' || a.visible !== true || a.deleted === true) { skip('artwork no longer a visible artwork', r); continue; }
    if (a.source_book) { skip(String(a.source_book.id) === String(t?.id || r.proposed.id) ? 'already set to this book' : 'already set to a DIFFERENT book (kept)', r); continue; }
    if (!t) { skip('target book not found', r); continue; }
    if (t.visible !== true || t.hidden === true || !(t.pages_ocr > 0)) { skip('target no longer visible with OCR', r); continue; }
    const sb = { id: t.id || String(t._id), slug: t.slug, title: r.proposed.title || t.display_title || t.title };
    if (r.proposed.page_id) sb.page_id = r.proposed.page_id;
    if (r.proposed.page_number != null) sb.page_number = r.proposed.page_number;
    plan.push({ r, a, sb });
  }

  console.log(`\nplan: ${plan.length} writes`);
  for (const [why, list] of Object.entries(skips)) console.log(`  skip ${String(list.length).padStart(4)}  ${why}${list.length <= 5 ? '  ' + list.join(', ') : ''}`);
  const byBook = {};
  for (const { sb } of plan) byBook[sb.slug] = (byBook[sb.slug] || 0) + 1;
  for (const [s, n] of Object.entries(byBook).sort((x, y) => y[1] - x[1])) console.log(`  ${String(n).padStart(4)}  ${s}`);
  if (!APPLY) { console.log('\ndry run — pass --apply to write'); return; }

  let written = 0, matched = 0;
  for (const { r, a, sb } of plan) {
    const res = await books.updateOne(
      { _id: a._id, content_type: 'artwork', source_book: { $exists: false } },
      { $set: { source_book: sb, updated_at: new Date() } },
    );
    matched += res.matchedCount; written += res.modifiedCount;
    if (res.modifiedCount === 1) {
      await recordSweepAction(db, {
        sweep: SWEEP, book_id: a.id || String(a._id), action: 'set-source-book',
        detail: {
          book_id: sb.id, book_slug: sb.slug, page_id: sb.page_id ?? null, page_number: sb.page_number ?? null,
          lane: r.lane, row: r.n, similarity: r.sim ?? null, comparison: r.why ?? null, agreement: r.agree, flags: r.flags,
          crop: r.crop ?? null, reviewed_by: 'Derek (review page decision)', issue: 4037,
        },
      });
    }
  }
  console.log(`\nexpected ${plan.length} · matched ${matched} · modified ${written}`);
  if (written !== plan.length) console.log('MISMATCH — a row changed between plan and write; read the skips and the sweep_log before re-running');
  console.log(`artworks with source_book now: ${await books.countDocuments({ content_type: 'artwork', source_book: { $exists: true } })}`);
});
