#!/usr/bin/env node
// PRIOR ART: stage1/driver.mjs (the agy call and its classify(), copied here, not imported: the driver runs on load)
// and gates.mjs (the step-2 rules). Neither re-runs a SAMPLE under alternative modes; this does, writing files only.
//
// #6361 item 3 (Derek, 2026-10-10: "test if that is true"): do the 6,494 not-applicable pages fail again at the same
// rate when re-run in the same mode with the same prompt, and does a simple mode or prompt change fix them?
// Draws N pages (seeded) from results/not-applicable.tsv and runs each ONCE per arm:
//   A  the stage-1 call exactly: agy -p <prompt> --model gemini-3.8-flash-low --mode plan --output-format json
//   B  no plan mode: the same, without --mode plan, plus --disable-slash-commands (headless still denies every tool)
//   C  plan mode, the prompt + cli-translate.mjs's CLI_SUFFIX ("Output only the English translation ... no tool")
// Each output is classed with the stage-2 rules. Nothing is written to the database. No API call.
//   node --env-file=/root/sourcelibrary/.env.production.local scripts/maintenance/tengyur-cli-6361/rerun-sample.mjs \
//     --run=/root/tengyur-cli-6361 --stored=<stored-before.jsonl.gz> --out=$JOB_SCRATCH/rerun [--n=100] [--arms=A,B,C]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import { sanitizeTranslationTags, guardTranslationText, assessTranslationHealth } from '../../lib/translate-core.mjs';
import { unwrapHiddenTranslation } from '../../lib/hidden-translation.mjs';
import { strayScriptVerdict } from '../../lib/stray-script.mjs';
import { refusableReasoningLeak, translationProse } from '../../lib/page-integrity.mjs';
import { cliChatterReason } from '../../lib/cli-chatter.mjs';

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const W = arg('run', '/root/tengyur-cli-6361'), OUT = arg('out'), STORED = arg('stored');
const N = Number(arg('n', 100)), ARMS = arg('arms', 'A,B,C').split(','), SLOTS = 4;
if (!OUT || !STORED) throw new Error('--out and --stored are required');
fs.mkdirSync(OUT, { recursive: true });
const MODEL = 'gemini-3.8-flash-low';
const CLI_SUFFIX = '\n\nOutput only the English translation in the format above. Do not open, read or write any file, do not use any tool, and add no preamble or commentary.\n'; // cli-translate.mjs
const QUOTA = /\b429\b|quota (?:reached|exceeded)|RESOURCE_EXHAUSTED|rate limit/i; // driver.mjs
const REFUSAL = /^\s*(I'?m sorry|I am sorry|I cannot|I can'?t|I am unable|I'?m unable|I will not|I won'?t)\b/i;
const BLOCK_MSG = "This request was blocked by Gemini's filters";
const PLAN_MODE = /file:\/\/\/|\.gemini\/|implementation plan|translation_plan|plan\.md|(?:please (?:review|confirm|let me know|approve)|let me know (?:if|whether)|would you like (?:me )?to|once (?:you )?approv|output contract|\/plan\b|the user(?:'s)? (?:prompt|request|instruction)|my (?:task|instructions)|the prompt (?:says|asks|requires))/i; // gates.mjs

// Seeded draw (mulberry32), page ids in file order.
const rows = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), 'results', 'not-applicable.tsv'), 'utf8').split('\n').slice(1).filter(Boolean).map((l) => { const [page_id, vol, page_number, reason] = l.split('\t'); return { page_id, vol: +vol, page_number: +page_number, reason }; });
let s = 6361; const rnd = () => { s |= 0; s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pool = [...rows]; const draw = [];
while (draw.length < N && pool.length) draw.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
const stratum = (r) => (r.reason.startsWith('stage1-failed') ? 'stage1-failed' : r.reason.includes('plan-mode') ? 'plan-mode' : 'other-refused');
fs.writeFileSync(path.join(OUT, 'draw.json'), JSON.stringify(draw.map((r) => ({ ...r, stratum: stratum(r) })), null, 1));
const stored = new Map(zlib.gunzipSync(fs.readFileSync(STORED)).toString('utf8').split('\n').filter(Boolean).map((l) => { const r = JSON.parse(l); return [r.page_id, r]; }));

function agy(args, cwd) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const ch = spawn('agy', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '', timedOut = false;
    ch.stdout.on('data', (d) => { out += d; }); ch.stderr.on('data', (d) => { err += d; });
    const t = setTimeout(() => { timedOut = true; ch.kill('SIGKILL'); }, 240_000);
    ch.on('close', (code) => { clearTimeout(t); resolve({ raw: out.trim(), err: err.trim(), code: timedOut ? -9 : code, secs: (Date.now() - t0) / 1000 }); });
  });
}
function classify({ raw, err, code }, page) {
  let j = null; try { j = JSON.parse(raw); } catch {}
  const resp = (j?.response || '').trim();
  const outside = j ? JSON.stringify({ status: j.status, error: j.error, message: j.message }) : raw;
  if (QUOTA.test(err + '\n' + outside)) return 'quota';
  if (code === -9) return 'timeout';
  if (!j) return 'no_json';
  if (j.status !== 'SUCCESS') return `status_${j.status}`;
  if (!resp) return (j.denied_actions || []).length ? 'denied_tool' : 'empty';
  if (resp.includes(BLOCK_MSG) || REFUSAL.test(resp)) return 'refusal';
  if (PLAN_MODE.test(resp) || cliChatterReason(resp) === 'plan-mode reply') return 'plan_mode';
  if (cliChatterReason(resp)) return 'chatter';
  if (refusableReasoningLeak(resp)) return 'reasoning_leak';
  let clean = unwrapHiddenTranslation({ ocr: page?.ocr, tr: guardTranslationText(sanitizeTranslationTags(resp)), type: page?.page_type }).text;
  const stray = strayScriptVerdict(clean, { ocr: page?.ocr, language: 'Tibetan' });
  clean = stray.text;
  if (translationProse(clean).length < 20) return 'empty';
  const h = assessTranslationHealth(page?.ocr, clean, { lang: 'Tibetan' });
  if (!h.healthy) return `door_${h.reason}`;
  if (stray.refuse) return 'door_stray-script';
  return 'ok';
}

const jobs = draw.flatMap((r) => ARMS.map((arm) => ({ arm, r }))).filter(({ arm, r }) => !fs.existsSync(path.join(OUT, arm, `${r.page_id}.json`)));
for (const a of ARMS) fs.mkdirSync(path.join(OUT, a), { recursive: true });
console.log(`${draw.length} pages x ${ARMS.join('')} = ${jobs.length} calls to make`);
let quotaHit = false;
async function worker(slot) {
  const cwd = path.join(OUT, 'empty-cwd', `slot${slot}`); fs.rmSync(cwd, { recursive: true, force: true }); fs.mkdirSync(cwd, { recursive: true });
  while (jobs.length && !quotaHit) {
    const { arm, r } = jobs.shift();
    let prompt = fs.readFileSync(path.join(W, 'prompts', `${r.page_id}.txt`), 'utf8');
    const args = ['-p', null, '--model', MODEL, '--print-timeout', '180s', '--output-format', 'json'];
    if (arm === 'A' || arm === 'C') args.push('--mode', 'plan');
    if (arm === 'B') args.push('--disable-slash-commands');
    if (arm === 'C') prompt += CLI_SUFFIX;
    args[1] = prompt;
    const res = await agy(args, cwd);
    const cls = classify(res, stored.get(r.page_id));
    if (cls === 'quota') { quotaHit = true; console.log(`QUOTA at ${arm} ${r.page_id}: ${res.err.slice(-300)}`); jobs.unshift({ arm, r }); return; }
    let j = null; try { j = JSON.parse(res.raw); } catch {}
    fs.writeFileSync(path.join(OUT, arm, `${r.page_id}.json`), JSON.stringify({ page_id: r.page_id, arm, stratum: stratum(r), cls, secs: res.secs, code: res.code, stderr_tail: res.err.slice(-600), agy: j ?? { unparsed: res.raw.slice(-2000) } }));
    console.log(`${arm} ${r.page_id} ${stratum(r)} -> ${cls} (${Math.round(res.secs)}s)`);
  }
}
await Promise.all(Array.from({ length: SLOTS }, (_, i) => worker(i)));

// Summary over whatever is on disk.
const summary = {};
for (const arm of ARMS) {
  const recs = draw.map((r) => { try { return JSON.parse(fs.readFileSync(path.join(OUT, arm, `${r.page_id}.json`), 'utf8')); } catch { return null; } }).filter(Boolean);
  const by = (k) => recs.reduce((acc, x) => { const g = k(x); (acc[g] ??= {})[x.cls] = (acc[g][x.cls] || 0) + 1; return acc; }, {});
  summary[arm] = { n: recs.length, ok: recs.filter((x) => x.cls === 'ok').length, plan_mode: recs.filter((x) => x.cls === 'plan_mode').length, classes: by(() => 'all').all, by_stratum: by((x) => x.stratum) };
}
fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify({ at: new Date().toISOString(), n: draw.length, strata: draw.reduce((a, r) => { a[stratum(r)] = (a[stratum(r)] || 0) + 1; return a; }, {}), quota_hit: quotaHit, summary }, null, 1));
console.log(JSON.stringify(summary, null, 1));
