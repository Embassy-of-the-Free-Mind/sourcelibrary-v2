// PRIOR ART: scripts/eval/route-judge-6740/judge.mjs (judgePrompt / opusCall / parseVerdict / clusterCI, imported
// unchanged), scripts/eval/lane-judge-sampler.mjs (the pace guard, scriptClass, exportScore, imported),
// scripts/eval/flash-reread-5924/{pairs,score}.mjs + C-TASK.md (the pairwise verdict words and the X/Y key, reused),
// scripts/eval/flash-reread-5924/fc-judge.mjs (the agy judge call shape), scripts/eval/lib/metrics.mjs
// (scoreAgainstReference / normalizeForScript), scripts/batch/cli-ocr.mjs (the correction call and apply guards; a
// top-level-await script, so not importable: the guards it takes from libs are imported, the two inline rules are
// restated in servedCorrection() below and checked against the lane's own reads, PREREGISTRATION §W3). Searched
// scripts/eval/INDEX.md, `gh issue list --search "correction pass"`: no paired production + ground-truth test of the
// correction lane existed (#7818).
/**
 * Shared pieces of the #7818 correction-pass test (scripts/eval/experiments/2026-10-31-correction-pass-paired-7818.md).
 * Everything bulky lives in OUT ($JOB_SCRATCH/correction-pass-7818, or --out); the committed summary is results/.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { makeRng } from '../lib/paired-stats.mjs';
import { scoreAgainstReference, normalizeForScript, NORMALIZE_FOR_SCRIPT_VERSION } from '../lib/metrics.mjs';
import { judgePrompt, opusCall, parseVerdict } from '../route-judge-6740/judge.mjs';
import { claudeMeter, paceBlock } from '../lane-judge-sampler.mjs';
import { agyCall, installToolGate, unwrapRead, CLI_SAFE_ARGS } from '../../lib/agy-cli.mjs';
import { ocrReadProblem } from '../../lib/cli-chatter.mjs';
import { loopVerdict } from '../../lib/ocr-loop-guard.mjs';
import { checkWrittenText, correctionHeaderProblem } from '../../lib/write-text-guard.mjs';
import { alignSyllables } from '../../lib/tibetan-yatags-guard.mjs';
import { foreignScriptReason } from '../../lib/reread-lane-gate.mjs';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '../../..');
export const RESULTS = path.join(HERE, 'results');
export const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
export const flag = (n) => process.argv.includes(`--${n}`);
export const OUT = path.resolve(arg('out') || path.join(process.env.JOB_SCRATCH || os.tmpdir(), 'correction-pass-7818'));
export const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
export const J = (f) => JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'));
export const W = (f, x) => { fs.mkdirSync(path.dirname(path.join(OUT, f)), { recursive: true }); fs.writeFileSync(path.join(OUT, f), JSON.stringify(x, null, 1)); };
export const jsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

// ── the preregistered seeds (PREREGISTRATION §Seeds) ──
export const SEED = Object.freeze({ frame: 7818, noise: 78181, pairs: 78182, planted: 78183, wrongPage: 78184, queue: 78185, wikisource: 20261031 });
export function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
/** Seeded Fisher–Yates on a copy. */
export function shuffle(xs, rnd) { const a = xs.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
export { makeRng };

// ── scoring against Wikisource (PREREGISTRATION §Normalisation) ──
// Page furniture the reference does not carry (Wikisource keeps running heads, page numbers and footnotes outside the
// page body: <noinclude>, <ref>), removed WITH its content from every OCR text before scoring. Tags not listed keep
// their text (normalizeForScript drops the tag itself).
export const FURNITURE = ['header', 'page-num', 'sig', 'catchword', 'catch', 'meta', 'vocab', 'summary', 'keywords', 'language', 'script', 'page-type', 'scan-quality', 'columns', 'warning', 'note'];
const FURN_RE = new RegExp(`<(${FURNITURE.join('|')})\\b[^>]*>[\\s\\S]*?<\\/\\1>`, 'gi');
export const stripFurniture = (t) => String(t || '').replace(FURN_RE, ' ');
/** ß and ẞ fold to ss on both sides before normalizeForScript (whose Latin letters are [a-z0-9] and would drop ß). */
export const preFold = (t) => String(t || '').replace(/ß/g, 'ss').replace(/ẞ/g, 'SS');
export const SCORE_SCRIPT = 'latin';
export const NORMALISATION = { furniture_removed: FURNITURE, pre_fold: 'ß/ẞ -> ss', normalizeForScript: SCORE_SCRIPT, version: NORMALIZE_FOR_SCRIPT_VERSION };
/** CER (windowed: interior insertions charged; leading/trailing free), WER (subsequence word error), aligned flag. */
export function scoreText(reference, ocr) {
  const R = preFold(reference), O = preFold(stripFurniture(ocr));
  const s = scoreAgainstReference(R, O, SCORE_SCRIPT);
  return { cer: s.windowedCer ?? 1, cer_subsequence: s.cer, wer: s.guard.value, aligned: s.aligned, ref_chars: s.windowUnits };
}
const words = (t) => normalizeForScript(preFold(stripFurniture(t)), SCORE_SCRIPT).split(' ').filter((w) => w.length > 1);
/**
 * H2's "added words not explained by the draft": words of the correction (normalised, 2+ letters) that are neither in
 * the reference nor in the draft. Returns { count, runs3 } where runs3 counts runs of 3+ such words in a row.
 */
export function unexplainedInsertions(reference, draft, corr) {
  const R = new Set(words(preFold(reference))), D = new Set(words(draft));
  let count = 0, run = 0, runs3 = 0;
  const ex = [];
  for (const w of words(corr)) {
    if (!R.has(w) && !D.has(w)) { count++; run++; if (run === 3) runs3++; if (ex.length < 12) ex.push(w); } else run = 0;
  }
  return { count, runs3, examples: ex };
}

// ── what the correction lane SERVES from one correction read (cli-ocr.mjs apply, correct mode, print) ──
// Restated from cli-ocr.mjs (not importable): REFUSAL and the 25% word-change cap with its tokeniser.
const REFUSAL = /\bI (cannot|can't|am unable to) (provide|transcribe|reproduce)|content restrictions|safety filters|^#{2,3} Summary\b|overview and summary of the text/im;
const MAX_CORRECTED = 0.25;
const wordTokens = (t) => String(t).replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean);
function changedWords(draft, next) {
  const A = wordTokens(draft), B = wordTokens(next);
  const same = alignSyllables(A, B).filter(([i, j]) => i !== null && j !== null && A[i] === B[j]).length;
  return { draftN: A.length, changed: Math.max(A.length, B.length) - same };
}
/**
 * read: { exit, wrapper, text } of one correction read; draft: the text it corrected; languages: the book's language
 * codes for the foreign-script guard. Returns { outcome: 'written'|'unchanged'|'contain'|'other', why, served }.
 * served = the read when written, else the draft (the lane leaves the page).
 */
export function servedCorrection(read, draft, { languages = [] } = {}) {
  const leave = (outcome, why) => ({ outcome, why, served: draft });
  const text = String(read.text ?? '').trim();
  if (read.exit !== 0) return leave('other', `cli exit ${read.exit}`);
  if (read.wrapper) return leave('other', `reply wrapper: ${read.wrapper}`);
  if (text.length < 5) return leave('other', 'empty read (refusal or blank)');
  if (/^UNCHANGED\.?$/i.test(text)) return leave('unchanged', 'corrector: UNCHANGED (the draft stands)');
  const contain = text.match(/^CONTAIN\s*:\s*([\s\S]+)$/i);
  if (contain && contain[1].length < 600 && !/<page-type>/.test(text)) return leave('contain', 'corrector: CONTAIN (a claim to check by eye)');
  if (text.length > 25000) return leave('other', 'over 25k chars');
  if (REFUSAL.test(text)) return leave('other', 'refusal or summary in place of a transcription');
  const chatter = ocrReadProblem(text, { header: false });
  if (chatter) return leave('other', `chatter guard: ${chatter}`);
  if (loopVerdict(text).refuse) return leave('other', 'repetition loop');
  let t = text;
  const guard = checkWrittenText(t, { kind: 'ocr' });
  if (guard.verdict === 'truncated') return leave('other', 'write guard: truncated');
  if (guard.verdict === 'repaired_mid') t = guard.repaired;
  const foreign = foreignScriptReason(t, { languages, served: draft });
  if (foreign) return leave('other', foreign.replace(/: .*/, ''));
  if (correctionHeaderProblem(draft, t)) return leave('other', 'more transcription headers than the draft: restarted or refused read');
  const d = changedWords(draft, t);
  if (d.changed / Math.max(1, d.draftN) > MAX_CORRECTED) return leave('other', `correction changes ${Math.round(100 * d.changed / Math.max(1, d.draftN))}% of the draft's words: check by eye`);
  return { outcome: 'written', why: 'written', served: t };
}

// ── the correction call (cli-ocr.mjs read, correct mode, one page: the #6560 request exactly) ──
const NUDGE = 'Running commands is not available here. Answer directly from the attached file now, following the instructions above exactly.';
/** template: the lane's fc-correct-prompt.txt; draft; imageBuf; ws: an empty workspace dir; model: the lane's. */
export async function correctionRead({ template, draft, imageBuf, ws, key, model }) {
  fs.mkdirSync(ws, { recursive: true });
  const img = path.join(ws, `${key}.jpg`);
  fs.writeFileSync(img, imageBuf);
  const sent = `${template.split('{draft}').join(draft)} @./${path.basename(img)}`;
  installToolGate(ws);
  let r, nudged = false, rereads = 0, calls = 0;
  for (;;) {
    r = await agyCall(['-p', sent, '--model', model, ...CLI_SAFE_ARGS], ws);
    if (r.not_called || r.cls === 'quota') return { quota: true, err: r.err ?? r.cls, locked_until: r.locked_until ?? null, calls };
    calls++;
    if (r.cls === 'denied_tool' && r.conversation && !nudged) { nudged = true; r = await agyCall(['-p', NUDGE, '--model', model, ...CLI_SAFE_ARGS, '--conversation', r.conversation], ws); calls++; }
    const u = unwrapRead(r.text);
    if (!r.cls && (u.problem || ocrReadProblem(u.text, { header: false }) || checkWrittenText(u.text, { kind: 'ocr' }).verdict === 'truncated') && rereads === 0) { rereads++; continue; }
    break;
  }
  const { text, problem } = unwrapRead(r.text);
  return { text, wrapper: problem ?? null, exit: r.cls ? 1 : 0, cls: r.cls ?? null, raw: r.text, calls, nudged, rereads, prompt_sha: sha(sent).slice(0, 16), usage: r.usage ?? null };
}

// ── the judges ──
/** The pace guard of the sampler: model-limits' local stop, then the meter (weekly 85 / 5-hour 95). */
export async function paceCheck(limits, state) {
  if (Date.now() - (state.at ?? 0) > 5 * 60e3) { state.meter = await claudeMeter(limits); state.at = Date.now(); }
  const local = limits.claudeBlocked({ weeklyMax: 85, sessionMax: 95 });
  return local ? `${local.reason} (until ${local.until})` : paceBlock(state.meter, { weeklyMax: 85, sessionMax: 95 });
}
/** One absolute verdict: route-judge judgePrompt, image in the workspace, Opus via claude -p. */
export async function judgeAbsolute(item, imageBuf) {
  const ws = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'cp7818-'));
  try {
    fs.writeFileSync(path.join(ws, 'page.jpg'), imageBuf);
    const prompt = judgePrompt({ task: 'ocr', lang: item.lang, text: item.text }, 'the file ./page.jpg in your working directory (open it with Read before you answer)');
    const t0 = Date.now();
    const r = await opusCall(prompt, ws);
    return { verdict: r.cls === 'quota' ? null : parseVerdict(r.text), cls: r.cls, model: r.model, usage: r.usage, list_usd: r.cost, prompt_sha: sha(prompt).slice(0, 16), secs: Math.round((Date.now() - t0) / 1000), raw: String(r.text).slice(0, 400) };
  } finally { fs.rmSync(ws, { recursive: true, force: true }); }
}

/** The pairwise task: C-TASK.md's verdict and preference words (#5924), for one page, both texts inline. */
export function pairPrompt(lang, x, y, imageRef) {
  return `You are a careful reader of early modern printed ${lang}. Judge two transcriptions of the SAME printed page, labelled X and Y, against the page image. You do not know where either came from; do not guess.

The page image is attached: ${imageRef}

Per transcription, a verdict:
- misleading: a reader is misled about what the page says: a meaning change (a wrong word, number, name or negation that changes the sense), an omitted passage (a line or more of the page's text missing), or another leaf's text served as this one's.
- flawed: errors, but the gist is right: spelling, single letters, punctuation, normalisation that does not change the sense.
- sound: faithful to the page.
With the verdict, list the defects: class (page-error taxonomy, e.g. O5 omission, O6 meaning-changing misread, O7 numerals, O8 normalisation, O11 furniture, O12 marginalia, I4 neighbour strip), the words as transcribed (quote), what the print has (print), and material (true when it changes or drops meaning).
Metadata tags (<header>, <page-num>, <margin>, <vocab> ...) are part of a transcription; judge them, but layout and tag differences alone are minor.

Then a preference: X better / Y better / tie, and whether the loser's defect is material (it changes or drops meaning the other read gets right) or minor (spelling, punctuation, tags, layout).

TRANSCRIPTION X START
${x}
TRANSCRIPTION X END

TRANSCRIPTION Y START
${y}
TRANSCRIPTION Y END

Answer with one JSON object only:
{"X": {"verdict": "misleading|flawed|sound", "defects": [{"class": "O6", "quote": "...", "print": "...", "material": true}]}, "Y": {...}, "prefer": "X|Y|tie", "loser_material": false, "why": "<one line, quoting the decisive words>"}`;
}
export const parsePair = (t) => { const m = String(t || '').match(/\{[\s\S]*\}/); try { const v = JSON.parse(m[0]); return ['X', 'Y', 'tie'].includes(v.prefer) && v.X?.verdict && v.Y?.verdict ? v : null; } catch { return null; } };
export async function judgePair(lang, x, y, imageBuf) {
  const ws = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'cp7818p-'));
  try {
    fs.writeFileSync(path.join(ws, 'page.jpg'), imageBuf);
    const prompt = pairPrompt(lang, x, y, 'the file ./page.jpg in your working directory (open it with Read before you answer)');
    const t0 = Date.now();
    const r = await opusCall(prompt, ws);
    return { answer: r.cls === 'quota' ? null : parsePair(r.text), cls: r.cls, model: r.model, usage: r.usage, list_usd: r.cost, prompt_sha: sha(prompt).slice(0, 16), secs: Math.round((Date.now() - t0) / 1000), raw: String(r.text).slice(0, 400) };
  } finally { fs.rmSync(ws, { recursive: true, force: true }); }
}

/** The second judge: the same judgePrompt through agy's default model, one call, the JSON between markers. */
export const AGY_JUDGE_SUFFIX = '\n\nWrite the JSON object between two marker lines, <<<BEGIN>>> and <<<END>>>. Output nothing outside the markers: no preamble, no plan, no summary.';
export async function judgeAgy(item, imageBuf, { model = 'gemini-3.8-flash-low' } = {}) {
  const ws = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'cp7818g-'));
  try {
    fs.writeFileSync(path.join(ws, 'page.jpg'), imageBuf);
    installToolGate(ws);
    const prompt = judgePrompt({ task: 'ocr', lang: item.lang, text: item.text }, '@./page.jpg') + AGY_JUDGE_SUFFIX;
    let r, v = null, calls = 0;
    for (let i = 0; i < 2 && !v; i++) {
      r = await agyCall(['-p', prompt, '--model', model, ...CLI_SAFE_ARGS], ws);
      if (r.not_called || r.cls === 'quota') return { quota: true, err: r.err ?? r.cls };
      calls++;
      v = parseVerdict(unwrapRead(r.text).text || r.text);
    }
    return { verdict: v, cls: r.cls ?? null, model, calls, prompt_sha: sha(prompt).slice(0, 16), raw: v ? undefined : String(r.text).slice(0, 400) };
  } finally { fs.rmSync(ws, { recursive: true, force: true }); }
}

export const wrongText = (v) => (v?.defects || []).some((d) => d.severity === 'wrong_text');

/** Fetch an image once into OUT/img/<key>.jpg (the same bytes for every judge of a page). */
export async function imageFor(key, url) {
  const f = path.join(OUT, 'img', `${key}.jpg`);
  if (fs.existsSync(f)) return fs.readFileSync(f);
  const r = await fetch(url, { headers: { 'User-Agent': 'SourceLibrary-eval/7818 (https://sourcelibrary.org)' } });
  if (!r.ok) throw new Error(`image HTTP ${r.status} ${url.slice(0, 100)}`);
  const buf = Buffer.from(await r.arrayBuffer());
  fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, buf);
  return buf;
}

// ═══ AMENDMENT 1 (2026-10-30, Derek's notes; experiment file §Amendment 1) ═══
import { correctionDiffs, applyDiffVerdicts, longSPass, LANG_OF } from '../../lib/correction-diff-guard.mjs';
import { levenshtein } from '../lib/metrics.mjs';

/** A1(a): MQM-style weights on the judge's own severity tags; the main set and the two sensitivity sets. */
export const SEVERITY_WEIGHTS = Object.freeze({ main: { cosmetic: 1, misleads: 5, wrong_text: 25 }, flat: { cosmetic: 1, misleads: 5, wrong_text: 10 }, steep: { cosmetic: 1, misleads: 10, wrong_text: 100 } });
const bodyWords = (t) => String(t || '').replace(/<[^>]+>/g, ' ').split(/\s+/).filter((w) => /\p{L}|\d/u.test(w)).length;
/** Severity-weighted error score of one verdict per 100 words of the text it judged. */
export function severityScore(verdict, text, w = SEVERITY_WEIGHTS.main) {
  const n = Math.max(1, bodyWords(text));
  const s = (verdict?.defects || []).reduce((a, d) => a + (w[d.severity] ?? 0), 0);
  return 100 * s / n;
}

/**
 * A2: model-free severity of every difference between a text and the human reference (Arm W). Words are aligned by
 * their folded key (normalizeForScript 'latin': case, diacritics, long-s, u/v, i/j, punctuation folded), so a span is a
 * run of unaligned or unequal keys. Rule (Derek 2026-10-30):
 *   wrong_text  a span holding a digit on either side; an inserted run (no reference words) whose words are in neither
 *               the reference nor the draft (when a draft is given); a dropped run of >= 5 reference words (a line);
 *               French only: a substituted reference word that is capitalised and not sentence-initial (a name). German
 *               capitalises every noun, so names are not detected there (declared limitation).
 *   misleads    every other substitution, insertion or a dropped run of < 5 words.
 *   cosmetic    an aligned word whose key matches but whose spelling differs (long-s, ligature, case, accent, u/v,
 *               punctuation attached to the word).
 * OCR-only words before the first and after the last aligned word are free, as in the windowed CER (running heads and
 * text the reference keeps elsewhere); reference words missing there still count.
 */
const rawTokens = (t) => preFold(stripFurniture(t)).replace(/(\p{L})[-¬]\s*\n\s*(\p{L})/gu, '$1$2').replace(/<[^>]+>/g, ' ').normalize('NFC').split(/\s+/).filter(Boolean);
const keyOf = (w) => normalizeForScript(w, SCORE_SCRIPT).replace(/ /g, '');
export function spanSeverity(reference, hyp, { draft = null, lang = 'de' } = {}) {
  const Rr = rawTokens(reference).map((w) => ({ w, k: keyOf(w) })).filter((x) => x.k);
  const Hr = rawTokens(hyp).map((w) => ({ w, k: keyOf(w) })).filter((x) => x.k);
  const refSet = new Set(Rr.map((x) => x.k)), draftSet = draft == null ? null : new Set(rawTokens(draft).map(keyOf).filter(Boolean));
  const al = alignSyllables(Rr.map((x) => x.k), Hr.map((x) => x.k));
  const matched = al.map(([i, j]) => i != null && j != null && Rr[i].k === Hr[j].k);
  const first = matched.indexOf(true), last = matched.lastIndexOf(true);
  const spans = [], counts = { cosmetic: 0, misleads: 0, wrong_text: 0 };
  const push = (sev, kind, ref, hy) => { counts[sev]++; if (spans.length < 200) spans.push({ sev, kind, ref: ref.join(' ').slice(0, 120), hyp: hy.join(' ').slice(0, 120) }); };
  let hunk = null;
  const close = () => {
    if (!hunk) return;
    const ref = hunk.r.map((i) => Rr[i].w), hy = hunk.h.map((j) => Hr[j].w);
    if (/\d/.test(ref.join('') + hy.join(''))) push('wrong_text', 'number', ref, hy);
    else if (!ref.length) {
      const novel = hunk.h.filter((j) => !refSet.has(Hr[j].k) && (!draftSet || !draftSet.has(Hr[j].k)));
      push(novel.length ? 'wrong_text' : 'misleads', novel.length ? 'invented' : 'insertion', ref, hy);
    } else if (!hy.length) push(ref.length >= 5 ? 'wrong_text' : 'misleads', ref.length >= 5 ? 'dropped line' : 'omission', ref, hy);
    else if (lang === 'fr' && hunk.r.some((i) => /^\p{Lu}/u.test(Rr[i].w) && i > 0 && !/[.!?:»"]$/.test(Rr[i - 1].w))) push('wrong_text', 'name', ref, hy);
    else push('misleads', 'substitution', ref, hy);
    hunk = null;
  };
  al.forEach(([i, j], x) => {
    if ((x < first || x > last) && i == null) return;   // OCR text before the first / after the last aligned word: free
    if (matched[x]) { close(); if (Rr[i].w !== Hr[j].w) push('cosmetic', 'spelling', [Rr[i].w], [Hr[j].w]); return; }
    hunk ??= { r: [], h: [] };
    if (i != null) hunk.r.push(i); if (j != null) hunk.h.push(j);
  });
  close();
  const refWords = Rr.length;
  const per100 = (w) => (refWords ? 100 * (w.cosmetic * counts.cosmetic + w.misleads * counts.misleads + w.wrong_text * counts.wrong_text) / refWords : null);
  return { counts, ref_words: refWords, score: per100(SEVERITY_WEIGHTS.main), score_flat: per100(SEVERITY_WEIGHTS.flat), score_steep: per100(SEVERITY_WEIGHTS.steep), spans };
}

/**
 * A3: order-independent character accuracy, after Clausner, Pletschacher & Antonacopoulos (2020): the reference is cut
 * into chunks (its lines; a line over 120 characters into ~80-character pieces at word breaks), each chunk is matched to
 * its best substring of what is left of the OCR (fitting alignment, longest chunks first), the matched OCR is used up,
 * and OCR characters left at the end count as insertions. FCA = 1 - (chunk distances + leftover) / reference characters,
 * floored at 0. Characters: normalizeForScript 'latin', spaces removed. Not Clausner's exact chunking; declared.
 */
export function fca(reference, hyp) {
  const norm = (s) => normalizeForScript(preFold(s), SCORE_SCRIPT).replace(/ /g, '');
  const lines = preFold(reference).split('\n').flatMap((l) => {
    if (l.length <= 120) return [l];
    const out = []; let cur = '';
    for (const w of l.split(/\s+/)) { if ((cur + ' ' + w).length > 80 && cur) { out.push(cur); cur = w; } else cur = cur ? `${cur} ${w}` : w; }
    if (cur) out.push(cur); return out;
  }).map(norm).filter(Boolean).sort((a, b) => b.length - a.length);
  const H = [...norm(stripFurniture(hyp))];
  const used = new Uint8Array(H.length);
  const refChars = lines.reduce((a, l) => a + l.length, 0);
  if (!refChars) return { fca: null, ref_chars: 0 };
  let dist = 0;
  for (const line of lines) {
    const R = [...line], m = H.length;
    let prev = new Int32Array(m + 1), prevS = new Int32Array(m + 1).map((_, j) => j);
    for (let i = 1; i <= R.length; i++) {
      const cur = new Int32Array(m + 1), curS = new Int32Array(m + 1);
      cur[0] = i; curS[0] = 0;
      for (let j = 1; j <= m; j++) {
        const eq = !used[j - 1] && R[i - 1] === H[j - 1];
        const sub = prev[j - 1] + (eq ? 0 : 1), del = prev[j] + 1, ins = cur[j - 1] + 1;
        if (sub <= del && sub <= ins) { cur[j] = sub; curS[j] = prevS[j - 1]; } else if (del <= ins) { cur[j] = del; curS[j] = prevS[j]; } else { cur[j] = ins; curS[j] = curS[j - 1]; }
      }
      prev = cur; prevS = curS;
    }
    let best = Infinity, end = 0;
    for (let j = 0; j <= m; j++) if (prev[j] < best) { best = prev[j]; end = j; }
    if (best >= R.length) { dist += R.length; continue; }   // no useful match: the chunk is missing
    dist += best;
    for (let j = prevS[end]; j < end; j++) used[j] = 1;
  }
  const leftover = used.reduce((a, u) => a + (u ? 0 : 1), 0);
  return { fca: Math.max(0, 1 - (dist + leftover) / refChars), ref_chars: refChars, chunk_distance: dist, leftover };
}

/**
 * W-G: what the #7567 arm-c lane SERVES from one correction of a GPU draft written over a stored Flash-Lite draft
 * (cli-ocr.mjs apply, `gpu` + `--over-stored`), restated as servedCorrection is: on any refusal the stored text (the
 * lite draft) stands; else the E3 guards against it (long-s pass, every flagged number / negation / expansion put back
 * to the stored reading; a flag spanning a tag or not like-for-like refuses the page).
 */
export function servedArmc(read, lite, { languages = [], language = '' } = {}) {
  const stand = (outcome, why) => ({ outcome, why, served: lite });
  let text = String(read.text ?? '').trim();
  if (read.exit !== 0) return stand('other', `cli exit ${read.exit}`);
  if (read.wrapper) return stand('other', `reply wrapper: ${read.wrapper}`);
  if (text.length < 5) return stand('other', 'empty read');
  if (/^UNCHANGED\.?$/i.test(text)) return stand('unchanged', 'corrector: UNCHANGED (a headerless GPU draft is not written; the stored text stands)');
  const contain = text.match(/^CONTAIN\s*:\s*([\s\S]+)$/i);
  if (contain && contain[1].length < 600 && !/<page-type>/.test(text)) return stand('contain', 'corrector: CONTAIN');
  if (text.length > 25000) return stand('other', 'over 25k chars');
  if (!/<page-type>/.test(text)) return stand('other', 'no <page-type> tag');
  if ((text.match(/<page-type>/g) || []).length !== 1 || (text.match(/<scan-quality>/g) || []).length > 1) return stand('other', 'more than one transcription header');
  if (REFUSAL.test(text)) return stand('other', 'refusal');
  const chatter = ocrReadProblem(text, { header: true });
  if (chatter) return stand('other', `chatter guard: ${chatter}`);
  if (loopVerdict(text).refuse) return stand('other', 'repetition loop');
  const guard = checkWrittenText(text, { kind: 'ocr' });
  if (guard.verdict === 'truncated') return stand('other', 'write guard: truncated');
  if (guard.verdict === 'repaired_mid') text = guard.repaired;
  if (foreignScriptReason(text, { languages, served: lite })) return stand('other', 'letters outside the book\'s scripts');
  const hand = (text.match(/<script>\s*(\w+)\s*<\/script>/i)?.[1] || '').toLowerCase();
  if (hand !== 'printed') return stand('other', `corrector tags the page <script>${hand || 'none'}</script>: print only`);
  const longWords = (t) => new Set((String(t).replace(/<[^>]+>/g, ' ').replace(/-\n/g, '').toLowerCase().replace(/æ/g, 'ae').replace(/ſ/g, 's').replace(/v/g, 'u').match(/\p{L}{5,}/gu) || []));
  const was = longWords(lite), now = longWords(text);
  const shared = [...now].filter((w) => was.has(w)).length / Math.max(1, now.size);
  if (was.size >= 40 && shared < 0.4) return stand('other', `only ${Math.round(shared * 100)}% of its words are in the stored read`);
  const lang = LANG_OF(language);
  const ls = longSPass(text, { lang, convention: lite });
  const { flags } = correctionDiffs(lite, ls.text, { lang });
  const tagIn = (t, [x, y]) => /[<>]/.test(String(t).slice(x, y));
  if (flags.some((f) => tagIn(lite, f.a) || tagIn(ls.text, f.b))) return stand('other', 'a diff-guard flag spans a tag');
  const nWords = (s) => String(s).split(/\s+/).filter(Boolean).length;
  if (flags.some((f) => !nWords(f.draft) || nWords(f.draft) !== nWords(f.next))) return stand('other', 'a diff-guard flag is not like-for-like');
  const back = applyDiffVerdicts(lite, ls.text, flags, flags.map((f) => ({ i: f.i, winner: 'draft' })));
  const tagShape = (t) => (String(t).match(/<\/?[a-z-]+/g) || []).join(' ');
  if (tagShape(back.text) !== tagShape(ls.text)) return stand('other', 'the put-back changed the tag structure');
  if (back.text.trim() === lite.trim()) return stand('other', 'every change was put back by the diff guard');
  return { outcome: 'written', why: 'written', served: back.text, put_back: back.reverted, flags: flags.length };
}
