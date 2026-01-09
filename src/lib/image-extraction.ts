/**
 * Shared image extraction library
 * Centralizes image detection logic for use across multiple endpoints
 */

import { images } from '@/lib/api-client';

export const IMAGE_EXTRACTION_PROMPT = `You are a museum curator analyzing a historical book page scan. Create rich metadata for each illustration.

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

GALLERY QUALITY (0.0-1.0):
- 0.9-1.0: Exceptional emblems, portraits, allegorical scenes with figures
- 0.8-0.9: Illustrations with people/figures
- 0.6-0.8: Good illustrations without people
- 0.4-0.6: Musical scores, standard decorative elements
- 0.2-0.4: Page ornaments, borders
- 0.0-0.2: Marbled papers, blank frames

MUSEUM DESCRIPTION: Write 2-3 sentences for a museum label - what the viewer sees and its significance.

Return ONLY a valid JSON array. If no illustrations, return: []`;

export interface ImageMetadata {
  subjects?: string[];
  figures?: string[];
  symbols?: string[];
  style?: string;
  technique?: string;
  condition?: string;
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

const DEFAULT_MODEL = 'gemini-2.5-flash';

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

/**
 * Extract illustrations from a page image using Gemini vision
 * @param imageUrl URL to fetch the image from
 * @param model Gemini model to use (default: gemini-2.5-flash)
 * @returns Array of detected images with bounding boxes and metadata
 */
export async function extractWithGemini(
  imageUrl: string,
  model: string = DEFAULT_MODEL
): Promise<DetectedImage[]> {
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
            { text: IMAGE_EXTRACTION_PROMPT },
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
}
