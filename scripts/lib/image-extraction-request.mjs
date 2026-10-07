/**
 * image-extraction-request.mjs — the ONE image-extraction request (#4747).
 *
 * Every path that asks Gemini for illustration boxes builds its request here: the
 * realtime worker (scripts/workers/image-extract-worker.mjs), the orchestrator's
 * Batch API path (Phase 8 in scripts/workers/pipeline-orchestrator.mjs), and the
 * eval (scripts/eval/image-extraction-lite-eval.mjs). The response side lives here
 * too — parseImageExtractionResponse + normalizeScanQuality — so the batch
 * collector parses exactly what the schema makes the model return.
 *
 * Why one module: the orchestrator kept its own copy of the prompt, and it drifted
 * to 3.2K chars against the worker's 10.3K, with no responseSchema and
 * maxOutputTokens 2048. PR #5238 measured the WORKER's request on the Batch API;
 * flipping IMAGE_EXTRACTION_USE_BATCH on 2026-09-30 sent the drifted one instead,
 * and the collector (which expected a bare array) dropped scan_quality.
 *
 * Plain-string schema types ('object', 'string', ...) are exactly the values of the
 * SDK's SchemaType enum, so the same object serves @google/generative-ai (worker)
 * and the REST/JSONL batch request (orchestrator, eval).
 *
 * PRIOR ART: src/lib/image-extraction.ts — the TS captioner used by the Next app;
 * it cannot be imported from a Node .mjs worker and is an older, array-only
 * request. The worker's own copy was the source of truth until this module.
 */

import { buildPageGrounding } from './page-grounding.mjs';

export const SCAN_QUALITY_VERSION = 2;

/** Pages each side of an illustration read for surrounding narrative (#2707). */
export const GROUNDING_RADIUS = 3;

export const SAFETY_SETTINGS = [
  'HARM_CATEGORY_HARASSMENT',
  'HARM_CATEGORY_HATE_SPEECH',
  'HARM_CATEGORY_SEXUALLY_EXPLICIT',
  'HARM_CATEGORY_DANGEROUS_CONTENT',
  'HARM_CATEGORY_CIVIC_INTEGRITY',
].map(category => ({ category, threshold: 'BLOCK_NONE' }));

/** Book metadata as a hint. The softened wording is the #2705 fix: book topic is
 *  background, never licence to assert a subject that is not visible or named in
 *  the page text (the "wrestlers → gymnosophists" confabulation). The worker had
 *  kept the older bare "BOOK CONTEXT:" header; the orchestrator and the TS
 *  captioner had the fix. */
export function buildBookContextPrefix(book) {
  const parts = [];
  if (book?.title) parts.push(`Book: "${book.title}"`);
  if (book?.author) parts.push(`Author: ${book.author}`);
  if (book?.year) parts.push(`Year: ${book.year}`);
  if (book?.language) parts.push(`Language: ${book.language}`);
  if (book?.subjects?.length) parts.push(`Subjects: ${book.subjects.join(', ')}`);
  if (parts.length === 0) return '';
  return `BOOK CONTEXT (background only — a hint for reading inscriptions and recognising a tradition; do NOT assert a person, figure, or scene unless it is actually visible in THIS image or named in the PAGE TEXT below — a book about a subject does not mean every illustration depicts it):\n${parts.join(' | ')}\n\n`;
}

/** Neighbour pages (page_number ± GROUNDING_RADIUS) shaped for buildPageGrounding().
 *  `pagesByNumber` maps page_number → a page doc with ocr.data / translation.data.
 *  Neighbours need NOT be illustration pages — they supply the surrounding
 *  narrative (or, when blank, trigger the book-summary fallback). */
export function neighborsFor(pageNumber, pagesByNumber) {
  if (typeof pageNumber !== 'number' || !pagesByNumber) return [];
  const out = [];
  for (let n = pageNumber - GROUNDING_RADIUS; n <= pageNumber + GROUNDING_RADIUS; n++) {
    if (n === pageNumber) continue;
    const p = pagesByNumber.get(n);
    if (p) out.push({ page_number: n, ocr: p.ocr?.data, translation: p.translation?.data });
  }
  return out;
}

/** The whole text part of one page's request: book context + prompt + page grounding. */
export function buildImageExtractionText({ book, page, pagesByNumber, bookSummary }) {
  const grounding = buildPageGrounding({
    ocr: page?.ocr?.data,
    translation: page?.translation?.data,
    pageNumber: page?.page_number,
    neighbors: neighborsFor(page?.page_number, pagesByNumber),
    bookSummary: bookSummary ?? book?.summary ?? '',
    radius: GROUNDING_RADIUS,
  });
  return buildBookContextPrefix(book) + IMAGE_EXTRACTION_PROMPT + grounding;
}

/** generationConfig for every image-extraction call, realtime or batch. */
export function imageExtractionGenerationConfig() {
  return {
    temperature: 0.1,
    maxOutputTokens: 4096,
    responseMimeType: 'application/json',
    responseSchema: RESPONSE_SCHEMA,
    thinkingConfig: { thinkingBudget: 0 },
  };
}

/** One Batch API request body (the `request` of a JSONL line). */
export function buildImageExtractionBatchRequest({ text, image }) {
  return {
    contents: [{
      parts: [
        { text },
        { inlineData: { mimeType: image.mimeType, data: image.data } },
      ],
    }],
    safetySettings: SAFETY_SETTINGS,
    generationConfig: imageExtractionGenerationConfig(),
  };
}

// Structured-output schema. Forces scan_quality to be present as an object with the
// required fields populated; extracted_images is left loosely shaped because its
// per-item structure is bigger than we want to constrain at the schema layer
// (the prompt + downstream parser handle that).
export const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    scan_quality: {
      type: 'object',
      properties: {
        scan_score: { type: 'integer' },
        scan_class: { type: 'string' },
        readable_text: { type: 'boolean' },
        illustration_fidelity: { type: 'string' },
        page_completeness: { type: 'string' },
        concerns: { type: 'array', items: { type: 'string' } },
        reasoning: { type: 'string' },
      },
      required: ['scan_score', 'scan_class', 'readable_text', 'page_completeness', 'concerns', 'reasoning'],
    },
    extracted_images: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          description: { type: 'string' },
          type: { type: 'string' },
          bbox: {
            type: 'object',
            properties: {
              x: { type: 'number' },
              y: { type: 'number' },
              width: { type: 'number' },
              height: { type: 'number' },
            },
            required: ['x', 'y', 'width', 'height'],
          },
          // Turn (clockwise degrees) needed to make the illustration upright. Plates bound
          // sideways (Talhoffer's fight book: every plate is a fencer lying on his side)
          // reached the gallery unrotated for a year because nothing asked for this —
          // gallery-doc.mjs carried `rotation` and the thumbnail route honoured it, but no
          // writer ever produced it (#4780 spot check, 2026-09-15: 1 row corpus-wide).
          rotation: { type: 'number' },
          confidence: { type: 'number' },
          gallery_quality: { type: 'number' },
          gallery_rationale: { type: 'string' },
          metadata: {
            type: 'object',
            properties: {
              subjects: { type: 'array', items: { type: 'string' } },
              figures: { type: 'array', items: { type: 'string' } },
              symbols: { type: 'array', items: { type: 'string' } },
              style: { type: 'string' },
              technique: { type: 'string' },
            },
          },
          museum_description: { type: 'string' },
        },
        // Mark the load-bearing fields required so the model can't emit
        // placeholder items with all-null fields. Without this, Gemini
        // occasionally returned `extracted_images: [{}, {}, {}]` on pages
        // it couldn't analyze, which our parser then defaulted to empty
        // strings and `'unknown'` — the "zombie row" symptom (PR #2014).
        required: ['description', 'type', 'bbox', 'gallery_quality', 'gallery_rationale'],
      },
    },
  },
  required: ['scan_quality', 'extracted_images'],
};

export const IMAGE_EXTRACTION_PROMPT = `You are a museum curator analyzing a historical book page scan. Extract only significant illustrations — skip decorative elements like ornaments, borders, printer's marks, and initials.

BOUNDING BOX (0.0-1.0 normalized coordinates):
- x: LEFT edge (0=left, 1=right), y: TOP edge (0=top, 1=bottom)
- width, height: span of illustration
- TIGHTLY enclose the illustration only

IMAGE TYPES (use these exactly):
- emblem: Symbolic/allegorical with motto, often framed
- woodcut: Bold relief print lines
- engraving: Fine detailed intaglio lines, crosshatching
- portrait: Depiction of a person
- frontispiece: Decorative title page illustration
- musical_score: Sheet music, notation, fugues (NOT "table")
- diagram: Technical/scientific illustration
- symbol: Alchemical, astrological symbols
- map: Geographic representation

GRID LAYOUTS — IMPORTANT:
If the page contains a grid or matrix of small images, symbols, or sigils (e.g. a wall of
24 Goetia seals in 6×4 cells, a table of alchemical glyphs, a plate of musical fragments),
extract THE ENTIRE GRID as a single illustration (one bbox covering the whole matrix).
Do NOT skip a page just because no element is individually large. Type these as
diagram, symbol, or emblem depending on content.

SKIP these — do NOT include them:
- Page ornaments, borders, decorative initials, printer's devices
- Marbled papers, blank frames, ruled lines
- Any element that is purely decorative with no intellectual content

If the page contains no significant illustrations, return \`extracted_images: []\` — an empty array. Do NOT return placeholder objects with missing or null fields. Either fill in every field (description, type, bbox, confidence, gallery_quality, gallery_rationale) for an illustration, or omit it entirely.

For each significant illustration return ("rotation" is the clockwise turn in degrees — 0, 90, 180 or 270 — needed to make the illustration upright as printed; plates bound sideways in a book are common, so look at the figures and any lettering inside the illustration, not at the page):
{
  "description": "Brief factual description",
  "type": "emblem|woodcut|engraving|portrait|frontispiece|musical_score|diagram|symbol|map|exlibris",
  "bbox": { "x": 0.15, "y": 0.25, "width": 0.70, "height": 0.45 },
  "rotation": 0,
  "confidence": 0.95,
  "gallery_quality": 0.85,
  "gallery_rationale": "Why gallery-worthy or not",
  "metadata": {
    "subjects": ["alchemy", "transformation"],
    "figures": ["old man", "serpent"],
    "symbols": ["ouroboros", "athanor"],
    "style": "Northern European Renaissance",
    "technique": "woodcut"
  },
  "museum_description": "A robed figure holds a serpent that bites its own tail while standing over a lit furnace. The ouroboros and the athanor identify the scene as one of alchemical transmutation."
}

GALLERY QUALITY (0.0-1.0):
- 0.9-1.0: Exceptional emblems, portraits, allegorical scenes with figures
- 0.8-0.9: Illustrations with people/figures
- 0.6-0.8: Good illustrations without people
- 0.4-0.6: Musical scores, alchemical symbols

MUSEUM DESCRIPTION: Write 2-3 plain sentences for a museum label: first what the viewer sees, then what it depicts or means. Name concrete things. Do NOT use promotional or filler language. Avoid the words "serves as", "stands as", "a testament to", "renowned", "profound", "delve", "intricate", "vibrant", "compelling", "exemplifies", "masterful", and the construction "not only X but also Y". State what is shown, not how significant it is.

────────────────────────────────────────────────────────────────────────────────
PAGE-LEVEL SCAN QUALITY (technical, not curatorial)
────────────────────────────────────────────────────────────────────────────────
Independently of the illustrations above, assess the TECHNICAL DIGITIZATION QUALITY
of the page itself. This is about HOW the page was scanned/photographed, not
whether the content is important.

scan_score (0-100):
  90-100 = pristine, sharp, full tonal range, faithful to original
  70-89  = solid working scan, minor artifacts
  50-69  = noticeable degradation but content preserved
  30-49  = severe degradation, content partially lost
  0-29   = unusable (blank, corrupt, fragment)

scan_class — use exactly one:
  color_photo       — full-color photograph of original (modern archival)
  color_print       — color scan of a color print
  grayscale_photo   — high-bit grayscale photo of original (manuscripts often)
  grayscale_print   — grayscale scan of printed page
  bitonal_clean     — pure black/white, sharp. DEFAULT for any bitonal page where strokes
                      are continuous and edges are clean — includes woodcuts, engravings,
                      letterpress text, and modern OCR-ready bitonal scans, REGARDLESS of
                      age. A 1500 woodcut is bitonal_clean. A 1900 letterpress page is
                      bitonal_clean.
  bitonal_microfilm — bitonal page reproduced via microfilm or scan-of-scan. Use this
                      class if you see ANY of these signatures (one is enough):
                        (a) UNIFORM GRAY background instead of white — the page background
                            is grey or yellow-gray rather than paper-white. This is the
                            single most reliable signal: a real book page on a flatbed
                            scanner produces a near-white background; a microfilm frame
                            produces uniform gray from the reader's illumination.
                        (b) visible high-frequency speckling ("pepper noise") in flat areas
                        (c) jagged or broken edges around characters and dark shapes
                        (d) "Digitized by Google" or similar Google Books footer on an
                            older monochrome scan (these were almost all microfilm-sourced)
                      A microfilm scan can be high-resolution and still microfilm —
                      megapixel count is not a defense against this class. Modern OCR-ready
                      scans of CLEAN bitonal originals have white (not gray) backgrounds
                      and crisp edges; those are bitonal_clean.
  microfiche        — bitonal_microfilm + visible mottling, dark patches, or uneven
                      illumination across the page caused by the microfilm reader
  scanner_metadata  — the page is NOT a book page at all — it is a calibration target,
                      color reference card, ruler, scanner-bed test pattern, or other
                      digitization-process artifact accidentally captured as a page.
                      Score these in the 5-25 range; they are not "broken scans" but
                      they are not content either.
  blank             — page is empty or near-empty (no usable content)
  corrupt           — broken file, partial capture due to scan failure, or shows the
                      scanner bed/background instead of a placed page

Distinguishing bitonal_clean from bitonal_microfilm is the MOST IMPORTANT classification
call. The decisive question: is the page background WHITE (clean) or GRAY (microfilm)?
A 1500 woodcut on white paper photographed by a flatbed scanner is bitonal_clean.
A 1500 woodcut photographed onto microfilm and then digitized off the microfilm reader
is bitonal_microfilm — even if the woodcut itself looks sharp. The background tells you.

page_completeness:
  full_page          — single page captured fully
  partial_capture    — page clearly cropped/cut off
  two_pages_one_image — facing pages captured as one image (folio scan defect)
  fragment           — only a small portion of any page is captured
  blank              — captured but page is empty

illustration_fidelity (assess only if illustrations are present):
  pristine | good | degraded | destroyed | no_illustration

concerns: list any of these that apply, exact strings only:
  bleed_through, gutter_shadow, page_skew, fold_distortion, low_resolution,
  scan_of_scan, pepper_noise, faded_text, faded_color, water_damage, yellow_tone,
  out_of_focus, uneven_illumination, wrong_orientation, partial_capture,
  blank_page, scanner_bed_visible, two_pages_captured, compression_artifacts, color_cast

────────────────────────────────────────────────────────────────────────────────
OUTPUT FORMAT
────────────────────────────────────────────────────────────────────────────────
Return ONLY a single valid JSON object with this exact shape — scan_quality FIRST,
extracted_images SECOND:

{
  "scan_quality": {
    "scan_score": <int>,
    "scan_class": "<one of the values above>",
    "readable_text": <true|false>,
    "illustration_fidelity": "<one of the values above>",
    "page_completeness": "<one of the values above>",
    "concerns": [ "...", "..." ],
    "reasoning": "<1-2 sentence justification>"
  },
  "extracted_images": [ /* array of illustration objects as specified above; [] if none */ ]
}

CRITICAL: scan_quality MUST be present in every response, with all six fields populated.
This is true even when:
  - the page is blank → scan_class: blank, score: 0, extracted_images: []
  - the page is a scanner calibration card → scan_class: scanner_metadata
  - the page is pure text with no illustrations → scan_class: <whatever fits>, extracted_images: []
  - the page is corrupt → scan_class: corrupt, extracted_images: []
Never omit scan_quality. Never return only extracted_images.

INTERNAL CONSISTENCY RULES — your response must satisfy ALL of these:
  1. If "concerns" contains "pepper_noise", "scan_of_scan", or "compression_artifacts",
     scan_class MUST be "bitonal_microfilm" or "microfiche" — never "bitonal_clean".
     These concerns are themselves evidence of microfilm origin; classifying as clean
     while flagging them is contradictory.
  2. If "page_completeness" is "partial_capture" or "fragment", scan_class should be
     "corrupt" (use blank only if the captured fragment is also blank).
  3. If "page_completeness" is "blank", scan_class MUST be "blank" and scan_score MUST be 0-10.
  4. If scan_class is "blank" or "scanner_metadata", readable_text MUST be false.

Re-read your scan_quality block before finalizing. If any of these rules is violated,
fix the scan_class to match the evidence in concerns/completeness, not the other way around.`;

const VALID_SCAN_CLASSES = new Set([
  'color_photo', 'color_print', 'grayscale_photo', 'grayscale_print',
  'bitonal_clean', 'bitonal_microfilm', 'microfiche',
  'scanner_metadata', 'blank', 'corrupt',
]);
const VALID_FIDELITY = new Set([
  'pristine', 'good', 'degraded', 'destroyed', 'no_illustration',
]);
const VALID_COMPLETENESS = new Set([
  'full_page', 'partial_capture', 'two_pages_one_image', 'fragment', 'blank',
]);

// Concerns that are themselves microfilm-origin evidence. If Gemini lists any of these
// AND classifies bitonal_clean, the response is internally contradictory — the concerns
// are the more trustworthy signal (the model saw the artifact), so we downgrade the class.
const MICROFILM_CONCERNS = new Set(['pepper_noise', 'scan_of_scan', 'compression_artifacts']);

export function normalizeScanQuality(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const score = Math.max(0, Math.min(100, parseInt(raw.scan_score, 10) || 0));
  let cls = VALID_SCAN_CLASSES.has(raw.scan_class) ? raw.scan_class : null;
  const fidelity = VALID_FIDELITY.has(raw.illustration_fidelity) ? raw.illustration_fidelity : null;
  const completeness = VALID_COMPLETENESS.has(raw.page_completeness) ? raw.page_completeness : null;
  const concerns = Array.isArray(raw.concerns)
    ? raw.concerns.filter(c => typeof c === 'string').slice(0, 20)
    : [];

  // Backstop enforcement of the cross-field consistency rules from the prompt.
  // Gemini occasionally still produces contradictory output (microfilm concerns
  // listed alongside bitonal_clean class); when it does, fix the class to match.
  const microfilmEvidence = concerns.some(c => MICROFILM_CONCERNS.has(c));
  let corrected = null;
  if (cls === 'bitonal_clean' && microfilmEvidence) {
    cls = 'bitonal_microfilm';
    corrected = 'bitonal_clean_with_microfilm_concerns';
  }
  if ((completeness === 'partial_capture' || completeness === 'fragment')
      && cls && !['corrupt', 'blank', 'scanner_metadata'].includes(cls)) {
    cls = 'corrupt';
    corrected = (corrected ? corrected + '+' : '') + 'incomplete_with_content_class';
  }
  if (completeness === 'blank' && cls !== 'blank' && cls !== 'scanner_metadata') {
    cls = 'blank';
    corrected = (corrected ? corrected + '+' : '') + 'blank_completeness_with_content_class';
  }

  return {
    scan_score: score,
    scan_class: cls,
    readable_text: raw.readable_text === true,
    illustration_fidelity: fidelity,
    page_completeness: completeness,
    concerns,
    reasoning: typeof raw.reasoning === 'string' ? raw.reasoning.slice(0, 600) : '',
    ...(corrected ? { class_corrected: corrected } : {}),
  };
}

// Backwards-compatible parser: accepts the new {extracted_images, scan_quality}
// object form, and falls back to bare-array form if the model regresses.
export function parseImageExtractionResponse(text) {
  const empty = { extracted_images: [], scan_quality: null };
  if (!text || typeof text !== 'string') return empty;
  const cleaned = text.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
  // Try object form first
  const objMatch = cleaned.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try {
      const parsed = JSON.parse(objMatch[0]);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return {
          extracted_images: Array.isArray(parsed.extracted_images) ? parsed.extracted_images : [],
          scan_quality: normalizeScanQuality(parsed.scan_quality),
        };
      }
    } catch { /* fall through to array form */ }
  }
  // Fallback: legacy array-only response
  const arrMatch = cleaned.match(/\[[\s\S]*\]/);
  if (arrMatch) {
    try {
      const parsed = JSON.parse(arrMatch[0]);
      return { extracted_images: Array.isArray(parsed) ? parsed : [], scan_quality: null };
    } catch { /* nope */ }
  }
  return empty;
}

// ── Phase 2: book-level scan_quality rollup ──
// Aggregates pages.scan_quality (v2) into a book-level summary that downstream
// use cases (dedupe tiebreaker, re-source queue, provider dashboards) can query
// directly. Preserves legacy { score, classification } fields for backwards
// compat with enhance-scan-quality.mjs.

const CONTENT_SCAN_CLASSES = new Set([
  'color_photo', 'color_print',
  'grayscale_photo', 'grayscale_print',
  'bitonal_clean', 'bitonal_microfilm', 'microfiche',
]);

function legacyClassificationFor(dominantClass) {
  if (['bitonal_clean', 'bitonal_microfilm', 'microfiche'].includes(dominantClass)) return 'bw';
  if (['grayscale_photo', 'grayscale_print'].includes(dominantClass)) return 'grayscale';
  if (['color_photo', 'color_print'].includes(dominantClass)) return 'color';
  return null;
}

export async function computeBookScanQualityRollup(db, bookId) {
  const pages = await db.collection('pages').find(
    { book_id: bookId, 'scan_quality.version': 2 },
    {
      projection: {
        id: 1, page_number: 1,
        'scan_quality.scan_score': 1,
        'scan_quality.scan_class': 1,
        'scan_quality.page_completeness': 1,
        'scan_quality.concerns': 1,
        'scan_quality.illustration_fidelity': 1,
        'scan_quality.class_corrected': 1,
        'image_characteristics.megapixels': 1,
        'image_characteristics.sharpness_var': 1,
        'image_characteristics.flags': 1,
      },
    },
  ).toArray();

  if (pages.length === 0) return null;

  const scores = pages
    .map(p => p.scan_quality?.scan_score)
    .filter(s => typeof s === 'number')
    .sort((a, b) => a - b);
  if (scores.length === 0) return null;

  const median = scores[Math.floor(scores.length / 2)];
  const min = scores[0];
  const max = scores[scores.length - 1];

  const classCounts = {};
  const concernCounts = {};
  let classCorrectedCount = 0;
  let completenessIssues = 0;

  for (const p of pages) {
    const sq = p.scan_quality;
    if (!sq) continue;
    if (sq.scan_class) classCounts[sq.scan_class] = (classCounts[sq.scan_class] || 0) + 1;
    for (const c of (sq.concerns || [])) {
      concernCounts[c] = (concernCounts[c] || 0) + 1;
    }
    if (sq.class_corrected) classCorrectedCount++;
    if (sq.page_completeness && sq.page_completeness !== 'full_page') completenessIssues++;
  }

  // Dominant class — most-frequent across all v2 pages
  const classEntries = Object.entries(classCounts).sort((a, b) => b[1] - a[1]);
  const dominantClass = classEntries[0]?.[0] || null;

  // Content-page pointers (ignore blank / scanner_metadata / corrupt for worst/best — those
  // are noise pages, not content quality signals)
  const contentPages = pages
    .filter(p => CONTENT_SCAN_CLASSES.has(p.scan_quality?.scan_class))
    .filter(p => typeof p.scan_quality?.scan_score === 'number')
    .sort((a, b) => a.scan_quality.scan_score - b.scan_quality.scan_score);
  const worstImage = contentPages[0]
    ? {
        page_id: contentPages[0].id,
        page_number: contentPages[0].page_number,
        scan_score: contentPages[0].scan_quality.scan_score,
        scan_class: contentPages[0].scan_quality.scan_class,
        concerns: contentPages[0].scan_quality.concerns || [],
      }
    : null;
  const bestImage = contentPages.length
    ? {
        page_id: contentPages[contentPages.length - 1].id,
        page_number: contentPages[contentPages.length - 1].page_number,
        scan_score: contentPages[contentPages.length - 1].scan_quality.scan_score,
        scan_class: contentPages[contentPages.length - 1].scan_quality.scan_class,
      }
    : null;

  return {
    // ── legacy fields for backwards compat (enhance-scan-quality.mjs, audit-scan-quality.mjs) ──
    score: median,
    classification: legacyClassificationFor(dominantClass),

    // ── v2 rollup fields ──
    median_score: median,
    min_score: min,
    max_score: max,
    pages_assessed: pages.length,
    content_pages_assessed: contentPages.length,
    dominant_scan_class: dominantClass,
    class_distribution: classCounts,
    concerns_distribution: concernCounts,
    has_microfilm_pages: !!(classCounts.bitonal_microfilm || classCounts.microfiche),
    has_blank_pages: !!classCounts.blank,
    has_scanner_metadata_pages: !!classCounts.scanner_metadata,
    has_corrupt_pages: !!classCounts.corrupt,
    completeness_issues_count: completenessIssues,
    class_corrected_count: classCorrectedCount,
    worst_image: worstImage,
    best_image: bestImage,
    rollup_at: new Date(),
    version: SCAN_QUALITY_VERSION,
  };
}
