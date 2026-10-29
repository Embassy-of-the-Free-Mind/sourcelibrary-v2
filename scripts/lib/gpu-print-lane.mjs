/**
 * PRIOR ART: scripts/lib/paddle-print-lane.mjs (#6101 — the Paddle split-leaf print lane's policy, envelope, ocr
 * field and writer; copied in shape: hold reason, revision reason, one writer through writePageText, the engine block).
 * It does not fit as is: it splits spreads, measures leaf ink, converts Paddle's Chinese markup and replaces lite
 * reads; this lane reads whole Latin-script print pages and writes ONLY pages with no text.
 *
 * The GPU print lane for 1800+ English print (#6871): LightOnOCR-3-1B on gex45 reads pages that have NO text — never
 * read, or refused / returned empty by Flash-Lite — and nothing else. Evidence: scripts/eval/experiments/
 * 2026-10-29-print1800-gpu-engine-lanes-6871.md (97 typed English 1800+ reference pages: median folded CER 0.12% vs
 * lite 0.27%, catastrophic 0 vs 17, lite's 16 RECITATION refusals read at median 0.09%).
 *
 * Guards (in the worker's apply): the page still has no text, is not human-edited, its book is still held for this
 * lane, scripts/lib/gpu-ocr-loop-guard.mjs passes, the read has at least MIN_WORD_CHARS word characters (a blank
 * leaf stays unread), at most MAX_OTHER_SCRIPT letters of a non-Latin script, and no engine commentary line. Every write goes through writePageText (revision row, CAS on the prior field, run id), with
 * `ocr.source: 'lightonocr'` and an engine block (model, weights revision, serving, run, image).
 */
import { contentHash } from './write-provenance.mjs';
import { writePageText } from './page-text-writer.mjs';
import { gpuLoopVerdict } from './gpu-ocr-loop-guard.mjs';

export { isHumanEdited } from './paddle-zh-lane.mjs';

export const LANE = 'gpu-print-en-2026-10';
export const LANE_ISSUE = 6871;
export const HOLD_REASON = 'gpu-print-6871';
export const HOLD_RELEASE = 'the GPU (LightOnOCR) read of this English print book is written to its pages that had no text (#6871, OCR only); release with --to ocr_complete once the book is checked';
export const REVISION_REASON = 'ocr_gpu_print_6871';
export const BOOK_EVENT = 'gpu_print_ocr';
export const SOURCE = 'lightonocr';
/** A read with fewer word characters than this is a blank leaf or a failed read: the page stays unread. */
export const MIN_WORD_CHARS = 30;

export const LIGHTON = Object.freeze({
  name: 'LightOnOCR', model: 'lightonai/LightOnOCR-3-1B', repo: 'https://huggingface.co/lightonai/LightOnOCR-3-1B',
  licence: 'Apache-2.0', prompt: 'none (image only, the model card\'s usage)', decode: { temperature: 0.2, top_p: 0.9, max_tokens: 6000 },
  max_side: 2400,
});

/** The language of the books in this lane's frame (the edition's language field, #5 of the lane decision tree). */
export const isEnglishBook = (language) => /^English\b/.test(String(language || ''));

/** A page this lane may write: no text at all (a refusal stamp or a lite model name with no text still counts). */
export function hasNoText(ocr) {
  const d = ocr?.data;
  return d == null || (typeof d === 'string' && !d.trim());
}

/**
 * LightOnOCR's markdown → the library's plain transcription: heading marks and bold dropped, standalone rules and
 * image links removed, an HTML table flattened one row a line (cells joined with " | "), a LaTeX superscript
 * ($^{12}$) to its digits. Everything else is kept as read.
 */
export function convertRead(raw) {
  let t = String(raw || '').replace(/\r/g, '');
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
  t = t.replace(/<\/t[dh]>\s*<t[dh][^>]*>/gi, ' | ').replace(/<\/tr>/gi, '\n').replace(/<\/?(table|thead|tbody|tr|td|th)[^>]*>/gi, '');
  t = t.replace(/\$\^\{?([^${}]{1,8})\}?\$/g, '$1');
  t = t.split('\n').map((l) => l.replace(/^\s{0,3}#{1,6}\s+/, '').replace(/\*\*([^*\n]+)\*\*/g, '$1'))
    .filter((l) => !/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(l)).join('\n');
  return t.replace(/\n{3,}/g, '\n\n').trim();
}

export const wordChars = (s) => (String(s || '').match(/[\p{L}\p{N}]/gu) || []).length;

/**
 * Letters of a script other than Latin (Greek, Cyrillic, Hebrew, Arabic, Devanagari and the other Indic scripts, CJK,
 * Tibetan …). Added after the #6871 judge (post hoc, so it only turns pages away): on lite-refused English pages
 * LightOnOCR garbled every Sanskrit, Devanagari and Chinese span it met (3 of 30 pages), while the English around them
 * was right. Such a page is not written; it stays unread for the Flash ladder.
 */
const OTHER_SCRIPT = /[\p{Script=Greek}\p{Script=Cyrillic}\p{Script=Hebrew}\p{Script=Arabic}\p{Script=Syriac}\p{Script=Devanagari}\p{Script=Bengali}\p{Script=Tamil}\p{Script=Telugu}\p{Script=Kannada}\p{Script=Malayalam}\p{Script=Gujarati}\p{Script=Gurmukhi}\p{Script=Tibetan}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Armenian}\p{Script=Georgian}\p{Script=Ethiopic}\p{Script=Thai}]/gu;
export const MAX_OTHER_SCRIPT = 3;
export const otherScriptCount = (s) => (String(s || '').match(OTHER_SCRIPT) || []).length;
/** A line in which the engine talks about the image instead of transcribing it (one judged page, #6871). */
export const COMMENTARY = /^\s*(?:\*{0,2}note\*{0,2}\s*:\s*)?(?:the|this) (?:original )?(?:image|page|scan|photograph)\s+(?:contains|shows|depicts|is)\b/im;

/** The page verdict: { verdict: 'write'|'textless'|'reject', reason, body }. */
export function pageVerdict(raw, { finish = null } = {}) {
  const g = gpuLoopVerdict(raw, { finish });
  if (g.refuse) return { verdict: 'reject', reason: `loop_guard:${g.reason}`, detail: g.detail ?? null };
  const body = convertRead(raw);
  if (wordChars(body) < MIN_WORD_CHARS) return { verdict: 'textless', reason: 'under_min_word_chars', body };
  const other = otherScriptCount(body);
  if (other > MAX_OTHER_SCRIPT) return { verdict: 'reject', reason: 'other_script', detail: { letters: other } };
  if (COMMENTARY.test(body)) return { verdict: 'reject', reason: 'engine_commentary', detail: { line: body.match(COMMENTARY)[0].slice(0, 80) } };
  return { verdict: 'write', reason: 'ok', body };
}

export function envelope(body, language = 'English') {
  return `<language>${language}</language>\n<script>printed</script>\n\n${String(body || '').trim()}`;
}

/** The whole `ocr` field this lane writes; the prior field is kept whole in the revision row. */
export function ocrField(text, { run, now = new Date(), imageUrl = null, imageSha256 = null, box = {}, why = null, finish = null } = {}) {
  return {
    data: text,
    content_hash: contentHash(text),
    language: 'English',
    model: LIGHTON.model,
    source: SOURCE,
    pipeline: LANE,
    updated_at: now,
    engine: {
      name: LIGHTON.name, model: LIGHTON.model, repo: LIGHTON.repo, licence: LIGHTON.licence,
      ...(box.weights_revision ? { revision: box.weights_revision, revision_source: 'logged: the HF snapshot the box served' } : { revision_source: 'not_recorded: the box run did not report its snapshot' }),
      prompt: LIGHTON.prompt, decode: { ...LIGHTON.decode, finish_reason: finish },
      conventions: `whole page, long side capped at ${LIGHTON.max_side} px; markdown converted (scripts/lib/gpu-print-lane.mjs convertRead); written only where the page had no text`,
      measured: 'scripts/eval/experiments/2026-10-29-print1800-gpu-engine-lanes-6871.md: 97 English 1800+ typed-reference pages, median folded CER 0.12% vs flash-lite 0.27%, catastrophic 0 vs 17',
      run, issue: LANE_ISSUE, host: box.host || null, gpu: box.gpu || null,
      serving: box.vllm_version ? { backend: 'vllm', vllm: box.vllm_version } : null,
      input: imageUrl ? { image_url: imageUrl, image_sha256: imageSha256 } : { status: 'not_recorded', reason: 'caller passed no image url' },
      replaced: why,
    },
  };
}

/** One page through the one writer (#7058): revision with the whole prior field, CAS on the prior text. */
export async function writeLanePage(db, pageId, field, { run }) {
  return writePageText(db, pageId, 'ocr', field, { by: `${LANE} (scripts/workers/gpu-print-lane.mjs)`, reason: REVISION_REASON, run_id: run });
}
