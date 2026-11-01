#!/usr/bin/env node
// PRIOR ART: see lib.mjs. scripts/lib/agy-cli.mjs gatedTextCall / gatedImageCall (agy Gemini in a gated, empty
// workspace: imported unchanged); scripts/eval/route-judge-6740/judge.mjs opusCall (Opus via claude -p: imported).
// Searched scripts/eval/INDEX.md for a back-translation meaning test ("translate both", "meaning", "back-translation"):
// none compares a machine read with a typed reference THROUGH translation.
/**
 * Derek's amendment of 2026-11-01 11:35Z (job inbox) to Part B of the #7263 judge calibration:
 *
 *  (1) SEVERE defects per 1,000 words: a defect counts only if it changes what the English translation would say.
 *      Measured directly: the stored machine read and the typed reference of the same page are each translated by the
 *      SAME model with the SAME prompt (agy gemini-3.8-flash-low, TRANSLATE_PROMPT below), and Opus compares the two
 *      English versions span by span for differences in what they say (compare). The translation's own noise is
 *      measured the same way: the reference translated twice, the two English versions compared (the A-vs-A floor;
 *      20 seeded pages). Beside it: the judge-only proxy, #7866's MQM misleads + wrong_text per 1,000 words.
 *  (2) A HUMAN-TYPED ARM: #7866's judge, same prompt, on the 60 typed print references against their page images
 *      (human). Every misleads / wrong_text flag it raises on human text is adjudicated (adjudicate) by a second Opus
 *      pass and by agy Gemini, each shown the image cropped to the flagged span (a horizontal band around the span's
 *      line; the whole page when the span is not found in the typed text) and asked which reading the page prints.
 *      Real = both say the typed text is wrong; false alarm = both say it is right; else split.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/judge-cal-7866bar-7263/meaning.mjs <stage>
 *     human | translate | compare | adjudicate | export
 * All Opus calls of the study (run.mjs judge + these) stay under OPUS_CAP; the pace guard stops at weekly 85%.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { makeRng } from '../lib/paired-stats.mjs';
import { judgeAbsolute, paceCheck } from '../confidence-7866/lib.mjs';
import { opusCall } from '../route-judge-6740/judge.mjs';
import { gatedTextCall, gatedImageCall, firstJson } from '../../lib/agy-cli.mjs';
import { bodyText, foldHan } from '../ground-truth-5935/lib.mjs';
import { normalizeForScript } from '../lib/metrics.mjs';
import { SEED } from './lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RESULTS = path.join(HERE, 'results');
const OUT = path.join(process.env.JOB_SCRATCH || os.tmpdir(), 'judge-cal-7866bar');
const F = { human: path.join(OUT, 'verdicts-human.jsonl'), tr: path.join(OUT, 'translations.jsonl'), cmp: path.join(OUT, 'compare.jsonl'), adj: path.join(OUT, 'adjudications.jsonl'), main: path.join(OUT, 'verdicts.jsonl') };
export const OPUS_CAP = 260, NOISE_PAGES = 20, PAIRS_PER_CALL = 4, MODEL = 'gemini-3.8-flash-low';
const sha = (s) => createHash('sha256').update(String(s)).digest('hex');
const jsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const J = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const append = (f, r) => fs.appendFileSync(f, JSON.stringify({ ...r, at: new Date().toISOString() }) + '\n');
const shuffle = (xs, rng) => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const drawn = () => J(path.join(OUT, 'draw.json')).drawn;
const item = (uid) => J(path.join(OUT, 'items', `${uid}.json`));
const img = (uid) => fs.readFileSync(path.join(OUT, 'img', `${uid}.jpg`));
const opusSpent = () => [F.main, F.human, F.cmp].reduce((s, f) => s + jsonl(f).filter((r) => r.verdict || r.usage || r.reply).length, 0)
  + jsonl(F.adj).reduce((s, r) => s + (r.opus_calls || 0), 0);

/** The texts the meaning test translates: the body a reader is served, the typed page it should match. */
export function sourceTexts(d, it) {
  if (d.stratum === 'print') {
    const read = bodyText(it.read).split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
    return { read, ref: it.ref.text, words: normalizeForScript(it.ref.text, 'latin').split(' ').filter(Boolean).length };
  }
  const leaf = it.pbs[it.k].text;   // Kanripo's leaf, folded to Han characters; the read folded the same way
  return { read: foldHan(bodyText(it.read)), ref: leaf, words: [...leaf].length };
}

// ── (2) the human arm: #7866's judge on the typed references ──
const humanText = (it) => it.ref.text + (it.ref.notes?.length ? '\n' + it.ref.notes.map((n) => `<margin>${n}</margin>`).join('\n') : '');
async function guarded(jobs, label) {
  const limits = await import('../../lib/model-limits.mjs');
  const state = {}; let i = 0, stop = null;
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (!stop && i < jobs.length) {
      if (opusSpent() >= OPUS_CAP) { stop = `Opus cap ${OPUS_CAP}`; break; }
      const why = await paceCheck(limits, state); if (why) { stop = why; break; }
      if (i >= jobs.length) break;
      const j = jobs[i++];
      try { await j(); } catch (e) { console.log(`  ${label} ERR ${String(e.message || e).slice(0, 160)}`); }
    }
  }));
  console.log(`${label}: ${stop ? `STOPPED: ${stop}` : 'done'}; Opus calls so far ${opusSpent()}; meter ${JSON.stringify(state.meter ?? null)}`);
}
async function human() {
  const done = new Set(jsonl(F.human).filter((r) => r.verdict).map((r) => r.id));
  const ds = shuffle(drawn().filter((d) => d.stratum === 'print'), makeRng(SEED.queue + 100)).filter((d) => !done.has(`hu-${d.uid}`));
  console.log(`human: ${ds.length} typed pages to judge`);
  await guarded(ds.map((d) => async () => {
    const r = await judgeAbsolute({ lang: d.lang, text: humanText(item(d.uid)) }, img(d.uid));
    if (r.cls === 'quota') throw new Error('quota reply');
    append(F.human, { id: `hu-${d.uid}`, uid: d.uid, set: 'human', ...r });
    console.log(`  human ${d.uid}: ${r.verdict ? `accept=${r.verdict.accept} defects=${(r.verdict.defects || []).map((x) => x.severity[0]).join('')}` : 'unparsed'}`);
  }), 'human');
}

// ── (1) the meaning test ──
export const TRANSLATE_PROMPT = (lang, text) => `Translate this ${lang === 'Chinese' ? 'Classical Chinese (unpunctuated)' : lang} text from one page of a historical book into plain, literal English. Translate everything that is there, in order; do not summarise, explain, correct or complete it, and do not add anything that is not there. Keep names and numbers as written.

${text}

Do not open, read or write any file and do not use any tool: the text is above. Write the translation between two marker lines, <<<BEGIN>>> and <<<END>>>. Output nothing outside the markers: no preamble, no plan, no summary, no offers, no questions.`;
const noisePages = () => shuffle(drawn(), makeRng(SEED.sim + 1)).filter((d, i, a) => a.filter((x) => x.stratum === d.stratum).indexOf(d) < NOISE_PAGES / 2).map((d) => d.uid);
async function translate() {
  const have = new Set(jsonl(F.tr).filter((r) => r.text).map((r) => `${r.uid}|${r.which}`));
  const noise = new Set(noisePages());
  const jobs = [];
  for (const d of drawn()) {
    const s = sourceTexts(d, item(d.uid));
    for (const which of ['read', 'ref', ...(noise.has(d.uid) ? ['ref2'] : [])]) {
      if (have.has(`${d.uid}|${which}`)) continue;
      const src = which === 'read' ? s.read : s.ref;
      jobs.push(async () => {
        if (!src.trim()) { append(F.tr, { uid: d.uid, which, text: '', empty_source: true }); return; }
        const r = await gatedTextCall(TRANSLATE_PROMPT(d.lang, src), { model: MODEL, tmp: process.env.TMPDIR || os.tmpdir() });
        if (r.cls === 'quota') throw new Error('agy quota');
        append(F.tr, { uid: d.uid, which, model: MODEL, prompt_sha: sha(TRANSLATE_PROMPT(d.lang, '')).slice(0, 16), text: r.answer || null, problem: r.problem ?? r.cls ?? null });
        console.log(`  translate ${d.uid} ${which}: ${r.answer ? r.answer.length + ' chars' : 'EMPTY ' + (r.problem || r.cls)}`);
      });
    }
  }
  console.log(`translate: ${jobs.length} agy calls`);
  let i = 0, stop = null;
  await Promise.all(Array.from({ length: 2 }, async () => { while (!stop && i < jobs.length) { const j = jobs[i++]; try { await j(); } catch (e) { stop = String(e.message); } } }));
  console.log(stop ? `STOPPED: ${stop}` : 'translate done');
}

export const COMPARE_PROMPT = (pairs) => `You compare English translations. Each pair below holds two translations, A and B, made by the same translator with the same instructions from two transcriptions of the same page of a historical book. The transcriptions may differ; you do not know which (if either) is right.

For each pair, list every place where A and B differ in WHAT THEY SAY: a word, name, number, date, negation, quantity, person or reference that differs in meaning; or a passage (a phrase or more) that is in one and not the other. Ignore everything that does not change what a reader would understand: wording, synonyms, style, word order, punctuation, spelling or form of names, archaic versus modern forms, and a different but equally possible rendering of the same words.

Answer with JSON only, no prose:
{"pairs":[{"id":"<pair id>","differences":[{"a":"<up to 12 words of A, or empty if A lacks it>","b":"<up to 12 words of B, or empty>","kind":"changed|only_in_a|only_in_b","misleads":true|false}]}]}
"misleads" is true when a reader of one version would be told something the other does not say (a changed or lost statement, name, number), false when the difference is real but trivial.

${pairs.map((p) => `=== PAIR ${p.id} ===\n--- A ---\n${p.a}\n--- B ---\n${p.b}`).join('\n\n')}`;
async function compare() {
  const tr = new Map(jsonl(F.tr).filter((r) => r.text != null).map((r) => [`${r.uid}|${r.which}`, r.text]));
  const done = new Set(jsonl(F.cmp).filter((r) => r.parsed).flatMap((r) => r.pairs.map((p) => p.id)));
  const rng = makeRng(SEED.sim + 2), pairs = [];
  for (const d of drawn()) for (const [kind, x, y] of [['read', 'read', 'ref'], ['noise', 'ref', 'ref2']]) {
    if (!tr.has(`${d.uid}|${x}`) || !tr.has(`${d.uid}|${y}`)) continue;
    const id = `${kind}-${d.uid}`; if (done.has(id)) continue;
    const swap = rng() < 0.5;   // blind: which side is the read is drawn per pair
    pairs.push({ id, uid: d.uid, kind, a_is: swap ? y : x, a: tr.get(`${d.uid}|${swap ? y : x}`), b: tr.get(`${d.uid}|${swap ? x : y}`) });
  }
  const batches = []; const order = shuffle(pairs, makeRng(SEED.sim + 3));
  for (let i = 0; i < order.length; i += PAIRS_PER_CALL) batches.push(order.slice(i, i + PAIRS_PER_CALL));
  console.log(`compare: ${pairs.length} pairs in ${batches.length} Opus calls`);
  await guarded(batches.map((b) => async () => {
    const ws = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'cmp7263-'));
    try {
      const prompt = COMPARE_PROMPT(b.map((p) => ({ id: p.id, a: p.a || '(empty)', b: p.b || '(empty)' })));
      const r = await opusCall(prompt, ws);
      if (r.cls === 'quota') throw new Error('quota reply');
      let j = null; try { j = JSON.parse(String(r.text).replace(/^```(json)?|```$/gm, '').trim()); } catch { j = null; }
      append(F.cmp, { reply: true, parsed: Boolean(j), model: r.model, prompt_sha: sha(COMPARE_PROMPT([])).slice(0, 16), pairs: b.map(({ a, b: bb, ...p }) => ({ ...p, differences: j?.pairs?.find((x) => x.id === p.id)?.differences ?? null })), raw: j ? undefined : String(r.text).slice(0, 400) });
      console.log(`  compare ${b.map((p) => p.id.slice(0, 14)).join(',')}: ${j ? 'ok' : 'UNPARSED'}`);
    } finally { fs.rmSync(ws, { recursive: true, force: true }); }
  }), 'compare');
}

// ── adjudication of the judge's flags on human text ──
export const ADJ_PROMPT = (imageRef, lang, flags) => `The image ${imageRef} is part of one printed page in ${lang}. A typed transcription of the page was checked against the page image, and the checker raised the points below. For each point, look at the image yourself and say what the page actually prints there.

${flags.map((f, i) => `Point ${i + 1}. The typed text reads: "${f.quote}". The checker says: ${f.what}`).join('\n')}

For each point: "typed_right" when the page prints what the typed text reads (the checker is wrong), "typed_wrong" when the page prints something else or the typed text adds or drops something the page has, "cannot_tell" when the image does not show it. Answer with JSON only: {"points":[{"n":1,"verdict":"typed_right|typed_wrong|cannot_tell","page_prints":"<what you see, briefly>"}]}`;
async function crop(uid, it, quote) {
  const { default: sharp } = await import('sharp');
  const buf = img(uid), meta = await sharp(buf).metadata();
  const lines = it.ref.text.split('\n'), q = String(quote || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  let li = q ? lines.findIndex((l) => l.includes(q.slice(0, Math.min(20, q.length)))) : -1;
  if (li < 0) return { buf, whole: true };
  const f = (li + 0.5) / lines.length, top = Math.max(0, Math.floor((f - 0.15) * meta.height)), h = Math.min(meta.height - top, Math.ceil(0.30 * meta.height));
  return { buf: await sharp(buf).extract({ left: 0, top, width: meta.width, height: h }).jpeg({ quality: 90 }).toBuffer(), whole: false, band: [+(top / meta.height).toFixed(3), +((top + h) / meta.height).toFixed(3)] };
}
async function adjudicate() {
  const hv = jsonl(F.human).filter((r) => r.verdict);
  const have = new Set(jsonl(F.adj).filter((r) => r.points).map((r) => `${r.uid}|${r.judge}`));
  const D = new Map(drawn().map((d) => [d.uid, d]));
  const jobs = [], agyJobs = [];
  for (const r of hv) {
    const flags = (r.verdict.defects || []).filter((x) => x.severity === 'misleads' || x.severity === 'wrong_text');
    if (!flags.length) continue;
    const d = D.get(r.uid), it = item(r.uid);
    // one crop per page: the band around the first flag found in the typed text (all flags of a page share it when
    // they fall in it; a flag outside it is asked on the whole page in a second image)
    const crops = await Promise.all(flags.map((f) => crop(r.uid, it, f.quote)));
    for (const judge of ['opus', 'agy']) {
      if (have.has(`${r.uid}|${judge}`)) continue;
      const fl = flags.map((f, i) => ({ quote: f.quote, what: f.what, class: f.class, severity: f.severity, crop: crops[i].whole ? 'whole' : crops[i].band }));
      const run = async () => {
        const answers = [];
        for (const [i, f] of fl.entries()) {   // one point a call when crops differ; Opus sees one image a call
          let res;
          if (judge === 'opus') {
            const ws = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'adj7263-'));
            try { fs.writeFileSync(path.join(ws, 'crop.jpg'), crops[i].buf); res = await opusCall(ADJ_PROMPT('the file ./crop.jpg in your working directory (open it with Read before you answer)', d.lang, [f]), ws); }
            finally { fs.rmSync(ws, { recursive: true, force: true }); }
            if (res.cls === 'quota') throw new Error('quota reply');
          } else {
            res = await gatedImageCall((name) => ADJ_PROMPT(`@./${name}`, d.lang, [f]), crops[i].buf, { model: MODEL, tmp: process.env.TMPDIR || os.tmpdir() });
            if (res.cls === 'quota') throw new Error('agy quota');
          }
          const j = firstJson(res.text);   // the innermost {...}: the one point asked
          answers.push({ ...f, verdict: j?.verdict ?? null, page_prints: j?.page_prints ?? null });
        }
        append(F.adj, { uid: r.uid, judge, reply: judge === 'opus' ? true : undefined, opus_calls: judge === 'opus' ? fl.length : 0, points: answers });
        console.log(`  adjudicate ${r.uid} ${judge}: ${answers.map((a) => a.verdict).join(',')}`);
      };
      (judge === 'opus' ? jobs : agyJobs).push(run);
    }
  }
  const need = jobs.length;
  console.log(`adjudicate: ${need} pages for Opus, ${agyJobs.length} for agy`);
  let i = 0; await Promise.all(Array.from({ length: 2 }, async () => { while (i < agyJobs.length) { const j = agyJobs[i++]; try { await j(); } catch (e) { console.log('  agy ERR', String(e.message).slice(0, 120)); } } }));
  await guarded(jobs, 'adjudicate');
}

/** Committed: verdict fields, comparisons and adjudications by id; no page text, no translation. */
function exportAll() {
  const strip = (v) => v && ({ accept: v.accept, fidelity: v.fidelity, defects: (v.defects || []).map((x) => ({ class: x.class, severity: x.severity })) });
  fs.writeFileSync(path.join(RESULTS, 'verdicts-human.jsonl'), jsonl(F.human).filter((r) => r.verdict).map((r) => JSON.stringify({ id: r.id, uid: r.uid, model: r.model, prompt_sha: r.prompt_sha, ...strip(r.verdict) })).join('\n') + '\n');
  fs.writeFileSync(path.join(RESULTS, 'compare.jsonl'), jsonl(F.cmp).filter((r) => r.parsed).flatMap((r) => r.pairs.map((p) => ({ id: p.id, uid: p.uid, kind: p.kind, a_is: p.a_is, model: r.model,
    differences: (p.differences || []).map((x) => ({ kind: x.kind, misleads: x.misleads })) }))).map((r) => JSON.stringify(r)).join('\n') + '\n');
  fs.writeFileSync(path.join(RESULTS, 'adjudications.jsonl'), jsonl(F.adj).filter((r) => r.points).map((r) => JSON.stringify({ uid: r.uid, judge: r.judge, points: r.points.map((p) => ({ class: p.class, severity: p.severity, crop: p.crop, verdict: p.verdict })) })).join('\n') + '\n');
  // the denominator of every per-1,000-words rate: the typed reference's words (Latin script) or Han characters
  fs.writeFileSync(path.join(RESULTS, 'words.json'), JSON.stringify(Object.fromEntries(drawn().map((d) => [d.uid, sourceTexts(d, item(d.uid)).words])), null, 1) + '\n');
  const tr = jsonl(F.tr);
  fs.writeFileSync(path.join(RESULTS, 'translations-meta.jsonl'), tr.map((r) => JSON.stringify({ uid: r.uid, which: r.which, model: r.model, prompt_sha: r.prompt_sha, chars: r.text ? r.text.length : 0, problem: r.problem ?? null })).join('\n') + '\n');
  console.log('exported');
}

const stages = { human, translate, compare, adjudicate, export: exportAll };
if (import.meta.url === `file://${process.argv[1]}`) {
  if (!stages[process.argv[2]]) { console.error(`stages: ${Object.keys(stages).join(' | ')}`); process.exit(2); }
  await stages[process.argv[2]]();
}
