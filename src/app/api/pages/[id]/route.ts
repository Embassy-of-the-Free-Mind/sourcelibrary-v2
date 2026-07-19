import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { getTenantContextFromRequest } from '@/lib/tenant-context';
import { z } from 'zod';
import { logAuditEvent } from '@/lib/audit-logger';
import { withAuth, withAdminAuth } from '@/lib/auth-helpers';
import { createRevision } from '@/lib/page-revisions';
import { recordCorrectionEvent } from '@/lib/correction-events';
import { contentHash } from '@/lib/steganographia';

export const preferredRegion = 'fra1';

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
    const { id: tenantId } = getTenantContextFromRequest(request);

    const { searchParams } = new URL(request.url);
    const full = searchParams.get('full') === 'true';

    // Default: exclude detected_images (large array unused by the reader)
    const projection = full ? undefined : { detected_images: 0 };

    // Tenant subdomains and /[tenant]/... paths get tenantId injected by the
    // proxy and stay tenant-scoped. Calls from the global main domain (e.g.
    // sourcelibrary.org/book/... prefetching adjacent pages) arrive with no
    // tenantId — those are allowed to read globally.
    const filter: Record<string, unknown> = { id };
    if (tenantId) filter.tenantId = tenantId;

    let page = await db.collection('pages').findOne(
      filter,
      projection ? { projection } : undefined
    );

    // Fallback: try _id lookup (some pages have id != _id due to split page creation)
    if (!page) {
      const { ObjectId } = await import('mongodb');
      if (ObjectId.isValid(id)) {
        const oidFilter: Record<string, unknown> = { _id: new ObjectId(id) };
        if (tenantId) oidFilter.tenantId = tenantId;
        page = await db.collection('pages').findOne(
          oidFilter,
          projection ? { projection } : undefined
        );
      }
    }

    if (!page) {
      return NextResponse.json({ error: 'Page not found' }, { status: 404 });
    }

    return NextResponse.json(page, {
      headers: { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=60' }
    });
  } catch (error) {
    console.error('Error fetching page:', error);
    return NextResponse.json({ error: 'Failed to fetch page' }, { status: 500 });
  }
}

export const PATCH = withAuth(async (request, session, context) => {
  try {
    const { id } = await context.params;
    const db = await getDb();
    const { id: tenantId } = getTenantContextFromRequest(request);

    if (!tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

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

    // Create revisions of existing content before manual overwrite.
    // The returned revision carries the before-text for the correction event below.
    const ocrRevision = body.ocr ? await createRevision(id, 'ocr') : undefined;
    const translationRevision = body.translation ? await createRevision(id, 'translation') : undefined;

    // Update OCR if provided - mark as manual edit
    if (body.ocr) {
      updateData['ocr.data'] = body.ocr.data;
      updateData['ocr.content_hash'] = contentHash(body.ocr.data);
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
      updateData['translation.content_hash'] = contentHash(body.translation.data);
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
      { id, tenantId },
      { $set: updateData, $inc: { edit_count: 1 } },
      { returnDocument: 'after' }
    );

    if (!updatedPage) {
      return NextResponse.json({ error: 'Page not found' }, { status: 404 });
    }

    // Capture the correction as a labeled model error (#3241) — fire and forget
    const sessionEmail = session.user?.email;
    if (body.ocr) {
      recordCorrectionEvent({
        revision: ocrRevision, after: body.ocr.data,
        editorRole: 'editor', editedBy: editedBy, sessionEmail, tenantId,
      }).catch(() => {});
    }
    if (body.translation) {
      recordCorrectionEvent({
        revision: translationRevision, after: body.translation.data,
        editorRole: 'editor', editedBy: editedBy, sessionEmail, tenantId,
      }).catch(() => {});
    }

    // Track edit for the book (fire and forget - don't block response)
    if (updatedPage.book_id) {
      db.collection('books').updateOne(
        { id: updatedPage.book_id },
        { $inc: { edit_count: 1 } }
      ).catch(() => {}); // Non-critical, don't fail the request

      const editedFields = [
        body.ocr && 'ocr',
        body.translation && 'translation',
        body.summary && 'summary',
      ].filter(Boolean);

      logAuditEvent({
        action: 'page_edited',
        book_id: updatedPage.book_id,
        metadata: {
          page_id: id,
          page_number: updatedPage.page_number,
          edited_fields: editedFields,
          edited_by: editedBy,
        },
      });
    }

    return NextResponse.json(updatedPage);
  } catch (error) {
    console.error('Error updating page:', error);
    return NextResponse.json({ error: 'Failed to update page' }, { status: 500 });
  }
});

export const DELETE = withAdminAuth(async (request, session, context) => {
  try {
    const { id } = await context.params;
    const db = await getDb();
    const { id: tenantId } = getTenantContextFromRequest(request);

    if (!tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // Check if page exists
    const page = await db.collection('pages').findOne({ id, tenantId });
    if (!page) {
      return NextResponse.json({ error: 'Page not found' }, { status: 404 });
    }

    // Delete the page
    await db.collection('pages').deleteOne({ id, tenantId });

    // Renumber remaining pages for this book - use bulkWrite for speed
    const remainingPages = await db.collection('pages')
      .find({ book_id: page.book_id, tenantId })
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
});
