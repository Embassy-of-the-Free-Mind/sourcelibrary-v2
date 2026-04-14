import { NextResponse } from 'next/server';
import { importBookFromIIIF } from '@/lib/import-utils';
import { withCuratorAuth } from '@/lib/auth-helpers';

export const maxDuration = 300;

/**
 * Import a book from Yale Beinecke Rare Book & Manuscript Library
 *
 * POST /api/import/yale
 * Body: {
 *   catalog_id: string,        // Numeric catalog ID, e.g. "10842249"
 *   title: string,
 *   display_title?: string,
 *   author: string,
 *   language?: string,
 *   published?: string,
 *   categories?: string[],
 *   work_id?: string
 * }
 *
 * IIIF v3 manifest: https://collections.library.yale.edu/manifests/{catalog_id}
 * Browse: https://collections.library.yale.edu/catalog/{catalog_id}
 */
export const POST = withCuratorAuth(async (request, session) => {
  try {
    const body = await request.json();
    const { catalog_id, title, display_title, author, language, published, categories, work_id } = body;

    if (!catalog_id || !title || !author) {
      return NextResponse.json(
        { error: 'Missing required fields: catalog_id, title, author' },
        { status: 400 }
      );
    }

    return await importBookFromIIIF({
      provider: 'yale_beinecke',
      provider_name: 'Yale University, Beinecke Rare Book & Manuscript Library',
      manifest_url: `https://collections.library.yale.edu/manifests/${catalog_id}`,
      identifier: catalog_id,
      source_url: `https://collections.library.yale.edu/catalog/${catalog_id}`,
      title,
      display_title,
      author,
      language,
      published,
      categories,
      work_id,
      license_default: 'CC0-1.0',
      attribution_default: 'Beinecke Rare Book & Manuscript Library, Yale University',
      duplicate_query: {
        $or: [
          { yale_catalog_id: catalog_id },
          { 'dublin_core.dc_identifier': `YALE:${catalog_id}` },
          { 'image_source.iiif_manifest': `https://collections.library.yale.edu/manifests/${catalog_id}` },
        ],
      },
      identifier_field: { yale_catalog_id: catalog_id },
    }, request);
  } catch (error) {
    console.error('Yale import error:', error);
    return NextResponse.json({ error: 'Import failed', details: String(error) }, { status: 500 });
  }
});
