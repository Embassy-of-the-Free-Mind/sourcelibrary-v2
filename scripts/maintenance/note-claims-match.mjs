#!/usr/bin/env node
/**
 * PRIOR ART: scripts/eval/note-claims-validate-5647.mjs runs the same matcher over the 359
 * judged notes from files; this runs it over stored `note_claims` rows. scripts/audit/
 * note-tag-provenance.mjs verifies `original:` quotes against OCR (the #4777 lane) — a different
 * claim (the quoted original), and it writes no claim rows.
 *
 * Stage 2 of the translation-note fact-check lane (#5647): settle what a reference table can.
 *   (a) note Sanskrit equivalences → the Tibetan↔Sanskrit table (build-tib-skt-table.mjs; on the
 *       box, out of git — 84000 is CC BY-NC-ND);
 *   (b) names/numbers in <summary>/<keywords>/headings → the page's own OCR.
 * Each row gets `match: { status: match|conflict|no-entry, reason, anchor, evidence, … }`.
 * $0. Writes ONLY note_claims. Writes NO correction: a conflict is a candidate for the repair
 * step (scripts/lib/translation-text-repair.mjs), which is separate and human-approved.
 *
 * A row is (re)matched when it has no match, when its match was made for another translation
 * hash or matcher version, or with --rematch. A row whose page text changed since extraction is
 * left alone and counted `stale` (re-run the extractor).
 *
 * Usage (Hetzner):
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/maintenance/note-claims-match.mjs \
 *     [--book <id>] [--table /root/factcheck-lane/refs/tib-skt-table.jsonl] [--rematch] [--apply]
 */
import fs from 'node:fs';
import path from 'node:path';
import { getScriptClient } from '../lib/mongo.mjs';
import { indexTable, matchRow, translationHash, MATCHER } from '../lib/note-claims.mjs';
import { contentHash } from '../lib/write-provenance.mjs';

const arg = (k, d) => (process.argv.includes(`--${k}`) ? process.argv[process.argv.indexOf(`--${k}`) + 1] : d);
const APPLY = process.argv.includes('--apply');
const REMATCH = process.argv.includes('--rematch');
const BOOK = arg('book');
const TABLE = arg('table', '/root/factcheck-lane/refs/tib-skt-table.jsonl');
const COLL = 'note_claims';

const tableText = fs.readFileSync(TABLE, 'utf8');
const table = indexTable(tableText.split('\n').filter(Boolean).map((l) => JSON.parse(l)));
const tableRef = { file: path.basename(TABLE), rows: table.size, hash: contentHash(tableText) };

const { client, db } = await getScriptClient({ noTimeout: true, socketTimeoutMs: 120_000 });
const coll = db.collection(COLL);
const filter = { ...(BOOK ? { book_id: BOOK } : {}) };
if (!REMATCH) {
  filter.$or = [
    { match: { $exists: false } },
    { $expr: { $ne: ['$match.translation_hash', '$translation_hash'] } },
    { 'match.matcher.version': { $ne: MATCHER.version } },
    { 'match.table.hash': { $ne: tableRef.hash } },
  ];
}
const pageIds = await coll.distinct('page_id', filter);
const t = { pages: pageIds.length, rows: 0, stale: 0, status: {}, by_tag: {} };
for (let i = 0; i < pageIds.length; i += 200) {
  const ids = pageIds.slice(i, i + 200);
  const pages = new Map((await db.collection('pages').find({ id: { $in: ids } }, { projection: { id: 1, 'ocr.data': 1, 'translation.data': 1, 'translation.content_hash': 1 } }).toArray()).map((p) => [p.id, p]));
  const rows = await coll.find({ ...filter, page_id: { $in: ids } }).toArray();
  const bookIds = [...new Set(rows.map((r) => r.book_id))];
  const bookNames = new Map((await db.collection('books').find({ id: { $in: bookIds } }, { projection: { id: 1, title: 1, display_title: 1, english_title: 1, original_title: 1, work_title: 1, author: 1 } }).toArray())
    .map((b) => [b.id, [b.title, b.display_title, b.english_title, b.original_title, b.work_title, b.author].filter((x) => typeof x === 'string' && x)]));
  const ops = [];
  for (const r of rows) {
    const p = pages.get(r.page_id);
    if (!p || translationHash(p.translation) !== r.translation_hash) { t.stale++; continue; }
    const res = matchRow(r, table, p.ocr?.data || '', p.translation?.data || '', bookNames.get(r.book_id) || []);
    const match = {
      status: res.status, reason: res.reason, anchor: res.anchor || null,
      evidence: (res.evidence || []).slice(0, 6), groups: res.groups || null, page_numbers: res.page_numbers || null,
      translation_hash: r.translation_hash, matcher: MATCHER, table: tableRef, matched_at: new Date(),
    };
    t.rows++;
    t.status[res.status] = (t.status[res.status] || 0) + 1;
    const k = `${r.source_tag}:${r.claim_kind}:${res.status}`;
    t.by_tag[k] = (t.by_tag[k] || 0) + 1;
    // filter on the hash too: a re-extraction between read and write turns into a no-op
    ops.push({ updateOne: { filter: { _id: r._id, translation_hash: r.translation_hash }, update: { $set: { match } } } });
  }
  if (APPLY && ops.length) await coll.bulkWrite(ops, { ordered: false });
  if ((i / 200) % 10 === 0) console.error(`[match] pages ${Math.min(i + 200, pageIds.length)}/${pageIds.length} rows=${t.rows}`);
}
console.log(JSON.stringify({ apply: APPLY, matcher: MATCHER, table: tableRef, ...t }, null, 1));
await client.close();
