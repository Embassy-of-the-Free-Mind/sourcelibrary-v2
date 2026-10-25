/**
 * PRIOR ART: scripts/lib/annotation-tag-repair.mjs (repairAnnotationTags, #5644) and translate-core
 * sanitizeTranslationTags — they REPAIR an unclosed tag wherever it is, so a translation cut off inside a
 * <gloss> is closed and stored as a finished page (#5055: both unclosed translation tags in a 1,065-page
 * draw opened in the last 15% of the text). scripts/eval/lib/quality-census-detectors.mjs rawLeaks counts
 * unclosed and orphan tags over 16 paired tags but judges nothing. scripts/lib/truncated-response.mjs reads
 * the provider's finishReason; scripts/lib/page-integrity.mjs truncationRatio measures a stored translation
 * against its source. None of them is asked before a write, and the OCR writers ask no tag question at all.
 * This file is that question, asked of the RAW model text, before any repair runs.
 *
 * checkWrittenText(text, { kind, source, lang, finishReason, partial }) → { ok, verdict, repaired, reasons, unclosed }
 *
 *   verdict 'ok'            nothing to do; `repaired` is `text`, byte-identical.
 *   verdict 'repaired_mid'  a paired tag never closes, but it opens before the last TAIL_SHARE of the text: the
 *                           model forgot a close. `repaired` closes it (repairAnnotationTags for the annotation tags,
 *                           the same break-point rule for the rest; a line-level tag closes at the end of its line).
 *   verdict 'truncated'     the read was cut off: a paired tag opens in the last TAIL_SHARE and never closes, the
 *                           text ends inside a tag (`…</lang`), the provider said MAX_TOKENS, the CLI returned a
 *                           partial reply (agy at --print-timeout, #6523), or — translation only — the English is
 *                           under LENGTH_FLOOR of its source's reading length in a language whose census allows that
 *                           rule. `ok: false`; the caller writes nothing and records a skip.
 *   verdict 'empty'         nothing but whitespace. `ok: false`.
 *
 * The writers that run this, and what they do on `truncated` (refuse; a CLI reader re-reads once; a Batch lane
 * re-queues once; a second failure is recorded and the page is left as it is): see #5055 and
 * tests/unit/write-text-guard.test.ts.
 */
import { repairAnnotationTags, ANNOTATION_TAGS } from './annotation-tag-repair.mjs';
import { isTruncatedCandidate } from './truncated-response.mjs';
import { truncationRatio, readingLength } from './page-integrity.mjs';
import { parseLanguageField, languageFamily } from './language-normalize.mjs';
import { unwrapHiddenTranslation, hidesPageInMeta } from './hidden-translation.mjs';

/** An opener in the last 15% of the text that never closes is a cut, not a forgotten close (#5055 evidence:
 *  2 of 2 unclosed translation tags opened there; 0 of 3 unclosed OCR tags did). */
export const TAIL_SHARE = 0.15;

// The paired tags of each kind. Translation: rawLeaks' 16 (quality-census-detectors.mjs) plus the three line
// tags sanitizeTranslationTags closes. OCR: the twin — the transcription prompt's metadata and annotation tags.
export const TRANSLATION_PAIRED = ['note', 'margin', 'gloss', 'term', 'insert', 'unclear', 'header', 'page-num', 'image-desc', 'interp',
  'meta', 'summary', 'keywords', 'sig', 'warning', 'vocab', 'heading', 'footnote', 'caption'];
export const OCR_PAIRED = ['margin', 'meta', 'header', 'sig', 'page-num', 'note', 'gloss', 'insert', 'unclear', 'term', 'image-desc', 'interp',
  'vocab', 'warning', 'catchword', 'page-type', 'scan-quality', 'language', 'lang', 'script', 'columns', 'summary', 'keywords', 'heading', 'footnote', 'caption'];
// Tags that hold one line: an unclosed one closes at the end of its line.
const LINE_TAGS = new Set(['header', 'page-num', 'sig', 'catchword', 'page-type', 'scan-quality', 'language', 'lang', 'script', 'columns', 'heading', 'caption']);

/**
 * Translation length floor: English under 0.35× the source's reading length (letters + digits, prose only:
 * page-integrity truncationRatio) is a truncated page — in the languages where 0.35 is under half the census's 5th
 * percentile, so a healthy page essentially never sits there. Census: scripts/eval/results/
 * page-integrity-calibration-2026-09-24.json (3,250 books, 214,219 judged pages; languages with ≥ 200 pages).
 * Left OUT, because their healthy pages reach that low (p05 < 0.70): Hebrew 0.621, Old Norse 0.608, Uzbek 0.667,
 * and every language the census did not measure.
 */
export const LENGTH_FLOOR = 0.35;
export const CENSUS_P05 = Object.freeze({
  latin: 0.798, english: 0.71, german: 0.842, french: 0.861, greek: 0.738, tibetan: 0.975, italian: 0.757,
  sanskrit: 1.072, russian: 0.754, arabic: 1.104, dutch: 0.839, persian: 0.725, syriac: 1.322, chinese: 1.066,
  'church slavonic': 0.938, spanish: 0.949, coptic: 1.175, hindi: 1.192, 'ottoman turkish': 0.92, avestan: 0.871,
});

/** The source language the length rule is judged in, as the census keyed it (audit/page-integrity pageLanguage). */
export function censusLanguage(source, lang) {
  const m = String(source || '').match(/<(?:language|lang)>([^<]{1,40})<\/(?:language|lang)>/i);
  const first = parseLanguageField(m ? m[1] : lang)[0];
  return (languageFamily(first) || 'unknown').toLowerCase();
}

// The blocks that describe the page rather than render it: not counted toward the English's length.
const DESCRIPTION_BLOCKS = /<(meta|summary|keywords|vocab|warning|image-desc|header|page-num|sig|folio|catchword)\b[^>]*>[\s\S]*?<\/\1>/gi;
const END_BLOCK = /<(vocab|summary|keywords)\b[^>]*>[\s\S]*?<\/\1>/i;
const TAG_RE = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)(?:\s[^<>]*?)?\s*(\/?)>/g;

/**
 * Openers of `names` that no close of the same name follows (a stack per name, as validateTranslationTags pairs). A
 * close with no opener of its own name that comes while another tag is open is that tag's mis-named close — the
 * `<unclear>pertiwi</term>` repairAnnotationTags rewrites (#5644 rule 2) — and closes the latest open tag, so a verse
 * page that ends on one is not read as cut off.
 */
export function unclosedTags(text, names) {
  const want = new Set(names);
  const stacks = new Map();
  const open = []; // every unclosed opener, in text order
  for (const m of String(text).matchAll(TAG_RE)) {
    const name = m[2].toLowerCase();
    if (!want.has(name) || m[3] === '/') continue;
    const st = stacks.get(name) || [];
    stacks.set(name, st);
    if (m[1] !== '/') { const o = { name, index: m.index, length: m[0].length }; st.push(o); open.push(o); continue; }
    const o = st.length ? st.pop() : open[open.length - 1];
    if (!o) continue; // an orphan close: the reader drops it
    if (o.name !== name) stacks.get(o.name).pop();
    open.splice(open.lastIndexOf(o), 1);
  }
  return open;
}

/** Close the unclosed openers that repairAnnotationTags does not know (header, meta, vocab, …). */
function closeOthers(text, names) {
  const open = unclosedTags(text, names.filter((n) => !ANNOTATION_TAGS.includes(n)));
  if (!open.length) return text;
  const ins = open.map((t) => {
    const after = t.index + t.length, rest = text.slice(after);
    const breaks = LINE_TAGS.has(t.name) ? [rest.search(/\n/)] : [rest.search(/<summary>/i), rest.search(/<keywords>/i), rest.search(/<meta>/i), rest.search(/\n\n/)];
    const hits = breaks.filter((i) => i >= 0);
    return { at: hits.length ? after + Math.min(...hits) : text.length, close: `</${t.name}>` };
  }).sort((a, b) => b.at - a.at);
  let out = text;
  for (const { at, close } of ins) out = out.slice(0, at) + close + out.slice(at);
  return out;
}

/**
 * @param {string} text  the model's text as it came back, before any tag repair
 * @param {{ kind: 'ocr'|'translation', source?: string, lang?: string, type?: string,
 *           finishReason?: string|null, partial?: boolean }} opts
 *   source: the OCR the translation was made from (arms the length rule); lang: the book's language;
 *   finishReason: the provider's, when the caller has it; partial: the CLI said the reply is partial.
 */
export function checkWrittenText(text, { kind, source, lang, type, finishReason, partial } = {}) {
  if (kind !== 'ocr' && kind !== 'translation') throw new Error(`checkWrittenText: kind must be 'ocr' or 'translation', not ${kind}`);
  const t = typeof text === 'string' ? text : '';
  if (!/\S/.test(t)) return { ok: false, verdict: 'empty', repaired: t, reasons: ['empty'], unclosed: [] };
  const names = kind === 'ocr' ? OCR_PAIRED : TRANSLATION_PAIRED;
  const reasons = [];
  if (partial) reasons.push('partial-reply');
  if (finishReason && isTruncatedCandidate({ finishReason })) reasons.push(`finish:${String(finishReason).toUpperCase()}`);
  const body = t.replace(/\s+$/, '');
  // Cut inside a tag: `…<language>Ancient Greek</` (truncated-response.mjs, #5813) or `…<gloss`.
  // A tag fragment on the last line, not a `<` anywhere with no `>` after it: an archive OCR with a stray `<k` mid-page
  // is not cut off.
  if (/<\/?(?:[a-zA-Z][a-zA-Z0-9-]*(?:\s[^<>\n]{0,80})?)?$/.test(body)) reasons.push('ends-inside-a-tag');
  const unclosed = unclosedTags(body, names);
  const tailFrom = body.length * (1 - TAIL_SHARE);
  // A reply that went on to write its closing apparatus (<vocab>, <summary>, <keywords>) after the open tag finished:
  // the tag is a forgotten close (a Chinese play's role marker, `<gloss>上命…` then `<vocab>…</vocab>`), not a cut.
  const finishedAfter = (u) => END_BLOCK.test(body.slice(u.index + u.length));
  const tail = unclosed.filter((u) => u.index >= tailFrom && !finishedAfter(u));
  if (tail.length) reasons.push(`unclosed-at-tail:${tail.map((u) => u.name).join(',')}`);
  if (kind === 'translation' && source) {
    const l = censusLanguage(source, lang);
    const p05 = CENSUS_P05[l];
    // Measured on the English as the door will store it: a page the model wrapped whole in a <note> is unwrapped there
    // (#5148), and one whose text sits in its continuity <meta> is refused there under its own name (#5376).
    if (p05 && LENGTH_FLOOR < p05 / 2 && !hidesPageInMeta(t)) {
      const tr = unwrapHiddenTranslation({ ocr: source, tr: t, type }).text;
      const r = truncationRatio({ ocr: source, tr, type });
      // truncationRatio leaves the English's notes out, which the census needed and a write gate cannot afford: a page
      // whose printed footnotes come back as <note>s is complete. The floor is held to the English WITH its notes,
      // margins and footnotes (only the page-description blocks out); the census ratio is kept for the record.
      const withNotes = r.judged ? readingLength(tr.replace(DESCRIPTION_BLOCKS, ' ').replace(/<\/?[a-zA-Z][^<>]*>/g, ' ')) / r.src : null;
      if (r.judged && withNotes < LENGTH_FLOOR) reasons.push(`short:${+withNotes.toFixed(3)}<${LENGTH_FLOOR}(${l})`);
    }
  }
  const info = unclosed.map((u) => ({ name: u.name, at: +(u.index / body.length).toFixed(3) }));
  if (reasons.length) return { ok: false, verdict: 'truncated', repaired: t, reasons, unclosed: info };
  if (!unclosed.length) return { ok: true, verdict: 'ok', repaired: t, reasons: [], unclosed: [] };
  const repaired = closeOthers(repairAnnotationTags(t), names);
  return { ok: true, verdict: 'repaired_mid', repaired, reasons: [`unclosed-mid:${unclosed.map((u) => u.name).join(',')}`], unclosed: info };
}

/** The skip reason a writer records for a refused text: `write-guard:truncated:<first reason>`. */
export const writeGuardReason = (v) => `write-guard:${v.verdict}${v.reasons?.[0] ? `:${v.reasons[0].replace(/[:(].*$/, '')}` : ''}`;
