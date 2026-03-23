import { NextResponse } from 'next/server';
import { importBookFromIIIF } from '@/lib/import-utils';
import { withAuth } from '@/lib/auth-helpers';

export const maxDuration = 300;

/**
 * Import a book from the Austrian National Library (ONB)
 *
 * POST /api/import/onb
 * Body: {
 *   z_id: string,              // ONB Z-ID, e.g. "Z165851607"
 *   collection?: string,       // "ABO" (default) or "REPO"
 *   title: string,
 *   display_title?: string,
 *   author: string,
 *   language?: string,
 *   published?: string,
 *   categories?: string[],
 *   work_id?: string
 * }
 *
 * IIIF manifest patterns:
 *   ABO:  https://iiif.onb.ac.at/presentation/ABO/{z_id}/manifest
 *   REPO: https://iiif.onb.ac.at/presentation/REPO/{numeric_id}/manifest
 */
export const POST = withAuth(async (request, session) => {
  try {
    const body = await request.json();
    const { z_id, collection, title, display_title, author, language, published, categories, work_id } = body;

    if (!z_id || !title || !author) {
      return NextResponse.json(
        { error: 'Missing required fields: z_id, title, author' },
        { status: 400 }
      );
    }

    const coll = collection || 'ABO';
    const manifestUrl = `https://iiif.onb.ac.at/presentation/${coll}/${z_id}/manifest`;

    return await importBookFromIIIF({
      provider: 'onb',
      provider_name: 'Austrian National Library (Österreichische Nationalbibliothek)',
      manifest_url: manifestUrl,
      identifier: z_id,
      source_url: `https://onb.ac.at/en/collections/catalogueofdigitalresources?ident=+${z_id}`,
      title,
      display_title,
      author,
      language,
      published,
      categories,
      work_id,
      license_default: 'CC-BY-4.0',
      attribution_default: 'Österreichische Nationalbibliothek',
      duplicate_query: {
        $or: [
          { onb_z_id: z_id },
          { 'dublin_core.dc_identifier': `ONB:${z_id}` },
          { 'image_source.iiif_manifest': manifestUrl },
        ],
      },
      identifier_field: { onb_z_id: z_id },
    }, request);
  } catch (error) {
    console.error('ONB import error:', error);
    return NextResponse.json(
      { error: 'Import failed', details: String(error) },
      { status: 500 }
    );
  }
});
