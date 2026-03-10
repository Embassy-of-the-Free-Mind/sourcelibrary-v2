import { NextRequest, NextResponse } from 'next/server';
import { importBookFromIIIF } from '@/lib/import-utils';
import { withAuth } from '@/lib/auth-helpers';

export const maxDuration = 300;

/**
 * Import a book from Cambridge Digital Library (CUDL)
 *
 * POST /api/import/cambridge
 * Body: {
 *   ms_id: string,           // Manuscript code, e.g. "MS-ADD-03996"
 *   title: string,
 *   display_title?: string,
 *   author: string,
 *   language?: string,
 *   published?: string,
 *   categories?: string[]
 * }
 */
export const POST = withAuth(async (request, session) => {
  try {
    const body = await request.json();
    const { ms_id, title, display_title, author, language, published, categories, work_id } = body;

    if (!ms_id || !title || !author) {
      return NextResponse.json(
        { error: 'Missing required fields: ms_id, title, author' },
        { status: 400 }
      );
    }

    return await importBookFromIIIF({
      provider: 'cambridge',
      provider_name: 'Cambridge Digital Library',
      manifest_url: `https://cudl.lib.cam.ac.uk/iiif/${ms_id}`,
      identifier: ms_id,
      source_url: `https://cudl.lib.cam.ac.uk/view/${ms_id}`,
      title,
      display_title,
      author,
      language,
      published,
      categories,
      work_id,
      license_default: 'CC-BY-NC-4.0',
      attribution_default: 'Cambridge University Library',
      duplicate_query: {
        $or: [
          { cambridge_id: ms_id },
          { 'dublin_core.dc_identifier': `CAMBRIDGE:${ms_id}` },
        ],
      },
      identifier_field: { cambridge_id: ms_id },
    }, request);
  } catch (error) {
    console.error('Cambridge import error:', error);
    return NextResponse.json(
      { error: 'Import failed', details: String(error) },
      { status: 500 }
    );
  }
});
