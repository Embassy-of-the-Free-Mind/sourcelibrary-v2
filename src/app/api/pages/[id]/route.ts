import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = await getDb();

    const page = await db.collection('pages').findOne({ id });
    if (!page) {
      return NextResponse.json({ error: 'Page not found' }, { status: 404 });
    }

    return NextResponse.json(page);
  } catch (error) {
    console.error('Error fetching page:', error);
    return NextResponse.json({ error: 'Failed to fetch page' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = await getDb();
    const body = await request.json();

    const updateData: Record<string, unknown> = {
      updated_at: new Date()
    };

    // Update OCR if provided
    if (body.ocr) {
      updateData['ocr.data'] = body.ocr.data;
      updateData['ocr.language'] = body.ocr.language;
      updateData['ocr.model'] = body.ocr.model || 'gemini-2.0-flash';
      updateData['ocr.updated_at'] = new Date();
    }

    // Update translation if provided
    if (body.translation) {
      updateData['translation.data'] = body.translation.data;
      updateData['translation.language'] = body.translation.language;
      updateData['translation.model'] = body.translation.model || 'gemini-2.0-flash';
      updateData['translation.updated_at'] = new Date();
    }

    // Update summary if provided
    if (body.summary) {
      updateData['summary.data'] = body.summary.data;
      updateData['summary.model'] = body.summary.model || 'gemini-2.0-flash';
      updateData['summary.updated_at'] = new Date();
    }

    const result = await db.collection('pages').updateOne(
      { id },
      { $set: updateData }
    );

    if (result.matchedCount === 0) {
      return NextResponse.json({ error: 'Page not found' }, { status: 404 });
    }

    const updatedPage = await db.collection('pages').findOne({ id });
    return NextResponse.json(updatedPage);
  } catch (error) {
    console.error('Error updating page:', error);
    return NextResponse.json({ error: 'Failed to update page' }, { status: 500 });
  }
}
