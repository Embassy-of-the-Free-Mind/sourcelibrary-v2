#!/usr/bin/env node
// PRIOR ART: scripts/batch/cli-translate.mjs `read` (the production CLI request: buildTranslationPrompt + PAGE_BREAK_SCOPED
// + TRANSLATE_SUFFIX through gatedTextCall, seeded with the page before) is reproduced call for call; seam-repair.mjs
// `verify` (JUDGE + pairText, both orders in different calls, packs of 10, A/A pairs) is the join judge, unchanged;
// seams-6742/lib.mjs pool/claudeCall and gemini-repair.mjs agyOpen pause on a lockout. No existing harness re-translates
// BOTH pages of a stored join under two prompts; translation-prompt-v14-ab.mjs runs the paid Batch lane.
/**
 * seam-prompt A/B (#6742, job seam-prevent): does one added instruction (candidate.mjs) cut broken page joins in new
 * translations without costing whole-page fidelity? Preregistered in PREREGISTRATION.md. $0: agy + claude CLI.
 *
 *   N="node --env-file=/root/sourcelibrary/.env.production.local"; S=scripts/eval/seam-prompt-6742/ab.mjs
 *   $N $S build     --out=DIR                       context per junction (Mongo reads); drops untranslatable joins
 *   $N $S translate --out=DIR [--arms=P,P2,C] [--conc=4] [--limit=N]     agy, one page per call, resumable
 *   $N $S joinjudge --out=DIR [--conc=4]            blind Opus join judge: C vs P, P2 vs P, both orders, 20 A/A
 *   $N $S pagejudge --out=DIR [--conc=4]            blind Opus whole-page judge on a seeded half
 *   $N $S score     --out=DIR                       report.json, the registered rule's output
 */
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { MongoClient } from 'mongodb';
import { PAGE_BREAK_SCOPED, buildTranslationPrompt, loadTranslationPrompts, isTranslatablePage, sameLanguageReason, sanitizeTranslationTags, contentHash } from '../../lib/translate-core.mjs';
import { gatedTextCall, TRANSLATE_SUFFIX } from '../../lib/agy-cli.mjs';
import { cliChatterReason } from '../../lib/cli-chatter.mjs';
import { sourceProse, translationProse } from '../../lib/block-drift.mjs';
import { JUDGE } from '../seams-6742/judge-repairs.mjs';
import { claudeCall, extractJson, pool, shuffle } from '../seams-6742/lib.mjs';
import { pairText, packs, usageOf } from '../../maintenance/seam-repair-6742/seam-repair.mjs';
import { agyOpen } from '../../maintenance/seam-repair-6742/gemini-repair.mjs';
import { makeRng, resetSeed, bootstrapCI } from '../lib/paired-stats.mjs';
import { withSeamRule } from './candidate.mjs';

const arg = (k, d) => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? d;
const readJsonl = (f) => fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
const append = (f, x) => fs.appendFileSync(f, JSON.stringify(x) + '\n');
const SEAMS = path.join(path.dirname(new URL(import.meta.url).pathname), '../results/seams-6742');
const gz = (f) => zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').trim().split('\n').map(l => JSON.parse(l));
export const MODEL = 'gemini-3.8-flash-low';
const EDGE = 1500;
const tail = (t) => t.length > EDGE ? '…' + t.slice(-EDGE) : t;
const head = (t) => t.length > EDGE ? t.slice(0, EDGE) + '…' : t;
const PROJ = { _id: 0, id: 1, book_id: 1, page_number: 1, page_type: 1, ocr: 1, 'translation.data': 1 };

// ── build ────────────────────────────────────────────────────────────────────
async function build(out) {
  fs.mkdirSync(out, { recursive: true });
  const key = gz(path.join(SEAMS, 'key.jsonl.gz'));
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect(); const db = c.db('bookstore');
  const rows = [], dropped = {};
  for (const k of key) {
    const book = await db.collection('books').findOne({ id: k.book }, { projection: { _id: 0, id: 1, title: 1, display_title: 1, author: 1, year: 1, published: 1, language: 1, image_source: 1 } });
    const pages = await db.collection('pages').find({ book_id: k.book, page_number: { $in: [k.p - 1, k.p, k.p + 1, k.p + 2] } }, { projection: PROJ }).toArray();
    const at = (n) => pages.find(p => p.page_number === n);
    const A = at(k.p), B = at(k.p + 1);
    const why = !book ? 'no-book' : !A || !B ? 'page-missing' : !isTranslatablePage(A).ok ? `N-${isTranslatablePage(A).reason}` : !isTranslatablePage(B).ok ? `N1-${isTranslatablePage(B).reason}`
      : sameLanguageReason({ book, page: A }) || sameLanguageReason({ book, page: B }) || null;
    if (why) { dropped[why] = (dropped[why] || 0) + 1; continue; }
    const prev = at(k.p - 1), next2 = at(k.p + 2);
    rows.push({ id: k.id, stratum: k.stratum, script: k.script || 'unknown', book, p: k.p, idA: A.id, idB: B.id,
      ocrPrev: prev?.ocr?.data || null, trPrev: prev?.translation?.data || null, ocrA: A.ocr.data, ocrB: B.ocr.data, ocrNext2: next2?.ocr?.data || null,
      srcTailA: tail(sourceProse(A.ocr.data)), srcHeadB: head(sourceProse(B.ocr.data)) });
  }
  await c.close();
  fs.writeFileSync(path.join(out, 'ctx.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  fs.writeFileSync(path.join(out, 'build.json'), JSON.stringify({ at: new Date().toISOString(), junctions: key.length, kept: rows.length, dropped }, null, 1));
  console.log(JSON.stringify({ junctions: key.length, kept: rows.length, dropped }));
}

// ── translate ────────────────────────────────────────────────────────────────
export function promptsForArm(prompts, arm) {
  if (arm !== 'C') return prompts;
  const text = withSeamRule(prompts.translation.text);
  return { ...prompts, translation: { text, ref: { ...prompts.translation.ref, id: 'candidate-seam-6742', name: 'Standard Translation + seam rule (candidate)', version: 'v13+1a', content_hash: contentHash(text) } } };
}

async function translate(out, arms, conc, limit) {
  const ctx = readJsonl(path.join(out, 'ctx.jsonl')).slice(0, limit);
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const base = await loadTranslationPrompts(c.db('bookstore'));
  await c.close();
  if (base.translation.ref.version !== 13 || base.translation.ref.content_hash !== '516510147237b6a79d9d3f6e797bba7f') throw new Error(`default translation prompt is not the registered v13: ${JSON.stringify(base.translation.ref)}`);
  const file = path.join(out, 'reads.jsonl');
  const done = new Set(readJsonl(file).filter(r => r.ok).map(r => `${r.id}:${r.arm}:${r.side}`));
  const tries = new Map(); for (const r of readJsonl(file)) { const k = `${r.id}:${r.arm}:${r.side}`; tries.set(k, (tries.get(k) || 0) + 1); }
  const readOf = new Map(readJsonl(file).filter(r => r.ok).map(r => [`${r.id}:${r.arm}:${r.side}`, r.text]));
  // interleaved by junction so the arms run side by side through the same hours
  const tasks = ctx.flatMap(x => arms.map(arm => ({ x, arm }))).filter(({ x, arm }) => !(done.has(`${x.id}:${arm}:N`) && done.has(`${x.id}:${arm}:N1`)));
  console.log(`${ctx.length} junctions × ${arms.join(',')}: ${tasks.length} chains to run`);
  const one = async (x, arm, side, previousTranslation) => {
    const k = `${x.id}:${arm}:${side}`;
    if (done.has(k)) return { ok: true, text: readOf.get(k) };
    if ((tries.get(k) || 0) >= 2) return { ok: false, gaveUp: true };
    if (!agyOpen(MODEL)) return { cls: 'usage_limit' };
    const built = buildTranslationPrompt({ prompts: promptsForArm(base, arm), book: x.book, ocrText: side === 'N' ? x.ocrA : x.ocrB, previousTranslation,
      prevOcrText: (side === 'N' ? x.ocrPrev : x.ocrA) || undefined, nextOcrText: (side === 'N' ? x.ocrB : x.ocrNext2) || undefined, pageBreak: PAGE_BREAK_SCOPED });
    const sent = built.prompt + TRANSLATE_SUFFIX;
    const r = await gatedTextCall(sent, { model: MODEL, task: 'translate', tmp: process.env.TMPDIR });
    if (r.cls === 'quota') return { cls: 'usage_limit' };
    const text = r.cls ? '' : r.answer;
    const bad = r.cls || r.problem || (!text.trim() ? 'empty' : cliChatterReason(text));
    tries.set(k, (tries.get(k) || 0) + 1);
    append(file, { id: x.id, arm, side, ok: !bad, why: bad || undefined, text, chars: text.length, secs: Math.round(r.secs), calls: r.calls, sent_hash: contentHash(sent), prompt: built.promptRef, page_break: built.pageBreak?.applied || false, at: new Date().toISOString() });
    if (!bad) { done.add(k); readOf.set(k, text); }
    return { ok: !bad, text };
  };
  const res = await pool(tasks, conc, async ({ x, arm }) => {
    const a = await one(x, arm, 'N', x.trPrev);
    if (a.cls) return a;
    if (!a.ok) return { ok: !!a.gaveUp };
    const b = await one(x, arm, 'N1', sanitizeTranslationTags(a.text));
    if (b.cls) return b;
    return { ok: b.ok || !!b.gaveUp };
  }, { probe: async () => ({ cls: agyOpen(MODEL) ? null : 'usage_limit' }), maxWaitH: 10 });
  console.log(JSON.stringify(res));
}

// ── join excerpts per arm ────────────────────────────────────────────────────
function versions(out) {
  const ctx = new Map(readJsonl(path.join(out, 'ctx.jsonl')).map(x => [x.id, x]));
  const reads = {}; for (const r of readJsonl(path.join(out, 'reads.jsonl')).filter(r => r.ok)) ((reads[r.id] ||= {})[r.arm] ||= {})[r.side] = r.text;
  const v = {};
  for (const [id, byArm] of Object.entries(reads)) for (const [arm, s] of Object.entries(byArm)) if (s.N && s.N1) {
    (v[id] ||= {})[arm] = { enTailA: tail(translationProse(s.N)), enHeadB: head(translationProse(s.N1)), N: s.N, N1: s.N1 };
  }
  return { ctx, v };
}

// ── join judge ───────────────────────────────────────────────────────────────
const COMPARISONS = [['C', 'P'], ['P2', 'P']];
async function joinjudge(out, conc) {
  const { ctx, v } = versions(out);
  const file = path.join(out, 'joinjudge.jsonl'), calls = path.join(out, 'calls.jsonl');
  const done = new Set(readJsonl(file).filter(j => j.better).map(j => j.pair));
  const rand = makeRng(6742);
  const ids = [...ctx.keys()].filter(id => ['P', 'P2', 'C'].every(a => v[id]?.[a]));
  const pair = (id, x, y, order) => { const it = ctx.get(id); const [P, Q] = order === 1 ? [v[id][x], v[id][y]] : [v[id][y], v[id][x]];
    return { pair: `${x}${y}-${id}-${order}`, id, cmp: `${x}-${y}`, order, Pis: order === 1 ? x : y, srcTailA: it.srcTailA, srcHeadB: it.srcHeadB, P: { enTailA: P.enTailA, enHeadB: P.enHeadB }, Q: { enTailA: Q.enTailA, enHeadB: Q.enHeadB } }; };
  const aaIds = shuffle(ids, rand).slice(0, 20);
  const aa = (order) => aaIds.map(id => { const it = ctx.get(id), p = v[id].P; return { pair: `AA-${id}-${order}`, id, cmp: 'P-P', order, Pis: 'P', srcTailA: it.srcTailA, srcHeadB: it.srcHeadB, P: { enTailA: p.enTailA, enHeadB: p.enHeadB }, Q: { enTailA: p.enTailA, enHeadB: p.enHeadB } }; });
  const first = shuffle([...ids.flatMap(id => COMPARISONS.map(([x, y]) => pair(id, x, y, 1))), ...aa(1)], rand);
  const second = shuffle([...ids.flatMap(id => COMPARISONS.map(([x, y]) => pair(id, x, y, 2))), ...aa(2)], rand);
  const todo = [...packs(first.filter(p => !done.has(p.pair)), 10), ...packs(second.filter(p => !done.has(p.pair)), 10)];
  console.log(`${ids.length} junctions with all three arms; ${todo.length} judge calls`);
  const res = await pool(todo, conc, async (pk) => {
    const r = await claudeCall(`${JUDGE}\n\n${pk.map(pairText).join('\n\n')}\n`, 'opus');
    if (r.cls === 'usage_limit') return { cls: r.cls };
    append(calls, { stage: 'joinjudge', n: pk.length, model: r.model, cls: r.cls, secs: Math.round(r.secs), usage: usageOf(r), at: new Date().toISOString() });
    const arr = r.cls ? null : extractJson(r.text, '[');
    const by = new Map((Array.isArray(arr) ? arr : []).map(x => [x?.pair, x]));
    let n = 0;
    for (const p of pk) { const j = by.get(p.pair); if (j && ['P', 'Q', 'tie'].includes(j.better)) n++;
      append(file, { pair: p.pair, id: p.id, cmp: p.cmp, order: p.order, Pis: p.Pis, better: j?.better ?? null, P_defect: j?.P_defect ?? null, Q_defect: j?.Q_defect ?? null, note: j?.note, model: r.model }); }
    return { ok: n > 0, cls: r.cls };
  });
  console.log(JSON.stringify(res));
}

// ── whole-page judge ─────────────────────────────────────────────────────────
export const PAGE_JUDGE = `You are judging two English translations of the SAME page of a historical book against its source
(OCR transcription; it may contain OCR errors). For each PAIR below you get the SOURCE page and two VERSIONS, P and Q.
They were made by different processes; you are not told which is which and must not guess. They may be identical.

Judge FIDELITY over the whole page: which version renders the source more faithfully and completely? Count against a
version: source content left out, content added that the source does not carry, mistranslations that change meaning,
text left untranslated. Do not count style, word choice that keeps the meaning, formatting, or tags such as <note>,
<term>, <gloss>, <meta>. If neither is more faithful (including when they are the same), say "tie".

For each pair, reply with:
{"pair":"<pair id>","better":"P"|"Q"|"tie","note":"<= 20 words"}

Reply with ONE JSON array containing one object per pair, in order, and nothing else.`;
const PAGE_CAP = 8000;
const cap = (t) => t.length > PAGE_CAP ? t.slice(0, PAGE_CAP) + '\n[… cut for length]' : t;
export const pageBody = (t) => String(t).replace(/<(summary|keywords)(?:\s[^>]*)?>[\s\S]*?<\/\1>/gi, '').trim();
const pagePairText = (p) => `##### PAIR ${p.pair}\n--- SOURCE ---\n${cap(p.src)}\n--- VERSION P ---\n${cap(p.P)}\n--- VERSION Q ---\n${cap(p.Q)}`;
export function pageSample(ids) {
  const rand = makeRng(67420);
  return shuffle(ids, rand).slice(0, Math.ceil(ids.length / 2)).map(id => ({ id, side: rand() < 0.5 ? 'N' : 'N1' }));
}
async function pagejudge(out, conc) {
  const { ctx, v } = versions(out);
  const file = path.join(out, 'pagejudge.jsonl'), calls = path.join(out, 'calls.jsonl');
  const done = new Set(readJsonl(file).filter(j => j.better).map(j => j.pair));
  const ids = [...ctx.keys()].filter(id => ['P', 'P2', 'C'].every(a => v[id]?.[a]));
  const sample = pageSample(ids);
  const rand = makeRng(67421);
  const mk = ({ id, side }, x, y, order) => { const src = side === 'N' ? ctx.get(id).ocrA : ctx.get(id).ocrB; const [a, b] = order === 1 ? [x, y] : [y, x];
    return { pair: `pg${x}${y}-${id}-${order}`, id, side, cmp: `${x}-${y}`, order, Pis: a, src, P: pageBody(v[id][a][side]), Q: pageBody(v[id][b][side]) }; };
  const aaS = sample.slice(0, 10);
  const aa = (order) => aaS.map(s => ({ ...mk(s, 'P', 'P', order), pair: `pgAA-${s.id}-${order}`, cmp: 'P-P' }));
  const first = shuffle([...sample.flatMap(s => COMPARISONS.map(([x, y]) => mk(s, x, y, 1))), ...aa(1)], rand);
  const second = shuffle([...sample.flatMap(s => COMPARISONS.map(([x, y]) => mk(s, x, y, 2))), ...aa(2)], rand);
  const todo = [...packs(first.filter(p => !done.has(p.pair)), 5), ...packs(second.filter(p => !done.has(p.pair)), 5)];
  console.log(`${sample.length} pages; ${todo.length} judge calls`);
  const res = await pool(todo, conc, async (pk) => {
    const r = await claudeCall(`${PAGE_JUDGE}\n\n${pk.map(pagePairText).join('\n\n')}\n`, 'opus');
    if (r.cls === 'usage_limit') return { cls: r.cls };
    append(calls, { stage: 'pagejudge', n: pk.length, model: r.model, cls: r.cls, secs: Math.round(r.secs), usage: usageOf(r), at: new Date().toISOString() });
    const arr = r.cls ? null : extractJson(r.text, '[');
    const by = new Map((Array.isArray(arr) ? arr : []).map(x => [x?.pair, x]));
    let n = 0;
    for (const p of pk) { const j = by.get(p.pair); if (j && ['P', 'Q', 'tie'].includes(j.better)) n++;
      append(file, { pair: p.pair, id: p.id, side: p.side, cmp: p.cmp, order: p.order, Pis: p.Pis, better: j?.better ?? null, note: j?.note, model: r.model }); }
    return { ok: n > 0, cls: r.cls };
  });
  console.log(JSON.stringify(res));
}

// ── score ────────────────────────────────────────────────────────────────────
const pct = (a, b) => b ? +(100 * a / b).toFixed(1) : null;
const ci100 = (ci) => ci ? ci.map(x => +(100 * x).toFixed(1)) : null;
/** Per comparison x-y: per junction, is each version defective in BOTH orders, and who was preferred in both orders. */
export function joinTable(rows, cmp) {
  const [x, y] = cmp.split('-'); const by = {};
  for (const j of rows.filter(r => r.cmp === cmp && r.better)) (by[j.id] ||= {})[j.order] = j;
  const out = {};
  for (const [id, o] of Object.entries(by)) {
    if (!o[1] || !o[2]) continue;
    const defOf = (j, arm) => (j.Pis === arm ? j.P_defect : j.Q_defect) === true;
    const pref = (j) => j.better === 'tie' ? 'tie' : (j.better === 'P') === (j.Pis === x) ? x : y;
    out[id] = { [`def_${x}`]: defOf(o[1], x) && defOf(o[2], x), [`def_${y}`]: defOf(o[1], y) && defOf(o[2], y),
      [`anydef_${x}`]: defOf(o[1], x) || defOf(o[2], x), [`anydef_${y}`]: defOf(o[1], y) || defOf(o[2], y),
      pref: pref(o[1]) === pref(o[2]) ? pref(o[1]) : 'split' };
  }
  return out;
}
function pageTable(rows, cmp) {
  const [x, y] = cmp.split('-'); const by = {};
  for (const j of rows.filter(r => r.cmp === cmp && r.better)) (by[j.id] ||= {})[j.order] = j;
  const out = {};
  for (const [id, o] of Object.entries(by)) { if (!o[1] || !o[2]) continue;
    const pref = (j) => j.better === 'tie' ? 'tie' : (j.better === 'P') === (j.Pis === x) ? x : y;
    out[id] = { pref: pref(o[1]) === pref(o[2]) ? pref(o[1]) : 'split', side: o[1].side }; }
  return out;
}
function score(out) {
  const ctx = new Map(readJsonl(path.join(out, 'ctx.jsonl')).map(x => [x.id, x]));
  const reads = readJsonl(path.join(out, 'reads.jsonl'));
  const { v } = versions(out);
  const jj = readJsonl(path.join(out, 'joinjudge.jsonl')), pj = readJsonl(path.join(out, 'pagejudge.jsonl'));
  const rep = { build: JSON.parse(fs.readFileSync(path.join(out, 'build.json'), 'utf8')), model: MODEL };
  // reads
  rep.reads = {};
  for (const arm of ['P', 'P2', 'C']) {
    const rs = reads.filter(r => r.arm === arm);
    const ok = new Set(rs.filter(r => r.ok).map(r => `${r.id}:${r.side}`));
    const failedJunctions = [...ctx.keys()].filter(id => !(ok.has(`${id}:N`) && ok.has(`${id}:N1`)));
    const whys = {}; for (const r of rs.filter(r => !r.ok)) whys[r.why] = (whys[r.why] || 0) + 1;
    rep.reads[arm] = { calls: rs.reduce((a, r) => a + (r.calls || 1), 0), okPages: ok.size, failedJunctions: failedJunctions.length, failures: whys,
      medianSecs: rs.map(r => r.secs).sort((a, b) => a - b)[Math.floor(rs.length / 2)] ?? null };
  }
  // A/A judge floor
  const aaJ = jj.filter(j => j.cmp === 'P-P' && j.better), aaP = pj.filter(j => j.cmp === 'P-P' && j.better);
  rep.judgeFloor = { join: { n: aaJ.length, tie: aaJ.filter(j => j.better === 'tie').length }, page: { n: aaP.length, tie: aaP.filter(j => j.better === 'tie').length } };
  // join judge
  const CP = joinTable(jj, 'C-P'), PP = joinTable(jj, 'P2-P');
  const both = Object.keys(CP).filter(id => PP[id]);
  const delta = (T, x, y, ids, k = 'def') => ids.map(id => (T[id][`${k}_${y}`] ? 1 : 0) - (T[id][`${k}_${x}`] ? 1 : 0)); // y − x: positive = x has fewer defects
  const sum = (a) => a.reduce((s, z) => s + z, 0);
  resetSeed(6742);
  const dCP = delta(CP, 'C', 'P', both), dPP = delta(PP, 'P2', 'P', both);
  const ciCP = bootstrapCI(dCP), ciPP = bootstrapCI(dPP);
  const group = (ids) => { const d = delta(CP, 'C', 'P', ids); return { n: ids.length, defP: pct(ids.filter(id => CP[id].def_P).length, ids.length), defC: pct(ids.filter(id => CP[id].def_C).length, ids.length), delta100: pct(sum(d), ids.length) }; };
  const latin = both.filter(id => ['latin', 'unknown', 'None'].includes(ctx.get(id).script)), other = both.filter(id => !latin.includes(id));
  const prefs = (T, ids) => ids.reduce((a, id) => { a[T[id].pref] = (a[T[id].pref] || 0) + 1; return a; }, {});
  rep.join = {
    n: both.length,
    CvsP: { defP: pct(both.filter(id => CP[id].def_P).length, both.length), defC: pct(both.filter(id => CP[id].def_C).length, both.length),
      anydefP: pct(both.filter(id => CP[id].anydef_P).length, both.length), anydefC: pct(both.filter(id => CP[id].anydef_C).length, both.length),
      delta100: pct(sum(dCP), both.length), ci100: ci100(ciCP), discordant: { Cbetter: dCP.filter(d => d > 0).length, Pbetter: dCP.filter(d => d < 0).length }, preferredBothOrders: prefs(CP, both) },
    P2vsP: { defP: pct(both.filter(id => PP[id].def_P).length, both.length), defP2: pct(both.filter(id => PP[id].def_P2).length, both.length),
      delta100: pct(sum(dPP), both.length), ci100: ci100(ciPP), discordant: { P2better: dPP.filter(d => d > 0).length, Pbetter: dPP.filter(d => d < 0).length }, preferredBothOrders: prefs(PP, both) },
    byScript: { latin: group(latin), other: group(other) },
    byStratum: Object.fromEntries(['random', 'flagged', 'good', 'plant'].map(s => [s, group(both.filter(id => ctx.get(id).stratum === s))])),
  };
  // whole-page judge
  const PC = pageTable(pj, 'C-P'), PG = pageTable(pj, 'P2-P');
  const pids = Object.keys(PC).filter(id => PG[id]);
  const lw = (T, x, y) => pids.map(id => (T[id].pref === y ? 1 : 0) - (T[id].pref === x ? 1 : 0)); // L − W from x's side
  resetSeed(67422);
  const lwC = lw(PC, 'C', 'P'), lwP2 = lw(PG, 'P2', 'P');
  const ciLwC = bootstrapCI(lwC), ciLwP2 = bootstrapCI(lwP2);
  const lenRatio = pids.map(id => { const s = PC[id].side; return pageBody(v[id].C[s]).length / Math.max(1, pageBody(v[id].P[s]).length); }).sort((a, b) => a - b);
  rep.page = { n: pids.length, CvsP: { ...prefs(PC, pids), LminusW: pct(sum(lwC), pids.length), ci100: ci100(ciLwC) }, P2vsP: { ...prefs(PG, pids), LminusW: pct(sum(lwP2), pids.length), ci100: ci100(ciLwP2) },
    medianLenRatioCoverP: lenRatio.length ? +lenRatio[Math.floor(lenRatio.length / 2)].toFixed(3) : null };
  // the registered rule
  const d = rep.join.CvsP, f = rep.join.P2vsP, pg = rep.page;
  const rule = {
    effect_ci_excludes_0: !!d.ci100 && d.ci100[0] > 0,
    effect_outside_floor: !!f.ci100 && d.delta100 > f.ci100[1],
    effect_min_8: d.delta100 >= 8,
    script_groups_same_sign: Math.sign(rep.join.byScript.latin.delta100) === Math.sign(rep.join.byScript.other.delta100) && rep.join.byScript.latin.delta100 > 0,
    page_noninferior: !!pg.CvsP.ci100 && pg.CvsP.ci100[1] <= 10 && pg.CvsP.LminusW <= (pg.P2vsP.LminusW ?? 0) + 5,
    failed_reads: rep.reads.C.failedJunctions <= rep.reads.P.failedJunctions + 2,
    length_ratio: (pg.medianLenRatioCoverP ?? 0) >= 0.95,
    judge_floor: rep.judgeFloor.join.n > 0 && rep.judgeFloor.join.tie / rep.judgeFloor.join.n >= 0.8 && (!rep.judgeFloor.page.n || rep.judgeFloor.page.tie / rep.judgeFloor.page.n >= 0.8),
  };
  const effect = rule.effect_ci_excludes_0 && rule.effect_outside_floor && rule.effect_min_8 && rule.script_groups_same_sign;
  const guards = rule.page_noninferior && rule.failed_reads && rule.length_ratio && rule.judge_floor;
  rep.rule = { ...rule, verdict: effect && guards ? 'SHIP' : effect ? 'EFFECT WITH A COST: not shipped' : 'NO MEASURABLE EFFECT: not shipped' };
  const calls = readJsonl(path.join(out, 'calls.jsonl'));
  rep.claudeCalls = calls.reduce((a, c) => { a[c.stage] = (a[c.stage] || 0) + 1; return a; }, {});
  rep.claudeListUsd = +calls.reduce((a, c) => a + (c.usage?.list_usd || 0), 0).toFixed(2);
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(rep, null, 1) + '\n');
  console.log(JSON.stringify(rep, null, 1));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cmd = process.argv[2], out = arg('out');
  const conc = Number(arg('conc', 4));
  const go = { build: () => build(out), translate: () => translate(out, arg('arms', 'P,P2,C').split(','), conc, Number(arg('limit', 1e9))),
    joinjudge: () => joinjudge(out, conc), pagejudge: () => pagejudge(out, conc), score: async () => score(out) }[cmd];
  if (!go || !out) { console.error('usage: see the header'); process.exit(2); }
  go().catch(e => { console.error(e); process.exit(1); });
}
