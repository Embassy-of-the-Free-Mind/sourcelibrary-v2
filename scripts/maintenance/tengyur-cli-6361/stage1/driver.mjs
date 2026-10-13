#!/usr/bin/env node
// PRIOR ART: scripts/eval/run-cli-arm.py (the agy -p call shape, classification and call log this reuses: plan mode,
// --print-timeout, --output-format json, quota strings, /var/log/sourcelibrary/agy-calls.jsonl). It stops on the first
// quota error and keeps no per-page manifest; this run must sleep through quota windows for days and record the
// #6361 contract's per-page provenance, so it is the same call in a resumable, per-page-checkpointed loop.
//
// #6361 stage 1: translate every page in pages.jsonl with gemini-3.8-flash-low through `agy -p` (Google subscription),
// one page per call, the prompt file written by build-prompts.mjs sent verbatim. FILES ONLY: no Mongo, no API.
//
//   out/<page_id>.json      every attempt: {page_id, attempt, started, finished, secs, code, class, stderr_tail, agy}
//   failures.jsonl          one row per failed attempt (refusal, empty, blocked, non-SUCCESS, timeout, denied tool)
//   manifest.jsonl          one row per page when it reaches a final state (staged, or failed after 3 attempts)
//   quota.log               every quota hit, with pages staged since the previous one (pages per window)
//   progress.txt            staged=<n> failed=<n> total=<n> applied=0 updated=<ISO>, rewritten after every page
//   DONE-STAGE1             when every page is staged or has 3 recorded failures
//   STOP                    touch it to stop after the calls in flight
//
//   bash /root/tengyur-cli-6361/start-driver.sh      (idempotent; the watchdog calls it)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';

const W = '/root/tengyur-cli-6361';
const MODEL = 'gemini-3.8-flash-low';
const RUN_ID = 'tengyur-cli-6361';
const ACCOUNT = 'derek-google-consumer'; // the agy sign-in (authMethod=consumer); the address itself stays off the public repo
const PARALLEL = 4;
const MAX_ATTEMPTS = 3;
const TIMEOUT_S = 240;
const QUOTA_SLEEP_S = 15 * 60;
const CALL_LOG = '/var/log/sourcelibrary/agy-calls.jsonl';
const BLOCK_MSG = "This request was blocked by Gemini's filters";
const QUOTA = /RESOURCE_EXHAUSTED|quota reached|quota exceeded|exhausted your|\b429\b|Too Many Requests|rate.?limit/i;
const REFUSAL = /^\s*(I'?m sorry|I am sorry|I cannot|I can'?t|I am unable|I'?m unable|I will not|I won'?t)\b/i;

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const now = () => new Date().toISOString();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const log = (m) => console.log(`${now()} ${m}`);
const append = (f, row) => fs.appendFileSync(path.join(W, f), JSON.stringify(row) + '\n');

const scope = JSON.parse(fs.readFileSync(path.join(W, 'scope.json'), 'utf8'));
const pages = jl(path.join(W, 'pages.jsonl'));
const AGY_VERSION = execFileSync('agy', ['--version']).toString().trim();
const PROMPT_VERSION = `v${scope.prompt.pinned.version} ${scope.prompt.pinned.id} ${scope.prompt.pinned.content_hash}`;
fs.mkdirSync(path.join(W, 'out'), { recursive: true });

// State from files: a page is final when the manifest has it; attempts = failed attempts recorded so far.
const final = new Map(jl(path.join(W, 'manifest.jsonl')).map((r) => [r.page_id, r.status]));
const attempts = new Map();
for (const f of jl(path.join(W, 'failures.jsonl'))) attempts.set(f.page_id, (attempts.get(f.page_id) || 0) + 1);
let staged = [...final.values()].filter((s) => s === 'staged').length;
let failed = [...final.values()].filter((s) => s === 'failed').length;
let sinceQuota = 0;

function progress() {
  const line = `staged=${staged} failed=${failed} total=${pages.length} applied=0 updated=${now()}\n`;
  fs.writeFileSync(path.join(W, 'progress.txt.tmp'), line);
  fs.renameSync(path.join(W, 'progress.txt.tmp'), path.join(W, 'progress.txt'));
}

function callLog(secs, ok, cls) {
  try { fs.appendFileSync(CALL_LOG, JSON.stringify({ ts: now(), job: RUN_ID, model: MODEL, kind: 'translate', seconds: Math.round(secs * 10) / 10, ok, error_class: cls }) + '\n'); } catch {}
}

function agy(prompt, cwd) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const args = ['-p', prompt, '--model', MODEL, '--mode', 'plan', '--print-timeout', `${TIMEOUT_S - 60}s`, '--output-format', 'json'];
    const ch = spawn('agy', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '', timedOut = false;
    ch.stdout.on('data', (d) => { out += d; });
    ch.stderr.on('data', (d) => { err += d; });
    const t = setTimeout(() => { timedOut = true; ch.kill('SIGKILL'); }, TIMEOUT_S * 1000);
    ch.on('close', (code) => { clearTimeout(t); resolve({ raw: out.trim(), err: err.trim(), code: timedOut ? -9 : code, secs: (Date.now() - t0) / 1000 }); });
  });
}

function classify({ raw, err, code }) {
  let j = null;
  try { j = JSON.parse(raw); } catch {}
  const resp = (j?.response || '').trim();
  // Never search the response or the usage numbers / conversation id for a quota signal: only stderr, the raw
  // output when it is not JSON, and the JSON's own status and error fields.
  const outside = j ? JSON.stringify({ status: j.status, error: j.error, message: j.message }) : raw;
  if (QUOTA.test(err + '\n' + outside)) return { cls: 'quota', j, resp };
  if (code === -9) return { cls: 'timeout', j, resp };
  if (!j) return { cls: code === 0 ? 'no_json' : 'transient', j, resp }; // network/CLI error with nothing parsed
  // A server-side error before any turn ran (e.g. "Eligibility check failed: ... 500") is not the page's fault.
  if (j.status !== 'SUCCESS' && !j.num_turns && !j.usage?.total_tokens) return { cls: 'transient', j, resp };
  if (j.status !== 'SUCCESS') return { cls: `status_${j.status}`, j, resp };
  if (code !== 0) return { cls: `exit_${code}`, j, resp };
  if (!resp) return { cls: (j.denied_actions || []).length ? 'denied_tool' : 'empty', j, resp };
  if (resp.includes(BLOCK_MSG)) return { cls: 'safety_filter', j, resp };
  if (REFUSAL.test(resp)) return { cls: 'refusal', j, resp };
  return { cls: null, j, resp };
}

let pausedUntil = 0, transientRun = 0;
const queue = pages.filter((p) => !final.has(p.page_id));
const stopRequested = () => fs.existsSync(path.join(W, 'STOP'));
log(`start: ${pages.length} pages, ${staged} staged, ${failed} failed, ${queue.length} to run; agy ${AGY_VERSION}; ${MODEL}; prompt ${PROMPT_VERSION}`);
progress();

async function worker(slot) {
  const cwd = path.join(W, 'empty-cwd', `slot${slot}`);
  fs.rmSync(cwd, { recursive: true, force: true });
  fs.mkdirSync(cwd, { recursive: true });
  while (queue.length) {
    if (stopRequested()) return;
    if (Date.now() < pausedUntil) { await sleep(Math.min(30_000, pausedUntil - Date.now())); continue; }
    const p = queue.shift();
    const prompt = fs.readFileSync(path.join(W, 'prompts', `${p.page_id}.txt`), 'utf8');
    if (sha(prompt) !== p.prompt_sha256) throw new Error(`prompt file changed: ${p.page_id}`);
    const attempt = (attempts.get(p.page_id) || 0) + 1;
    const started = now();
    const r = await agy(prompt, cwd);
    const { cls, j, resp } = classify(r);
    callLog(r.secs, cls === null, cls);
    const rec = { page_id: p.page_id, attempt, started, finished: now(), secs: Math.round(r.secs * 10) / 10, code: r.code, class: cls, stderr_tail: r.err.slice(-1500), agy: j ?? { unparsed: r.raw.slice(-3000) } };
    if (cls === 'quota' || cls === 'transient' || cls === 'no_json') {
      // Not the page's fault: put it back at the front, pause every slot, do not count an attempt.
      queue.unshift(p);
      fs.writeFileSync(path.join(W, 'out', `${p.page_id}.${cls}.last.json`), JSON.stringify(rec));
      if (cls === 'quota') {
        if (Date.now() >= pausedUntil) {
          // "429 Individual quota reached, resets in 2h15m" (C38, 2026-10-08): sleep to the reset plus 3 min, else 15 min.
          const msg = `${r.err} ${j ? `${j.error ?? ''} ${j.message ?? ''}` : r.raw}`;
          const m = msg.match(/resets? in (?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:(\d+)s)?/i);
          const resetS = m && (m[1] || m[2] || m[3]) ? (+(m[1] || 0)) * 3600 + (+(m[2] || 0)) * 60 + (+(m[3] || 0)) : null;
          const sleepS = resetS != null ? resetS + 180 : QUOTA_SLEEP_S;
          fs.appendFileSync(path.join(W, 'quota.log'), `${now()} quota hit; staged since previous hit: ${sinceQuota}; sleeping ${sleepS}s; ${msg.slice(0, 600).replace(/\n/g, ' ')}\n`);
          log(`QUOTA after ${sinceQuota} pages; sleep ${sleepS}s`);
          sinceQuota = 0;
          pausedUntil = Date.now() + sleepS * 1000;
        }
      } else {
        transientRun++;
        const backoff = Math.min(600, 15 * 2 ** Math.min(transientRun, 6));
        log(`${cls} on ${p.page_id} (code ${r.code}): ${r.err.slice(-200).replace(/\n/g, ' ')}; pause ${backoff}s`);
        pausedUntil = Math.max(pausedUntil, Date.now() + backoff * 1000);
      }
      continue;
    }
    transientRun = 0;
    fs.writeFileSync(path.join(W, 'out', cls === null ? `${p.page_id}.json` : `${p.page_id}.a${attempt}.json`), JSON.stringify(rec));
    let status = null;
    if (cls === null) {
      status = 'staged'; staged++; sinceQuota++;
    } else {
      attempts.set(p.page_id, attempt);
      append('failures.jsonl', { page_id: p.page_id, book_id: p.book_id, vol: p.vol, page_number: p.page_number, attempt, class: cls, at: rec.finished, status: j?.status ?? null, conversation_id: j?.conversation_id ?? null, response_head: resp.slice(0, 300), error: r.err.slice(-500) });
      if (attempt >= MAX_ATTEMPTS) { status = 'failed'; failed++; } else queue.push(p); // retry later, after the rest
      log(`${p.page_id} vol ${p.vol} p${p.page_number}: ${cls} (attempt ${attempt})`);
    }
    if (status) {
      append('manifest.jsonl', {
        page_id: p.page_id, book_id: p.book_id, vol: p.vol, section: p.section, page_number: p.page_number,
        ocr_sha256: p.ocr_sha256, prompt_sha256: p.prompt_sha256, response_sha256: status === 'staged' ? sha(resp) : null,
        response_chars: resp.length, src_chars: p.src_chars, model: MODEL, via: 'antigravity-cli', agy_version: AGY_VERSION,
        account: ACCOUNT, prompt_version: PROMPT_VERSION, run_id: RUN_ID, attempts: attempt, last_class: cls,
        conversation_id: j?.conversation_id ?? null, usage: j?.usage ?? null, duration_seconds: j?.duration_seconds ?? null,
        started, finished: rec.finished, status,
      });
      final.set(p.page_id, status);
    }
    progress();
  }
}

await Promise.all(Array.from({ length: PARALLEL }, (_, i) => worker(i)));
progress();
if (stopRequested()) { log('STOP file present; exiting'); process.exit(0); }
if (final.size === pages.length) {
  fs.writeFileSync(path.join(W, 'DONE-STAGE1'), `${now()} staged=${staged} failed=${failed} total=${pages.length}\n`);
  log(`DONE-STAGE1 staged=${staged} failed=${failed}`);
}
