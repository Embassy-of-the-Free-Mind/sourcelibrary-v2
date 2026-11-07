#!/usr/bin/env node
// PRIOR ART: scripts/eval/route-judge-6740/judge.mjs judgePrompt + opusCall + parseVerdict (the instrument, imported
// unchanged), scripts/eval/queue-routes-7853/judge.mjs runQueue (dedupe by text a page, the pace guard, resume from the
// verdict file), scripts/eval/severity-cal-7263/judge.mjs on PR #8136 (the second reader's wording; not merged, and its
// crops are left out here: the second reader opens the whole page).
/**
 * The panel's judging. Blind: one text a call with the page image; the same text on a page is judged once for every arm.
 *   node --env-file=... judge.mjs main --cell=C --upto=N [--conc=3] [--with-stored]   every arm's text on the first N pages
 *   node --env-file=... judge.mjs rep --cell=C [--upto=30]      the repeat arm's second read, and 30 same texts judged again
 *   node --env-file=... judge.mjs controls --cell=C             2 wrong-page controls per arm
 *   node --env-file=... judge.mjs second --cell=C               second reader, a random 20% of serious spans, severity not shown
 *   node --env-file=... judge.mjs outcomes --cell=C             OUT/<cell>/outcomes.json for look.py (no model call)
 * Hard cap: OPUS_CAP calls over the whole panel, counted from the verdict files.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { judgePrompt, parseVerdict, opusCall } from '../route-judge-6740/judge.mjs';
import { paceCheck } from '../correction-pass-7818/lib.mjs';
import { OUT, OPUS_CAP, CELLS, SEED, arg, flag, cellOf, selected, jsonl, sha, unit, shuffleBy, readText, imageBytes, pool, writeJ } from './lib.mjs';

const cell = cellOf(arg('cell'));
const VO = path.join(cell.dir, 'verdicts-opus.jsonl');
const SECOND = path.join(cell.dir, 'second-opus.jsonl');
const made = (r) => r.verdict || r.usage;
const panelCalls = () => Object.keys(CELLS).reduce((a, c) => a + jsonl(path.join(OUT, c, 'verdicts-opus.jsonl')).filter(made).length + jsonl(path.join(OUT, c, 'second-opus.jsonl')).filter(made).length, 0);
const norm = (t) => String(t).trim();
const verdictRows = () => jsonl(VO).filter((r) => r.verdict);

/** Items of an arm-label set: one per distinct text a page. id = page + text hash, carries no arm name. */
function itemsFor(S, labels) {
  const out = [];
  for (const s of S) {
    const by = new Map();
    for (const label of labels) {
      const t = readText(cell, s.key, label); if (t == null || !norm(t)) continue;
      const h = sha(norm(t)).slice(0, 16);
      if (!by.has(h)) by.set(h, { id: `q${sha(`${s.key}:${h}`).slice(0, 14)}`, key: s.key, page_id: s.page_id, text_sha: h, labels: [] });
      by.get(h).labels.push(label);
    }
    out.push(...by.values());
  }
  return out;
}
const judgePrompted = async (s, text, sourceKey = s.key) => {
  const img = await imageBytes(cell, s.key, s.image);
  const ws = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'rp7263-'));
  try {
    fs.writeFileSync(path.join(ws, 'page.jpg'), img);
    const prompt = judgePrompt({ task: cell.task, lang: cell.lang, text, source: cell.task === 'translation' ? readText(cell, sourceKey, 'source') : undefined }, 'the file ./page.jpg in your working directory (open it with Read before you answer)');
    const t0 = Date.now(), r = await opusCall(prompt, ws), verdict = r.cls === 'quota' ? null : parseVerdict(r.text);
    return { verdict, cls: r.cls, model: r.model, usage: r.usage, list_usd: r.cost, prompt_sha: sha(prompt).slice(0, 16), secs: Math.round((Date.now() - t0) / 1000), raw: verdict ? undefined : String(r.text).slice(0, 300) };
  } finally { fs.rmSync(ws, { recursive: true, force: true }); }
};
async function runQueue(jobs, file = VO) {
  const limits = await import('../../lib/model-limits.mjs');
  const state = {}; let stop = null, calls = 0;
  const left = OPUS_CAP - panelCalls();
  await pool(jobs, Math.max(1, Math.min(4, Number(arg('conc') || 3))), async (job) => {
    if (stop) return 'stop';
    if (calls >= left) { stop = `Opus cap ${OPUS_CAP}`; return 'stop'; }
    const why = await paceCheck(limits, state);
    if (why) { stop = `pace: ${why}`; return 'stop'; }
    calls++;
    const rec = await job();
    if (rec.cls === 'quota') { limits.noteLimitHit('claude', { reason: String(rec.raw || '').slice(0, 200) }); stop = 'quota reply'; return 'stop'; }
    fs.appendFileSync(file, JSON.stringify({ ...rec, at: new Date().toISOString() }) + '\n');
    return null;
  });
  console.log(`${calls} Opus calls; panel total ${panelCalls()}; ${stop ? `STOPPED: ${stop}` : 'queue done'}; meter ${JSON.stringify(state.meter ?? null)}`);
  if (stop) process.exitCode = 3;
}
const armLabels = (withStored) => Object.keys(cell.arms).filter((a) => (cell.arms[a].tier ? withStored : true));
async function main() {
  const S = selected(cell).slice(0, Number(arg('upto'))), by = new Map(S.map((s) => [s.key, s]));
  const have = new Set(verdictRows().filter((r) => r.set === 'abs').map((r) => r.id));
  const items = itemsFor(S, armLabels(flag('with-stored')));
  const todo = shuffleBy(items.filter((i) => !have.has(i.id)), `${SEED}:queue:${cell.name}`, (i) => i.id);
  console.log(`${cell.name}: ${items.length} items, ${todo.length} to judge`);
  await runQueue(todo.map((it) => async () => { const s = by.get(it.key); const r = await judgePrompted(s, readText(cell, it.key, it.labels[0])); return { id: it.id, set: 'abs', key: it.key, page_id: it.page_id, text_sha: it.text_sha, labels: it.labels, ...r }; }));
}
/** Repeat of the route (the arm's second read, judged like any other text) and of the judge (the same text judged again). */
async function rep() {
  const upto = Number(arg('upto') || 30), S = selected(cell).slice(0, upto), by = new Map(S.map((s) => [s.key, s]));
  const rows = verdictRows(), have = new Set(rows.map((r) => r.id));
  const R = cell.repeat, jobs = [];
  for (const it of itemsFor(S, [R, `${R}#rep`])) {
    if (it.labels.includes(R) || have.has(it.id)) continue;   // a second read identical to the first stands on the first's verdict
    const s = by.get(it.key);
    jobs.push(async () => ({ id: it.id, set: 'route_repeat', key: it.key, page_id: it.page_id, text_sha: it.text_sha, labels: it.labels, ...(await judgePrompted(s, readText(cell, it.key, it.labels[0]))) }));
  }
  for (const it of itemsFor(S, [R])) {
    const id = `${it.id}#rj`; if (have.has(id)) continue;
    const s = by.get(it.key);
    jobs.push(async () => ({ id, of: it.id, set: 'judge_repeat', key: it.key, page_id: it.page_id, text_sha: it.text_sha, labels: it.labels, ...(await judgePrompted(s, readText(cell, it.key, R))) }));
  }
  console.log(`${cell.name} repeats: ${jobs.length} to judge`);
  await runQueue(shuffleBy(jobs, `${SEED}:rep:${cell.name}`, (_, i) => i));
}
async function controls() {
  const S = selected(cell).slice(0, 30), have = new Set(verdictRows().map((r) => r.id)), jobs = [];
  for (const arm of Object.keys(cell.arms)) {
    const pool2 = shuffleBy(S.filter((s) => readText(cell, s.key, arm)), `${SEED}:wp:${cell.name}:${arm}`, (s) => s.key);
    for (let j = 0, k = 0; k < 2 && j + 1 < pool2.length; j += 2, k++) {
      const a = pool2[j], b = pool2[j + 1], id = `wp${sha(`${arm}:${a.key}:${b.key}`).slice(0, 12)}`;
      if (have.has(id)) continue;
      jobs.push(async () => ({ id, set: 'wrong_page', key: a.key, page_id: a.page_id, text_of: b.key, labels: [arm], ...(await judgePrompted(a, readText(cell, b.key, arm))) }));
    }
  }
  console.log(`${cell.name} controls: ${jobs.length} to judge`);
  await runQueue(jobs);
}

const SERIOUS = new Set(['misleads', 'wrong_text']);
const WHAT = cell.task === 'ocr' ? 'transcription' : 'translation';
export const secondPrompt = (it) => `You are checking points that another reader raised about a ${WHAT} of one page of a printed ${cell.lang} book. The page image is ./page.jpg in your working directory. Open it with Read before you answer.

${WHAT.toUpperCase()} (the whole page, for context):
"""
${it.text}
"""
${cell.task === 'translation' ? `
TRANSCRIPTION of the page (machine OCR; the image is the authority):
"""
${it.source}
"""
` : ''}
POINTS (the words of the ${WHAT}, and what the other reader said about them):
${it.points.map((p, k) => `${k + 1}. "${p.quote}" — ${p.what || 'no reason given'}`).join('\n')}

For each point, look at the page yourself and answer:
- different: "yes" when the ${WHAT}'s words there are not what the page ${cell.task === 'ocr' ? 'prints (a different, added or missing character, word, number, name or line)' : 'says (another sense, name, number or negation; a phrase lost or added)'}, "no" when they are, "cannot_tell" when the image does not let you decide.
- page_prints: what the page prints there, briefly.
- changes_sense: only when different is "yes": "yes" when a reader would take the sentence to say something other than what the page says; "no" when the difference is spelling, punctuation, layout, style or markup and the sentence still says the same.

Answer with JSON only: {"points":[{"n":1,"different":"yes|no|cannot_tell","page_prints":"...","changes_sense":"yes|no|null","why":"a few words"}]}`;
async function second() {
  const S = new Map(selected(cell).map((s) => [s.key, s])), rows = verdictRows().filter((r) => r.set === 'abs');
  const have = new Set(jsonl(SECOND).filter((r) => r.verdict).map((r) => r.id)), byItem = new Map();
  for (const r of rows) for (const [i, d] of (r.verdict.defects || []).entries()) {
    if (!SERIOUS.has(d.severity) || unit(`${SEED}:second:${r.id}:${i}`) >= 0.2) continue;
    (byItem.get(r.id) ?? byItem.set(r.id, { r, points: [] }).get(r.id)).points.push({ n: i, quote: String(d.quote ?? '').slice(0, 300), what: String(d.what ?? '').slice(0, 200), severity_first: d.severity });
  }
  const todo = [...byItem.values()].filter((x) => !have.has(x.r.id));
  console.log(`${cell.name} second reader: ${[...byItem.values()].reduce((a, x) => a + x.points.length, 0)} sampled spans on ${byItem.size} items of ${rows.length}; ${todo.length} calls to make`);
  await runQueue(todo.map(({ r, points }) => async () => {
    const s = S.get(r.key), text = readText(cell, r.key, r.labels[0]);
    const img = await imageBytes(cell, r.key, s.image);
    const ws = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'rp7263-'));
    try {
      fs.writeFileSync(path.join(ws, 'page.jpg'), img);
      const o = await opusCall(secondPrompt({ text, source: readText(cell, r.key, 'source'), points }), ws);
      let v = null; try { v = JSON.parse(String(o.text).match(/\{[\s\S]*\}/)[0]); if (!Array.isArray(v.points)) v = null; } catch { /* unparsed */ }
      return { id: r.id, key: r.key, labels: r.labels, points, verdict: v, cls: o.cls, model: o.model, usage: o.usage, list_usd: o.cost };
    } finally { fs.rmSync(ws, { recursive: true, force: true }); }
  }), SECOND);
}

/** {arm: {key: accept}}: a failed read is false with no judge call; a text not judged yet is absent. _order: the fixed order. */
function outcomes() {
  const S = selected(cell), arms = jsonl(path.join(cell.dir, 'arms.jsonl')), V = new Map(verdictRows().filter((r) => r.set === 'abs').map((r) => [`${r.key}:${r.text_sha}`, r.verdict]));
  const last = new Map(); for (const r of arms.filter((x) => !x.rep && !x.quota)) last.set(`${r.arm}:${r.key}`, r);
  const out = { _order: S.map((s) => s.key) };
  for (const arm of Object.keys(cell.arms)) {
    out[arm] = {};
    for (const s of S) {
      const t = readText(cell, s.key, arm);
      const failed = arm !== 'stored' && last.has(`${arm}:${s.key}`) && t == null;
      if (failed) { out[arm][s.key] = false; continue; }
      if (t == null) continue;
      const v = V.get(`${s.key}:${sha(norm(t)).slice(0, 16)}`);
      if (v) out[arm][s.key] = !!v.accept;
    }
  }
  writeJ(path.join(cell.dir, 'outcomes.json'), out);
}
/** Amendment 2: each guard-refused text judged once, as read, descriptively. Never in the stop rule or a k/n (its own set). */
async function guarded() {
  const S = new Map(selected(cell).map((s) => [s.key, s])), have = new Set(verdictRows().map((r) => r.id)), jobs = [], last = new Map();
  for (const r of jsonl(path.join(cell.dir, 'arms.jsonl')).filter((x) => !x.rep && !x.quota)) last.set(`${r.arm}:${r.key}`, r);
  let noText = 0;
  for (const r of last.values()) {
    if (r.cat !== 'guard' || readText(cell, r.key, r.arm) != null) continue;
    const t = readText(cell, r.key, `${r.arm}-read`);
    if (t == null || !norm(t)) { noText++; continue; }
    const id = `gr${sha(`${r.arm}:${r.key}`).slice(0, 14)}`, s = S.get(r.key);
    if (have.has(id)) continue;
    jobs.push(async () => ({ id, set: 'guard_refused', key: r.key, page_id: s.page_id, text_sha: sha(norm(t)).slice(0, 16), labels: [r.arm], why: r.why, ...(await judgePrompted(s, t)) }));
  }
  console.log(`${cell.name} guard-refused: ${jobs.length} to judge; ${noText} with no raw text kept`);
  await runQueue(shuffleBy(jobs, `${SEED}:gr:${cell.name}`, (_, i) => i));
}
const stages = { main, rep, controls, second, outcomes, guarded };
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  if (!stages[process.argv[2]]) { console.error(`stages: ${Object.keys(stages).join(' | ')}`); process.exit(2); }
  await stages[process.argv[2]]();
}
