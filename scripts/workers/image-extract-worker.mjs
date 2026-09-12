#!/usr/bin/env node
/**
 * Hetzner Realtime Image Extraction Worker
 *
 * Extracts illustrations from book page scans via direct Gemini generateContent calls.
 * Replaces the Batch API path which was blocked by batch quota limits while
 * only using 0.6% of available RPM capacity.
 *
 * Architecture:
 * - Picks up books in 'chapters_complete' status (or catch-up books)
 * - Downloads page images and calls Gemini Flash vision per page
 * - Writes detected_images to pages + gallery_images collection
 * - Advances pipeline status to 'images_complete'
 * - Runs on Hetzner cron via scheduler
 */

import { MongoClient } from 'mongodb';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import { getPageSource as getPageImageUrl } from '../lib/page-image-url.mjs';
import { buildGalleryDoc } from '../lib/gallery-doc.mjs';
import { buildPageGrounding } from '../lib/page-grounding.mjs';
import { nanoid } from 'nanoid';
import sharp from 'sharp';
import { logUsage, outputTokensFrom } from './lib/supabase-usage-logger.mjs';
import { shouldBypassPause, hasScope, resolveScopeBookIds } from './lib/selective-unpause.mjs';
import { budgetAllowsDispatchScoped } from '../lib/spend-guard.mjs';

// Structured-output schema. Forces scan_quality to be present as an object with the
// required fields populated; extracted_images is left loosely shaped because its
// per-item structure is bigger than we want to constrain at the schema layer
// (the prompt + downstream parser handle that).
const RESPONSE_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    scan_quality: {
      type: SchemaType.OBJECT,
      properties: {
        scan_score: { type: SchemaType.INTEGER },
        scan_class: { type: SchemaType.STRING },
        readable_text: { type: SchemaType.BOOLEAN },
        illustration_fidelity: { type: SchemaType.STRING },
        page_completeness: { type: SchemaType.STRING },
        concerns: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
        reasoning: { type: SchemaType.STRING },
      },
      required: ['scan_score', 'scan_class', 'readable_text', 'page_completeness', 'concerns', 'reasoning'],
    },
    extracted_images: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          description: { type: SchemaType.STRING },
          type: { type: SchemaType.STRING },
          bbox: {
            type: SchemaType.OBJECT,
            properties: {
              x: { type: SchemaType.NUMBER },
              y: { type: SchemaType.NUMBER },
              width: { type: SchemaType.NUMBER },
              height: { type: SchemaType.NUMBER },
            },
            required: ['x', 'y', 'width', 'height'],
          },
          confidence: { type: SchemaType.NUMBER },
          gallery_quality: { type: SchemaType.NUMBER },
          gallery_rationale: { type: SchemaType.STRING },
          metadata: {
            type: SchemaType.OBJECT,
            properties: {
              subjects: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
              figures: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
              symbols: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
              style: { type: SchemaType.STRING },
              technique: { type: SchemaType.STRING },
            },
          },
          museum_description: { type: SchemaType.STRING },
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

const SCAN_QUALITY_VERSION = 2;
sharp.concurrency(1);

// ── Config ──
const CONCURRENCY = 25;           // Books processed simultaneously
const PAGE_CONCURRENCY = 10;      // Pages per book processed simultaneously
const IMAGE_DOWNLOAD_CONCURRENCY = 40;
const BOOKS_PER_RUN = 250;
const RUN_DEADLINE_MS = 25 * 60 * 1000; // 25 min deadline (scheduler runs every 2 min)
const MODEL = 'gemini-3-flash-preview'; // Vision task needs accuracy
const IMAGE_CANDIDATE_PAGE_TYPES = ['illustration', 'diagram', 'map', 'frontispiece', 'mixed', 'title-page'];

// Pages whose <image-desc> tags are ALL one of these (type, significance) combos
// can be skipped — OCR has already classified them as trivial (drop caps, library
// stamps, printer's marks, blank-page framing, decorative initials). Spot-checked
// on 8,033 never-extracted visible books — these categories never contain real
// gallery-worthy illustrations. Saves ~60% of the vision-call budget.
//
// Rules with `*` match any significance value.
const SKIP_MARKUP_RULES = [
  { type: 'symbol', significance: '*' },          // yig-mgo marks, library stamps
  { type: 'stamp', significance: '*' },
  { type: 'ornament', significance: '*' },        // printer's ornaments, tailpieces
  { type: 'blank', significance: '*' },
  { type: 'exlibris', significance: '*' },        // ownership bookplates — provenance, not content
  { type: 'bookplate', significance: '*' },
  { type: 'decorative', significance: 'low' },    // drop caps, framing rules
  { type: "printer's mark", significance: 'low' },
  { type: 'photograph', significance: 'low' },    // binding/fore-edge photos
  { type: 'photographic', significance: 'low' },
];

function shouldSkipPageByMarkup(ocrData) {
  if (!ocrData) return false;
  // If the page has <detected-images> JSON, never skip (we want to parse it).
  if (ocrData.includes('<detected-images>')) return false;
  const tags = [...ocrData.matchAll(/<image-desc([^>]*)>/g)];
  if (tags.length === 0) return false; // no markup to judge by — extract
  for (const m of tags) {
    const type = (m[1].match(/type="([^"]+)"/) || [])[1];
    const sig = (m[1].match(/significance="([^"]+)"/) || [])[1];
    const matchedRule = SKIP_MARKUP_RULES.find(r =>
      r.type === type && (r.significance === '*' || r.significance === sig)
    );
    if (!matchedRule) return false; // at least one tag is non-trivial — extract
  }
  return true; // every tag matched a skip rule
}

// ── API Keys (exclude free tier KEY_4) ──
const API_KEYS = [
  process.env.GEMINI_API_KEY,
  ...Array.from({ length: 9 }, (_, i) => {
    if (i + 2 === 4) return null; // Skip KEY_4 (free tier)
    return process.env[`GEMINI_API_KEY_${i + 2}`];
  }),
  process.env.GEMINI_API_KEY_TIER3,
].filter(Boolean);

if (API_KEYS.length === 0) {
  console.error('[IMAGE-EXTRACT] No Gemini API keys configured');
  process.exit(1);
}

let _keyIndex = 0;
function getClient() {
  return new GoogleGenerativeAI(API_KEYS[_keyIndex % API_KEYS.length]);
}
function rotateKey() {
  _keyIndex++;
  console.log(`[IMAGE-EXTRACT] Rotated to key ${(_keyIndex % API_KEYS.length) + 1}/${API_KEYS.length}`);
}

// ── Prompt (same as orchestrator) ──
const IMAGE_EXTRACTION_PROMPT = `You are a museum curator analyzing a historical book page scan. Extract only significant illustrations — skip decorative elements like ornaments, borders, printer's marks, and initials.

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

For each significant illustration return:
{
  "description": "Brief factual description",
  "type": "emblem|woodcut|engraving|portrait|frontispiece|musical_score|diagram|symbol|map|exlibris",
  "bbox": { "x": 0.15, "y": 0.25, "width": 0.70, "height": 0.45 },
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

// ── Helpers ──
// getPageImageUrl is imported from the shared resolver (#1727) — see top of file.

async function fetchImage(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) return null;
    const arrayBuf = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuf);
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    return {
      buffer,
      data: buffer.toString('base64'),
      mimeType: contentType.split(';')[0].trim(),
    };
  } catch {
    return null;
  }
}

// Layer 1 deterministic characteristics — sharp pixel-stats + Laplacian variance,
// histogram entropy, bimodality, chroma spread. Returns null on decode failure.
async function computeImageCharacteristics(buffer) {
  try {
    const [meta, stats] = await Promise.all([
      sharp(buffer).metadata(),
      sharp(buffer).stats(),
    ]);
    const ch = stats.channels;
    if (!ch || ch.length === 0) return null;

    const numChannels = ch.length;
    const meanBrightness = ch.reduce((s, c) => s + c.mean, 0) / numChannels;
    const meanStdev = ch.reduce((s, c) => s + c.stdev, 0) / numChannels;
    const dynamicRange = Math.max(...ch.map(c => c.max - c.min));
    const chromaSpread = numChannels >= 3
      ? Math.max(
          Math.abs(ch[0].mean - ch[1].mean),
          Math.abs(ch[1].mean - ch[2].mean),
          Math.abs(ch[0].mean - ch[2].mean),
        )
      : 0;

    // Downsample once to grayscale for Laplacian + entropy + bimodality.
    const small = await sharp(buffer)
      .resize(512, null, { fit: 'inside' })
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const { data, info } = small;
    const w = info.width;
    const h = info.height;

    let lapSum = 0, lapSumSq = 0, lapN = 0;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const lap = -4 * data[i] + data[i - 1] + data[i + 1] + data[i - w] + data[i + w];
        lapSum += lap;
        lapSumSq += lap * lap;
        lapN++;
      }
    }
    const lapMean = lapN ? lapSum / lapN : 0;
    const sharpnessVar = lapN ? lapSumSq / lapN - lapMean * lapMean : 0;

    const hist = new Array(256).fill(0);
    for (let i = 0; i < data.length; i++) hist[data[i]]++;
    let entropy = 0;
    for (const c of hist) {
      if (c) {
        const p = c / data.length;
        entropy -= p * Math.log2(p);
      }
    }
    const sortedHist = [...hist].sort((a, b) => b - a);
    const bimodality = (sortedHist[0] + sortedHist[1]) / data.length;

    const pixels = (meta.width || 1) * (meta.height || 1);
    const bytesPerPixel = buffer.length / pixels;
    const megapixels = pixels / 1_000_000;

    const flags = {
      is_blank: dynamicRange < 5 && sharpnessVar < 10,
      is_monochrome: chromaSpread < 5,
      is_bitonal: bimodality > 0.5 && entropy < 4,
      is_over_compressed: bytesPerPixel < 0.015,
      is_low_resolution: megapixels < 1,
    };

    return {
      width: meta.width,
      height: meta.height,
      megapixels: Math.round(megapixels * 100) / 100,
      bytes_per_pixel: Math.round(bytesPerPixel * 1000) / 1000,
      mean_brightness: Math.round(meanBrightness * 10) / 10,
      mean_stdev: Math.round(meanStdev * 10) / 10,
      dynamic_range: dynamicRange,
      chroma_spread: Math.round(chromaSpread * 10) / 10,
      sharpness_var: Math.round(sharpnessVar),
      histogram_entropy: Math.round(entropy * 100) / 100,
      bimodality: Math.round(bimodality * 1000) / 1000,
      flags,
      version: SCAN_QUALITY_VERSION,
    };
  } catch {
    return null;
  }
}

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

function normalizeScanQuality(raw) {
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
function parseImageExtractionResponse(text) {
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

function normalizeBbox(raw) {
  const x = parseFloat(raw.x) || 0;
  const y = parseFloat(raw.y) || 0;
  const width = parseFloat(raw.width) || 0;
  const height = parseFloat(raw.height) || 0;
  if (x > 1 || y > 1 || width > 1 || height > 1) {
    const scale = Math.max(x + width, y + height, 1000);
    return {
      x: Math.min(x / scale, 0.95),
      y: Math.min(y / scale, 0.95),
      width: Math.min(width / scale, 1),
      height: Math.min(height / scale, 1),
    };
  }
  return { x, y, width, height };
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

async function computeBookScanQualityRollup(db, bookId) {
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

async function setPipelineStatus(db, bookId, status, extra = {}) {
  const update = {
    'pipeline_auto.status': status,
    'pipeline_auto.updated_at': new Date(),
    updated_at: new Date(),
    ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k.startsWith('pipeline_auto.') ? k : `pipeline_auto.${k}`, v])),
  };
  // Also set legacy pipeline_status
  update.pipeline_status = status;
  await db.collection('books').updateOne({ id: bookId }, { $set: update });
}

async function revalidateBookPage(bookId) {
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (process.env.REVALIDATE_SECRET) headers['x-revalidate-secret'] = process.env.REVALIDATE_SECRET;
    await fetch(`https://sourcelibrary.org/api/admin/revalidate-book/${bookId}`, { method: 'POST', headers });
  } catch { /* best-effort */ }
}

// ── Process one page ──
const GROUNDING_RADIUS = 3; // pages each side scanned for substantive neighbour text

/** Window of nearby page docs (page_number ± GROUNDING_RADIUS) for a page,
 *  shaped for buildPageGrounding(). Neighbours need NOT be illustration pages —
 *  they supply the surrounding narrative (or, when blank, trigger the book-summary
 *  fallback). */
function neighborsFor(pageNumber, pagesByNumber) {
  if (typeof pageNumber !== 'number') return [];
  const out = [];
  for (let n = pageNumber - GROUNDING_RADIUS; n <= pageNumber + GROUNDING_RADIUS; n++) {
    if (n === pageNumber) continue;
    const p = pagesByNumber.get(n);
    if (p) out.push({ page_number: n, ocr: p.ocr?.data, translation: p.translation?.data });
  }
  return out;
}

async function extractImagesFromPage(page, prompt, groundingCtx) {
  const url = getPageImageUrl(page);
  if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) return null;

  const image = await fetchImage(url);
  if (!image) return null;

  // Layer 1 — deterministic characteristics from the raw buffer.
  // Run in parallel with the Gemini call to keep latency flat.
  const characteristicsPromise = computeImageCharacteristics(image.buffer);

  const model = getClient().getGenerativeModel({
    model: MODEL,
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'BLOCK_NONE' },
    ],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 4096,
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
      thinkingConfig: { thinkingBudget: 0 },
    },
  });

  const grounding = buildPageGrounding({
    ocr: page?.ocr?.data,
    translation: page?.translation?.data,
    pageNumber: page?.page_number,
    neighbors: neighborsFor(page?.page_number, groundingCtx?.pagesByNumber || new Map()),
    bookSummary: groundingCtx?.bookSummary || '',
    radius: GROUNDING_RADIUS,
  });

  const result = await model.generateContent([
    { text: prompt + grounding },
    { inlineData: { mimeType: image.mimeType, data: image.data } },
  ]);

  const response = result.response;
  const text = response.text();
  const usage = response.usageMetadata || {};
  const characteristics = await characteristicsPromise;

  return {
    pageId: page.id,
    page, // carry the page doc forward so the gallery materializer can read photo fields + page_number
    text,
    characteristics,
    inputTokens: usage.promptTokenCount || 0,
    outputTokens: outputTokensFrom(usage),
  };
}

// ── Process one book ──
async function processBook(db, book) {
  // Find candidate pages
  const rawCandidates = await db.collection('pages')
    .find({
      book_id: book.id,
      page_number: { $gt: 0 }, // Skip hidden/deduped trailing pages (page_number ≤ 0)
      $or: [
        { page_type: { $in: IMAGE_CANDIDATE_PAGE_TYPES } },
        { 'ocr.data': { $regex: '<detected-images>|<image-desc' } },
      ],
    }, { projection: { id: 1, page_number: 1, page_type: 1, photo: 1, photo_original: 1, archived_photo: 1, cropped_photo: 1, enhanced_photo: 1, crop: 1, split_from_spread: 1, 'ocr.data': 1, 'translation.data': 1 } })
    .toArray();

  // Pre-filter: drop pages where OCR has already classified all illustrations
  // as trivial (drop caps, library stamps, etc.) — saves the vision call.
  // Only apply to pages outside the IMAGE_CANDIDATE_PAGE_TYPES list, since
  // a page typed `illustration`/`frontispiece`/etc. is the page-typer's
  // affirmative judgment.
  let skippedTrivial = 0;
  const candidatePages = rawCandidates.filter(p => {
    const inCandidateType = IMAGE_CANDIDATE_PAGE_TYPES.includes(p.page_type);
    if (inCandidateType) return true;
    if (shouldSkipPageByMarkup(p.ocr?.data)) {
      skippedTrivial++;
      return false;
    }
    return true;
  });
  if (skippedTrivial > 0) {
    console.log(`  [${book.title?.slice(0, 50)}] skipped ${skippedTrivial} trivial-markup pages`);
  }

  if (candidatePages.length === 0) {
    await setPipelineStatus(db, book.id, 'images_complete');
    return { title: book.title, pages: 0, images: 0, skipped: true };
  }

  // Build prompt with book context
  const contextParts = [];
  if (book.title) contextParts.push(`Book: "${book.title}"`);
  if (book.author) contextParts.push(`Author: ${book.author}`);
  if (book.year) contextParts.push(`Year: ${book.year}`);
  if (book.language) contextParts.push(`Language: ${book.language}`);
  if (book.subjects?.length) contextParts.push(`Subjects: ${book.subjects.join(', ')}`);
  const contextPrefix = contextParts.length > 0
    ? `BOOK CONTEXT:\n${contextParts.join(' | ')}\n\n`
    : '';
  const prompt = contextPrefix + IMAGE_EXTRACTION_PROMPT;

  // Surrounding-text grounding (#2707): fetch the page window around each
  // illustration so the captioner can read the narrative the picture sits in.
  // Neighbours are usually NOT illustration pages (text / blank), so they need a
  // separate light fetch. One query per book over the union of windows. When an
  // illustration is isolated among blanks, buildPageGrounding falls back to the
  // book summary instead.
  const candidateNumbers = candidatePages.map(p => p.page_number).filter(n => typeof n === 'number');
  const windowNumbers = new Set();
  for (const n of candidateNumbers) {
    for (let d = -GROUNDING_RADIUS; d <= GROUNDING_RADIUS; d++) windowNumbers.add(n + d);
  }
  const pagesByNumber = new Map();
  if (windowNumbers.size > 0) {
    const windowPages = await db.collection('pages')
      .find(
        { book_id: book.id, page_number: { $in: [...windowNumbers] } },
        { projection: { page_number: 1, 'ocr.data': 1, 'translation.data': 1 } },
      )
      .toArray();
    for (const wp of windowPages) pagesByNumber.set(wp.page_number, wp);
  }
  const groundingCtx = { pagesByNumber, bookSummary: book.summary || '' };

  const now = new Date();
  let totalImages = 0;
  let pagesProcessed = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  const galleryDocs = [];
  const bulkOps = [];

  // Process pages with concurrency
  for (let i = 0; i < candidatePages.length; i += PAGE_CONCURRENCY) {
    const chunk = candidatePages.slice(i, i + PAGE_CONCURRENCY);
    const results = await Promise.allSettled(
      chunk.map(page => extractImagesFromPage(page, prompt, groundingCtx))
    );

    for (const settled of results) {
      if (settled.status !== 'fulfilled' || !settled.value) {
        if (settled.reason?.message?.includes('429') || settled.reason?.message?.includes('RESOURCE_EXHAUSTED')) {
          rotateKey();
        }
        continue;
      }

      const { pageId, page, text, characteristics, inputTokens, outputTokens } = settled.value;
      totalInputTokens += inputTokens;
      totalOutputTokens += outputTokens;
      pagesProcessed++;

      const { extracted_images: extractedRaw, scan_quality: scanQualityRaw } = parseImageExtractionResponse(text);

      // Build the page-level scan_quality object that will land on `pages` and
      // be inherited by each gallery_image extracted from this page.
      const pageScanQuality = scanQualityRaw
        ? {
            ...scanQualityRaw,
            model: MODEL,
            version: SCAN_QUALITY_VERSION,
            assessed_at: now,
          }
        : null;

      const pageSet = {
        image_extraction_updated_at: now,
        updated_at: now,
      };
      if (characteristics) pageSet.image_characteristics = characteristics;
      if (pageScanQuality) pageSet.scan_quality = pageScanQuality;

      if (extractedRaw.length > 0) {
        const detectedImages = extractedRaw.map(img => ({
          description: img.description || '',
          type: img.type || 'unknown',
          bbox: img.bbox ? normalizeBbox(img.bbox) : undefined,
          confidence: img.confidence,
          gallery_quality: typeof img.gallery_quality === 'number' ? img.gallery_quality : undefined,
          gallery_rationale: img.gallery_rationale || undefined,
          metadata: img.metadata || undefined,
          museum_description: img.museum_description || undefined,
          detected_at: now,
          detection_source: 'vision_model',
          model: MODEL,
        }));

        totalImages += detectedImages.length;
        pageSet.detected_images = detectedImages;

        // Filter matches src/workers/image-extraction-processor-logic.ts (SQS path):
        //  - bbox required (skips malformed responses / zombie rows)
        //  - gallery_quality must be present and >= QUALITY_THRESHOLD
        // Threshold is under review; coordinate any change with the SQS path
        // and scripts/workers/batch-collector.mjs.
        const QUALITY_THRESHOLD = 0.5;
        // Inherit page-level scan quality so the gallery_image carries it standalone.
        // Per-crop sharpness can be added later in a separate pass on extracted_url.
        const inheritedScanQuality = pageScanQuality
          ? {
              score: pageScanQuality.scan_score,
              scan_class: pageScanQuality.scan_class,
              illustration_fidelity: pageScanQuality.illustration_fidelity,
              page_completeness: pageScanQuality.page_completeness,
              concerns: pageScanQuality.concerns,
              source: 'page_inherited',
              version: SCAN_QUALITY_VERSION,
              assessed_at: now,
            }
          : null;
        const pageImageCharacteristics = characteristics
          ? {
              megapixels: characteristics.megapixels,
              sharpness_var: characteristics.sharpness_var,
              chroma_spread: characteristics.chroma_spread,
              flags: characteristics.flags,
            }
          : null;
        for (let di = 0; di < detectedImages.length; di++) {
          const img = detectedImages[di];
          if (!img.bbox) continue;
          if (typeof img.gallery_quality !== 'number') continue;
          if (img.gallery_quality < QUALITY_THRESHOLD) continue;
          // Build the fully-denormalized doc via the shared helper so the field
          // set stays identical across all writers (#2531). `page` is the source
          // page doc with photo fields + page_number; `book` carries visible/
          // hidden/provider so the image is gallery-visible without a sync pass.
          galleryDocs.push(buildGalleryDoc({
            page,
            book,
            detectedImage: img,
            index: di,
            now,
            scanQuality: inheritedScanQuality,
            pageImageCharacteristics,
          }));
        }
      }

      bulkOps.push({
        updateOne: {
          filter: { id: pageId },
          update: { $set: pageSet },
        },
      });
    }
  }

  // Write results
  if (bulkOps.length > 0) {
    await db.collection('pages').bulkWrite(bulkOps, { ordered: false });
  }

  if (galleryDocs.length > 0) {
    try {
      await db.collection('gallery_images').bulkWrite(
        galleryDocs.map(doc => ({
          updateOne: {
            filter: { id: doc.id },
            update: { $set: doc },
            upsert: true,
          },
        })),
        { ordered: false }
      );
    } catch (err) {
      console.error(`  Gallery write error: ${err.message}`);
    }
  }

  // Update book detected_images_count
  const imgCount = await db.collection('pages').countDocuments({
    book_id: book.id,
    'detected_images.0': { $exists: true },
  });
  const bookUpdate = { detected_images_count: imgCount, updated_at: now };

  // Phase 2: roll up page-level scan_quality (v2) into book.scan_quality so downstream
  // use cases (dedupe, re-source queue, dashboards) don't have to aggregate on the fly.
  // Best-effort: any error here doesn't fail the book or block pipeline advance.
  try {
    const rollup = await computeBookScanQualityRollup(db, book.id);
    if (rollup) bookUpdate.scan_quality = rollup;
  } catch (err) {
    console.error(`  scan_quality rollup failed for ${book.id}: ${err.message}`);
  }

  await db.collection('books').updateOne(
    { id: book.id },
    { $set: bookUpdate },
  );

  // Advance pipeline
  await setPipelineStatus(db, book.id, 'images_complete');
  revalidateBookPage(book.id).catch(() => {});

  // Log usage
  await logUsage({
    type: 'extract_images', mode: 'realtime', model: MODEL,
    book_id: book.id, book_title: book.title,
    page_count: pagesProcessed,
    input_tokens: totalInputTokens, output_tokens: totalOutputTokens,
    endpoint: 'hetzner/image-extract-worker',
  }, db).catch(() => {});

  return { title: book.title, pages: pagesProcessed, images: totalImages, skipped: false };
}

// ── Main ──
async function main() {
  const startTime = Date.now();
  console.log(`[IMAGE-EXTRACT] Worker starting — ${new Date().toISOString()}`);
  console.log(`[IMAGE-EXTRACT] Keys: ${API_KEYS.length}, concurrency: ${CONCURRENCY}, page-concurrency: ${PAGE_CONCURRENCY}`);

  const client = new MongoClient(process.env.MONGODB_URI, {
    maxPoolSize: 5,
    serverSelectionTimeoutMS: 10000,
  });
  await client.connect();
  const db = client.db('bookstore');

  // Check processing control. Selective unpause: scoped books extract while
  // globally paused; SCOPE_FILTER confines every candidate query (empty {} in
  // normal operation).
  const ctrl = await db.collection('system_config').findOne({ _id: 'processing_control' });
  if (!shouldBypassPause(ctrl)) {
    console.log('[IMAGE-EXTRACT] Pipeline paused, exiting');
    await client.close();
    return;
  }
  let SCOPE_FILTER = {};
  if (ctrl?.paused && hasScope(ctrl)) {
    const scopeIds = [...await resolveScopeBookIds(db, ctrl)];
    SCOPE_FILTER = { id: { $in: scopeIds } };
    console.log(`[IMAGE-EXTRACT] PAUSED globally, scope active — confining to ${scopeIds.length} allowlisted book(s).`);
  }

  // The dial caps money regardless of pause/scope state (#3826): a scope
  // confines WHICH books, the budget caps HOW MUCH. Vision calls are paid work.
  // A scope envelope (#4540) can open a confined lane when the dial is closed.
  const _gate = await budgetAllowsDispatchScoped(db, 'image-extract-worker', { control: ctrl });
  if (!_gate.allowed) {
    await client.close();
    return;
  }
  if (_gate.envelopeIds) {
    SCOPE_FILTER = { id: { $in: [..._gate.envelopeIds] } };
    console.log(`[IMAGE-EXTRACT] Global dial closed, scope envelope open — confining to ${_gate.envelopeIds.size} envelope book(s).`);
  }

  // Find books ready for image extraction
  const books = await db.collection('books')
    .find({ 'pipeline_auto.status': 'chapters_complete', ...SCOPE_FILTER })
    .sort({ processing_priority: -1, hidden: 1 })
    .project({ id: 1, title: 1, display_title: 1, author: 1, year: 1, language: 1, subjects: 1, summary: 1, visible: 1, hidden: 1, 'image_source.provider': 1 })
    .limit(BOOKS_PER_RUN)
    .toArray();

  // Catch-up: books that reached 'complete' or have no pipeline status but were never image-extracted
  if (books.length < BOOKS_PER_RUN) {
    const catchUp = await db.collection('books')
      .find({
        $or: [
          { 'pipeline_auto.status': { $exists: false } },
          { 'pipeline_auto.status': 'complete' },
        ],
        pages_ocr: { $gt: 0 },
        detected_images_count: { $exists: false },
        ...SCOPE_FILTER,
      })
      .sort({ visible: -1, pages_count: -1 })
      .project({ id: 1, title: 1, display_title: 1, author: 1, year: 1, language: 1, subjects: 1, summary: 1, visible: 1, hidden: 1, 'image_source.provider': 1 })
      .limit(BOOKS_PER_RUN - books.length)
      .toArray();
    if (catchUp.length > 0) {
      books.push(...catchUp);
      console.log(`[IMAGE-EXTRACT] Catch-up: ${catchUp.length} books (complete or pre-pipeline)`);
    }
  }

  console.log(`[IMAGE-EXTRACT] Books to process: ${books.length}`);

  if (books.length === 0) {
    console.log('[IMAGE-EXTRACT] No books ready, exiting');
    await client.close();
    return;
  }

  // Process with concurrency pool
  const queue = [...books];
  let processed = 0;
  let totalImages = 0;
  let totalPages = 0;
  let errors = 0;
  const deadline = startTime + RUN_DEADLINE_MS;

  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (queue.length > 0 && Date.now() < deadline) {
      const book = queue.shift();
      try {
        const result = await processBook(db, book);
        processed++;
        totalImages += result.images;
        totalPages += result.pages;
        if (result.skipped) {
          console.log(`  [skip] ${result.title} — no candidates`);
        } else {
          console.log(`  [done] ${result.title} — ${result.pages}pp, ${result.images} images`);
        }
      } catch (err) {
        errors++;
        if (err.message?.includes('429') || err.message?.includes('RESOURCE_EXHAUSTED')) {
          rotateKey();
        }
        console.error(`  [error] ${book.title}: ${err.message}`);
      }
    }
  });

  await Promise.all(workers);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[IMAGE-EXTRACT] Done — ${processed} books, ${totalPages} pages, ${totalImages} images, ${errors} errors, ${elapsed}s`);

  await client.close();
}

main().catch(err => {
  console.error('[IMAGE-EXTRACT] Fatal:', err);
  process.exit(1);
});
