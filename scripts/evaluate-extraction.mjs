#!/usr/bin/env node
/**
 * Evaluate Image Extraction Agent
 *
 * Runs extraction on a book and tracks:
 * - Time per page
 * - Images found
 * - Quality distribution
 * - Estimated API cost
 *
 * Usage: node scripts/evaluate-extraction.mjs <bookId> [--clear]
 */

import { MongoClient } from 'mongodb';
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// Load .env.local
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../.env.local') });

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB = process.env.MONGODB_DB;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!MONGODB_URI || !MONGODB_DB || !GEMINI_API_KEY) {
  console.error('Missing MONGODB_URI, MONGODB_DB, or GEMINI_API_KEY');
  process.exit(1);
}

const bookId = process.argv[2];
const shouldClear = process.argv.includes('--clear');

if (!bookId) {
  console.error('Usage: node scripts/evaluate-extraction.mjs <bookId> [--clear]');
  process.exit(1);
}

// Gemini 2.0 Flash pricing (per 1M tokens)
const PRICING = {
  inputPerMillion: 0.10,   // $0.10 per 1M input tokens
  outputPerMillion: 0.40,  // $0.40 per 1M output tokens
  imageInputCost: 0.0001,  // ~$0.0001 per image (rough estimate)
};

const EXTRACTION_PROMPT = `You are a museum curator analyzing a historical book page scan. Create rich metadata for each illustration.

BOUNDING BOX (0.0-1.0 normalized coordinates):
- x: LEFT edge (0=left, 1=right), y: TOP edge (0=top, 1=bottom)
- width, height: span of illustration
- TIGHTLY enclose the illustration only

IMAGE TYPES (use these exactly):
- emblem: Symbolic/allegorical with motto, often framed
- woodcut: Bold relief print lines
- engraving: Fine detailed intaglio lines, crosshatching
- portrait: Depiction of a person
- frontispiece: Decorative title page
- musical_score: Sheet music, notation, fugues (NOT "table")
- diagram: Technical/scientific illustration
- symbol: Alchemical, astrological symbols
- decorative: Ornaments, borders, initials
- map: Geographic representation

For each illustration return:
{
  "description": "Brief factual description",
  "type": "emblem|woodcut|engraving|portrait|frontispiece|musical_score|diagram|symbol|decorative|map",
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
  "museum_description": "A compelling allegorical scene depicting... This exemplifies early modern alchemical imagery..."
}

GALLERY QUALITY SCORING (0.0 to 1.0):
- 0.9-1.0: Exceptional - striking emblems, significant allegorical scenes with people/figures
- 0.8-0.9: High - any illustration featuring people or figures, well-composed scenes
- 0.6-0.8: Good - well-executed illustrations without people, interesting diagrams
- 0.4-0.6: Moderate - musical scores, common decorative elements, simple diagrams
- 0.2-0.4: Low - page ornaments, generic borders, printer's marks
- 0.0-0.2: Minimal - marbled papers, blank decorative frames, rule lines

PRIORITY: Images featuring people should ALWAYS score 0.8+. Musical scores should score 0.4-0.6.

METADATA GUIDELINES:
- subjects: Main topics/themes (alchemy, astronomy, medicine, mythology)
- figures: People/beings depicted (Mercury, old man, serpent, angel)
- symbols: Symbolic elements (ouroboros, philosophical egg, athanor, sun/moon)
- style: Art historical style (Northern European Renaissance, Baroque)
- technique: Production method (woodcut, engraving, etching)

MUSEUM DESCRIPTION: Write 2-3 sentences as if for a museum label. Describe what's depicted, its significance, and historical context.

Return ONLY a valid JSON array. If no illustrations exist (text-only page), return: []`;

function getMimeType(url, headerType) {
  // S3 often returns application/octet-stream, so detect from URL extension
  if (headerType && headerType !== 'application/octet-stream') {
    return headerType;
  }
  const ext = url.split('.').pop()?.toLowerCase().split('?')[0];
  if (ext === 'png') return 'image/png';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'webp') return 'image/webp';
  return 'image/jpeg'; // Default to JPEG
}

async function extractWithGemini(imageUrl) {
  const startTime = Date.now();

  // Fetch image
  const imageResponse = await fetch(imageUrl);
  const imageBuffer = await imageResponse.arrayBuffer();
  const base64Image = Buffer.from(imageBuffer).toString('base64');
  const headerType = imageResponse.headers.get('content-type')?.split(';')[0];
  const mimeType = getMimeType(imageUrl, headerType);

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: EXTRACTION_PROMPT },
            { inline_data: { mime_type: mimeType, data: base64Image } }
          ]
        }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 2048,
        }
      })
    }
  );

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const usage = data.usageMetadata || {};

  // Parse JSON
  let images = [];
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed)) {
        images = parsed.map(item => ({
          description: item.description || '',
          type: item.type || 'unknown',
          bbox: item.bbox ? {
            x: parseFloat(item.bbox.x) || 0,
            y: parseFloat(item.bbox.y) || 0,
            width: parseFloat(item.bbox.width) || 0,
            height: parseFloat(item.bbox.height) || 0,
          } : undefined,
          confidence: item.confidence,
          gallery_quality: typeof item.gallery_quality === 'number' ? item.gallery_quality : undefined,
          gallery_rationale: item.gallery_rationale || undefined,
          metadata: item.metadata ? {
            subjects: Array.isArray(item.metadata.subjects) ? item.metadata.subjects : undefined,
            figures: Array.isArray(item.metadata.figures) ? item.metadata.figures : undefined,
            symbols: Array.isArray(item.metadata.symbols) ? item.metadata.symbols : undefined,
            style: item.metadata.style || undefined,
            technique: item.metadata.technique || undefined,
          } : undefined,
          museum_description: item.museum_description || undefined,
          detected_at: new Date(),
          detection_source: 'vision_model',
          model: 'gemini',
        }));
      }
    } catch (e) {
      // JSON parse failed
    }
  }

  return {
    images,
    latencyMs: Date.now() - startTime,
    inputTokens: usage.promptTokenCount || 0,
    outputTokens: usage.candidatesTokenCount || 0,
  };
}

async function main() {
  console.log(`\n🔬 EXTRACTION EVALUATION`);
  console.log(`Book ID: ${bookId}`);
  console.log(`Clear existing: ${shouldClear}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db(MONGODB_DB);

  // Get book info
  const book = await db.collection('books').findOne({ id: bookId });
  if (!book) {
    console.error('Book not found');
    process.exit(1);
  }
  console.log(`📚 ${book.display_title || book.title}`);
  console.log(`   by ${book.author}\n`);

  // Get pages with images
  const pages = await db.collection('pages').find({
    book_id: bookId,
    $or: [
      { cropped_photo: { $exists: true, $ne: '' } },
      { photo_original: { $exists: true, $ne: '' } },
      { photo: { $exists: true, $ne: '' } }
    ]
  }).sort({ page_number: 1 }).toArray();

  console.log(`📄 ${pages.length} pages with images\n`);

  // Clear existing detections if requested
  if (shouldClear) {
    console.log(`🧹 Clearing existing detected_images...`);
    const clearResult = await db.collection('pages').updateMany(
      { book_id: bookId },
      { $unset: { detected_images: '' } }
    );
    console.log(`   Cleared ${clearResult.modifiedCount} pages\n`);
  }

  // Tracking
  const stats = {
    pagesProcessed: 0,
    totalImages: 0,
    highQuality: 0,    // >= 0.75
    mediumQuality: 0,  // >= 0.5
    lowQuality: 0,     // < 0.5
    totalLatencyMs: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    errors: 0,
    byType: {},
    withMetadata: 0,         // Has any metadata
    withMuseumDesc: 0,       // Has museum_description
    metadataFields: {        // How many have each field
      subjects: 0,
      figures: 0,
      symbols: 0,
      style: 0,
      technique: 0,
    },
  };

  const startTime = Date.now();

  // Process pages
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const imageUrl = page.cropped_photo || page.photo_original || page.photo;

    process.stdout.write(`\r  Processing page ${i + 1}/${pages.length} (p.${page.page_number})...`);

    try {
      const result = await extractWithGemini(imageUrl);

      stats.pagesProcessed++;
      stats.totalLatencyMs += result.latencyMs;
      stats.totalInputTokens += result.inputTokens;
      stats.totalOutputTokens += result.outputTokens;
      stats.totalImages += result.images.length;

      // Quality distribution
      for (const img of result.images) {
        const q = img.gallery_quality ?? 0;
        if (q >= 0.75) stats.highQuality++;
        else if (q >= 0.5) stats.mediumQuality++;
        else stats.lowQuality++;

        // Type distribution
        const type = img.type || 'unknown';
        stats.byType[type] = (stats.byType[type] || 0) + 1;

        // Metadata coverage
        if (img.museum_description) stats.withMuseumDesc++;
        if (img.metadata) {
          stats.withMetadata++;
          if (img.metadata.subjects?.length) stats.metadataFields.subjects++;
          if (img.metadata.figures?.length) stats.metadataFields.figures++;
          if (img.metadata.symbols?.length) stats.metadataFields.symbols++;
          if (img.metadata.style) stats.metadataFields.style++;
          if (img.metadata.technique) stats.metadataFields.technique++;
        }
      }

      // Save to DB
      if (result.images.length > 0) {
        await db.collection('pages').updateOne(
          { _id: page._id },
          { $set: { detected_images: result.images } }
        );
      }

    } catch (e) {
      stats.errors++;
    }

    // Rate limit: ~10 requests per minute for free tier
    await new Promise(r => setTimeout(r, 500));
  }

  const totalTimeS = (Date.now() - startTime) / 1000;

  // Calculate costs
  const inputCost = (stats.totalInputTokens / 1_000_000) * PRICING.inputPerMillion;
  const outputCost = (stats.totalOutputTokens / 1_000_000) * PRICING.outputPerMillion;
  const imageCost = stats.pagesProcessed * PRICING.imageInputCost;
  const totalCost = inputCost + outputCost + imageCost;

  console.log(`\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`📊 RESULTS`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  console.log(`EXTRACTION:`);
  console.log(`  Pages processed: ${stats.pagesProcessed}`);
  console.log(`  Total images found: ${stats.totalImages}`);
  console.log(`  Images per page: ${(stats.totalImages / stats.pagesProcessed).toFixed(2)}`);
  console.log(`  Errors: ${stats.errors}`);

  console.log(`\nQUALITY DISTRIBUTION:`);
  console.log(`  High (≥0.75, shows on guide): ${stats.highQuality} (${((stats.highQuality / stats.totalImages) * 100).toFixed(1)}%)`);
  console.log(`  Medium (0.5-0.75): ${stats.mediumQuality} (${((stats.mediumQuality / stats.totalImages) * 100).toFixed(1)}%)`);
  console.log(`  Low (<0.5): ${stats.lowQuality} (${((stats.lowQuality / stats.totalImages) * 100).toFixed(1)}%)`);

  console.log(`\nIMAGE TYPES:`);
  const sortedTypes = Object.entries(stats.byType).sort((a, b) => b[1] - a[1]);
  for (const [type, count] of sortedTypes) {
    console.log(`  ${type}: ${count}`);
  }

  console.log(`\nRICH METADATA COVERAGE:`);
  console.log(`  With museum description: ${stats.withMuseumDesc}/${stats.totalImages} (${((stats.withMuseumDesc / stats.totalImages) * 100).toFixed(1)}%)`);
  console.log(`  With metadata object: ${stats.withMetadata}/${stats.totalImages} (${((stats.withMetadata / stats.totalImages) * 100).toFixed(1)}%)`);
  console.log(`  Metadata fields:`);
  console.log(`    - subjects: ${stats.metadataFields.subjects}`);
  console.log(`    - figures: ${stats.metadataFields.figures}`);
  console.log(`    - symbols: ${stats.metadataFields.symbols}`);
  console.log(`    - style: ${stats.metadataFields.style}`);
  console.log(`    - technique: ${stats.metadataFields.technique}`);

  console.log(`\nPERFORMANCE:`);
  console.log(`  Total time: ${totalTimeS.toFixed(1)}s`);
  console.log(`  Avg latency: ${(stats.totalLatencyMs / stats.pagesProcessed).toFixed(0)}ms/page`);
  console.log(`  Pages/minute: ${((stats.pagesProcessed / totalTimeS) * 60).toFixed(1)}`);

  console.log(`\nTOKEN USAGE:`);
  console.log(`  Input tokens: ${stats.totalInputTokens.toLocaleString()}`);
  console.log(`  Output tokens: ${stats.totalOutputTokens.toLocaleString()}`);

  console.log(`\n💰 ESTIMATED COST:`);
  console.log(`  Input: $${inputCost.toFixed(4)}`);
  console.log(`  Output: $${outputCost.toFixed(4)}`);
  console.log(`  Image processing: $${imageCost.toFixed(4)}`);
  console.log(`  ─────────────────────`);
  console.log(`  TOTAL: $${totalCost.toFixed(4)}`);
  console.log(`  Cost per page: $${(totalCost / stats.pagesProcessed).toFixed(6)}`);
  console.log(`  Cost per high-quality image: $${(totalCost / stats.highQuality).toFixed(4)}`);

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  await client.close();
}

main().catch(console.error);
