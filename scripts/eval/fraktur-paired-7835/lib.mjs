// PRIOR ART: scripts/eval/correction-pass-7818/lib.mjs (judgeAbsolute, servedCorrection, servedArmc, correctionRead,
// spanSeverity, fca, scoreText, the pace guard: imported unchanged), scripts/eval/route-judge-6740/judge.mjs (judgePrompt,
// opusCall, parseVerdict; unchanged, through the #7818 lib), scripts/eval/route-judge-6740/defect-rate.mjs `words` (#7824's
// word count, imported), scripts/eval/lib/metrics.mjs (windowedErrorRate, the CER kernel; scoreAgainstReference through
// scoreText), scripts/eval/typed-refs-6012/lib.mjs (the private-R2 reader of the DTA pages). What is new here: the face
// tag (one agy call per page), OCR-D Level 2 / Level 1 CER on grapheme clusters (DTA keeps ſ and the superscript-e
// umlaut; no scorer here kept them), and the fixed error-kind rule over the character diff. Searched scripts/eval/INDEX.md
// (lib/ table), `gh issue list --search "Fraktur diplomatic"`: no diplomatic German scorer existed (#7835).
/**
 * Shared pieces of the #7835 Fraktur tests (scripts/eval/experiments/2026-10-31-fraktur-paired-7835.md). Everything
 * bulky lives in OUT ($JOB_SCRATCH/fraktur-7835, or --out); the committed summary is results/.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { windowedErrorRate } from '../lib/metrics.mjs';
import { alignSyllables } from '../../lib/tibetan-yatags-guard.mjs';
import { agyCall, installToolGate, unwrapRead, CLI_SAFE_ARGS } from '../../lib/agy-cli.mjs';
import { opusCall } from '../route-judge-6740/judge.mjs';
export { words as words7824 } from '../route-judge-6740/defect-rate.mjs';
export { mulberry32, shuffle, makeRng, sha, judgeAbsolute, servedCorrection, servedArmc, correctionRead, paceCheck, wrongText, spanSeverity, fca, scoreText, stripFurniture, defectCounts, FURNITURE } from '../correction-pass-7818/lib.mjs';
import { sha, stripFurniture } from '../correction-pass-7818/lib.mjs';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '../../..');
export const RESULTS = path.join(HERE, 'results');
export const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
export const flag = (n) => process.argv.includes(`--${n}`);
export const OUT = path.resolve(arg('out') || path.join(process.env.JOB_SCRATCH || os.tmpdir(), 'fraktur-7835'));
export const J = (f) => JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'));
export const W = (f, x) => { fs.mkdirSync(path.dirname(path.join(OUT, f)), { recursive: true }); fs.writeFileSync(path.join(OUT, f), JSON.stringify(x, null, 1)); };
export const jsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
export const ENV_FILE = '/root/sourcelibrary/.env.production.local';

// ── the preregistered seeds (experiment file §Seeds) ──
export const SEED = Object.freeze({ t1: 78351, t2: 78352, t3: 78353, t4: 78354, queue: 78355, wrongPage: 78356, planted: 78357, t4check: 78358 });
export const AGY_MODEL = 'gemini-3.8-flash-low';
/** The arms of each test, in the order they are reported (experiment file §Arms). */
export const ARMS = Object.freeze({ t1: ['a', 'b', 'c'], t2: ['a', 'b', 'c'], t3: ['lite', 'a', 'b', 'c'] });
export const centuryOf = (y) => (y ? `${Math.floor(y / 100) + 1}th` : 'unknown');
/** $ per agy call, #7701's price (subscription quota valued at the API's list price of the same call). */
export const AGY_CALL_USD = 0.00087;

/** Fetch an image once into OUT/img/<key>.jpg (the same bytes for every tagger and judge of a page). */
export async function imageFor(key, url) {
  const f = path.join(OUT, 'img', `${key}.jpg`);
  if (fs.existsSync(f)) return fs.readFileSync(f);
  const r = await fetch(url, { headers: { 'User-Agent': 'SourceLibrary-eval/7835 (https://sourcelibrary.org)' } });
  if (!r.ok) throw new Error(`image HTTP ${r.status} ${String(url).slice(0, 100)}`);
  const buf = Buffer.from(await r.arrayBuffer());
  fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, buf);
  return buf;
}

// ── T4 and the strata of T1–T3: the face of a page (one agy call; 30 checked by Opus) ──
export const FACES = ['fraktur', 'antiqua', 'mixed', 'none'];
export function facePrompt(imageRef) {
  return `Look at this page of a printed book. The page image is attached: ${imageRef}

Which typeface family sets the main body text of the page?
- fraktur: blackletter of any kind (Fraktur, Schwabacher, Textura, Rotunda, Gothic type).
- antiqua: roman or italic type.
- mixed: both families set substantial parts of the body text (not just a heading, a title line or a few foreign words).
- none: the page has no printed body text (blank, a plate or picture only, handwriting, a binding or a colour chart).
Judge the body text only: headings, running heads and isolated words in the other family do not make a page mixed.

Answer with one JSON object only: {"face": "fraktur|antiqua|mixed|none", "why": "<a few words>"}`;
}
export const parseFace = (t) => { const m = String(t || '').match(/\{[\s\S]*?\}/); try { const v = JSON.parse(m[0]); return FACES.includes(v.face) ? v : null; } catch { return null; } };
const TAG_SUFFIX = '\n\nWrite the JSON object between two marker lines, <<<BEGIN>>> and <<<END>>>. Output nothing outside the markers.';
/** One face tag through agy (default model flash-low), the image in a gated workspace; one retry on an unparsed reply. */
export async function agyFace(imageBuf, { model = AGY_MODEL } = {}) {
  const ws = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'fr7835t-'));
  try {
    fs.writeFileSync(path.join(ws, 'page.jpg'), imageBuf);
    installToolGate(ws);
    const prompt = facePrompt('@./page.jpg') + TAG_SUFFIX;
    let r, v = null, calls = 0;
    for (let i = 0; i < 2 && !v; i++) {
      r = await agyCall(['-p', prompt, '--model', model, ...CLI_SAFE_ARGS], ws);
      if (r.not_called || r.cls === 'quota') return { quota: true, err: r.err ?? r.cls };
      calls++;
      v = parseFace(unwrapRead(r.text).text || r.text);
    }
    return { tag: v, model, calls, prompt_sha: sha(prompt).slice(0, 16), raw: v ? undefined : String(r.text).slice(0, 300) };
  } finally { fs.rmSync(ws, { recursive: true, force: true }); }
}
/** The same question to Opus via claude -p (the T4 check), the image in the workspace. */
export async function opusFace(imageBuf) {
  const ws = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'fr7835o-'));
  try {
    fs.writeFileSync(path.join(ws, 'page.jpg'), imageBuf);
    const prompt = facePrompt('the file ./page.jpg in your working directory (open it with Read before you answer)');
    const r = await opusCall(prompt, ws);
    return { tag: r.cls === 'quota' ? null : parseFace(r.text), cls: r.cls, model: r.model, usage: r.usage, list_usd: r.cost, raw: String(r.text).slice(0, 300) };
  } finally { fs.rmSync(ws, { recursive: true, force: true }); }
}

// ── T3: diplomatic scoring against DTA (OCR-D levels, .claude/docs/quality-rubric-and-sampling.md §4.2) ──
const COMB_E = 'ͤ';
const LIGS = { 'ﬀ': 'ff', 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬃ': 'ffi', 'ﬄ': 'ffl', 'ﬅ': 'ſt', 'ﬆ': 'st' };
export const LIGATURES = Object.keys(LIGS);
/**
 * The text both levels start from. OCR: the furniture tags removed with their content (#7818's list), every other tag
 * dropped and its text kept, markdown heading marks, emphasis stars/underscores and table pipes dropped. Reference
 * (DTA tei-pages-v1 body text): gap marks ◊ and object-replacement characters dropped. Both: NFC, line-break hyphens
 * rejoined (- ¬ ⸗ before a line break: layout at every level, §4.3), whitespace collapsed. Case, punctuation, ſ, ß,
 * the superscript-e umlaut (U+0364), ꝛ and ligature code points are KEPT: this is Level 2.
 */
export function baseText(t, { ocr = true } = {}) {
  let s = String(t || '');
  if (ocr) s = stripFurniture(s).replace(/<[^>]*>/g, ' ').replace(/^\s*#+\s*/gm, '').replace(/[*_|]/g, ' ');
  else s = s.replace(/[◊￼]/g, ' ');
  return s.normalize('NFC').replace(/(\p{L})[-¬⸗]\s*\n\s*(?=\p{L})/gu, '$1').replace(/\s+/g, ' ').trim();
}
/** Level 1: ſ→s, ꝛ→r, ligature code points split, superscript-e umlaut → ¨ umlaut, u/v → u and i/j → i (both cases). */
export function level1(s) {
  return String(s).replace(/[ﬀ-ﬆ]/g, (c) => LIGS[c] ?? c).replace(/ſ/g, 's').replace(/ꝛ/g, 'r')
    .normalize('NFD').replace(new RegExp(`([aouAOU])${COMB_E}`, 'g'), '$1̈').replace(new RegExp(COMB_E, 'g'), '').normalize('NFC')
    .replace(/v/g, 'u').replace(/V/g, 'U').replace(/j/g, 'i').replace(/J/g, 'I');
}
const SEG = new Intl.Segmenter('de', { granularity: 'grapheme' });
export const graphemes = (s) => [...SEG.segment(String(s))].map((x) => x.segment);
/** CER over NFC grapheme clusters (spaces not scored), windowed (metrics.mjs windowedErrorRate: interior insertions charged). */
export function graphemeCer(ref, hyp) {
  const map = new Map([[' ', ' ']]);
  const enc = (s) => graphemes(s).map((g) => { if (!map.has(g)) map.set(g, String.fromCodePoint(0xF0000 + map.size)); return map.get(g); }).join('');
  const r = windowedErrorRate(enc(ref), enc(hyp));
  return { cer: r.windowedCer, ref_units: r.windowUnits };
}
/** Level 2 and Level 1 CER of one OCR text against one DTA page. */
export function levelCers(reference, ocr) {
  const R = baseText(reference, { ocr: false }), O = baseText(ocr);
  return { l2: graphemeCer(R, O), l1: graphemeCer(level1(R), level1(O)) };
}

/**
 * Fitting alignment with backtrace over grapheme arrays (spaces removed): OCR text before the first and after the last
 * aligned grapheme is free, as in the windowed CER. Returns the edit ops [{op: 'sub'|'del'|'ins'|'eq', r, h, ri}].
 */
export function alignGraphemes(R, H) {
  const n = R.length, m = H.length;
  const dir = new Uint8Array((n + 1) * (m + 1));   // 0 diag, 1 up (del), 2 left (ins)
  let prev = new Int32Array(m + 1), cur = new Int32Array(m + 1);
  for (let i = 1; i <= n; i++) {
    cur[0] = i; dir[i * (m + 1)] = 1;
    for (let j = 1; j <= m; j++) {
      const sub = prev[j - 1] + (R[i - 1] === H[j - 1] ? 0 : 1), del = prev[j] + 1, ins = cur[j - 1] + 1;
      if (sub <= del && sub <= ins) { cur[j] = sub; dir[i * (m + 1) + j] = 0; } else if (del <= ins) { cur[j] = del; dir[i * (m + 1) + j] = 1; } else { cur[j] = ins; dir[i * (m + 1) + j] = 2; }
    }
    [prev, cur] = [cur, prev];
  }
  let j = 0, best = Infinity; for (let k = 0; k <= m; k++) if (prev[k] < best) { best = prev[k]; j = k; }
  const ops = []; let i = n;
  while (i > 0) {
    const d = j === 0 ? 1 : dir[i * (m + 1) + j];
    if (d === 0) { ops.push({ op: R[i - 1] === H[j - 1] ? 'eq' : 'sub', r: R[i - 1], h: H[j - 1], ri: i - 1 }); i--; j--; }
    else if (d === 1) { ops.push({ op: 'del', r: R[i - 1], h: null, ri: i - 1 }); i--; }
    else { ops.push({ op: 'ins', r: null, h: H[j - 1], ri: i }); j--; }
  }
  return ops.reverse();
}

const UML_E = /^[aouAOU]ͤ$/u, UML_D = /^[äöüÄÖÜ]$/u;
const isDigit = (g) => /^\d$/.test(g ?? '');
/**
 * The fixed error-kind rule (experiment file §T3). Level-2 graphemes, aligned by alignGraphemes. Per page: counts and
 * the reference denominators. Names are word-level: see nameErrors.
 */
export function errorKinds(reference, ocr) {
  const R = graphemes(baseText(reference, { ocr: false }).replace(/ /g, '')), H = graphemes(baseText(ocr).replace(/ /g, ''));
  const ops = alignGraphemes(R, H);
  const k = {
    long_s: { ref: R.filter((g) => g === 'ſ').length, kept: 0, to_s: 0, to_f: 0, dropped: 0, other: 0, s_to_long_s: 0, f_to_long_s: 0 },
    umlaut_e: { ref: R.filter((g) => UML_E.test(g)).length, kept: 0, to_diaeresis: 0, to_bare: 0, other: 0, diaeresis_ref: R.filter((g) => UML_D.test(g)).length, diaeresis_to_e: 0 },
    ligature: { ref: R.filter((g) => LIGATURES.includes(g)).length, ref_kept: 0, emitted: H.filter((g) => LIGATURES.includes(g)).length },
    r_rotunda: { ref: R.filter((g) => g === 'ꝛ').length, ref_kept: 0, emitted: H.filter((g) => g === 'ꝛ').length },
    numbers: { ref_digits: R.filter(isDigit).length, errors: 0 },
    capital_ij: { ref_J: R.filter((g) => g === 'J').length, J_to_I: 0 },
    all: { ref: R.length, errors: 0 },
  };
  for (const o of ops) {
    if (o.op !== 'eq') k.all.errors++;
    if (o.r === 'ſ') { if (o.op === 'eq') k.long_s.kept++; else if (o.h === 's') k.long_s.to_s++; else if (o.h === 'f') k.long_s.to_f++; else if (o.op === 'del') k.long_s.dropped++; else k.long_s.other++; }
    if (o.h === 'ſ' && o.op === 'sub') { if (o.r === 's') k.long_s.s_to_long_s++; else if (o.r === 'f') k.long_s.f_to_long_s++; }
    if (o.r && UML_E.test(o.r)) { if (o.op === 'eq') k.umlaut_e.kept++; else if (o.h && UML_D.test(o.h) && o.h.normalize('NFD')[0] === o.r[0]) k.umlaut_e.to_diaeresis++; else if (o.h === o.r[0]) k.umlaut_e.to_bare++; else k.umlaut_e.other++; }
    if (o.r && UML_D.test(o.r) && o.h && UML_E.test(o.h)) k.umlaut_e.diaeresis_to_e++;
    if (o.r && LIGATURES.includes(o.r) && o.op === 'eq') k.ligature.ref_kept++;
    if (o.r === 'ꝛ' && o.op === 'eq') k.r_rotunda.ref_kept++;
    if (o.op !== 'eq' && (isDigit(o.r) || isDigit(o.h))) k.numbers.errors++;
    if (o.r === 'J' && o.h === 'I') k.capital_ij.J_to_I++;
  }
  return k;
}

/**
 * Proper names (approximation, declared): a reference word that is capitalised, not sentence-initial, and whose Level-1
 * lower-case key occurs in at most 2 of the T3 frame's typed works (`workFreq`: key -> number of works). German
 * capitalises every noun, so this counts rare capitalised words: names and rare nouns alike. An error is such a word whose
 * aligned OCR word (alignSyllables on Level-1 keys) has another key. Returns { names, errors, examples }.
 */
const wordKey = (w) => level1(w).toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
export function nameErrors(reference, ocr, workFreq) {
  const Rw = baseText(reference, { ocr: false }).split(' ').filter(Boolean), Hw = baseText(ocr).split(' ').filter(Boolean);
  const Rk = Rw.map(wordKey), Hk = Hw.map(wordKey);
  const al = alignSyllables(Rk, Hk);
  const hypOf = new Map(al.filter(([i, j]) => i != null).map(([i, j]) => [i, j]));
  let names = 0, errors = 0; const ex = [];
  Rw.forEach((w, i) => {
    if (!/^\p{Lu}/u.test(w) || !Rk[i] || Rk[i].length < 3) return;
    if (i === 0 || /[.!?:]$/.test(Rw[i - 1])) return;
    if ((workFreq.get(Rk[i]) ?? 0) > 2) return;
    names++;
    const j = hypOf.get(i);
    if (j == null || Hk[j] !== Rk[i]) { errors++; if (ex.length < 8) ex.push(`${w} → ${j == null ? '∅' : Hw[j]}`); }
  });
  return { names, errors, examples: ex };
}
export { wordKey };
