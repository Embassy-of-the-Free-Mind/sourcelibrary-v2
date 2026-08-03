import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import { images } from '@/lib/api-client';
import { withAuth } from '@/lib/auth-helpers';
import { logGeminiCall } from '@/lib/gemini-logger';
import { getTriggerSource } from '@/lib/cron-auth';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
const DETECT_SPLIT_MODEL = 'gemini-3-flash-preview';

// Gated at `editor` (ops#6). The worst of the group before this: an
// unauthenticated, entirely uncached, image-input vision call that also writes
// `pages.split_detection`. There is no cache to hit, so every request spent.
export const POST = withAuth(async (request, session, context) => {
  const startTime = Date.now();

  try {
    const { id } = await context.params;
    const triggeredBy = getTriggerSource(request);
    const db = await getDb();

    // Get the page
    const page = await db.collection('pages').findOne({ id });
    if (!page) {
      return NextResponse.json({ error: 'Page not found' }, { status: 404 });
    }

    // Get image URL (use original if available)
    const imageUrl = page.photo_original || page.photo;
    if (!imageUrl || !imageUrl.startsWith('http')) {
      return NextResponse.json({ error: 'No valid image URL' }, { status: 400 });
    }

    // Download and encode image
    const imageData = await images.fetchBase64(imageUrl);
    const base64Image = typeof imageData === 'string' ? imageData : imageData.base64;

    // Run Gemini detection (using fastest model)
    const model = genAI.getGenerativeModel({
      model: DETECT_SPLIT_MODEL,
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: SchemaType.OBJECT,
          properties: {
            isTwoPageSpread: { type: SchemaType.BOOLEAN },
            confidence: { type: SchemaType.STRING },
            reasoning: { type: SchemaType.STRING },
            leftPage: {
              type: SchemaType.OBJECT,
              properties: {
                xmin: { type: SchemaType.NUMBER },
                xmax: { type: SchemaType.NUMBER },
                ymin: { type: SchemaType.NUMBER },
                ymax: { type: SchemaType.NUMBER },
              },
            },
            rightPage: {
              type: SchemaType.OBJECT,
              properties: {
                xmin: { type: SchemaType.NUMBER },
                xmax: { type: SchemaType.NUMBER },
                ymin: { type: SchemaType.NUMBER },
                ymax: { type: SchemaType.NUMBER },
              },
            },
          },
          required: ['isTwoPageSpread', 'confidence', 'reasoning', 'leftPage', 'rightPage'],
        },
      },
    });

    const result = await model.generateContent([
      {
        inlineData: {
          data: base64Image,
          mimeType: 'image/jpeg',
        },
      },
      {
        text: `Analyze this book scan image.

Is this a SINGLE PAGE or a TWO-PAGE SPREAD (open book with two facing pages)?

TWO-PAGE SPREAD indicators:
- Visible book binding/gutter/spine in center
- Dark line or shadow between two page areas
- Different content on left vs right

SINGLE PAGE indicators:
- No central binding
- Content flows across entire image
- Multiple columns is still ONE page

If TWO PAGES: Return bounding boxes for left (0% to ~51%) and right (~49% to 100%)
If ONE PAGE: Return full image as leftPage, set rightPage to zeros

Coordinates as 0-1000 scale.`,
      },
    ]);

    // Bill per RESPONSE, not per saved page: Gemini charges for this call even
    // if the JSON below fails to parse, so log before touching the result.
    // Until now this route called Gemini without logging at all, which is why
    // its spend was invisible in `gemini_usage`.
    logGeminiCall({
      type: 'other',
      mode: 'realtime',
      model: DETECT_SPLIT_MODEL,
      book_id: page.book_id,
      page_ids: [id],
      input_tokens: result.response.usageMetadata?.promptTokenCount || 0,
      output_tokens: result.response.usageMetadata?.candidatesTokenCount || 0,
      status: 'success',
      duration_ms: Date.now() - startTime,
      prompt_version: 'detect-split-v1',
      endpoint: '/api/pages/[id]/detect-split',
      triggered_by: triggeredBy,
    });

    const detection = JSON.parse(result.response.text());

    // Save detection result to page
    await db.collection('pages').updateOne(
      { id },
      { $set: { split_detection: detection, updated_at: new Date() } }
    );

    return NextResponse.json(detection);
  } catch (error) {
    console.error('Split detection error:', error);
    return NextResponse.json(
      { error: 'Detection failed' },
      { status: 500 }
    );
  }
}, { minRole: 'editor' });
