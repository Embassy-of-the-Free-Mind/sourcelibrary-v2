// PRIOR ART: seam-repair.mjs verify (blind Opus, both orders, A/A) — copied as verifyWide because its `placed` re-applies
// the edge bound and would refuse every repair measured here; lean.mjs --majors-wide is the bound this script measured.
// The script as it ran (job seam-prevent-7118, 2026-10-22): SRC is seam-tiers-7118's scratch dry run, OUT is $JOB_SCRATCH.
// `node majors-wide.mjs` stages (Mongo reads only), `node majors-wide.mjs verify` judges.
// Part B (#7118): the majors seam-tiers-7118's Sonnet dry run placed under the normal bound refused, re-placed under a
// wider majors-only bound; store mapping checked by a DRY writeRepairs (reads Mongo, writes nothing); the placed set
// staged as a seam-repair out dir for `seam-repair.mjs verify --arm=wide` (blind Opus, both orders, A/A).
import fs from 'fs';
import path from 'path';
import { MongoClient } from 'mongodb';
const W = new URL('../../../..', import.meta.url).pathname.replace(/\/$/, '');   // scripts/
const { edgeRefusal, writeRepairs } = await import(W + '/maintenance/seam-repair-6742/seam-repair.mjs');
const { lostWords, MAX_LOST } = await import(W + '/maintenance/seam-repair-6742/lean.mjs');
const { sentences } = await import(W + '/eval/seams-6742/lib.mjs');
const { validRepair } = await import(W + '/eval/seams-6742/opus-reference.mjs');
const { applyRepair } = await import(W + '/eval/seams-6742/judge-repairs.mjs');

export const WIDE = { maxSentences: 5, maxOldWords: 200, maxGrowWords: 150, maxGrowSentences: 2, maxLost: 24 };
const words = (t) => String(t || '').trim().split(/\s+/).filter(Boolean);
export function wideRefusal(it, rep, b = WIDE) {
  if (!rep) return 'no-repair';
  const vc = validRepair(it, rep);
  if (!vc.ok) return vc.tailOk ? 'head-old-not-at-edge' : 'tail-old-not-at-edge';
  const tOld = (rep.tail_old || '').trim(), hOld = (rep.head_old || '').trim();
  if (!tOld && !hOld) return 'empty-repair';
  for (const [o, nw] of [[tOld, rep.tail_new || ''], [hOld, rep.head_new || '']]) {
    if (!o) { if (String(nw).trim()) return 'new-text-without-old-span'; continue; }
    if (sentences(o).length > b.maxSentences) return `touches-more-than-${b.maxSentences}-sentences`;
    if (words(o).length > b.maxOldWords || words(nw).length > words(o).length + b.maxGrowWords) return 'edit-too-large';
    if (sentences(nw).length - sentences(o).length > b.maxGrowSentences) return `restores-more-than-${b.maxGrowSentences}-sentences`;
  }
  if (!applyRepair(it, rep)) return 'repair-changes-nothing';
  return lostWords(it, rep).length > b.maxLost ? 'drops-content-words' : null;
}
const driftOnly = (x) => { const ls = new Set([x.label, ...(x.labels || [])].filter(l => l && l !== 'ok')); return ls.size === 1 && ls.has('drift'); };

const { JUDGE } = await import(W + '/eval/seams-6742/judge-repairs.mjs');
const { pairText, packs, usageOf } = await import(W + '/maintenance/seam-repair-6742/seam-repair.mjs');
const { claudeCall, extractJson, pool, shuffle } = await import(W + '/eval/seams-6742/lib.mjs');
const { makeRng } = await import(W + '/eval/lib/paired-stats.mjs');
/** seam-repair.mjs verify, on this placed set (its own `placed` re-applies the normal bound): blind Opus, packs of 10,
 *  the two orders of a join in different calls, 10 A/A pairs. */
async function verifyWide(OUT) {
  const file = path.join(OUT, 'verify-wide.jsonl'), calls = path.join(OUT, 'calls.jsonl');
  const rdj = (f) => fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
  const done = new Set(rdj(file).map(v => v.pair));
  const cs = new Map(rdj(path.join(OUT, 'candidates.jsonl')).map(c => [c.id, c]));
  const ok = rdj(path.join(OUT, 'repair-wide.jsonl')).map(x => ({ id: x.id, it: cs.get(x.id), fixed: applyRepair(cs.get(x.id), x.repair) }));
  const rand = makeRng(7118);
  const mk = (r, order) => { const cur = { enTailA: r.it.enTailA, enHeadB: r.it.enHeadB };
    return { pair: `wide-${r.id}-${order}`, id: r.id, order, srcTailA: r.it.srcTailA, srcHeadB: r.it.srcHeadB, P: order === 'cur-first' ? cur : order === 'rep-first' ? r.fixed : cur, Q: order === 'cur-first' ? r.fixed : cur }; };
  const aa = shuffle(ok, rand).slice(0, Math.min(10, ok.length));
  const first = shuffle([...ok.map(r => mk(r, 'cur-first')), ...aa.map(r => mk(r, 'aa-1'))], rand), second = shuffle([...ok.map(r => mk(r, 'rep-first')), ...aa.map(r => mk(r, 'aa-2'))], rand);
  const todo = [...packs(first.filter(p => !done.has(p.pair)), 10), ...packs(second.filter(p => !done.has(p.pair)), 10)];
  console.log(`${ok.length} placed, ${todo.length} Opus calls`);
  return pool(todo, 4, async (pk) => {
    const r = await claudeCall(`${JUDGE}\n\n${pk.map(pairText).join('\n\n')}\n`, 'opus');
    if (r.cls === 'usage_limit') return { cls: r.cls };
    fs.appendFileSync(calls, JSON.stringify({ stage: 'verify', n: pk.length, model: r.model, cls: r.cls, secs: Math.round(r.secs), usage: usageOf(r), at: new Date().toISOString() }) + '\n');
    const arr = r.cls ? null : extractJson(r.text, '[');
    const by = new Map((Array.isArray(arr) ? arr : []).map(v => [v?.pair, v]));
    for (const p of pk) { const v = by.get(p.pair); fs.appendFileSync(file, JSON.stringify({ pair: p.pair, id: p.id, order: p.order, better: v?.better ?? null, P_defect: v?.P_defect, Q_defect: v?.Q_defect, note: v?.note, model: r.model }) + '\n'); }
    return { ok: by.size > 0, cls: r.cls };
  });
}
if (process.argv[2] === 'verify') { console.log(JSON.stringify(await verifyWide(process.env.JOB_SCRATCH + '/majors-wide'))); process.exit(0); }

const SRC = '/mnt/HC_Volume_105839809/jobs/seam-tiers-7118/lean-sonnet', OUT = process.env.JOB_SCRATCH + '/majors-wide';
fs.mkdirSync(OUT, { recursive: true });
const rd = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const cands = new Map(rd(SRC + '/candidates.jsonl').map(c => [c.id, c]));
const majors = rd(SRC + '/repairs.jsonl').filter(r => r.parsed && r.label !== 'ok' && r.severity === 'major');
const refused = majors.filter(x => { const it = cands.get(x.id); return edgeRefusal(it, x.repair) || lostWords(it, x.repair).length > MAX_LOST; });
const tally = { majors: majors.length, refusedNormal: refused.length, driftOnly: 0, wideRefused: {}, widePlaced: 0, byNormalReason: {} };
const placed = [];
for (const x of refused) {
  const it = cands.get(x.id);
  const normal = edgeRefusal(it, x.repair) || 'drops-content-words';
  if (driftOnly(x)) { tally.driftOnly++; continue; }
  const why = wideRefusal(it, x.repair);
  const k = tally.byNormalReason[normal] ||= { n: 0, placed: 0 }; k.n++;
  if (why) { tally.wideRefused[why] = (tally.wideRefused[why] || 0) + 1; continue; }
  k.placed++; tally.widePlaced++;
  placed.push({ id: x.id, it, x, arm: 'sonnet', normal, fixed: applyRepair(it, x.repair), verdict: { sampled: false } });
}
// store mapping: a dry writeRepairs reads the two pages and maps the spans; nothing is written
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const store = await writeRepairs(c.db('bookstore'), placed, { out: OUT, doApply: false, cli: 'claude', model: 'claude-sonnet-5-5', throwOnStop: true });
await c.close();
const storeRefused = new Set(rd(path.join(OUT, 'apply-refusals.jsonl')).filter(r => r.run === store.run).map(r => r.join));
tally.store = { planned: store.written, refused: store.refused };
fs.writeFileSync(path.join(OUT, 'candidates.jsonl'), placed.map(p => JSON.stringify({ join: true, ...p.it })).join('\n') + '\n');
fs.writeFileSync(path.join(OUT, 'repair-wide.jsonl'), placed.map(p => JSON.stringify({ id: p.id, parsed: true, ...p.x, normal: p.normal, storeRefused: storeRefused.has(p.id) })).join('\n') + '\n');
fs.writeFileSync(path.join(OUT, 'stage.json'), JSON.stringify({ bound: WIDE, ...tally }, null, 1));
console.log(JSON.stringify({ bound: WIDE, ...tally }, null, 1));
