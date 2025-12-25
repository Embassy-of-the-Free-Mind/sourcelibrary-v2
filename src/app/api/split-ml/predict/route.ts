import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { extractFeatures, predictWithModel, type SplitModel } from '@/lib/splitDetectionML';

/**
 * POST - Predict split position using the trained ML model
 *
 * Request body:
 * {
 *   imageUrl: string,
 *   // OR
 *   pageId: string
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const { imageUrl, pageId } = await request.json();
    const db = await getDb();

    // Get the active model
    const model = await db.collection('split_models')
      .findOne({ isActive: true }) as unknown as SplitModel | null;

    if (!model) {
      return NextResponse.json(
        { error: 'No trained model available. Train a model first.' },
        { status: 400 }
      );
    }

    // Get image URL
    let url = imageUrl;
    if (!url && pageId) {
      const page = await db.collection('pages').findOne({ id: pageId });
      if (!page?.photo) {
        return NextResponse.json({ error: 'Page not found or has no image' }, { status: 404 });
      }
      url = page.photo;
    }

    if (!url) {
      return NextResponse.json({ error: 'imageUrl or pageId required' }, { status: 400 });
    }

    // Fetch and extract features
    const startTime = performance.now();

    const imageResponse = await fetch(url);
    if (!imageResponse.ok) {
      return NextResponse.json({ error: 'Failed to fetch image' }, { status: 400 });
    }

    const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
    const features = await extractFeatures(imageBuffer);

    // Predict using the model
    const position = predictWithModel(features, model);

    const duration = performance.now() - startTime;

    return NextResponse.json({
      position,
      features: {
        aspectRatio: Math.round(features.aspectRatio * 100) / 100,
        hasInvertedGutter: features.hasInvertedGutter,
        edgeCenterDiff: Math.round(features.edgeCenterDiff),
        gutterWidth: features.gutterWidth,
        textGapCenter: Math.round(features.textGapCenter),
        textGapWidth: Math.round(features.textGapWidth),
        leftTextEndIdx: Math.round(features.leftTextEndIdx),
        rightTextStartIdx: Math.round(features.rightTextStartIdx),
      },
      modelInfo: {
        trainingSize: model.trainingSize,
        validationRMSE: Math.round(Math.sqrt(model.validationMSE)),
      },
      duration: Math.round(duration),
    });

  } catch (error) {
    console.error('Error predicting split:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Prediction failed' },
      { status: 500 }
    );
  }
}
