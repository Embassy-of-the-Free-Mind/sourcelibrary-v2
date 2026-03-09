export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { performOCRWithBuffer } from '@/lib/ai';

const ANALYZE_TITLE_PROMPT = `Analyze this photo of a book's title page. Return ONLY valid JSON with these fields:

1. "ocr_text": Full transcription of all visible text on the page.
2. "corners": The 4 corners of the book/page boundary as [x, y] pairs with normalized 0-1 coordinates, ordered clockwise from top-left: [[topLeft_x, topLeft_y], [topRight_x, topRight_y], [bottomRight_x, bottomRight_y], [bottomLeft_x, bottomLeft_y]]. Only include the page itself, not the desk/background. If the page fills the entire image, return [[0,0],[1,0],[1,1],[0,1]].
3. "title": The book title (in the original language). null if not identifiable.
4. "author": The author name(s). null if not identifiable.
5. "language": The primary language of the text (e.g. "Latin", "English", "German"). null if unclear.
6. "year": Publication year as a number, or null if not visible.

Return ONLY the JSON object, no markdown fences or other text.`;

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

    // Single Gemini vision call: OCR + corners + metadata
    const visionResult = await performOCRWithBuffer(
      buffer,
      file.type,
      ANALYZE_TITLE_PROMPT
    );

    let ocrText = '';
    let corners: [number, number][] | null = null;
    let title: string | null = null;
    let author: string | null = null;
    let language: string | null = null;
    let year: number | null = null;

    try {
      const cleaned = visionResult.text
        .replace(/```json\s*/g, '')
        .replace(/```\s*/g, '')
        .trim();
      const parsed = JSON.parse(cleaned);
      ocrText = parsed.ocr_text || '';
      corners = parsed.corners || null;
      title = parsed.title || null;
      author = parsed.author || null;
      language = parsed.language || null;
      year = parsed.year || null;
    } catch {
      // If JSON parsing fails, treat entire response as OCR text
      ocrText = visionResult.text;
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
