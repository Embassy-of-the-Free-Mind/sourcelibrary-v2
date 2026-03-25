import { NextResponse } from 'next/server';
import { importBookFromIIIF } from '@/lib/import-utils';
import { withAuth } from '@/lib/auth-helpers';

export const maxDuration = 300;

/**
 * Import a book from the British Library (via Digirati IIIF)
 *
 * POST /api/import/bl
 * Body: {
 *   ark: string,               // ARK identifier, e.g. "vdc_100104060212.0x000001"
 *   title: string,
 *   display_title?: string,
 *   author: string,
 *   language?: string,
 *   published?: string,
 *   categories?: string[],
 *   work_id?: string
 * }
 *
 * IIIF v3 manifest: https://bl.digirati.io/iiif/ark:/81055/{ark}
 * Viewer: https://www.bl.uk/manuscripts/Viewer.aspx?ref={shelfmark}
 */
export const POST = withAuth(async (request, session) => {
  try {
    const body = await request.json();
    const { ark, shelfmark, title, display_title, author, language, published, categories, work_id } = body;

    if (!ark || !title || !author) {
      return NextResponse.json(
        { error: 'Missing required fields: ark, title, author' },
        { status: 400 }
      );
    }

    // Normalize ARK — strip prefix if user provides full ARK
    const normalizedArk = ark.replace(/^ark:\/81055\//, '');
    const fullArk = `ark:/81055/${normalizedArk}`;

    return await importBookFromIIIF({
      provider: 'bl',
      provider_name: 'British Library',
      manifest_url: `https://bl.digirati.io/iiif/${fullArk}`,
      identifier: normalizedArk,
      source_url: shelfmark
        ? `https://www.bl.uk/manuscripts/Viewer.aspx?ref=${shelfmark.replace(/\s+/g, '_')}`
        : `https://bl.digirati.io/iiif/${fullArk}`,
      title,
      display_title,
      author,
      language,
      published,
      categories,
      work_id,
      license_default: 'CC0-1.0',
      attribution_default: 'British Library',
      duplicate_query: {
        $or: [
          { bl_ark: normalizedArk },
          { 'dublin_core.dc_identifier': `BL:${normalizedArk}` },
          { 'image_source.iiif_manifest': `https://bl.digirati.io/iiif/${fullArk}` },
        ],
      },
      identifier_field: { bl_ark: normalizedArk },
    }, request);
  } catch (error) {
    console.error('British Library import error:', error);
    return NextResponse.json(
      { error: 'Import failed', details: String(error) },
      { status: 500 }
    );
  }
});
