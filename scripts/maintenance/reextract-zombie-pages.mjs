#!/usr/bin/env node
/**
 * Re-extract image data for pages that were all-zombie (every detection from
 * the original Gemini call was a placeholder). After the schema + prompt fix
 * in this PR, Gemini should either return real detections OR an empty array,
 * not all-empty placeholder objects.
 *
 * Identifies pages by: every `gallery_images` row for the page has
 * `dedup_reason: "zombie_no_metadata"`.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/reextract-zombie-pages.mjs --dry-run --limit 10
 *   node scripts/maintenance/reextract-zombie-pages.mjs --apply --limit 50
 *   node scripts/maintenance/reextract-zombie-pages.mjs --apply  # all
 */
import { MongoClient } from 'mongodb';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const DRY_RUN = !APPLY;
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : Infinity;
const CONCURRENCY = 8;
const MODEL = 'gemini-3-flash-preview';

const API_KEYS = [
  process.env.GEMINI_API_KEY,
  ...Array.from({ length: 9 }, (_, i) => process.env[`GEMINI_API_KEY_${i + 2}`]),
].filter(Boolean);
if (API_KEYS.length === 0) { console.error('No GEMINI_API_KEY* set'); process.exit(1); }
let _keyIndex = 0;
function getClient() { return new GoogleGenerativeAI(API_KEYS[_keyIndex % API_KEYS.length]); }

// ── Schema (matches image-extract-worker after the PR's fix: items require core fields) ──
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
              x: { type: SchemaType.NUMBER }, y: { type: SchemaType.NUMBER },
              width: { type: SchemaType.NUMBER }, height: { type: SchemaType.NUMBER },
            },
            required: ['x', 'y', 'width', 'height'],
          },
          confidence: { type: SchemaType.NUMBER },
          gallery_quality: { type: SchemaType.NUMBER },
          gallery_rationale: { type: SchemaType.STRING },
          museum_description: { type: SchemaType.STRING },
        },
        required: ['description', 'type', 'bbox', 'gallery_quality', 'gallery_rationale'],
      },
    },
  },
  required: ['scan_quality', 'extracted_images'],
};

const PROMPT = `You are a museum curator analyzing a historical book page scan. Extract only significant illustrations — skip decorative elements like ornaments, borders, printer's marks, and initials.

BOUNDING BOX (0.0-1.0): x=LEFT, y=TOP, width/height span. Tightly enclose the illustration.

IMAGE TYPES (use exactly): emblem | woodcut | engraving | portrait | frontispiece | musical_score | diagram | symbol | map

SKIP: page ornaments, borders, decorative initials, printer's devices, marbled papers, blank frames, ruled lines.

If the page contains no significant illustrations, return \`extracted_images: []\` — an empty array. Do NOT return placeholder objects with missing or null fields. Either fill in every field for an illustration, or omit it entirely.

GALLERY QUALITY (0.0-1.0):
  0.9-1.0: Exceptional emblems, portraits, allegorical scenes with figures
  0.8-0.9: Illustrations with people/figures
  0.6-0.8: Good illustrations without people
  0.4-0.6: Musical scores, alchemical symbols

PAGE-LEVEL SCAN QUALITY: assess scan_score (0-100), scan_class (color_photo|color_print|grayscale_photo|grayscale_print|bitonal_clean|bitonal_microfilm|microfiche|scanner_metadata|blank|corrupt), readable_text, illustration_fidelity, page_completeness, concerns[], reasoning.
`;

const QUALITY_THRESHOLD = 0.5;
const c = new MongoClient(process.env.MONGODB_URI);
await c.connect();
const db = c.db('bookstore');

// Find all-zombie pages
console.log('Finding all-zombie pages...');
const pageStats = await db.collection('gallery_images').aggregate([
  { $group: {
    _id: '$page_id',
    total: { $sum: 1 },
    zombies: { $sum: { $cond: [{ $eq: ['$dedup_reason', 'zombie_no_metadata'] }, 1, 0] } },
  }},
  { $match: { $expr: { $eq: ['$total', '$zombies'] } } },
]).toArray();
const allZombiePageIds = pageStats.map(p => p._id);
console.log(`Found ${allZombiePageIds.length} all-zombie pages${DRY_RUN ? ' (DRY RUN — no API calls or writes)' : ''}`);

const toProcess = allZombiePageIds.slice(0, LIMIT);
console.log(`Will process ${toProcess.length}${LIMIT < Infinity ? ` (limit ${LIMIT})` : ''}`);

if (DRY_RUN) {
  console.log(`\nAvg extract_images call ≈ $0.00105. Estimated cost: $${(toProcess.length * 0.00105).toFixed(2)}`);
  console.log('Re-run with --apply to execute.');
  await c.close(); process.exit(0);
}

const pages = await db.collection('pages').find({ id: { $in: toProcess } })
  .project({ id: 1, book_id: 1, page_number: 1, photo: 1, photo_original: 1, archived_photo: 1, cropped_photo: 1 })
  .toArray();

function getPageImageUrl(p) { return p.cropped_photo || p.archived_photo || p.photo_original || p.photo; }

async function fetchImage(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    const mime = r.headers.get('content-type') || 'image/jpeg';
    return { mimeType: mime, data: buf.toString('base64') };
  } catch { return null; }
}

async function processPage(page) {
  const url = getPageImageUrl(page);
  if (!url) return { pageId: page.id, status: 'no_url' };
  const image = await fetchImage(url);
  if (!image) return { pageId: page.id, status: 'image_fetch_fail' };

  try {
    const model = getClient().getGenerativeModel({
      model: MODEL,
      generationConfig: { temperature: 0.1, maxOutputTokens: 4096, responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA },
    });
    const result = await model.generateContent([{ text: PROMPT }, { inlineData: { mimeType: image.mimeType, data: image.data } }]);
    const text = result.response.text();
    const parsed = JSON.parse(text);
    const usage = result.response.usageMetadata || {};

    const rawImages = Array.isArray(parsed.extracted_images) ? parsed.extracted_images : [];
    const now = new Date();

    // Normalize bbox + apply filter (matches the worker after fix)
    const detectedImages = rawImages
      .filter(img => img && img.bbox && typeof img.gallery_quality === 'number')
      .map(img => ({
        description: img.description || '',
        type: img.type || 'unknown',
        bbox: img.bbox,
        confidence: img.confidence,
        gallery_quality: img.gallery_quality,
        gallery_rationale: img.gallery_rationale,
        museum_description: img.museum_description,
        detected_at: now,
        detection_source: 'vision_model',
        model: MODEL,
      }));

    // Write pages.detected_images (overwrite the all-zombie array)
    await db.collection('pages').updateOne(
      { id: page.id },
      { $set: {
        detected_images: detectedImages,
        image_extraction_updated_at: now,
        updated_at: now,
      }}
    );

    // Insert real gallery_images (upsert by id; only for filter-passing images)
    const galleryDocs = detectedImages
      .filter(img => img.gallery_quality >= QUALITY_THRESHOLD)
      .map((img, di) => ({
        id: `${page.id}-${di}`,
        page_id: page.id,
        book_id: page.book_id,
        page_number: page.page_number,
        detection_index: di,
        description: img.description,
        type: img.type,
        bbox: img.bbox,
        gallery_quality: img.gallery_quality,
        gallery_rationale: img.gallery_rationale,
        museum_description: img.museum_description,
        detected_at: now,
        detection_source: 'vision_model',
        model: MODEL,
        updated_at: now,
      }));

    if (galleryDocs.length > 0) {
      await db.collection('gallery_images').bulkWrite(
        galleryDocs.map(d => ({ updateOne: { filter: { id: d.id }, update: { $set: d }, upsert: true }})),
        { ordered: false }
      );
    }

    return {
      pageId: page.id,
      status: 'ok',
      images: detectedImages.length,
      gallery: galleryDocs.length,
      inputTokens: usage.promptTokenCount || 0,
      outputTokens: usage.candidatesTokenCount || 0,
    };
  } catch (err) {
    if (err.message?.includes('429') || err.message?.includes('RESOURCE_EXHAUSTED')) _keyIndex++;
    return { pageId: page.id, status: 'error', error: err.message?.slice(0, 100) };
  }
}

const stats = { ok: 0, empty: 0, withImages: 0, errors: 0, no_url: 0, image_fetch_fail: 0, totalIn: 0, totalOut: 0, totalImages: 0, totalGallery: 0 };
const startedAt = Date.now();

console.log(`\nProcessing ${pages.length} pages, concurrency=${CONCURRENCY}...`);
for (let i = 0; i < pages.length; i += CONCURRENCY) {
  const chunk = pages.slice(i, i + CONCURRENCY);
  const results = await Promise.allSettled(chunk.map(processPage));
  for (const r of results) {
    if (r.status !== 'fulfilled') { stats.errors++; continue; }
    const v = r.value;
    if (v.status === 'ok') {
      stats.ok++;
      stats.totalIn += v.inputTokens;
      stats.totalOut += v.outputTokens;
      stats.totalImages += v.images;
      stats.totalGallery += v.gallery;
      if (v.images === 0) stats.empty++;
      else stats.withImages++;
    } else {
      stats[v.status] = (stats[v.status] || 0) + 1;
    }
  }
  const pct = Math.round((i + chunk.length) / pages.length * 100);
  console.log(`  ${i + chunk.length}/${pages.length} (${pct}%)  ok=${stats.ok} withImages=${stats.withImages} empty=${stats.empty} errors=${stats.errors}`);
}

const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
console.log(`\nDone in ${elapsed}s.`);
console.log(`Successful: ${stats.ok}  (${stats.withImages} with images, ${stats.empty} now correctly empty)`);
console.log(`Errors: errors=${stats.errors} no_url=${stats.no_url || 0} image_fetch_fail=${stats.image_fetch_fail || 0}`);
console.log(`Tokens: ${stats.totalIn.toLocaleString()} in / ${stats.totalOut.toLocaleString()} out`);
console.log(`Real gallery rows written: ${stats.totalGallery}`);

await c.close();
