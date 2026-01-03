#!/usr/bin/env node
/**
 * Smart Image Extraction
 *
 * Instead of scanning every page, this:
 * 1. Finds pages with <image-desc> tags in OCR
 * 2. Uses AI to rank descriptions and pick the best 15-20
 * 3. Only extracts those specific pages
 *
 * Usage: node scripts/smart-extract.mjs <bookId> [--limit=20]
 */

import { MongoClient } from 'mongodb';
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

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
const limitArg = process.argv.find(a => a.startsWith('--limit='));
const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : 20;

if (!bookId) {
  console.error('Usage: node scripts/smart-extract.mjs <bookId> [--limit=20]');
  process.exit(1);
}

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
- musical_score: Sheet music, notation, fugues
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
  "museum_description": "A compelling allegorical scene depicting..."
}

GALLERY QUALITY SCORING (0.0 to 1.0):
- 0.9-1.0: Exceptional - striking emblems, allegorical scenes with people/figures
- 0.8-0.9: High - any illustration featuring people or figures
- 0.6-0.8: Good - well-executed illustrations without people
- 0.4-0.6: Moderate - musical scores, simple diagrams
- 0.2-0.4: Low - page ornaments, generic borders
- 0.0-0.2: Minimal - marbled papers, blank frames

Return ONLY a valid JSON array. If no illustrations exist, return: []`;

async function rankDescriptions(descriptions, bookTitle) {
  const prompt = `You are selecting the most visually interesting and gallery-worthy images from a historical book: "${bookTitle}"

Here are descriptions of images found in the book (page number: description):

${descriptions.map(d => `Page ${d.pageNumber}: ${d.description}`).join('\n')}

Select the TOP ${limit} most interesting images for a gallery. Prioritize:
1. Images with people, figures, or allegorical scenes
2. Striking emblems or symbolic illustrations
3. Beautiful engravings or woodcuts
4. Frontispieces and title pages with illustrations
5. Diagrams with artistic merit

AVOID:
- Marbled papers, blank endpapers
- Generic decorative borders
- Simple geometric figures
- Text-only pages

Return ONLY a JSON array of page numbers, most interesting first:
[pageNum1, pageNum2, ...]`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 1024 }
      })
    }
  );

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

  const match = text.match(/\[[\s\S]*\]/);
  if (match) {
    try {
      return JSON.parse(match[0]);
    } catch {
      return [];
    }
  }
  return [];
}

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

async function extractPage(imageUrl) {
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
        generationConfig: { temperature: 0.1, maxOutputTokens: 2048 }
      })
    }
  );

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed)) {
        return parsed.map(item => ({
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
          model: 'gemini-2.5-flash',
        }));
      }
    } catch {
      // Parse failed
    }
  }
  return [];
}

async function main() {
  console.log(`\n🎨 SMART IMAGE EXTRACTION`);
  console.log(`Book ID: ${bookId}`);
  console.log(`Target: Top ${limit} images`);
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
  const bookTitle = book.display_title || book.title;
  console.log(`📚 ${bookTitle}`);
  console.log(`   by ${book.author}\n`);

  // Step 1: Find pages with <image-desc> in OCR
  console.log('📋 Step 1: Finding pages with image descriptions in OCR...');

  const pagesWithImages = await db.collection('pages').find({
    book_id: bookId,
    'ocr.data': { $regex: '<image-desc>' }
  }, {
    projection: { id: 1, page_number: 1, 'ocr.data': 1, cropped_photo: 1, photo_original: 1, photo: 1 }
  }).sort({ page_number: 1 }).toArray();

  if (pagesWithImages.length === 0) {
    console.log('   No pages with <image-desc> found. Falling back to all pages...');
    // Fall back to first N pages with images
    const allPages = await db.collection('pages').find({
      book_id: bookId,
      $or: [
        { cropped_photo: { $exists: true, $ne: '' } },
        { photo_original: { $exists: true, $ne: '' } },
        { photo: { $exists: true, $ne: '' } }
      ]
    }, {
      projection: { id: 1, page_number: 1, cropped_photo: 1, photo_original: 1, photo: 1 }
    }).sort({ page_number: 1 }).limit(limit).toArray();

    console.log(`   Will extract from first ${allPages.length} pages.\n`);

    // Extract directly
    let totalImages = 0;
    for (let i = 0; i < allPages.length; i++) {
      const page = allPages[i];
      const imageUrl = page.cropped_photo || page.photo_original || page.photo;
      process.stdout.write(`\r   Extracting page ${i + 1}/${allPages.length} (p.${page.page_number})...`);

      const images = await extractPage(imageUrl);
      if (images.length > 0) {
        await db.collection('pages').updateOne(
          { _id: page._id },
          { $set: { detected_images: images } }
        );
        totalImages += images.length;
      }
      await new Promise(r => setTimeout(r, 500));
    }

    console.log(`\n\n✅ Done! Extracted ${totalImages} images from ${allPages.length} pages.`);
    await client.close();
    return;
  }

  // Extract descriptions from OCR
  const descriptions = pagesWithImages.map(page => {
    const matches = page.ocr?.data?.match(/<image-desc>([^<]+)<\/image-desc>/g) || [];
    const desc = matches.map(m => m.replace(/<\/?image-desc>/g, '')).join(' | ');
    return {
      pageId: page.id,
      pageNumber: page.page_number,
      description: desc.substring(0, 300),
      imageUrl: page.cropped_photo || page.photo_original || page.photo
    };
  });

  console.log(`   Found ${descriptions.length} pages with image descriptions.\n`);

  // Step 2: Rank descriptions with AI
  console.log('🤖 Step 2: Ranking images with AI...');
  const topPageNumbers = await rankDescriptions(descriptions, bookTitle);
  console.log(`   Selected top ${topPageNumbers.length} pages: ${topPageNumbers.slice(0, 10).join(', ')}${topPageNumbers.length > 10 ? '...' : ''}\n`);

  // Step 3: Extract only the top pages
  console.log('🔍 Step 3: Extracting images from selected pages...');

  const pagesToExtract = descriptions.filter(d => topPageNumbers.includes(d.pageNumber));

  let totalImages = 0;
  let highQuality = 0;
  const results = [];

  for (let i = 0; i < pagesToExtract.length; i++) {
    const page = pagesToExtract[i];
    process.stdout.write(`\r   Extracting page ${i + 1}/${pagesToExtract.length} (p.${page.pageNumber})...`);

    try {
      const images = await extractPage(page.imageUrl);

      if (images.length > 0) {
        await db.collection('pages').updateOne(
          { id: page.pageId },
          { $set: { detected_images: images } }
        );

        totalImages += images.length;
        images.forEach(img => {
          if ((img.gallery_quality || 0) >= 0.75) highQuality++;
          results.push({
            page: page.pageNumber,
            desc: img.description?.substring(0, 50),
            quality: img.gallery_quality,
            type: img.type
          });
        });
      }
    } catch (e) {
      // Skip errors
    }

    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`📊 RESULTS`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  console.log(`Pages with OCR image descriptions: ${descriptions.length}`);
  console.log(`Pages extracted: ${pagesToExtract.length}`);
  console.log(`Total images found: ${totalImages}`);
  console.log(`High quality (≥0.75): ${highQuality}`);

  console.log(`\nTop images:`);
  results
    .sort((a, b) => (b.quality || 0) - (a.quality || 0))
    .slice(0, 10)
    .forEach(r => {
      console.log(`  p.${r.page} | ${(r.quality || 0).toFixed(2)} | ${r.type} | ${r.desc}`);
    });

  console.log(`\n✅ Done! View at: https://sourcelibrary.org/gallery?bookId=${bookId}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  await client.close();
}

main().catch(console.error);
