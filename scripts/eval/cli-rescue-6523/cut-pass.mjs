#!/usr/bin/env node
// PRIOR ART: scripts/eval/run-cli-arm.py makes the `agy -p` calls (plan mode, never auto-approve, #6345); this only
// writes its requests, then reads its rows back through the verbatim guard. rescue.mjs (step 2) decides which rows
// come here.
/**
 * Step 3 of the #6523 rescue: a TEXT-ONLY second CLI pass that may only CUT. The model gets the stored reply and
 * returns the transcription/translation span between <<<BEGIN>>> and <<<END>>>. Accepted only if the verbatim guard
 * passes (a contiguous substring of the raw reply after whitespace normalisation) and the original check
 * (ocrReadProblem / cliChatterReason) no longer fires. Anything else stays failed.
 *
 *   node scripts/eval/cli-rescue-6523/cut-pass.mjs control  [--model M]   # 20 items with a known answer
 *   node scripts/eval/cli-rescue-6523/cut-pass.mjs residual [--model M]   # every needs-cli row from rescue.mjs
 *
 * The calls run from an empty folder under $JOB_SCRATCH (no image, nothing for a tool to open), through
 * run-cli-arm.py --no-nudge. Every call is logged in /var/log/sourcelibrary/agy-calls.jsonl by that script.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { execFileSync, execSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { ARMS } from './arms.mjs';
import { readJsonl, problemOf, isUntagged } from './rescue.mjs';
import { ocrReadProblem, cliChatterReason } from '../../lib/cli-chatter.mjs';

import { verbatimCut, normWs, VERBATIM_GUARD_VERSION } from '../../lib/verbatim-cut.mjs';

const [mode] = process.argv.slice(2);
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
const MODEL = arg('model', 'gemini-3.8-flash-low');
const SCRATCH = process.env.JOB_SCRATCH || '/tmp';
const DIR = arg('dir', join(SCRATCH, 'cli-rescue-6523'));
const RUNNER = resolve('scripts/eval/run-cli-arm.py');
const CLI_VERSION = (() => { try { return execSync('agy --version').toString().trim(); } catch { return 'unknown'; } })();
export const CUT_PROMPT_VERSION = 'cut-6523/2';

const WHAT = { ocr: 'transcription of the page', translation: 'English translation of the page' };
export function cutPrompt(kind, raw) {
  const w = WHAT[kind];
  return `You are given, between the lines RAW-START and RAW-END, the reply another AI assistant gave when it was asked for a ${w}. Besides the ${w}, the reply may hold chat: an introduction ("Here is…"), a note about a plan, a refusal or apology, an offer to summarise, a summary, or a second copy of the same text.

Your job is to CUT, never to write. Copy out the ${w} exactly as it stands in the reply: character for character, the same lines, the same tags, the same spelling, mistakes included. The ${w} has its own tags in angle brackets (such as <scan-quality>, <page-type>, <meta>, <note>, <term>, <summary>, <keywords>); they belong to it, keep every one of them. Remove only the assistant's own words around it. If the text appears more than once, copy the most complete copy once. Do not correct, complete, translate, reorder, reformat or add anything. If there is no ${w} in the reply at all, give nothing between the markers. Do not use any tools.

Answer with exactly this and nothing else:
<<<BEGIN>>>
(the copied text)
<<<END>>>

RAW-START
${raw}
RAW-END`;
}

/** The span between the sentinels in the second-pass reply, or null when the markers are missing. */
export function sentinelSpan(reply) {
  const m = String(reply || '').match(/<<<\s*BEGIN\s*>>>\r?\n?([\s\S]*?)\r?\n?<<<\s*END\s*>>>/);
  return m ? m[1] : null;
}


function runCli(reqs, arm) {
  const ws = join(SCRATCH, `cut-ws-${arm}`);
  rmSync(ws, { recursive: true, force: true });
  mkdirSync(ws, { recursive: true });
  const reqPath = join(DIR, `${arm}.requests.jsonl`), outPath = join(DIR, `${arm}.cli.jsonl`);
  writeFileSync(reqPath, reqs.map((r) => JSON.stringify({ uid: r.uid, prompt: r.prompt })).join('\n') + '\n');
  try {
    execFileSync('python3', [RUNNER, '--requests', reqPath, '--out', outPath, '--arm', arm, '--model', MODEL, '--job', 'cli-past-data-6523',
      '--kind', 'cut', '--no-nudge', '--attempts', '2', '--print-timeout', '180', '--parallel', '2'], { cwd: ws, stdio: 'inherit' });
  } catch (e) { console.error(`runner exited ${e.status}`); }
  const rows = existsSync(outPath) ? readJsonl(outPath) : [];
  return new Map(rows.map((r) => [r.uid, r]));
}

function judge(kind, raw, reply, untagged) {
  const span = sentinelSpan(reply);
  if (span === null) return { ok: false, reason: reply ? 'no sentinels' : 'empty reply' };
  if (!span.trim()) return { ok: false, reason: 'model found no text' };
  const g = verbatimCut(raw, span);
  if (!g.ok) return { ok: false, reason: `guard: ${g.reason}`, span, guard: g };
  const after = problemOf(kind, span, untagged);
  if (after) return { ok: false, reason: `still fails: ${after}`, span, guard: g };
  return { ok: true, span, guard: g };
}

const stamp = () => ({ method: 'cli-restructure', model: MODEL, cli: `agy ${CLI_VERSION}`, prompt: CUT_PROMPT_VERSION, guard: VERBATIM_GUARD_VERSION, at: new Date().toISOString() });

if (mode === 'control') {
  // 10 planted: a clean stored reply wrapped in chat by hand; the answer is the clean reply.
  // 10 natural: failing replies the deterministic pass settled; the answer is that cut.
  const pick = (id, n, pred) => { const a = ARMS.find((x) => x.id === id); const rows = readJsonl(a.path); const u = isUntagged(a, rows); return rows.filter(pred).slice(0, n).map((r) => ({ arm: a, r, raw: a.text(r), untagged: u })); };
  const clean = [
    ...pick('latin-pilot-6375:C37-ocr', 4, (r) => r.text && !ocrReadProblem(r.text) && r.text.length < 2500),
    ...pick('cli38-6182-6331:C38-full', 3, (r) => r.text && !cliChatterReason(r.text) && r.text.length < 2500 && /\p{Script=Latin}/u.test(r.text)),
    ...pick('syriac-6295:C37-ocr', 3, (r) => r.text && !ocrReadProblem(r.text) && r.text.length < 2500),
  ];
  const WRAP = [
    (t) => `Here is the transcription of the page:\n\n${t}\n\nWould you like me to provide a summary of this page as well?`,
    (t) => `I have prepared the transcription plan in transcription_plan.md. Please review it.\n\n${t}`,
    (t) => `${t}\n\n${t}`,
    (t) => `Sure! ${'```'}\n${t}\n${'```'}\nLet me know if you need anything else.`,
    (t) => `${t}\n\nI am unable to provide a full verbatim transcription of the next page because of content restrictions.\n\n### Summary\nThe page discusses the subject in general terms.`,
  ];
  const items = clean.map(({ arm, r, raw, untagged }, i) => ({ uid: `planted-${i}`, kind: arm.kind, untagged, answer: raw.trim(), raw: WRAP[i % WRAP.length](raw.trim()), src: `${arm.id}|${arm.key(r)}` }));
  const det = [];
  for (const a of ARMS.filter((x) => x.kind !== 'qa')) {
    const f = join(DIR, `${a.id.replace(/[:/]/g, '__')}.jsonl`);
    if (!existsSync(f)) continue;
    for (const rec of readJsonl(f)) if (rec.method === 'deterministic' && det.length < 10 && rec.raw_chars < 6000 && !det.some((d) => d.src.startsWith(a.id))) {
      const rows = readJsonl(a.path);
      const row = rows.find((r) => a.key(r) === rec.key);
      det.push({ uid: `natural-${det.length}`, kind: a.kind, untagged: isUntagged(a, rows), answer: rec.text, raw: a.text(row), src: `${a.id}|${rec.key}` });
    }
  }
  // top up the natural set from the biggest arm when fewer than 10 arms had a deterministic rescue
  for (const a of ARMS.filter((x) => x.id.startsWith('pareto-6293'))) {
    const f = join(DIR, `${a.id.replace(/[:/]/g, '__')}.jsonl`);
    const rows = readJsonl(a.path);
    for (const rec of readJsonl(f)) if (det.length < 10 && rec.method === 'deterministic' && rec.raw_chars < 6000 && !det.some((d) => d.src === `${a.id}|${rec.key}`)) {
      const row = rows.find((r) => a.key(r) === rec.key);
      det.push({ uid: `natural-${det.length}`, kind: a.kind, untagged: isUntagged(a, rows), answer: rec.text, raw: a.text(row), src: `${a.id}|${rec.key}` });
    }
  }
  const all = [...items, ...det].map((x) => ({ ...x, prompt: cutPrompt(x.kind, x.raw) }));
  const got = runCli(all, 'cut-control');
  const res = all.map((x) => {
    const row = got.get(x.uid);
    const j = judge(x.kind, x.raw, row?.text, x.untagged);
    const exact = j.span != null && normWs(j.span) === normWs(x.answer);
    return { uid: x.uid, src: x.src, accepted: j.ok, exact, reason: j.reason || null, cli_error: row?.error || null, answer_chars: x.answer.length, span_chars: j.span?.length ?? null };
  });
  const sum = (p) => res.filter((r) => r.uid.startsWith(p));
  const report = { ...stamp(), planted: { n: sum('planted').length, accepted: sum('planted').filter((r) => r.accepted).length, exact: sum('planted').filter((r) => r.exact).length },
    natural: { n: sum('natural').length, accepted: sum('natural').filter((r) => r.accepted).length, exact: sum('natural').filter((r) => r.exact).length }, items: res };
  writeFileSync(join(DIR, 'cut-control.json'), JSON.stringify(report, null, 1));
  console.log(JSON.stringify({ planted: report.planted, natural: report.natural }));
  for (const r of res) console.log(r.uid, r.accepted ? 'ACCEPT' : 'reject', r.exact ? 'exact' : 'differs', r.reason || '', r.cli_error || '', r.src);
} else if (mode === 'residual') {
  const todo = [];
  for (const a of ARMS) {
    const f = join(DIR, `${a.id.replace(/[:/]/g, '__')}.jsonl`);
    if (!existsSync(f)) continue;
    const recs = readJsonl(f).filter((r) => r.method === 'needs-cli');
    if (!recs.length) continue;
    const rows = new Map(readJsonl(a.path).map((r) => [a.key(r), r]));
    const untagged = isUntagged(a, [...rows.values()]);
    for (const rec of recs) todo.push({ arm: a, rec, untagged, raw: a.text(rows.get(rec.key)) });
  }
  const reqs = todo.map((t, i) => ({ uid: `r${i}`, prompt: cutPrompt(t.arm.kind, t.raw) }));
  console.log(`residual: ${reqs.length} rows`);
  const got = runCli(reqs, 'cut-residual');
  const out = todo.map((t, i) => {
    const row = got.get(`r${i}`);
    const j = judge(t.arm.kind, t.raw, row?.text, t.untagged);
    return { arm: t.arm.id, key: t.rec.key, raw_problem: t.rec.raw_problem, deterministic_steps: t.rec.steps, deterministic_after: t.rec.after_problem, ...stamp(),
      accepted: j.ok, reason: j.reason || null, cli_error: row?.error || null, guard: j.guard ? { ok: j.guard.ok, reason: j.guard.reason, kept_share: j.guard.kept_share } : null,
      text: j.ok ? j.span : undefined, rejected_reply: j.ok ? undefined : (row?.text || '').slice(0, 4000) };
  });
  writeFileSync(join(DIR, 'cut-residual.jsonl'), out.map((o) => JSON.stringify(o)).join('\n') + '\n');
  const acc = out.filter((o) => o.accepted).length;
  console.log(`accepted ${acc} / ${out.length}`);
  for (const o of out) console.log(o.arm, o.key, o.accepted ? 'ACCEPT' : 'reject', o.reason || '', o.cli_error || '');
} else {
  console.error('usage: cut-pass.mjs control|residual [--model M]');
  process.exit(1);
}
