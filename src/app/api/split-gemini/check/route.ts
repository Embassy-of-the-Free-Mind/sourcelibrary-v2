import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getDb } from '@/lib/mongodb';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

/**
 * Check if an image is a two-page spread using Gemini
 */
export async function POST(request: NextRequest) {
  try {
    const { pageId, imageUrl } = await request.json();

    if (!pageId && !imageUrl) {
      return NextResponse.json({ error: 'pageId or imageUrl required' }, { status: 400 });
    }

    let targetImageUrl = imageUrl;

    if (pageId && !imageUrl) {
      const db = await getDb();
      const page = await db.collection('pages').findOne({ id: pageId });
      if (!page) {
        return NextResponse.json({ error: 'Page not found' }, { status: 404 });
      }
      targetImageUrl = page.photo_original || page.photo;
    }

    // Use smaller image for speed
    let fetchUrl = targetImageUrl;
    if (fetchUrl.includes('archive.org') && fetchUrl.includes('pct:50')) {
      fetchUrl = fetchUrl.replace('pct:50', 'pct:25');
    }

    const imageResponse = await fetch(fetchUrl);
    if (!imageResponse.ok) {
      return NextResponse.json({ error: 'Failed to fetch image' }, { status: 500 });
    }

    const imageBuffer = await imageResponse.arrayBuffer();
    const base64Image = Buffer.from(imageBuffer).toString('base64');
    let mimeType = imageResponse.headers.get('content-type') || 'image/jpeg';
    mimeType = mimeType.split(';')[0].trim();
    if (mimeType === 'application/octet-stream') {
      mimeType = 'image/jpeg';
    }

    const model = genAI.getGenerativeModel({ model: 'gemini-3-flash-preview' });

    const prompt = `Analyze this scanned book image and determine:

1. Is this a TWO-PAGE SPREAD (showing two facing pages side by side, typically landscape orientation) or a SINGLE PAGE (showing just one page, typically portrait orientation)?

2. If it's a two-page spread, where is the center gutter/binding? Express as a number 0-1000 where 0=left edge, 500=center, 1000=right edge.

Return your answer in this EXACT JSON format:
{
  "isTwoPageSpread": true or false,
  "splitPosition": <number 0-1000, or null if single page>,
  "confidence": "high" or "medium" or "low",
  "reasoning": "<brief explanation>"
}`;

    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          mimeType,
          data: base64Image,
        },
      },
    ]);

    const responseText = result.response.text();

    // Parse JSON from response
    const jsonMatch = responseText.match(/\{[\s\S]*?\}/);
    if (!jsonMatch) {
      return NextResponse.json({
        error: 'Could not parse response',
        rawResponse: responseText
      }, { status: 500 });
    }

    const parsed = JSON.parse(jsonMatch[0]);

    return NextResponse.json({
      isTwoPageSpread: parsed.isTwoPageSpread,
      splitPosition: parsed.splitPosition,
      confidence: parsed.confidence,
      reasoning: parsed.reasoning,
      usage: {
        inputTokens: result.response.usageMetadata?.promptTokenCount || 0,
        outputTokens: result.response.usageMetadata?.candidatesTokenCount || 0,
      },
    });

  } catch (error) {
    console.error('Gemini check error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Check failed' },
      { status: 500 }
    );
  }
}
