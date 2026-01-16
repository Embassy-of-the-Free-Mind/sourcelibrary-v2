import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { trainModel, type TrainingExample, type SplitModel } from '@/lib/page-split/splitDetectionML';

/**
 * POST - Train the ML model on collected examples
 */
export async function POST(request: NextRequest) {
  try {
    const { minExamples = 10 } = await request.json().catch(() => ({}));
    const db = await getDb();

    // Get all training examples
    const examples = await db.collection('split_training_examples')
      .find({})
      .toArray() as unknown as TrainingExample[];

    if (examples.length < minExamples) {
      return NextResponse.json({
        error: `Need at least ${minExamples} examples to train. Have ${examples.length}.`,
        currentCount: examples.length,
      }, { status: 400 });
    }

    // Train the model
    const model = trainModel(examples);

    // Deactivate all existing models first
    await db.collection('split_models').updateMany(
      {},
      { $set: { isActive: false } }
    );

    // Save the trained model as active
    const version = Date.now();
    await db.collection('split_models').insertOne({
      ...model,
      version,
      isActive: true,
    });

    return NextResponse.json({
      success: true,
      model: {
        trainedAt: model.trainedAt,
        trainingSize: model.trainingSize,
        validationMSE: Math.round(model.validationMSE * 100) / 100,
        validationRMSE: Math.round(Math.sqrt(model.validationMSE) * 100) / 100,
        weights: model.weights,
      },
    });

  } catch (error) {
    console.error('Error training model:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Training failed' },
      { status: 500 }
    );
  }
}

/**
 * GET - Get current model status and training stats
 */
export async function GET() {
  try {
    const db = await getDb();

    // Get active model
    const activeModel = await db.collection('split_models')
      .findOne({ isActive: true }) as unknown as (SplitModel & { version: number }) | null;

    // Get training example counts
    const totalExamples = await db.collection('split_training_examples').countDocuments();

    // Get examples by book
    const examplesByBook = await db.collection('split_training_examples')
      .aggregate([
        { $group: { _id: '$bookId', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 }
      ])
      .toArray();

    // Get confidence distribution
    const byConfidence = await db.collection('split_training_examples')
      .aggregate([
        { $group: { _id: '$geminiConfidence', count: { $sum: 1 } } }
      ])
      .toArray();

    return NextResponse.json({
      hasActiveModel: !!activeModel,
      activeModel: activeModel ? {
        trainedAt: activeModel.trainedAt,
        trainingSize: activeModel.trainingSize,
        validationMSE: Math.round(activeModel.validationMSE * 100) / 100,
        validationRMSE: Math.round(Math.sqrt(activeModel.validationMSE) * 100) / 100,
        weights: activeModel.weights,
      } : null,
      trainingData: {
        totalExamples,
        byBook: examplesByBook.map(b => ({ bookId: b._id, count: b.count })),
        byConfidence: byConfidence.reduce((acc, c) => {
          acc[c._id] = c.count;
          return acc;
        }, {} as Record<string, number>),
      },
    });

  } catch (error) {
    console.error('Error getting model status:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get status' },
      { status: 500 }
    );
  }
}
