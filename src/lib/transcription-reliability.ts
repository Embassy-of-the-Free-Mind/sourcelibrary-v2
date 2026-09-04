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

export type TranscriptionReliability = {
  /** Machine-readable so a caller can decide how loudly to render it. */
  level: 'unreliable';
  /** One sentence, addressed to a reader rather than to us. */
  message: string;
  /** Where the claim comes from, for anyone who wants to check it. */
  evidence: string;
};

/** Lowercased edition languages whose transcription we cannot vouch for. */
const UNREADABLE_LANGUAGES = new Set(['tibetan']);

/**
 * `language` is the EDITION's language, not the source work's — see
 * `.claude/docs/invariants/language-fields.md`. That is the right field here:
 * what matters is the script actually photographed on the folio, which is what
 * the OCR had to read.
 */
export function transcriptionReliability(
  book: { language?: string | null } | null | undefined,
): TranscriptionReliability | null {
  const lang = (book?.language ?? '').trim().toLowerCase();
  if (!UNREADABLE_LANGUAGES.has(lang)) return null;
  return {
    level: 'unreliable',
    message:
      'This transcription is machine-made and unreliable. Our OCR cannot read ' +
      'cursive Tibetan, and where it fails it does not stop — it invents ' +
      'plausible text, sometimes in another script entirely. Read the scan as ' +
      'the source, and please do not quote the transcription or the English ' +
      'without checking the folio.',
    evidence:
      'Measured against the Derge Kangyur etext on intact folios: 0.41 where a ' +
      'specialist Tibetan model scores 0.88 and chance is 0.10.',
  };
}
