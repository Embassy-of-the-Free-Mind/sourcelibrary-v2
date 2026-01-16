import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getDb } from '@/lib/mongodb';
import { images } from '@/lib/api-client';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
const geminiModel = process.env.GEMINI_MODEL || 'gemini-3-flash-preview';

export async function POST(request: NextRequest) {
  try {
    const { pageId, imageUrl } = await request.json();

    if (!pageId && !imageUrl) {
      return NextResponse.json({ error: 'pageId or imageUrl required' }, { status: 400 });
    }

    let targetImageUrl = imageUrl;

    // If pageId provided, fetch the page to get image URL
    if (pageId && !imageUrl) {
      const db = await getDb();
      const page = await db.collection('pages').findOne({ id: pageId });
      if (!page) {
        return NextResponse.json({ error: 'Page not found' }, { status: 404 });
      }
      targetImageUrl = page.photo_original || page.photo;
    }

    // Fetch the image
    const imageData = await images.fetchBase64(targetImageUrl, { includeMimeType: true });
    if (!imageData) {
      return NextResponse.json({ error: 'Failed to fetch image' }, { status: 500 });
    }

    const { base64, mimeType } = typeof imageData === 'string'
      ? { base64: imageData, mimeType: 'image/jpeg' }
      : { base64: imageData.base64, mimeType: imageData.mimeType };

    // Use Gemini 3 Flash for vision
    const model = genAI.getGenerativeModel({ model: geminiModel });

    const prompt = `You are an expert at analyzing scanned book spreads to find the optimal vertical split line.

TASK: Find the exact vertical position to split this two-page book scan into left and right pages.

CRITICAL RULES:
1. NEVER cut through text - the split must fall in a gap between text columns
2. The book may not be perfectly vertical - follow the natural angle of the binding
3. Gutter appearance varies widely:
   - Dark shadow (common in phone/camera scans)
   - Bright gap (common in flatbed scans)
   - Curved distortion near binding
   - No visible gutter at all (just margin between text blocks)

ANALYSIS APPROACH:
1. First, identify the text blocks on left and right pages
2. Find the gap/margin between them - this is where to split
3. If there's a visible gutter line (dark or light), use it as a guide
4. If the book is tilted, the split line should follow the tilt
5. Prefer erring slightly toward margins rather than cutting text

OUTPUT: Return ONLY a single integer from 0-1000:
- 0 = left edge
- 500 = center
- 1000 = right edge

Example output: 487`;

    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          mimeType,
          data: base64,
        },
      },
    ]);

    const responseText = result.response.text().trim();

    // Parse the position from the response
    const positionMatch = responseText.match(/\d+/);
    let position = 500; // Default to center

    if (positionMatch) {
      position = parseInt(positionMatch[0], 10);
      // Clamp to valid range
      position = Math.max(100, Math.min(900, position));
    }

    // Get token usage for cost tracking
    const usageMetadata = result.response.usageMetadata;
    const inputTokens = usageMetadata?.promptTokenCount || 0;
    const outputTokens = usageMetadata?.candidatesTokenCount || 0;

    return NextResponse.json({
      position,
      rawResponse: responseText,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
      },
    });
  } catch (error) {
    console.error('Gemini split detection error:', error);
    return NextResponse.json(
      { error: 'Split detection failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
