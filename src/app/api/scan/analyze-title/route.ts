export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { performOCRWithBuffer } from '@/lib/ai';

const CORNER_DETECTION_PROMPT = `Analyze this photo of a book page. Return ONLY valid JSON with these fields:

1. "ocr_text": Full transcription of all visible text on the page.
2. "corners": The 4 corners of the book/page boundary as [x, y] pairs with normalized 0-1 coordinates, ordered clockwise from top-left: [[topLeft_x, topLeft_y], [topRight_x, topRight_y], [bottomRight_x, bottomRight_y], [bottomLeft_x, bottomLeft_y]]. Only include the page itself, not the desk/background. If the page fills the entire image, return [[0,0],[1,0],[1,1],[0,1]].

Return ONLY the JSON object, no markdown fences or other text.`;

const METADATA_EXTRACTION_PROMPT = `Extract book metadata from this title page text. Return ONLY valid JSON with:
- "title": The book title (in the original language)
- "author": The author name(s)
- "language": The primary language of the text (e.g. "Latin", "English", "German")
- "year": Publication year as a number, or null if not visible

If a field is not identifiable, use null. Return ONLY the JSON object.

Title page text:
`;

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file || !file.type.startsWith('image/')) {
      return NextResponse.json(
        { error: 'Image file required' },
        { status: 400 }
      );
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Step 1: OCR + corner detection in a single Gemini vision call
    const visionResult = await performOCRWithBuffer(
      buffer,
      file.type,
      CORNER_DETECTION_PROMPT
    );

    let ocrText = '';
    let corners: [number, number][] | null = null;

    try {
      // Clean potential markdown fences
      const cleaned = visionResult.text
        .replace(/```json\s*/g, '')
        .replace(/```\s*/g, '')
        .trim();
      const parsed = JSON.parse(cleaned);
      ocrText = parsed.ocr_text || '';
      corners = parsed.corners || null;
    } catch {
      // If JSON parsing fails, treat entire response as OCR text
      ocrText = visionResult.text;
    }

    // Step 2: Extract structured metadata from OCR text (text-only call)
    let title: string | null = null;
    let author: string | null = null;
    let language: string | null = null;
    let year: number | null = null;

    if (ocrText) {
      const metadataResult = await performOCRWithBuffer(
        buffer,
        file.type,
        METADATA_EXTRACTION_PROMPT + ocrText
      );

      try {
        const cleaned = metadataResult.text
          .replace(/```json\s*/g, '')
          .replace(/```\s*/g, '')
          .trim();
        const meta = JSON.parse(cleaned);
        title = meta.title || null;
        author = meta.author || null;
        language = meta.language || null;
        year = meta.year || null;
      } catch {
        // Metadata extraction failed — user will fill in manually
      }
    }

    return NextResponse.json({
      ocr_text: ocrText,
      title,
      author,
      language,
      year,
      corners,
    });
  } catch (error) {
    console.error('Title analysis error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Analysis failed' },
      { status: 500 }
    );
  }
}
