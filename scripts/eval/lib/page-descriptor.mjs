/**
 * Image-only page descriptor: what kind of page this is, read from the picture alone (#5623).
 *
 * PRIOR ART: none — no image-only page descriptor exists. The nearest things are the inline
 * metadata tags the Gemini OCR prompt writes into `pages.ocr.data` (`<script>`, `<page-type>`,
 * `<columns>`; parsed by scripts/lib/ocr-result-parse.mjs) and the routes the Kraken / NDL /
 * Paddle lanes stamp. Pages read by the Archive's own OCR, by older Gemini prompt versions, or
 * imported from an e-text corpus (CBETA, ETCSL, bdrc) carry none of those tags, so any covariate
 * built on them is missing exactly where the engines differ. This fills that gap for analysis,
 * one call per page, and writes nothing to Mongo.
 *
 * The page-type vocabulary is the OCR prompt's own (PROMPT_PAGE_TYPES, imported, not copied), so
 * a descriptor answer and an inline tag are directly comparable. `script` uses the OCR prompt's
 * three values. The flags and the typeface are new here and have no inline counterpart, except
 * that the OCR prompt's `<margin>` tag, markdown tables and `<detected-images>` block are the
 * transcription's own evidence for marginalia, tables and illustrations.
 *
 * Calls go through scripts/lib/gemini-script-client.mjs (thinking off, usage metered). The
 * client is realtime only; it has no Batch path, so a run here is billed at list price.
 */
import sharp from 'sharp';
import { callGemini } from '../../lib/gemini-script-client.mjs';
import { PROMPT_PAGE_TYPES } from '../../lib/ocr-result-parse.mjs';
import { costOf } from '../../lib/model-pricing.mjs';

export const DESCRIPTOR_MODEL = 'gemini-3.1-flash-lite';
export const DESCRIPTOR_VERSION = 'page-descriptor-v1.2026-10';
export const SCRIPTS = ['printed', 'handwritten', 'mixed'];
export const TYPEFACES = ['roman', 'blackletter', 'italic', 'non-latin', 'n/a'];
const LONG_EDGE = 1536; // enough to tell a hand from type and see a margin; keeps the request small

export const DESCRIPTOR_PROMPT = `You are cataloguing one scanned page of a historical book or manuscript. Look at the image only; do not transcribe it.

Return ONE JSON object and nothing else:
{
  "script": "printed" | "handwritten" | "mixed",
  "page_type": one of ${PROMPT_PAGE_TYPES.map((t) => `"${t}"`).join(', ')},
  "columns": integer, the number of text columns in the main text block (1 if single-column, 0 if the page has no text),
  "has_illustration": true | false,
  "has_table": true | false,
  "has_marginalia": true | false,
  "typeface": "roman" | "blackletter" | "italic" | "non-latin" | "n/a"
}

Definitions:
- script: "printed" = set in type, engraved or lithographed; "handwritten" = written by hand (a manuscript); "mixed" = a printed page carrying substantial handwriting (annotations, filled-in forms, a handwritten leaf bound with print).
- page_type: the same classification an OCR reader would give. "text" for an ordinary page of prose or verse. "digitizer-insert" for a library scan sheet, colour chart or "Digitized by" notice. "exlibris" for an ownership bookplate. "table" when the page is substantially one tabular ruling. "illustration", "diagram" or "map" when the picture is the page.
- has_illustration: any woodcut, engraving, drawing, emblem, diagram, map or printed ornament larger than a decorated initial.
- has_table: any ruled or aligned tabular data (rows and columns), even inside prose.
- has_marginalia: any text in the outer margins beside the main block — printed side-notes or handwritten notes. Running heads, page numbers and signatures are NOT marginalia.
- typeface: the dominant letterform of the main text. "roman" (including modern serif and sans), "blackletter" (Fraktur, textura, Schwabacher, Gothic hands), "italic", "non-latin" (Greek, Hebrew, Arabic, Syriac, CJK, Devanagari and so on), "n/a" (no text, or a hand that is not a typeface — use "n/a" for most handwritten pages unless the hand imitates a typeface).`;

/** Downscale the page image the reader sees to a JPEG under LONG_EDGE px. */
export async function loadPageImage(url) {
  // A IIIF page read at full size is the heaviest request a library's image server takes (the BSB
  // answered 429 to them in bursts); ask the server for the size we would downscale to anyway.
  const sized = url.replace(/(\/iiif\/image\/v[23]\/[^/]+\/full\/)(full|max)(\/0\/default\.(?:jpg|png))$/, `$1!${LONG_EDGE},${LONG_EDGE}$3`);
  let res;
  for (let attempt = 0; attempt < 3; attempt++) {
    res = await fetch(sized, { headers: { 'User-Agent': 'sourcelibrary-eval/page-descriptor' }, signal: AbortSignal.timeout(60_000) });
    if (res.status !== 429) break;
    await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
  }
  if (!res.ok) throw new Error(`image ${res.status} ${sized}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return sharp(buf).rotate().resize({ width: LONG_EDGE, height: LONG_EDGE, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
}

/**
 * Validate one model answer. Returns `{ value, errors }`; a field outside its vocabulary is
 * dropped (null) and named in `errors`, never coerced to a near neighbour.
 */
export function parseDescriptor(text) {
  const errors = [];
  let raw;
  try {
    raw = JSON.parse(String(text || '').replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, ''));
  } catch {
    return { value: null, errors: ['unparseable JSON'] };
  }
  const pick = (k, ok) => { const v = typeof raw?.[k] === 'string' ? raw[k].trim().toLowerCase() : raw?.[k]; if (ok(v)) return v; errors.push(`${k}=${JSON.stringify(raw?.[k])}`); return null; };
  const value = {
    script: pick('script', (v) => SCRIPTS.includes(v)),
    page_type: pick('page_type', (v) => PROMPT_PAGE_TYPES.includes(v)),
    columns: pick('columns', (v) => Number.isInteger(v) && v >= 0 && v <= 12),
    has_illustration: pick('has_illustration', (v) => typeof v === 'boolean'),
    has_table: pick('has_table', (v) => typeof v === 'boolean'),
    has_marginalia: pick('has_marginalia', (v) => typeof v === 'boolean'),
    typeface: pick('typeface', (v) => TYPEFACES.includes(v)),
  };
  return { value, errors };
}

/**
 * Describe one page. `endpoint` labels the spend in gemini_usage.
 * @returns {Promise<{ value: object|null, errors: string[], input_tokens: number, output_tokens: number, usd: number, finish: string }>}
 */
export async function describePage({ imageUrl, endpoint, bookId, pageId }) {
  const image = await loadPageImage(imageUrl);
  const r = await callGemini({
    model: DESCRIPTOR_MODEL, prompt: DESCRIPTOR_PROMPT, imageParts: [image], endpoint,
    maxOutputTokens: 400, type: 'eval', bookId, pageIds: pageId ? [pageId] : undefined, promptVersion: DESCRIPTOR_VERSION,
  });
  const { value, errors } = parseDescriptor(r.text);
  return { value, errors, input_tokens: r.inputTokens, output_tokens: r.outputTokens, usd: costOf(DESCRIPTOR_MODEL, r.inputTokens, r.outputTokens), finish: r.finishReason };
}
