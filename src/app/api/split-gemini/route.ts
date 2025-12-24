import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getDb } from '@/lib/mongodb';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

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
    const imageResponse = await fetch(targetImageUrl);
    if (!imageResponse.ok) {
      return NextResponse.json({ error: 'Failed to fetch image' }, { status: 500 });
    }

    const imageBuffer = await imageResponse.arrayBuffer();
    const base64Image = Buffer.from(imageBuffer).toString('base64');
    let mimeType = imageResponse.headers.get('content-type') || 'image/jpeg';
    mimeType = mimeType.split(';')[0].trim();

    // Use Gemini 2.0 Flash for vision
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });

    const prompt = `You are analyzing a scanned book page that shows TWO pages side by side (a two-page spread from an open book).

Your task is to find the EXACT vertical position where these two pages meet - this is called the "gutter" or "binding" of the book.

Look for:
1. A vertical line or shadow running from top to bottom where the book binding creates a crease
2. The point where text/content from the LEFT page ends and the RIGHT page begins
3. Any visible book spine or binding shadow

Return ONLY a single number between 0 and 1000, representing the horizontal position of the split:
- 0 = far left edge
- 500 = exact center
- 1000 = far right edge

For most scanned books, the gutter is near 500 (center) but may be slightly off due to scanning.

IMPORTANT: Return ONLY the number, nothing else. Example: 485`;

    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          mimeType,
          data: base64Image,
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
