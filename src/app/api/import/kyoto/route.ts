import { NextResponse } from 'next/server';
import { importBookFromIIIF } from '@/lib/import-utils';
import { withCuratorAuth } from '@/lib/auth-helpers';

export const maxDuration = 300;

/**
 * Import a book from Kyoto University RMDA (Rare Materials Digital Archive)
 *
 * POST /api/import/kyoto
 * Body: {
 *   rb_id: string,             // RMDA identifier, e.g. "RB00000001" or "000001"
 *   title: string,
 *   display_title?: string,
 *   author: string,
 *   language?: string,
 *   published?: string,
 *   categories?: string[],
 *   work_id?: string
 * }
 *
 * IIIF v3 manifest: https://rmda.kulib.kyoto-u.ac.jp/iiif/metadata_manifest/{rb_id}/manifest.json
 * Browse: https://rmda.kulib.kyoto-u.ac.jp/en/item/{rb_id}
 */
export const POST = withCuratorAuth(async (request, session) => {
  try {
    const body = await request.json();
    const { rb_id, title, display_title, author, language, published, categories, work_id } = body;

    if (!rb_id || !title || !author) {
      return NextResponse.json(
        { error: 'Missing required fields: rb_id, title, author' },
        { status: 400 }
      );
    }

    // Normalize ID — ensure RB prefix
    const normalizedId = rb_id.startsWith('RB') ? rb_id : `RB${rb_id.padStart(8, '0')}`;

    return await importBookFromIIIF({
      provider: 'kyoto_rmda',
      provider_name: 'Kyoto University Rare Materials Digital Archive',
      manifest_url: `https://rmda.kulib.kyoto-u.ac.jp/iiif/metadata_manifest/${normalizedId}/manifest.json`,
      identifier: normalizedId,
      source_url: `https://rmda.kulib.kyoto-u.ac.jp/en/item/${normalizedId}`,
      title,
      display_title,
      author,
      language: language || 'Japanese',
      published,
      categories,
      work_id,
      license_default: 'CC-BY-4.0',
      attribution_default: 'Kyoto University Library',
      duplicate_query: {
        $or: [
          { kyoto_rb_id: normalizedId },
          { 'dublin_core.dc_identifier': `KYOTO:${normalizedId}` },
          { 'image_source.iiif_manifest': `https://rmda.kulib.kyoto-u.ac.jp/iiif/metadata_manifest/${normalizedId}/manifest.json` },
        ],
      },
      identifier_field: { kyoto_rb_id: normalizedId },
    }, request);
  } catch (error) {
    console.error('Kyoto RMDA import error:', error);
    return NextResponse.json(
      { error: 'Import failed', details: String(error) },
      { status: 500 }
    );
  }
});
