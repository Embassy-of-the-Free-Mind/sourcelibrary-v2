export const dynamic = 'force-dynamic';

import { withAuth } from '@/lib/auth-helpers';
import { NextRequest, NextResponse } from 'next/server';
import { getReadDb } from '@/lib/mongodb';
import { getTenantContextFromRequest } from '@/lib/tenant-context';

/**
 * GET /api/scan/recent
 *
 * Returns books created via Mobile Scan, sorted by created_at desc.
 * Unauthenticated — only returns books with provider_name: 'Mobile Scan'.
 */
async function handleGET(request: NextRequest) {
  try {
    const db = await getReadDb();
    const { id: tenantId } = getTenantContextFromRequest(request);

    if (!tenantId) {
      return NextResponse.json({ books: [] });
    }

    const books = await db.collection('books')
      .find({
        tenantId,
        'image_source.provider': 'user_upload',
        'image_source.provider_name': 'Mobile Scan',
      })
      .sort({ created_at: -1 })
      .limit(20)
      .project({
        id: 1,
        slug: 1,
        title: 1,
        author: 1,
        language: 1,
        pages_count: 1,
        pages_ocr: 1,
        pages_translated: 1,
        status: 1,
        thumbnail: 1, image_display: 1,
        'pipeline_auto.status': 1,
        created_at: 1,
      })
      .toArray();

    return NextResponse.json({ books });
  } catch (error) {
    console.error('Recent scans error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch' },
      { status: 500 }
    );
  }
}

// Admin only (#6032), matching the /scan pages (scan/layout.tsx requireAdmin): this
// route writes books/R2 or reaches a paid model, and was open to anonymous callers.
export const GET = withAuth(async (request) => handleGET(request), { minRole: 'admin' });
