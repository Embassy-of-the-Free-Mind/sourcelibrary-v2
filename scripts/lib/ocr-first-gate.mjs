// PRIOR ART: scripts/lib/first-ocr-guard.mjs — guards the FIRST OCR write on a page, not a translation run over
// existing OCR; scripts/lib/ia-ocr-gate.mjs — gates Archive OCR imports. Neither looks at the transcription a
// premium translation run is about to build on. Searched scripts/lib for ocr|engine|provenance.
/**
 * Check the transcription before paying for a translation on top of it.
 *
 * WHY (#6865, 2026-10-18): the Florentine Codex was retranslated twice on the subscription (an Opus pass over
 * 2,440 pages, then ~900 pages of an Argon-draft + Opus-review pass) on a gemini-3.1-flash-lite transcription that
 * nobody had opened. A by-eye check of three pages then showed the transcription was the weak link: "riñen" read as
 * "rien", "njcço, njcçoço" (I pierce it, I string it) as "njcco, njccoco", which Opus translated "I buy it, I sell it".
 * Argon-high re-read the same pages correctly. Both passes had to be redone.
 *
 * WHO IT STOPS: a person or session starting a CLI translation read (claude-translate.mjs, cli-translate.mjs) on
 * pages whose OCR came from a flash-lite model. It prints the OCR engine mix of the target pages and refuses to
 * start until the run names what was checked: `--ocr-checked="<pages opened against the image, and the verdict>"`.
 * It never blocks a run whose transcription came from anything else, and it writes nothing. A flash-lite page a person
 * edited, or whose read says it has no text, is not counted as unchecked (uncheckedLite, #7263).
 */

const LITE = /flash-lite/i;
export const OCR_LITE_SHARE_LIMIT = 0.2;
/** A stored read that says the page has no text to translate (the armc frame's own test, cli-ocr-lane.mjs armcPages). */
const NO_TEXT = /<page-type>\s*(illustration|plate|map|blank)/i;

/**
 * Is this page an UNCHECKED flash-lite draft? (#7263) Not when a person edited it (ocr.edited_by, or source manual):
 * that read has been checked. Not when the read itself says the page is an illustration, plate, map or blank: there is
 * no text for a translation to rest on. The armc lane (cli-ocr-lane.mjs) writes its correction with the corrector's
 * model, so a corrected page is no longer a flash-lite page at all; these two are what that lane leaves as they are.
 */
export function uncheckedLite(p) {
  if (!LITE.test(p?.ocr?.model || '')) return false;
  if (p.ocr.edited_by || p.ocr.source === 'manual') return false;
  return !NO_TEXT.test(p.ocr.data || '');
}

/** Summarise the OCR engines behind `pages` (objects carrying `ocr.model`); `lite` counts unchecked flash-lite pages. */
export function ocrEngineMix(pages) {
  const mix = new Map();
  for (const p of pages) {
    const m = p?.ocr?.model || '(no model recorded)';
    mix.set(m, (mix.get(m) || 0) + 1);
  }
  const total = pages.length;
  const lite = pages.filter(uncheckedLite).length;
  return { total, lite, liteShare: total ? lite / total : 0, mix: [...mix].sort((a, b) => b[1] - a[1]) };
}

/**
 * Returns { ok, message }. ok is false when more than OCR_LITE_SHARE_LIMIT of the pages rest on a flash-lite
 * transcription and `ocrChecked` (the --ocr-checked value) is empty.
 */
export function ocrFirstGate(pages, ocrChecked) {
  const r = ocrEngineMix(pages);
  const allLite = r.mix.filter(([m]) => LITE.test(m)).reduce((s, [, n]) => s + n, 0);
  const line = `OCR under these ${r.total} pages: ` + r.mix.map(([m, n]) => `${m} ${n}`).join(', ')
    + (allLite > r.lite ? ` (${allLite - r.lite} flash-lite page(s) edited by a person or with no text: not counted)` : '');
  if (r.liteShare <= OCR_LITE_SHARE_LIMIT) return { ok: true, message: line };
  if (ocrChecked && ocrChecked.trim().length >= 10) return { ok: true, message: `${line}\nOCR checked: ${ocrChecked.trim()}` };
  return {
    ok: false,
    message: `${line}\n${Math.round(r.liteShare * 100)}% of these pages rest on a flash-lite transcription. A translation can be no `
      + `better than the text it reads, so open 3 pages against their images first (one dense, one ordinary, one faint). `
      + `If the transcription is wrong, re-OCR (scripts/batch/cli-ocr.mjs) before translating. Then re-run with `
      + `--ocr-checked="<pages checked and what you found>" (at least 10 characters).`,
  };
}
