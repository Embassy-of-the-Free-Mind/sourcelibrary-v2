import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

/**
 * POST /api/extract-images
 *
 * Run Mistral (Pixtral) image extraction on pages with illustrations.
 * Body: { limit?: number, bookId?: string }
 */

const EXTRACTION_PROMPT = `Analyze this historical book page scan and identify all illustrations, diagrams, woodcuts, charts, or decorative elements.

For each image/illustration found, provide:
1. A brief description of what it depicts
2. The type (woodcut, diagram, chart, illustration, symbol, decorative, table)
3. The bounding box coordinates as normalized values (0-1 scale where 0,0 is top-left)

Return ONLY a JSON array:
[
  {
    "description": "Alchemist working at a furnace with dragon symbol",
    "type": "woodcut",
    "bbox": { "x": 0.1, "y": 0.2, "width": 0.8, "height": 0.4 },
    "confidence": 0.95
  }
]

If there are no illustrations (just text), return: []`;

interface DetectedImage {
  description: string;
  type?: string;
  bbox?: { x: number; y: number; width: number; height: number };
  confidence?: number;
  detected_at: Date;
  detection_source: 'vision_model';
}

async function extractWithMistral(imageUrl: string): Promise<DetectedImage[]> {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) {
    throw new Error('MISTRAL_API_KEY not set');
  }

  // Fetch and encode image
  const imageResponse = await fetch(imageUrl);
  if (!imageResponse.ok) {
    throw new Error(`Failed to fetch image: ${imageResponse.status}`);
  }

  const imageBuffer = await imageResponse.arrayBuffer();
  const base64Image = Buffer.from(imageBuffer).toString('base64');
  const mimeType = imageResponse.headers.get('content-type') || 'image/jpeg';
  const dataUrl = `data:${mimeType};base64,${base64Image}`;

  const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'pixtral-12b-2409',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: EXTRACTION_PROMPT },
          { type: 'image_url', image_url: { url: dataUrl } }
        ]
      }],
      temperature: 0.1,
      max_tokens: 2048
    })
  });

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content || '';

  // Parse JSON from response
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    return [];
  }

  const parsed = JSON.parse(jsonMatch[0]);
  if (!Array.isArray(parsed)) return [];

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
    detected_at: new Date(),
    detection_source: 'vision_model' as const,
  }));
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const limit = Math.min(body.limit || 5, 20); // Max 20 pages
    const bookId = body.bookId;
    const dryRun = body.dryRun || false;

    const db = await getDb();

    // Find pages with detected images (from OCR tags) that have image URLs
    const query: Record<string, unknown> = {
      $and: [
        {
          $or: [
            { 'detected_images.0': { $exists: true } },
            { 'ocr.data': { $regex: '\\[\\[image:', $options: 'i' } }
          ]
        },
        {
          $or: [
            { cropped_photo: { $exists: true, $ne: '' } },
            { photo_original: { $exists: true, $ne: '' } },
            { photo: { $exists: true, $ne: '' } }
          ]
        }
      ]
    };

    if (bookId) {
      query.book_id = bookId;
    }

    const pages = await db.collection('pages').aggregate([
      { $match: query },
      { $sample: { size: limit } },
      {
        $lookup: {
          from: 'books',
          localField: 'book_id',
          foreignField: 'id',
          as: 'book'
        }
      },
      { $unwind: { path: '$book', preserveNullAndEmptyArrays: true } }
    ]).toArray();

    const results: Array<{
      pageId: string;
      bookTitle: string;
      pageNumber: number;
      imageUrl: string;
      existingImages: number;
      extractedImages: DetectedImage[];
      latencyMs: number;
      error?: string;
    }> = [];

    for (const page of pages) {
      const imageUrl = page.cropped_photo || page.photo_original || page.photo;
      if (!imageUrl) continue;

      const start = Date.now();
      let extractedImages: DetectedImage[] = [];
      let error: string | undefined;

      try {
        extractedImages = await extractWithMistral(imageUrl);

        // Update the page with extracted images (unless dry run)
        if (!dryRun && extractedImages.length > 0) {
          await db.collection('pages').updateOne(
            { _id: page._id },
            { $set: { detected_images: extractedImages } }
          );
        }
      } catch (e) {
        error = e instanceof Error ? e.message : 'Unknown error';
      }

      results.push({
        pageId: page.id,
        bookTitle: page.book?.title || 'Unknown',
        pageNumber: page.page_number,
        imageUrl,
        existingImages: page.detected_images?.length || 0,
        extractedImages,
        latencyMs: Date.now() - start,
        error,
      });
    }

    // Summary stats
    const totalExtracted = results.reduce((sum, r) => sum + r.extractedImages.length, 0);
    const avgLatency = results.reduce((sum, r) => sum + r.latencyMs, 0) / results.length;
    const errors = results.filter(r => r.error).length;
    const withBbox = results.reduce(
      (sum, r) => sum + r.extractedImages.filter(i => i.bbox).length,
      0
    );

    return NextResponse.json({
      summary: {
        pagesProcessed: results.length,
        totalImagesExtracted: totalExtracted,
        imagesWithBbox: withBbox,
        avgLatencyMs: Math.round(avgLatency),
        errors,
        dryRun,
      },
      results,
    });
  } catch (error) {
    console.error('Extract images error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to extract images' },
      { status: 500 }
    );
  }
}

// GET - check status / get pages with images
export async function GET() {
  try {
    const db = await getDb();

    // Count pages with detected images
    const withImages = await db.collection('pages').countDocuments({
      'detected_images.0': { $exists: true }
    });

    // Count pages with OCR image tags (potential candidates)
    const withOcrTags = await db.collection('pages').countDocuments({
      'ocr.data': { $regex: '\\[\\[image:', $options: 'i' }
    });

    // Count pages with vision-extracted images
    const withVisionExtracted = await db.collection('pages').countDocuments({
      'detected_images.detection_source': 'vision_model'
    });

    return NextResponse.json({
      pagesWithDetectedImages: withImages,
      pagesWithOcrImageTags: withOcrTags,
      pagesWithVisionExtraction: withVisionExtracted,
      usage: {
        method: 'POST',
        body: '{ "limit": 5, "bookId": "optional", "dryRun": true }',
      }
    });
  } catch (error) {
    console.error('Get images status error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get status' },
      { status: 500 }
    );
  }
}
