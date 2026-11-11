#!/usr/bin/env node
// PRIOR ART: seam-repair.mjs `repair` (#6756) — the same PROMPT, pack format, repair-<arm>.jsonl / calls.jsonl rows and
// pool; it calls Opus/Sonnet through claude -p. This sends the identical prompt to Gemini through `agy -p`
// (scripts/lib/agy-cli.mjs gatedTextCall: plan mode, tool gate, markers), so every later stage of seam-repair.mjs
// (placed, verify, verdicts, apply) reads its output unchanged. scripts/eval/seams-6742/flashlite.mjs ran Gemini over
// the paid API; this is $0 (the agy subscription).
/**
 * gemini-repair — the pilot's seam label + minimal repair, by Gemini via the agy CLI (#6742 lean, Test B). $0.
 *
 *   node scripts/maintenance/seam-repair-6742/gemini-repair.mjs stage  --out=DIR    the #6742 300-junction set as a
 *        seam-repair out dir: candidates.jsonl (items) + repair-opus.jsonl (the Opus reference labels and repairs)
 *   node scripts/maintenance/seam-repair-6742/gemini-repair.mjs repair --out=DIR [--model=gemini-3.8-flash-low]
 *        [--pack=1] [--conc=4] [--limit=N]                                           writes repair-gemini.jsonl
 *   then: seam-repair.mjs verify --out=DIR --arm=gemini   (and --arm=opus: the same blind judge, both orders, A/A)
 *   node scripts/maintenance/seam-repair-6742/gemini-repair.mjs score --out=DIR       DIR/test-b.json, per arm and stratum
 *
 * A quota reply from agy pauses the pool (seam-repair-6742/lib.mjs pool) and re-probes every 15 min until
 * /root/agy-quota/status.json reports the model unlocked; the job never spends past a lockout.
 */
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { gatedTextCall } from '../../lib/agy-cli.mjs';
import { agyBlocked } from '../../lib/model-limits.mjs';
import { PROMPT, LABELS, validRepair, itemPrompt } from '../../eval/seams-6742/opus-reference.mjs';
import { extractJson, pool } from '../../eval/seams-6742/lib.mjs';
import { PACK_HEAD, joinText, packs, placed, verdicts } from './seam-repair.mjs';

const arg = (k, d) => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? d;
const readJsonl = (f) => fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
const append = (f, x) => fs.appendFileSync(f, JSON.stringify(x) + '\n');
const SEAMS = path.join(path.dirname(new URL(import.meta.url).pathname), '../../eval/results/seams-6742');
const gz = (f) => zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').trim().split('\n').map(l => JSON.parse(l));
export const MARKERS = '\n\nDo not open, read or write any file and do not use any tool: the joins are above. Write your JSON between two marker lines, <<<BEGIN>>> and <<<END>>>. Output nothing outside the markers.\n';
export const DEFAULT_MODEL = 'gemini-3.8-flash-low';

/** Is agy usable for `model` now? (the meter's view; a missing file counts as open) */
export function agyOpen(model) {
  return !agyBlocked(model);
}

function stage(out) {
  fs.mkdirSync(out, { recursive: true });
  const items = gz(path.join(SEAMS, 'items.jsonl.gz')), labels = gz(path.join(SEAMS, 'labels.jsonl.gz'));
  fs.writeFileSync(path.join(out, 'candidates.jsonl'), items.map(it => JSON.stringify({ join: true, ...it })).join('\n') + '\n');
  fs.writeFileSync(path.join(out, 'repair-opus.jsonl'), labels.map(l => JSON.stringify({ id: l.id, parsed: l.parsed, label: l.label, labels: l.labels, severity: l.severity, confidence: l.confidence,
    evidence: l.evidence, repair: l.repair ?? null, repairCheck: l.repairCheck, model: l.model })).join('\n') + '\n');
  console.log(JSON.stringify({ items: items.length, opusLabels: labels.length }));
}

/** One agy call over a pack of joins (pack 1 = the pilot's single-join prompt). Returns {byId, r}. */
export async function geminiPack(pk, model) {
  const sent = pk.length === 1 ? itemPrompt(pk[0]) + MARKERS : `${PACK_HEAD}${PROMPT}\n\n${pk.map(joinText).join('\n')}${MARKERS}`;
  const r = await gatedTextCall(sent, { model, task: 'translate', attempts: 2, tmp: process.env.TMPDIR });
  const body = r.answer || r.text || '';
  let arr = pk.length === 1 ? [extractJson(body)] : extractJson(body, '[');
  if (pk.length === 1 && arr[0]) arr[0].id = pk[0].id;
  const byId = new Map((Array.isArray(arr) ? arr : []).filter(Boolean).map(x => [x.id, x]));
  return { byId, r };
}

export async function repair(out, model, limit, pack, conc, { arm = 'gemini' } = {}) {
  const items = readJsonl(path.join(out, 'candidates.jsonl')).filter(r => r.join).slice(0, limit);
  const file = path.join(out, `repair-${arm}.jsonl`), calls = path.join(out, 'calls.jsonl');
  const done = new Set(readJsonl(file).map(x => x.id));
  const todo = items.filter(x => !done.has(x.id));
  console.log(`${items.length} joins, ${todo.length} to repair with ${model}, ${Math.ceil(todo.length / pack)} calls`);
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const probe = async () => { await sleep(1); return { cls: agyOpen(model) ? null : 'usage_limit' }; };
  const res = await pool(packs(todo, pack), conc, async (pk) => {
    if (!agyOpen(model)) return { cls: 'usage_limit' };
    const { byId, r } = await geminiPack(pk, model);
    append(calls, { stage: 'repair', arm, n: pk.length, model, cls: r.cls, calls: r.calls, problem: r.problem, tools: r.tool_calls?.length || 0, secs: Math.round(r.secs),
      usage: r.usage ? { in: r.usage.input_tokens, out: r.usage.output_tokens, thinking: r.usage.thinking_tokens } : null, at: new Date().toISOString() });
    if (r.cls === 'quota') return { cls: 'usage_limit' };
    let ok = 0;
    for (const it of pk) {
      const j = byId.get(it.id);
      const parsed = j && LABELS.includes(j.label) ? j : null;
      if (parsed) ok++;
      append(file, { id: it.id, parsed: !!parsed, ...(parsed || {}), repairCheck: parsed ? validRepair(it, parsed.repair) : null, model, cls: r.cls || undefined });
    }
    return { ok: ok > 0, cls: r.cls };
  }, { probe });
  console.log(JSON.stringify(res));
}

/** Test B: per arm — defects found, placed, verified (judge prefers the repair in both orders), worse; by stratum. */
function score(out, arms) {
  const key = new Map(gz(path.join(SEAMS, 'key.jsonl.gz')).map(k => [k.id, k]));
  const n = readJsonl(path.join(out, 'candidates.jsonl')).length;
  const rep = { items: n, gate: 'Gemini good enough: verified yield within 10 points of Opus, and preferred-worse <= 2% (of placed)', arms: {} };
  for (const arm of arms) {
    const pl = placed(out, arm), v = verdicts(out, arm);
    const row = (xs) => ({ n: xs.length, defective: xs.filter(r => r.x.parsed && r.x.label !== 'ok').length, placed: xs.filter(r => !r.refuse).length,
      verified: xs.filter(r => !r.refuse && v[r.id]?.prefers).length, worse: xs.filter(r => !r.refuse && v[r.id]?.worse).length, split: xs.filter(r => !r.refuse && v[r.id] && !v[r.id].prefers && !v[r.id].worse).length });
    const all = row(pl);
    const strata = {}; for (const s of ['random', 'flagged', 'good', 'plant']) strata[s] = row(pl.filter(r => key.get(r.id)?.stratum === s));
    const refusals = {}; for (const r of pl) if (r.refuse) refusals[r.refuse] = (refusals[r.refuse] || 0) + 1;
    const calls = readJsonl(path.join(out, 'calls.jsonl')).filter(c => c.arm === arm || (c.stage === 'verify' && c.arm === arm));
    rep.arms[arm] = { ...all, yield: +(all.verified / n).toFixed(3), worseOfPlaced: all.placed ? +(all.worse / all.placed).toFixed(3) : null, winOfPlaced: all.placed ? +(all.verified / all.placed).toFixed(3) : null,
      strata, refusals, aa: Object.values(v).filter(x => x.aa).map(x => x.aa.join('/')), calls: calls.reduce((a, c) => { const k = c.stage; a[k] = (a[k] || 0) + 1; return a; }, {}) };
  }
  const g = rep.arms.gemini, o = rep.arms.opus;
  if (g && o) rep.verdict = { yieldGapPoints: +((o.yield - g.yield) * 100).toFixed(1), geminiWorseOfPlaced: g.worseOfPlaced, geminiGoodEnough: (o.yield - g.yield) * 100 <= 10 && g.worseOfPlaced <= 0.02 };
  fs.writeFileSync(path.join(out, 'test-b.json'), JSON.stringify(rep, null, 1) + '\n');
  console.log(JSON.stringify(rep, null, 1));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cmd = process.argv[2], out = arg('out');
  if (cmd === 'score') score(out, arg('arms', 'gemini,opus').split(','));
  else if (cmd === 'stage') stage(out);
  else if (cmd === 'repair') repair(out, arg('model', DEFAULT_MODEL), Number(arg('limit', 1e9)), Number(arg('pack', 1)), Number(arg('conc', 4))).catch(e => { console.error(e); process.exit(1); });
  else { console.error('usage: see the header'); process.exit(2); }
}
