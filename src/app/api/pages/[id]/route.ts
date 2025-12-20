import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { trackEvent, getVisitorInfo } from '@/lib/analytics';

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

    // Track page view with visitor info
    const visitorInfo = getVisitorInfo(request);
    trackEvent('page_view', {
      page_id: id,
      book_id: page.book_id,
      tenant_id: page.tenant_id,
      ...visitorInfo,
    });

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

    // Get the page first to get book_id and track char changes
    const existingPage = await db.collection('pages').findOne({ id });
    if (!existingPage) {
      return NextResponse.json({ error: 'Page not found' }, { status: 404 });
    }

    const result = await db.collection('pages').updateOne(
      { id },
      { $set: updateData }
    );

    if (result.matchedCount === 0) {
      return NextResponse.json({ error: 'Page not found' }, { status: 404 });
    }

    // Track edits
    if (body.ocr) {
      trackEvent('edit_ocr', {
        page_id: id,
        book_id: existingPage.book_id,
        tenant_id: existingPage.tenant_id,
        metadata: {
          field: 'ocr',
          chars_before: existingPage.ocr?.data?.length || 0,
          chars_after: body.ocr.data?.length || 0,
        },
      });
    }
    if (body.translation) {
      trackEvent('edit_translation', {
        page_id: id,
        book_id: existingPage.book_id,
        tenant_id: existingPage.tenant_id,
        metadata: {
          field: 'translation',
          chars_before: existingPage.translation?.data?.length || 0,
          chars_after: body.translation.data?.length || 0,
        },
      });
    }
    if (body.summary) {
      trackEvent('edit_summary', {
        page_id: id,
        book_id: existingPage.book_id,
        tenant_id: existingPage.tenant_id,
        metadata: {
          field: 'summary',
          chars_before: existingPage.summary?.data?.length || 0,
          chars_after: body.summary.data?.length || 0,
        },
      });
    }

    const updatedPage = await db.collection('pages').findOne({ id });
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

    // Track page deletion
    trackEvent('page_delete', {
      page_id: id,
      book_id: page.book_id,
      tenant_id: page.tenant_id,
    });

    // Renumber remaining pages for this book
    const remainingPages = await db.collection('pages')
      .find({ book_id: page.book_id })
      .sort({ page_number: 1 })
      .toArray();

    // Update page numbers sequentially
    for (let i = 0; i < remainingPages.length; i++) {
      await db.collection('pages').updateOne(
        { id: remainingPages[i].id },
        { $set: { page_number: i + 1, updated_at: new Date() } }
      );
    }

    return NextResponse.json({ success: true, deleted: id });
  } catch (error) {
    console.error('Error deleting page:', error);
    return NextResponse.json({ error: 'Failed to delete page' }, { status: 500 });
  }
}
