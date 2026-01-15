import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import { images } from '@/lib/api-client';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
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
      model: 'gemini-3-flash-preview',
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
}
