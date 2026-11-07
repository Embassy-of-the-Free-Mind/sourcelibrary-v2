// Rewrite the free-read warnings already written (#7119 inbox, parent session 2026-10-22 21:07): the at-chance
// figure was a scoring artifact. Only the <warning> changes: the new warning (from the same leaf methods) is spliced
// onto the STORED body, which is kept byte for byte. OCR first, through writePageText (#7058: revision row, compare-and-set; new content_hash), then the translation's opening <warning> is
// replaced the same way, so translation.updated_at stays after ocr.updated_at. Edition-anchored-only pages untouched.
//   node --env-file=/root/sourcelibrary/.env.production.local rewrite-free-warnings.mjs [--apply]
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { HERE, BOOK } from './lib.mjs';
import { assemble, loadLocate } from './assemble.mjs';
import { translationWarning } from './translate-plan.mjs';
import { writePageText } from '../../../lib/page-text-writer.mjs';
import { contentHash } from '../../../lib/write-provenance.mjs';
import { recordSweepAction } from '../../../lib/sweep-log.mjs';

const APPLY = process.argv.includes('--apply');
const OLD = /no better than chance/;
const body = (t) => t.slice(t.indexOf('</warning>') + '</warning>'.length);
const c = await MongoClient.connect(process.env.MONGODB_URI);
const db = c.db('bookstore');
const loc = loadLocate();
const ps = await db.collection('pages').find({ book_id: BOOK, 'ocr.pipeline': 'whish147-best-attempt' }, { projection: { id: 1, page_number: 1, ocr: 1, 'translation.data': 1, 'translation.updated_at': 1 } }).sort({ page_number: 1 }).toArray();
const done = [], skipped = [];
for (const p of ps) {
  const ocrOld = OLD.test(p.ocr.data), trOld = OLD.test(p.translation?.data || '');
  if (!ocrOld && !trOld) continue;
  const P = assemble(p.page_number, loc);
  if (P.skip || !p.ocr.data.startsWith('<warning>')) { skipped.push({ n: p.page_number, why: 'cannot rebuild the warning' }); continue; }
  const newText = `<warning>${P.warning}</warning>${body(p.ocr.data)}`;
  const tw = translationWarning(P);
  const newTr = p.translation?.data ? p.translation.data.replace(/^<warning>[\s\S]*?<\/warning>/, `<warning>${tw}</warning>`) : null;
  console.log(`${APPLY ? 'REWRITE' : 'would rewrite'} p.${p.page_number}: ocr ${ocrOld} translation ${trOld}`);
  if (!APPLY) { done.push(p.page_number); continue; }
  fs.writeFileSync(path.join(HERE, 'pages', `${p.page_number}.json`), JSON.stringify({ ...P, text: newText }, null, 1));
  await recordSweepAction(db, { sweep: 'whish147-best-attempt', book_id: BOOK, action: 'free-read-warning-rewrite', detail: { page_id: p.id, page_number: p.page_number, issue: 7119, why: 'free-read figure corrected (row-by-row re-score, CER 0.51 on 7 leaves)' } });
  const opts = { by: 'scripts/eval/results/whish147-best-attempt-2026-10-22/rewrite-free-warnings.mjs', reason: 'free-read warning corrected (#7119)', run_id: `whish147-warning-rewrite-${new Date().toISOString().slice(0, 10)}` };
  if (ocrOld) {
    const r = await writePageText(db, p.id, 'ocr', { ...p.ocr, data: newText, content_hash: contentHash(newText), updated_at: new Date() }, opts);
    if (r.status !== 'written') { skipped.push({ n: p.page_number, why: `OCR: ${r.status}` }); continue; }
  }
  if (newTr && trOld) {
    const cur = await db.collection('pages').findOne({ id: p.id }, { projection: { translation: 1 } });
    const r = await writePageText(db, p.id, 'translation', { ...cur.translation, data: newTr, content_hash: contentHash(newTr), updated_at: new Date() }, opts);
    if (r.status !== 'written') { skipped.push({ n: p.page_number, why: `translation: ${r.status}` }); continue; }
  }
  done.push(p.page_number);
}
console.log(`${APPLY ? 'rewritten' : 'would rewrite'}: ${done.length} [${done.join(' ')}]  skipped: ${JSON.stringify(skipped)}`);
fs.appendFileSync(path.join(HERE, 'write-log.jsonl'), JSON.stringify({ at: new Date().toISOString(), stage: 'free-read-warning-rewrite', apply: APPLY, done, skipped }) + '\n');
await c.close();
