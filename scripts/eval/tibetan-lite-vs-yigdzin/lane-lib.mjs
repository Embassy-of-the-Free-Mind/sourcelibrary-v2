// Pure helpers shared by the Yigdzin lane's scope / todo / export steps (#4523), split out so they can be tested.
// PRIOR ART: scripts/lib/translate-core.mjs MODEL_LITE (one exact id, the translation lane's own; no -preview alias)
// and the gate() that lived inline in build-todo.mjs — both were the bugs this file fixes, so neither is reused as is.
import { EDITORIAL_BLOCKS } from '../../lib/ia-ocr-agreement.mjs';

// The lite OCR model is stamped two ways on pages: `gemini-3.1-flash-lite` and, on pages read before the
// GA id, `gemini-3.1-flash-lite-preview`. Exact-matching the first left 37 held books / 18,762 pages with no
// Yigdzin read (tsongkhapa-4523, 2026-10-06).
export const LITE_MODELS = ['gemini-3.1-flash-lite', 'gemini-3.1-flash-lite-preview'];
export const isLiteModel = (model) => LITE_MODELS.includes(model);

// The lane's SCOPE is every Gemini Flash-family OCR read, not one label (yigdzin-rest-4523, 2026-10-13). isLiteModel
// alone still left 19,293 withheld `gemini-3-flash-preview` pages on live Tibetan books with no Yigdzin read: Flash
// invents on Tibetan cursive the same way lite does (#4195), and yig527 itself read its 1,324 Flash pages. The family is
// `gemini-<version>-flash[-lite][-preview]`, any version: a new stamp joins the scope instead of silently leaving it.
// Pro and anything that is not a bare model id (a suffix after -preview, another vendor) stays out.
export const isGeminiFlashModel = (model) => typeof model === 'string' && /^gemini-\d+(\.\d+)?-flash(-lite)?(-preview)?$/.test(model);

// Page gate (yigdzin-527): a page whose Gemini read is Latin- or CJK-dominant (>= 50 letters) is a non-Tibetan page
// (English front matter, a Chinese preface); Yigdzin would invent Tibetan on it. Indic is NOT counted: lite's known
// failure on Tibetan cursive is invented Devanagari (#4523), so Devanagari output says nothing about the page.
// Lite's metadata blocks (<image-desc>, <vocab>, <warning>, <meta> …) DESCRIBE the page in English; their contents are
// not the page's script. Counting them gated 738 of tib4523f's 827 gated pages that were Tibetan (third gate defect,
// #4523 2026-10-08; Derek 2026-10-10: ignore them). Same block list as the IA agreement score's body-only variant.
const EDITORIAL_RE = new RegExp(`<(${EDITORIAL_BLOCKS.join('|')})\\b[^>]*>[\\s\\S]*?</\\1>`, 'gi');
const LAT = /[A-Za-zÀ-ɏḀ-ỿ]/gu, CJK = /[㐀-鿿豈-﫿]/gu, TIB = /[ༀ-࿿]/gu;
export function scriptGate(t) {
  if (!t) return null;
  // Lite marks centred headings `->…<-`. Strip those markers BEFORE the tag regex: otherwise /<[^>]*>/ matches from
  // the `<-` to the `>` of a later tag and deletes the Tibetan body in between, and the page reads as Latin-dominant
  // (81 false gates over 51 books in yig527).
  const s = t.replace(EDITORIAL_RE, ' ').replace(/->|<-/g, ' ').replace(/<[^>]*>/g, ' ').replace(/\[[^\]]*\]/g, ' ');
  const lat = (s.match(LAT) || []).length, cjk = (s.match(CJK) || []).length, tib = (s.match(TIB) || []).length;
  const n = lat + cjk + tib;
  return n >= 50 && (lat + cjk) / n > 0.5 ? `gemini-${lat >= cjk ? 'latin' : 'cjk'}-dominant` : null;
}
