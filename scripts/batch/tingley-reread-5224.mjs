#!/usr/bin/env node
/**
 * Tingley / Point Loma lite re-read (#5224): the lane around a batch re-OCR of this shelf's
 * pages that still carry the Internet Archive's own OCR (`ocr.source: 'ia_djvu'`).
 *
 * Why. The numbers test (#5224) measured the Archive's text getting 5.1% of printed numbers wrong
 * against flash-lite's 1.8%. Derek approved re-reading this shelf with lite on 2026-09-30.
 *
 * This script never calls Gemini. The paid step is `bulk-reocr-local.mjs --page-ids-file` (Batch
 * API, lite), and `batch-collector.mjs` writes the results back. This script does the parts
 * around that:
 *   plan      page-ids file: ia_djvu pages on the shelf that are not recitation-blocked, skipping
 *             books held by ANOTHER repair lane (e.g. stranded-text-5309 owns its own books)
 *   hold      hold every target book that is not already held (reason tingley-reread-5224), so no
 *             lane acts on a book while its text changes. Books already held under
 *             ia-free-text-first-4966 stay held under that reason.
 *   snapshot  save the Archive text to page_revisions WITH its full ocr block (keepMeta, reason
 *             tingley-reread-5224). The collector saves a plain revision as well; this one keeps
 *             the engine version and the ingest metadata (provenance standard).
 *   status    per-page outcome: re-read by lite / still Archive text (recitation refusals keep the
 *             Archive text, which is the intended fallback) / other
 *   release   release only the books this lane held, back to their prior status
 *
 * The shelf is the books in `point-loma`, the books authored by Tingley, and the Theosophical Path
 * import campaign. All of them are English, so nothing is re-translated (#4958).
 *
 * Usage (Hetzner, from /root/sourcelibrary):
 *   node --env-file=.env.production.local scripts/batch/tingley-reread-5224.mjs plan --out /root/tingley-5224/pages.json
 *   node … hold --pages /root/tingley-5224/pages.json [--dry-run] | snapshot --pages … | status --pages … | release [--dry-run]
 *
 * PRIOR ART: scripts/batch/stranded-text-repair-5309.mjs (PR #5408) sequences the same writers for
 * a multi-language cohort with re-translation; this shelf needs OCR only, so the lane is these five
 * steps.
 */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
import { holdBook, releaseBook } from '../lib/pipeline-hold.mjs';
import { saveRevisionsBeforeOverwrite } from '../lib/page-revisions.mjs';

const REASON = 'tingley-reread-5224';
const ISSUE = 5224;
// A book held by one of these reasons may be read here: the hold keeps it out of the pipeline, and
// this lane does not change its status.
const COMPATIBLE_HOLDS = new Set([REASON, 'ia-free-text-first-4966']);
const SHELF = { $or: [{ collections: 'point-loma' }, { author: /tingley/i }, { campaign_tag: 'theosophical-path-2026-09-26' }] };

const [cmd, ...rest] = process.argv.slice(2);
const opt = (n) => { const i = rest.indexOf(`--${n}`); return i >= 0 ? rest[i + 1] : null; };
const dryRun = rest.includes('--dry-run');

const client = await MongoClient.connect(process.env.MONGODB_URI);
const db = client.db('bookstore');
try {
  const books = await db.collection('books').find(SHELF, { projection: { id: 1, title: 1, language: 1, pipeline_auto: 1 } }).toArray();

  if (cmd === 'plan') {
    const out = opt('out') || 'tingley-5224-pages.json';
    const skipped = books.filter((b) => b.pipeline_auto?.hold && !COMPATIBLE_HOLDS.has(b.pipeline_auto.hold.reason));
    const target = books.filter((b) => !skipped.includes(b));
    const nonEnglish = target.filter((b) => !/^english$/i.test(b.language || ''));
    if (nonEnglish.length) throw new Error(`non-English book on the shelf (${nonEnglish.map((b) => b.id).join(',')}); this lane does not re-translate`);
    const pages = await db.collection('pages').find(
      { book_id: { $in: target.map((b) => b.id) }, 'ocr.source': 'ia_djvu', 'ocr.recitation_blocked': { $ne: true } },
      { projection: { id: 1, book_id: 1, page_number: 1 } },
    ).toArray();
    const perBook = {};
    for (const p of pages) perBook[p.book_id] = (perBook[p.book_id] || 0) + 1;
    fs.writeFileSync(out, JSON.stringify({ issue: ISSUE, reason: REASON, created: new Date().toISOString(), pages: pages.map((p) => ({ page_id: p.id, book_id: p.book_id })) }));
    console.log(`shelf ${books.length} books; skipped (other lane's hold) ${skipped.length}: ${skipped.map((b) => `${b.id} ${b.pipeline_auto.hold.reason}`).join('; ') || 'none'}`);
    console.log(`target: ${pages.length} ia_djvu pages in ${Object.keys(perBook).length} books → ${out}`);
  } else if (cmd === 'hold') {
    const file = JSON.parse(fs.readFileSync(opt('pages'), 'utf8'));
    const ids = [...new Set(file.pages.map((p) => p.book_id))];
    const tally = {};
    for (const id of ids) {
      const r = await holdBook(db, id, { reason: REASON, issue: ISSUE, release: 'the lite batch re-read of its ia_djvu pages has been collected', source: 'tingley-reread-5224' }, { dryRun });
      tally[r.outcome] = (tally[r.outcome] || 0) + 1;
      if (r.outcome === 'held' || r.outcome === 'dry_run') console.log(`  ${r.outcome} ${id} (from ${r.from})`);
    }
    console.log('hold:', JSON.stringify(tally));
  } else if (cmd === 'snapshot') {
    const file = JSON.parse(fs.readFileSync(opt('pages'), 'utf8'));
    const ids = file.pages.map((p) => p.page_id);
    const done = new Set((await db.collection('page_revisions').find({ page_id: { $in: ids }, field: 'ocr', reason: REASON }, { projection: { page_id: 1 } }).toArray()).map((r) => r.page_id));
    const todo = ids.filter((id) => !done.has(id));
    let n = 0;
    for (let i = 0; i < todo.length; i += 500) n += await saveRevisionsBeforeOverwrite(db, todo.slice(i, i + 500), 'ocr', { reason: REASON, keepMeta: true });
    console.log(`snapshot: ${n} revisions written, ${done.size} already had one, ${todo.length - n} had no text`);
  } else if (cmd === 'status') {
    const file = JSON.parse(fs.readFileSync(opt('pages'), 'utf8'));
    const ids = file.pages.map((p) => p.page_id);
    const rows = await db.collection('pages').aggregate([
      { $match: { id: { $in: ids } } },
      { $group: { _id: { s: '$ocr.source', m: '$ocr.model', rb: { $ifNull: ['$ocr.recitation_count', 0] } }, n: { $sum: 1 } } },
    ]).toArray();
    const t = { reread: 0, archive_refused: 0, archive_untouched: 0, other: 0 };
    for (const r of rows) {
      if (r._id.s === 'ia_djvu') t[r._id.rb > 0 ? 'archive_refused' : 'archive_untouched'] += r.n;
      else if (/lite/.test(r._id.m || '')) t.reread += r.n;
      else t.other += r.n;
    }
    const revs = await db.collection('page_revisions').countDocuments({ page_id: { $in: ids }, field: 'ocr', reason: REASON });
    console.log(`status of ${ids.length} pages:`, JSON.stringify(t), `snapshots ${revs}`);
  } else if (cmd === 'release') {
    const held = books.filter((b) => b.pipeline_auto?.hold?.reason === REASON);
    for (const b of held) {
      const r = await releaseBook(db, b.id, { note: 'lite re-read collected (#5224)', source: 'tingley-reread-5224' }, { dryRun });
      console.log(`  ${r.outcome} ${b.id} → ${r.to}`);
    }
    console.log(`release: ${held.length} books`);
  } else {
    console.log('usage: tingley-reread-5224.mjs plan|hold|snapshot|status|release [--pages F] [--out F] [--dry-run]');
    process.exitCode = 2;
  }
} finally {
  await client.close();
}
