#!/usr/bin/env node
// PRIOR ART: scripts/maintenance/restore-withheld-translation.mjs and restore-refused-translations-5105.mjs
// put a TRANSLATION back from page_revisions; scripts/maintenance/apply-reocr-verdicts.mjs writes a
// NEW transcription from a verdict file. Nothing puts a page's previous OCR back after a bad write.
//
// #5813 — undo this job's truncated OCR writes. Gemini returned some pages' text in several parts and
// the collectors stored parts[0] only (raw-parts.mjs finds them: text_parts > 1). For each such page
// that STILL carries that write, this puts back the transcription the page served before, taken from
// the page_revisions snapshot the collector made at overwrite time, with its own date, model and
// provenance, so the page is exactly "lite-read, not yet re-read" again and its translation is not
// stale. The truncated text is snapshotted first (reason restore_truncated_5813); nothing is lost.
// No model is called. Human-edited pages are never touched (the guard is in the update filter).
//   node --env-file=… scripts/batch/greek-reocr-5813/restore-truncated.mjs --raw=raw-parts.jsonl [--apply]
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
import { saveRevisionsBeforeOverwrite } from '../../lib/page-revisions.mjs';
import { liftOcrTags } from '../../lib/ocr-result-parse.mjs';
import { syncPageBatch } from '../../workers/lib/supabase-page-writer.mjs';
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const APPLY = process.argv.includes('--apply');
const REASON = 'restore_truncated_5813';
const bad = fs.readFileSync(arg('raw'), 'utf8').trim().split('\n').map(JSON.parse).filter((r) => r.text_parts > 1 && r.page_id);
const c = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 2 });
await c.connect();
const db = c.db('bookstore');
const P = db.collection('pages'), R = db.collection('page_revisions');
const tally = { candidates: bad.length, restored: 0, not_this_write: 0, human_edit: 0, no_revision: 0, text_is_complete: 0 };
const synced = [];
for (const r of bad) {
  const page = await P.findOne({ id: r.page_id }, { projection: { _id: 0, id: 1, book_id: 1, ocr: 1 } });
  if (!page || page.ocr?.batch_job_id !== r.job_id) { tally.not_this_write++; continue; }
  if (page.ocr.source === 'manual' || page.ocr.edited_by) { tally.human_edit++; continue; }
  if ((page.ocr.data || '').length >= r.joined_len) { tally.text_is_complete++; continue; }
  // The collector's snapshot of what this write replaced: the newest flash-lite OCR revision. (Its job_id is the
  // OLD read's batch job, or this job's id when the old read carried none, so job_id cannot select it.)
  const [rev] = await R.find({ page_id: r.page_id, field: 'ocr', model: /flash-lite/, reason: { $ne: REASON } }).sort({ created_at: -1 }).limit(1).toArray();
  if (!rev?.data || !(rev.created_at >= new Date(Date.now() - 4 * 86400e3)) || rev.data === page.ocr.data) { tally.no_revision++; continue; }
  if (rev.job_id === r.job_id) delete rev.job_id;
  tally.restored++;
  if (!APPLY) continue;
  await saveRevisionsBeforeOverwrite(db, [r.page_id], 'ocr', { reason: REASON, keepMeta: true });
  const set = {
    'ocr.data': rev.data, 'ocr.model': rev.model, 'ocr.source': rev.source, 'ocr.updated_at': rev.original_date,
    'ocr.has_warning': /<warning[\s>]/i.test(rev.data), 'ocr.restored': { reason: REASON, at: new Date(), from_revision: rev.id, undone_job: r.job_id },
    ...(rev.language ? { 'ocr.language': rev.language } : {}), ...(rev.prompt_version ? { 'ocr.prompt_version': rev.prompt_version } : {}),
    ...(rev.job_id ? { 'ocr.batch_job_id': rev.job_id } : {}), ...(rev.content_hash ? { 'ocr.content_hash': rev.content_hash } : {}), ...(rev.engine ? { 'ocr.engine': rev.engine } : {}),
    ...liftOcrTags(rev.data),
  };
  // Fields the undone flash job stamped that the snapshot does not carry: they would describe a run that no longer made this text.
  const unset = Object.fromEntries(['prompt_id', 'prompt_hash', 'prompt_name', 'input_tokens', 'output_tokens', 'source_url', 'code_version', ...(rev.job_id ? [] : ['batch_job_id']), ...(rev.content_hash ? [] : ['content_hash']), ...(rev.engine ? [] : ['engine'])].map((k) => [`ocr.${k}`, '']));
  const res = await P.updateOne({ id: r.page_id, 'ocr.batch_job_id': r.job_id, 'ocr.edited_by': { $exists: false }, 'ocr.source': { $ne: 'manual' } }, { $set: set, $unset: unset });
  if (res.modifiedCount) synced.push({ pageId: r.page_id, mongoSet: set }); else { tally.restored--; tally.not_this_write++; }
}
if (APPLY && synced.length) { await syncPageBatch(synced); await new Promise((r) => setTimeout(r, 5000)); }
console.log(`${APPLY ? 'APPLIED' : 'DRY RUN'} ${JSON.stringify(tally)}`);
await c.close();
