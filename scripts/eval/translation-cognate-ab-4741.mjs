#!/usr/bin/env node
// PRIOR ART: scripts/eval/translation-prompt-v14-ab.mjs — the house A/B (v13a, v13b noise floor, candidate; blind
// judge; pre-registration). Not reusable as-is: its units come from the 2026-09-30 audit strata, its submit is the
// Batch API from Hetzner, and its judge packets score note/seam defects. This study draws pages FOR the key terms
// it measures, runs 144 realtime flash-lite calls through callGemini (scripts/lib/gemini-script-client.mjs), and
// scores term fidelity mechanically. Prompt assembly is production's (buildTranslationPrompt); sampling is
// sampleOnePagePerBook (scripts/eval/lib/sampling.mjs).
/**
 * translation-cognate-ab-4741 — translation prompt v19 (v13 + "key terms") vs the live v13 (#4741).
 * Pre-registration: scripts/eval/PREREGISTRATION-translation-cognate-4741.md (committed before any output).
 *
 *   node --env-file=.env.production.local scripts/eval/translation-cognate-ab-4741.mjs --draw      FREE  pin units
 *   ... --run [--approved-usd 1]                                                                    PAID  144 calls, resumable
 *   ... --packets                                                                                   FREE  blinded judge packets
 *   ... --score                                                                                     FREE  report.json
 *
 * NOTHING here writes to `pages` or `prompts`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { loadTranslationPrompts, buildTranslationPrompt, sanitizeTranslationTags, MODEL_LITE } from '../lib/translate-core.mjs';
import { callGemini } from '../lib/gemini-script-client.mjs';
import { sampleOnePagePerBook, connect, disconnect } from './lib/sampling.mjs';
import { makeRng } from './lib/paired-stats.mjs';
import { costOf } from '../lib/model-pricing.mjs';

const args = process.argv.slice(2);
const has = (n) => args.includes(`--${n}`);
const opt = (n, d = null) => { const i = args.indexOf(`--${n}`); return i === -1 ? d : args[i + 1]; };

const HERE = path.dirname(new URL(import.meta.url).pathname);
const DIR = path.join(HERE, 'results/translation-cognate-ab-4741-2026-10-26');
fs.mkdirSync(DIR, { recursive: true });
const UNITS = path.join(DIR, 'units.json');
const OUT = path.join(DIR, 'outputs.jsonl');
const SEED = 4741;
const MODEL = MODEL_LITE;
const TEMPERATURE = 1.0;
const ARMS = ['v13a', 'v13b', 'v19'];
const md5 = (s) => createHash('md5').update(s).digest('hex');

// ── the candidate edit, verbatim from the pre-registration ───────────────────
const ANCHOR = '9. Preserve the voice and spirit of the original.';
export const KEY_TERMS = `10. Key terms — keep the author's vocabulary:
   - Where a source word has an English cognate with the same meaning, use the cognate (concordia → concord, consonantia → consonance). Do not swap in a near-synonym because it sounds more natural: concordia is "concord", not "harmony".
   - Keep the author's distinctions: never render two different source words with the same English word, and render the same source word the same way each time it occurs on the page.
   - Watch for false friends, where the English cognate has drifted in meaning (virtus is often power or excellence rather than moral virtue; experimentum is often experience; religio, pietas, ingenium, convenientia). There, translate the sense and add <note>original: "..."</note>.`;
export function buildV19(v13) {
  const n = v13.split(ANCHOR).length - 1;
  if (n !== 1) throw new Error(`anchor matched ${n}x, expected 1`);
  return v13.replace(ANCHOR, () => `${ANCHOR}\n${KEY_TERMS}`);
}

// ── measure 1 ────────────────────────────────────────────────────────────────
export const FAMILIES = [
  { key: 'concord', src: /concord|concors/i, en: /concord/i, named: true },
  { key: 'consonan', src: /consonan/i, en: /consonan/i, named: true },
  { key: 'sympath', src: /sympath/i, en: /sympath/i, named: false },
  { key: 'antipath', src: /antipath/i, en: /antipath/i, named: false },
  { key: 'proporti', src: /proporti/i, en: /proportion/i, named: false },
  { key: 'symmetri', src: /symmetri/i, en: /symmetr/i, named: false },
  { key: 'temperament', src: /temperament/i, en: /temperament/i, named: false },
];
/** The English a reader reads: no notes, summaries, keywords or meta (a cognate parked in a note does not count). */
export function body(text) {
  return (text || '').replace(/<(note|summary|keywords|meta|gloss)\b[^>]*>[\s\S]*?<\/\1>/g, ' ').replace(/[​-‍﻿]/g, '');
}
export function termScore(ocr, translation) {
  const b = body(translation);
  const present = FAMILIES.filter((f) => f.src.test(ocr));
  const hit = (fs_) => (fs_.length ? fs_.filter((f) => f.en.test(b)).length / fs_.length : null);
  return {
    families: present.map((f) => f.key),
    all: hit(present),
    named: hit(present.filter((f) => f.named)),
    heldout: hit(present.filter((f) => !f.named)),
    conflation: !/harmoni|armoni/i.test(ocr) && /harmon/i.test(b),
  };
}

// ── --draw ───────────────────────────────────────────────────────────────────
async function draw() {
  if (fs.existsSync(UNITS)) throw new Error(`${UNITS} exists — units are pinned once`);
  const bookFilter = { language: 'Latin', visible: true, pages_count: { $gt: 0 } };
  const strata = [
    ['T', 24, { 'ocr.data': /concord|consonan|sympath|antipath|proporti|symmetri|temperament/i }],
    ['F', 12, { 'ocr.data': /virtut|virtus|experiment|convenienti|religio/i }],
    ['C', 12, {}],
  ];
  const used = new Set();
  const units = [];
  for (const [stratum, n, pageFilter] of strata) {
    const got = await sampleOnePagePerBook({ bookFilter: { ...bookFilter, id: { $nin: [...used] } }, pageFilter, n, minOcrChars: 600, oversample: 4 });
    for (const u of got) { used.add(u.bookId); units.push({ unit: `${stratum}-${units.filter((x) => x.stratum === stratum).length + 1}`, stratum, ...u, ocrHash: md5(u.ocrText) }); }
    console.log(stratum, got.length, 'of', n);
  }
  fs.writeFileSync(UNITS, JSON.stringify({ seed: SEED, drawn_at: new Date().toISOString(), units }, null, 1));
  console.log(`pinned ${units.length} units → ${path.relative(process.cwd(), UNITS)}`);
}

// ── --run ────────────────────────────────────────────────────────────────────
async function run() {
  const approved = Number(opt('approved-usd', 0));
  if (!(approved > 0)) throw new Error('--approved-usd required (estimate ≈ $0.25)');
  const { units } = JSON.parse(fs.readFileSync(UNITS, 'utf8'));
  const { db } = await connect();
  const prompts = await loadTranslationPrompts(db);
  if (prompts.translation.ref.version !== 13) throw new Error(`live default is v${prompts.translation.ref.version}, pre-registered against v13`);
  const v19Prompts = { ...prompts, translation: { text: buildV19(prompts.translation.text), ref: { ...prompts.translation.ref, version: 'eval-4741-v19' } } };
  const done = new Set(fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').trim().split('\n').filter(Boolean).map((l) => { const r = JSON.parse(l); return `${r.unit}|${r.arm}`; }) : []);
  const books = new Map((await db.collection('books').find({ id: { $in: units.map((u) => u.bookId) } }, { projection: { id: 1, title: 1, display_title: 1, author: 1, year: 1, published: 1, language: 1 } }).toArray()).map((b) => [b.id, b]));
  let spent = 0;
  const jobs = units.flatMap((u) => ARMS.map((arm) => ({ u, arm }))).filter(({ u, arm }) => !done.has(`${u.unit}|${arm}`));
  console.log(`${jobs.length} calls to make`);
  const work = async ({ u, arm }) => {
    const book = books.get(u.bookId) || { language: 'Latin' };
    const { prompt, promptRef } = buildTranslationPrompt({ prompts: arm === 'v19' ? v19Prompts : prompts, book, ocrText: u.ocrText, previousTranslation: null });
    let row;
    try {
      const r = await callGemini({ model: MODEL, prompt, temperature: TEMPERATURE, maxOutputTokens: 8192, endpoint: 'eval/translation-cognate-ab-4741', type: 'translation' });
      const text = sanitizeTranslationTags(r.text || '');
      const cost = costOf(MODEL, r.inputTokens || 0, r.outputTokens || 0);
      spent += cost;
      row = { unit: u.unit, arm, outcome: text.trim() ? 'ok' : 'empty', text, prompt_hash: md5(prompt), prompt_version: promptRef.version, model: MODEL, params: { temperature: TEMPERATURE, thinking: 'off', context_given: null }, usage: { input: r.inputTokens, output: r.outputTokens, thinking: r.thinkingTokens }, cost_usd: cost, finish: r.finishReason || null };
    } catch (e) {
      row = { unit: u.unit, arm, outcome: 'error', error: String(e.message || e).slice(0, 300), model: MODEL };
    }
    fs.appendFileSync(OUT, JSON.stringify(row) + '\n');
    if (spent > approved) throw new Error(`spent $${spent.toFixed(3)} > approved $${approved}`);
  };
  for (let i = 0; i < jobs.length; i += 6) await Promise.all(jobs.slice(i, i + 6).map(work));
  console.log(`done; this run ≈ $${spent.toFixed(4)}`);
  await disconnect();
}

// ── --packets ────────────────────────────────────────────────────────────────
function loadOutputs() {
  const rows = fs.readFileSync(OUT, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const m = new Map();
  for (const r of rows) m.set(`${r.unit}|${r.arm}`, r);
  return m;
}
function packets() {
  const { units } = JSON.parse(fs.readFileSync(UNITS, 'utf8'));
  const out = loadOutputs();
  const rng = makeRng(SEED);
  const pairs = [];
  const controlUnits = new Set(units.filter((_, i) => i % 4 === 0).map((u) => u.unit)); // 12 of 48
  for (const u of units) {
    const t = (arm) => out.get(`${u.unit}|${arm}`)?.text || '';
    // Texts are attached in add(), from THIS unit. (An earlier version filled them afterwards from
    // pairs.slice(-3), which on a unit with two pairs overwrote the previous unit's last pair with this
    // unit's English — caught by a judge on 2026-10-26; the affected pairs were re-judged.)
    const add = (kind, x, y) => { const flip = rng() < 0.5; const A = flip ? y : x, B = flip ? x : y; pairs.push({ unit: u.unit, stratum: u.stratum, kind, A, B, src: u.ocrText, textA: t(A), textB: t(B) }); };
    add('cand', 'v19', 'v13a');
    add('noise', 'v13b', 'v13a');
    if (controlUnits.has(u.unit)) add('control', 'v13a', 'v13a');
  }
  // shuffle so a judge cannot read a pair's kind from its position
  for (let i = pairs.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [pairs[i], pairs[j]] = [pairs[j], pairs[i]]; }
  pairs.forEach((p, i) => { p.id = `P${String(i + 1).padStart(3, '0')}`; });
  const key = pairs.map(({ id, unit, stratum, kind, A, B }) => ({ id, unit, stratum, kind, A, B }));
  fs.writeFileSync(path.join(DIR, 'judge-key.json'), JSON.stringify(key, null, 1));
  const N_FILES = 8;
  for (let f = 0; f < N_FILES; f++) {
    const mine = pairs.filter((_, i) => i % N_FILES === f).map(({ id, src, textA, textB }) => ({ id, latin: src, english_A: textA, english_B: textB }));
    fs.writeFileSync(path.join(DIR, `packet-${f + 1}.json`), JSON.stringify(mine, null, 1));
  }
  console.log(`${pairs.length} pairs in ${N_FILES} packets; key in judge-key.json (do not give it to a judge)`);
}

// ── --score ──────────────────────────────────────────────────────────────────
function score() {
  const { units } = JSON.parse(fs.readFileSync(UNITS, 'utf8'));
  const out = loadOutputs();
  const meanOf = (xs) => { const v = xs.filter((x) => x != null); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
  const m1 = {};
  for (const arm of ARMS) {
    const rows = units.map((u) => ({ u, r: out.get(`${u.unit}|${arm}`) }));
    const sc = rows.map(({ u, r }) => ({ stratum: u.stratum, ...(r?.outcome === 'ok' ? termScore(u.ocrText, r.text) : { all: 0, named: 0, heldout: 0, conflation: false, failed: true, families: FAMILIES.filter((f) => f.src.test(u.ocrText)).map((f) => f.key) }) }));
    const T = sc.filter((s) => s.stratum === 'T');
    m1[arm] = {
      failed: sc.filter((s) => s.failed).length,
      T_all: meanOf(T.map((s) => (s.families.length ? s.all : null))),
      T_named: meanOf(T.map((s) => s.named)),
      T_heldout: meanOf(T.map((s) => s.heldout)),
      n_named: T.filter((s) => s.named != null).length,
      n_heldout: T.filter((s) => s.heldout != null).length,
      conflation: sc.filter((s) => s.conflation).length,
    };
  }
  const report = { measure: 'term-fidelity (mechanical, cognate stem present in body)', m1 };
  // Verdicts: verdicts-1..8.jsonl, except the pairs in rejudge-ids.json (the packet bug, see packets()),
  // whose verdicts come from verdicts-r*.jsonl, judged on the corrected packets.
  const vFiles = fs.readdirSync(DIR).filter((f) => /^verdicts-\d+\.jsonl$/.test(f));
  if (vFiles.length) {
    const key = new Map(JSON.parse(fs.readFileSync(path.join(DIR, 'judge-key.json'), 'utf8')).map((k) => [k.id, k]));
    const rejudge = new Set(fs.existsSync(path.join(DIR, 'rejudge-ids.json')) ? JSON.parse(fs.readFileSync(path.join(DIR, 'rejudge-ids.json'), 'utf8')) : []);
    const read = (f) => fs.readFileSync(path.join(DIR, f), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const v = [
      ...vFiles.flatMap(read).filter((x) => !rejudge.has(x.id)),
      ...fs.readdirSync(DIR).filter((f) => /^verdicts-r\d+\.jsonl$/.test(f)).flatMap(read).filter((x) => rejudge.has(x.id)),
    ];
    const missing = [...key.keys()].filter((id) => !v.some((x) => x.id === id));
    if (missing.length) console.warn(`missing verdicts: ${missing.join(' ')}`);
    const agg = {};
    for (const x of v) {
      const k = key.get(x.id); if (!k) continue;
      // normalise so "first" = v19 (cand) or v13b (noise); errors per arm
      const firstArm = k.kind === 'cand' ? 'v19' : k.kind === 'noise' ? 'v13b' : 'v13a';
      const firstIsA = k.A === firstArm;
      const pref = (p) => (p === 'tie' ? 'tie' : (p === 'A') === firstIsA ? 'first' : 'second');
      const a = (agg[`${k.kind}|${k.stratum}`] ||= { n: 0, fidelity: { first: 0, second: 0, tie: 0 }, readability: { first: 0, second: 0, tie: 0 }, serious_first: 0, serious_second: 0, ff_first: 0, ff_second: 0 });
      a.n++;
      a.fidelity[pref(x.fidelity)]++;
      a.readability[pref(x.readability)]++;
      a.serious_first += firstIsA ? x.serious_A : x.serious_B; a.serious_second += firstIsA ? x.serious_B : x.serious_A;
      a.ff_first += firstIsA ? x.false_friends_A : x.false_friends_B; a.ff_second += firstIsA ? x.false_friends_B : x.false_friends_A;
    }
    const sum = (kind, strata = ['T', 'F', 'C']) => {
      const t = { n: 0, fid: { first: 0, second: 0, tie: 0 }, read: { first: 0, second: 0, tie: 0 }, serious_first: 0, serious_second: 0, ff_first: 0, ff_second: 0 };
      for (const s of strata) { const a = agg[`${kind}|${s}`]; if (!a) continue; t.n += a.n; for (const k of ['first', 'second', 'tie']) { t.fid[k] += a.fidelity[k]; t.read[k] += a.readability[k]; } t.serious_first += a.serious_first; t.serious_second += a.serious_second; t.ff_first += a.ff_first; t.ff_second += a.ff_second; }
      return t;
    };
    const control = sum('control');
    report.judge = {
      note: 'first = v19 in cand pairs, v13b in noise pairs; second = v13a',
      control_tie_rate: control.n ? control.fid.tie / control.n : null,
      cand_all: sum('cand'), noise_all: sum('noise'),
      cand_F: sum('cand', ['F']), cand_C: sum('cand', ['C']), noise_C: sum('noise', ['C']),
      by_kind_stratum: agg, verdicts: v.length,
    };
  }
  fs.writeFileSync(path.join(DIR, 'report.json'), JSON.stringify(report, null, 1));
  console.log(JSON.stringify(report, null, 1));
}

if (has('draw')) await draw().finally(disconnect);
else if (has('run')) await run();
else if (has('packets')) packets();
else if (has('score')) score();
else console.log('one of --draw --run --packets --score');
