import { NextResponse } from 'next/server';
import { importBookFromIIIF } from '@/lib/import-utils';
import { withAuth } from '@/lib/auth-helpers';

export const maxDuration = 300;

/**
 * Import a book from the Huntington Library (San Marino, CA)
 *
 * POST /api/import/huntington
 * Body: {
 *   collection: string,        // Collection code, e.g. "p15150coll7"
 *   item_id: string,           // Item ID within collection
 *   title: string,
 *   display_title?: string,
 *   author: string,
 *   language?: string,
 *   published?: string,
 *   categories?: string[],
 *   work_id?: string
 * }
 *
 * IIIF v2 manifest: https://hdl.huntington.org/iiif/2/{collection}:{item_id}/manifest.json
 */
export const POST = withAuth(async (request, session) => {
  try {
    const body = await request.json();
    const { collection, item_id, title, display_title, author, language, published, categories, work_id } = body;

    if (!collection || !item_id || !title || !author) {
      return NextResponse.json(
        { error: 'Missing required fields: collection, item_id, title, author' },
        { status: 400 }
      );
    }

    const identifier = `${collection}:${item_id}`;

    return await importBookFromIIIF({
      provider: 'huntington',
      provider_name: 'The Huntington Library, Art Museum, and Botanical Gardens',
      manifest_url: `https://hdl.huntington.org/iiif/2/${identifier}/manifest.json`,
      identifier,
      source_url: `https://hdl.huntington.org/digital/collection/${collection}/id/${item_id}`,
      title,
      display_title,
      author,
      language,
      published,
      categories,
      work_id,
      license_default: 'CC-BY-NC-4.0',
      attribution_default: 'The Huntington Library',
      duplicate_query: {
        $or: [
          { huntington_id: identifier },
          { 'dublin_core.dc_identifier': `HUNTINGTON:${identifier}` },
          { 'image_source.iiif_manifest': `https://hdl.huntington.org/iiif/2/${identifier}/manifest.json` },
        ],
      },
      identifier_field: { huntington_id: identifier },
    }, request);
  } catch (error) {
    console.error('Huntington import error:', error);
    return NextResponse.json({ error: 'Import failed', details: String(error) }, { status: 500 });
  }
});
