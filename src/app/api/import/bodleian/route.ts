import { NextRequest, NextResponse } from 'next/server';
import { importBookFromIIIF } from '@/lib/import-utils';
import { withAuth } from '@/lib/auth-helpers';

/**
 * Import a book from the Bodleian Digital Library (University of Oxford)
 *
 * POST /api/import/bodleian
 * Body: {
 *   uuid: string,            // Bodleian digital object UUID
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
    const { uuid, title, display_title, author, language, published, categories, work_id } = body;

    if (!uuid || !title || !author) {
      return NextResponse.json(
        { error: 'Missing required fields: uuid, title, author' },
        { status: 400 }
      );
    }

    return await importBookFromIIIF({
      provider: 'bodleian',
      provider_name: 'Bodleian Library, University of Oxford',
      manifest_url: `https://iiif.bodleian.ox.ac.uk/iiif/manifest/${uuid}.json`,
      identifier: uuid,
      source_url: `https://digital.bodleian.ox.ac.uk/objects/${uuid}`,
      title,
      display_title,
      author,
      language,
      published,
      categories,
      work_id,
      license_default: 'CC-BY-NC-4.0',
      attribution_default: 'Bodleian Libraries, University of Oxford',
      duplicate_query: {
        $or: [
          { bodleian_uuid: uuid },
          { 'dublin_core.dc_identifier': `BODLEIAN:${uuid}` },
        ],
      },
      identifier_field: { bodleian_uuid: uuid },
    }, request);
  } catch (error) {
    console.error('Bodleian import error:', error);
    return NextResponse.json(
      { error: 'Import failed', details: String(error) },
      { status: 500 }
    );
  }
});
