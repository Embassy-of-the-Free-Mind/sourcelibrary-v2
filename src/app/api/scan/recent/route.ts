export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

/**
 * GET /api/scan/recent
 *
 * Returns books created via Mobile Scan, sorted by created_at desc.
 * Unauthenticated — only returns books with provider_name: 'Mobile Scan'.
 */
export async function GET() {
  try {
    const db = await getDb();

    const books = await db.collection('books')
      .find({
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
        thumbnail: 1,
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
