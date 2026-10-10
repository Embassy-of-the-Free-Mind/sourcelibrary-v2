#!/usr/bin/env node
// PRIOR ART: scripts/batch/greek-reocr-5813/restore-truncated.mjs undoes this job's CUT-OFF writes,
// found from the raw answers; scripts/maintenance/restore-withheld-translation.mjs puts back a
// translation the withhold sweep removed. Neither undoes a COMPLETE flash re-read that turned out
// worse than the lite text, together with the retranslation made from it.
//
// #5813 — put named pages back to what they served before this job. For each listed page that still
// carries the job's flash re-read: the transcription comes back from the page_revisions snapshot the
// collector took (newest flash-lite OCR revision), with its own date, model and provenance; and if
// the page was retranslated AFTER the re-read, the English comes back from the snapshot the
// translation door took (reason retranslate_stale). What is replaced is snapshotted first (reason
// = --reason). No model is called. Human-edited fields are never touched.
// Used for the annotated Symposium copy, where flash wrote out a gloss for faint pencilled notes.
//   node --env-file=… scripts/batch/greek-reocr-5813/restore-pages.mjs --pages=ids.json --reason=restore_invented_gloss_5813 [--apply]
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
import { saveRevisionsBeforeOverwrite } from '../../lib/page-revisions.mjs';
import { liftOcrTags } from '../../lib/ocr-result-parse.mjs';
import { syncPageBatch } from '../../workers/lib/supabase-page-writer.mjs';
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const APPLY = process.argv.includes('--apply');
const REASON = arg('reason');
if (!REASON) { console.error('--reason is required'); process.exit(1); }
const ids = JSON.parse(fs.readFileSync(arg('pages'), 'utf8')).map((x) => (typeof x === 'string' ? x : x.id || x.page_id));
const c = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 2 });
await c.connect();
const db = c.db('bookstore');
const P = db.collection('pages'), R = db.collection('page_revisions');
const t = { listed: ids.length, ocr_restored: 0, translation_restored: 0, not_flash: 0, human_edit: 0, no_ocr_revision: 0, no_translation_revision: 0 };
const synced = [];
for (const id of ids) {
  const page = await P.findOne({ id }, { projection: { _id: 0, id: 1, ocr: 1, translation: 1 } });
  if (!page || page.ocr?.model !== 'gemini-3-flash-preview') { t.not_flash++; continue; }
  if (page.ocr.source === 'manual' || page.ocr.edited_by) { t.human_edit++; continue; }
  const [rev] = await R.find({ page_id: id, field: 'ocr', model: /flash-lite/, reason: 'reocr_batch' }).sort({ created_at: -1 }).limit(1).toArray();
  if (!rev?.data) { t.no_ocr_revision++; continue; }
  const flashAt = page.ocr.updated_at, flashJob = page.ocr.batch_job_id;
  const retranslated = page.translation?.updated_at > flashAt && !page.translation.edited_by && page.translation.source !== 'manual';
  const [trev] = retranslated ? await R.find({ page_id: id, field: 'translation', reason: 'retranslate_stale', created_at: { $gte: flashAt } }).sort({ created_at: 1 }).limit(1).toArray() : [];
  if (retranslated && !trev?.data) t.no_translation_revision++;
  t.ocr_restored++; if (trev?.data) t.translation_restored++;
  if (!APPLY) continue;
  await saveRevisionsBeforeOverwrite(db, [id], 'ocr', { reason: REASON, keepMeta: true });
  const set = {
    'ocr.data': rev.data, 'ocr.model': rev.model, 'ocr.source': rev.source, 'ocr.updated_at': rev.original_date,
    'ocr.has_warning': /<warning[\s>]/i.test(rev.data), 'ocr.restored': { reason: REASON, at: new Date(), from_revision: rev.id, undone_job: flashJob },
    ...(rev.language ? { 'ocr.language': rev.language } : {}), ...(rev.prompt_version ? { 'ocr.prompt_version': rev.prompt_version } : {}),
    ...(rev.job_id && rev.job_id !== flashJob ? { 'ocr.batch_job_id': rev.job_id } : {}), ...(rev.content_hash ? { 'ocr.content_hash': rev.content_hash } : {}), ...(rev.engine ? { 'ocr.engine': rev.engine } : {}),
    ...liftOcrTags(rev.data),
  };
  const unset = Object.fromEntries(['prompt_id', 'prompt_hash', 'prompt_name', 'input_tokens', 'output_tokens', 'source_url', 'code_version', ...(rev.job_id && rev.job_id !== flashJob ? [] : ['batch_job_id']), ...(rev.content_hash ? [] : ['content_hash']), ...(rev.engine ? [] : ['engine'])].map((k) => [`ocr.${k}`, '']));
  if (trev?.data) {
    await saveRevisionsBeforeOverwrite(db, [id], 'translation', { reason: REASON, keepMeta: true });
    Object.assign(set, {
      'translation.data': trev.data, 'translation.model': trev.model, 'translation.source': trev.source, 'translation.updated_at': trev.original_date,
      'translation.restored': { reason: REASON, at: new Date(), from_revision: trev.id },
      ...(trev.prompt_version ? { 'translation.prompt_version': trev.prompt_version } : {}), ...(trev.content_hash ? { 'translation.content_hash': trev.content_hash } : {}),
    });
    for (const k of ['prompt_id', 'prompt_hash', 'prompt_name', 'engine', 'input_tokens', 'output_tokens', ...(trev.content_hash ? [] : ['content_hash'])]) unset[`translation.${k}`] = '';
  }
  const res = await P.updateOne({ id, 'ocr.model': 'gemini-3-flash-preview', 'ocr.edited_by': { $exists: false }, 'ocr.source': { $ne: 'manual' } }, { $set: set, $unset: unset });
  if (res.modifiedCount) synced.push({ pageId: id, mongoSet: set });
}
if (APPLY && synced.length) { await syncPageBatch(synced); await new Promise((r) => setTimeout(r, 5000)); }
console.log(`${APPLY ? 'APPLIED' : 'DRY RUN'} ${JSON.stringify(t)}`);
await c.close();
