#!/usr/bin/env node
// PRIOR ART: ./blocks4-8399.mjs (#8407) — its sample (ctx.jsonl, 120 blocks in 69 books), waves, reads layout, joins,
// planted defects, seam judge (ab.mjs JUDGE_PROMPT via seams-6742/lib.mjs claudeCall), leak flag and lane weights are
// imported, not copied. It measured arms A, A2, B4, Bb and an eval-copy seam pass (C). This adds the arms of the
// follow-up: A0 (production per-call=4 with no previous-page English, the #8410 branch), the seam pass AS BUILT
// (scripts/lib/seam-pass.mjs, the stage claude-translate.mjs --seam-pass runs) on A0 and on Bb, the same with no edit to
// the page before the block, and term consistency over runs of 12 consecutive pages.
/**
 * The seam pass as a production stage (#8399 arm C) and arm A0 (#8410). $0: agy (subscription) + claude CLI.
 * Mongo reads only; no page is written.
 *
 *   N="node --env-file=/root/sourcelibrary/.env.production.local"; S=scripts/eval/seam-prevent-7118/seam-pass-8399.mjs
 *   $N $S translate --out=DIR --arm=A0 --reader-root=TREE    production reader from TREE (the #8410 change applied)
 *   $N $S stage     --out=DIR --base=A0|Bb                    the built seam pass over that arm's reads (seam-<base>.jsonl)
 *   $N $S judge     --out=DIR [--conc=3]                      the #7118 judge, both orders, on the follow-up's versions
 *   $N $S runs      --out=DIR [--n=16]                        12-page runs for term consistency (runs.jsonl)
 *   $N $S runread   --out=DIR --arm=A|A2|A0 [--reader-root=TREE]
 *   $N $S terms     --out=DIR                                 mechanical term-consistency count (terms.json)
 *   $N $S termjudge --out=DIR [--n=8]                         Opus check of a sample of the term count
 *   $N $S score     --out=DIR
 */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { readJsonl, storedWaves, readsDir, joinsOf, plant, tail, head, normTr, LANE_W, MODEL } from './blocks4-8399.mjs';
import { sourceProse, translationProse } from '../../lib/block-drift.mjs';
import { sharedRun, LEAK_MIN_CHARS } from '../../audit/translation-page-boundaries.mjs';
import { makeRng } from '../lib/paired-stats.mjs';
import { shuffle } from '../seams-6742/lib.mjs';

const arg = (k, d) => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? d;
const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(HERE, '../../..');
const ENV = '--env-file=/root/sourcelibrary/.env.production.local';
export const ALL_READ = ['A', 'A2', 'B4', 'Bb', 'A0'];

/** Spawn the production reader over a page-id list. A0: from `root` (a tree with #8410), the previous English unset. */
function readIds(dir, ids, arm, root, job) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'ids.json'), JSON.stringify(ids));
  const args = [ENV, path.join(root, 'scripts/batch/claude-translate.mjs'), 'read', `--page-ids-file=${path.join(dir, 'ids.json')}`, `--out=${dir}`,
    '--cli=agy', '--per-call=4', '--fresh', `--job=${job}`, '--ocr-checked=eval #8399: every arm reads the same stored OCR; the test is of the translation call, not the OCR'];
  const env = { ...process.env, CANDIDATE_READS: 'off', AGY_HOME: process.env.AGY_HOME || '/root/.agy-james' };
  delete env.TRANSLATE_PREVIOUS_ENGLISH;
  if (arm === 'A' || arm === 'A2') env.TRANSLATE_PREVIOUS_ENGLISH = '1';   // a #8410 tree needs it to send production's context
  const r = spawnSync('node', args, { stdio: 'inherit', env, cwd: root });
  if (r.status === 3) { console.error(`${dir}: usage limit; re-run to resume`); process.exit(3); }
  if (r.status) console.error(`${dir}: exit ${r.status}`);
}

function translate(out, arm, root) {
  const ctx = readJsonl(path.join(out, 'ctx.jsonl'));
  for (const [k, w] of storedWaves(ctx).entries()) readIds(readsDir(out, arm, k), w.flatMap(r => r.pageIds), arm, root, `seam-pass-8399-${arm}`);
}

/** { [rowId]: { [arm]: { [page_number]: {text, call_id} } } } over every read arm present on disk. */
export function armTexts(out, ctx, arms = ALL_READ) {
  const ws = storedWaves(ctx), v = {};
  for (const arm of arms) for (const [k, w] of ws.entries()) {
    const dir = readsDir(out, arm, k);
    for (const r of w) {
      const slot = ((v[r.id] ||= {})[arm] = {});
      r.block.forEach((n, i) => {
        const id = r.pageIds[i];
        try {
          const m = JSON.parse(fs.readFileSync(path.join(dir, `${id}.meta.json`), 'utf8'));
          const t = fs.readFileSync(path.join(dir, `${id}.txt`), 'utf8').trim();
          if (m.exit === 0 && t.length > 5) slot[n] = { text: t, call_id: m.call_id, call_pages: m.call_pages, previous: !!m.context?.previous_translation };
        } catch { /* no read */ }
      });
    }
  }
  return v;
}

// ── the follow-up's versions of every join ───────────────────────────────────
const readSeam = (dir, sub, id) => { try { return fs.readFileSync(path.join(dir, sub, `${id}.txt`), 'utf8').trim(); } catch { return null; } };
/** A seam-passed arm: the base arm's reads with DIR/seam/<id>.txt where the built stage changed the page (incl. the page
 *  before the block); `locked`: the page before stays stored, and the block's first page is the locked alternative. */
export function stagedText(out, r, base, n, v, { locked = false } = {}) {
  const dir = readsDir(out, base, r.wave);
  if (n === r.before.n) return locked ? r.before.tr : readSeam(dir, 'seam', r.before.id) ?? r.before.tr;
  const id = r.pageIds[r.block.indexOf(n)];
  if (locked && n === r.block[0]) {
    const sp = readJsonl(path.join(dir, 'seam-pass.jsonl')).find(j => j.right === id && j.left === r.before.id);
    if (sp?.changed) return sp.locked?.changed ? readSeam(dir, 'seam-locked', id) : v[r.id][base]?.[n]?.text;
  }
  return readSeam(dir, 'seam', id) ?? v[r.id][base]?.[n]?.text;
}
export const STAGED = { A0S: ['A0', false], A0L: ['A0', true], BbS: ['Bb', false] };
export const BASE_OF = { A0S: 'A0', A0L: 'A0', BbS: 'Bb', C: 'Bb' };
const enTail = (t) => tail(translationProse(t));
const enHead = (t) => head(translationProse(t));

export function joinVersions2(out, ctx, sentences) {
  const v = armTexts(out, ctx);
  const c = new Map(readJsonl(path.join(out, 'seam-c.jsonl')).filter(x => x.ok).map(x => [x.id, x]));
  const J = {};
  ctx.forEach((r, k) => {
    for (const j of joinsOf(r)) {
      const side = (arm, n) => (n === r.before.n ? r.before.tr : v[r.id][arm]?.[n]?.text);
      const versions = {};
      let complete = true;
      for (const arm of ['A', 'A2', 'A0', 'Bb']) {
        const L = side(arm, j.left), R = side(arm, j.right);
        if (!L || !R) { complete = false; break; }
        versions[arm] = { tailA: enTail(L), headB: enHead(R) };
      }
      if (!complete) { J[`${r.id}:${j.join}`] = { r, j, incomplete: true }; continue; }
      // a passed arm is its own version only where its text at this join differs from its base's
      const differs = (x, b) => x.tailA !== b.tailA || x.headB !== b.headB;
      for (const [name, [base, locked]] of Object.entries(STAGED)) {
        const x = { tailA: enTail(stagedText(out, r, base, j.left, v, { locked })), headB: enHead(stagedText(out, r, base, j.right, v, { locked })) };
        if (differs(x, versions[base])) versions[name] = x;
      }
      const sc = c.get(r.id);
      if (sc) { const x = { tailA: enTail(sc.texts[j.left]), headB: enHead(sc.texts[j.right]) }; if (differs(x, versions.Bb)) versions.C = x; }
      versions.Acopy = versions.A;
      const p = plant(versions.A.tailA, versions.A.headB, k + (j.join === 'S' ? 1 : 0), sentences);
      if (p) versions.P = { tailA: p.tailA, headB: p.headB, plant: p.plant };
      J[`${r.id}:${j.join}`] = { r, j, versions, srcTailA: tail(sourceProse(r.ocr[j.left])), srcHeadB: head(sourceProse(r.ocr[j.right])) };
    }
  });
  return J;
}

async function judge(out, conc) {
  const { JUDGE_PROMPT } = await import('./ab.mjs');
  const { LABELS } = await import('../seams-6742/opus-reference.mjs');
  const { claudeCall, extractJson, pool, sentences } = await import('../seams-6742/lib.mjs');
  const ctx = readJsonl(path.join(out, 'ctx.jsonl'));
  const J = joinVersions2(out, ctx, sentences);
  const file = path.join(out, 'judge2.jsonl');
  const done = new Set(readJsonl(file).filter(j => j.parsed).map(j => `${j.id}:${j.order}`));
  const rand = makeRng(84001);
  const todo = [];
  for (const [id, x] of Object.entries(J)) {
    if (x.incomplete) continue;
    const arms = shuffle(Object.keys(x.versions), rand);
    for (const [order, list] of [[1, arms], [2, [...arms].reverse()]]) if (!done.has(`${id}:${order}`)) todo.push({ id, x, order, arms: list });
  }
  console.log(`${Object.keys(J).length} joins; ${todo.length} judge calls`);
  const res = await pool(todo, conc, async ({ id, x, order, arms }) => {
    const text = `${JUDGE_PROMPT}\n\n=== SOURCE N (end) ===\n${x.srcTailA}\n\n=== SOURCE N+1 (start) ===\n${x.srcHeadB}\n\n` +
      arms.map((a, i) => `##### VERSION V${i + 1}\n--- ENGLISH N (end) ---\n${x.versions[a].tailA}\n--- ENGLISH N+1 (start) ---\n${x.versions[a].headB}`).join('\n\n') + '\n';
    const r = await claudeCall(text, 'opus');
    if (r.cls === 'usage_limit') return { cls: r.cls };
    const arr = r.cls ? null : extractJson(r.text, '[');
    const by = new Map((Array.isArray(arr) ? arr : []).map(o => [String(o?.version), o]));
    const verdicts = Object.fromEntries(arms.map((a, i) => { const o = by.get(`V${i + 1}`); return [a, o && LABELS.includes(o.label) ? { label: o.label, labels: Array.isArray(o.labels) ? o.labels : [o.label], severity: o.severity, evidence: o.evidence } : null]; }));
    const parsed = Object.values(verdicts).every(Boolean);
    fs.appendFileSync(file, JSON.stringify({ id, order, arms, parsed, verdicts, model: r.model, cls: r.cls, secs: Math.round(r.secs), usage: r.usage, raw: parsed ? undefined : String(r.text).slice(0, 1500), at: new Date().toISOString() }) + '\n');
    return { ok: parsed, cls: r.cls };
  });
  console.log(JSON.stringify(res));
}

// ── leaks (blocks4 leaks, every arm of the follow-up) ────────────────────────
export function leaks2(out, ctx) {
  const { foldOcrWords } = BLOCKS4;
  const v = armTexts(out, ctx);
  const c = new Map(readJsonl(path.join(out, 'seam-c.jsonl')).filter(x => x.ok).map(x => [x.id, x]));
  const textOf = (arm, r, n) => {
    if (STAGED[arm]) return stagedText(out, r, STAGED[arm][0], n, v, { locked: STAGED[arm][1] });
    if (arm === 'C') return c.get(r.id)?.texts[n] ?? (n === r.before.n ? r.before.tr : v[r.id].Bb?.[n]?.text);
    return n === r.before.n ? r.before.tr : v[r.id][arm]?.[n]?.text;
  };
  const grams = (t) => { const w = foldOcrWords(t), g = new Set(); for (let i = 0; i + 4 <= w.length; i++) g.add(w.slice(i, i + 4).join(' ')); return g; };
  const rep = {}, flags = [];
  for (const arm of ['A', 'A2', 'A0', 'A0S', 'A0L', 'Bb', 'BbS', 'C']) {
    let pairs = 0;
    for (const r of ctx) {
      const seq = [r.before.n, ...r.block];
      for (let i = 0; i + 1 < seq.length; i++) {
        const L = textOf(arm, r, seq[i]), R = textOf(arm, r, seq[i + 1]);
        if (!L || !R) continue;
        pairs++;
        const run = sharedRun(normTr(R), normTr(L));
        if (run.len < LEAK_MIN_CHARS) continue;
        const a = grams(r.ocr[seq[i]]), b = grams(r.ocr[seq[i + 1]]); let sh = 0; for (const g of b) if (a.has(g)) sh++;
        // Amendment 2's classes (blocks4 leaks): source repeat; a block-start flag that an arm which never saw the stored
        // English also raises is the stored page's; else the translation made it
        flags.push({ arm, row: r.id, prev: seq[i], next: seq[i + 1], boundary: i === 0, len: run.len, text: run.text, src_shared4: sh, source: sh >= 10 && sh >= 0.1 * Math.min(a.size, b.size) });
      }
    }
    rep[arm] = { pairs };
  }
  const noPrev = new Set(flags.filter(f => f.boundary && ['A0', 'Bb'].includes(f.arm)).map(f => `${f.row}|${f.prev}`));
  for (const f of flags) f.class = f.source ? 'source' : f.boundary && noPrev.has(`${f.row}|${f.prev}`) ? 'stored_left' : 'translation';
  for (const arm of Object.keys(rep)) { const fs_ = flags.filter(f => f.arm === arm); rep[arm].flags = fs_.length; for (const k of ['source', 'stored_left', 'translation']) rep[arm][k] = fs_.filter(f => f.class === k).length; }
  return { rep, flags };
}
const BLOCKS4 = await import('./blocks4-8399.mjs');

// ── term consistency over runs of 12 consecutive pages ───────────────────────
export const RUN_LEN = 12;
async function runs(out, n) {
  const { MongoClient } = await import('mongodb');
  const { isTranslatablePage } = await import('../../lib/translate-core.mjs');
  const { NON_PROSE_TYPES } = await import('../../lib/page-integrity.mjs');
  const prose = (p) => p && isTranslatablePage(p).ok && !NON_PROSE_TYPES.has(p.page_type) && (p.ocr?.data || '').length >= 200;
  const ctx = readJsonl(path.join(out, 'ctx.jsonl'));
  const books = [...new Map(ctx.map(r => [r.book.id, r.book])).values()].sort((a, b) => (a.id < b.id ? -1 : 1));
  const order = shuffle(books, makeRng(84002)), rand = makeRng(84003);
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect(); const db = c.db('bookstore');
  const rows = [];
  for (const book of order) {
    if (rows.length >= n) break;
    const pages = await db.collection('pages').find({ book_id: book.id }, { projection: { _id: 0, id: 1, page_number: 1, page_type: 1, 'ocr.data': 1, 'ocr.unreadable': 1, 'translation.data': 1 } }).sort({ page_number: 1 }).toArray();
    const byN = new Map(pages.map(p => [p.page_number, p]));
    const starts = pages.map(p => p.page_number).filter(s0 => byN.get(s0 - 1)?.translation?.data && byN.get(s0 - 1)?.ocr?.data && Array.from({ length: RUN_LEN }, (_, k) => byN.get(s0 + k)).every(prose));
    if (!starts.length) continue;
    const s0 = starts[Math.floor(rand() * starts.length)];
    const nums = Array.from({ length: RUN_LEN }, (_, k) => s0 + k);
    rows.push({ book, nums, pageIds: nums.map(x => byN.get(x).id), ocr: Object.fromEntries(nums.map(x => [x, byN.get(x).ocr.data])), stored: Object.fromEntries(nums.map(x => [x, byN.get(x).translation?.data || null])) });
  }
  await c.close();
  fs.writeFileSync(path.join(out, 'runs.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  console.log(`${rows.length} runs of ${RUN_LEN} pages; languages ${JSON.stringify(rows.reduce((a, r) => { a[r.book.language] = (a[r.book.language] || 0) + 1; return a; }, {}))}`);
}
const runsDir = (out, arm) => path.join(out, 'runs-reads', arm);
function runread(out, arm, root) { readIds(runsDir(out, arm), readJsonl(path.join(out, 'runs.jsonl')).flatMap(r => r.pageIds), arm, root, `seam-pass-8399-runs-${arm}`); }
export const TERM_ARMS = ['A', 'A2', 'A0'];
function runTexts(out, arm, r) {
  return Object.fromEntries(r.pageIds.map((id, k) => { try { const m = JSON.parse(fs.readFileSync(path.join(runsDir(out, arm), `${id}.meta.json`), 'utf8')); const t = fs.readFileSync(path.join(runsDir(out, arm), `${id}.txt`), 'utf8').trim(); return [r.nums[k], m.exit === 0 && t.length > 5 ? { text: t, call: m.call_id } : null]; } catch { return [r.nums[k], null]; } }));
}
const foldW = (w) => w.normalize('NFD').replace(/\p{M}/gu, '').replace(/ſ/g, 's').toLowerCase().replace(/v/g, 'u').replace(/j/g, 'i');
/**
 * The mechanical count. A source TERM is a capitalised source word of 5+ letters, by its first 5 folded letters, on 3+
 * pages of the run. Its English RENDERINGS are the words capitalised mid-sentence (after a lower-case word) on those
 * pages whose first 4 folded letters match it, possessive dropped. A term counts when some arm renders it; per arm:
 * distinct renderings per term, and the share of terms with more than one. Names, mostly: a translated common noun
 * (lapis → stone) has no matching English form and drops out.
 */
export function termCounts(r, texts) {
  const stems = new Map();
  for (const n of r.nums) for (const w of sourceProse(r.ocr[n]).match(/\p{Lu}[\p{L}ſ]{4,}/gu) || []) { const st = foldW(w).slice(0, 5); (stems.get(st) || stems.set(st, new Set()).get(st)).add(n); }
  const terms = {};
  for (const [st, pages] of stems) {
    if (pages.size < 3) continue;
    const per = {};
    for (const [arm, tx] of Object.entries(texts)) {
      const forms = new Map();
      for (const n of pages) {
        const en = tx[n]?.text; if (!en) continue;
        for (const m of translationProse(en).matchAll(/(?<=[a-z,;:] )\p{Lu}[\p{L}'’]+/gu)) { const f = foldW(m[0].replace(/['’]s?$/u, '')); if (f.slice(0, 4) === st.slice(0, 4)) forms.set(f, (forms.get(f) || 0) + 1); }
      }
      per[arm] = Object.fromEntries(forms);
    }
    if (Object.values(per).some(f => Object.keys(f).length)) terms[st] = { pages: [...pages].sort((a, b) => a - b), per };
  }
  return terms;
}
function terms(out) {
  const rs = readJsonl(path.join(out, 'runs.jsonl'));
  const perRun = [], agg = Object.fromEntries(TERM_ARMS.map(a => [a, { terms: 0, renderings: 0, inconsistent: 0 }]));
  const pair = { A0vsA: { better: 0, worse: 0 }, A0vsA2: { better: 0, worse: 0 }, A2vsA: { better: 0, worse: 0 } };
  for (const r of rs) {
    const texts = Object.fromEntries(TERM_ARMS.map(a => [a, runTexts(out, a, r)]));
    if (!TERM_ARMS.every(a => r.nums.every(n => texts[a][n]))) { perRun.push({ book: r.book.id, incomplete: true }); continue; }
    const t = termCounts(r, texts);
    const row = { book: r.book.id, language: r.book.language, terms: Object.keys(t).length, byArm: {} };
    for (const a of TERM_ARMS) {
      const ks = Object.values(t).map(x => Object.keys(x.per[a]).length).filter(k => k > 0);
      row.byArm[a] = { terms: ks.length, renderings: ks.reduce((s, k) => s + k, 0), inconsistent: ks.filter(k => k > 1).length };
      agg[a].terms += ks.length; agg[a].renderings += row.byArm[a].renderings; agg[a].inconsistent += row.byArm[a].inconsistent;
    }
    for (const x of Object.values(t)) {
      const k = (a) => Object.keys(x.per[a]).length;
      for (const [name, [p, q]] of Object.entries({ A0vsA: ['A0', 'A'], A0vsA2: ['A0', 'A2'], A2vsA: ['A2', 'A'] })) { if (!k(p) || !k(q)) continue; if (k(p) < k(q)) pair[name].better++; else if (k(p) > k(q)) pair[name].worse++; }
    }
    row.detail = t;
    perRun.push(row);
  }
  for (const a of TERM_ARMS) { agg[a].perTerm = agg[a].terms ? +(agg[a].renderings / agg[a].terms).toFixed(3) : null; agg[a].inconsistentPct = agg[a].terms ? +(100 * agg[a].inconsistent / agg[a].terms).toFixed(1) : null; }
  const rep = { runs: rs.length, complete: perRun.filter(x => !x.incomplete).length, agg, paired: pair, perRun };
  fs.writeFileSync(path.join(out, 'terms.json'), JSON.stringify(rep, null, 1));
  console.log(JSON.stringify({ runs: rep.runs, complete: rep.complete, agg, paired: pair }, null, 1));
}

export const TERM_PROMPT = `You are checking the consistency of names and terms in an English translation of 12 consecutive pages of a historical book. Below are the SOURCE pages (OCR) and the ENGLISH translation of each page.

List every proper name (person, place, work, deity) and every technical term that occurs in the SOURCE on at least 3 of the 12 pages. For each, give every distinct English rendering the translation uses for it, with the page numbers. Inflection (Paracelsi, Paracelso) is one source term; English grammar (a plural, a possessive) is one rendering. A term is INCONSISTENT when the translation renders the same thing in two or more different ways a reader would notice (Mercurius on one page and Mercury on another; "the Stone" and "the lapis"), not when the source itself changes the word.

Reply with ONE JSON object and nothing else:
{"terms":[{"source":"...","renderings":[{"english":"...","pages":[N,...]}],"inconsistent":true|false,"note":"<= 20 words"}]}`;
async function termjudge(out, n) {
  const { claudeCall, extractJson, pool } = await import('../seams-6742/lib.mjs');
  const rs = shuffle(readJsonl(path.join(out, 'runs.jsonl')), makeRng(84004)).slice(0, n);
  const file = path.join(out, 'termjudge.jsonl');
  const done = new Set(readJsonl(file).filter(x => x.parsed).map(x => `${x.book}:${x.arm}`));
  const todo = rs.flatMap(r => TERM_ARMS.map(arm => ({ r, arm }))).filter(x => !done.has(`${x.r.book.id}:${x.arm}`));
  console.log(`${todo.length} term-check calls`);
  const res = await pool(todo, 3, async ({ r, arm }) => {
    const tx = runTexts(out, arm, r);
    if (!r.nums.every(k => tx[k])) return { ok: false };
    const text = `${TERM_PROMPT}\n\n${r.nums.map(k => `=== PAGE ${k} SOURCE ===\n${sourceProse(r.ocr[k])}\n=== PAGE ${k} ENGLISH ===\n${translationProse(tx[k].text)}`).join('\n\n')}\n`;
    const c = await claudeCall(text, 'opus');
    if (c.cls === 'usage_limit') return { cls: c.cls };
    const j = c.cls ? null : extractJson(c.text);
    const parsed = !!(j && Array.isArray(j.terms));
    fs.appendFileSync(file, JSON.stringify({ book: r.book.id, arm, parsed, terms: parsed ? j.terms : null, raw: parsed ? undefined : String(c.text).slice(0, 1000), usage: c.usage, at: new Date().toISOString() }) + '\n');
    return { ok: parsed };
  });
  console.log(JSON.stringify(res));
}

// ── per-page packet: A0 (and its passed versions) on #8407's pages, for route-judge-6740/judge.mjs ───────────────
async function packet(out) {
  const crypto = await import('crypto');
  const ctx = readJsonl(path.join(out, 'ctx.jsonl'));
  const v = armTexts(out, ctx);
  const oldKey = JSON.parse(fs.readFileSync(path.join(out, 'pages', 'key.json'), 'utf8'));
  const oldItems = new Map(JSON.parse(fs.readFileSync(path.join(out, 'pages', 'packet.json'), 'utf8')).items.map(x => [x.id, x]));
  const dir = path.join(out, 'pages2'); fs.mkdirSync(dir, { recursive: true });
  const id = (x) => crypto.createHash('sha1').update(`8399b:${x}`).digest('hex').slice(0, 12);
  const items = [], key = [];
  const picks = oldKey.filter(k => k.kind === 'item' && k.route === 'A');
  const rowOf = (pid) => ctx.find(r => r.pageIds[r.seamPos] === pid);
  const add = (k, arm, kind, text, shown = k, n = 0) => {
    const base = oldItems.get(shown.id);
    const iid = id(`${k.page_id}:${arm}:${kind}:${n}`);
    items.push({ id: iid, task: 'translation', lang: base.lang, image_url: base.image_url, text, source: base.source });
    key.push({ id: iid, judged_as: iid, cell: k.cell, route: arm, kind, page_id: k.page_id, book_id: k.book_id, shown_page_id: shown.page_id, old_a_id: k.id });
  };
  for (const k of picks) {
    const r = rowOf(k.page_id); if (!r) continue;
    const n = r.block[r.seamPos], a0 = v[r.id].A0?.[n]?.text; if (!a0) continue;
    add(k, 'A0', 'item', a0);
    for (const [name, [base, locked]] of Object.entries(STAGED)) { const t = stagedText(out, r, base, n, v, { locked }); if (t && t !== v[r.id][base]?.[n]?.text) add(k, name, 'item', t); }
  }
  // controls: A0's text under another book's leaf (3 Latin, 2 German); six of A's texts judged again (the bridge to #8407's session)
  for (const cell of ['latin-cli-agy4', 'german-cli-agy4']) { const ps = picks.filter(k => k.cell === cell); for (let q = 0; q < Math.min(ps.length, cell === 'latin-cli-agy4' ? 3 : 2); q++) { const k = ps[(q * 7 + 2) % ps.length], o = picks[(picks.indexOf(k) + 1) % picks.length]; const r = rowOf(k.page_id); const t = r && v[r.id].A0?.[r.block[r.seamPos]]?.text; if (t) add(k, 'A0', 'wrong_page', t, o, q); } }
  for (let q = 0; q < 6; q++) { const k = picks[(q * 5) % picks.length]; add(k, 'A', 'repeat', oldItems.get(k.id).text, k, q); }
  const order = shuffle(items.map((_, i) => i), makeRng(84005));
  fs.writeFileSync(path.join(dir, 'packet.json'), JSON.stringify({ items: order.map(i => items[i]) }, null, 1));
  fs.writeFileSync(path.join(dir, 'key.json'), JSON.stringify(key, null, 1));
  console.log(`${items.length} items: ${JSON.stringify(key.reduce((a, k) => { a[`${k.route}:${k.kind}`] = (a[`${k.route}:${k.kind}`] || 0) + 1; return a; }, {}))}`);
}

// ── score ────────────────────────────────────────────────────────────────────
export const SCORED = ['A', 'A2', 'A0', 'Bb', 'C', 'A0S', 'A0L', 'BbS'];
const pct = (a, b) => (b ? +(100 * a / b).toFixed(1) : null);
function wilson(k, n, z = 1.96) { if (!n) return [null, null]; const p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return [+(100 * (c - h) / d).toFixed(1), +(100 * (c + h) / d).toFixed(1)]; }
async function score(out) {
  const { signP } = await import('./ab.mjs');
  const { sentences } = await import('../seams-6742/lib.mjs');
  const ctx = readJsonl(path.join(out, 'ctx.jsonl'));
  const J = joinVersions2(out, ctx, sentences);
  const jj = readJsonl(path.join(out, 'judge2.jsonl')).filter(j => j.parsed);
  const byId = {}; for (const j of jj) (byId[j.id] ||= {})[j.order] = j;
  const res = {};
  for (const [jid, x] of Object.entries(J)) {
    const o = byId[jid]; if (x.incomplete || !o?.[1] || !o?.[2]) continue;
    const r = {};
    for (const a of [...SCORED, 'Acopy', 'P']) {
      const src = x.versions[a] ? a : BASE_OF[a];
      const p = o[1].verdicts[src], q = o[2].verdicts[src];
      if (!p || !q) { r[a] = null; continue; }
      const def = p.label !== 'ok' && q.label !== 'ok';
      r[a] = { def, major: def && p.severity === 'major' && q.severity === 'major', labels: def ? p.labels.filter(l => q.labels.includes(l) && l !== 'ok') : [], own: !!x.versions[a] };
    }
    ((res[x.r.id] ||= {})[x.j.join] = r);
  }
  const rows = ctx.filter(r => res[r.id]?.T && res[r.id]?.S && SCORED.every(a => res[r.id].T[a] && res[r.id].S[a]));
  const rep = { n: { rows: rows.length, judgeCallsParsed: jj.length }, model: MODEL };
  const tab = (join, set = rows) => Object.fromEntries(SCORED.map(a => { const k = set.filter(r => res[r.id][join][a].def).length; return [a, { def100: pct(k, set.length), ci: wilson(k, set.length), defects: k, majors: set.filter(r => res[r.id][join][a].major).length, ownVersion: set.filter(r => res[r.id][join][a].own).length }]; }));
  rep.T = tab('T'); rep.S = tab('S');
  const lane = (a, set) => (set.length ? 100 * (LANE_W.T * set.filter(r => res[r.id].T[a].def).length + LANE_W.S * set.filter(r => res[r.id].S[a].def).length) / set.length : null);
  const Sr = (a, set) => (set.length ? 100 * set.filter(r => res[r.id].S[a].def).length / set.length : null);
  const Aavg = (set, f = lane) => (f('A', set) + f('A2', set)) / 2;
  const rand = makeRng(84006), B = 2000, boot = Object.fromEntries([...SCORED, 'Aavg'].map(a => [a, []])), diff = Object.fromEntries(SCORED.map(a => [a, []])), diffS = Object.fromEntries(SCORED.map(a => [a, []]));
  for (let b = 0; b < B; b++) {
    const s0 = rows.map(() => rows[Math.floor(rand() * rows.length)]);
    for (const a of SCORED) { boot[a].push(lane(a, s0)); diff[a].push(lane(a, s0) - Aavg(s0)); diffS[a].push(Sr(a, s0) - Aavg(s0, Sr)); }
    boot.Aavg.push(Aavg(s0));
  }
  const q = (xs, p0) => { const t = [...xs].sort((x, y) => x - y); return +t[Math.floor(p0 * (t.length - 1))].toFixed(1); };
  rep.lane = Object.fromEntries([...SCORED, 'Aavg'].map(a => [a, { def100: +(a === 'Aavg' ? Aavg(rows) : lane(a, rows)).toFixed(1), ci: [q(boot[a], 0.025), q(boot[a], 0.975)] }]));
  rep.laneDiffVsAavg = Object.fromEntries(SCORED.map(a => [a, { delta100: +(lane(a, rows) - Aavg(rows)).toFixed(1), ci: [q(diff[a], 0.025), q(diff[a], 0.975)] }]));
  rep.SDiffVsAavg = Object.fromEntries(SCORED.map(a => [a, { delta100: +(Sr(a, rows) - Aavg(rows, Sr)).toFixed(1), ci: [q(diffS[a], 0.025), q(diffS[a], 0.975)] }]));
  rep.swing = { T: +Math.abs(rep.T.A.def100 - rep.T.A2.def100).toFixed(1), S: +Math.abs(rep.S.A.def100 - rep.S.A2.def100).toFixed(1), lane: +Math.abs(rep.lane.A.def100 - rep.lane.A2.def100).toFixed(1) };
  const pair = (x, y, join) => { const better = rows.filter(r => res[r.id][join][y].def && !res[r.id][join][x].def).length, worse = rows.filter(r => res[r.id][join][x].def && !res[r.id][join][y].def).length; return { better, worse, p: signP(better, worse) }; };
  rep.paired = Object.fromEntries(['T', 'S'].map(j => [j, { A0vsA: pair('A0', 'A', j), A0vsA2: pair('A0', 'A2', j), A0SvsA0: pair('A0S', 'A0', j), A0LvsA0: pair('A0L', 'A0', j), BbSvsBb: pair('BbS', 'Bb', j), BbSvsC: pair('BbS', 'C', j), A0SvsA: pair('A0S', 'A', j) }]));
  rep.strata = Object.fromEntries(['dense', 'ordinary'].map(st => { const set = rows.filter(r => r.stratum === st); return [st, { n: set.length, lane: Object.fromEntries(SCORED.map(a => [a, set.length ? +lane(a, set).toFixed(1) : null])), S: Object.fromEntries(SCORED.map(a => [a, set.length ? +Sr(a, set).toFixed(1) : null])) }]; }));
  const allJ = rows.flatMap(r => ['T', 'S'].map(j => res[r.id][j]));
  rep.judgeFloor = { agree: allJ.filter(x => x.Acopy && x.Acopy.def === x.A.def).length, n: allJ.filter(x => x.Acopy).length };
  rep.plants = { caught: allJ.filter(x => x.P?.def).length, n: allJ.filter(x => x.P).length };
  // the stage's own tally, from the seam-pass rows of each base's reads
  rep.stage = {};
  for (const base of ['A0', 'Bb']) {
    const sp = storedWaves(ctx).flatMap((w, k) => readJsonl(path.join(readsDir(out, base, k), 'seam-pass.jsonl'))).filter(x => !x.run_done);
    const count = (f) => sp.reduce((a, x) => { const k0 = f(x); a[k0] = (a[k0] || 0) + 1; return a; }, {});
    rep.stage[base] = { turns: sp.length, calls: sp.length, labels: count(x => x.label || `unparsed:${x.cls}`), changed: sp.filter(x => x.changed).length, beforePageEdited: sp.filter(x => x.changed && x.left_in_run === false && x.left_changed).length,
      refused: count(x => x.refused || 'none'), lockedChanged: sp.filter(x => x.locked?.changed).length };
  }
  rep.leaks = leaks2(out, ctx).rep;
  // usable pages: A, A2 from #8407's verdicts; A0 and its passed versions from pages2/
  const verd = (dir) => new Map(readJsonl(path.join(out, dir, 'verdicts-opus.jsonl')).filter(x => x.verdict).map(x => [x.id, x.verdict]));
  const V1 = verd('pages'), K1 = JSON.parse(fs.readFileSync(path.join(out, 'pages', 'key.json'), 'utf8'));
  const accepted = {};
  for (const a of ['A', 'A2', 'Bb']) { const ks = K1.filter(k => k.kind === 'item' && k.route === a && V1.has(k.id)); const k0 = ks.filter(k => V1.get(k.id).accept).length; accepted[a] = { accept: k0, n: ks.length, rate: pct(k0, ks.length), ci: wilson(k0, ks.length) }; }
  if (fs.existsSync(path.join(out, 'pages2', 'key.json'))) {
    const V2 = verd('pages2'), K2 = JSON.parse(fs.readFileSync(path.join(out, 'pages2', 'key.json'), 'utf8'));
    const a0 = K2.filter(k => k.kind === 'item' && k.route === 'A0' && V2.has(k.id));
    const acc0 = (pid) => { const k = a0.find(x => x.page_id === pid); return k ? V2.get(k.id).accept : null; };
    for (const a of ['A0', 'A0S', 'A0L', 'BbS']) {
      // a passed arm's page: its own verdict where the pass changed the page, else its base's
      const pages = a0.map(k => k.page_id);
      let k0 = 0, n0 = 0, own = 0;
      for (const pid of pages) {
        const kk = K2.find(x => x.kind === 'item' && x.route === a && x.page_id === pid && V2.has(x.id));
        let acc;
        if (kk) { acc = V2.get(kk.id).accept; own++; }
        else if (a === 'BbS') { const kb = K1.find(x => x.kind === 'item' && x.route === 'Bb' && x.page_id === pid && V1.has(x.id)); acc = kb ? V1.get(kb.id).accept : null; }
        else acc = acc0(pid);
        if (acc == null) continue; n0++; if (acc) k0++;
      }
      accepted[a] = { accept: k0, n: n0, rate: pct(k0, n0), ci: wilson(k0, n0), ownVerdicts: own };
    }
    const rpt = K2.filter(k => k.kind === 'repeat' && V2.has(k.id));
    const wp = K2.filter(k => k.kind === 'wrong_page' && V2.has(k.id));
    rep.pageControls = { wrongPageAccepted: wp.filter(k => V2.get(k.id).accept).length, wrongPageN: wp.length,
      bridgeFlips: rpt.filter(k => V1.has(k.old_a_id) && V1.get(k.old_a_id).accept !== V2.get(k.id).accept).length, bridgeN: rpt.length };
  }
  rep.accept = accepted;
  // failing pages: what A, A2 and A0 fail on (the judge's defect classes: O* = OCR/transcription, T* = translation)
  rep.failing = {};
  const classOf = (c) => (/^O/i.test(String(c)) ? 'ocr' : /^T/i.test(String(c)) ? 'translation' : /^E/i.test(String(c)) ? 'editorial' : 'other');
  const failRows = [...K1.filter(k => k.kind === 'item' && ['A', 'A2'].includes(k.route)).map(k => [k, V1.get(k.id)]), ...(fs.existsSync(path.join(out, 'pages2', 'key.json')) ? JSON.parse(fs.readFileSync(path.join(out, 'pages2', 'key.json'), 'utf8')).filter(k => k.kind === 'item' && k.route === 'A0').map(k => [k, verd('pages2').get(k.id)]) : [])];
  for (const [k, vv] of failRows) {
    if (!vv || vv.accept) continue;
    const f = (rep.failing[k.route] ||= { pages: 0, byMain: {}, byClass: {} });
    f.pages++;
    const ds = (vv.defects || []).filter(d => d.severity !== 'cosmetic');
    const main = ds.find(d => d.severity === 'major') || ds[0];
    const mk = main ? classOf(main.class) : 'none-listed';
    f.byMain[mk] = (f.byMain[mk] || 0) + 1;
    for (const d of ds) f.byClass[d.class] = (f.byClass[d.class] || 0) + 1;
  }
  // term consistency
  if (fs.existsSync(path.join(out, 'terms.json'))) { const t = JSON.parse(fs.readFileSync(path.join(out, 'terms.json'), 'utf8')); rep.terms = { runs: t.runs, complete: t.complete, agg: t.agg, paired: t.paired }; }
  const tj = readJsonl(path.join(out, 'termjudge.jsonl')).filter(x => x.parsed);
  if (tj.length) {
    rep.termJudge = Object.fromEntries(TERM_ARMS.map(a => { const xs = tj.filter(x => x.arm === a); return [a, { runs: xs.length, terms: xs.reduce((s0, x) => s0 + x.terms.length, 0), inconsistent: xs.reduce((s0, x) => s0 + x.terms.filter(t => t.inconsistent === true).length, 0) }]; }));
    for (const a of TERM_ARMS) rep.termJudge[a].inconsistentPct = pct(rep.termJudge[a].inconsistent, rep.termJudge[a].terms);
  }
  // part 1: A0 decides #8410 (brief, Derek 2026-11-08)
  const sWorse = Sr('A0', rows) - Aavg(rows, Sr);
  const tA = rep.terms?.agg, tJ = rep.termJudge;
  const termsNotWorse = tA ? tA.A0.perTerm <= Math.max(tA.A.perTerm, tA.A2.perTerm) : null;
  const termsJudgeNotWorse = tJ ? tJ.A0.inconsistentPct <= Math.max(tJ.A.inconsistentPct, tJ.A2.inconsistentPct) : null;
  rep.rule1 = { A0_S: +Sr('A0', rows).toFixed(1), AavgS: +Aavg(rows, Sr).toFixed(1), sWorse: +sWorse.toFixed(1), swingS: rep.swing.S, sOk: sWorse <= rep.swing.S, termsNotWorse, termsJudgeNotWorse,
    passes: sWorse <= rep.swing.S && termsNotWorse !== false && termsJudgeNotWorse !== false };
  // A0 + the stage as built, if A0 alone fails
  const s2 = Sr('A0S', rows) - Aavg(rows, Sr), s2l = Sr('A0L', rows) - Aavg(rows, Sr);
  rep.rule1Staged = { A0S_S: +Sr('A0S', rows).toFixed(1), sWorse: +s2.toFixed(1), A0L_S: +Sr('A0L', rows).toFixed(1), sWorseLocked: +s2l.toFixed(1), sOk: s2 <= rep.swing.S, sOkLocked: s2l <= rep.swing.S };
  // part 2: does the stage as built score like C? (BbS vs C on the same reads, within this round's lane swing; and under A)
  rep.rule2 = { BbS: rep.lane.BbS.def100, C: rep.lane.C.def100, Aavg: rep.lane.Aavg.def100, swingLane: rep.swing.lane, likeC: Math.abs(rep.lane.BbS.def100 - rep.lane.C.def100) <= Math.max(rep.swing.lane, 2), underA: rep.lane.BbS.def100 < rep.lane.Aavg.def100,
    A0S: rep.lane.A0S.def100, A0SunderA: rep.lane.A0S.def100 < rep.lane.Aavg.def100, A0L: rep.lane.A0L.def100 };
  rep.claudeListUsd = +jj.reduce((s0, j) => s0 + (j.usage?.list_cost_usd || 0), 0).toFixed(2);
  rep.perRow = Object.fromEntries(rows.map(r => [r.id, Object.fromEntries(['T', 'S'].map(j => [j, Object.fromEntries([...SCORED, 'P'].map(a => [a, res[r.id][j][a] ? (res[r.id][j][a].def ? (res[r.id][j][a].major ? 'MAJOR' : 'minor') + ':' + res[r.id][j][a].labels.join('+') : 'ok') : '-']))]))]));
  fs.writeFileSync(path.join(out, 'report2.json'), JSON.stringify(rep, null, 1) + '\n');
  const { perRow, ...brief } = rep;
  console.log(JSON.stringify(brief, null, 1));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cmd = process.argv[2], out = arg('out');
  const go = { translate: async () => translate(out, arg('arm'), path.resolve(arg('reader-root', ROOT))), judge: () => judge(out, Number(arg('conc', 3))),
    leaks: async () => { const x = leaks2(out, readJsonl(path.join(out, 'ctx.jsonl'))); fs.writeFileSync(path.join(out, 'leaks2.json'), JSON.stringify(x, null, 1)); console.log(JSON.stringify(x.rep)); },
    runs: () => runs(out, Number(arg('n', 16))), runread: async () => runread(out, arg('arm'), path.resolve(arg('reader-root', ROOT))),
    terms: async () => terms(out), termjudge: () => termjudge(out, Number(arg('n', 8))), packet: () => packet(out), score: async () => score(out) }[cmd];
  if (!go || !out) { console.error('usage: see the header'); process.exit(2); }
  go().catch(e => { console.error(e); process.exit(1); });
}
