#!/usr/bin/env node
// PRIOR ART: ../stage1/driver.mjs (the same agy call, quota sleep, per-page files and manifest; kept as it ran) and
// scripts/eval/run-cli-arm.py (the nudge: continue THAT conversation once instead of starting over). Stage 1 has no
// nudge and counts plan notes as successes; run-cli-arm has no quota sleep or manifest. This is stage 1's loop with
// the nudge and the hardened chatter guard.
//
// #6361 item 3 (Derek, 2026-10-10, #6420): re-read the 6,494 not-applicable pages (results/not-applicable.tsv) with
// the SAME model and prompt as stage 1 (gemini-3.8-flash-low, v13 prompt file sent verbatim, --mode plan,
// --print-timeout 180s, --output-format json, never --dangerously-skip-permissions). When a reply is a plan note,
// empty, or a denied tool, continue that conversation once with NUDGE; such a row is marked `nudged`. Up to
// ROUNDS fresh calls (each with its one nudge). FILES ONLY: no Mongo, no API.
//
//   <dir>/out/<page_id>.json        the accepted call: {page_id, round, nudged, started, finished, class, agy}
//   <dir>/out/<page_id>.c<n>.json   every call, accepted or not (n = call number)
//   <dir>/calls.jsonl               one row per call (class, guard reason, nudge or fresh, conversation id)
//   <dir>/manifest.jsonl            one row per page at its final state (staged | failed)
//   <dir>/progress.txt, quota.log, DONE, STOP (touch to stop after calls in flight)
//
//   node scripts/maintenance/tengyur-cli-6361/reread/driver.mjs --dir=$JOB_SCRATCH/reread [--limit=N] [--parallel=4]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { cliChatterReason } from '../../../lib/cli-chatter.mjs';
import { refusableReasoningLeak } from '../../../lib/page-integrity.mjs';

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const RUN = '/root/tengyur-cli-6361';
const DIR = arg('dir');
if (!DIR) throw new Error('--dir is required');
const NA = arg('na', path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'results', 'not-applicable.tsv'));
const LIMIT = Number(arg('limit', 0)) || Infinity;
const PARALLEL = Number(arg('parallel', 4));
const MODEL = 'gemini-3.8-flash-low';
const RUN_ID = 'tengyur-cli-6361-reread';
const ACCOUNT = 'derek-google-consumer';
const ROUNDS = 2;
const TIMEOUT_S = 240; // --print-timeout 180s + 60 s of slack, as stage 1
const QUOTA_SLEEP_S = 15 * 60;
// The brief's text (#6361, 2026-10-10), verbatim, for plan notes; used for empty / denied-tool replies too.
const NUDGE = 'Do not write a plan. Output the English translation of the attached page now, exactly as instructed above.';
const CALL_LOG = '/var/log/sourcelibrary/agy-calls.jsonl';
const BLOCK_MSG = "This request was blocked by Gemini's filters";
const QUOTA = /RESOURCE_EXHAUSTED|quota reached|quota exceeded|exhausted your|\b429\b|Too Many Requests|rate.?limit/i;
const REFUSAL = /^\s*(I'?m sorry|I am sorry|I cannot|I can'?t|I am unable|I'?m unable|I will not|I won'?t)\b/i;
const PLAN_MODE = /file:\/\/\/|\.gemini\/|implementation plan|translation_plan|plan\.md|(?:please (?:review|confirm|let me know|approve)|let me know (?:if|whether)|would you like (?:me )?to|once (?:you )?approv|output contract|\/plan\b|the user(?:'s)? (?:prompt|request|instruction)|my (?:task|instructions)|the prompt (?:says|asks|requires))/i; // gates.mjs
const NUDGEABLE = new Set(['plan_note', 'denied_tool', 'empty']);

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const now = () => new Date().toISOString();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const log = (m) => console.log(`${now()} ${m}`);
const append = (f, row) => fs.appendFileSync(path.join(DIR, f), JSON.stringify(row) + '\n');

fs.mkdirSync(path.join(DIR, 'out'), { recursive: true });
const scope = JSON.parse(fs.readFileSync(path.join(RUN, 'scope.json'), 'utf8'));
const PROMPT_VERSION = `v${scope.prompt.pinned.version} ${scope.prompt.pinned.id} ${scope.prompt.pinned.content_hash}`;
const AGY_VERSION = execFileSync('agy', ['--version']).toString().trim();
const byId = new Map(jl(path.join(RUN, 'pages.jsonl')).map((p) => [p.page_id, p]));
const naRows = fs.readFileSync(NA, 'utf8').split('\n').slice(1).filter(Boolean).map((l) => { const [page_id, vol, page_number, reason] = l.split('\t'); return { page_id, reason }; });
const pages = naRows.map((r) => ({ ...byId.get(r.page_id), na_reason: r.reason }));
if (pages.some((p) => !p.prompt_sha256)) throw new Error('a not-applicable page is missing from pages.jsonl');

const final = new Map(jl(path.join(DIR, 'manifest.jsonl')).map((r) => [r.page_id, r.status]));
let callN = jl(path.join(DIR, 'calls.jsonl')).length;
let staged = [...final.values()].filter((s) => s === 'staged').length;
let failed = [...final.values()].filter((s) => s === 'failed').length;
let sinceQuota = 0;
const progress = () => {
  fs.writeFileSync(path.join(DIR, 'progress.txt.tmp'), `staged=${staged} failed=${failed} total=${pages.length} calls=${callN} updated=${now()}\n`);
  fs.renameSync(path.join(DIR, 'progress.txt.tmp'), path.join(DIR, 'progress.txt'));
};
const callLog = (secs, ok, cls) => { try { fs.appendFileSync(CALL_LOG, JSON.stringify({ ts: now(), job: RUN_ID, model: MODEL, kind: 'translate', seconds: Math.round(secs * 10) / 10, ok, error_class: cls }) + '\n'); } catch {} };

function agy(prompt, cwd, conversation) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const args = ['-p', prompt, '--model', MODEL, '--mode', 'plan', '--print-timeout', `${TIMEOUT_S - 60}s`, '--output-format', 'json'];
    if (conversation) args.push('--conversation', conversation);
    const ch = spawn('agy', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '', timedOut = false;
    ch.stdout.on('data', (d) => { out += d; });
    ch.stderr.on('data', (d) => { err += d; });
    const t = setTimeout(() => { timedOut = true; ch.kill('SIGKILL'); }, TIMEOUT_S * 1000);
    ch.on('close', (code) => { clearTimeout(t); resolve({ raw: out.trim(), err: err.trim(), code: timedOut ? -9 : code, secs: (Date.now() - t0) / 1000 }); });
  });
}

// stage 1's classify, then the guards stage 2 applied to its replies: the hardened cliChatterReason (#6412), the
// gates' PLAN_MODE, and the headline reasoning leak. A reply that fails any of them is not accepted as a translation.
function classify({ raw, err, code }) {
  let j = null;
  try { j = JSON.parse(raw); } catch {}
  const resp = (j?.response || '').trim();
  const outside = j ? JSON.stringify({ status: j.status, error: j.error, message: j.message }) : raw;
  if (QUOTA.test(err + '\n' + outside)) return { cls: 'quota', j, resp };
  if (code === -9) return { cls: 'timeout', j, resp };
  if (!j) return { cls: code === 0 ? 'no_json' : 'transient', j, resp };
  if (j.status !== 'SUCCESS' && !j.num_turns && !j.usage?.total_tokens) return { cls: 'transient', j, resp };
  if (j.status !== 'SUCCESS') return { cls: `status_${j.status}`, j, resp };
  if (code !== 0) return { cls: `exit_${code}`, j, resp };
  if (!resp) return { cls: (j.denied_actions || []).length ? 'denied_tool' : 'empty', j, resp };
  if (resp.includes(BLOCK_MSG)) return { cls: 'safety_filter', j, resp };
  if (REFUSAL.test(resp)) return { cls: 'refusal', j, resp };
  const chat = cliChatterReason(resp);
  if (chat === 'plan-mode reply' || PLAN_MODE.test(resp)) return { cls: 'plan_note', j, resp, why: chat || resp.match(PLAN_MODE)[0] };
  if (chat) return { cls: 'chatter', j, resp, why: chat };
  if (refusableReasoningLeak(resp)) return { cls: 'reasoning_leak', j, resp };
  return { cls: null, j, resp };
}

let pausedUntil = 0, transientRun = 0;
const queue = pages.filter((p) => !final.has(p.page_id)).slice(0, LIMIT === Infinity ? undefined : LIMIT);
const stopRequested = () => fs.existsSync(path.join(DIR, 'STOP'));
log(`start: ${pages.length} pages, ${staged} staged, ${failed} failed, ${queue.length} to run; agy ${AGY_VERSION}; ${MODEL}; prompt ${PROMPT_VERSION}`);
progress();

// One call, with quota/transient handling: returns null when the page must be put back (not its fault).
async function oneCall(p, prompt, cwd, conversation, round) {
  const started = now();
  const r = await agy(prompt, cwd, conversation);
  const c = classify(r);
  callLog(r.secs, c.cls === null, c.cls);
  const rec = { page_id: p.page_id, call: ++callN, round, nudge: !!conversation, started, finished: now(), secs: Math.round(r.secs * 10) / 10, code: r.code, class: c.cls, why: c.why ?? null, stderr_tail: r.err.slice(-1500), agy: c.j ?? { unparsed: r.raw.slice(-3000) } };
  fs.writeFileSync(path.join(DIR, 'out', `${p.page_id}.c${rec.call}.json`), JSON.stringify(rec));
  append('calls.jsonl', { page_id: p.page_id, vol: p.vol, page_number: p.page_number, call: rec.call, round, nudge: rec.nudge, class: c.cls, why: rec.why, conversation_id: c.j?.conversation_id ?? null, thinking_tokens: c.j?.usage?.thinking_tokens ?? null, secs: rec.secs, at: rec.finished, response_head: c.resp.slice(0, 200) });
  if (c.cls === 'quota' || c.cls === 'transient' || c.cls === 'no_json') {
    if (c.cls === 'quota') {
      if (Date.now() >= pausedUntil) {
        const msg = `${r.err} ${c.j ? `${c.j.error ?? ''} ${c.j.message ?? ''}` : r.raw}`;
        const m = msg.match(/resets? in (?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:(\d+)s)?/i);
        const resetS = m && (m[1] || m[2] || m[3]) ? (+(m[1] || 0)) * 3600 + (+(m[2] || 0)) * 60 + (+(m[3] || 0)) : null;
        const sleepS = resetS != null ? resetS + 180 : QUOTA_SLEEP_S;
        fs.appendFileSync(path.join(DIR, 'quota.log'), `${now()} quota hit; staged since previous hit: ${sinceQuota}; sleeping ${sleepS}s; ${msg.slice(0, 600).replace(/\n/g, ' ')}\n`);
        log(`QUOTA after ${sinceQuota} pages; sleep ${sleepS}s`);
        sinceQuota = 0;
        pausedUntil = Date.now() + sleepS * 1000;
      }
    } else {
      transientRun++;
      const backoff = Math.min(600, 15 * 2 ** Math.min(transientRun, 6));
      log(`${c.cls} on ${p.page_id} (code ${r.code}): ${r.err.slice(-200).replace(/\n/g, ' ')}; pause ${backoff}s`);
      pausedUntil = Math.max(pausedUntil, Date.now() + backoff * 1000);
    }
    return null;
  }
  transientRun = 0;
  return { ...c, rec };
}

async function worker(slot) {
  const cwd = path.join(DIR, 'empty-cwd', `slot${slot}`);
  fs.rmSync(cwd, { recursive: true, force: true });
  fs.mkdirSync(cwd, { recursive: true });
  while (queue.length) {
    if (stopRequested()) return;
    if (Date.now() < pausedUntil) { await sleep(Math.min(30_000, pausedUntil - Date.now())); continue; }
    const p = queue.shift();
    const prompt = fs.readFileSync(path.join(RUN, 'prompts', `${p.page_id}.txt`), 'utf8');
    if (sha(prompt) !== p.prompt_sha256) throw new Error(`prompt file changed: ${p.page_id}`);
    let accepted = null, last = null, nudged = false, calls = 0, putBack = false;
    const classes = [];
    for (let round = 1; round <= ROUNDS && !accepted; round++) {
      const a = await oneCall(p, prompt, cwd, null, round);
      if (!a) { putBack = true; break; }
      calls++; classes.push(a.cls ?? 'ok'); last = a;
      if (a.cls === null) { accepted = a; break; }
      if (NUDGEABLE.has(a.cls) && a.j?.conversation_id) {
        nudged = true;
        const b = await oneCall(p, NUDGE, cwd, a.j.conversation_id, round);
        if (!b) { putBack = true; break; }
        calls++; classes.push(`nudge:${b.cls ?? 'ok'}`); last = b;
        if (b.cls === null) accepted = b;
      }
    }
    if (putBack && !accepted) { queue.unshift(p); continue; } // a quota/transient mid-page: the whole page again later
    const status = accepted ? 'staged' : 'failed';
    if (accepted) {
      fs.writeFileSync(path.join(DIR, 'out', `${p.page_id}.json`), JSON.stringify({ ...accepted.rec, nudged }));
      staged++; sinceQuota++;
    } else failed++;
    const j = (accepted || last)?.j;
    append('manifest.jsonl', {
      page_id: p.page_id, book_id: p.book_id, vol: p.vol, section: p.section, page_number: p.page_number, na_reason: p.na_reason,
      ocr_sha256: p.ocr_sha256, prompt_sha256: p.prompt_sha256, nudge_sha256: nudged ? sha(NUDGE) : null,
      response_sha256: accepted ? sha(accepted.resp) : null, response_chars: accepted ? accepted.resp.length : 0, src_chars: p.src_chars,
      model: MODEL, via: 'antigravity-cli', agy_version: AGY_VERSION, account: ACCOUNT, prompt_version: PROMPT_VERSION, run_id: RUN_ID,
      nudged, accepted_by_nudge: !!accepted?.rec.nudge, calls, classes, last_class: last?.cls ?? null,
      conversation_id: j?.conversation_id ?? null, usage: j?.usage ?? null, duration_seconds: j?.duration_seconds ?? null,
      finished: now(), status,
    });
    final.set(p.page_id, status);
    log(`${p.page_id} vol ${p.vol} p${p.page_number}: ${status} [${classes.join(' ') }]`);
    progress();
  }
}

await Promise.all(Array.from({ length: PARALLEL }, (_, i) => worker(i)));
progress();
if (stopRequested()) { log('STOP file present; exiting'); process.exit(0); }
if (final.size === pages.length) {
  fs.writeFileSync(path.join(DIR, 'DONE'), `${now()} staged=${staged} failed=${failed} total=${pages.length}\n`);
  log(`DONE staged=${staged} failed=${failed}`);
}
