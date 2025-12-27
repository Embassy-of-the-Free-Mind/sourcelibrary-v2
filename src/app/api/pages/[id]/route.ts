import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { z } from 'zod';

// Validation schema for page updates
const pageUpdateSchema = z.object({
  ocr: z.object({
    data: z.string().max(500000, 'OCR data too large'),
    language: z.string().min(1).max(50),
    model: z.string().max(100).optional(),
  }).optional(),
  translation: z.object({
    data: z.string().max(500000, 'Translation data too large'),
    language: z.string().min(1).max(50),
    model: z.string().max(100).optional(),
  }).optional(),
  summary: z.object({
    data: z.string().max(10000, 'Summary too large'),
    model: z.string().max(100).optional(),
  }).optional(),
  // Source tracking for manual edits
  edited_by: z.string().max(100).optional(),
}).refine(data => data.ocr || data.translation || data.summary, {
  message: 'At least one of ocr, translation, or summary must be provided',
});

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
    const rawBody = await request.json();

    // Validate request body
    const parseResult = pageUpdateSchema.safeParse(rawBody);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parseResult.error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    const body = parseResult.data;

    const updateData: Record<string, unknown> = {
      updated_at: new Date()
    };

    const now = new Date();
    const editedBy = body.edited_by || 'Unknown';

    // Update OCR if provided - mark as manual edit
    if (body.ocr) {
      updateData['ocr.data'] = body.ocr.data;
      updateData['ocr.language'] = body.ocr.language;
      updateData['ocr.model'] = body.ocr.model || 'manual';
      updateData['ocr.updated_at'] = now;
      // Source tracking
      updateData['ocr.source'] = 'manual';
      updateData['ocr.edited_by'] = editedBy;
      updateData['ocr.edited_at'] = now;
    }

    // Update translation if provided - mark as manual edit
    if (body.translation) {
      updateData['translation.data'] = body.translation.data;
      updateData['translation.language'] = body.translation.language;
      updateData['translation.model'] = body.translation.model || 'manual';
      updateData['translation.updated_at'] = now;
      // Source tracking
      updateData['translation.source'] = 'manual';
      updateData['translation.edited_by'] = editedBy;
      updateData['translation.edited_at'] = now;
    }

    // Update summary if provided - mark as manual edit
    if (body.summary) {
      updateData['summary.data'] = body.summary.data;
      updateData['summary.model'] = body.summary.model || 'manual';
      updateData['summary.updated_at'] = now;
      // Source tracking
      updateData['summary.source'] = 'manual';
      updateData['summary.edited_by'] = editedBy;
      updateData['summary.edited_at'] = now;
    }

    // Use findOneAndUpdate to get updated document in a single query
    const updatedPage = await db.collection('pages').findOneAndUpdate(
      { id },
      { $set: updateData, $inc: { edit_count: 1 } },
      { returnDocument: 'after' }
    );

    if (!updatedPage) {
      return NextResponse.json({ error: 'Page not found' }, { status: 404 });
    }

    // Track edit for the book (fire and forget - don't block response)
    if (updatedPage.book_id) {
      db.collection('books').updateOne(
        { id: updatedPage.book_id },
        { $inc: { edit_count: 1 } }
      ).catch(() => {}); // Non-critical, don't fail the request
    }

    return NextResponse.json(updatedPage);
  } catch (error) {
    console.error('Error updating page:', error);
    return NextResponse.json({ error: 'Failed to update page' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = await getDb();

    // Check if page exists
    const page = await db.collection('pages').findOne({ id });
    if (!page) {
      return NextResponse.json({ error: 'Page not found' }, { status: 404 });
    }

    // Delete the page
    await db.collection('pages').deleteOne({ id });

    // Renumber remaining pages for this book - use bulkWrite for speed
    const remainingPages = await db.collection('pages')
      .find({ book_id: page.book_id })
      .sort({ page_number: 1 })
      .toArray();

    // Bulk update all page numbers in one operation
    if (remainingPages.length > 0) {
      const bulkOps = remainingPages.map((p, i) => ({
        updateOne: {
          filter: { id: p.id },
          update: { $set: { page_number: i + 1, updated_at: new Date() } }
        }
      }));
      await db.collection('pages').bulkWrite(bulkOps);
    }

    // Update book pages_count
    await db.collection('books').updateOne(
      { id: page.book_id },
      { $set: { pages_count: remainingPages.length, updated_at: new Date() } }
    );

    return NextResponse.json({ success: true, deleted: id });
  } catch (error) {
    console.error('Error deleting page:', error);
    return NextResponse.json({ error: 'Failed to delete page' }, { status: 500 });
  }
}
