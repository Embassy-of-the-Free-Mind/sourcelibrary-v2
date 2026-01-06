/**
 * Extract Image Metadata from OCR
 *
 * Parses [[image: ...]] tags from OCR text and populates detected_images field.
 * Run: npx ts-node scripts/extract-image-metadata.ts [--dry-run] [--book-id=X]
 */

import { MongoClient } from 'mongodb';

interface DetectedImage {
  description: string;
  type?: 'woodcut' | 'diagram' | 'chart' | 'illustration' | 'symbol' | 'table' | 'unknown';
  detected_at: Date;
  detection_source: 'ocr_tag' | 'vision_model' | 'manual';
}

// Extract [[image: ...]] tags and classify type
function extractImagesFromOcr(ocrText: string): DetectedImage[] {
  const matches = ocrText.match(/\[\[image:\s*([^\]]+)\]\]/gi) || [];

  return matches.map(match => {
    const description = match
      .replace(/\[\[image:\s*/i, '')
      .replace(/\]\]$/, '')
      .trim();

    // Try to classify based on description
    const lowerDesc = description.toLowerCase();
    let type: DetectedImage['type'] = 'unknown';

    if (lowerDesc.includes('woodcut') || lowerDesc.includes('engraving') || lowerDesc.includes('print')) {
      type = 'woodcut';
    } else if (lowerDesc.includes('diagram') || lowerDesc.includes('figure') || lowerDesc.includes('schematic')) {
      type = 'diagram';
    } else if (lowerDesc.includes('chart') || lowerDesc.includes('table') || lowerDesc.includes('grid')) {
      type = 'chart';
    } else if (lowerDesc.includes('symbol') || lowerDesc.includes('sigil') || lowerDesc.includes('seal') || lowerDesc.includes('glyph')) {
      type = 'symbol';
    } else if (lowerDesc.includes('illustration') || lowerDesc.includes('drawing') || lowerDesc.includes('picture')) {
      type = 'illustration';
    }

    return {
      description,
      type,
      detected_at: new Date(),
      detection_source: 'ocr_tag' as const,
    };
  });
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const bookIdArg = args.find(a => a.startsWith('--book-id='));
  const bookId = bookIdArg ? bookIdArg.split('=')[1] : null;

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI not set');
    process.exit(1);
  }

  const client = new MongoClient(uri);

  try {
    await client.connect();
    const db = client.db();

    // Build query
    const query: Record<string, unknown> = {
      'ocr.data': { $regex: '\\[\\[image:', $options: 'i' }
    };
    if (bookId) {
      query.book_id = bookId;
    }

    // Find pages with image tags
    console.log('Finding pages with [[image:]] tags...');
    const pages = await db.collection('pages').find(query).toArray();

    console.log(`Found ${pages.length} pages with image tags`);

    let updated = 0;
    let totalImages = 0;

    for (const page of pages) {
      const ocrText = page.ocr?.data || '';
      const images = extractImagesFromOcr(ocrText);

      if (images.length === 0) continue;

      totalImages += images.length;
      console.log(`\nPage ${page.page_number} (${page.book_id}): ${images.length} image(s)`);
      images.forEach(img => {
        console.log(`  - [${img.type}] ${img.description.slice(0, 60)}${img.description.length > 60 ? '...' : ''}`);
      });

      if (!dryRun) {
        await db.collection('pages').updateOne(
          { _id: page._id },
          { $set: { detected_images: images } }
        );
        updated++;
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log(`Total: ${totalImages} images on ${pages.length} pages`);
    if (dryRun) {
      console.log('[DRY RUN] No changes made. Run without --dry-run to update.');
    } else {
      console.log(`Updated ${updated} pages with detected_images field.`);
    }

    // Show stats by type
    const allImages: DetectedImage[] = [];
    for (const page of pages) {
      const ocrText = page.ocr?.data || '';
      allImages.push(...extractImagesFromOcr(ocrText));
    }

    const typeCounts = allImages.reduce((acc, img) => {
      acc[img.type || 'unknown'] = (acc[img.type || 'unknown'] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    console.log('\nBy type:');
    Object.entries(typeCounts)
      .sort((a, b) => b[1] - a[1])
      .forEach(([type, count]) => {
        console.log(`  ${type}: ${count}`);
      });

  } finally {
    await client.close();
  }
}

main().catch(console.error);
