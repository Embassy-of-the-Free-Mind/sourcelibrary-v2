#!/usr/bin/env node
// PRIOR ART: scripts/eval/seams-6742/flashlite.mjs DETECT.D1 (the question and reply shape, copied verbatim below) and
// scripts/eval/seams-6742/score.mjs (the thresholds 30/50/70/90, the real/plant/good split). flashlite.mjs sends ONE
// join per Gemini API call; this packs 10–20 joins per sealed `claude -p` call (claudeCall, lib.mjs) for a Claude-tier
// screen, which neither file does. score.mjs is a monolith over the census and the flash-lite ledger; the scorer here
// reads only the Opus labels and adds major-only recall, κ and the pass share a screen threshold leaves.
/**
 * detect — Claude models as a seam SCREEN (is this page turn defective?), against the #6742 Opus labels (#7118 step 3).
 *
 *   N="node --env-file=/root/sourcelibrary/.env.production.local"; S=scripts/eval/seam-tiers-7118/detect.mjs
 *   $N $S detect --out=DIR --model=haiku|sonnet [--pack=20] [--conc=4] [--limit=N] [--arm=NAME] [--windows=tight] [--thinking=off]
 *        writes DIR/detect-<arm>.jsonl (one row per join) and DIR/calls.jsonl (usage, list-price cost); resumable
 *   $N $S score  --out=DIR --arms=a,b,...   DIR/screen.json: AUC, recall/precision at 10–90, κ, plants, goods
 *   $N $S screened --out=DIR --testb=TDIR [--arms=sonnet,opus,gemini] [--screens=haiku-p10>=10,...]
 *        Test B (TDIR, gemini-repair.mjs stage + seam-repair.mjs verify) on all joins and on the joins each screen passes
 *
 * Items are scripts/eval/results/seams-6742/items.jsonl.gz (the 300 Opus-labelled joins), in a seeded shuffle so a
 * --limit prefix mixes the strata. --windows=tight re-cuts each excerpt to lean.mjs's runner windows (enWindow /
 * srcWindow), which is what a screen inside the nightly runner would see.
 */
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { claudeCall, extractJson, pool, shuffle } from '../seams-6742/lib.mjs';
import { joinText, packs, usageOf, placed, verdicts } from '../../maintenance/seam-repair-6742/seam-repair.mjs';
import { enWindow, srcWindow } from '../../maintenance/seam-repair-6742/lean.mjs';
import { wilson, aucLowerIsPositive } from '../lib/agreement-stats.mjs';
import { makeRng } from '../lib/paired-stats.mjs';

const arg = (k, d) => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? d;
const readJsonl = (f) => fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
const append = (f, x) => fs.appendFileSync(f, JSON.stringify(x) + '\n');
const SEAMS = path.join(path.dirname(new URL(import.meta.url).pathname), '../results/seams-6742');
const gz = (f) => zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').trim().split('\n').map(l => JSON.parse(l));

/** The packed D1 screen. The per-join question and the "NOT defects" list are flashlite.mjs COMMON + DETECT.D1. */
export const SCREEN = `Below are several page turns, each headed "##### JOIN <id>", from different historical books. Each shows the end
of page N and the start of page N+1, source (OCR) and English for both. Excerpts may be cut at "…" on their far side;
judge only the turn. Judge EACH join independently.
NOT defects: English ending mid-sentence where the source does; a hyphen-split word translated whole on page N; a
catchword left untranslated or rendered once; a full stop added with the meaning intact; running heads and page numbers.

Question, for each join: is there a DEFECT at the turn — source words near the turn left out, translated twice, put on
the wrong page, or English that does not read correctly across the turn?

Reply with ONE JSON array only, one object per join, in order:
[{"id":"<join id>","defect":"yes"|"no","p_defect":0-100,"reason":"<= 25 words"}, ...]

`;
export const screenPrompt = (pk) => `${SCREEN}${pk.map(joinText).join('\n')}`;

/** lean.mjs's runner windows, re-cut from a 1,500-char excerpt (the excerpt stands in for the page). */
export function tight(it) {
  const strip = (t) => String(t).replace(/^…|…$/g, '');
  const enA = strip(it.enTailA), enB = strip(it.enHeadB), srcA = strip(it.srcTailA), srcB = strip(it.srcHeadB);
  const enTailA = enWindow(enA, 'tail'), enHeadB = enWindow(enB, 'head');
  return { ...it, enTailA, enHeadB, srcTailA: srcWindow(srcA, enA, enTailA, 'tail'), srcHeadB: srcWindow(srcB, enB, enHeadB, 'head') };
}

export function items() { return shuffle(gz(path.join(SEAMS, 'items.jsonl.gz')), makeRng(7118)); }

/** Screen a list of joins with `model`, `pack` per call; rows go to `file`, call usage to `calls`. */
export async function screen(todo, { model, pack, conc, file, calls, arm, log = console.log }) {
  return pool(packs(todo, pack), conc, async (pk) => {
    const r = await claudeCall(screenPrompt(pk), model);
    if (r.cls === 'usage_limit') return { cls: r.cls };
    append(calls, { stage: 'detect', arm, n: pk.length, model: r.model, cls: r.cls, secs: Math.round(r.secs), usage: usageOf(r), at: new Date().toISOString() });
    const arr = r.cls ? null : extractJson(r.text, '[');
    const byId = new Map((Array.isArray(arr) ? arr : []).map(x => [x?.id, x]));
    let ok = 0;
    for (const it of pk) {
      const j = byId.get(it.id), parsed = !!j && Number.isFinite(Number(j.p_defect));
      if (parsed) ok++;
      append(file, { id: it.id, arm, parsed, defect: j?.defect, p_defect: parsed ? Number(j.p_defect) : null, reason: j?.reason, model: r.model, cls: r.cls || undefined });
    }
    return { ok: ok > 0, cls: r.cls };
  }, { log });
}

async function detect(out) {
  fs.mkdirSync(out, { recursive: true });
  // --thinking=off: the CLI's MAX_THINKING_TOKENS=0 (claudeCall passes the env through). Haiku thinks by default in
  // claude -p and spent ~2,000 output tokens per join on it (2026-10-22).
  if (arg('thinking') === 'off') process.env.MAX_THINKING_TOKENS = '0';
  const model = arg('model', 'haiku'), pack = Number(arg('pack', 20)), arm = arg('arm', `${model}-p${pack}${arg('thinking') === 'off' ? '-nt' : ''}`);
  const file = path.join(out, `detect-${arm}.jsonl`);
  const done = new Set(readJsonl(file).filter(x => x.parsed).map(x => x.id));
  let all = items().slice(0, Number(arg('limit', 1e9)));
  if (arg('windows') === 'tight') all = all.map(tight);
  const todo = all.filter(x => !done.has(x.id));
  console.log(`${arm}: ${todo.length} of ${all.length} joins to screen, ${Math.ceil(todo.length / pack)} calls`);
  const res = await screen(todo, { model, pack, conc: Number(arg('conc', 4)), file, calls: path.join(out, 'calls.jsonl'), arm });
  console.log(JSON.stringify(res));
}

// ── score ────────────────────────────────────────────────────────────────────
const r4 = (x) => x == null || Number.isNaN(x) ? null : +x.toFixed(4);
const rate = (k, n) => { const [lo, hi] = wilson(k, n); return { k, n, rate: n ? r4(k / n) : null, lo: r4(lo), hi: r4(hi) }; };
const kappa = (pairs) => { const n = pairs.length; if (!n) return null; const po = pairs.filter(([a, b]) => a === b).length / n;
  const pa = pairs.filter(([a]) => a).length / n, pb = pairs.filter(([, b]) => b).length / n, pe = pa * pb + (1 - pa) * (1 - pb); return pe === 1 ? null : r4((po - pe) / (1 - pe)); };
export const THRESHOLDS = [10, 20, 30, 40, 50, 70, 90];
/** Majors as #7118 defines them: omission, drift, duplication or broken syntax, labelled major by Opus. */
export const MAJOR4 = ['omission', 'drift', 'duplication', 'broken_syntax'];

export function scoreArm(rows, labels, key) {
  const d = new Map(rows.filter(x => x.parsed).map(x => [x.id, x]));
  const L = (id) => labels.get(id);
  const targets = { any: (id) => L(id).label !== 'ok', major: (id) => L(id).severity === 'major', major4: (id) => L(id).severity === 'major' && MAJOR4.includes(L(id).label) };
  const ids = [...labels.keys()].filter(id => d.has(id));
  const real = ids.filter(id => ['random', 'flagged'].includes(key.get(id)?.stratum));
  const evalSet = (set, target) => {
    const rs = set.map(id => ({ score: -d.get(id).p_defect, positive: target(id) }));
    const pos = rs.filter(r => r.positive).length;
    const thr = {};
    for (const t of THRESHOLDS) { const f = rs.filter(r => -r.score >= t);
      thr[t] = { flagged: f.length, passShare: r4(f.length / rs.length), recall: rate(f.filter(r => r.positive).length, pos), precision: rate(f.filter(r => r.positive).length, f.length) }; }
    return { n: rs.length, positives: pos, auc: pos && pos < rs.length ? r4(aucLowerIsPositive(rs)) : null, thresholds: thr };
  };
  const yes = (id) => d.get(id).defect === 'yes';
  const plants = ids.filter(id => key.get(id)?.stratum === 'plant'), goods = ids.filter(id => key.get(id)?.stratum === 'good');
  return {
    parsed: d.size, of: rows.length ? new Set(rows.map(r => r.id)).size : 0,
    all: { any: evalSet(ids, targets.any), major: evalSet(ids, targets.major), major4: evalSet(ids, targets.major4) },
    real: { any: evalSet(real, targets.any), major: evalSet(real, targets.major) },
    ownCall: { flagged: ids.filter(yes).length, agreementAny: rate(ids.filter(id => yes(id) === targets.any(id)).length, ids.length), kappaAny: kappa(ids.map(id => [yes(id), targets.any(id)])),
      recallMajor: rate(ids.filter(id => targets.major(id) && yes(id)).length, ids.filter(targets.major).length) },
    plantsCaught: rate(plants.filter(yes).length, plants.length), goodsFlagged: rate(goods.filter(yes).length, goods.length),
  };
}

/** The lowest-pass threshold that keeps ≥ `floor` recall on majors (point estimate), or null. */
export function pickThreshold(armScore, floor = 0.9, target = 'major') {
  const ok = THRESHOLDS.filter(t => (armScore.all[target].thresholds[t].recall.rate ?? 0) >= floor);
  return ok.length ? Math.max(...ok) : null;
}

function score(out) {
  const labels = new Map(gz(path.join(SEAMS, 'labels.jsonl.gz')).filter(x => x.parsed).map(x => [x.id, x]));
  const key = new Map(gz(path.join(SEAMS, 'key.jsonl.gz')).map(x => [x.id, x]));
  const calls = readJsonl(path.join(out, 'calls.jsonl'));
  const rep = { labelled: labels.size, positives: { any: [...labels.values()].filter(l => l.label !== 'ok').length, major: [...labels.values()].filter(l => l.severity === 'major').length,
    major4: [...labels.values()].filter(l => l.severity === 'major' && MAJOR4.includes(l.label)).length }, arms: {} };
  for (const arm of arg('arms', '').split(',').filter(Boolean)) {
    const s = scoreArm(readJsonl(path.join(out, `detect-${arm}.jsonl`)), labels, key);
    const c = calls.filter(x => x.arm === arm && x.stage === 'detect');
    const usd = c.reduce((a, x) => a + (x.usage?.list_usd || 0), 0), joins = c.reduce((a, x) => a + x.n, 0);
    s.cost = { calls: c.length, joins, failed: c.filter(x => x.cls).length, listUsd: r4(usd), listUsdPer100: joins ? r4(usd / joins * 100) : null, meanSecs: c.length ? Math.round(c.reduce((a, x) => a + x.secs, 0) / c.length) : null };
    s.threshold90major = pickThreshold(s);
    s.threshold90major4 = pickThreshold(s, 0.9, 'major4');
    rep.arms[arm] = s;
  }
  fs.writeFileSync(path.join(out, 'screen.json'), JSON.stringify(rep, null, 1) + '\n');
  console.log(JSON.stringify(rep, null, 1));
}

/**
 * Test B restricted to the joins a screen passes (no model calls): per repair arm of a gemini-repair.mjs Test B dir,
 * verified repairs (blind Opus prefers them in both orders) on every join, and on the joins each screen ≥ t passes.
 * A join the screen did not parse passes (a screen fails open).
 */
function screened(out, testb, screens) {
  const labels = new Map(gz(path.join(SEAMS, 'labels.jsonl.gz')).map(x => [x.id, x])), key = new Map(gz(path.join(SEAMS, 'key.jsonl.gz')).map(x => [x.id, x]));
  const isReal = (id) => ['random', 'flagged'].includes(key.get(id)?.stratum), isMajor = (id) => labels.get(id).severity === 'major';
  const rep = {};
  for (const arm of arg('arms', 'sonnet,opus,gemini').split(',')) {
    const v = verdicts(testb, arm);
    const ver = new Set(placed(testb, arm).filter(r => !r.refuse && v[r.id]?.prefers).map(r => r.id));
    const row = (ids) => ({ passed: ids.length, verified: ids.filter(id => ver.has(id)).length, yieldOf300: r4(ids.filter(id => ver.has(id)).length / labels.size),
      majorVerified: `${ids.filter(id => isMajor(id) && ver.has(id)).length}/${[...labels.keys()].filter(isMajor).length}`,
      realMajorVerified: `${ids.filter(id => isMajor(id) && isReal(id) && ver.has(id)).length}/${[...labels.keys()].filter(id => isMajor(id) && isReal(id)).length}` });
    const all = [...labels.keys()];
    rep[arm] = { all: row(all) };
    for (const s of screens) {
      const [det, t] = s.split('>='), d = new Map(readJsonl(path.join(out, `detect-${det}.jsonl`)).filter(x => x.parsed).map(x => [x.id, x.p_defect]));
      rep[arm][s] = row(all.filter(id => !d.has(id) || d.get(id) >= Number(t)));
    }
  }
  fs.writeFileSync(path.join(out, 'screened.json'), JSON.stringify(rep, null, 1) + '\n');
  console.log(JSON.stringify(rep, null, 1));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cmd = process.argv[2], out = arg('out');
  const go = { detect: () => detect(out), score: async () => score(out),
    screened: async () => screened(out, arg('testb'), arg('screens', 'haiku-p10>=10,haiku-p10>=1,sonnet-p10>=10').split(',')) }[cmd];
  if (!go || !out) { console.error('usage: see the header'); process.exit(2); }
  go().catch(e => { console.error(e); process.exit(1); });
}
