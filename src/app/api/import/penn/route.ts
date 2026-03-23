import { NextResponse } from 'next/server';
import { importBookFromIIIF } from '@/lib/import-utils';
import { withAuth } from '@/lib/auth-helpers';

export const maxDuration = 300;

/**
 * Import a book from University of Pennsylvania (Colenda / Schoenberg Collection)
 *
 * POST /api/import/penn
 * Body: {
 *   ark_id: string,            // ARK identifier, e.g. "p2vd6p31p"
 *   title: string,
 *   display_title?: string,
 *   author: string,
 *   language?: string,
 *   published?: string,
 *   categories?: string[],
 *   work_id?: string
 * }
 *
 * IIIF v2 manifest: https://colenda.library.upenn.edu/items/ark:/81431/{ark_id}/manifest
 * Browse: https://colenda.library.upenn.edu/catalog/ark:/81431/{ark_id}
 */
export const POST = withAuth(async (request, session) => {
  try {
    const body = await request.json();
    const { ark_id, title, display_title, author, language, published, categories, work_id } = body;

    if (!ark_id || !title || !author) {
      return NextResponse.json(
        { error: 'Missing required fields: ark_id, title, author' },
        { status: 400 }
      );
    }

    const fullArk = `ark:/81431/${ark_id}`;

    return await importBookFromIIIF({
      provider: 'penn_colenda',
      provider_name: 'University of Pennsylvania Libraries (Schoenberg Collection)',
      manifest_url: `https://colenda.library.upenn.edu/items/${fullArk}/manifest`,
      identifier: ark_id,
      source_url: `https://colenda.library.upenn.edu/catalog/${fullArk}`,
      title,
      display_title,
      author,
      language,
      published,
      categories,
      work_id,
      license_default: 'CC-BY-4.0',
      attribution_default: 'Kislak Center for Special Collections, University of Pennsylvania',
      duplicate_query: {
        $or: [
          { penn_ark_id: ark_id },
          { 'dublin_core.dc_identifier': `PENN:${ark_id}` },
          { 'image_source.iiif_manifest': `https://colenda.library.upenn.edu/items/${fullArk}/manifest` },
        ],
      },
      identifier_field: { penn_ark_id: ark_id },
    }, request);
  } catch (error) {
    console.error('Penn import error:', error);
    return NextResponse.json({ error: 'Import failed', details: String(error) }, { status: 500 });
  }
});
