// WRITE (#7119): put the assembled best-attempt OCR of Whish 147 onto its pages, fill-only, with provenance.
// PRIOR ART: scripts/batch/cli-ocr.mjs apply — the writer for one CLI read per page on the live OCR prompt; it refuses
// a text without the prompt's <page-type> header and hashes ONE prompt per page. These pages are composed from a
// locate call, a collation (or two free reads) and an edition excerpt, so this mirrors its fields instead:
// revision snapshot, `ocr` with an anthropic engine block (api 'cli'), ocrProvenance (content_hash), a sweep_log row
// per page (written BEFORE the page), recountBook, one book_events row. `ocr.pipeline` = LANE marks every page for
// a later re-read; `engine.input.whish147` names the method ('edition-anchored' | 'free-read') per leaf.
// Never overwrites: the update filter requires the page to have no OCR text.
//   node --env-file=/root/sourcelibrary/.env.production.local write-ocr.mjs <first> <last> [--apply]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { MongoClient } from 'mongodb';
import { HERE, BOOK, hash16 } from './lib.mjs';
import { saveRevisionBeforeOverwrite } from '../../../lib/page-revisions.mjs';
import { geminiEngine, engineNameForCli, imageInput, ocrProvenance, notRecorded, codeVersion, host, NOT_RECORDED } from '../../../lib/write-provenance.mjs';
import { liftOcrTags } from '../../../lib/ocr-result-parse.mjs';
import { recountBook } from '../../../lib/page-counts.mjs';
import { recordSweepAction } from '../../../lib/sweep-log.mjs';

export const LANE = 'whish147-best-attempt';
const CALL_SITE = 'scripts/eval/results/whish147-best-attempt-2026-10-22/write-ocr.mjs';
const REASON = 'Whish 147 best-attempt OCR with reader warnings (#7119): edition-anchored collation where a leaf was located, free read elsewhere';
const APPLY = process.argv.includes('--apply');
const [a, b] = process.argv.slice(2).filter((x) => !x.startsWith('--')).map(Number);
const NO_OCR = { $or: [{ 'ocr.data': { $exists: false } }, { 'ocr.data': null }, { 'ocr.data': '' }] };

const client = await MongoClient.connect(process.env.MONGODB_URI);
const db = client.db('bookstore');
const cliVersion = spawnSync('claude', ['--version'], { encoding: 'utf8' }).stdout.trim();
const CODE = await codeVersion();
const runId = `${LANE}-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
const written = [], skipped = [];
for (let n = a; n <= b; n++) {
  const f = path.join(HERE, 'pages', `${n}.json`);
  if (!fs.existsSync(f)) { skipped.push({ n, why: 'not assembled' }); continue; }
  const P = JSON.parse(fs.readFileSync(f, 'utf8'));
  if (P.skip) { skipped.push({ n, why: P.skip }); continue; }
  const page = await db.collection('pages').findOne({ book_id: BOOK, page_number: n }, { projection: { id: 1, page_number: 1, archived_photo: 1, image_width: 1, ocr: 1 } });
  if (!page) { skipped.push({ n, why: 'page not found' }); continue; }
  if (page.ocr?.data) { skipped.push({ n, why: `page already has OCR (${page.ocr.model}); never overwritten here` }); continue; }
  if (!P.text.startsWith('<warning>')) throw new Error(`p.${n}: assembled text does not open with its warning`);
  const promptText = P.prompts.map((h) => fs.readFileSync(path.join(HERE, 'reads', 'prompts', `${h}.txt`), 'utf8')).join('\n\n===== next call =====\n\n');
  const models = [...new Set(Object.values(P.leaves).map((l) => l.model).filter(Boolean))];
  const engine = geminiEngine({
    name: engineNameForCli('claude'), call_site: CALL_SITE, api: 'cli', cli: { name: 'claude', version: cliVersion }, model: models.join('+'),
    // Page 3 reuses the #7106 contents-leaf read, whose exact prompt text was not kept (live OCR prompt v19.1).
    prompt: P.prompts.length ? { name: `${LANE}/${P.methods.join('+')}`, version: '1', text: promptText } : { name: 'Standard OCR (claude-ocr.mjs, #7106)', version: '19.1', sent_hash: NOT_RECORDED },
    generationConfig: notRecorded('claude -p exposes no temperature, output cap or thinking setting; the model id names the tier'),
    run: { job_id: runId, code_version: CODE, host: host(), at: new Date(), reason: REASON },
    input: { ...imageInput({ url: page.archived_photo, mime: 'image/jpeg' }), whish147: { methods: P.methods, leaves: P.leaves, prompt_hashes: P.prompts, reads_dir: 'scripts/eval/results/whish147-best-attempt-2026-10-22/reads', issue: 7119 } },
  });
  console.log(`${APPLY ? 'WRITE' : 'would write'} p.${n} ${P.methods.join('+')} ${P.text.length} chars (${models.join('+')})`);
  if (!APPLY) { written.push(n); continue; }
  await recordSweepAction(db, { sweep: LANE, book_id: BOOK, action: 'ocr-best-attempt-write', detail: { page_id: page.id, page_number: n, methods: P.methods, models, run: runId, text_hash: hash16(P.text), reason: REASON } });
  await saveRevisionBeforeOverwrite(db, page.id, 'ocr', { reason: LANE });
  const r = await db.collection('pages').updateOne({ id: page.id, ...NO_OCR }, { $set: {
    ocr: { data: P.text, language: 'Sanskrit', model: models.join('+'), updated_at: new Date(), source: 'ai', pipeline: LANE, ...ocrProvenance(P.text, engine) },
    ...liftOcrTags(P.text),
    updated_at: new Date(),
  } });
  if (r.modifiedCount !== 1) { skipped.push({ n, why: 'page gained OCR between check and write' }); continue; }
  written.push(n);
}
if (APPLY && written.length) {
  await recountBook(db, BOOK, { reason: LANE });
  await db.collection('book_events').insertOne({ book_id: BOOK, type: 'ocr_best_attempt', at: new Date(), source: CALL_SITE, details: { run: runId, api: 'cli', pages: written.length, page_numbers: written, reason: REASON, issue: 7119 } });
}
console.log(`\n${APPLY ? 'written' : 'would write'}: ${written.length}  skipped: ${JSON.stringify(skipped)}`);
fs.appendFileSync(path.join(HERE, 'write-log.jsonl'), JSON.stringify({ at: new Date().toISOString(), stage: 'ocr', apply: APPLY, run: runId, range: [a, b], written, skipped }) + '\n');
await client.close();
