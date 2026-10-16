/**
 * PRIOR ART: scripts/eval/g4-reread-pilot-6769/score.mjs (the #6769 pilot's A/B scorer — it reports, it decides
 * nothing; the verdict rule here maps its key + verdicts the same way); scripts/lib/stray-script.mjs (script of a
 * letter, scripts of a language label — reused below; its guard judges ENGLISH translations, not transcriptions);
 * scripts/batch/claude-ocr-two-read.mjs `--replace-lite-books` (the other lift of the 40% shared-words floor, by
 * book list, with no per-book judged sample). None decides whether a re-read lane may replace a book's stored text.
 *
 * The per-book gate of a re-read lane (#6769), and two page rules every `cli-ocr.mjs apply` keeps.
 *
 * WHY A GATE IN PLACE OF THE FLOOR. `cli-ocr.mjs apply` refuses a read sharing under 40% of its words with the stored
 * text. That compares the new read against the bad read it is meant to replace: on Grec 1841 it refused 350 of 355
 * pages that a blind judge preferred 29/30 times (0 worse). For a lane named on the command line, a BOOK passes or
 * fails instead: 30 random pages, G4L vs served, judged blind against the page image (Opus through `claude -p`, order
 * randomised, markup stripped; scripts/eval/g4-reread-pilot-6769/draw.mjs + judge.py), plus 5 planted-error controls.
 * The book passes only with 0 worse and every control caught. A gate made from a read directory is bound to it: the
 * judged pages' read hashes are in the gate file, and apply refuses the run if any no longer matches.
 *
 * FITTED TEXT. A page whose text is an open edition fitted to the scan (Sefaria #5560, Esukhia Derge #5497, CBETA
 * #5566 — `pageTextSource()` in src/lib/text-provenance.ts) is not a reading of the leaf, and the pilot's judge
 * preferred it to G4L 5/5. No re-read overwrites it.
 *
 * FOREIGN SCRIPT. #6560: a Tibetan correction came back with Kannada letters in it. A read carrying 3+ letters of a
 * script that is neither Latin, nor the book's language's, nor a real share (>= 2%) of the stored text, is refused.
 */
import { createHash } from 'node:crypto';
import { scriptOf, scriptsOfLanguage } from './stray-script.mjs';

export const GATE_SCHEMA = 'reread-lane-gate/1';
export const GATE_RULE = Object.freeze({ sample: 30, controls: 5, max_worse: 0, min_sample: 10 });

/** `ocr.source` values whose text is an open edition fitted to the scan, not read from it. */
export const FITTED_TEXT_SOURCES = Object.freeze(['sefaria', 'esukhia-derge-tengyur', 'esukhia-derge-kangyur', 'cbeta-xml-p5']);

/** Why this page's stored text must not be overwritten by a re-read, or null. */
export function fittedTextReason(ocr) {
  if (!ocr) return null;
  if (FITTED_TEXT_SOURCES.includes(ocr.source)) return `fitted open edition (ocr.source ${ocr.source})`;
  if (ocr.text_source) return `fitted open edition (ocr.text_source ${ocr.text_source.name ?? '?'})`;
  if (ocr.text_edition) return `fitted open edition (ocr.text_edition ${ocr.text_edition.name ?? '?'})`;
  return null;
}

/** Letters per non-Latin script in `text` (Latin, Common and Inherited are not counted). */
export function scriptLetterCounts(text) {
  const out = {};
  for (const ch of String(text || '')) {
    const s = scriptOf(ch);
    if (s) out[s] = (out[s] || 0) + 1;
  }
  return out;
}
const letterCount = (text) => (String(text || '').match(/\p{L}/gu) || []).length;

/**
 * The scripts a read of this page may carry: the book's language labels' scripts, and any script that is at least
 * 2% of the stored text's letters. Latin is always allowed (headers, sigla, page-format tags).
 * @param {{ languages?: string[], served?: string }} ctx
 */
export function expectedScripts({ languages = [], served = '' } = {}) {
  const out = new Set();
  for (const l of languages) for (const s of scriptsOfLanguage(l)) out.add(s);
  const n = letterCount(served);
  for (const [s, k] of Object.entries(scriptLetterCounts(served))) if (n && k / n >= 0.02) out.add(s);
  return out;
}

/** A read with 3+ letters of an unexpected script: the reason string, else null. */
export function foreignScriptReason(text, ctx = {}, { minLetters = 3 } = {}) {
  const expected = expectedScripts(ctx);
  const foreign = Object.entries(scriptLetterCounts(text)).filter(([s]) => !expected.has(s));
  const n = foreign.reduce((t, [, k]) => t + k, 0);
  if (n < minLetters) return null;
  return `letters outside the book's scripts: ${foreign.map(([s, k]) => `${s} ${k}`).join(', ')}`;
}

/** The book's language labels, every field that names one. */
export const bookLanguages = (book) => [book?.language, book?.original_language, ...(Array.isArray(book?.languages) ? book.languages : [])].filter((x) => typeof x === 'string' && x);

export const sha256 = (s) => createHash('sha256').update(s).digest('hex');

/**
 * The gate verdict for one book from draw.mjs's key and judge.py's verdict rows.
 * @param {{ key: object, frame: number }} keyFile   draw.mjs key.json
 * @param {Array<{uid: string, verdict: object|null}>} rows   judge.py verdicts.jsonl rows
 */
export function gateVerdict(keyFile, rows, rule = GATE_RULE) {
  const last = new Map();
  for (const r of rows) if (r.verdict || !last.get(r.uid)?.verdict) last.set(r.uid, r);
  const sample = { n: 0, better: 0, same: 0, worse: 0, unjudged: 0, pages: [] };
  const controls = { n: 0, pass: 0, same: 0, fail: 0, unjudged: 0, pages: [] };
  for (const [uid, k] of Object.entries(keyFile.key || {})) {
    const v = last.get(uid)?.verdict;
    const who = v ? (v.verdict === 'same' ? 'same' : k[v.verdict]) : null;
    if (k.kind === 'control') {
      controls.n++;
      const res = !v ? 'unjudged' : who === 'clean' ? 'pass' : who === 'same' ? 'same' : 'fail';
      controls[res]++;
      controls.pages.push({ page_id: k.page_id, page_number: k.page_number, result: res });
    } else {
      sample.n++;
      const res = !v ? 'unjudged' : who === 'g4l' ? 'better' : who === 'same' ? 'same' : 'worse';
      sample[res]++;
      sample.pages.push({ page_id: k.page_id, page_number: k.page_number, result: res, served_source: k.served_source ?? null, ...(k.read_hash && { read_hash: k.read_hash }) });
    }
  }
  const want = Math.min(rule.sample, keyFile.frame ?? sample.n);
  let reason = null;
  if ((keyFile.frame ?? 0) < rule.min_sample || sample.n < rule.min_sample) reason = `too few pages to judge (frame ${keyFile.frame ?? 0}, sample ${sample.n}; need ${rule.min_sample})`;
  else if (sample.n < want) reason = `sample ${sample.n} < ${want}`;
  else if (sample.unjudged || controls.unjudged) reason = `unjudged: ${sample.unjudged} sample, ${controls.unjudged} controls`;
  else if (controls.n < rule.controls) reason = `${controls.n} controls < ${rule.controls}`;
  else if (controls.pass < controls.n) reason = `controls ${controls.pass}/${controls.n} caught: the judge cannot be trusted on this book`;
  else if (sample.worse > rule.max_worse) reason = `G4L worse than served on ${sample.worse}/${sample.n} pages`;
  return { pass: !reason, reason, rule: { ...rule }, sample, controls };
}

/**
 * Check a gate file against the run that is about to use it. Returns a reason it cannot be used, or null.
 * `readHash(page_id)` gives the content hash of the read now in the directory (null when absent).
 */
export function gateUsable(gate, { lane, bookId, model, readHash }) {
  if (!gate || gate.schema !== GATE_SCHEMA) return 'not a reread-lane-gate/1 file';
  if (gate.lane !== lane) return `gate is for lane ${gate.lane}, not ${lane}`;
  if (gate.book_id !== bookId) return `gate is for book ${gate.book_id}`;
  if (gate.model !== model) return `gate judged ${gate.model} reads, not ${model}`;
  if (!gate.pass) return `gate failed: ${gate.reason}`;
  for (const p of gate.sample?.pages || []) {
    if (!p.read_hash) return `gate sample page ${p.page_number} carries no read hash`;
    if (readHash(p.page_id) !== p.read_hash) return `the read of judged page ${p.page_number} changed after the gate`;
  }
  return null;
}

/** The part of a gate written into each page's provenance (`engine.input.lane_gate`). */
export const gateProvenance = (gate) => ({
  schema: gate.schema, lane: gate.lane, pass: gate.pass, at: gate.at, rule: gate.rule,
  sample: { n: gate.sample.n, better: gate.sample.better, same: gate.sample.same, worse: gate.sample.worse, pages: gate.sample.pages.map((p) => p.page_number) },
  controls: { n: gate.controls.n, caught: gate.controls.pass },
  judge: gate.judge, key_sha256: gate.key_sha256, verdicts_sha256: gate.verdicts_sha256,
});
