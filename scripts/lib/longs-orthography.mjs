/**
 * PRIOR ART: scripts/eval/latin-longs-pass-5924/longs-pass.mjs (the measured pass, #7174 — imported, not copied, so
 * the code that is applied is the code that was scored); scripts/lib/page-text-writer.mjs (the one writer of page text,
 * #7058 — its row shape, compare-and-set and human-edit filter are reused here); scripts/maintenance/dehyphenate-ia-ocr.mjs
 * and repair-number-word-joins-4784.mjs (rewrite stored text, but stamp ocr.updated_at, so their pages go stale — the
 * thing this module exists not to do); scripts/lib/language-content-classify.mjs (classifies a whole page's language,
 * not a line inside a Latin page, and has no German-with-long-s-as-f forms); scripts/lib/latin-morphology.mjs foldLongS
 * (a recall-first MATCHING fold for names — every f → s, callers try both spellings; it cannot decide which f is a
 * misread ſ, so it cannot write text. Its header now points here for text repair).
 *
 * longs-orthography.mjs — put the long s (ſ) back into stored Latin OCR WITHOUT making its translation stale (#5924).
 *
 * ── Why a separate write path ────────────────────────────────────────────────
 * Translation staleness is decided from one clock: `ocr.updated_at` newer than `translation.updated_at`
 * (scripts/lib/stale-translation.mjs). Gap-fill, the stale marker, the embeddings watermark and the Supabase mirror all
 * key on it, and tests/unit/ocr-write-stamps-updated-at.test.ts makes every OCR writer stamp it. That rule is right for a
 * new READING. It is wrong for this edit: ſ and s are one letter, so the English made from the f-text is exactly as
 * right after the edit as before. Stamping the clock would queue ~1M pages for paid retranslation.
 *
 * So the clock is left alone, and the exception is made SAFE BY CONSTRUCTION rather than by care:
 * `assertOrthographicOnly(prior, next)` throws unless the two texts have the same code points except f → ſ, and
 * `orthographicOcrValue` / `writeOrthographicOcr` call it on every page. A caller cannot use this path to write any
 * other change, so it cannot make a stale translation look fresh. (tests/unit/longs-orthography.test.ts)
 *
 * Every write goes through writePageText (#7058): a `page_revisions` row with the whole prior `ocr` object, `by`,
 * `reason`, `run_id`, `prior_hash`/`next_hash` (so revert-run.mjs undoes a run), and the row's `source` is the sweep
 * label, so the pass is never read as a second OCR (data-provenance.md). Compare-and-set on the prior text, human edits
 * refused, and a page changed since the pass read it refused too (`expect_prior_hash`).
 *
 * ── What the pass may touch ──────────────────────────────────────────────────
 * The measured pass changes f → ſ anywhere in a text. Here its output is cut back to:
 *   • body text only — never tag names, and never the contents of the English/metadata tags (image-desc, warning, note,
 *     vocab, meta, language, script, …) or of a short [bracketed] editorial note;
 *   • lower-case tokens — a capitalised token is a proper name as often as not (the #7174 losses: Offa, Harpesfildus);
 *   • Latin lines — a line whose neighbourhood carries vernacular function words (German, Italian, French, Spanish,
 *     English, Dutch; German including its own ſ-as-f forms, ift/fich/fie) keeps every f.
 * Gates above the line (page Latin share, script not gothic/Fraktur/manuscript, book language) are here too, so the
 * sweep and the gate check use one definition.
 */

import { pass as rawPass, Model, fold } from '../eval/latin-longs-pass-5924/longs-pass.mjs';
import { contentHash } from './write-provenance.mjs';
import { writePageText, fieldText, textHash, isHumanEditedField } from './page-text-writer.mjs';

export { Model };

/** The `page_revisions.source` / `sweep_log.sweep` label. One id for the pass. */
export const LONGS_SWEEP = 'longs-pass-5924';
export const LONGS_REASON = 'long-s pass (#5924): f → ſ only, orthographic, translation unaffected';

// ── protected spans ──────────────────────────────────────────────────────────

/** Tags whose CONTENTS are not printed Latin (English descriptions, metadata, labels). */
export const PROTECTED_TAGS = Object.freeze([
  'scan-quality', 'language', 'script', 'page-type', 'page-num', 'columns', 'meta', 'vocab', 'warning', 'image-desc',
  'note', 'detected-images', 'split-position', 'lang', 'sig', 'num', 'numeral', 'catchword', 'signature', 'unclear',
  'foreign', 'greek', 'hebrew',
]);
const PROTECTED_RE = new RegExp(`<(${PROTECTED_TAGS.join('|')})(?:\\s[^>]*)?>[\\s\\S]*?</\\1>`, 'g');

/** Per UTF-16 index: true where the pass may not write. Tag markup, protected tag contents, short [notes]. */
export function protectedMask(text) {
  const m = new Uint8Array(text.length);
  const mark = (a, b) => { for (let i = a; i < b; i++) m[i] = 1; };
  for (const x of text.matchAll(PROTECTED_RE)) mark(x.index, x.index + x[0].length);
  for (const x of text.matchAll(/<[^<>\n]{0,200}>/g)) mark(x.index, x.index + x[0].length);
  for (const x of text.matchAll(/\[[^\[\]\n]{0,200}\]/g)) mark(x.index, x.index + x[0].length);
  // an unclosed protected tag (a cut-off read) protects to the end of the text
  for (const x of text.matchAll(new RegExp(`<(${PROTECTED_TAGS.join('|')})(?:\\s[^>]*)?>`, 'g'))) {
    if (!text.slice(x.index).includes(`</${x[1]}>`)) mark(x.index, text.length);
  }
  return m;
}

// ── language ─────────────────────────────────────────────────────────────────

/** Latin function words, folded (ſ→s, v→u, j→i), plus the f-forms lite writes for them. None is common in the vernaculars below. */
export const LATIN_MARKERS = new Set([
  'est', 'sunt', 'ad', 'cum', 'quod', 'ut', 'sed', 'enim', 'autem', 'uel', 'aut', 'etiam', 'nec', 'neque', 'quae', 'quam',
  'quia', 'hoc', 'haec', 'eius', 'esse', 'ab', 'ex', 'sic', 'tamen', 'ergo', 'igitur', 'atque', 'ac', 'inter', 'apud',
  'sine', 'nam', 'quoque', 'ita', 'quidem', 'nihil', 'omnia', 'omnes', 'sua', 'suo', 'suis', 'eorum', 'ille', 'illa',
  'ipse', 'ipsa', 'quibus', 'cuius', 'unde', 'ubi', 'siue', 'seu', 'post', 'ante', 'propter', 'erat', 'fuit', 'quo',
  'qua', 'quos', 'eo', 'ea', 'id', 'eum', 'eam', 'iam', 'tum', 'tunc', 'nunc', 'quasi', 'secundum', 'sicut', 'uero',
  'eft', 'funt', 'fed', 'effe', 'fic', 'fua', 'fuo', 'fuis', 'ipfe', 'ipfa', 'quafi', 'fecundum', 'ficut', 'fiue', 'feu',
]);
/** Function words of the vernaculars printed beside Latin, folded; German with its ſ-as-f forms. */
export const VERNACULAR_MARKERS = new Set([
  // German
  'der', 'das', 'und', 'unnd', 'ist', 'ift', 'nicht', 'nit', 'mit', 'von', 'zu', 'zum', 'zur', 'den', 'dem', 'ein', 'eine',
  'einen', 'einer', 'sich', 'fich', 'auch', 'auff', 'auf', 'daß', 'dass', 'wie', 'wird', 'werden', 'sind', 'aus', 'auß',
  'bey', 'bei', 'ich', 'sie', 'fie', 'wir', 'ihr', 'man', 'oder', 'als', 'wann', 'wenn', 'dann', 'denn', 'durch', 'welche',
  'seine', 'feine', 'sein', 'fein', 'nach', 'vom', 'hat', 'haben', 'solche', 'folche', 'diese', 'diefe', 'kan',
  'über', 'unter', 'gegen', 'noch', 'so', 'fo', 'also', 'alfo', 'gar', 'wol', 'wo', 'mehr', 'gott', 'herr',
  // Italian
  'il', 'lo', 'gli', 'che', 'della', 'delle', 'dello', 'del', 'nella', 'nel', 'questo', 'questa', 'piu', 'anche',
  'come', 'essere', 'perche', 'molto', 'alla', 'alle', 'dalla', 'degli', 'hanno', 'cosi',
  // French
  'les', 'des', 'du', 'dans', 'pour', 'auec', 'avec', 'sont', 'cette', 'pas', 'sur', 'leur', 'nous', 'vous', 'elle',
  'ont', 'au', 'aux', 'luy', 'lui', 'mais', 'tout',
  // Spanish / Portuguese
  'el', 'los', 'las', 'para', 'por', 'muy', 'pero', 'como', 'esta', 'nao',
  // English
  'the', 'and', 'of', 'to', 'which', 'that', 'with', 'this', 'from', 'have', 'were', 'by', 'not',
  // Dutch
  'het', 'een', 'niet', 'ende', 'zijn', 'wordt', 'ook', 'van',
]);

const WORDS = /[\p{L}\p{M}]+/gu;
const foldW = (w) => fold(w);

/**
 * { latin, vernacular } marker counts in a string (tags and protected spans should be removed by the caller). The first
 * and last word of each line are not counted: early print breaks words at the line end with no hyphen as often as with
 * one, and the halves (du-, au-, il-, -dem, -des, man-) are vernacular words by spelling. Measured on the census pages:
 * counted, they put a vernacular marker on most Latin lines.
 */
export function markerCounts(s) {
  let latin = 0, vernacular = 0;
  for (const line of String(s).split('\n')) {
    const ws = line.match(WORDS) || [];
    for (let i = 1; i < ws.length - 1; i++) {
      const w = foldW(ws[i]);
      if (LATIN_MARKERS.has(w)) latin++;
      else if (VERNACULAR_MARKERS.has(w)) vernacular++;
    }
  }
  return { latin, vernacular };
}

/** The text with tags, protected tag contents and [notes] blanked (same length), for counting. */
export function bodyOnly(text) {
  const m = protectedMask(text); let o = '';
  for (let i = 0; i < text.length; i++) o += m[i] ? (text[i] === '\n' ? '\n' : ' ') : text[i];
  return o;
}

export const PAGE_GATE = Object.freeze({ minLatin: 8, minShare: 0.85 });
export const BOOK_GATE = Object.freeze({ minLatin: 60, minShare: 0.9 });
export const share = ({ latin, vernacular }) => (latin + vernacular ? latin / (latin + vernacular) : 0);

/** Does the page read as Latin? { ok, reason, latin, vernacular } */
export function pageLatinVerdict(text, gate = PAGE_GATE) {
  const c = markerCounts(bodyOnly(text));
  if (c.latin < gate.minLatin) return { ok: false, reason: 'too_few_latin_markers', ...c };
  if (share(c) < gate.minShare) return { ok: false, reason: 'vernacular_share', ...c };
  return { ok: true, ...c };
}

/** Scripts the pass was not measured on (#7174: 2 of its 3 losses were gothic; the 1400s need their own measurement). */
export const UNMEASURED_SCRIPT = /gothic|black.?letter|fraktur|textura|rotunda|schwabacher|bastarda|manuscript|handwrit|cursive/i;
export function pageScriptVerdict(text) {
  const s = (String(text).match(/<script>([^<]*)<\/script>/) || [])[1] || '';
  return UNMEASURED_SCRIPT.test(s) ? { ok: false, reason: 'unmeasured_script', script: s } : { ok: true, script: s };
}

// ── does this page write ſ as f? ─────────────────────────────────────────────

/**
 * Common Latin words whose s-spelling and f-spelling are both unambiguous: the f-form is never a Latin word. A page's
 * ratio f / (f + s) over these says whether its reader wrote ſ as f (lite does it page by page, #7171; flash on some
 * books, #5924 spot check). Folded forms.
 */
export const HABIT_PAIRS = Object.freeze([
  ['est', 'eft'], ['sunt', 'funt'], ['esse', 'effe'], ['sed', 'fed'], ['ipse', 'ipfe'], ['quasi', 'quafi'],
  ['potest', 'poteft'], ['sic', 'fic'], ['sua', 'fua'], ['suo', 'fuo'], ['suum', 'fuum'], ['suis', 'fuis'],
  ['nisi', 'nifi'], ['post', 'poft'], ['sibi', 'fibi'], ['semper', 'femper'], ['sub', 'fub'], ['ista', 'ifta'],
  ['iste', 'ifte'], ['secundum', 'fecundum'], ['super', 'fuper'], ['supra', 'fupra'], ['causa', 'caufa'],
  ['ipsa', 'ipfa'], ['ipsum', 'ipfum'], ['eius', 'eius'],
].filter(([s, f]) => s !== f));
const HABIT_S = new Map(HABIT_PAIRS.map(([s]) => [s, 1]));
const HABIT_F = new Map(HABIT_PAIRS.map(([, f]) => [f, 1]));
export const HABIT_MIN_RATIO = 0.5;
export const HABIT_MIN_F = 2;

/** { f, s, ratio, habit } over the page body. `habit`: the page writes ſ as f, so every f is suspect. */
export function pageHabit(text) {
  let f = 0, s = 0;
  for (const m of bodyOnly(String(text)).match(WORDS) || []) { const w = foldW(m); if (HABIT_F.has(w)) f++; else if (HABIT_S.has(w)) s++; }
  const ratio = f + s ? f / (f + s) : 0;
  return { f, s, ratio: +ratio.toFixed(3), habit: f >= HABIT_MIN_F && ratio >= HABIT_MIN_RATIO };
}

/**
 * Is the f-spelling a real word, not just residue? Our own flash text still carries some ſ-as-f (fe 1,497, nifi 71,
 * poft 23 in 37M tokens), so a bare count is the wrong test. Real: in the lexicon at all (≥ ATTESTED_MIN; the lexicon
 * keeps words seen twice) AND at least ATTESTED_SHARE as often as the ſ-reading the pass chose. fit/sit 21,433/90,680,
 * fine/sine, fui/sui, fatis/satis 470/12,162, infectatur/insectatur 2/64 are real; eft (0), nifi (71/40,467),
 * fe (1,497/84,735) are not. ATTESTED_MIN was 20 until gate round 2, where infectatur → inſectatur (2 vs 64) and
 * flāte → ſlāte (10 vs 19) were the two meaning changes.
 */
export const ATTESTED_MIN = 2;
export const ATTESTED_SHARE = 0.02;
export function isAttestedF(model, fToken, sToken) {
  const cf = model.count(fold(fToken)), cs = model.count(fold(sToken));
  return cf >= ATTESTED_MIN && cf >= ATTESTED_SHARE * cs;
}

// ── the pass, cut back ───────────────────────────────────────────────────────

/**
 * Apply the measured pass to one OCR text, then keep only the changes it may make here. The pass decides where an f is
 * a misread ſ; this keeps that decision only where the f-spelling is NOT a real word (isAttestedF): eft → eſt, nifi →
 * niſi, ftupidus → ſtupidus yes; fit → ſit, fine → ſine, fui → ſui never, whatever the context, because there the
 * edit would turn one word into another. An f-form seen ≥ ATTESTED_MIN times before a full stop is an abbreviation and
 * keeps its f (fi. and fig. for figura, fol.). Both rules came from the by-eye gate (#5924): on 20 flash pages the
 * pass alone was right on 747 of 756 changes, and all 8 wrong ones were `fit → ſit` (×2) or `fi.` → `ſi.` (×6).
 * `habit` (pageHabit) is reported, not used: it did not separate those errors (both fit errors were on habit pages).
 * Never before r, nor word-initially before l (no Latin sr / initial sl); never a ≤ 3-letter word ending a line that the
 * next line continues in lower case (fe|stiue: half a word broken without a hyphen).
 * Returns { text, kept, habit, reverted: { protected, capitalised, cluster, vernacular_line, attested, abbreviation, line_fragment } }.
 */
export function applyLongS(text, model) {
  const src = String(text || '');
  const raw = rawPass(src, model).text;
  const habit = pageHabit(src);
  const empty = { protected: 0, capitalised: 0, cluster: 0, vernacular_line: 0, attested: 0, abbreviation: 0, line_fragment: 0 };
  if (raw === src) return { text: src, kept: 0, habit, reverted: empty };
  const mask = protectedMask(src);
  // line verdicts: a line keeps its f if it carries two vernacular markers, or it and its neighbours carry two or more
  // and at least as many as Latin ones. One marker is not enough: abbreviation and line-break fragments (au, il, lo, du) spell them.
  const body = bodyOnly(src); const lines = body.split('\n'); const counts = lines.map(markerCounts);
  const lineBad = counts.map((_, i) => {
    let l = 0, v = 0;
    for (let j = Math.max(0, i - 1); j <= Math.min(lines.length - 1, i + 1); j++) { l += counts[j].latin; v += counts[j].vernacular; }
    return counts[i].vernacular >= 2 || (v >= 2 && v >= l);
  });
  const lineOf = new Int32Array(src.length); { let ln = 0; for (let i = 0; i < src.length; i++) { lineOf[i] = ln; if (src[i] === '\n') ln++; } }
  // tokens, hyphen-joined across a line end the way the pass joins them: per index, the token's verdict
  //   1 capitalised · 2 the f-form is a real word · 3 an f-form seen ≥ ATTESTED_MIN times, before '.' (an abbreviation)
  //   4 a ≤ 3-letter word at a line end, continued in lower case (maybe half a word)
  const tokVerdict = new Uint8Array(src.length);
  { const spans = []; const re = /[\p{L}\p{M}]+/gu; let m; while ((m = re.exec(src))) spans.push([m.index, m.index + m[0].length]);
    for (let i = 0; i < spans.length; i++) {
      const parts = [spans[i]];
      while (i + 1 < spans.length && /^[-¬⸗=]\s*\n\s*$/.test(src.slice(parts[parts.length - 1][1], spans[i + 1][0]))) parts.push(spans[++i]);
      const rawTok = parts.map(([a, b]) => src.slice(a, b)).join('');
      const end = parts[parts.length - 1][1];
      const outTok = parts.map(([a, b]) => raw.slice(a, b)).join('');
      if (outTok === rawTok) continue;
      // a short word ending a line, the next line going on in lower case, is as likely the first half of a word broken
      // with no hyphen (fe|stiue, gate round 3) as a word: its f is not judged
      const brk = src.slice(end).match(/^[ \t]*\n\s*(\p{L})/u);
      const v = /^\p{Lu}/u.test(rawTok) ? 1
        : src[end] === '.' && model.count(fold(rawTok)) >= ATTESTED_MIN ? 3
        : isAttestedF(model, rawTok, outTok) ? 2
        : brk && /\p{Ll}/u.test(brk[1]) && [...rawTok].length <= 3 ? 4 : 0;
      if (v) for (const [a, b] of parts) for (let k = a; k < b; k++) tokVerdict[k] = v;
    } }
  const out = raw.split(''); const rev = { ...empty }; let kept = 0;
  const why = [null, 'capitalised', 'attested', 'abbreviation', 'line_fragment'];
  for (let i = 0; i < src.length; i++) {
    if (out[i] === src[i]) continue;
    if (mask[i]) { out[i] = src[i]; rev.protected++; continue; }
    // Latin has no "sr", and no word starts "sl": an f there is an f (fr-, fl- ligatures; "Choro flante", gate round 2)
    if (/r/i.test(src[i + 1] || '') || (/l/i.test(src[i + 1] || '') && !/[\p{L}\p{M}]/u.test(src[i - 1] || ''))) { out[i] = src[i]; rev.cluster++; continue; }
    if (tokVerdict[i]) { out[i] = src[i]; rev[why[tokVerdict[i]]]++; continue; }
    if (lineBad[lineOf[i]]) { out[i] = src[i]; rev.vernacular_line++; continue; }
    kept++;
  }
  const next = out.join('');
  assertOrthographicOnly(src, next);
  return { text: next, kept, habit, reverted: rev };
}

// ── the guarantee ────────────────────────────────────────────────────────────

/**
 * Throws unless `next` is `prior` with zero or more lower-case f replaced by ſ and nothing else changed — the only edit
 * this path may write without stamping `ocr.updated_at`. Compared by code point, so a length change of any kind throws.
 * Returns the number of f → ſ substitutions.
 */
export function assertOrthographicOnly(prior, next) {
  if (typeof prior !== 'string' || typeof next !== 'string') throw new TypeError('assertOrthographicOnly: both texts must be strings');
  const a = [...prior], b = [...next];
  if (a.length !== b.length) throw new Error(`orthographic-only edit changed the length (${a.length} → ${b.length} code points)`);
  let n = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue;
    if (a[i] === 'f' && b[i] === 'ſ') { n++; continue; }
    throw new Error(`orthographic-only edit changed ${JSON.stringify(a[i])} → ${JSON.stringify(b[i])} at code point ${i}; only f → ſ is allowed`);
  }
  return n;
}

/**
 * The new `ocr` object: the prior object, every key kept — `updated_at` included, deliberately — with `data` replaced
 * and `content_hash` recomputed for the new text. Throws on anything but an f → ſ edit or a human-edited field.
 */
export function orthographicOcrValue(priorOcr, nextText) {
  if (!priorOcr || typeof priorOcr !== 'object' || typeof priorOcr.data !== 'string') throw new TypeError('orthographicOcrValue: prior ocr must be an object with string data');
  if (isHumanEditedField(priorOcr)) throw new Error('orthographicOcrValue: refusing a human-edited transcription');
  assertOrthographicOnly(priorOcr.data, nextText);
  return { ...priorOcr, data: nextText, content_hash: contentHash(nextText) };
}

/**
 * Write orthographic edits through the one writer, writePageText (#7058): `items` = [{ page: {id, book_id, ocr}, next }].
 * Each page: the revision row (whole prior `ocr`, source = the sweep label, run_id — revert-run.mjs undoes the run), then
 * the compare-and-set write. `verbatim` writes the value exactly as built by orthographicOcrValue, so `ocr.updated_at`
 * keeps its old value and the translation is not stale (header). `expect_prior_hash` refuses a page whose text changed
 * since the pass read it ('prior_changed'), so a transform of old text never lands on new text; a human edit is refused
 * by the writer itself. `concurrency` pages in flight at once.
 * Returns { written, conflict, prior_changed, refused_human_edit, not_found, revision_ids }.
 */
export async function writeOrthographicOcr(db, items, { by, run_id, reason = LONGS_REASON, revision_source = LONGS_SWEEP, concurrency = 16, now } = {}) {
  if (!by || !run_id) throw new Error('writeOrthographicOcr: by and run_id are required');
  const out = { written: 0, conflict: 0, prior_changed: 0, refused_human_edit: 0, not_found: 0, unchanged: 0, revision_ids: [] };
  const values = items.map(({ page, next }) => ({ page, value: orthographicOcrValue(page.ocr, next) })); // throws before any write
  let k = 0;
  const worker = async () => {
    while (k < values.length) {
      const { page, value } = values[k++];
      const r = await writePageText(db, page.id, 'ocr', value, {
        by, reason, run_id, revision_source, verbatim: true, expect_prior_hash: textHash(page.ocr), ...(now ? { now } : {}),
      });
      out[r.status] = (out[r.status] || 0) + 1;
      if (r.status === 'written') out.revision_ids.push(r.revision_id);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
  return out;
}

export { fieldText };
