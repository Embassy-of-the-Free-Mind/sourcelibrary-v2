import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import Replicate from 'replicate';
import sharp from 'sharp';

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
  "type": "woodcut|emblem|engraving|portrait|frontispiece|diagram|chart|illustration|map|symbol|decorative|table",
  "bbox": { "x": 0.15, "y": 0.25, "width": 0.70, "height": 0.45 },
  "confidence": 0.95,
  "gallery_quality": 0.85,
  "gallery_rationale": "Brief explanation of why this image is or isn't gallery-worthy"
}

GALLERY QUALITY SCORING (0.0 to 1.0):
- 0.9-1.0: Exceptional - striking emblems, significant allegorical scenes, beautiful engravings, historically important diagrams
- 0.7-0.9: Good - well-executed illustrations with clear subject matter, interesting diagrams
- 0.4-0.7: Moderate - standard frontispieces, common decorative elements, simple diagrams
- 0.0-0.4: Low - page ornaments, generic borders, printer's marks, marbled papers, simple geometric figures

Consider: Visual appeal, historical/scholarly significance, uniqueness, composition quality, shareability on social media.

Return ONLY a valid JSON array. If no illustrations exist (text-only page), return: []

Example:
[{"description": "Emblem showing Nature guiding an alchemist through a labyrinth", "type": "emblem", "bbox": {"x": 0.15, "y": 0.20, "width": 0.70, "height": 0.55}, "confidence": 0.95, "gallery_quality": 0.92, "gallery_rationale": "Striking allegorical scene with rich symbolic content, excellent composition"}]`;

interface DetectedImage {
  description: string;
  type?: string;
  bbox?: { x: number; y: number; width: number; height: number };
  confidence?: number;
  gallery_quality?: number;
  gallery_rationale?: string;
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
    gallery_quality: typeof item.gallery_quality === 'number' ? item.gallery_quality : undefined,
    gallery_rationale: item.gallery_rationale || undefined,
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
    gallery_quality: typeof item.gallery_quality === 'number' ? item.gallery_quality : undefined,
    gallery_rationale: item.gallery_rationale || undefined,
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
  // Focused on actual book illustrations, not full-page layouts
  const prompt = "frontispiece . woodcut . engraving . portrait . decorated initial . printer's device . coat of arms . allegorical scene";

  // Get image dimensions using sharp
  const imageResponse = await fetch(imageUrl);
  if (!imageResponse.ok) {
    throw new Error(`Failed to fetch image: ${imageResponse.status}`);
  }
  const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
  const metadata = await sharp(imageBuffer).metadata();
  const imgWidth = metadata.width || 1000;
  const imgHeight = metadata.height || 1500;

  // Convert to base64 for Replicate
  const base64Image = `data:image/jpeg;base64,${imageBuffer.toString('base64')}`;

  const output = await replicate.run(
    "adirik/grounding-dino:efd10a8ddc57ea28773327e881ce95e20cc1d734c589f7dd01d2036921ed78aa",
    {
      input: {
        image: base64Image,
        query: prompt,
        box_threshold: 0.3,
        text_threshold: 0.3
      }
    }
  ) as { detections: Array<{ bbox: number[]; label: string; score: number }> };

  if (!output?.detections?.length) {
    return [];
  }

  // Grounding DINO returns bbox as [x1, y1, x2, y2] in pixels
  // Normalize to 0-1 scale using image dimensions
  const detections = output.detections
    .map(det => {
      const rawX = det.bbox[0];
      const rawY = det.bbox[1];
      const rawW = det.bbox[2] - det.bbox[0];
      const rawH = det.bbox[3] - det.bbox[1];

      return {
        description: det.label,
        type: categorizeLabel(det.label),
        bbox: {
          x: rawX / imgWidth,
          y: rawY / imgHeight,
          width: rawW / imgWidth,
          height: rawH / imgHeight
        },
        confidence: det.score,
        detected_at: new Date(),
        detection_source: 'vision_model' as const,
        model: 'grounding-dino' as const,
      };
    })
    // Filter out full-page detections (>70% coverage = probably false positive)
    .filter(det => det.bbox && (det.bbox.width * det.bbox.height) < 0.7);

  // Remove duplicate overlapping detections (NMS)
  return deduplicateDetections(detections);
}

// Calculate Intersection over Union for two bboxes
function calculateIoU(a: { x: number; y: number; width: number; height: number },
                      b: { x: number; y: number; width: number; height: number }): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);

  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const areaA = a.width * a.height;
  const areaB = b.width * b.height;
  const union = areaA + areaB - intersection;

  return union > 0 ? intersection / union : 0;
}

// Remove duplicate detections with high overlap (NMS)
function deduplicateDetections(detections: DetectedImage[], iouThreshold = 0.5): DetectedImage[] {
  if (detections.length <= 1) return detections;

  // Sort by confidence descending
  const sorted = [...detections].sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
  const kept: DetectedImage[] = [];

  for (const det of sorted) {
    if (!det.bbox) {
      kept.push(det);
      continue;
    }

    // Check if this detection overlaps significantly with any kept detection
    const dominated = kept.some(k => k.bbox && calculateIoU(det.bbox!, k.bbox) > iouThreshold);
    if (!dominated) {
      kept.push(det);
    }
  }

  return kept;
}

function categorizeLabel(label: string): string {
  const lower = label.toLowerCase();
  if (lower.includes('frontispiece')) return 'frontispiece';
  if (lower.includes('woodcut')) return 'woodcut';
  if (lower.includes('engraving')) return 'engraving';
  if (lower.includes('portrait')) return 'portrait';
  if (lower.includes('initial')) return 'decorated-initial';
  if (lower.includes('printer') || lower.includes('device')) return 'printers-device';
  if (lower.includes('coat') || lower.includes('arms')) return 'coat-of-arms';
  if (lower.includes('allegori')) return 'allegorical';
  if (lower.includes('map')) return 'map';
  if (lower.includes('diagram')) return 'diagram';
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
