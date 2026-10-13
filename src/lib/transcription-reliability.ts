/**
 * Scripts our OCR cannot reliably read, and what to tell the reader.
 *
 * PRIOR ART: src/components/reader-v2/PairedEdition.tsx — the Marcianus paired
 * edition already demotes an unreliable transcription and tells the reader why.
 * It does not fit here because it is built for ONE manuscript around a
 * hand-aligned critical edition: it needs a text of record to promote in place
 * of the OCR. There is no critical edition to promote for 1,467 Tibetan pecha,
 * so the honest move is a warning rather than a substitution. The argument is
 * the same one, and it is already written down at Reader2C.tsx:3050 — showing
 * an OCR that self-agrees at 0.62 with documented hallucinations "is not a
 * missing feature, it is the reader asserting something false."
 *
 * WHY THIS EXISTS (#4523)
 * ----------------------
 * Measured 2026-09-01 against real ground truth — 63 intact Derge Kangyur
 * folios scored by syllable alignment against the OpenPecha etext, both arms
 * seeing identical images:
 *
 *   positive control (etext + 5% noise)   0.968
 *   BDRC Woodblock (specialist ONNX)      0.880
 *   Gemini 3.1 flash-lite (ours)          0.412
 *   chance floor (wrong pages)            0.103
 *
 * Ours sits closer to the chance floor than to the specialist. And the failure
 * is not noise: it invents fluent text in the wrong script and religion — one
 * confirmed Bhutanese Nyingma folio was transcribed as a Devanagari Rāma
 * invocation and then faithfully translated into English. The folios in that
 * test were INTACT, so this is not confined to the damaged-master cohort of
 * #4534: the model cannot read cursive dbu-med at all.
 *
 * SCOPE. Tibetan only, because Tibetan is the only script where we hold a
 * ground-truth measurement. The same audit found an unexplained-substitution
 * residue in Syriac (19.5%), Persian (19.3%) and Hebrew (13.2%) — milder, and
 * the substitute is Latin rather than a foreign script. Do not add them here on
 * the strength of that number alone; measure first. Korean's apparently terrible
 * own-script rate is an ARTIFACT (classical Korean is written in hanmun) and is
 * not a candidate.
 *
 * WHAT THIS IS NOT. It does not hide, delete or alter any text. Derek's
 * decision of 2026-09-01 was "we can't claim those are translations, I agree.
 * we don't need to withdraw the text yet though" — the first-translation claims
 * were duly retracted (795 Tibetan verdicts set to not_applicable; zero books
 * still carry the public boolean) and this is the reader-facing warning that
 * was scoped to ship alongside it. Withdrawing the text remains a separate,
 * unmade decision.
 */

import { stripMarkupTags } from './strip-markup-tags';

export type TranscriptionReliability = {
  /** Machine-readable so a caller can decide how loudly to render it.
   *  `unreliable` — our OCR cannot read this script; do not trust the text.
   *  `caution` — a specialist engine read it; good, but unchecked by a person. */
  level: 'unreliable' | 'caution';
  /** One sentence, addressed to a reader rather than to us. */
  message: string;
  /** Where the claim comes from, for anyone who wants to check it. */
  evidence: string;
};

/** Lowercased edition languages whose transcription we cannot vouch for. */
const UNREADABLE_LANGUAGES = new Set(['tibetan']);

/**
 * The specialist Tibetan reader (#4722). The 09-01 numbers above describe the
 * Gemini reads it replaced. On the pages it read, the "cannot read" notice is
 * false, and its own evidence line names this engine as the good one (#5746).
 */
const YIGDZIN_MODEL = 'bdrc-yigdzin-v1';

/**
 * Kangyur volumes are the only Tibetan manuscripts we can measure: the Derge
 * Kangyur e-text is a reference for them, and nothing comparable exists for
 * the Nyingma tantras and the rest. Matched on the title because that is how
 * the measured sample was drawn (Kangyur-titled BL books).
 */
const KANGYUR_TITLE = /\bka[nṅ]g?[jy]ur\b|bka['’]?\s?['’]?gyur/i;

/**
 * `language` is the EDITION's language, not the source work's — see
 * `.claude/docs/invariants/language-fields.md`. That is the right field here:
 * what matters is the script actually photographed on the folio, which is what
 * the OCR had to read.
 *
 * The page decides WHICH notice, because what we can say depends on the engine
 * that read it. Without a page (a book-level surface) the strong notice stands:
 * a book can still hold Gemini-read pages (#4523's remainder).
 */
export function transcriptionReliability(
  book: { language?: string | null; title?: string | null } | null | undefined,
  page?: { ocr?: { model?: string | null } | null } | null,
): TranscriptionReliability | null {
  const lang = (book?.language ?? '').trim().toLowerCase();
  if (!UNREADABLE_LANGUAGES.has(lang)) return null;
  if (page?.ocr?.model === YIGDZIN_MODEL) {
    // Measured 2026-09-30 and replicated 2026-10-01 (n = 100, no shared pages):
    // median syllable identity 0.947 against the Derge Kangyur e-text, chance
    // 0.25; about 5% of two-leaf pages drop the lower leaf's first line.
    // scripts/eval/experiments/2026-10-01-kangyur-ocr-accuracy-confirmatory-redraw-4523.md
    const measured = KANGYUR_TITLE.test(book?.title ?? '');
    const made =
      'This transcription was made by machine, by BDRC’s Yigdzin, an OCR ' +
      'model built for Tibetan manuscripts. ';
    const tail = 'The English is an AI translation made from it. Check the scan before quoting either.';
    return {
      level: 'caution',
      message: measured
        ? made + 'It reads well but has not been checked by a person: on about ' +
          'one page in twenty a line is dropped where two leaves meet. ' + tail
        : made + 'We hold no typed edition of this text to measure it against, ' +
          'so its accuracy here is unknown. ' + tail,
      evidence: measured
        ? 'Measured on 100 sampled Kangyur folios against the Derge edition: a ' +
          'median 95% of syllables agree, where chance is 25%.'
        : 'Where we can measure it, on Kangyur folios, a median 95% of syllables ' +
          'agree with the Derge edition.',
    };
  }
  return {
    level: 'unreliable',
    message:
      'This transcription is machine-made and unreliable. Our OCR cannot read ' +
      'cursive Tibetan, and where it fails it does not stop: it invents ' +
      'plausible text, sometimes in another script entirely. Read the scan as ' +
      'the source, and please do not quote the transcription or the English ' +
      'without checking the folio.',
    evidence:
      'Measured against the Derge Kangyur etext on intact folios: 0.41 where a ' +
      'specialist Tibetan model scores 0.88 and chance is 0.10.',
  };
}

/**
 * PAGE-level caution: the transcription of THIS page was hard to read, so the
 * English beside it rests partly on uncertain readings (#5274 follow-up).
 *
 * Derek's decision of 2026-09-30: FLAG, not withhold — the translation stays up
 * and the reader is told, in one quiet line, where the source read is weak.
 * (Pages we judged unreadable outright are a different state: `ocr.unreadable`
 * already withholds both panes, and none of those 72,022 pages serves a
 * translation, measured 2026-09-30.)
 *
 * The signals are the ones the OCR already writes into the page, so this costs
 * nothing and needs no new field:
 *
 *   - `<unclear>` — the OCR's own mark on a span it could not read with
 *     confidence. When a large share of the page sits inside it, the translation
 *     of that page is largely a translation of guesses (taxonomy T7).
 *   - `<warning>` naming damage, fading or illegibility — the OCR's note that
 *     part of the leaf is physically hard to read.
 *
 * What this is NOT: a garble detector. The corpus audit's 6.6% "garbled source"
 * rate is a JUDGE's rate over pages whose OCR reads as confident text; most of
 * those carry neither signal, and catching them needs a detector (a separate
 * issue), not this function. This covers the pages where the OCR already told
 * us it struggled — and passes that on to the person reading.
 */
export type PageReadCaution =
  | { reason: 'unclear'; share: number }
  | { reason: 'damage' };

/** Share of the page's body text inside `<unclear>` at which the note shows. */
export const UNCLEAR_SHARE_THRESHOLD = 0.1;
/** Below this many body characters a share is noise (a caption, a catchword). */
const MIN_BODY_CHARS = 60;

// Tags whose content is about the page, not on it — excluded from the body.
const NON_BODY = /<(language|script|page-type|columns|meta|vocab|header|page-num|sig|image-desc|warning|summary|keywords)[^>]*>[\s\S]*?<\/\1>/gi;
// A warning counts only when it says the READING was impaired, not merely that
// the leaf is stained or shows bleed-through: sampled 2026-09-30, most warnings
// that name bleed-through or a stain go on to say the text remains legible, and
// a note on those pages would teach readers to ignore it.
const READ_HARM = /illegib|unreadab|barely legib|partially legib|difficult to (read|decipher|make out)|hard to (read|decipher|make out)|impossible to (read|decipher)|cannot be (read|deciphered)|loss of (the |[a-z]+ and )?(text|characters|letters|words|lines)|partially lost|text (is|has been|was) lost|lost text|obscur\w* (some |the |portions of |parts of |much of |most of |several )?(the )?(main |primary )?(text|characters|letters|words|lines|passages)|imped\w* legib|severely faded|heavily faded|significantly faded/i;
const STILL_LEGIBLE = /(remains?|still|is|are|fully|clearly|otherwise) (clear and |largely |mostly |generally )?legible/i;

export function pageReadCaution(
  page: { ocr?: { data?: string | null; unreadable?: boolean } | null } | null | undefined,
): PageReadCaution | null {
  const ocr = page?.ocr;
  if (!ocr?.data || ocr.unreadable) return null;
  const body = ocr.data.replace(NON_BODY, '');
  const plainLen = stripMarkupTags(body, '').replace(/\s+/g, ' ').trim().length;
  if (plainLen >= MIN_BODY_CHARS) {
    let unclear = 0;
    for (const m of body.matchAll(/<unclear[^>]*>([\s\S]*?)<\/unclear>/gi)) {
      unclear += stripMarkupTags(m[1], '').replace(/\s+/g, ' ').trim().length;
    }
    const share = unclear / plainLen;
    if (share >= UNCLEAR_SHARE_THRESHOLD) return { reason: 'unclear', share };
  }
  const warning = ocr.data.match(/<warning>([\s\S]*?)<\/warning>/i)?.[1];
  if (warning && READ_HARM.test(warning) && !STILL_LEGIBLE.test(warning)) return { reason: 'damage' };
  return null;
}
