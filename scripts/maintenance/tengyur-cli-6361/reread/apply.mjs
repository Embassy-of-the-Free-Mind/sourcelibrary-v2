#!/usr/bin/env node
// PRIOR ART: ../gates.mjs (step 2's per-page predicates and per-volume length-ratio gate) and ../apply.mjs (step 4's
// checked write through writePageTranslation) — both read stage 1's run directory and manifest; this applies the same
// predicates and the same write to the re-read's directory (driver.mjs), whose rows carry a nudge. gates.mjs is a
// report, not a module, so its predicate sequence is repeated here line for line.
//
// #6361 item 3: gate the re-read English of the 6,494 not-applicable pages and write what passes. Dry run unless
// --apply. Per page: response/prompt/OCR sha256 against the manifests, then the gates (headline reasoning leak, refusal,
// hardened cliChatterReason, plan-mode regex, empty, the door's health and stray-script predicates). Per volume: the
// median length ratio of the passing pages must sit inside the stored English's p5–p95 (results/gates.json), else the
// whole volume is held back. Then: stored English unchanged since the stage-2 snapshot, the write door (human-edit
// guard, page_revisions snapshot, health gate), provenance api 'cli' with run.nudged.
//
//   node --env-file=/root/sourcelibrary/.env.production.local scripts/maintenance/tengyur-cli-6361/reread/apply.mjs \
//     --dir=$JOB_SCRATCH/reread --stored=<stored-before.jsonl.gz> --out=$JOB_SCRATCH/reread-apply [--apply] [--limit=N]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { MongoClient } from 'mongodb';
import { writePageTranslation, syncBookTranslationCounters, contentHash, sanitizeTranslationTags, guardTranslationText, assessTranslationHealth } from '../../../lib/translate-core.mjs';
import { unwrapHiddenTranslation } from '../../../lib/hidden-translation.mjs';
import { strayScriptVerdict } from '../../../lib/stray-script.mjs';
import { translationReasoningLeak, refusableReasoningLeak, sourceProse, translationProse } from '../../../lib/page-integrity.mjs';
import { cliChatterReason } from '../../../lib/cli-chatter.mjs';
import { geminiEngine, translationInput, notRecorded, codeVersion, host } from '../../../lib/write-provenance.mjs';
import { recordSweepAction } from '../../../lib/sweep-log.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const CALL_SITE = 'scripts/maintenance/tengyur-cli-6361/reread/apply.mjs';
const RUN_ID = 'tengyur-cli-6361-reread';
const W = '/root/tengyur-cli-6361';
const NUDGE = 'Do not write a plan. Output the English translation of the attached page now, exactly as instructed above.'; // driver.mjs
const REASON = '#6361 item 3: re-read of a page stage 1 left not applicable (mostly plan-mode replies), same model and v13 prompt through the Antigravity CLI; a plan note / empty reply was continued once with a fixed nudge (run.nudged); same gates as stage 2; per-volume by-eye stop rule waived by Derek 2026-10-10 (#6420: convergent AI check in place of a human read for a month)';
const REFUSAL = /^\s*(I'?m sorry|I am sorry|I cannot|I can'?t|I am unable|I'?m unable|I will not|I won'?t)\b/i;
const BLOCK_MSG = "This request was blocked by Gemini's filters";
const PLAN_MODE = /file:\/\/\/|\.gemini\/|implementation plan|translation_plan|plan\.md|(?:please (?:review|confirm|let me know|approve)|let me know (?:if|whether)|would you like (?:me )?to|once (?:you )?approv|output contract|\/plan\b|the user(?:'s)? (?:prompt|request|instruction)|my (?:task|instructions)|the prompt (?:says|asks|requires))/i; // gates.mjs
const MIN_SRC = 100;
const SNAPSHOT_AT = new Date('2026-10-10T14:20:00Z'); // stage 2 took stored-before.jsonl.gz after this (its "taking this", #6361)
const ACCEPTED_SINCE = new Set(['cleanup-markup-5700']);

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const DIR = arg('dir'), STORED = arg('stored'), OUT = arg('out');
const APPLY = process.argv.includes('--apply');
const LIMIT = Number(arg('limit', 0)) || Infinity;
if (!DIR || !STORED || !OUT) throw new Error('--dir, --stored and --out are required');
fs.mkdirSync(OUT, { recursive: true });
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const jl = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const q = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))]; };

const scope = JSON.parse(fs.readFileSync(path.join(W, 'scope.json'), 'utf8'));
const promptRef = scope.prompt.pinned;
const gatesTable = new Map(JSON.parse(fs.readFileSync(path.join(HERE, '..', 'results', 'gates.json'), 'utf8')).table.map((t) => [t.vol, t]));
const stored = new Map(zlib.gunzipSync(fs.readFileSync(STORED)).toString('utf8').split('\n').filter(Boolean).map((l) => { const r = JSON.parse(l); return [r.page_id, r]; }));
const manifest = jl(path.join(DIR, 'manifest.jsonl'));
const pagesById = new Map(jl(path.join(W, 'pages.jsonl')).map((p) => [p.page_id, p]));

// ---- gates (files only) ----
const rows = [];
const reasonsCount = {};
for (const m of manifest) {
  const row = { page_id: m.page_id, book_id: m.book_id, vol: m.vol, page_number: m.page_number, nudged: m.nudged, accepted_by_nudge: m.accepted_by_nudge, reasons: [] };
  rows.push(row);
  if (m.status !== 'staged') { row.reasons.push(`reread-failed:${m.last_class}`); continue; }
  const rec = JSON.parse(fs.readFileSync(path.join(DIR, 'out', `${m.page_id}.json`), 'utf8'));
  const raw = (rec.agy.response || '').trim();
  row.raw = raw; row.rec = rec; row.m = m;
  if (sha(raw) !== m.response_sha256) { row.reasons.push('response sha256 != manifest'); continue; }
  if (m.prompt_sha256 !== pagesById.get(m.page_id)?.prompt_sha256) { row.reasons.push('prompt sha256 != stage-1 pages.jsonl'); continue; }
  const s = stored.get(m.page_id);
  if (!s) { row.reasons.push('no stored snapshot'); continue; }
  if (sha(s.ocr || '') !== m.ocr_sha256) { row.reasons.push('snapshot OCR != manifest'); continue; }
  const leak = translationReasoningLeak(raw);
  if (refusableReasoningLeak(raw)) row.reasons.push(`reasoning-leak:${leak.kind}`);
  if (REFUSAL.test(raw) || raw.includes(BLOCK_MSG)) row.reasons.push('refusal');
  const chat = cliChatterReason(raw);
  if (chat) row.reasons.push(`chatter:${chat}`);
  if (PLAN_MODE.test(raw)) row.reasons.push(`plan-mode:${raw.match(PLAN_MODE)[0].slice(0, 40)}`);
  let clean = unwrapHiddenTranslation({ ocr: s.ocr, tr: guardTranslationText(sanitizeTranslationTags(raw)), type: s.page_type }).text;
  const stray = strayScriptVerdict(clean, { ocr: s.ocr, language: 'Tibetan' });
  clean = stray.text;
  if (translationProse(clean).length < 20) row.reasons.push('empty');
  const health = assessTranslationHealth(s.ocr, clean, { lang: 'Tibetan' });
  if (!health.healthy) row.reasons.push(`door:${health.reason}`);
  else if (stray.refuse) row.reasons.push('door:stray-script');
  const src = sourceProse(s.ocr || '').length;
  if (src >= MIN_SRC && !row.reasons.length) row.ratio = translationProse(clean).length / src;
}
for (const r of rows) for (const why of r.reasons) { const k = why.split(':').slice(0, 2).join(':'); reasonsCount[k] = (reasonsCount[k] || 0) + 1; }

const vols = new Map();
for (const r of rows) {
  const v = vols.get(r.vol) ?? vols.set(r.vol, { vol: r.vol, pages: 0, passing: 0, nudged_passing: 0, ratios: [] }).get(r.vol);
  v.pages++;
  if (!r.reasons.length) { v.passing++; if (r.nudged) v.nudged_passing++; if (r.ratio != null) v.ratios.push(r.ratio); }
}
const volTable = [...vols.values()].sort((a, b) => a.vol - b.vol).map((v) => {
  const t = gatesTable.get(v.vol);
  const med = q(v.ratios, 0.5);
  const gate = med == null ? true : med >= t.stored_ratio_p5 && med <= t.stored_ratio_p95; // no ratio pages → nothing to compare; the page gates stand
  return { vol: v.vol, section: t.section, pages: v.pages, passing: v.passing, nudged_passing: v.nudged_passing, ratio_pages: v.ratios.length,
    reread_ratio_median: med == null ? null : Math.round(med * 1000) / 1000, stored_ratio_p5: t.stored_ratio_p5, stored_ratio_p95: t.stored_ratio_p95, gate_ratio: gate };
});
const failedVols = new Set(volTable.filter((v) => !v.gate_ratio).map((v) => v.vol));
for (const r of rows) if (!r.reasons.length && failedVols.has(r.vol)) r.reasons.push('volume length-ratio gate');
const applicable = rows.filter((r) => !r.reasons.length);
const summary = {
  at: new Date().toISOString(), manifest: manifest.length, staged: manifest.filter((m) => m.status === 'staged').length,
  reread_failed: manifest.filter((m) => m.status !== 'staged').length, applicable: applicable.length,
  applicable_nudged: applicable.filter((r) => r.nudged).length, applicable_accepted_by_nudge: applicable.filter((r) => r.accepted_by_nudge).length,
  refused_reasons: reasonsCount, volumes_failing_ratio: [...failedVols],
};
fs.writeFileSync(path.join(OUT, 'gates.json'), JSON.stringify({ ...summary, table: volTable }, null, 1));
fs.writeFileSync(path.join(OUT, 'not-applicable.tsv'), 'page_id\tvol\tpage_number\treason\n' + rows.filter((r) => r.reasons.length).map((r) => `${r.page_id}\t${r.vol}\t${r.page_number}\t${r.reasons.join('; ')}`).join('\n') + '\n');
fs.writeFileSync(path.join(OUT, 'applicable.tsv'), 'page_id\tvol\tpage_number\tnudged\taccepted_by_nudge\n' + applicable.map((r) => `${r.page_id}\t${r.vol}\t${r.page_number}\t${r.nudged}\t${r.accepted_by_nudge}`).join('\n') + '\n');
console.log(JSON.stringify(summary, null, 1));

// ---- write ----
const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
await client.connect();
const db = client.db('bookstore');
const code_version = await codeVersion();
const LOG = path.join(OUT, APPLY ? 'apply.jsonl' : 'apply.dry.jsonl');
const done = new Set(fs.existsSync(LOG) ? jl(LOG).filter((r) => r.written).map((r) => r.page_id) : []);
const log = fs.createWriteStream(LOG, { flags: 'a' });
const tally = { written: 0, skipped: {} };
const touched = {};
const books = new Map();
const PROJ = { id: 1, book_id: 1, page_number: 1, page_type: 1, ocr: 1, translation: 1 };
const todo = applicable.filter((r) => !done.has(r.page_id)).slice(0, LIMIT === Infinity ? undefined : LIMIT);
for (let i = 0; i < todo.length; i += 200) {
  const chunk = todo.slice(i, i + 200);
  const pages = new Map((await db.collection('pages').find({ id: { $in: chunk.map((r) => r.page_id) } }, { projection: PROJ }).toArray()).map((p) => [p.id, p]));
  for (const r of chunk) {
    const { m, rec, raw } = r;
    const skip = (why) => { tally.skipped[why] = (tally.skipped[why] || 0) + 1; log.write(JSON.stringify({ page_id: r.page_id, vol: r.vol, page_number: r.page_number, written: false, why, dry: !APPLY }) + '\n'); };
    const promptText = fs.readFileSync(path.join(W, 'prompts', `${r.page_id}.txt`), 'utf8');
    if (sha(promptText) !== m.prompt_sha256) { skip('prompt sha256 != manifest'); continue; }
    const page = pages.get(r.page_id);
    if (!page) { skip('page not found'); continue; }
    if (sha(page.ocr?.data || '') !== m.ocr_sha256) { skip('OCR changed since staging'); continue; }
    if ((page.translation?.data || '') !== (stored.get(r.page_id)?.translation?.data || '')) {
      // The one change accepted: the deterministic markup cleanup of the OLD English (#5700, decisions-data,
      // 2026-10-10 16:52; no model). Any other revision since the snapshot (a person, another run) refuses the page.
      const since = await db.collection('page_revisions').find({ page_id: r.page_id, field: 'translation', created_at: { $gt: SNAPSHOT_AT } }, { projection: { source: 1 } }).toArray();
      if (!since.length || since.some((x) => !ACCEPTED_SINCE.has(x.source))) { skip('stored English changed since the stage-2 snapshot'); continue; }
    }
    if (!books.has(page.book_id)) books.set(page.book_id, await db.collection('books').findOne({ id: page.book_id }));
    const book = books.get(page.book_id);
    if (!APPLY) { tally.written++; continue; }
    const engine = geminiEngine({
      call_site: CALL_SITE, api: 'cli', cli: { name: 'agy', version: m.agy_version }, model: m.model,
      prompt: { id: promptRef.id, name: promptRef.name, version: promptRef.version, hash: promptRef.content_hash, text: promptText },
      generationConfig: notRecorded('agy -p exposes no temperature, output cap or thinking setting; the model id names the tier'),
      run: { job_id: RUN_ID, code_version, host: host(), at: new Date(rec.finished), read_started_at: rec.started, via: 'antigravity-cli', account: m.account,
        conversation_id: m.conversation_id, prompt_version: m.prompt_version, ocr_sha256: m.ocr_sha256, response_sha256: m.response_sha256,
        nudged: !!m.nudged, accepted_by_nudge: !!m.accepted_by_nudge, ...(m.nudged ? { nudge: { text: NUDGE, sha256: sha(NUDGE) } } : {}),
        calls: m.calls, stage1_reason: m.na_reason, reason: REASON },
      input: translationInput({ ocrText: page.ocr?.data ?? '', ocrUpdatedAt: page.ocr?.updated_at, context: { previous_translation: false, prev_ocr: false, next_ocr: false, page_break: 'scoped' } }),
    });
    const res = await writePageTranslation(db, { page, book, text: raw, promptRef, model: m.model, jobId: RUN_ID, note: 'retranslate-cli-6361-reread', refuseUnhealthy: true, engine });
    if (res.protected) { skip('human-edited translation'); continue; }
    if (res.unhealthy) { skip(`refused by the door: ${res.reason}`); continue; }
    await recordSweepAction(db, { sweep: 'tengyur-cli-6361', book_id: page.book_id, action: 'translated-through-cli', detail: { page_id: page.id, page_number: page.page_number, from_model: page.translation?.model ?? null, to_model: m.model, cli: `agy ${m.agy_version}`, run: RUN_ID, nudged: !!m.nudged } });
    (touched[page.book_id] ??= []).push(page.page_number);
    log.write(JSON.stringify({ page_id: r.page_id, vol: r.vol, page_number: r.page_number, written: true, nudged: !!m.nudged, content_hash: contentHash(res.text) }) + '\n');
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
