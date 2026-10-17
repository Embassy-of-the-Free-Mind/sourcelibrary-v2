#!/usr/bin/env node
// PRIOR ART: scripts/maintenance/seam-repair-6742/gemini-repair.mjs (Test B: the same PROMPT through agy, scored as a
// REPAIRER by verified yield; it never scored the label alone against Opus) and scripts/eval/seams-6742/flashlite.mjs
// (paid flash-lite detect arms D1–D5, AUC vs Opus). This sends the identical single-join prompt (itemPrompt) to an
// open model behind a local vLLM OpenAI-compatible server and scores the LABEL as a screener, against Opus and against
// the agy Flash screener's own labels on the same 300 joins (#6742, GEX45 queue #6871 item 1).
/**
 * local-screener — can an open model on the GEX45 replace the agy Flash screener for page joins? $0, no writes.
 *
 *   node scripts/eval/seams-6742/local-screener.mjs stage --out=DIR
 *        DIR/prompts.jsonl: {id, prompt} for the 300 junctions (itemPrompt, unchanged from Opus/Gemini)
 *   node scripts/eval/seams-6742/local-screener.mjs run --prompts=F --out=F --model=NAME [--url=http://127.0.0.1:8000]
 *        [--think=0|1] [--max-tokens=N] [--conc=8]
 *        stand-alone client (no repo imports, so it runs on gex45 beside the server); resumable; one row per join
 *   node scripts/eval/seams-6742/local-screener.mjs score --arm=NAME=FILE [--arm=…] [--out=FILE]
 *        agreement with Opus (binary: label != ok), split by direction, paired vs the agy Flash screener
 *
 * Preregistration: scripts/eval/experiments/2026-10-17-local-seam-screener-prereg-6742.md.
 */
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

const arg = (k, d) => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? d;
const args = (k) => process.argv.filter(a => a.startsWith(`--${k}=`)).map(a => a.split('=').slice(1).join('='));
const readJsonl = (f) => fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
const HERE = path.dirname(new URL(import.meta.url).pathname);
const RES = path.join(HERE, '../results');
const gz = (f) => zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').trim().split('\n').map(l => JSON.parse(l));
const LABELS = ['ok', 'omission', 'duplication', 'drift', 'broken_syntax', 'catchword', 'other'];

async function stage(out) {
  const { itemPrompt } = await import('./opus-reference.mjs');
  fs.mkdirSync(out, { recursive: true });
  const items = gz(path.join(RES, 'seams-6742/items.jsonl.gz'));
  fs.writeFileSync(path.join(out, 'prompts.jsonl'), items.map(it => JSON.stringify({ id: it.id, prompt: itemPrompt(it) })).join('\n') + '\n');
  console.log(JSON.stringify({ prompts: items.length }));
}

/** The label from a reply: the last {...} that parses and carries a known label; <think> blocks stripped. */
export function parseLabel(text) {
  const body = String(text || '').replace(/<think>[\s\S]*?<\/think>/g, '').replace(/^[\s\S]*<\/think>/, '');
  for (let end = body.lastIndexOf('}'); end > 0; end = body.lastIndexOf('}', end - 1)) {
    for (let start = body.lastIndexOf('{', end); start >= 0; start = body.lastIndexOf('{', start - 1)) {
      try { const j = JSON.parse(body.slice(start, end + 1)); if (j && LABELS.includes(j.label)) return j; } catch { /* keep looking */ }
    }
  }
  return null;
}

async function run() {
  const prompts = readJsonl(arg('prompts')), out = arg('out'), model = arg('model'), url = arg('url', 'http://127.0.0.1:8000');
  const think = arg('think', '0') === '1', maxTokens = Number(arg('max-tokens', think ? 6144 : 1024)), conc = Number(arg('conc', 8));
  const done = new Set(readJsonl(out).map(r => r.id));
  const todo = prompts.filter(p => !done.has(p.id));
  console.log(`${prompts.length} prompts, ${todo.length} to run on ${model} think=${think}`);
  const t0 = Date.now(); let i = 0;
  const worker = async () => {
    while (i < todo.length) {
      const p = todo[i++]; const s = Date.now();
      let row;
      try {
        const res = await fetch(`${url}/v1/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
          model, messages: [{ role: 'user', content: p.prompt }], max_tokens: maxTokens, temperature: think ? 0.6 : 0.7, top_p: think ? 0.95 : 0.8, top_k: 20,
          seed: 6742, chat_template_kwargs: { enable_thinking: think } }) });
        const j = await res.json();
        const text = j.choices?.[0]?.message?.content ?? '', reasoning = j.choices?.[0]?.message?.reasoning_content ?? '';
        const parsed = parseLabel(text);
        row = { id: p.id, parsed: !!parsed, label: parsed?.label ?? null, labels: parsed?.labels ?? null, severity: parsed?.severity ?? null, confidence: parsed?.confidence ?? null,
          evidence: parsed?.evidence ?? null, repair: parsed?.repair ?? null, finish: j.choices?.[0]?.finish_reason ?? null, usage: j.usage ?? null,
          secs: (Date.now() - s) / 1000, raw: parsed ? undefined : (text + reasoning).slice(-1500), err: j.error ? JSON.stringify(j.error).slice(0, 300) : undefined };
      } catch (e) { row = { id: p.id, parsed: false, label: null, err: String(e).slice(0, 300), secs: (Date.now() - s) / 1000 }; }
      fs.appendFileSync(out, JSON.stringify({ ...row, model, think, at: new Date().toISOString() }) + '\n');
    }
  };
  await Promise.all(Array.from({ length: conc }, worker));
  const wall = (Date.now() - t0) / 1000;
  console.log(JSON.stringify({ ran: todo.length, wallSecs: wall, joinsPerSec: +(todo.length / wall).toFixed(3) }));
}

// ---- scoring -------------------------------------------------------------------------------------------------
const Z = 1.959964;
function wilson(k, n) {
  if (!n) return [null, null];
  const p = k / n, d = 1 + Z * Z / n, c = (p + Z * Z / (2 * n)) / d, h = (Z * Math.sqrt(p * (1 - p) / n + Z * Z / (4 * n * n))) / d;
  return [+(c - h).toFixed(3), +(c + h).toFixed(3)];
}
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function kappa(pairs) {
  const n = pairs.length; if (!n) return null;
  const po = pairs.filter(([a, b]) => a === b).length / n, pa = pairs.filter(([a]) => a).length / n, pb = pairs.filter(([, b]) => b).length / n;
  const pe = pa * pb + (1 - pa) * (1 - pb);
  return pe === 1 ? null : +((po - pe) / (1 - pe)).toFixed(3);
}
const rate = (k, n) => ({ k, n, p: n ? +(k / n).toFixed(3) : null, ci: wilson(k, n) });

/** Binary screen row vs Opus: flagged = label != ok; an unparsed reply counts as flagged (it would go on to agy). */
const flagged = (r) => !r || !r.parsed || r.label !== 'ok';

function stats(ids, opus, arm) {
  const pairs = ids.map(id => [opus.get(id), flagged(arm.get(id))]);
  const pos = pairs.filter(([o]) => o), neg = pairs.filter(([o]) => !o);
  return {
    n: ids.length, agree: rate(pairs.filter(([a, b]) => a === b).length, ids.length), kappa: kappa(pairs),
    // "removes a mark": Opus marks the join defective and the screener clears it (a miss; the repair is lost)
    sensitivity: rate(pos.filter(([, b]) => b).length, pos.length),
    // "adds a mark": Opus calls the join ok and the screener flags it (a wasted agy call downstream)
    specificity: rate(neg.filter(([, b]) => !b).length, neg.length),
    flagRate: rate(pairs.filter(([, b]) => b).length, ids.length),
    unparsed: ids.filter(id => arm.get(id) && !arm.get(id).parsed).length, missing: ids.filter(id => !arm.get(id)).length,
  };
}

/** Paired bootstrap over joins: (arm − flash) for agreement, sensitivity, specificity. */
function pairedDiff(ids, opus, arm, flash, iters = 10000) {
  const r = rng(6742);
  const row = (id) => ({ o: opus.get(id), a: flagged(arm.get(id)), f: flagged(flash.get(id)) });
  const rows = ids.map(row);
  const m = (xs) => {
    const ag = xs.reduce((s, x) => s + (x.a === x.o) - (x.f === x.o), 0) / xs.length;
    const P = xs.filter(x => x.o), N = xs.filter(x => !x.o);
    const se = P.length ? P.reduce((s, x) => s + x.a - x.f, 0) / P.length : 0;
    const sp = N.length ? N.reduce((s, x) => s + (!x.a) - (!x.f), 0) / N.length : 0;
    return [ag, se, sp];
  };
  const point = m(rows), boots = [[], [], []];
  for (let i = 0; i < iters; i++) { const s = rows.map(() => rows[Math.floor(r() * rows.length)]); m(s).forEach((v, k) => boots[k].push(v)); }
  const ci = (b) => { b.sort((x, y) => x - y); return [+b[Math.floor(iters * 0.025)].toFixed(3), +b[Math.floor(iters * 0.975)].toFixed(3)]; };
  return { agree: { d: +point[0].toFixed(3), ci: ci(boots[0]) }, sensitivity: { d: +point[1].toFixed(3), ci: ci(boots[1]) }, specificity: { d: +point[2].toFixed(3), ci: ci(boots[2]) } };
}

function score() {
  const key = new Map(gz(path.join(RES, 'seams-6742/key.jsonl.gz')).map(k => [k.id, k]));
  const opus = new Map(gz(path.join(RES, 'seams-6742/labels.jsonl.gz')).map(l => [l.id, l.label !== 'ok']));
  const flashRows = gz(path.join(RES, 'seam-lean-6742/test-b/repair-gemini.jsonl.gz'));
  const flash = new Map(flashRows.map(r => [r.id, r]));
  const arms = { 'flash-agy': flash };
  for (const a of args('arm')) { const [name, file] = a.split('='); arms[name] = new Map(readJsonl(file).map(r => [r.id, r])); }
  const ids = [...key.keys()];
  const sets = {
    real240: ids.filter(id => ['random', 'flagged'].includes(key.get(id).stratum)),
    random: ids.filter(id => key.get(id).stratum === 'random'), flagged: ids.filter(id => key.get(id).stratum === 'flagged'),
    good: ids.filter(id => key.get(id).stratum === 'good'), plant: ids.filter(id => key.get(id).stratum === 'plant'),
  };
  // Test B's verified Gemini repairs: the yield a screen in front of Gemini would keep or lose.
  const tb = path.join(RES, 'seam-lean-6742/test-b');
  const verified = (() => { try { return new Set(verifiedIds(tb)); } catch { return null; } })();
  const rep = { opusDefective: { real240: sets.real240.filter(id => opus.get(id)).length, all: ids.filter(id => opus.get(id)).length }, arms: {} };
  for (const [name, arm] of Object.entries(arms)) {
    const r = { sets: {} };
    for (const [s, xs] of Object.entries(sets)) r.sets[s] = stats(xs, opus, arm);
    if (name !== 'flash-agy') r.vsFlash = { real240: pairedDiff(sets.real240, opus, arm, flash), random: pairedDiff(sets.random, opus, arm, flash), flagged: pairedDiff(sets.flagged, opus, arm, flash) };
    if (verified) r.keepsVerifiedGeminiRepairs = rate([...verified].filter(id => flagged(arm.get(id))).length, verified.size);
    const rows = [...arm.values()];
    const secs = rows.map(x => x.secs).filter(Number.isFinite);
    if (secs.length && name !== 'flash-agy') r.usage = { meanSecs: +(secs.reduce((a, b) => a + b, 0) / secs.length).toFixed(1),
      meanCompletionTokens: Math.round(rows.reduce((s, x) => s + (x.usage?.completion_tokens || 0), 0) / rows.length),
      meanPromptTokens: Math.round(rows.reduce((s, x) => s + (x.usage?.prompt_tokens || 0), 0) / rows.length),
      truncated: rows.filter(x => x.finish === 'length').length };
    rep.arms[name] = r;
  }
  const out = arg('out');
  if (out) fs.writeFileSync(out, JSON.stringify(rep, null, 1) + '\n');
  for (const [name, r] of Object.entries(rep.arms)) {
    const s = r.sets.real240;
    console.log(`${name.padEnd(22)} real240 agree ${s.agree.p} ${JSON.stringify(s.agree.ci)} κ ${s.kappa} | sens ${s.sensitivity.k}/${s.sensitivity.n} spec ${s.specificity.k}/${s.specificity.n} | flag ${s.flagRate.p} | plants ${r.sets.plant.sensitivity.k}/30 good-flagged ${r.sets.good.flagRate.k}/30 | unparsed ${s.unparsed}${r.vsFlash ? ` | Δagree ${r.vsFlash.real240.agree.d} ${JSON.stringify(r.vsFlash.real240.agree.ci)} Δsens ${r.vsFlash.real240.sensitivity.d} Δspec ${r.vsFlash.real240.specificity.d}` : ''}${r.keepsVerifiedGeminiRepairs ? ` | keeps ${r.keepsVerifiedGeminiRepairs.k}/${r.keepsVerifiedGeminiRepairs.n} verified` : ''}`);
  }
}

/** Joins whose Gemini repair the blind Opus judge preferred in both orders (Test B), from the committed verify file. */
function verifiedIds(dir) {
  // seam-repair.mjs verdicts(): P is shown first; "prefers" = the repair wins in both orders.
  const by = {};
  for (const v of gz(path.join(dir, 'verify-gemini.jsonl.gz'))) (by[v.id] ||= {})[v.order] = v;
  return Object.entries(by).filter(([, o]) => o['cur-first']?.better === 'Q' && o['rep-first']?.better === 'P').map(([id]) => id);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cmd = process.argv[2];
  if (cmd === 'stage') stage(arg('out'));
  else if (cmd === 'run') run().catch(e => { console.error(e); process.exit(1); });
  else if (cmd === 'score') score();
  else { console.error('usage: see the header'); process.exit(2); }
}
