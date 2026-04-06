/**
 * Shared image extraction library
 * Centralizes image detection logic for use across multiple endpoints
 */

import Replicate from 'replicate';
import { images } from '@/lib/api-client';

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

SKIP these — do NOT include them:
- Page ornaments, borders, decorative initials, printer's devices
- Marbled papers, blank frames, ruled lines
- Any element that is purely decorative with no intellectual content

For each significant illustration return:
{
  "description": "Brief factual description",
  "type": "emblem|woodcut|engraving|portrait|frontispiece|musical_score|diagram|symbol|map",
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

GALLERY QUALITY (0.0-1.0):
- 0.9-1.0: Exceptional emblems, portraits, allegorical scenes with figures
- 0.8-0.9: Illustrations with people/figures
- 0.6-0.8: Good illustrations without people
- 0.4-0.6: Musical scores, alchemical symbols

MUSEUM DESCRIPTION: Write 2-3 sentences for a museum label - what the viewer sees and its significance.

Return ONLY a valid JSON array. If no significant illustrations, return: []`;

export interface BookContext {
  title?: string;
  author?: string;
  year?: number | string;
  language?: string;
  subjects?: string[];
}

/** Build a context prefix to prepend to the extraction prompt */
function buildContextPrefix(ctx: BookContext): string {
  const parts: string[] = [];
  if (ctx.title) parts.push(`Book: "${ctx.title}"`);
  if (ctx.author) parts.push(`Author: ${ctx.author}`);
  if (ctx.year) parts.push(`Year: ${ctx.year}`);
  if (ctx.language) parts.push(`Language: ${ctx.language}`);
  if (ctx.subjects?.length) parts.push(`Subjects: ${ctx.subjects.join(', ')}`);
  if (parts.length === 0) return '';
  return `BOOK CONTEXT (use this to inform your analysis — identify figures, symbols, and traditions specific to this work):\n${parts.join(' | ')}\n\n`;
}

export interface ImageMetadata {
  subjects?: string[];
  figures?: string[];
  symbols?: string[];
  style?: string;
  technique?: string;
  condition?: string;
}

/**
 * Normalize bbox values to 0-1 range at storage time.
 * AI models sometimes return 0-1000 scale instead of the requested 0-1.
 */
function normalizeBbox(raw: { x: number; y: number; width: number; height: number }) {
  const { x, y, width, height } = raw;
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

export interface DetectedImage {
  description: string;
  type?: string;
  bbox?: { x: number; y: number; width: number; height: number };
  confidence?: number;
  gallery_quality?: number;
  gallery_rationale?: string;
  metadata?: ImageMetadata;
  museum_description?: string;
  detected_at: Date;
  detection_source: 'vision_model';
  model: string;
}

const DEFAULT_MODEL = 'gemini-3-flash-preview';

function getMimeType(url: string, headerType: string | null | undefined): string {
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

/** Result with token usage, returned when { returnUsage: true } is passed */
export interface ExtractionResult {
  images: DetectedImage[];
  usage: { inputTokens: number; outputTokens: number };
  promptHash?: string;
}

/**
 * Extract illustrations from a page image using Gemini vision.
 *
 * @param imageUrl URL to fetch the image from
 * @param model Gemini model to use (default: gemini-3-flash-preview)
 * @param options Pass { returnUsage: true } to get token counts alongside images
 * @returns DetectedImage[] by default, or ExtractionResult with usage when requested
 */
export async function extractWithGemini(
  imageUrl: string,
  model?: string
): Promise<DetectedImage[]>;
export async function extractWithGemini(
  imageUrl: string,
  model: string,
  options: { returnUsage: true; ocrData?: string; bookContext?: BookContext; promptText?: string }
): Promise<ExtractionResult>;
export async function extractWithGemini(
  imageUrl: string,
  model: string = DEFAULT_MODEL,
  options?: { returnUsage?: true; ocrData?: string; bookContext?: BookContext; promptText?: string }
): Promise<DetectedImage[] | ExtractionResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY not set');
  }

  // Fetch and encode image
  const imageData = await images.fetchBase64(imageUrl, { includeMimeType: true });
  const { base64: base64Image, mimeType } = typeof imageData === 'string'
    ? { base64: imageData, mimeType: getMimeType(imageUrl, null) }
    : { base64: imageData.base64, mimeType: imageData.mimeType };

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: (options?.bookContext ? buildContextPrefix(options.bookContext) : '') + (options?.promptText || IMAGE_EXTRACTION_PROMPT) },
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

  // Extract token usage from response
  const usageMetadata = data.usageMetadata;
  const usage = {
    inputTokens: usageMetadata?.promptTokenCount || 0,
    outputTokens: usageMetadata?.candidatesTokenCount || 0,
  };

  // Parse JSON from response
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    if (options?.returnUsage) return { images: [], usage };
    return [];
  }

  const parsed = JSON.parse(jsonMatch[0]);
  if (!Array.isArray(parsed)) {
    if (options?.returnUsage) return { images: [], usage };
    return [];
  }

  const detectedImages: DetectedImage[] = parsed.map(item => ({
    description: item.description || '',
    type: item.type || 'unknown',
    bbox: item.bbox ? normalizeBbox({
      x: parseFloat(item.bbox.x) || 0,
      y: parseFloat(item.bbox.y) || 0,
      width: parseFloat(item.bbox.width) || 0,
      height: parseFloat(item.bbox.height) || 0,
    }) : undefined,
    confidence: item.confidence,
    gallery_quality: typeof item.gallery_quality === 'number' ? item.gallery_quality : undefined,
    gallery_rationale: item.gallery_rationale || undefined,
    metadata: item.metadata ? {
      subjects: Array.isArray(item.metadata.subjects) ? item.metadata.subjects : undefined,
      figures: Array.isArray(item.metadata.figures) ? item.metadata.figures : undefined,
      symbols: Array.isArray(item.metadata.symbols) ? item.metadata.symbols : undefined,
      style: item.metadata.style || undefined,
      technique: item.metadata.technique || undefined,
      condition: item.metadata.condition || undefined,
    } : undefined,
    museum_description: item.museum_description || undefined,
    detected_at: new Date(),
    detection_source: 'vision_model' as const,
    model: model,
  }));

  if (options?.returnUsage) return { images: detectedImages, usage };
  return detectedImages;
}

/**
 * Extract illustrations using Mistral's Pixtral vision model
 * @param imageUrl URL to fetch the image from
 * @returns Array of detected images
 */
export async function extractWithMistral(imageUrl: string): Promise<DetectedImage[]> {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) {
    throw new Error('MISTRAL_API_KEY not set');
  }

  // Fetch and encode image
  const imageData = await images.fetchBase64(imageUrl, { includeMimeType: true });
  const { base64: base64Image, mimeType } = typeof imageData === 'string'
    ? { base64: imageData, mimeType: getMimeType(imageUrl, null) }
    : { base64: imageData.base64, mimeType: imageData.mimeType };
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
          { type: 'text', text: IMAGE_EXTRACTION_PROMPT },
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
    bbox: item.bbox ? normalizeBbox({
      x: parseFloat(item.bbox.x) || 0,
      y: parseFloat(item.bbox.y) || 0,
      width: parseFloat(item.bbox.width) || 0,
      height: parseFloat(item.bbox.height) || 0,
    }) : undefined,
    confidence: item.confidence,
    gallery_quality: typeof item.gallery_quality === 'number' ? item.gallery_quality : undefined,
    gallery_rationale: item.gallery_rationale || undefined,
    detected_at: new Date(),
    detection_source: 'vision_model' as const,
    model: 'mistral',
  }));
}

/**
 * Extract illustrations using Grounding DINO object detection
 * @param imageUrl URL to fetch the image from
 * @returns Array of detected images
 */
export async function extractWithGroundingDino(imageUrl: string): Promise<DetectedImage[]> {
  const apiToken = process.env.REPLICATE_API_TOKEN;
  if (!apiToken) {
    throw new Error('REPLICATE_API_TOKEN not set');
  }

  // Lazy load sharp only when this function is called (not at module load time)
  const sharp = (await import('sharp')).default;

  const replicate = new Replicate({ auth: apiToken });

  // Grounding DINO prompt for detecting illustrations in historical texts
  const prompt = "frontispiece . woodcut . engraving . portrait . decorated initial . printer's device . coat of arms . allegorical scene";

  // Fetch image buffer
  const imageBuffer = await images.fetchBuffer(imageUrl);

  // Get image dimensions using sharp
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

  // Normalize bbox from pixels to 0-1 scale
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
        model: 'grounding-dino',
      };
    })
    // Filter out full-page detections (>70% coverage = probably false positive)
    .filter(det => det.bbox && (det.bbox.width * det.bbox.height) < 0.7);

  // Remove duplicate overlapping detections (NMS)
  return deduplicateDetections(detections);
}

// Helper functions

/**
 * Calculate Intersection over Union for two bounding boxes
 */
export function calculateIoU(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number }
): number {
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

/**
 * Remove duplicate detections with high overlap (Non-Maximum Suppression)
 */
export function deduplicateDetections(detections: DetectedImage[], iouThreshold = 0.5): DetectedImage[] {
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

/**
 * Categorize detection label into standard illustration types
 */
export function categorizeLabel(label: string): string {
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
