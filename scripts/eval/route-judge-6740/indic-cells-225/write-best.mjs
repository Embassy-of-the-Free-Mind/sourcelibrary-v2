#!/usr/bin/env node
// PRIOR ART: scripts/batch/cli-ocr.mjs `apply` (the engine block, ocrProvenance, writePageText call this copies) — it
// refuses a read made over a --draft-file draft (an eval read) and has no path for d-diff.mjs outputs, which are two of
// the #225 arms; scripts/lib/page-text-writer.mjs writePageText is the one writer used here, unchanged.
/**
 * write-best (#225, job indic-ocr-tests-225): for each judged page of the two OCR cell tests, the best ACCEPTED read
 * (Opus judge, blind, image attached) becomes the page's first OCR text, with the read's provenance and the test as its
 * evidence. Pages with no accepted read are left unread. Only a page that has NO OCR is written (compare-and-set on
 * the empty field); books stay hidden and held: nothing here touches `books` or a hold.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local write-best.mjs --run=<job run dir> --out=<results dir> [--apply]
 *
 * Best = accept, then highest fidelity, then fewest wrong_text defects, then fewest misleads, then the arm order below
 * (the cell's measured order). Dry run by default; --apply writes, under one run id that
 * scripts/maintenance/revert-run.mjs --run-id <id> undoes. Writes <out>/writes.json (the plan / what was written).
 */
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { MongoClient } from 'mongodb';
import { writePageText, textHash } from '../../../lib/page-text-writer.mjs';
import { geminiEngine, imageInput, ocrProvenance, notRecorded, contentHash, codeVersion, host } from '../../../lib/write-provenance.mjs';
import { checkWrittenText } from '../../../lib/write-text-guard.mjs';

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
if (!arg('run') || !arg('out')) { console.error('usage: write-best.mjs --run=<job run dir> --out=<results dir> [--apply]'); process.exit(2); }
const RUN = path.resolve(arg('run')), OUT = path.resolve(arg('out')), APPLY = process.argv.includes('--apply');
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../../..');
const TEST = 'scripts/eval/route-judge-6740/results/indic-ocr-cells-225/';
const RUN_ID = `indic-ocr-cells-225-${new Date().toISOString().slice(0, 10)}`;
const LANE = 'indic-ocr-225-eval';
const J = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const jsonl = (f) => (f.endsWith('.gz') ? zlib.gunzipSync(fs.readFileSync(f)).toString('utf8') : fs.readFileSync(f, 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l));
const ORDER = { tamil: ['ia>agy', 'surya>agy', 'agy'], series: ['gpu2>agy', 'agy'] };
const ARM_DIR = { 'tamil|agy': 'arms/ta-agy', 'tamil|ia>agy': 'arms/ta-ia-agy', 'tamil|surya>agy': 'arms/ta-surya-agy', 'series|agy': 'arms/sx-agy', 'series|gpu2>agy': 'gpu2/e2/D-r1' };
const DRAFT = { 'tamil|ia>agy': { name: 'Internet Archive OCR of the leaf (_djvu.xml)', files: ['ia-drafts-kov.json', 'ia-drafts-tor.json'] },
  'tamil|surya>agy': { name: 'Surya 2 (gex45, scripts/gpu/surya-print-gpu.sh)', files: ['surya-drafts-ta.json'] } };

const key = J(path.join(OUT, 'key.json')), items = new Map(J(path.join(OUT, 'packet.json')).items.map((i) => [i.id, i]));
const V = new Map(); for (const r of jsonl(path.join(OUT, 'verdicts-opus.jsonl.gz'))) if (r.verdict) V.set(r.id, r);
const sev = (v, s) => (v.defects || []).filter((d) => d.severity === s).length;

// d-diff's prompt is not kept per page: rebuild it (--dump-sent) and require its hash to match the one the call recorded.
const dumpDir = path.join(process.env.TMPDIR || '/tmp', `write-best-dump-${process.pid}`);
const series = key.filter((k) => k.cell === 'series' && k.route === 'gpu2>agy' && k.kind === 'item').map((k) => k.page_id);
if (series.length) {
  fs.mkdirSync(dumpDir, { recursive: true });
  const only = path.join(dumpDir, 'only.txt'); fs.writeFileSync(only, series.join('\n'));
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/eval/gpu-flash-vs-opus-7263/d-diff.mjs'), '--arm=D', '--round=1', `--dump-sent=${dumpDir}`],
    { env: { ...process.env, J: path.join(RUN, 'gpu2'), D_DIFF_PANEL: path.join(RUN, 'gpu2/panel.json') }, encoding: 'utf8' });
  if (r.status !== 0) { console.error(r.stderr || r.stdout); process.exit(1); }
}
const sha16 = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);

const best = new Map();
for (const k of key) {
  if (k.kind !== 'item') continue;
  const r = V.get(k.judged_as); if (!r?.verdict.accept) continue;
  const v = r.verdict, c = { k, v, r, score: [Number(v.fidelity), -sev(v, 'wrong_text'), -sev(v, 'misleads'), -ORDER[k.cell].indexOf(k.route)] };
  const cur = best.get(k.page_id);
  const i = cur ? c.score.findIndex((x, j) => x !== cur.score[j]) : -1;
  if (!cur || (i >= 0 && c.score[i] > cur.score[i])) best.set(k.page_id, c);
}

const CODE_VERSION = await codeVersion();
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db('bookstore');
const plan = [], tally = { pages_judged: new Set(key.filter((k) => k.kind === 'item').map((k) => k.page_id)).size, best: best.size, written: 0, skipped: 0 };
for (const [pid, { k, v, r }] of best) {
  const text = items.get(k.judged_as).text;
  const page = await db.collection('pages').findOne({ id: pid }, { projection: { id: 1, book_id: 1, page_number: 1, ocr: 1, photo: 1 } });
  const row = { page_id: pid, book_id: k.book_id, page_number: k.page_number, cell: k.cell, route: k.route, verdict_id: r.id, fidelity: v.fidelity, chars: text.length, text_hash: contentHash(text) };
  const skip = (why) => { row.skipped = why; tally.skipped++; plan.push(row); };
  if (!page) { skip('page not found'); continue; }
  if (page.ocr?.data) { skip(`page already has OCR (${page.ocr.model ?? '?'})`); continue; }
  const guard = checkWrittenText(text, { kind: 'ocr', source: '', lang: k.cell === 'tamil' ? 'Tamil' : 'Sanskrit' });
  if (guard?.verdict && guard.verdict !== 'ok') { skip(`write guard: ${guard.verdict} ${guard.reasons?.[0] ?? ''}`); continue; }
  const dir = path.join(RUN, ARM_DIR[`${k.cell}|${k.route}`]);
  let m, sent, draft = null;
  if (k.route === 'gpu2>agy') {
    m = J(path.join(dir, `${pid}.json`));
    sent = fs.readFileSync(path.join(dumpDir, `${pid}.txt`), 'utf8');
    if (sha16(sent) !== m.sent_hash) { skip('d-diff prompt cannot be reconstructed (hash mismatch)'); continue; }
    m = { ...m, cli: 'agy', cli_version: 'see agy-cli.mjs', started_at: null, image_url: items.get(k.judged_as).image_url };
    draft = { source: 'gpu', engines: ['LightOnOCR-3-1B (gex45, scripts/gpu/gpu-print-gpu.sh)', 'Surya 2 (gex45, scripts/gpu/surya-print-gpu.sh)'], diff: 'd-diff.mjs round 1',
      draft1_hash: contentHash(jsonl(path.join(RUN, 'gpu2/drafts/X.jsonl')).find((x) => x.page_id === pid).text), draft2_hash: contentHash(jsonl(path.join(RUN, 'gpu2/drafts/Y.jsonl')).find((x) => x.page_id === pid).text) };
  } else if (k.route === 'agy') {
    // A fresh read is cli-ocr's own: its `apply` (every guard, the prompt rebuilt from prompt-base.txt) writes it. Copy
    // the page's files to a subset dir; the caller runs cli-ocr.mjs apply on it.
    const sub = path.join(RUN, 'apply-fresh', k.cell); fs.mkdirSync(sub, { recursive: true });
    for (const f of ['prompt-base.txt', 'prompt-ref.json']) if (fs.existsSync(path.join(dir, f))) fs.copyFileSync(path.join(dir, f), path.join(sub, f));
    for (const f of fs.readdirSync(dir).filter((f) => f.startsWith(`${pid}.`))) fs.copyFileSync(path.join(dir, f), path.join(sub, f));
    if (fs.existsSync(path.join(dir, `ws-${pid}`))) fs.cpSync(path.join(dir, `ws-${pid}`), path.join(sub, `ws-${pid}`), { recursive: true });
    row.would = 'cli-ocr apply'; row.apply_dir = sub; plan.push(row); continue;
  } else {
    m = J(path.join(dir, `${pid}.meta.json`));
    sent = fs.readFileSync(path.join(dir, m.prompt_sent_file), 'utf8');
    if (contentHash(sent) !== m.prompt_sent_hash) { skip('prompt sent cannot be reconstructed (hash mismatch)'); continue; }
    if (m.draft) draft = { ...m.draft, source: DRAFT[`${k.cell}|${k.route}`]?.name ?? m.draft.source };
  }
  const engine = geminiEngine({
    name: 'gemini', call_site: k.route === 'gpu2>agy' ? 'scripts/eval/gpu-flash-vs-opus-7263/d-diff.mjs' : 'scripts/batch/cli-ocr.mjs', api: 'cli',
    cli: { name: 'agy', version: String(m.cli_version) }, model: m.model,
    prompt: { id: `indic-ocr-225:${k.cell}:${k.route}`, name: `#225 cell test arm ${k.route}`, version: contentHash(sent), text: sent },
    generationConfig: notRecorded('agy -p exposes no temperature, output cap or thinking setting; the model id names the tier'),
    run: { job_id: 'indic-ocr-tests-225', code_version: CODE_VERSION, host: host(), at: new Date(m.finished_at), reason: `#225 OCR cell test (${TEST}): best accepted read of the page, Opus judge verdict ${r.id} (accept, fidelity ${v.fidelity})`, route: k.route, evidence: { test: TEST, verdict_id: r.id, accept: true, fidelity: v.fidelity } },
    input: { ...imageInput({ url: m.image_url || items.get(k.judged_as).image_url, mime: 'image/jpeg', bytes: m.image_bytes }), ...(m.image_sha256 && { image_sha256: m.image_sha256 }), ...(draft && { draft }) },
  });
  row.would = 'write'; plan.push(row);
  if (!APPLY) continue;
  const w = await writePageText(db, pid, 'ocr', {
    data: text, language: 'auto-detect', model: m.model, updated_at: new Date(), source: 'ai', prompt_version: contentHash(sent), prompt_id: `indic-ocr-225:${k.cell}:${k.route}`,
    prompt_name: `#225 cell test arm ${k.route}`, pipeline: LANE, ...ocrProvenance(text, engine),
  }, { by: `agy ${m.model}`, reason: `#225 OCR cell test: best accepted read (${r.id})`, run_id: RUN_ID, revision_source: 'reocr_cli', expect_prior_hash: textHash(page.ocr) });
  row.status = w.status; if (w.status === 'written' || w.status === 'ok') tally.written++;
}
fs.writeFileSync(path.join(OUT, 'writes.json'), JSON.stringify({ run_id: RUN_ID, applied: APPLY, at: new Date().toISOString(), tally, pages: plan }, null, 1));
console.log(JSON.stringify({ run_id: RUN_ID, applied: APPLY, ...tally }), '\n', plan.filter((p) => p.skipped).map((p) => `${p.page_id} ${p.skipped}`).join('\n'));
fs.rmSync(dumpDir, { recursive: true, force: true });
await c.close();
