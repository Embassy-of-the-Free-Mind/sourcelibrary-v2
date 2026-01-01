/**
 * Extract images from illustrated alchemical books
 * Run with: npx tsx scripts/extract-alchemy-images.ts
 */

import { MongoClient } from 'mongodb';
import { GoogleGenerativeAI } from '@google/generative-ai';

const BOOKS = [
  { id: '69526359ab34727b1f046d5a', name: 'Mutus Liber' },
];

const EXTRACTION_PROMPT = `You are analyzing a historical book page scan. Your task is to identify and PRECISELY locate all illustrations, diagrams, woodcuts, emblems, engravings, or decorative elements.

CRITICAL: Provide EXACT bounding box coordinates. Measure carefully:
- x: horizontal position of LEFT edge (0.0 = left margin, 1.0 = right margin)
- y: vertical position of TOP edge (0.0 = top margin, 1.0 = bottom margin)
- width: horizontal span of the illustration
- height: vertical span of the illustration

The bounding box should TIGHTLY enclose just the illustration, not the surrounding text.

For each illustration found, return:
{
  "description": "Brief description of what it depicts",
  "type": "emblem|woodcut|engraving|diagram|symbol|decorative|alchemical",
  "bbox": { "x": 0.15, "y": 0.25, "width": 0.70, "height": 0.45 },
  "confidence": 0.95
}

Return ONLY a valid JSON array. If no illustrations exist (text-only page), return: []`;

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI not set');
    process.exit(1);
  }

  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) {
    console.error('GEMINI_API_KEY not set');
    process.exit(1);
  }

  const client = new MongoClient(uri);
  const genAI = new GoogleGenerativeAI(geminiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

  try {
    await client.connect();
    const db = client.db('bookstore');
    console.log('Connected to MongoDB\n');

    for (const book of BOOKS) {
      console.log(`\n=== Processing: ${book.name} ===`);

      // Find pages with images but no detected_images
      const pages = await db.collection('pages')
        .find({
          book_id: book.id,
          $or: [
            { cropped_photo: { $exists: true, $ne: '' } },
            { photo_original: { $exists: true, $ne: '' } },
            { photo: { $exists: true, $ne: '' } }
          ],
          $or: [
            { detected_images: { $exists: false } },
            { detected_images: { $size: 0 } }
          ]
        })
        .sort({ page_number: 1 })
        .limit(100) // Process all pages
        .toArray();

      console.log(`Found ${pages.length} pages to process`);

      for (const page of pages) {
        const imageUrl = page.cropped_photo || page.photo_original || page.photo;
        if (!imageUrl) continue;

        console.log(`  Page ${page.page_number}...`);

        try {
          // Fetch image
          const response = await fetch(imageUrl);
          if (!response.ok) {
            console.log(`    Failed to fetch image`);
            continue;
          }

          const buffer = await response.arrayBuffer();
          const base64 = Buffer.from(buffer).toString('base64');
          const mimeType = response.headers.get('content-type')?.split(';')[0] || 'image/jpeg';

          // Call Gemini
          const result = await model.generateContent([
            EXTRACTION_PROMPT,
            { inlineData: { mimeType, data: base64 } }
          ]);

          const text = result.response.text();
          const jsonMatch = text.match(/\[[\s\S]*\]/);

          if (jsonMatch) {
            const detections = JSON.parse(jsonMatch[0]);

            if (detections.length > 0) {
              // Add metadata and save
              const enriched = detections.map((d: Record<string, unknown>) => ({
                ...d,
                detected_at: new Date(),
                detection_source: 'vision_model',
                model: 'gemini-2.0-flash'
              }));

              await db.collection('pages').updateOne(
                { id: page.id },
                { $set: { detected_images: enriched } }
              );

              console.log(`    Found ${detections.length} illustration(s)`);
            } else {
              console.log(`    No illustrations`);
            }
          }
        } catch (err) {
          console.log(`    Error: ${err instanceof Error ? err.message : 'Unknown'}`);
        }

        // Rate limit
        await new Promise(r => setTimeout(r, 500));
      }
    }

    console.log('\n✓ Done!');
  } finally {
    await client.close();
  }
}

main().catch(console.error);
