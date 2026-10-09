#!/usr/bin/env node
/**
 * PRIOR ART: scripts/eval/results/note-facts-full-2026-10-02-5624/raw/candidate-filter.py (PR #5640)
 * — a one-off Python pull of the same candidates into a JSON file; this is the standing version,
 * writing rows to a collection and keyed to the translation's content_hash.
 * scripts/audit/note-tag-provenance.mjs reads notes for tag shape, not claims. No `*claims*`
 * collection existed (listCollections: wikidata_claims, acquisition_claims — unrelated).
 *
 * Stage 1 of the translation-note fact-check lane (#5647): pull the checkable claims out of
 * translations into `note_claims` — a dedicated collection, never new fields on `pages`
 * (field-sprawl.md). $0: no model, no network beyond Mongo.
 *
 * One row per candidate <note> (the #5624 cue filter, verbatim) and one per name/number in the
 * page apparatus (<summary>, <keywords>, headings). Row _id is `${page_id}:${tag}:${index}`.
 * Every row carries the translation's content_hash. IDEMPOTENT: a page whose rows already carry
 * its current hash (and this extractor version) is skipped; a page whose translation changed has its rows replaced (so a
 * stage-2 result never outlives the text it judged). The only collection written is note_claims.
 *
 * Usage (Hetzner):
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/maintenance/note-claims-extract.mjs \
 *     --envelope tibetan-retranslation-4523 [--since 2026-10-01] [--book <id>] [--limit-books N] [--apply]
 * Without --apply it counts what it would write.
 */
import { getScriptClient } from '../lib/mongo.mjs';
import { readScopeEnvelopes } from '../lib/spend-guard.mjs';
import { claimRowsForPage, translationHash, EXTRACTOR } from '../lib/note-claims.mjs';
import { isHumanEditedTranslation } from '../lib/translation-text-repair.mjs';

const arg = (k, d) => (process.argv.includes(`--${k}`) ? process.argv[process.argv.indexOf(`--${k}`) + 1] : d);
const APPLY = process.argv.includes('--apply');
const ENVELOPE = arg('envelope');
const BOOK = arg('book');
const SINCE = arg('since', '2026-10-01');
const LIMIT_BOOKS = Number(arg('limit-books', 0));
const COLL = 'note_claims';

const { client, db } = await getScriptClient({ noTimeout: true, socketTimeoutMs: 120_000 });

async function bookIds() {
  if (BOOK) return [BOOK];
  if (!ENVELOPE) throw new Error('--envelope <tag> or --book <id> is required');
  const control = await db.collection('system_config').findOne({ _id: 'processing_control' });
  const env = readScopeEnvelopes(control).find((e) => e.tag === ENVELOPE);
  if (!env) throw new Error(`envelope ${ENVELOPE} not found in processing_control.allow_scopes`);
  const ids = new Set(env.book_ids);
  if (env.collections.length) {
    for (const b of await db.collection('books').find({ collections: { $in: env.collections } }, { projection: { id: 1 } }).toArray()) ids.add(String(b.id));
  }
  return [...ids];
}

const ids = await bookIds();
const books = LIMIT_BOOKS ? ids.slice(0, LIMIT_BOOKS) : ids;
if (APPLY) {
  await db.collection(COLL).createIndex({ page_id: 1 });
  await db.collection(COLL).createIndex({ book_id: 1, page_number: 1 });
  await db.collection(COLL).createIndex({ 'match.status': 1, claim_kind: 1 });
}

const t = { books: books.length, pages: 0, pages_unchanged: 0, pages_extracted: 0, pages_replaced: 0, rows_written: 0, rows_deleted: 0, rows_by_tag: {}, notes_seen: 0 };
const since = new Date(SINCE);
for (let i = 0; i < books.length; i += 20) {
  const batch = books.slice(i, i + 20);
  const pages = await db.collection('pages').find(
    { book_id: { $in: batch }, 'translation.data': { $type: 'string', $ne: '' }, 'translation.updated_at': { $gte: since } },
    { projection: { id: 1, book_id: 1, page_number: 1, 'translation.data': 1, 'translation.content_hash': 1, 'translation.model': 1, 'translation.prompt_version': 1, 'translation.updated_at': 1, 'translation.source': 1, 'translation.edited_by': 1, 'translation.edited_at': 1 } },
  ).toArray();
  if (!pages.length) continue;
  const existing = await db.collection(COLL).aggregate([
    { $match: { page_id: { $in: pages.map((p) => p.id) } } },
    { $group: { _id: '$page_id', hashes: { $addToSet: '$translation_hash' }, versions: { $addToSet: '$extractor.version' }, n: { $sum: 1 } } },
  ]).toArray();
  const have = new Map(existing.map((e) => [e._id, e]));
  const inserts = []; const replacePages = [];
  for (const p of pages) {
    t.pages++;
    t.notes_seen += (p.translation.data.match(/<note>/g) || []).length;
    const hash = translationHash(p.translation);
    const prev = have.get(p.id);
    if (prev && prev.hashes.length === 1 && prev.hashes[0] === hash && prev.versions.length === 1 && prev.versions[0] === EXTRACTOR.version) { t.pages_unchanged++; continue; }
    const rows = claimRowsForPage(p).map((r) => ({ ...r, human_edited: isHumanEditedTranslation(p.translation) }));
    if (prev) { replacePages.push(p.id); t.pages_replaced++; t.rows_deleted += prev.n; }
    if (rows.length) t.pages_extracted++;
    for (const r of rows) t.rows_by_tag[`${r.source_tag}:${r.claim_kind}`] = (t.rows_by_tag[`${r.source_tag}:${r.claim_kind}`] || 0) + 1;
    inserts.push(...rows);
  }
  if (APPLY) {
    if (replacePages.length) await db.collection(COLL).deleteMany({ page_id: { $in: replacePages } });
    for (let j = 0; j < inserts.length; j += 1000) {
      const chunk = inserts.slice(j, j + 1000);
      // upsert, not insert: a concurrent run on the same page must not fail on a duplicate _id
      await db.collection(COLL).bulkWrite(chunk.map((r) => ({ replaceOne: { filter: { _id: r._id }, replacement: r, upsert: true } })), { ordered: false });
    }
  }
  t.rows_written += inserts.length;
  if ((i / 20) % 10 === 0) console.error(`[extract] books ${Math.min(i + 20, books.length)}/${books.length} pages=${t.pages} rows=${t.rows_written}`);
}
console.log(JSON.stringify({ apply: APPLY, envelope: ENVELOPE || null, since: SINCE, extractor: EXTRACTOR, ...t }, null, 1));
await client.close();
