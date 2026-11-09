#!/usr/bin/env node
// PRIOR ART: scripts/eval/paired-fifths-8405/run.mjs — the 15-call study whose verdicts are the reference arm R here;
// its join prompt (joinPrompt, v1, cut to its rules block), plantCarry, imageFor, clean and the book rules (badPage,
// pairedPagesBad, joinFails) are imported. The page questions are cut from route-judge-6740 judgePrompt, and the
// calls go through its opusCall (which takes --model). scripts/eval/paired-fifths-check.mjs is the standing check this
// may change; it is not touched. The pace guard reads the lane-judge meter (claudeMeter/paceBlock) at the brief's
// thresholds (weekly 95, 5-hour 85) instead of confidence-7866 paceCheck's (85/95).
/**
 * #8478: does a batched judge (10 pages in one call, or one call per pair) find more TRUE issues per book than the
 * 15-call reference? Preregistration: scripts/eval/experiments/2026-11-09-callshape-prereg-8478.md.
 * Nothing here writes to Mongo.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/callshape-8478/run.mjs frame --r-dir=<#8405 scratch>
 *        study books and control books, texts checked against the #8405 frame-time texts
 *   ... run.mjs judge [--max-calls=N] [--concurrency=3]   B10/P5 arms (Opus, Sonnet), then V per book
 *   ... run.mjs analyze                                    → results/score.json
 *   ... run.mjs eye                                        → the by-eye draw (10 batched-only confirmed, 10 rejected)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withMongo } from '../../lib/mongo.mjs';
import { contentHash } from '../../lib/write-provenance.mjs';
import { makeRng, shuffle, sha, jsonl } from '../confidence-7866/lib.mjs';
import { opusCall, judgePrompt } from '../route-judge-6740/judge.mjs';
import { joinPrompt, plantCarry, imageFor, clean, badPage, pairedPagesBad, joinFails } from '../paired-fifths-8405/run.mjs';
import { claudeMeter, paceBlock } from '../lane-judge-sampler.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RESULTS = path.join(HERE, 'results');
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const DIR = path.resolve(arg('dir') || path.join(process.env.JOB_SCRATCH || os.tmpdir(), 'callshape-8478'));
const J = (f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
const W = (f, x) => { const p = path.join(DIR, f); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(x, null, 1)); };
const VERDICTS = path.join(DIR, 'verdicts.jsonl');
export const SEED = Object.freeze({ books: 84781, controls: 84782, plants: 84783, eye: 84784 });
export const CALL_BUDGET = 2000;
const N_STUDY = 80, CONTROLS_PER_KIND = 10;
const PACE = { weeklyMax: 95, sessionMax: 85 };
export const ARMS = [
  { id: 'B10-opus', shape: 'B10', model: 'opus' }, { id: 'B10-sonnet', shape: 'B10', model: 'sonnet' },
  { id: 'P5-opus', shape: 'P5', model: 'opus' }, { id: 'P5-sonnet', shape: 'P5', model: 'sonnet' },
];
/** Cheapest first: calls a book, then Sonnet before Opus (prereg §6). */
export const COST_ORDER = ['B10-sonnet', 'B10-opus', 'P5-sonnet', 'P5-opus', 'R'];
const tag = (i) => `p${String(i + 1).padStart(2, '0')}`;

// ── prompts: cut from the existing judges, not restated ──
function between(s, from, to) {
  const i = s.indexOf(from), j = s.indexOf(to, i + 1);
  if (i < 0 || j < 0) throw new Error(`prompt block "${from}" … "${to}" not found: the source prompt changed`);
  return s.slice(i, j).trim();
}
/** The route-judge page questions (accept, fidelity, defects with the 44-class taxonomy, reader_note, markup rule). */
export const PAGE_QUESTIONS = between(judgePrompt({ task: 'ocr', lang: 'X', text: 'X' }, 'X'), 'Questions:', 'Answer with one JSON object only').replace(/^Questions:\s*/, '');
/** The join judge v1 rules (kinds, furniture, the per-defect fields). */
export const BREAK_RULES = between(joinPrompt('X', { ocr: 'X', tr: 'X' }, { ocr: 'X', tr: 'X' }), 'Judge the BREAK', 'PAGE A transcription:');
const PAGE_EXTRA = `- en_accept: the same question for the page's ENGLISH translation (the page's statements, negations, names and numbers; style aside): true or false.
- Report defects in the ENGLISH too, with the same classes and severities, and give every defect a layer: "transcription" or "english".`;

function pagesBlock(pages) {
  return pages.map((p, i) => `=== ${tag(i)} (stored page ${p.page_number}) ===
TRANSCRIPTION:
<<<
${p.ocr}
>>>
ENGLISH:
<<<
${p.tr || '(none)'}
>>>`).join('\n\n');
}
const PAGE_JSON = (t) => `{"page": "${t}", "accept": true, "fidelity": 5, "en_accept": true, "defects": [{"layer": "transcription", "class": "O6", "quote": "...", "severity": "misleads", "what": "a few words"}], "reader_note": "..."}`;
const BREAK_JSON = (a, b) => `{"break": "${a}/${b}", "join": "clean|defect", "defects": [{"kind": "carry_over", "layer": "english", "page": "B", "quote": "...", "material": true}]}`;

/** pages: the 10 (or 2) pages in reading order, each { page_number, ocr, tr }; consecutive pairs are the breaks. */
export function batchPrompt(lang, pages) {
  const n = pages.length, ts = pages.map((_, i) => tag(i));
  const pairs = []; for (let i = 0; i + 1 < n; i += 2) pairs.push([ts[i], ts[i + 1]]);
  const many = n > 2;
  return `You are checking ${many ? `${n} pages` : 'two consecutive pages'} of a historical ${lang} book, for a library that publishes each page's transcription and English translation beside its scan. The scans are the only authority: read each leaf yourself, closely, line by line, and compare.

Open ${many ? 'every image' : 'both images'} with Read before you answer: ${ts.map((t) => `./${t}.jpg`).join(', ')}, in reading order.${many ? ` The pages come in ${pairs.length} pairs of consecutive pages (${pairs.map((p) => p.join('/')).join(', ')}); the pairs are from different parts of the book.` : ''}

PART 1, EACH PAGE. Judge each page's transcription (here called "the candidate") against its own scan, and its English against the scan and the transcription:
${PAGE_QUESTIONS}
${PAGE_EXTRA}

PART 2, EACH BREAK between the two pages of a pair (${pairs.map((p) => p.join('/')).join(', ')}). In each break, A is the first page of the pair and B the second.
${BREAK_RULES}

${pagesBlock(pages)}

Answer with one JSON object only, one entry per page and one per break:
{"opened": [${ts.map((t) => `"${t}.jpg"`).join(', ')}], "pages": [${PAGE_JSON(ts[0])}, ...], "breaks": [${BREAK_JSON(...pairs[0])}${many ? ', ...' : ''}], "note": "<one line>"}`;
}

export function parseBatch(t, n) {
  const m = String(t || '').match(/\{[\s\S]*\}/);
  try {
    const v = JSON.parse(m[0]);
    if (!Array.isArray(v.pages) || !Array.isArray(v.breaks) || v.pages.length !== n || v.breaks.length !== n / 2) return null;
    for (const p of v.pages) if (typeof p.accept !== 'boolean' || !(Number(p.fidelity) >= 1 && Number(p.fidelity) <= 5) || !Array.isArray(p.defects ?? [])) return null;
    for (const b of v.breaks) if (!['clean', 'defect'].includes(b.join) || !Array.isArray(b.defects ?? [])) return null;
    return v;
  } catch { return null; }
}

/** V: the union of every arm's findings, shuffled, no arm named. */
export function verifyPrompt(lang, pages, findings) {
  const ts = pages.map((_, i) => tag(i));
  const pairs = []; for (let i = 0; i + 1 < ts.length; i += 2) pairs.push(`${ts[i]}/${ts[i + 1]}`);
  const line = (f) => f.break
    ? `${f.id} [break ${f.break}, page ${f.page}, ${f.layer}, ${f.kind}] "${f.quote}"${f.what ? ` — ${f.what}` : ''}`
    : `${f.id} [${f.page}, ${f.layer}, ${f.class ?? '?'}, ${f.severity}] "${f.quote}"${f.what ? ` — ${f.what}` : ''}`;
  return `You are verifying findings that other readers raised about ${ts.length} pages of a historical ${lang} book (${pairs.length} pairs of consecutive pages: ${pairs.join(', ')}), for a library that publishes each page's transcription and English translation beside its scan. The scans are the only authority.

Open every image with Read before you answer: ${ts.map((t) => `./${t}.jpg`).join(', ')}.

Each finding names a page, or a break between the two pages of a pair (A = the first page of the pair, B = the second), a layer (transcription or english), a quoted span and a claim. For each finding give:
- verdict: "confirmed" when the claim is true of the text given here, read against the scan; "rejected" when the text is right, the quoted words are not in the text, or the claim misreads the scan.
- serious: true when a reader would be misled about what the page says (a wrong word, number, name or negation that changes the sense; text dropped, added, duplicated or from another page); false for spelling, punctuation, markup, layout and normalisation. Give it for rejected findings too (false).
- same_as: the id of an EARLIER finding in this list that describes the same defect, else null.
- note: a few words.
At a break, a sentence that runs across the break and is rendered whole on one of the two pages, with nothing lost and nothing rendered twice, is not a defect: reject it. A catchword, running head, page number or signature is not a defect. Normalised spelling is not a defect.
Several readers raised these and some are wrong. Do not assume a finding is right because it is listed; check each against the scan.

${pagesBlock(pages)}

FINDINGS:
${findings.map(line).join('\n')}

Answer with one JSON object only, one entry per finding:
{"opened": [${ts.map((t) => `"${t}.jpg"`).join(', ')}], "findings": [{"id": "${findings[0]?.id ?? 'F1'}", "verdict": "confirmed|rejected", "serious": true, "same_as": null, "note": "..."}, ...]}`;
}
export function parseVerify(t, ids) {
  const m = String(t || '').match(/\{[\s\S]*\}/);
  try {
    const v = JSON.parse(m[0]);
    if (!Array.isArray(v.findings)) return null;
    const by = new Map(v.findings.filter((f) => ['confirmed', 'rejected'].includes(f.verdict)).map((f) => [f.id, f]));
    if (ids.some((id) => !by.has(id))) return null;
    return { findings: ids.map((id) => by.get(id)) };
  } catch { return null; }
}

// ── findings: what an arm raised (prereg §5) ──
const SEVERE = ['misleads', 'wrong_text'];
/** pageVs: one verdict per page tag; breakVs: { break: 'pXX/pYY', verdict }. Page-judge verdicts have no layer: transcription. */
export function findingsOf(pageVs, breakVs) {
  const out = [];
  for (const [t, v] of Object.entries(pageVs)) for (const d of v?.defects ?? []) if (SEVERE.includes(d.severity))
    out.push({ page: t, layer: d.layer === 'english' ? 'english' : 'transcription', class: d.class ?? null, severity: d.severity, quote: String(d.quote ?? '').slice(0, 300), what: String(d.what ?? '').slice(0, 200) });
  for (const b of breakVs) for (const d of b.verdict?.defects ?? []) if (d.material === true)
    out.push({ break: b.break, page: d.page === 'A' ? 'A' : 'B', layer: d.layer === 'transcription' ? 'transcription' : 'english', kind: d.kind, quote: String(d.quote ?? '').slice(0, 300) });
  return out;
}

// ── controls ──
/** A numeral +7, else a negation removed, else `not` inserted. Returns { tr, token } or null. */
export function plantPageDefect(tr, rnd) {
  const t = clean(tr);
  const nums = [...t.matchAll(/\b\d{1,4}\b/g)];
  if (nums.length) {
    const m = nums[Math.floor(rnd() * nums.length)], to = String(Number(m[0]) + 7);
    return { tr: t.slice(0, m.index) + to + t.slice(m.index + m[0].length), token: to, kind: 'numeral', from: m[0] };
  }
  const neg = t.match(/\b(not|never) /);
  if (neg) return { tr: t.slice(0, neg.index) + t.slice(neg.index + neg[0].length), token: t.slice(neg.index + neg[0].length).split(/\s+/).slice(0, 3).join(' '), kind: 'negation_removed', from: neg[0].trim() };
  const cop = t.match(/\b(is|was|are|were) /);
  if (cop) return { tr: t.slice(0, cop.index + cop[0].length) + 'not ' + t.slice(cop.index + cop[0].length), token: `${cop[1]} not`, kind: 'negation_added', from: cop[1] };
  return null;
}
const has = (s, tok) => String(s ?? '').toLowerCase().includes(String(tok).toLowerCase());
/** Did this arm's verdict catch the unit's plant? pageVs keyed by tag; breakVs [{break, verdict}]. */
export function caught(plant, pageVs, breakVs) {
  const br = breakVs.find((b) => b.break === plant.break)?.verdict;
  if (plant.kind === 'carry_over') return (br?.defects ?? []).some((d) => ['carry_over', 'duplicated'].includes(d.kind) && d.material === true);
  if (plant.kind === 'wrong_leaf') {
    const pv = pageVs[plant.page];
    return (br?.defects ?? []).some((d) => d.kind === 'wrong_leaf' && d.page === 'B') || Number(pv?.fidelity) === 1 || (pv?.defects ?? []).some((d) => /^I1$/.test(d.class ?? ''));
  }
  const pv = pageVs[plant.page];
  return (pv?.defects ?? []).some((d) => d.layer === 'english' && SEVERE.includes(d.severity) && (has(d.quote, plant.token) || has(d.what, plant.token)));
}
/** Is a raised finding the plant (for V's control share)? */
export function isPlantFinding(plant, f) {
  if (plant.kind === 'page_defect') return !f.break && f.page === plant.page && f.layer === 'english' && (has(f.quote, plant.token) || has(f.what, plant.token));
  if (f.break !== plant.break) return plant.kind === 'wrong_leaf' && !f.break && f.page === plant.page && /^I1$/.test(f.class ?? '');
  return plant.kind === 'carry_over' ? ['carry_over', 'duplicated'].includes(f.kind) : f.kind === 'wrong_leaf' && f.page === 'B';
}

// ── frame ──
const PROJ = { _id: 0, id: 1, page_number: 1, 'ocr.data': 1, 'translation.data': 1 };
const textKey = (t) => `${contentHash(t.ocr ?? '')}:${contentHash(t.tr ?? '')}`;
async function frame() {
  const RD = path.resolve(arg('r-dir') || path.join(process.env.JOB_SCRATCH || os.tmpdir(), 'r/paired-fifths-8405/paired-fifths-8405'));
  const F = JSON.parse(fs.readFileSync(path.join(RD, 'frame.json'), 'utf8'));
  const RV = new Map(jsonl(path.join(RD, 'verdicts.jsonl')).filter((r) => r.verdict).map((r) => [r.id, r]));
  const rText = (id) => { const f = path.join(RD, 'texts', `${id}.json`); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null; };
  const pageV = (p) => RV.get(`page:${p.page_id}:${p.ocr_hash.slice(0, 12)}`)?.verdict ?? null;
  const drop = { not_five_pairs: 0, r_incomplete: 0, text_changed: 0, no_r_text: 0 };
  const eligible = [];
  await withMongo(async (db) => {
    for (const b of F.books) {
      if (b.pairs.length !== 5 || b.pairs.some((p) => p.second == null)) { drop.not_five_pairs++; continue; }
      const pages = [], R = { pages: {}, breaks: [] };
      let ok = true;
      const ordered = [...b.pairs].sort((x, y) => x.first - y.first);
      for (const pr of ordered) {
        const [a, bb] = pr.first === pr.anchor ? [pr.anchor_page, pr.partner_page] : [pr.partner_page, pr.anchor_page];
        const av = pr.anchor_stale ? pageV(pr.anchor_page) : pr.anchor_verdict, pv = pageV(pr.partner_page);
        const jv = RV.get(`join:${a.page_id}:${bb.page_id}`)?.verdict ?? null;
        if (!av || !pv || !jv) { ok = false; break; }
        const ta = pages.length, tb = ta + 1;
        R.pages[tag(ta)] = pr.first === pr.anchor ? av : pv; R.pages[tag(tb)] = pr.first === pr.anchor ? pv : av;
        R.breaks.push({ break: `${tag(ta)}/${tag(tb)}`, verdict: jv });
        pages.push(a, bb);
      }
      if (!ok) { drop.r_incomplete++; continue; }
      const live = await db.collection('pages').find({ id: { $in: pages.map((p) => p.page_id) } }, { projection: PROJ }).toArray();
      const byId = new Map(live.map((p) => [p.id, { ocr: p.ocr?.data ?? '', tr: p.translation?.data ?? '' }]));
      const then = pages.map((p) => rText(p.page_id));
      if (then.some((t) => !t)) { drop.no_r_text++; continue; }
      if (pages.some((p, i) => !byId.has(p.page_id) || textKey(byId.get(p.page_id)) !== textKey(then[i]))) { drop.text_changed++; continue; }
      for (const p of pages) { const f = path.join(DIR, 'texts', `${p.page_id}.json`); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(byId.get(p.page_id))); }
      eligible.push({ id: b.id, title: b.title, lang: b.lang, pages: pages.map((p) => ({ page_id: p.page_id, page_number: p.page_number, image: p.image })), R });
    }
  });
  const order = shuffle([...eligible].sort((x, y) => (x.id < y.id ? -1 : 1)), makeRng(SEED.books));
  const study = order.slice(0, N_STUDY), rest = shuffle(order.slice(N_STUDY), makeRng(SEED.controls));
  const rnd = makeRng(SEED.plants);
  const tx = (id) => JSON.parse(fs.readFileSync(path.join(DIR, 'texts', `${id}.json`), 'utf8'));
  const controls = [];
  const kinds = ['carry_over', 'wrong_leaf', 'page_defect'];
  const pool = [...rest];
  /** One planted defect at a seeded pair of book b, or null when b has no English to plant in. */
  function plantIn(b, kind) {
    const pi = Math.floor(rnd() * 5), A = b.pages[2 * pi], B = b.pages[2 * pi + 1];
    const plant = { kind, break: `${tag(2 * pi)}/${tag(2 * pi + 1)}` };
    if (kind === 'carry_over') { if (!clean(tx(A.page_id).tr) || !clean(tx(B.page_id).tr)) return null; Object.assign(plant, { page: tag(2 * pi + 1), quote: plantCarry(tx(A.page_id).tr, tx(B.page_id).tr).quote }); }
    if (kind === 'wrong_leaf') {
      const donor = [...pool, ...study].find((d) => d.id !== b.id && d.lang === b.lang) ?? pool.find((d) => d.id !== b.id);
      Object.assign(plant, { page: tag(2 * pi + 1), donor: donor.pages[Math.floor(rnd() * 10)] });
    }
    if (kind === 'page_defect') {
      // The seeded page first, then the book's other pages in a seeded order, until one has English to plant in.
      const side = rnd() < 0.5 ? 0 : 1, order = [2 * pi + side, ...shuffle([...Array(10).keys()].filter((i) => i !== 2 * pi + side), rnd)];
      let d = null, at = -1;
      for (const i of order) { d = plantPageDefect(tx(b.pages[i].page_id).tr, rnd); if (d) { at = i; break; } }
      if (!d) return null;
      Object.assign(plant, { break: `${tag(at - (at % 2))}/${tag(at - (at % 2) + 1)}`, page: tag(at), token: d.token, plant_kind: d.kind, from: d.from, tr: d.tr });
    }
    return plant;
  }
  for (let k = 0; k < CONTROLS_PER_KIND; k++) for (const kind of kinds) {
    // A control book: one planted defect. A fresh non-study book first; when none is left that can take this kind,
    // a non-study book already planted with another kind (a separate unit, judged separately).
    let done = false;
    for (let tries = pool.length; tries > 0 && !done; tries--) {
      const b = pool.shift(), plant = plantIn(b, kind);
      if (!plant) { pool.push(b); continue; }
      controls.push({ ...b, id: `${kind}:${b.id}`, book: b.id, plant, R: undefined }); done = true;
    }
    for (const b of rest) {
      if (done) break;
      if (controls.some((c) => c.id === `${kind}:${b.id}`)) continue;
      const plant = plantIn(b, kind);
      if (plant) { controls.push({ ...b, id: `${kind}:${b.id}`, book: b.id, plant, R: undefined }); done = true; }
    }
  }
  if (controls.some((c) => c.plant.donor)) {
    await withMongo(async (db) => {
      for (const c of controls.filter((x) => x.plant.donor)) {
        const p = await db.collection('pages').findOne({ id: c.plant.donor.page_id }, { projection: PROJ });
        const f = path.join(DIR, 'texts', `${p.id}.json`); if (!fs.existsSync(f)) fs.writeFileSync(f, JSON.stringify({ ocr: p.ocr?.data ?? '', tr: p.translation?.data ?? '' }));
      }
    });
  }
  // Units in run order: 3 controls (one of each kind), then 8 study books, ten times.
  const units = [];
  for (let g = 0; g < 10; g++) { units.push(...controls.slice(3 * g, 3 * g + 3).map((c) => ({ ...c, set: 'control' }))); units.push(...study.slice(8 * g, 8 * g + 8).map((b) => ({ ...b, set: 'study' }))); }
  W('frame.json', { seed: SEED, at: new Date().toISOString(), r_dir: RD, eligible: eligible.length, drop, units });
  const summary = { r_books: F.books.length, eligible: eligible.length, dropped: drop, study: study.length, controls: controls.length,
    control_kinds: Object.fromEntries(kinds.map((k) => [k, controls.filter((c) => c.plant.kind === k).length])),
    page_defect_plants: Object.fromEntries(['numeral', 'negation_removed', 'negation_added'].map((k) => [k, controls.filter((c) => c.plant.plant_kind === k).length])) };
  fs.mkdirSync(RESULTS, { recursive: true });
  fs.writeFileSync(path.join(RESULTS, 'frame-summary.json'), JSON.stringify(summary, null, 1) + '\n');
  console.log(JSON.stringify(summary));
}

// ── the texts a unit's judges see (controls carry their plant) ──
const text = (id) => JSON.parse(fs.readFileSync(path.join(DIR, 'texts', `${id}.json`), 'utf8'));
export function unitPages(u) {
  const ps = u.pages.map((p) => { const t = text(p.page_id); return { ...p, ocr: clean(t.ocr), tr: clean(t.tr) }; });
  const pl = u.plant;
  if (!pl) return ps;
  const i = Number(pl.page.slice(1)) - 1;
  if (pl.kind === 'carry_over') ps[i].tr = plantCarry(text(ps[i - 1].page_id).tr, text(ps[i].page_id).tr).planted;
  if (pl.kind === 'wrong_leaf') { const d = text(pl.donor.page_id); ps[i].ocr = clean(d.ocr); ps[i].tr = clean(d.tr); }
  if (pl.kind === 'page_defect') ps[i].tr = pl.tr;
  return ps;
}
async function workspace(pages) {
  const ws = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'cs8478-'));
  for (let i = 0; i < pages.length; i++) fs.writeFileSync(path.join(ws, `${tag(i)}.jpg`), await imageFor(pages[i].page_id, pages[i].image));
  return ws;
}

// ── jobs ──
/** A unit's arm jobs: B10 = one call (all 10 pages; a control too), P5 = one per pair (a control: the planted pair only). */
export function armJobs(u) {
  const out = [];
  for (const a of ARMS) {
    if (a.shape === 'B10') out.push({ id: `${u.id}|${a.id}`, unit: u.id, arm: a.id, model: a.model, idx: [...Array(10).keys()] });
    else for (let p = 0; p < 5; p++) {
      if (u.plant && `${tag(2 * p)}/${tag(2 * p + 1)}` !== u.plant.break) continue;
      out.push({ id: `${u.id}|${a.id}|${p}`, unit: u.id, arm: a.id, model: a.model, idx: [2 * p, 2 * p + 1] });
    }
  }
  return out;
}
/** Re-key a P5/B10 verdict from its local tags (p01, p02) to the book's tags. */
function rekey(v, idx) {
  const map = Object.fromEntries(idx.map((g, i) => [tag(i), tag(g)]));
  const pages = {}; v.pages.forEach((p, i) => { pages[tag(idx[i])] = p; });
  const breaks = v.breaks.map((b, k) => ({ break: `${tag(idx[2 * k])}/${tag(idx[2 * k + 1])}`, verdict: b }));
  return { pages, breaks, map };
}
/** Every arm's verdict for a unit, merged across its calls. null when a call is missing. */
export function armVerdicts(u, V) {
  const out = {};
  for (const a of ARMS) {
    const js = armJobs(u).filter((j) => j.arm === a.id);
    const rows = js.map((j) => V.get(j.id));
    if (rows.some((r) => !r?.verdict)) { out[a.id] = null; continue; }
    const pages = {}, breaks = [];
    js.forEach((j, k) => { const r = rekey(rows[k].verdict, j.idx); Object.assign(pages, r.pages); breaks.push(...r.breaks); });
    out[a.id] = { pages, breaks, calls: rows.length, usage: rows.map((r) => r.usage) };
  }
  if (u.R) out.R = { pages: u.R.pages, breaks: u.R.breaks, calls: 15 };
  return out;
}
/** The union for V: every arm's findings, each with its arm, shuffled by a seed from the unit, ids F1… */
export function unionFindings(u, av) {
  const all = [];
  for (const [arm, v] of Object.entries(av)) if (v) for (const f of findingsOf(v.pages, v.breaks)) all.push({ ...f, arm });
  const sh = shuffle(all, makeRng(parseInt(sha(u.id).slice(0, 8), 16)));
  return sh.map((f, i) => ({ ...f, id: `F${i + 1}` }));
}

async function runArm(j, u) {
  const pages = unitPages(u).filter((_, i) => j.idx.includes(i));
  const ws = await workspace(pages);
  try {
    const prompt = batchPrompt(u.lang, pages);
    const t0 = Date.now(), r = await opusCall(prompt, ws, j.model);
    return { verdict: r.cls === 'quota' ? null : parseBatch(r.text, pages.length), cls: r.cls, model: r.model, usage: r.usage, prompt_sha: sha(prompt).slice(0, 16), secs: Math.round((Date.now() - t0) / 1000), raw: String(r.text).slice(0, 400) };
  } finally { fs.rmSync(ws, { recursive: true, force: true }); }
}
async function runVerify(u, V) {
  const findings = unionFindings(u, armVerdicts(u, V));
  if (!findings.length) return { verdict: { findings: [] }, findings, cls: null, skipped: 'no findings' };
  const pages = unitPages(u);
  const ws = await workspace(pages);
  try {
    const prompt = verifyPrompt(u.lang, pages, findings);
    const t0 = Date.now(), r = await opusCall(prompt, ws, 'opus');
    return { verdict: r.cls === 'quota' ? null : parseVerify(r.text, findings.map((f) => f.id)), findings, cls: r.cls, model: r.model, usage: r.usage, prompt_sha: sha(prompt).slice(0, 16), secs: Math.round((Date.now() - t0) / 1000), raw: String(r.text).slice(0, 400) };
  } finally { fs.rmSync(ws, { recursive: true, force: true }); }
}

async function judge() {
  const F = J('frame.json');
  const units = F.units.slice(0, Number(arg('units') || F.units.length));
  const prior = jsonl(VERDICTS);
  const V = new Map(prior.filter((r) => r.verdict).map((r) => [r.id, r]));
  const tries = new Map(); for (const r of prior) if (!r.verdict) tries.set(r.id, (tries.get(r.id) ?? 0) + 1);
  const limits = await import('../../lib/model-limits.mjs');
  const meter = { at: 0, m: null };
  const pace = async () => {
    if (Date.now() - meter.at > 5 * 60e3) { meter.m = await claudeMeter(limits); meter.at = Date.now(); }
    const local = limits.claudeBlocked(PACE);
    return local ? `${local.reason} (until ${local.until})` : paceBlock(meter.m, PACE);
  };
  const made = prior.filter((r) => !r.skipped).length;
  const max = Math.min(Number(arg('max-calls') ?? Infinity), CALL_BUDGET - made);
  const conc = Math.max(1, Math.min(4, Number(arg('concurrency') || 3)));
  const busy = new Set(), started = new Set(prior.map((r) => r.unit));
  const exhausted = (id) => (tries.get(id) ?? 0) >= 2;
  const settled = (id) => V.has(id) || exhausted(id);
  /** The next job: the first unit in order with a runnable job (its arms, then V once its arms are settled). */
  function next() {
    for (const u of units) {
      const vid = `${u.id}|V`;
      if (settled(vid)) continue;
      const arms = armJobs(u);
      const j = arms.find((x) => !settled(x.id) && !busy.has(x.id));
      if (j) return { j, u };
      if (arms.every((x) => settled(x.id)) && !busy.has(vid)) return { j: { id: vid, unit: u.id, arm: 'V' }, u };
    }
    return null;
  }
  console.log(`units ${units.length}, verdicts so far ${V.size}, calls allowed this run ${max}`);
  let calls = 0, stop = null;
  await Promise.all(Array.from({ length: conc }, async () => {
    while (!stop) {
      if (calls >= max) { stop = `call budget (${CALL_BUDGET} for the study)`; break; }
      const why = await pace();
      if (why) { stop = `pace: ${why}`; break; }
      const n = next();
      if (!n) break;
      const { j, u } = n;
      busy.add(j.id); started.add(u.id);
      let r;
      try { r = j.arm === 'V' ? await runVerify(u, V) : await runArm(j, u); } catch (e) { r = { verdict: null, cls: 'error', err: e.message }; }
      if (!r.skipped) calls++;
      if (r.cls === 'quota') stop = 'quota';
      fs.appendFileSync(VERDICTS, JSON.stringify({ id: j.id, unit: u.id, set: u.set, arm: j.arm, at: new Date().toISOString(), ...r }) + '\n');
      if (r.verdict) V.set(j.id, r); else tries.set(j.id, (tries.get(j.id) ?? 0) + 1);
      busy.delete(j.id);
    }
  }));
  const done = units.filter((u) => V.has(`${u.id}|V`)).length;
  console.log(`called ${calls} this run; units with V: ${done}/${units.length}${stop ? `; stopped: ${stop}` : ''}`);
}

// ── analyze ──
const r3 = (x) => (x == null || !Number.isFinite(x) ? null : +x.toFixed(3));
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
function bootCI(xs, f = mean, n = 2000) {
  if (xs.length < 5) return null;
  const rnd = makeRng(SEED.eye + 1), s = [];
  for (let k = 0; k < n; k++) { const b = Array.from({ length: xs.length }, () => xs[Math.floor(rnd() * xs.length)]); s.push(f(b)); }
  s.sort((a, b) => a - b);
  return [r3(s[Math.floor(0.025 * n)]), r3(s[Math.floor(0.975 * n)])];
}
/** The #8405 paired rule on a merged arm verdict: >= 4 of 8+ pages bad on the transcription rule, or a failed join. */
export const bookBad = (v) => pairedPagesBad(Object.values(v.pages)) === true || v.breaks.some((b) => joinFails(b.verdict));
/** Cluster root of a finding (same_as chains), V's verdicts by id. */
function clusters(findings, vv) {
  const by = new Map(vv.findings.map((f) => [f.id, f]));
  const root = (id, seen = new Set()) => { const s = by.get(id)?.same_as; return s && by.has(s) && !seen.has(s) && s !== id ? root(s, seen.add(id)) : id; };
  return findings.map((f) => ({ ...f, v: by.get(f.id), root: root(f.id) }));
}
const tok = (u) => (u ? (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) : 0);
/** Prereg §7: price-weighted tokens (input 1, cache write 1.25, cache read 0.1, output 5; Sonnet 0.6 of Opus). */
const wtok = (u, model) => (u ? ((u.input_tokens ?? 0) + 1.25 * (u.cache_creation_input_tokens ?? 0) + 0.1 * (u.cache_read_input_tokens ?? 0) + 5 * (u.output_tokens ?? 0)) * (/sonnet/.test(model ?? '') ? 0.6 : 1) : 0);
/** Prereg §7 scope: OCR = transcription page defects + every break defect (R's like-for-like); translation = English page defects. */
const scopeOf = (f) => (!f.break && f.layer === 'english' ? 'translation' : 'ocr');
/** The run's team@ weekly delta in % (--weekly-delta=, else meter-start.json / meter-end.json beside DIR). */
function weeklyDelta() {
  if (arg('weekly-delta')) return Number(arg('weekly-delta'));
  const m = (f) => { try { return JSON.parse(fs.readFileSync(path.join(path.dirname(DIR), f), 'utf8')).weekly; } catch { return null; } };
  const a = m('meter-start.json'), b = m('meter-end.json');
  return a != null && b != null ? b - a : null;
}

export function analyze({ quiet = false } = {}) {
  const F = J('frame.json');
  const rows = jsonl(VERDICTS);
  const V = new Map(rows.filter((r) => r.verdict).map((r) => [r.id, r]));
  const armIds = [...ARMS.map((a) => a.id), 'R'];
  const per = Object.fromEntries(armIds.map((a) => [a, { books: [], ctl: { carry_over: [0, 0], wrong_leaf: [0, 0], page_defect: [0, 0] } }]));
  const vCtl = { raised: 0, confirmed: 0 };
  const books = [], findingsOut = [];
  for (const u of F.units) {
    const vr = V.get(`${u.id}|V`);
    const av = armVerdicts(u, V);
    if (u.set === 'control') {
      for (const a of ARMS) if (av[a.id]) { const c = per[a.id].ctl[u.plant.kind]; c[0]++; if (caught(u.plant, av[a.id].pages, av[a.id].breaks)) c[1]++; }
      if (vr) for (const f of clusters(vr.findings, vr.verdict)) if (isPlantFinding(u.plant, f)) { vCtl.raised++; if (f.v?.verdict === 'confirmed') vCtl.confirmed++; }
      continue;
    }
    if (!vr || armIds.some((a) => !av[a])) continue;
    const cl = clusters(vr.findings, vr.verdict);
    for (const f of cl) findingsOut.push({ unit: u.id, title: u.title, lang: u.lang, page_number: f.break ? null : u.pages[Number(f.page.slice(1)) - 1].page_number, ...f });
    const confirmedRoots = new Set(cl.filter((f) => f.v?.verdict === 'confirmed').map((f) => f.root));
    const seriousRoots = new Set(cl.filter((f) => f.v?.verdict === 'confirmed' && f.v?.serious === true).map((f) => f.root));
    const rBad = bookBad(av.R);
    const ocrRoots = (fs_) => new Set(fs_.filter((f) => scopeOf(f) === 'ocr' && f.v?.verdict === 'confirmed' && f.v?.serious === true).map((f) => f.root));
    const trRoots = (fs_) => new Set(fs_.filter((f) => scopeOf(f) === 'translation' && f.v?.verdict === 'confirmed' && f.v?.serious === true).map((f) => f.root));
    const uOcr = ocrRoots(cl), uTr = trRoots(cl);
    const brow = { id: u.id, lang: u.lang, union_confirmed: confirmedRoots.size, union_serious: seriousRoots.size, union_serious_ocr: uOcr.size, union_serious_tr: uTr.size, R_bad: rBad };
    for (const a of armIds) {
      const mine = cl.filter((f) => f.arm === a);
      const mOcr = mine.filter((f) => scopeOf(f) === 'ocr');
      const armRows = a === 'R' ? [] : armJobs(u).filter((j) => j.arm === a).map((j) => V.get(j.id));
      const conf = new Set(mine.filter((f) => f.v?.verdict === 'confirmed').map((f) => f.root));
      const ser = new Set(mine.filter((f) => f.v?.verdict === 'confirmed' && f.v?.serious === true).map((f) => f.root));
      const rec = { raised: mine.length, confirmed_raised: mine.filter((f) => f.v?.verdict === 'confirmed').length, confirmed: conf.size, serious: ser.size,
        recall: confirmedRoots.size ? conf.size / confirmedRoots.size : null, serious_recall: seriousRoots.size ? ser.size / seriousRoots.size : null,
        ocr_raised: mOcr.length, ocr_confirmed_raised: mOcr.filter((f) => f.v?.verdict === 'confirmed').length, serious_ocr: ocrRoots(mine).size, serious_tr: trRoots(mine).size,
        serious_ocr_recall: uOcr.size ? ocrRoots(mine).size / uOcr.size : null,
        wtok: armRows.reduce((s, r) => s + wtok(r?.usage, r?.model), 0),
        bad: bookBad(av[a]), calls: av[a].calls, tokens_in: (av[a].usage ?? []).reduce((s, x) => s + tok(x), 0), tokens_out: (av[a].usage ?? []).reduce((s, x) => s + (x?.output_tokens ?? 0), 0) };
      per[a].books.push(rec); brow[a] = rec;
    }
    brow.V = { tokens_in: tok(vr.usage), tokens_out: vr.usage?.output_tokens ?? 0, wtok: wtok(vr.usage, vr.model), findings: cl.length };
    books.push(brow);
  }
  const n = books.length;
  const arms = {};
  for (const a of armIds) {
    const bs = per[a].books;
    const raised = bs.reduce((s, b) => s + b.raised, 0), cr = bs.reduce((s, b) => s + b.confirmed_raised, 0);
    const oRaised = bs.reduce((s, b) => s + b.ocr_raised, 0), oCr = bs.reduce((s, b) => s + b.ocr_confirmed_raised, 0);
    const ctl = Object.fromEntries(Object.entries(per[a].ctl).map(([k, [j, c]]) => [k, { judged: j, caught: c }]));
    const valid = a === 'R' ? true : Object.values(ctl).every((c) => c.judged >= 9 && c.caught / c.judged >= 0.9);
    arms[a] = {
      books: bs.length, controls: a === 'R' ? '#8405: carry-over 10/10, wrong-leaf 10/10 (join judge); no page_defect control' : ctl, valid,
      findings_per_book: r3(mean(bs.map((b) => b.raised))), confirmed_per_book: r3(mean(bs.map((b) => b.confirmed))),
      serious_per_book: r3(mean(bs.map((b) => b.serious))), serious_per_book_ci: bootCI(bs.map((b) => b.serious)),
      precision: raised ? r3(cr / raised) : null, raised, confirmed_raised: cr,
      serious_ocr_per_book: r3(mean(bs.map((b) => b.serious_ocr))), serious_ocr_per_book_ci: bootCI(bs.map((b) => b.serious_ocr)),
      serious_tr_per_book: r3(mean(bs.map((b) => b.serious_tr))), serious_tr_per_book_ci: bootCI(bs.map((b) => b.serious_tr)),
      ocr_precision: oRaised ? r3(oCr / oRaised) : null, ocr_raised: oRaised, ocr_confirmed_raised: oCr,
      serious_ocr_recall_vs_union: r3(mean(bs.filter((b) => b.serious_ocr_recall != null).map((b) => b.serious_ocr_recall))),
      wtok_per_book: Math.round(mean(bs.map((b) => b.wtok)) ?? 0),
      recall_vs_union: r3(mean(bs.filter((b) => b.recall != null).map((b) => b.recall))),
      serious_recall_vs_union: r3(mean(bs.filter((b) => b.serious_recall != null).map((b) => b.serious_recall))),
      bad_books: bs.filter((b) => b.bad).length,
      agreement_with_R: a === 'R' ? null : r3(books.filter((b) => b[a].bad === b.R_bad).length / n),
      calls_per_book: r3(mean(bs.map((b) => b.calls))),
      tokens_in_per_book: a === 'R' ? null : Math.round(mean(bs.map((b) => b.tokens_in))), tokens_out_per_book: a === 'R' ? null : Math.round(mean(bs.map((b) => b.tokens_out))),
    };
  }
  // R's tokens: the #8405 rows carry usage too.
  const RV = new Map(jsonl(path.join(F.r_dir, 'verdicts.jsonl')).filter((r) => r.usage).map((r) => [r.id, r.usage]));
  const rTok = [...RV.values()];
  arms.R.tokens_per_call_8405 = { in: Math.round(mean(rTok.map(tok))), out: Math.round(mean(rTok.map((x) => x.output_tokens ?? 0))), calls: rTok.length };
  const vVals = books.map((b) => b.V);
  const vValid = vCtl.raised ? vCtl.confirmed / vCtl.raised >= 0.9 : false;
  // Quota (prereg §7): the run's weekly delta spread over the run's price-weighted tokens; R priced from its #8405 rows.
  const runW = rows.reduce((s, r) => s + wtok(r.usage, r.model), 0);
  const delta = weeklyDelta();
  const pctPerW = delta != null && runW ? delta / runW : null;
  const RW = jsonl(path.join(F.r_dir, 'verdicts.jsonl')).filter((r) => r.usage);
  arms.R.wtok_per_book = Math.round(mean(RW.map((r) => wtok(r.usage, r.model))) * 15);
  const vW = Math.round(mean(books.map((b) => b.V.wtok)) ?? 0);
  for (const a of armIds) {
    const A = arms[a];
    A.needs_V = a !== 'R' && A.ocr_precision != null && arms.R.ocr_precision != null && A.ocr_precision < arms.R.ocr_precision - 0.10;
    A.wtok_per_book_with_V = A.wtok_per_book + (A.needs_V ? vW : 0);
    A.pct_week_per_book = pctPerW ? +(A.wtok_per_book_with_V * pctPerW).toFixed(4) : null;
    A.books_per_pct_week = A.pct_week_per_book ? r3(1 / A.pct_week_per_book) : null;
    A.serious_ocr_per_pct_week = A.books_per_pct_week != null && A.serious_ocr_per_book != null ? r3(A.serious_ocr_per_book * A.books_per_pct_week) : null;
    A.serious_tr_per_pct_week = A.books_per_pct_week != null && A.serious_tr_per_book != null ? r3(A.serious_tr_per_book * A.books_per_pct_week) : null;
  }
  const R = arms.R;
  // The per-book rule of §6, reported beside the §7 rule (not used).
  let decision_per_book;
  { const cand = COST_ORDER.filter((a) => a !== 'R' && arms[a].valid && arms[a].serious_ocr_per_book >= R.serious_ocr_per_book);
    const adopt = cand.find((a) => arms[a].ocr_precision >= R.ocr_precision - 0.10);
    decision_per_book = adopt ? `adopt ${adopt}` : cand.length ? `standing check becomes ${cand[0]} + V` : 'R stays'; }
  let decision;
  if (n < 40) decision = `too few complete study books (${n} < 40): no decision`;
  else if (!vValid) decision = `V invalid on controls (${vCtl.confirmed}/${vCtl.raised} planted findings confirmed): no decision`;
  else if (pctPerW == null) decision = 'no weekly delta (meter-end.json missing): no decision';
  else {
    const cand = COST_ORDER.filter((a) => a !== 'R' && arms[a].valid && arms[a].serious_ocr_per_pct_week > R.serious_ocr_per_pct_week)
      .sort((a, b) => arms[b].serious_ocr_per_pct_week - arms[a].serious_ocr_per_pct_week);
    decision = cand.length ? `adopt ${cand[0]}${arms[cand[0]].needs_V ? ' + V' : ''}` : 'R stays';
  }
  const score = {
    generated_at: new Date().toISOString(), issue: 8478, prereg: 'scripts/eval/experiments/2026-11-09-callshape-prereg-8478.md',
    study_books_complete: n, units_framed: F.units.length,
    union: { confirmed_per_book: r3(mean(books.map((b) => b.union_confirmed))), serious_per_book: r3(mean(books.map((b) => b.union_serious))),
      serious_ocr_per_book: r3(mean(books.map((b) => b.union_serious_ocr))), serious_tr_per_book: r3(mean(books.map((b) => b.union_serious_tr))) },
    quota: { weekly_delta_pct: delta, run_wtok: Math.round(runW), pct_week_per_mwtok: pctPerW ? +(pctPerW * 1e6).toFixed(4) : null, V_wtok_per_book: vW },
    arms, V: { controls: vCtl, valid: vValid, calls: vVals.length, tokens_in_per_book: Math.round(mean(vVals.map((x) => x.tokens_in)) ?? 0), tokens_out_per_book: Math.round(mean(vVals.map((x) => x.tokens_out)) ?? 0) },
    calls_made: rows.filter((r) => !r.skipped).length, calls_failed: rows.filter((r) => !r.verdict && !r.skipped).length,
    decision, decision_per_book,
  };
  if (!quiet) {
    fs.mkdirSync(RESULTS, { recursive: true });
    fs.writeFileSync(path.join(RESULTS, 'score.json'), JSON.stringify(score, null, 1) + '\n');
    fs.writeFileSync(path.join(RESULTS, 'books.json'), JSON.stringify(books, null, 1) + '\n');
    W('findings.json', findingsOut);
    console.log(JSON.stringify(score, null, 1));
  }
  return { score, books, findings: findingsOut };
}

/** The by-eye draw (prereg §5): 10 V-confirmed findings raised only by a new arm (B10/P5, not R), 10 V-rejected, seeded. */
function eye() {
  const { findings } = analyze({ quiet: true });
  const byRoot = new Map(); for (const f of findings) { const k = `${f.unit}#${f.root}`; (byRoot.get(k) ?? byRoot.set(k, []).get(k)).push(f); }
  const batchedOnly = [...byRoot.values()].filter((g) => g.every((f) => f.arm !== 'R') && g.some((f) => f.v?.verdict === 'confirmed')).map((g) => g[0]);
  const rejected = findings.filter((f) => f.v?.verdict === 'rejected');
  const pick = (xs) => shuffle([...xs].sort((a, b) => `${a.unit}${a.id}`.localeCompare(`${b.unit}${b.id}`)), makeRng(SEED.eye)).slice(0, 10);
  const F = J('frame.json'); const U = new Map(F.units.map((u) => [u.id, u]));
  const show = (f) => { const u = U.get(f.unit); const idx = f.break ? f.break.split('/').map((t) => Number(t.slice(1)) - 1) : [Number(f.page.slice(1)) - 1];
    return { ...f, pages: idx.map((i) => ({ tag: tag(i), page_id: u.pages[i].page_id, page_number: u.pages[i].page_number, img: path.join(process.env.JOB_SCRATCH || os.tmpdir(), 'paired-fifths-8405', 'img', `${u.pages[i].page_id}.jpg`) })) }; };
  const out = { batched_only_confirmed: pick(batchedOnly).map(show), rejected: pick(rejected).map(show), pools: { batched_only_confirmed: batchedOnly.length, rejected: rejected.length } };
  W('eye.json', out);
  console.log(JSON.stringify(out.pools));
}

const stage = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) ? process.argv[2] : null;
if (stage === 'frame') await frame();
else if (stage === 'judge') await judge();
else if (stage === 'analyze') analyze();
else if (stage === 'eye') eye();
else if (stage) { console.error('stages: frame | judge | analyze | eye'); process.exit(2); }
