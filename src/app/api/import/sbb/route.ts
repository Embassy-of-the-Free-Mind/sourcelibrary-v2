import { NextResponse } from 'next/server';
import { importBookFromIIIF } from '@/lib/import-utils';
import { withAuth } from '@/lib/auth-helpers';

export const maxDuration = 300;

/**
 * Import a book from Staatsbibliothek zu Berlin (SBB)
 *
 * POST /api/import/sbb
 * Body: {
 *   ppn: string,               // PPN identifier, e.g. "PPN771898231" or "771898231"
 *   title: string,
 *   display_title?: string,
 *   author: string,
 *   language?: string,
 *   published?: string,
 *   categories?: string[],
 *   work_id?: string
 * }
 *
 * IIIF v2 manifest: https://content.staatsbibliothek-berlin.de/dc/PPN{id}/manifest
 * Viewer: https://digital.staatsbibliothek-berlin.de/werkansicht?PPN={id}
 */
export const POST = withAuth(async (request, session) => {
  try {
    const body = await request.json();
    const { ppn, title, display_title, author, language, published, categories, work_id } = body;

    if (!ppn || !title || !author) {
      return NextResponse.json(
        { error: 'Missing required fields: ppn, title, author' },
        { status: 400 }
      );
    }

    // Normalize PPN — ensure it has the PPN prefix
    const normalizedPpn = ppn.startsWith('PPN') ? ppn : `PPN${ppn}`;

    return await importBookFromIIIF({
      provider: 'sbb',
      provider_name: 'Staatsbibliothek zu Berlin',
      manifest_url: `https://content.staatsbibliothek-berlin.de/dc/${normalizedPpn}/manifest`,
      identifier: normalizedPpn,
      source_url: `https://digital.staatsbibliothek-berlin.de/werkansicht?PPN=${normalizedPpn.replace('PPN', '')}`,
      title,
      display_title,
      author,
      language,
      published,
      categories,
      work_id,
      license_default: 'CC0-1.0',
      attribution_default: 'Staatsbibliothek zu Berlin — Preußischer Kulturbesitz',
      duplicate_query: {
        $or: [
          { sbb_ppn: normalizedPpn },
          { 'dublin_core.dc_identifier': `SBB:${normalizedPpn}` },
          { 'image_source.iiif_manifest': `https://content.staatsbibliothek-berlin.de/dc/${normalizedPpn}/manifest` },
        ],
      },
      identifier_field: { sbb_ppn: normalizedPpn },
    }, request);
  } catch (error) {
    console.error('SBB import error:', error);
    return NextResponse.json(
      { error: 'Import failed', details: String(error) },
      { status: 500 }
    );
  }
});
