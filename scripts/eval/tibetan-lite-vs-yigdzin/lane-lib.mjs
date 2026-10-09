// Pure helpers shared by the Yigdzin lane's scope / todo / export steps (#4523), split out so they can be tested.
// PRIOR ART: scripts/lib/translate-core.mjs MODEL_LITE (one exact id, the translation lane's own; no -preview alias)
// and the gate() that lived inline in build-todo.mjs — both were the bugs this file fixes, so neither is reused as is.

// The lite OCR model is stamped two ways on pages: `gemini-3.1-flash-lite` and, on pages read before the
// GA id, `gemini-3.1-flash-lite-preview`. Exact-matching the first left 37 held books / 18,762 pages with no
// Yigdzin read (tsongkhapa-4523, 2026-10-06).
export const LITE_MODELS = ['gemini-3.1-flash-lite', 'gemini-3.1-flash-lite-preview'];
export const isLiteModel = (model) => LITE_MODELS.includes(model);

// Page gate (yigdzin-527): a page whose Gemini read is Latin- or CJK-dominant (>= 50 letters) is a non-Tibetan page
// (English front matter, a Chinese preface); Yigdzin would invent Tibetan on it. Indic is NOT counted: lite's known
// failure on Tibetan cursive is invented Devanagari (#4523), so Devanagari output says nothing about the page.
const LAT = /[A-Za-zÀ-ɏḀ-ỿ]/gu, CJK = /[㐀-鿿豈-﫿]/gu, TIB = /[ༀ-࿿]/gu;
export function scriptGate(t) {
  if (!t) return null;
  // Lite marks centred headings `->…<-`. Strip those markers BEFORE the tag regex: otherwise /<[^>]*>/ matches from
  // the `<-` to the `>` of a later tag and deletes the Tibetan body in between, and the page reads as Latin-dominant
  // (81 false gates over 51 books in yig527).
  const s = t.replace(/->|<-/g, ' ').replace(/<[^>]*>/g, ' ').replace(/\[[^\]]*\]/g, ' ');
  const lat = (s.match(LAT) || []).length, cjk = (s.match(CJK) || []).length, tib = (s.match(TIB) || []).length;
  const n = lat + cjk + tib;
  return n >= 50 && (lat + cjk) / n > 0.5 ? `gemini-${lat >= cjk ? 'latin' : 'cjk'}-dominant` : null;
}
