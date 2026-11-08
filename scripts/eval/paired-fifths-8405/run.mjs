#!/usr/bin/env node
// PRIOR ART: scripts/eval/confidence-7866/{frame,judge,analyze}.mjs — the 5-page study whose anchors this reuses: its
// page judge (route-judge-6740 judgePrompt via correction-pass-7818 judgeAbsolute, imported unchanged), its page rule
// (eligiblePage, imported), its bad-page / bad-book rule (restated: analyze.mjs runs its CLI on import) and its image
// resize rule (restated from judge.mjs for the same reason). The anchor verdicts come from book_checks (method
// judged-pages, run confidence-validation-7866), written by #7896. No join judge existed: per-page judges cannot see a
// page break (lesson in auto-memory, #8399). The break census is scripts/lib/neighbour-guard.mjs openingEcho (#8409).
/**
 * #8405: is a paired-fifths check (10 pages, two adjacent from each fifth) worth twice the reading of the 5-page
 * check for the standing Opus QA? Preregistration: scripts/eval/experiments/2026-11-08-paired-fifths-prereg-8405.md.
 * Nothing here writes to Mongo.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/paired-fifths-8405/run.mjs frame
 *        the #7866 books, each anchor paired by the shared rule (scripts/lib/paired-fifths.mjs pairsFromAnchors),
 *        texts at frame time, break kind from translation.engine.run.read_call, the census stratum (needs #8409)
 *   ... run.mjs judge [--max-calls=N] [--concurrency=3]
 *        partner pages (the frozen #7866 judge), anchors whose text changed since 2026-10-31 (the same judge), every
 *        join (the join judge below), and the join controls; books in a seeded order, so a partial run is whole books
 *   ... run.mjs analyze   → results/score.json
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withMongo } from '../../lib/mongo.mjs';
import { contentHash } from '../../lib/write-provenance.mjs';
import { pairsFromAnchors, PAIRED_FIFTHS_VERSION } from '../../lib/paired-fifths.mjs';
import { eligiblePage, imageUrl, makeRng, shuffle, sha, jsonl, paceCheck, judgeAbsolute } from '../confidence-7866/lib.mjs';
import { opusCall } from '../route-judge-6740/judge.mjs';
import { stripEditorialWrappers } from '../../lib/strip-editorial-wrappers.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RESULTS = path.join(HERE, 'results');
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const OUT = path.resolve(arg('out') || path.join(process.env.JOB_SCRATCH || os.tmpdir(), 'paired-fifths-8405'));
const J = (f) => JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'));
const W = (f, x) => { const p = path.join(OUT, f); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(x, null, 1)); };
const VERDICTS = path.join(OUT, 'verdicts.jsonl');
export const SEED = Object.freeze({ books: 84051, controls: 84052, census: 84053 });
export const CALL_BUDGET = 1800;
const CONTROLS_PER_KIND = 10, CENSUS_CAP = 40;
const ANCHOR_RUN = 'confidence-validation-7866';

// ── the rules (preregistered) ──
const wrongText = (v) => (v?.defects || []).some((d) => d.severity === 'wrong_text');
/** #7866: a page is bad when the judge did not accept it or it carries a wrong_text defect. */
export const badPage = (v) => !v.accept || wrongText(v);
/** #7866: a book is bad on its anchors when >= 2 of >= 4 judged pages are bad. Paired: >= 4 of >= 8, the same share. */
export const anchorBad = (vs) => (vs.length >= 4 ? vs.filter(badPage).length >= 2 : null);
export const pairedPagesBad = (vs) => (vs.length >= 8 ? vs.filter(badPage).length >= 4 : null);
const JOIN_KINDS = ['carry_over', 'duplicated', 'dropped', 'wrong_leaf', 'other'];
/** A join fails when the judge names a material defect of a kind that puts text on the wrong side of the break. */
export const joinFails = (j) => (j?.defects || []).some((d) => d.material === true && ['carry_over', 'duplicated', 'dropped', 'wrong_leaf'].includes(d.kind));

// ── the join judge ──
const clean = (s) => (typeof s === 'string' ? stripEditorialWrappers(s).trim() : '');
export function joinPrompt(lang, a, b) {
  return `You are checking the break between two consecutive pages of a historical ${lang} book, for a library that publishes each page's transcription and English translation beside its scan. The scans are the only authority.

Open both images with Read before you answer: ./a.jpg is page A, ./b.jpg is page B, the page that follows it.

Judge the BREAK, not each page's general quality. Look for:
- carry_over: text that belongs to one page appears on the other (for example B's English opens with a sentence that renders the last printed line of A, already rendered on A; or A's English runs on into words printed only on B);
- duplicated: the same passage is transcribed or translated on both pages;
- dropped: words printed at the end of A or the start of B are missing from both pages' transcriptions, or from both English texts;
- wrong_leaf: a page's text does not belong to its scan at all;
- other: anything else wrong at the break.
A catchword at the foot of A that repeats the first word of B is printed furniture, not a defect. Running heads, page numbers and signatures are not defects. Normalised spelling is not a defect.

For each defect: kind, layer (transcription | english), page (A | B: the page that holds the misplaced or duplicated text, or that lacks the dropped text), quote (the words at issue, exactly as in the text given), and material (true when a reader would be misled about what the page says).

PAGE A transcription:
<<<
${a.ocr}
>>>
PAGE A English:
<<<
${a.tr || '(none)'}
>>>
PAGE B transcription:
<<<
${b.ocr}
>>>
PAGE B English:
<<<
${b.tr || '(none)'}
>>>

Answer with one JSON object only:
{"opened": ["a.jpg", "b.jpg"], "join": "clean|defect", "defects": [{"kind": "carry_over", "layer": "english", "page": "B", "quote": "...", "material": true}], "note": "<one line>"}`;
}
export const parseJoin = (t) => {
  const m = String(t || '').match(/\{[\s\S]*\}/);
  try {
    const v = JSON.parse(m[0]);
    if (!['clean', 'defect'].includes(v.join) || !Array.isArray(v.defects ?? [])) return null;
    v.defects = (v.defects ?? []).filter((d) => JOIN_KINDS.includes(d.kind));
    return v;
  } catch { return null; }
};

// ── images: fetched once, resized as #7866 did (over 4 MB → long edge 3000 px, JPEG q90) ──
async function imageFor(pageId, url) {
  const f = path.join(OUT, 'img', `${pageId}.jpg`);
  if (fs.existsSync(f)) return fs.readFileSync(f);
  const r = await fetch(url, { headers: { 'User-Agent': 'SourceLibrary-eval/8405 (https://sourcelibrary.org)' }, signal: AbortSignal.timeout(60e3) });
  if (!r.ok) throw new Error(`image HTTP ${r.status} ${url.slice(0, 100)}`);
  let buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > 4e6) {
    const { default: sharp } = await import('sharp');
    buf = await sharp(buf).resize(3000, 3000, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
  }
  fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, buf);
  return buf;
}

// ── frame ──
const PAGE_PROJECTION = { _id: 0, id: 1, page_number: 1, page_type: 1, 'ocr.data': 1, 'ocr.updated_at': 1,'translation.data': 1, 'translation.engine.run.read_call': 1,
  script_type: 1, archived_photo: 1, display_photo: 1, photo: 1, photo_original: 1, cropped_photo: 1, enhanced_photo: 1, split_from_spread: 1, hidden: 1, split_into: 1 };
const breakKind = (a, b) => {
  const x = a.translation?.engine?.run?.read_call, y = b.translation?.engine?.run?.read_call;
  return !x || !y ? 'unknown' : x === y ? 'in_call' : 'call_boundary';
};
const pageRec = (p) => ({ page_id: p.id, page_number: p.page_number, image: imageUrl(p), ocr_hash: contentHash(p.ocr?.data ?? ''), has_tr: Boolean(clean(p.translation?.data)) });
function saveText(p) {
  const f = path.join(OUT, 'texts', `${p.id}.json`); fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify({ ocr: p.ocr?.data ?? '', tr: p.translation?.data ?? '' }));
}
const text = (pageId) => JSON.parse(fs.readFileSync(path.join(OUT, 'texts', `${pageId}.json`), 'utf8'));

async function frame() {
  let openingEcho = null;
  try { ({ openingEcho } = await import('../../lib/neighbour-guard.mjs')); } catch { /* absent */ }
  if (typeof openingEcho !== 'function') console.log('census: openingEcho not on this checkout (#8409); census stratum skipped');
  const books = [], census = [];
  await withMongo(async (db) => {
    // --books=N: the first N books only (a smoke run; the study frames all of them).
    const rows = await db.collection('book_checks').find({ method_id: 'judged-pages', run_id: ANCHOR_RUN }).sort({ book_id: 1 }).limit(Number(arg('books') || 0)).toArray();
    for (const r of rows) {
      const meta = await db.collection('books').findOne({ $or: [{ id: r.book_id }, { _id: r.book_id }] }, { projection: { id: 1, language: 1, title: 1 } });
      const all = await db.collection('pages').find({ book_id: r.book_id }, { projection: PAGE_PROJECTION }).sort({ page_number: 1 }).toArray();
      const byNum = new Map(all.map((p) => [p.page_number, p]));
      const draw = all.map((p) => ({ page_number: p.page_number, eligible: eligiblePage(p) }));
      const anchors = [...r.pages_read].sort((x, y) => x - y);
      // An anchor no longer eligible (hidden, re-typed) still pairs: its verdict exists. Mark it eligible for the rule.
      for (const a of anchors) { const d = draw.find((x) => x.page_number === a); if (d) d.eligible = true; }
      const pairs = pairsFromAnchors(draw, anchors).map((pr) => {
        const anchor = byNum.get(pr.anchor), partner = pr.partner == null ? null : byNum.get(pr.partner);
        const prov = (r.text_provenance || []).find((t) => t.page_number === pr.anchor);
        const note = (r.page_notes || []).find((n) => n.page_number === pr.anchor);
        // The #7866 rows record the OCR's updated_at at check time, not a hash: the anchor's text is the judged text
        // when its updated_at is unchanged and not after the check (judgedProvenance's stamp rule).
        const liveAt = anchor?.ocr?.updated_at ? new Date(anchor.ocr.updated_at).getTime() : null;
        const stale = !anchor || !note || liveAt == null || liveAt > new Date(r.checked_at).getTime()
          || (prov?.ocr_updated_at != null && new Date(prov.ocr_updated_at).getTime() !== liveAt);
        if (anchor) saveText(anchor);
        if (partner) saveText(partner);
        const a = pr.second == null ? null : byNum.get(pr.first), b = pr.second == null ? null : byNum.get(pr.second);
        return { ...pr, anchor_page: anchor ? pageRec(anchor) : null, partner_page: partner ? pageRec(partner) : null,
          anchor_verdict: note && !stale ? { accept: note.accepted, fidelity: note.fidelity, defects: note.defects ?? [] } : null, anchor_stale: stale,
          break_kind: a && b ? breakKind(a, b) : null };
      });
      books.push({ id: r.book_id, title: meta?.title ?? null, lang: meta?.language ?? 'unknown', stratum: r.frame?.strata?.[0] ?? null, pairs });
      if (typeof openingEcho === 'function') {
        const inPairs = new Set(pairs.flatMap((p) => [p.first, p.second]));
        for (let i = 1; i < all.length; i++) {
          const prev = all[i - 1], cur = all[i];
          if (cur.page_number !== prev.page_number + 1 || inPairs.has(cur.page_number) || inPairs.has(prev.page_number)) continue;
          if (!clean(cur.translation?.data) || !clean(prev.translation?.data) || !eligiblePage(cur) || !eligiblePage(prev)) continue;
          const e = openingEcho({ tr: cur.translation.data, prevTr: prev.translation.data, ocr: cur.ocr?.data, prevOcr: prev.ocr?.data });
          if (e?.echo) census.push({ book: r.book_id, lang: meta?.language ?? 'unknown', first: prev.page_number, second: cur.page_number, share: e.share,
            a: pageRec(prev), b: pageRec(cur), break_kind: breakKind(prev, cur), _a: prev, _b: cur });
        }
      }
    }
  });
  const pick = shuffle([...census], makeRng(SEED.census)).slice(0, CENSUS_CAP);
  for (const c of pick) { saveText(c._a); saveText(c._b); delete c._a; delete c._b; }
  W('frame.json', { version: PAIRED_FIFTHS_VERSION, seed: SEED, at: new Date().toISOString(), books, census: pick, census_flagged_total: census.length });
  fs.mkdirSync(RESULTS, { recursive: true });
  const ps = books.flatMap((b) => b.pairs);
  const summary = { books: books.length, pairs: ps.length, unpaired_anchors: ps.filter((p) => p.second == null).length, stale_anchors: ps.filter((p) => p.anchor_stale).length,
    break_kinds: Object.fromEntries(['call_boundary', 'in_call', 'unknown'].map((k) => [k, ps.filter((p) => p.break_kind === k).length])),
    census_flagged_total: census.length, census_judged: pick.length };
  fs.writeFileSync(path.join(RESULTS, 'frame-summary.json'), JSON.stringify(summary, null, 1) + '\n');
  console.log(JSON.stringify(summary));
}

// ── judge ──
export function jobs() {
  const F = J('frame.json');
  const order = shuffle([...F.books].sort((x, y) => (x.id < y.id ? -1 : 1)), makeRng(SEED.books));
  const out = [];
  for (const b of order) for (const p of b.pairs) {
    if (p.partner_page) out.push({ id: `page:${p.partner_page.page_id}:${p.partner_page.ocr_hash.slice(0, 12)}`, kind: 'page', book: b.id, lang: b.lang, page: p.partner_page });
    if (p.anchor_stale && p.anchor_page) out.push({ id: `page:${p.anchor_page.page_id}:${p.anchor_page.ocr_hash.slice(0, 12)}`, kind: 'page', book: b.id, lang: b.lang, page: p.anchor_page });
    if (p.second != null) {
      const [a, bb] = p.first === p.anchor ? [p.anchor_page, p.partner_page] : [p.partner_page, p.anchor_page];
      out.push({ id: `join:${a.page_id}:${bb.page_id}`, kind: 'join', set: 'random', book: b.id, lang: b.lang, a, b: bb });
    }
  }
  for (const c of F.census) out.push({ id: `join:${c.a.page_id}:${c.b.page_id}`, kind: 'join', set: 'census', book: c.book, lang: c.lang, a: c.a, b: c.b });
  // Controls: a known defect planted at a break the random set holds, judged as one more join.
  const pool = shuffle(out.filter((j) => j.kind === 'join' && j.set === 'random' && j.a.has_tr && j.b.has_tr), makeRng(SEED.controls));
  for (const j of pool.slice(0, CONTROLS_PER_KIND)) out.push({ ...j, id: `ctl-carry:${j.id}`, set: 'control_carry_over' });
  const donors = pool.slice(CONTROLS_PER_KIND);
  pool.slice(0, CONTROLS_PER_KIND).forEach((j, k) => {
    const donor = donors.find((d) => d.book !== j.book && d.lang === j.lang) ?? donors.find((d) => d.book !== j.book);
    if (donor) out.push({ ...j, id: `ctl-leaf:${j.id}`, set: 'control_wrong_leaf', donor: donor.b });
  });
  return out;
}

/** The last sentence-ish run of A's English (up to ~200 chars), prepended to B's English: a planted carry-over. */
export function plantCarry(aTr, bTr) {
  const t = clean(aTr);
  const cut = Math.max(t.lastIndexOf('. ', t.length - 40), t.length - 200);
  const tail = t.slice(Math.max(0, cut + 1)).trim();
  return { planted: `${tail} ${clean(bTr)}`, quote: tail };
}

export async function judgeOne(j) {
  if (j.kind === 'page') {
    const t = text(j.page.page_id);
    return judgeAbsolute({ lang: j.lang, text: t.ocr }, await imageFor(j.page.page_id, j.page.image));
  }
  const ta = text(j.a.page_id), tb = j.set === 'control_wrong_leaf' ? text(j.donor.page_id) : text(j.b.page_id);
  const A = { ocr: clean(ta.ocr), tr: clean(ta.tr) }, B = { ocr: clean(tb.ocr), tr: clean(tb.tr) };
  let plant = null;
  if (j.set === 'control_carry_over') { const p = plantCarry(ta.tr, tb.tr); B.tr = p.planted; plant = { kind: 'carry_over', page: 'B', quote: p.quote }; }
  if (j.set === 'control_wrong_leaf') plant = { kind: 'wrong_leaf', page: 'B' };
  const ws = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'pf8405-'));
  try {
    fs.writeFileSync(path.join(ws, 'a.jpg'), await imageFor(j.a.page_id, j.a.image));
    fs.writeFileSync(path.join(ws, 'b.jpg'), await imageFor(j.b.page_id, j.b.image));
    const prompt = joinPrompt(j.lang, A, B);
    const t0 = Date.now();
    const r = await opusCall(prompt, ws);
    return { verdict: r.cls === 'quota' ? null : parseJoin(r.text), cls: r.cls, model: r.model, usage: r.usage, prompt_sha: sha(prompt).slice(0, 16), secs: Math.round((Date.now() - t0) / 1000), plant, raw: String(r.text).slice(0, 400) };
  } finally { fs.rmSync(ws, { recursive: true, force: true }); }
}

async function judge() {
  const all = jobs();
  const prior = jsonl(VERDICTS);
  const done = new Set(prior.filter((r) => r.verdict).map((r) => r.id));
  const tries = new Map(); for (const r of prior) if (!r.verdict) tries.set(r.id, (tries.get(r.id) ?? 0) + 1);
  const todo = all.filter((j) => !done.has(j.id) && (tries.get(j.id) ?? 0) < 2);
  const limits = await import('../../lib/model-limits.mjs');
  const state = {};
  const made = prior.filter((r) => r.verdict || r.usage).length;
  const max = Math.min(Number(arg('max-calls') ?? Infinity), CALL_BUDGET - made);
  const conc = Math.max(1, Math.min(4, Number(arg('concurrency') || 3)));
  console.log(`jobs ${all.length}, done ${done.size}, to do ${todo.length}, calls allowed this run ${max}`);
  let calls = 0, i = 0, stop = null;
  await Promise.all(Array.from({ length: conc }, async () => {
    while (!stop && i < todo.length) {
      if (calls >= max) { stop = `call budget (${CALL_BUDGET} for the study)`; break; }
      const why = await paceCheck(limits, state);
      if (why) { stop = `pace: ${why}`; break; }
      const j = todo[i++]; calls++;
      let r;
      try { r = await judgeOne(j); } catch (e) { r = { verdict: null, cls: 'error', err: e.message }; }
      if (r.cls === 'quota') { stop = 'quota'; }
      fs.appendFileSync(VERDICTS, JSON.stringify({ id: j.id, kind: j.kind, set: j.set ?? null, book: j.book, at: new Date().toISOString(), ...r }) + '\n');
    }
  }));
  console.log(`judged ${calls} this run${stop ? `; stopped: ${stop}` : ''}`);
}

// ── analyze ──
const r3 = (x) => (x == null || !Number.isFinite(x) ? null : +x.toFixed(3));
function pearson(xs, ys) {
  const n = xs.length; if (n < 3) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0; for (let k = 0; k < n; k++) { sxy += (xs[k] - mx) * (ys[k] - my); sxx += (xs[k] - mx) ** 2; syy += (ys[k] - my) ** 2; }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
}
function analyze() {
  const F = J('frame.json');
  const V = new Map(jsonl(VERDICTS).filter((r) => r.verdict).map((r) => [r.id, r]));
  const pageV = (p) => (p ? V.get(`page:${p.page_id}:${p.ocr_hash.slice(0, 12)}`)?.verdict ?? null : null);
  const books = [];
  const breaks = [];
  for (const b of F.books) {
    const anchors = b.pairs.map((p) => (p.anchor_stale ? pageV(p.anchor_page) : p.anchor_verdict)).filter(Boolean);
    const partners = b.pairs.map((p) => pageV(p.partner_page)).filter(Boolean);
    const joins = b.pairs.filter((p) => p.second != null).map((p) => {
      const [a, bb] = p.first === p.anchor ? [p.anchor_page, p.partner_page] : [p.partner_page, p.anchor_page];
      const v = V.get(`join:${a.page_id}:${bb.page_id}`)?.verdict ?? null;
      if (v) breaks.push({ book: b.id, set: 'random', kind: p.break_kind, fails: joinFails(v), pages: [...new Set(v.defects.filter((d) => d.material).map((d) => d.page))], kinds: v.defects.filter((d) => d.material).map((d) => d.kind) });
      return v;
    });
    const complete = partners.length === b.pairs.filter((p) => p.partner_page).length && joins.every(Boolean) && anchors.length === b.pairs.length;
    if (!complete) continue;
    const all = [...anchors, ...partners];
    const aBad = anchorBad(anchors), pBad = pairedPagesBad(all), jBad = joins.some(joinFails);
    books.push({ id: b.id, lang: b.lang, stratum: b.stratum, anchors: anchors.length, pages: all.length,
      anchor_bad_pages: anchors.filter(badPage).length, partner_bad_pages: partners.filter(badPage).length,
      anchor_bad: aBad, paired_pages_bad: pBad, join_bad: jBad, paired_bad: pBad === true || jBad,
      a_share: anchors.filter(badPage).length / anchors.length, p_share: partners.length ? partners.filter(badPage).length / partners.length : null });
  }
  const n = books.length;
  const flipsUp = books.filter((b) => b.anchor_bad === false && b.paired_bad), flipsDown = books.filter((b) => b.anchor_bad === true && b.paired_pages_bad === false && !b.join_bad);
  const byJoinOnly = flipsUp.filter((b) => b.paired_pages_bad !== true), byPagesOnly = flipsUp.filter((b) => !b.join_bad);
  const sh = books.filter((b) => b.p_share != null);
  const r = pearson(sh.map((b) => b.a_share), sh.map((b) => b.p_share));
  const ctl = (set, check) => { const rows = [...V.values()].filter((x) => x.set === set); return { judged: rows.length, caught: rows.filter((x) => check(x)).length }; };
  const carry = ctl('control_carry_over', (x) => x.verdict.defects.some((d) => ['carry_over', 'duplicated'].includes(d.kind) && d.material)),
    leaf = ctl('control_wrong_leaf', (x) => x.verdict.defects.some((d) => d.kind === 'wrong_leaf' && d.page === 'B'));
  const valid = carry.judged >= 8 && leaf.judged >= 8 && carry.caught / carry.judged >= 0.8 && leaf.caught / leaf.judged >= 0.8;
  const census = F.census.map((c) => ({ ...c, v: V.get(`join:${c.a.page_id}:${c.b.page_id}`)?.verdict ?? null })).filter((c) => c.v);
  const byKind = Object.fromEntries(['call_boundary', 'in_call', 'unknown'].map((k) => { const x = breaks.filter((bk) => bk.kind === k); return [k, { breaks: x.length, failed: x.filter((bk) => bk.fails).length }]; }));
  const direction = { A: 0, B: 0, both: 0 }; for (const bk of breaks.filter((x) => x.fails)) { if (bk.pages.length > 1) direction.both++; else if (bk.pages[0] === 'A') direction.A++; else direction.B++; }
  const flipShare = n ? flipsUp.length / n : null;
  const score = {
    generated_at: new Date().toISOString(), issue: 8405, prereg: 'scripts/eval/experiments/2026-11-08-paired-fifths-prereg-8405.md',
    controls: { carry_over: carry, wrong_leaf: leaf, valid, rule: '>= 8 judged and >= 0.80 caught in each kind' },
    books_complete: n, books_framed: F.books.length,
    anchor_bad: books.filter((b) => b.anchor_bad).length, paired_bad: books.filter((b) => b.paired_bad).length,
    flips_good_to_bad: flipsUp.length, flips_by_join_only: byJoinOnly.length, flips_by_partner_pages_only: byPagesOnly.length, flips_bad_to_good: flipsDown.length,
    flip_share: r3(flipShare),
    breaks: { random: breaks.length, failed: breaks.filter((b) => b.fails).length, by_kind: byKind, direction_of_failed: direction },
    reliability: { split_half_r_anchor_vs_partner: r3(r), spearman_brown_10_pages: r != null ? r3((2 * r) / (1 + r)) : null, books: sh.length },
    census: { flagged_in_frame: F.census_flagged_total, judged: census.length, judged_defect: census.filter((c) => joinFails(c.v)).length,
      precision: census.length ? r3(census.filter((c) => joinFails(c.v)).length / census.length) : null },
    decision: !valid ? 'controls failed: no decision' : n < 80 ? `too few complete books (${n} < 80): no decision` : flipShare >= 0.05 ? 'pairs for the standing Opus QA' : 'keep 5 pages for the Opus QA; pairs only in the volunteer shift',
  };
  fs.mkdirSync(RESULTS, { recursive: true });
  fs.writeFileSync(path.join(RESULTS, 'score.json'), JSON.stringify(score, null, 1) + '\n');
  fs.writeFileSync(path.join(RESULTS, 'books.json'), JSON.stringify(books, null, 1) + '\n');
  console.log(JSON.stringify(score, null, 1));
}

// Stages run only when this file is the script, so the judges can be imported (a smoke run calls judgeOne).
const stage = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) ? process.argv[2] : null;
if (stage === 'frame') await frame();
else if (stage === 'judge') await judge();
else if (stage === 'analyze') analyze();
else if (stage) { console.error('stages: frame | judge | analyze'); process.exit(2); }
