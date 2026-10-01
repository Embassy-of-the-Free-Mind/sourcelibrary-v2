#!/usr/bin/env node
// PRIOR ART: scripts/workers/pipeline-orchestrator.mjs Phase 1.95 and src/lib/warehouse.ts
// promoteFromWarehouse() — both promote a warehouse book, but neither lands it hidden, neither holds
// it out of the paid lanes (a promoted `archive_complete` book flows straight into Phase 2 OCR), and
// neither checks R2 keys; Phase 1.95 also selects only `archive_complete`, which is exactly why these
// 2,440 `archiving` books were never promoted. scripts/lib/acquire-book.mjs acquisitionGate() is the
// dedupe gate, not used directly because it searches books_warehouse too (every candidate would
// match itself) and writes a dedup_skips row per call; its tiers are mirrored here, books-only.
//
// promote-warehouse-only-5470 — move the books that exist ONLY in `books_warehouse` (and their
// `pages_warehouse` docs) into `books` / `pages`, hidden and held (#5470).
//
// Per book, in this order:
//   1. Refuse if `books` already holds it (by id OR _id), or it is in `deleted_books` (a deliberate
//      delete is not undone by a migration).
//   2. Dedupe against `books` only (fingerprint set, edition_key prefix with year/volume veto,
//      IIIF manifest). Matches are REPORTED, never acted on — the book lands hidden either way.
//   3. Insert the book: retired fields stripped (#4858), publication hidden/curation via the
//      publication writer's initialPublication() (#5340), and the pipeline hold marker written IN
//      THE SAME insert (status `held`, held_from_status = its warehouse status) so there is no window
//      in which a paid lane can select it. book_events + audit_log rows as holdBook() writes them.
//   4. Copy pages with their `_id`/`id` preserved. `tenant_id` dropped (retired). Any image URL that
//      fails isBookScopedUrl() — the #3362 `archived/undefined/N.jpg` key — is DROPPED from the page
//      (with its archive_metadata) and its value logged: that object is another book's page.
//   5. Verify `pages` holds exactly the warehouse page count for the book, recompute
//      `pages_archived` from the scoped URLs, then mark the warehouse copy promoted (existing
//      convention: promoted_to/promoted_at).
//
// Every book writes one JSONL checkpoint line (before/after) to --log; a re-run skips books already
// complete and finishes partially-copied ones. Nothing is deleted from the warehouse.
//
//   node --env-file=.env.production.local scripts/maintenance/promote-warehouse-only-5470.mjs --limit 20            # dry run
//   node --env-file=.env.production.local scripts/maintenance/promote-warehouse-only-5470.mjs --limit 20 --apply
//   node --env-file=.env.production.local scripts/maintenance/promote-warehouse-only-5470.mjs --apply               # all

import fs from 'fs';
import { MongoClient } from 'mongodb';
import { initialPublication } from '../lib/publication.mjs';
import { HOLD_STATUS, HOLD_EVENT } from '../lib/pipeline-hold.mjs';
import { isBookScopedUrl } from '../lib/r2-key.mjs';
import { computeIdentityFields, buildEditionKey } from '../lib/identity-fields.mjs';
import { sourceFingerprints, sourceFingerprint } from '../lib/source-fingerprints.mjs';
import { recordSweepAction } from '../lib/sweep-log.mjs';

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n, d) => { const a = args.find((x) => x.startsWith(`--${n}=`)); return a ? a.split('=').slice(1).join('=') : d; };
const APPLY = flag('apply');
const LIMIT = parseInt(opt('limit', '0'), 10) || 0;
const IDS = opt('ids', '') ? opt('ids', '').split(',') : null;
const LOG = opt('log', `scripts/output/retire-warehouse/promote-${APPLY ? 'apply' : 'dryrun'}-${new Date().toISOString().slice(0, 19).replace(/:/g, '')}.jsonl`);
const SWEEP = 'retire-warehouse-5470';
const BY = 'script:promote-warehouse-only-5470';
const ISSUE = 5470;
const HOLD_REASON = 'warehouse-promotion-5470';
const HOLD_RELEASE = 'A human decides to process this promoted warehouse book: rights screen and QA done (#5470). Promotion was not a decision to OCR it.';
const PUB_NOTE = 'promoted from books_warehouse (#5470); stays hidden until a rights screen + QA decision';
const IMAGE_FIELDS = ['archived_photo', 'display_photo', 'thumbnail', 'cropped_photo', 'photo', 'photo_original'];
const PAGE_BATCH = 1000;

const RETIRED_BOOK_FIELDS = JSON.parse(fs.readFileSync(new URL('../lib/books-known-fields.json', import.meta.url), 'utf8')).retired;
const RETIRED_PAGE_FIELDS = ['tenant_id'];

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function dedupeAgainstLive(db, book) {
  const B = db.collection('books');
  const proj = { id: 1, title: 1, visible: 1, pages_count: 1, edition_key: 1 };
  const out = [];
  const push = (tier, d) => { if (!out.some((m) => m.book_id === d.id)) out.push({ tier, book_id: d.id, title: String(d.title || '').slice(0, 80), visible: d.visible === true, pages_count: d.pages_count ?? null }); };
  const fps = [...new Set([...sourceFingerprints(book), ...(sourceFingerprint(book) ? [sourceFingerprint(book)] : [])])];
  if (fps.length) for (const d of await B.find({ $or: [{ source_fingerprint: { $in: fps } }, { source_fingerprints: { $in: fps } }] }, { projection: proj }).limit(10).toArray()) push('source_fingerprint', d);
  const ek = buildEditionKey(book);
  if (ek.key) {
    const { title, author, year, volume } = ek.parts;
    for (const d of await B.find({ edition_key: new RegExp(`^${escapeRegex(`${title}|${author}|`)}`) }, { projection: proj }).limit(25).toArray()) {
      const segs = String(d.edition_key || '').split('|');
      if (segs.length < 3) continue;
      const y = segs[segs.length - 2] === '' ? null : parseInt(segs[segs.length - 2], 10);
      const v = segs[segs.length - 1] === 'v' ? null : parseInt(segs[segs.length - 1].slice(1), 10);
      if (year != null && y != null && year !== y) continue;
      if (volume != null && v != null && volume !== v) continue;
      push('edition_key', d);
    }
  }
  const manifest = book.image_source?.iiif_manifest;
  if (manifest) for (const d of await B.find({ 'image_source.iiif_manifest': manifest }, { projection: proj }).limit(5).toArray()) push('iiif_manifest', d);
  return out;
}

async function freeSlug(db, slug, id) {
  if (!slug) return slug;
  const B = db.collection('books');
  if (!(await B.findOne({ slug, id: { $ne: id } }, { projection: { _id: 1 } }))) return slug;
  for (let n = 2; n < 200; n++) {
    const s = `${slug}-${n}`;
    if (!(await B.findOne({ slug: s }, { projection: { _id: 1 } }))) return s;
  }
  throw new Error(`no free slug for ${slug}`);
}

function transformPage(p) {
  const page = { ...p };
  const removed = {};
  for (const f of RETIRED_PAGE_FIELDS) if (f in page) { removed[f] = page[f]; delete page[f]; }
  const poisoned = {};
  for (const f of IMAGE_FIELDS) {
    if (typeof page[f] === 'string' && !isBookScopedUrl(page[f], page.book_id)) {
      poisoned[f] = page[f];
      delete page[f];
      if (f === 'archived_photo' && page.archive_metadata) { poisoned.archive_metadata = page.archive_metadata; delete page.archive_metadata; }
    }
  }
  return { page, removed, poisoned: Object.keys(poisoned).length ? poisoned : null };
}

function buildBook(wh, now, slug) {
  const book = { ...wh };
  const removed = {};
  for (const f of RETIRED_BOOK_FIELDS) if (f in book) { removed[f] = book[f]; delete book[f]; }
  delete book.promoted_to; delete book.promoted_at;
  const before = { visible: wh.visible, hidden: wh.hidden, hidden_reason: wh.hidden_reason ?? null, publication: wh.publication ?? null, pipeline_status: wh.pipeline_auto?.status ?? null, slug: wh.slug };
  delete book.visible; delete book.hidden; delete book.hidden_reason; delete book.hidden_at; delete book.publication;
  const note = before.hidden_reason ? `${PUB_NOTE}; warehouse hidden_reason was: ${before.hidden_reason}` : PUB_NOTE;
  Object.assign(book, initialPublication({ state: 'hidden', reason: 'curation', note, by: BY, issue: ISSUE, now }));
  const from = wh.pipeline_auto?.status ?? null;
  book.pipeline_auto = {
    ...(wh.pipeline_auto || {}),
    status: HOLD_STATUS,
    hold: { reason: HOLD_REASON, issue: ISSUE, held_at: now, held_from_status: from, release: HOLD_RELEASE, detail: null },
    last_updated: now,
  };
  const identity = computeIdentityFields(book);
  const identityFilled = [];
  for (const [k, v] of Object.entries(identity)) if (book[k] === undefined && v !== null && v !== '') { book[k] = v; identityFilled.push(k); }
  book.slug = slug;
  book.updated_at = now;
  return { book, removed, before, identityFilled };
}

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const W = db.collection('books_warehouse'), PW = db.collection('pages_warehouse');
  const B = db.collection('books'), P = db.collection('pages');
  fs.mkdirSync('scripts/output/retire-warehouse', { recursive: true });
  const log = fs.createWriteStream(LOG, { flags: 'a' });
  const poisonLog = fs.createWriteStream(LOG.replace(/\.jsonl$/, '.poisoned-urls.jsonl'), { flags: 'a' });

  // The population: warehouse rows with no `books` row under id. Recomputed every run.
  const match = IDS ? { id: { $in: IDS } } : {};
  const candidates = await W.aggregate([
    { $match: match },
    { $lookup: { from: 'books', localField: 'id', foreignField: 'id', as: 'live', pipeline: [{ $project: { _id: 1 } }] } },
    { $match: { live: { $size: 0 } } },
    { $project: { id: 1 } },
    { $sort: { id: 1 } },
  ], { allowDiskUse: true }).toArray();
  // A partially-copied book (book row written, pages incomplete) has a live row, so include
  // books this sweep already wrote whose warehouse copy is not yet marked promoted.
  const partial = await B.find({ 'pipeline_auto.hold.reason': HOLD_REASON, ...(IDS ? { id: { $in: IDS } } : {}) }, { projection: { id: 1 } }).toArray();
  const partialIds = new Set();
  for (const p of partial) {
    const w = await W.findOne({ id: p.id }, { projection: { promoted_to: 1 } });
    if (w && w.promoted_to !== 'live') partialIds.add(p.id);
  }
  let ids = [...new Set([...partialIds, ...candidates.map((c) => c.id)])];
  if (LIMIT) ids = ids.slice(0, LIMIT);
  console.log(`[promote] ${APPLY ? 'APPLY' : 'DRY RUN'} — ${candidates.length} warehouse-only + ${partialIds.size} partial; processing ${ids.length}. log: ${LOG}`);

  const tally = { promoted: 0, resumed: 0, refused_deleted: 0, refused_live_by_id: 0, pages: 0, poisoned_pages: 0, dedup_matched: 0, errors: 0 };
  for (const id of ids) {
    const t0 = Date.now();
    const rec = { book_id: id, at: new Date().toISOString(), apply: APPLY };
    try {
      const wh = await W.findOne({ id });
      rec.title = String(wh.title || '').slice(0, 120);
      rec.warehouse_pages = await PW.countDocuments({ book_id: id });
      const resuming = partialIds.has(id);
      if (!resuming) {
        const either = await B.findOne({ $or: [{ id }, { _id: wh._id }] }, { projection: { id: 1 } });
        if (either) { rec.outcome = 'refused_live_by_id'; tally.refused_live_by_id++; log.write(JSON.stringify(rec) + '\n'); continue; }
        const del = await db.collection('deleted_books').findOne({ $or: [{ id }, { _id: wh._id }] }, { projection: { deleted_at: 1, reason: 1, deletion_reason: 1 } });
        if (del) { rec.outcome = 'refused_deleted'; rec.deleted = del; tally.refused_deleted++; log.write(JSON.stringify(rec) + '\n'); continue; }
      }
      rec.dedup_matches = await dedupeAgainstLive(db, wh);
      if (rec.dedup_matches.length) tally.dedup_matched++;

      const now = new Date();
      if (!resuming) {
        const slug = await freeSlug(db, wh.slug, id);
        const { book, removed, before, identityFilled } = buildBook(wh, now, slug);
        rec.before = before;
        rec.removed_fields = removed;
        rec.identity_filled = identityFilled;
        rec.after = { visible: book.visible, hidden: book.hidden, hidden_reason: book.hidden_reason, publication: { state: book.publication.state, reason: book.publication.reason }, pipeline_status: book.pipeline_auto.status, held_from_status: book.pipeline_auto.hold.held_from_status, slug: book.slug };
        if (APPLY) {
          await B.insertOne(book);
          await db.collection('book_events').insertOne({ book_id: id, type: HOLD_EVENT, at: now, source: BY, details: { reason: HOLD_REASON, issue: ISSUE, from_status: rec.before.pipeline_status, release: HOLD_RELEASE } });
          await db.collection('audit_log').insertOne({ action: 'pipeline_status_changed', book_id: id, book_title: book.title, metadata: { from: rec.before.pipeline_status || 'none', to: HOLD_STATUS, source: BY, reason: HOLD_REASON }, timestamp: now }).catch(() => {});
        }
      } else {
        rec.outcome_note = 'resume: book row already written by this sweep';
      }

      // Pages: stream in _id order, insert unordered, tolerate duplicates already copied (resume).
      let inserted = 0, poisonedPages = 0, archived = 0, batch = [];
      const flush = async () => {
        if (!batch.length) return;
        if (APPLY) {
          try {
            const r = await P.insertMany(batch, { ordered: false });
            inserted += r.insertedCount;
          } catch (err) {
            const dupOnly = err?.writeErrors?.every?.((e) => (e.code ?? e.err?.code) === 11000);
            if (!dupOnly) throw err;
            inserted += err.result?.insertedCount ?? err.insertedCount ?? 0;
          }
        } else inserted += batch.length;
        batch = [];
      };
      for await (const p of PW.find({ book_id: id }).sort({ _id: 1 })) {
        const { page, poisoned } = transformPage(p);
        if (poisoned) { poisonedPages++; poisonLog.write(JSON.stringify({ book_id: id, page_id: String(p._id), page_number: p.page_number, dropped: poisoned }) + '\n'); }
        if (typeof page.archived_photo === 'string' && /^https?:\/\//.test(page.archived_photo)) archived++;
        batch.push(page);
        if (batch.length >= PAGE_BATCH) await flush();
      }
      await flush();
      rec.pages_inserted = inserted;
      rec.poisoned_pages_dropped = poisonedPages;
      rec.pages_archived_recomputed = archived;
      tally.pages += inserted; tally.poisoned_pages += poisonedPages;

      if (APPLY) {
        const live = await P.countDocuments({ book_id: id });
        rec.live_pages = live;
        if (live !== rec.warehouse_pages) throw new Error(`page count mismatch: pages ${live} vs pages_warehouse ${rec.warehouse_pages} — warehouse NOT marked promoted; re-run resumes`);
        await B.updateOne({ id }, { $set: { pages_archived: archived, updated_at: new Date() } });
        await W.updateOne({ id }, { $set: { promoted_at: new Date(), promoted_to: 'live' } });
        await recordSweepAction(db, { sweep: SWEEP, book_id: id, action: 'promoted_from_warehouse', detail: { pages: live, poisoned_pages_dropped: poisonedPages, held: HOLD_REASON, publication: 'hidden/curation', slug: rec.after?.slug ?? null, dedup_matches: rec.dedup_matches.map((m) => `${m.tier}:${m.book_id}`) } });
      }
      rec.outcome = resuming ? 'resumed' : (APPLY ? 'promoted' : 'would_promote');
      if (resuming) tally.resumed++; else tally.promoted++;
    } catch (err) {
      rec.outcome = 'error'; rec.error = err.message; tally.errors++;
      console.error(`  ERROR ${id}: ${err.message}`);
    }
    rec.ms = Date.now() - t0;
    log.write(JSON.stringify(rec) + '\n');
    if ((tally.promoted + tally.resumed) % 25 === 0) console.log(`  ${JSON.stringify(tally)}`);
  }
  console.log(`[promote] done ${JSON.stringify(tally)}`);
  await new Promise((r) => log.end(r));
  await new Promise((r) => poisonLog.end(r));
  await client.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
