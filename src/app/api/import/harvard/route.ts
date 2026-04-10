import { NextResponse } from 'next/server';
import { importBookFromIIIF } from '@/lib/import-utils';
import { withCuratorAuth } from '@/lib/auth-helpers';

export const maxDuration = 300;

/**
 * Import a book from Harvard Library (Houghton, Widener, etc.)
 *
 * POST /api/import/harvard
 * Body: {
 *   drs_id: string,            // DRS numeric ID, e.g. "5765704"
 *   title: string,
 *   display_title?: string,
 *   author: string,
 *   language?: string,
 *   published?: string,
 *   categories?: string[],
 *   work_id?: string
 * }
 *
 * IIIF v2 manifest: https://iiif.lib.harvard.edu/manifests/drs:{drs_id}
 * Viewer: https://id.lib.harvard.edu/curiosity/{drs_id}
 */
export const POST = withCuratorAuth(async (request, session) => {
  try {
    const body = await request.json();
    const { drs_id, title, display_title, author, language, published, categories, work_id } = body;

    if (!drs_id || !title || !author) {
      return NextResponse.json(
        { error: 'Missing required fields: drs_id, title, author' },
        { status: 400 }
      );
    }

    return await importBookFromIIIF({
      provider: 'harvard',
      provider_name: 'Harvard University Library',
      manifest_url: `https://iiif.lib.harvard.edu/manifests/drs:${drs_id}`,
      identifier: drs_id,
      source_url: `https://id.lib.harvard.edu/curiosity/${drs_id}`,
      title,
      display_title,
      author,
      language,
      published,
      categories,
      work_id,
      license_default: 'CC-BY-4.0',
      attribution_default: 'Harvard University Library',
      duplicate_query: {
        $or: [
          { harvard_drs_id: drs_id },
          { 'dublin_core.dc_identifier': `HARVARD:${drs_id}` },
          { 'image_source.iiif_manifest': `https://iiif.lib.harvard.edu/manifests/drs:${drs_id}` },
        ],
      },
      identifier_field: { harvard_drs_id: drs_id },
    }, request);
  } catch (error) {
    console.error('Harvard import error:', error);
    return NextResponse.json({ error: 'Import failed', details: String(error) }, { status: 500 });
  }
});
