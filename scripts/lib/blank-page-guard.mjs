/**
 * Write-time guard: refuse OCR that asserts text for a page with no ink (#4149).
 *
 * THE FAILURE THIS STOPS
 * ----------------------
 * Given a blank or unreadable leaf, the model does not decline. It writes fluent
 * period-appropriate prose at length, with a complete invented apparatus —
 * `<page-type>text</page-type>`, a running header, a signature mark, a
 * decorative initial, and a `<page-num>`. A fabricated page number is a
 * fabricated citation. Confirmed on 49 pages across 11 published books; the
 * measured population is ~678 pages of 21,481 live books (CI 211–1,145).
 *
 * WHY THE EXISTING GUARD DOES NOT COVER IT
 * `batch-collector.mjs` already drops responses over `HALLUCINATION_LIMIT`
 * (25,000 chars). That is a runaway-length guard: of the confirmed fabrications
 * only one exceeded it. The rest were 483–2,800 characters — shorter and
 * better-formed than plenty of genuine OCR, which is exactly why no text
 * heuristic catches them. Only the page image settles it.
 *
 * DESIGN DECISIONS, AND WHY
 *
 *   Fails OPEN, always. An image that cannot be fetched, decoded or measured is
 *   NOT evidence of fabrication, so the write proceeds. This guard may only ever
 *   veto on positive evidence of a blank page. A guard that failed closed on a
 *   network blip would silently stop transcribing real books.
 *
 *   Only pages claiming substantial body text are checked. A page whose OCR
 *   correctly returns nothing needs no image fetch, which keeps this to roughly
 *   one fetch per genuinely-transcribed page (~1,700/day at current volume).
 *
 *   Metadata is stripped before measuring the claim. `<image-desc>` prose on a
 *   blank leaf ("the page is blank with foxing") is a CORRECT response and must
 *   not be read as a text assertion.
 *
 *   Refusals are recorded, never silently dropped. The caller writes the refused
 *   text to `page_revisions` so the evidence survives and the guard's firing
 *   rate is measurable. An absent page must never mean "quietly discarded".
 *
 * Kill switch: BLANK_PAGE_GUARD=off disables it (writes proceed unchecked).
 */
import sharp from 'sharp';
import { randomBytes } from 'node:crypto';

/** Fraction of pixels darker than the page ground below which a leaf is blank. */
export const DEFAULT_INK_MAX = 0.004;
/** Characters of body text that make an OCR result a "claim" worth testing. */
export const DEFAULT_MIN_BODY = 300;
/** Give up on the image quickly; the write is waiting on us. */
const FETCH_TIMEOUT_MS = 8000;

/** Elements whose contents describe the page rather than transcribe it. */
const META = ['language', 'page-type', 'script', 'quality', 'scan-quality', 'image-desc',
  'vocab', 'header', 'sig', 'page-num', 'catchword', 'meta', 'warning', 'columns'];

/** The part of an OCR response that claims to be words on the page. */
export function transcriptionBody(data) {
  let out = data || '';
  for (const t of META) {
    out = out.replace(new RegExp(`<${t}[^>]*>[\\s\\S]*?</${t}>`, 'gi'), ' ');
    out = out.replace(new RegExp(`<${t}[^>]*/?>`, 'gi'), ' ');
  }
  return out.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Fraction of pixels meaningfully darker than the page ground.
 * The ground is taken as the 95th brightness percentile so that yellowed or
 * grey scans are not read as covered in ink.
 */
export async function inkCoverage(buf) {
  const img = sharp(buf, { failOn: 'none' })
    .greyscale()
    .resize(400, null, { fit: 'inside', withoutEnlargement: true });
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const hist = new Uint32Array(256);
  for (let i = 0; i < data.length; i++) hist[data[i]]++;
  const total = info.width * info.height;
  if (!total) return null;
  let seen = 0, ground = 255;
  for (let v = 255; v >= 0; v--) { seen += hist[v]; if (seen >= total * 0.05) { ground = v; break; } }
  const threshold = Math.max(0, ground - 60);
  let dark = 0;
  for (let v = 0; v <= threshold; v++) dark += hist[v];
  return dark / total;
}

export function guardEnabled() {
  return String(process.env.BLANK_PAGE_GUARD || '').toLowerCase() !== 'off';
}

/**
 * Should this OCR result be refused?
 *
 * Returns `{ refuse, reason, coverage, chars }`. `refuse` is true ONLY when the
 * image was fetched, decoded and measured and came back blank. Every other
 * outcome — guard disabled, short body, no URL, fetch failure, decode failure —
 * returns refuse:false with a reason, so callers can log why nothing happened.
 */
export async function shouldRefuseOcrWrite({
  text,
  imageUrl,
  /**
   * The image bytes, when the caller already has them — a Buffer, or the
   * base64 string the orchestrator holds after `fetchImageBase64`. Supplying
   * this skips the fetch entirely, which is what makes the guard free on the
   * preview path: those bytes are the very ones posted to Gemini.
   */
  imageBuffer,
  inkMax = DEFAULT_INK_MAX,
  minBody = DEFAULT_MIN_BODY,
  fetchImpl = fetch,
} = {}) {
  if (!guardEnabled()) return { refuse: false, reason: 'guard_disabled', coverage: null, chars: 0 };

  const body = transcriptionBody(text);
  if (body.length < minBody) {
    return { refuse: false, reason: 'no_substantial_claim', coverage: null, chars: body.length };
  }

  let buf;
  if (imageBuffer) {
    try {
      buf = Buffer.isBuffer(imageBuffer) ? imageBuffer : Buffer.from(String(imageBuffer), 'base64');
    } catch {
      return { refuse: false, reason: 'bad_image_buffer', coverage: null, chars: body.length };
    }
    if (!buf.length) return { refuse: false, reason: 'empty_image_buffer', coverage: null, chars: body.length };
  }

  if (!buf && !imageUrl) return { refuse: false, reason: 'no_image_url', coverage: null, chars: body.length };

  if (!buf) try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetchImpl(imageUrl, { signal: ctrl.signal });
      if (!res.ok) return { refuse: false, reason: `fetch_${res.status}`, coverage: null, chars: body.length };
      buf = Buffer.from(await res.arrayBuffer());
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    // Unreadable is not evidence. Let the write through.
    return { refuse: false, reason: `fetch_failed:${e?.name || 'error'}`, coverage: null, chars: body.length };
  }

  let coverage;
  try {
    coverage = await inkCoverage(buf);
  } catch (e) {
    return { refuse: false, reason: `decode_failed:${e?.name || 'error'}`, coverage: null, chars: body.length };
  }
  if (coverage == null) return { refuse: false, reason: 'measure_failed', coverage: null, chars: body.length };

  if (coverage <= inkMax) {
    return { refuse: true, reason: 'blank_page_with_text_claim', coverage, chars: body.length };
  }
  return { refuse: false, reason: 'has_ink', coverage, chars: body.length };
}

/**
 * Record a refusal so it is auditable and countable. Never silently drop —
 * nothing downstream could otherwise tell "refused" from "never processed".
 *
 * Note this is the mirror image of `scripts/lib/page-revisions.mjs`, which
 * retains the EXISTING content before an overwrite. Here the page keeps nothing
 * and it is the REJECTED INCOMING text that would otherwise be lost. Same
 * collection and field names so both populations read out by `source`; same
 * never-throw contract, because losing the audit row must not block the batch.
 */
export async function recordRefusal(db, { pageId, bookId, pageNumber, text, model, verdict, jobId }) {
  try {
    await db.collection('page_revisions').insertOne({
      id: randomBytes(6).toString('hex'),
      page_id: pageId,
      book_id: bookId,
      page_number: pageNumber ?? null,
      field: 'ocr',
      data: text,
      source: 'blank-guard-refused-2026-08',
      model: model ?? null,
      reason: '#4149',
      note: `OCR refused at write time: image ink coverage ${(verdict.coverage * 100).toFixed(3)}% (blank) while the response asserted ${verdict.chars} characters of transcription.`,
      batch_job_id: jobId ?? null,
      created_at: new Date(),
    });
    return true;
  } catch (e) {
    console.warn(`[blank-page-guard] could not record refusal for ${pageId}: ${e?.message}`);
    return false;
  }
}
