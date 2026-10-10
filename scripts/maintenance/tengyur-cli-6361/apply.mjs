#!/usr/bin/env node
// PRIOR ART: scripts/batch/cli-translate.mjs apply — the CLI read → write path this follows (same door, same engine
// block shape, same sweep/book_events rows). It reads its own read stage's DIR/<id>.txt + .meta.json; this run's stage 1
// wrote agy JSON + manifest.jsonl with sha256s, and the contract asks for checks cli-translate does not make (prompt,
// response and OCR sha256 against the manifest, stored English unchanged since the gates' snapshot).
//
// #6361 stage 2, step 4: write the gate-passing staged English through writePageTranslation (human-edit guard,
// page_revisions snapshot of the old English, health gate on, provenance with api 'cli'). Dry run unless --apply.
// Derek, 2026-10-10 (Decision Deck): the per-volume by-eye stop rule is WAIVED on the record (21 pages read by eye:
// staged 7 serious errors vs stored 14); apply the 17,135 pages that passed steps 1–2.
//
//   node --env-file=/root/sourcelibrary/.env.production.local scripts/maintenance/tengyur-cli-6361/apply.mjs \
//     --run=/root/tengyur-cli-6361 --stored=<stored-before.jsonl.gz> \
//     --na=scripts/maintenance/tengyur-cli-6361/results/not-applicable.tsv --log=$JOB_SCRATCH/apply.jsonl [--apply] [--limit=N]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { MongoClient } from 'mongodb';
import { writePageTranslation, syncBookTranslationCounters, contentHash } from '../../lib/translate-core.mjs';
import { cliChatterReason } from '../../lib/cli-chatter.mjs';
import { geminiEngine, translationInput, notRecorded, codeVersion, host } from '../../lib/write-provenance.mjs';
import { recordSweepAction } from '../../lib/sweep-log.mjs';

const CALL_SITE = 'scripts/maintenance/tengyur-cli-6361/apply.mjs';
const RUN_ID = 'tengyur-cli-6361';
const EXPECTED = 17135;
const REASON = '#6361: Tengyur Pramāṇa + Madhyamaka re-translated with gemini-3.8-flash-low through the Antigravity CLI; gates passed; per-volume by-eye stop rule waived by Derek 2026-10-10 (21 pages: staged 7 serious errors vs stored 14)';
const PLAN_MODE = /file:\/\/\/|\.gemini\/|implementation plan|translation_plan|plan\.md|(?:please (?:review|confirm|let me know|approve)|let me know (?:if|whether)|would you like (?:me )?to|once (?:you )?approv|output contract|\/plan\b|the user(?:'s)? (?:prompt|request|instruction)|my (?:task|instructions)|the prompt (?:says|asks|requires))/i; // gates.mjs
const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const W = arg('run', '/root/tengyur-cli-6361');
const STORED = arg('stored'), NA = arg('na'), LOG = arg('log');
const APPLY = process.argv.includes('--apply');
const LIMIT = Number(arg('limit', 0)) || Infinity;
if (!STORED || !NA || !LOG) throw new Error('--stored, --na and --log are required');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

const scope = JSON.parse(fs.readFileSync(path.join(W, 'scope.json'), 'utf8'));
const promptRef = scope.prompt.pinned;
const notApplicable = new Set(fs.readFileSync(NA, 'utf8').split('\n').slice(1).filter(Boolean).map((l) => l.split('\t')[0]));
const stored = new Map(zlib.gunzipSync(fs.readFileSync(STORED)).toString('utf8').split('\n').filter(Boolean).map((l) => { const r = JSON.parse(l); return [r.page_id, r]; }));
const manifest = fs.readFileSync(path.join(W, 'manifest.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const todo = manifest.filter((m) => m.status === 'staged' && !notApplicable.has(m.page_id));
console.log(`manifest ${manifest.length}, not applicable ${notApplicable.size}, applicable ${todo.length} (expected ${EXPECTED})`);
if (todo.length !== EXPECTED) throw new Error(`applicable count ${todo.length} != ${EXPECTED}: the gates' list and the manifest disagree; stop`);

const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
await client.connect();
const db = client.db('bookstore');
const code_version = await codeVersion();
const log = fs.createWriteStream(LOG, { flags: 'a' });
const tally = { written: 0, skipped: {} };
const touched = {};
const done = new Set(fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.written).map((r) => r.page_id) : []);
const PROJ = { id: 1, book_id: 1, page_number: 1, page_type: 1, ocr: 1, translation: 1 };
const books = new Map();
let n = 0;
for (let i = 0; i < todo.length && n < LIMIT; i += 200) {
  const chunk = todo.slice(i, i + 200).filter((m) => !done.has(m.page_id));
  const pages = new Map((await db.collection('pages').find({ id: { $in: chunk.map((m) => m.page_id) } }, { projection: PROJ }).toArray()).map((p) => [p.id, p]));
  for (const m of chunk) {
    if (n++ >= LIMIT) break;
    const skip = (why) => { tally.skipped[why] = (tally.skipped[why] || 0) + 1; log.write(JSON.stringify({ page_id: m.page_id, vol: m.vol, page_number: m.page_number, written: false, why }) + '\n'); };
    const raw = (JSON.parse(fs.readFileSync(path.join(W, 'out', `${m.page_id}.json`), 'utf8')).agy.response || '').trim();
    const promptText = fs.readFileSync(path.join(W, 'prompts', `${m.page_id}.txt`), 'utf8');
    if (sha(promptText) !== m.prompt_sha256) { skip('prompt sha256 != manifest'); continue; }
    if (sha(raw) !== m.response_sha256) { skip('response sha256 != manifest'); continue; }
    if (cliChatterReason(raw) || PLAN_MODE.test(raw)) { skip('chatter or plan-mode reply'); continue; }
    const page = pages.get(m.page_id);
    if (!page) { skip('page not found'); continue; }
    if (sha(page.ocr?.data || '') !== m.ocr_sha256) { skip('OCR changed since staging'); continue; }
    const before = stored.get(m.page_id)?.translation?.data || '';
    if ((page.translation?.data || '') !== before) { skip('stored English changed since the gates snapshot'); continue; }
    if (!books.has(page.book_id)) books.set(page.book_id, await db.collection('books').findOne({ id: page.book_id }));
    const book = books.get(page.book_id);
    if (!APPLY) { tally.written++; continue; }
    const engine = geminiEngine({
      call_site: CALL_SITE, api: 'cli', cli: { name: 'agy', version: m.agy_version }, model: m.model,
      prompt: { id: promptRef.id, name: promptRef.name, version: promptRef.version, hash: promptRef.content_hash, text: promptText },
      generationConfig: notRecorded('agy -p exposes no temperature, output cap or thinking setting; the model id names the tier'),
      run: { job_id: RUN_ID, code_version, host: host(), at: new Date(m.finished), read_started_at: m.started, via: 'antigravity-cli', account: m.account,
        conversation_id: m.conversation_id, prompt_version: m.prompt_version, ocr_sha256: m.ocr_sha256, response_sha256: m.response_sha256, reason: REASON },
      input: translationInput({ ocrText: page.ocr?.data ?? '', ocrUpdatedAt: page.ocr?.updated_at, context: { previous_translation: false, prev_ocr: false, next_ocr: false, page_break: 'scoped' } }),
    });
    const res = await writePageTranslation(db, { page, book, text: raw, promptRef, model: m.model, jobId: RUN_ID, note: 'retranslate-cli-6361', refuseUnhealthy: true, engine });
    if (res.protected) { skip('human-edited translation'); continue; }
    if (res.unhealthy) { skip(`refused by the door: ${res.reason}`); continue; }
    await recordSweepAction(db, { sweep: 'tengyur-cli-6361', book_id: page.book_id, action: 'translated-through-cli', detail: { page_id: page.id, page_number: page.page_number, from_model: page.translation?.model ?? null, to_model: m.model, cli: `agy ${m.agy_version}`, run: RUN_ID } });
    (touched[page.book_id] ??= []).push(page.page_number);
    log.write(JSON.stringify({ page_id: m.page_id, vol: m.vol, page_number: m.page_number, written: true, content_hash: contentHash(res.text) }) + '\n');
    tally.written++;
  }
  if (APPLY) process.stdout.write(`\r${Math.min(i + 200, todo.length)}/${todo.length} written ${tally.written}`);
}
if (APPLY) {
  for (const [bookId, nums] of Object.entries(touched)) {
    await syncBookTranslationCounters(db, bookId);
    await db.collection('book_events').insertOne({ book_id: bookId, type: 'translated_cli', at: new Date(), source: CALL_SITE, details: { run: RUN_ID, api: 'cli', models: ['gemini-3.8-flash-low'], pages: nums.length, page_numbers: nums.sort((a, b) => a - b), reason: REASON } });
  }
}
await new Promise((r) => log.end(r));
console.log(`\n${APPLY ? 'written' : 'would write'}: ${tally.written}   skipped: ${JSON.stringify(tally.skipped)}${APPLY ? '' : '   (dry run; add --apply)'}`);
await client.close();
