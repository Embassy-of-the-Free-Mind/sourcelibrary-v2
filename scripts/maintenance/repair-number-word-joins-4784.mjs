#!/usr/bin/env node
/**
 * PRIOR ART: scripts/maintenance/dehyphenate-ia-ocr.mjs — the 2026-09 sweep that made these joins;
 * its population (book_events ia_ocr_ingest), revision-first write and exact-text match are the
 * shape copied here. The rule is scripts/lib/dehyphenate.mjs as changed by PR #6704; nothing else
 * re-derives page text from its `page_revisions` raw.
 *
 * repair-number-word-joins-4784 — undo the number-word false joins (`twenty-\nfive` → `twentyfive`)
 * the 2026-09 dehyphenate sweep wrote into Internet Archive OCR pages (#4784).
 *
 * For each page with a `page_revisions` row `reason: 'ia_ocr_dehyphenate'` (the raw leaf text):
 *   1. replay the PRE-#6704 rule on the raw text; if it does not reproduce the page's CURRENT text
 *      exactly, something else has written the page since, and it is skipped and counted;
 *   2. otherwise the repaired text is the #6704 rule applied to the raw text: every other join
 *      stays as it is, and only the number compounds come back as printed (`twenty-\nfive`).
 * Pages where the two rules agree have no number compound and are not touched.
 *
 * WHAT IT WRITES (--apply): `ocr.data`, `ocr.updated_at`, `updated_at`; the current text to
 * `page_revisions` first (`reason: 'number_word_rejoin_4784'`); one `sweep_log` row per book
 * (`sweep: number-word-rejoin-4784`, the page ids in `detail.pages`). The update matches on the
 * exact current text, so a page rewritten between read and write is skipped.
 *
 * Undo: restore each page from its `number_word_rejoin_4784` revision, `--undo [--apply]`.
 *
 * Usage (dry run by default):
 *   node --env-file=.env.production.local scripts/maintenance/repair-number-word-joins-4784.mjs --out <dir>
 *   … --out <dir> --apply
 *   … --undo [--apply]
 * --out writes <dir>/number-word-joins-4784.jsonl (one line per page: ids, the compounds, current/new hash).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { withMongo } from '../lib/mongo.mjs';
import { recordSweepAction } from '../lib/sweep-log.mjs';
import { saveRevisionsBeforeOverwrite } from '../lib/page-revisions.mjs';
import { dehyphenateLineBreaks } from '../lib/dehyphenate.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const APPLY = process.argv.includes('--apply');
const OUT = arg('--out', null);
const SOURCE = 'ia_djvu';
const SWEEP = 'number-word-rejoin-4784';
const REASON = 'number_word_rejoin_4784';

// The rule as the 2026-09 sweep ran it (scripts/lib/dehyphenate.mjs before #6704).
const PRE_6704 = /(\p{L})[-‐­¬][ \t]*\r?\n[ \t]*(?=\p{Ll})/gu;
const preRule = (t) => (!t || !t.includes('\n') ? t || '' : t.replace(PRE_6704, '$1'));
const hash = (s) => createHash('sha1').update(s).digest('hex').slice(0, 12);
// The number compounds in a raw text that #6704 keeps (pre-rule joined them, new rule does not).
const compounds = (raw) => [...raw.matchAll(/(\p{L}+)[-‐­¬][ \t]*\r?\n[ \t]*(\p{Ll}\p{L}*)/gu)]
  .filter((m) => dehyphenateLineBreaks(m[0]) === m[0]).map((m) => `${m[1]}-${m[2]}`);

await withMongo(async (db) => {
  const P = db.collection('pages'); const R = db.collection('page_revisions');
  if (process.argv.includes('--undo')) {
    // `page_revisions.reason` is unindexed: find the pages through sweep_log, then their revisions by page_id.
    const pageIds = (await db.collection('sweep_log').find({ sweep: SWEEP }, { projection: { 'detail.pages': 1 } }).toArray()).flatMap((r) => r.detail?.pages || []);
    const revs = [];
    for (let i = 0; i < pageIds.length; i += 200) {
      const chunk = await R.find({ page_id: { $in: pageIds.slice(i, i + 200) }, field: 'ocr', reason: REASON }, { projection: { page_id: 1, data: 1, created_at: 1 } }).sort({ created_at: 1 }).toArray();
      const seen = new Set(revs.map((v) => v.page_id));
      for (const v of chunk) if (!seen.has(v.page_id)) { seen.add(v.page_id); revs.push(v); } // the earliest: the text this sweep replaced
    }
    console.log(`${revs.length} pages to restore — ${APPLY ? 'APPLY' : 'dry run'}`);
    if (APPLY) {
      const now = new Date();
      const r = await P.bulkWrite(revs.map((v) => ({ updateOne: { filter: { id: v.page_id }, update: { $set: { 'ocr.data': v.data, 'ocr.updated_at': now, updated_at: now } } } })), { ordered: false });
      console.log(`restored ${r.modifiedCount}`);
    }
    return;
  }
  const bookIds = await db.collection('book_events').distinct('book_id', { type: 'ia_ocr_ingest' });
  console.log(`${bookIds.length} ingested books — ${APPLY ? 'APPLY' : 'dry run'}`);
  const out = OUT ? (fs.mkdirSync(OUT, { recursive: true }), fs.createWriteStream(path.join(OUT, 'number-word-joins-4784.jsonl'))) : null;
  const t = { books: 0, pages: 0, compounds: 0, changed_since: 0, written: 0, not_matched: 0, revisions: 0 };
  let i = 0;
  for (const bid of bookIds) {
    i++;
    const pages = await P.find({ book_id: bid, 'ocr.source': SOURCE }, { projection: { id: 1, page_number: 1, 'ocr.data': 1 } }).toArray();
    if (!pages.length) continue;
    const byId = new Map(pages.map((p) => [p.id, p]));
    const revs = await R.find({ page_id: { $in: [...byId.keys()] }, field: 'ocr', reason: 'ia_ocr_dehyphenate' }, { projection: { page_id: 1, data: 1, created_at: 1 } }).sort({ created_at: 1 }).toArray();
    const raw = new Map();
    for (const v of revs) if (!raw.has(v.page_id)) raw.set(v.page_id, v.data); // the earliest: the leaf as ingested
    const changes = [];
    for (const [pid, rawText] of raw) {
      const p = byId.get(pid); const cur = p?.ocr?.data;
      if (typeof rawText !== 'string' || !cur) continue;
      const neu = dehyphenateLineBreaks(rawText);
      if (neu === preRule(rawText)) continue; // no number compound on this page
      const found = compounds(rawText);
      if (preRule(rawText) !== cur) { t.changed_since++; out?.write(JSON.stringify({ book_id: bid, page_id: pid, page_number: p.page_number, compounds: found, skipped: 'text changed since the sweep' }) + '\n'); continue; }
      changes.push({ p, cur, neu, found });
      out?.write(JSON.stringify({ book_id: bid, page_id: pid, page_number: p.page_number, compounds: found, cur: hash(cur), neu: hash(neu) }) + '\n');
    }
    if (!changes.length) continue;
    t.books++; t.pages += changes.length; t.compounds += changes.reduce((a, c) => a + c.found.length, 0);
    if (APPLY) {
      const rev = await saveRevisionsBeforeOverwrite(db, changes.map((c) => c.p.id), 'ocr', { reason: REASON });
      t.revisions += rev;
      if (rev < changes.length) { console.log(`  ${bid}: ${rev} revisions for ${changes.length} pages — not writing this book`); continue; }
      const now = new Date();
      const r = await P.bulkWrite(changes.map((c) => ({ updateOne: {
        filter: { _id: c.p._id, 'ocr.source': SOURCE, 'ocr.data': c.cur },
        update: { $set: { 'ocr.data': c.neu, 'ocr.updated_at': now, updated_at: now } },
      } })), { ordered: false });
      t.written += r.modifiedCount; t.not_matched += changes.length - r.modifiedCount;
      await recordSweepAction(db, { sweep: SWEEP, book_id: bid, action: 'rejoined number words', detail: { pages: changes.map((c) => c.p.id), written: r.modifiedCount, compounds: changes.flatMap((c) => c.found).slice(0, 50) } });
    }
    if (i % 100 === 0) console.log(`  … ${i}/${bookIds.length} books, ${t.pages} pages`);
  }
  out?.end();
  console.log(JSON.stringify({ ...t, applied: APPLY }));
}, { timeoutMs: 2 * 60 * 60 * 1000 });
