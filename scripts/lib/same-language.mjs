// Same-language mode — page-error taxonomy class T12 (#5154).
//
// PRIOR ART: src/lib/modernize-page.ts — the reader-triggered, paid modernization of an ENGLISH
// BOOK (orthography only, gated by archaic-orthography.ts); it does not see English pages inside
// a Latin or German book, which the translate worker sends to the model like any other page.
// scripts/lib/translate-core.mjs isEnglishBook() — decides by the BOOK's language field, which is
// the edition's language and says nothing about a page. scripts/lib/page-integrity.mjs
// echoedSource() — flags a translation that repeats its source as a defect; here repeating the
// source is the point, so its test cannot be reused as the gate.
//
// Derek's decision (2026-09-30, on the taxonomy's ranked list): a page already written in English
// is COPIED, not paraphrased. The by-eye taxonomy found the model's "translation" of English into
// English abridged, modernised and drifted on nearly every English-source book it read ("How Abu
// Hasan Brake Wind" became "Broke Wind", footnotes dropped, commentary condensed). A reader of the
// translation panel on those pages never read the author. Copying costs nothing and cannot drift.
//
// The gate is EVIDENCE, not the page's self-reported <language> tag (taxonomy O16: tags are wrong
// on ~22 of 78 books): the page's words must read as English by function-word share, AND the tag,
// when present, must name English and only English — a bilingual page (English with a Latin
// quotation block) still goes to the translator, so the Latin is not left untranslated.
import { sourceProse } from './block-drift.mjs';
import { sourceLanguageCount, ocrReasoningLeak } from './page-integrity.mjs';
import { contentHash, translationInput, codeVersion, host } from './write-provenance.mjs';

export const SAME_LANGUAGE_SOURCE = 'same-language';
export const SAME_LANGUAGE_ENGINE = 'same-language-copy/1';

/** The commonest English function words, early-modern forms included. None is a common word in
 *  Latin, German, French, Italian, Spanish or Dutch except "in", which is left out for that reason. */
const ENGLISH_FUNCTION = new Set([
  'the', 'and', 'of', 'to', 'that', 'is', 'it', 'which', 'with', 'as', 'for', 'be', 'by', 'this',
  'not', 'his', 'he', 'was', 'are', 'from', 'or', 'but', 'they', 'have', 'their', 'all', 'were',
  'we', 'you', 'shall', 'unto', 'hath', 'thou', 'thy', 'thee', 'them', 'its', 'had', 'there',
  'what', 'when', 'upon', 'these', 'those', 'would', 'should', 'been', 'into', 'our', 'ye', 'doth',
]);
export const SAME_LANGUAGE_MIN_WORDS = 40;
export const SAME_LANGUAGE_MIN_SHARE = 0.3;   // English prose runs ~0.4–0.5; Dutch ~0.05, Latin ~0
export const SAME_LANGUAGE_MIN_THE = 0.03;    // "the" alone: ~6% of English running text

// A page the OCR model DESCRIBED instead of transcribing ("The image shows a blank flyleaf…",
// taxonomy O15) is English prose by the model, not the page — measured as the whole of the gate's
// false positives on non-English books before this test (2026-10-01, 1-in-20 mirror sample).
const DESCRIPTION = /^\W{0,3}(?:the (?:provided )?image|this image|this page|the page (?:is|appears|shows|contains)|image (?:shows|of)|this (?:is a|appears)|a (?:blank|largely blank))/i;

// The OCR model thinking aloud inside a transcription ("Wait, the marginal notes are on the next
// page… Let's re-verify") — lines ocrReasoningLeak() does not catch; English, and not the page.
const REASONING_LINE = /^\s*(?:wait,|let's|let me|actually,|i will|i'll|looking at|re-verify)/im;

const LANG_TAG = /<(?:language|lang)>([^<]{1,80})<\/(?:language|lang)>/i;

/**
 * Is this page's source already English? Returns { judged, english, words, share, theShare, why }.
 * A page the OCR model described rather than transcribed is never judged. Bracketed asides are not
 * counted. `english` requires all of: ≥ SAME_LANGUAGE_MIN_WORDS words; function-word share ≥
 * SAME_LANGUAGE_MIN_SHARE, over the page and over its opening words; "the" ≥ SAME_LANGUAGE_MIN_THE; a <language> tag, if present, that names
 * English and one language only.
 */
export function englishSource(ocr) {
  const text = String(ocr || '');
  const tag = text.match(LANG_TAG)?.[1]?.trim() || null;
  if (tag && !/^(?:en|eng|english)\b/i.test(tag)) return { judged: true, english: false, why: 'tag-not-english', tag };
  if (tag && sourceLanguageCount(text) > 1) return { judged: true, english: false, why: 'multilingual-tag', tag };
  // Bracketed asides are the OCR model's commentary ("[marginal note: …]", "[illegible]"), not the page.
  const prose = sourceProse(text).replace(/\[[^\]]*\]/g, ' ');
  if (DESCRIPTION.test(sourceProse(text).trim()) || ocrReasoningLeak(text)) return { judged: false, why: 'described-page' };
  if (REASONING_LINE.test(text)) return { judged: false, why: 'reasoning-leak' };
  const words = prose.toLowerCase().normalize('NFC').replace(/ſ/g, 's').match(/\p{L}+/gu) || [];
  if (words.length < SAME_LANGUAGE_MIN_WORDS) return { judged: false, why: 'short', words: words.length };
  const shares = (ws) => {
    let fn = 0, the = 0;
    for (const w of ws) { if (ENGLISH_FUNCTION.has(w)) fn++; if (w === 'the' || w === 'ye') the++; }
    return { share: +(fn / ws.length).toFixed(3), theShare: +(the / ws.length).toFixed(3) };
  };
  const { share, theShare } = shares(words);
  // The page must OPEN in English as well: an OCR model's reasoning appended to a Latin page
  // ("Wait, the marginal notes are on the next page…") can carry the whole-page share alone.
  const head = shares(words.slice(0, SAME_LANGUAGE_MIN_WORDS * 2));
  const english = share >= SAME_LANGUAGE_MIN_SHARE && theShare >= SAME_LANGUAGE_MIN_THE && head.share >= SAME_LANGUAGE_MIN_SHARE;
  return { judged: true, english, words: words.length, share, theShare, headShare: head.share, tag, why: english ? 'english' : 'not-english' };
}

/** OCR-only block tags that describe the scan, not the text; everything else is copied verbatim. */
const OCR_ONLY_BLOCKS = /<(script|columns|scan-quality)\b[^>]*>[\s\S]*?<\/\1>\s*/gi;

/** The page's transcription as its English reading text: verbatim, minus the scan-description tags. */
export function sameLanguageText(ocr) {
  return String(ocr || '').replace(OCR_ONLY_BLOCKS, '').trim();
}

/**
 * The translation subdocument for a copied page, with the provenance every text writer carries
 * (feedback_provenance_standard_for_every_writer): what produced it, from which input, where.
 */
export async function sameLanguageTranslation(page, { jobId } = {}) {
  const text = sameLanguageText(page?.ocr?.data);
  const now = new Date();
  return {
    data: text,
    language: 'English',
    source: SAME_LANGUAGE_SOURCE,
    model: null,
    updated_at: now,
    content_hash: contentHash(text),
    engine: {
      name: SAME_LANGUAGE_ENGINE,
      input: translationInput({ ocrText: page?.ocr?.data ?? '', ocrUpdatedAt: page?.ocr?.updated_at }),
      run: { code_version: await codeVersion(), host: host(), ...(jobId ? { job_id: jobId } : {}) },
    },
  };
}
