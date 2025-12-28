import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import Replicate from 'replicate';

/**
 * POST /api/extract-images
 *
 * Run image extraction on pages with illustrations.
 * Body: { limit?: number, bookId?: string, model?: 'gemini' | 'mistral' | 'grounding-dino' }
 */

const EXTRACTION_PROMPT = `You are analyzing a historical book page scan. Your task is to identify and PRECISELY locate all illustrations, diagrams, woodcuts, charts, maps, or decorative elements.

CRITICAL: Provide EXACT bounding box coordinates. Measure carefully:
- x: horizontal position of LEFT edge (0.0 = left margin, 1.0 = right margin)
- y: vertical position of TOP edge (0.0 = top margin, 1.0 = bottom margin)
- width: horizontal span of the illustration
- height: vertical span of the illustration

The bounding box should TIGHTLY enclose just the illustration, not the surrounding text.

For each illustration found, return:
{
  "description": "Brief description of what it depicts",
  "type": "woodcut|diagram|chart|illustration|map|symbol|decorative|table",
  "bbox": { "x": 0.15, "y": 0.25, "width": 0.70, "height": 0.45 },
  "confidence": 0.95
}

Return ONLY a valid JSON array. If no illustrations exist (text-only page), return: []

Example for a woodcut in the upper-right quadrant:
[{"description": "Alchemical furnace with dragon", "type": "woodcut", "bbox": {"x": 0.55, "y": 0.10, "width": 0.40, "height": 0.35}, "confidence": 0.95}]`;

interface DetectedImage {
  description: string;
  type?: string;
  bbox?: { x: number; y: number; width: number; height: number };
  confidence?: number;
  detected_at: Date;
  detection_source: 'vision_model';
  model: 'gemini' | 'mistral' | 'grounding-dino';
}

async function extractWithGemini(imageUrl: string): Promise<DetectedImage[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY not set');
  }

  // Fetch and encode image
  const imageResponse = await fetch(imageUrl);
  if (!imageResponse.ok) {
    throw new Error(`Failed to fetch image: ${imageResponse.status}`);
  }

  const imageBuffer = await imageResponse.arrayBuffer();
  const base64Image = Buffer.from(imageBuffer).toString('base64');
  const mimeType = imageResponse.headers.get('content-type')?.split(';')[0] || 'image/jpeg';

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
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

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Gemini API error: ${response.status} - ${error.slice(0, 200)}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

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
    model: 'gemini' as const,
  }));
}

async function extractWithMistral(imageUrl: string): Promise<DetectedImage[]> {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) {
    throw new Error('MISTRAL_API_KEY not set');
  }

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
    model: 'mistral' as const,
  }));
}

async function extractWithGroundingDino(imageUrl: string): Promise<DetectedImage[]> {
  const apiToken = process.env.REPLICATE_API_TOKEN;
  if (!apiToken) {
    throw new Error('REPLICATE_API_TOKEN not set');
  }

  const replicate = new Replicate({ auth: apiToken });

  // Grounding DINO prompt for detecting illustrations in historical texts
  const prompt = "illustration . diagram . woodcut . chart . map . decorative element . symbol . figure . drawing . engraving";

  const output = await replicate.run(
    "adirik/grounding-dino:efd10a8ddc57ea28773327e881ce95e20cc1d734c589f7dd01d2036921ed78aa",
    {
      input: {
        image: imageUrl,
        query: prompt,
        box_threshold: 0.25,
        text_threshold: 0.25
      }
    }
  ) as { detections: Array<{ bbox: number[]; label: string; score: number }> };

  if (!output?.detections?.length) {
    return [];
  }

  // Grounding DINO returns bbox as [x1, y1, x2, y2] in pixels
  // We need to normalize to 0-1 scale
  // The model returns normalized coordinates already (0-1)
  return output.detections.map(det => ({
    description: det.label,
    type: categorizeLabel(det.label),
    bbox: {
      x: det.bbox[0],
      y: det.bbox[1],
      width: det.bbox[2] - det.bbox[0],
      height: det.bbox[3] - det.bbox[1]
    },
    confidence: det.score,
    detected_at: new Date(),
    detection_source: 'vision_model' as const,
    model: 'grounding-dino' as const,
  }));
}

function categorizeLabel(label: string): string {
  const lower = label.toLowerCase();
  if (lower.includes('diagram')) return 'diagram';
  if (lower.includes('chart')) return 'chart';
  if (lower.includes('map')) return 'map';
  if (lower.includes('woodcut') || lower.includes('engraving')) return 'woodcut';
  if (lower.includes('symbol')) return 'symbol';
  if (lower.includes('decorative')) return 'decorative';
  if (lower.includes('figure') || lower.includes('drawing')) return 'illustration';
  return 'illustration';
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const limit = Math.min(body.limit || 5, 20); // Max 20 pages
    const bookId = body.bookId;
    const dryRun = body.dryRun || false;
    const model: 'gemini' | 'mistral' | 'grounding-dino' = body.model || 'gemini';

    const extractFn = model === 'mistral'
      ? extractWithMistral
      : model === 'grounding-dino'
        ? extractWithGroundingDino
        : extractWithGemini;

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
        extractedImages = await extractFn(imageUrl);

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
        model,
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
