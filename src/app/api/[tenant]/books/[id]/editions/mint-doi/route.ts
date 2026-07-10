import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { TranslationEdition, Book, Page } from '@/lib/types';
import { mintDoi, isZenodoConfigured } from '@/lib/zenodo';
import { notifyEditionPublished } from '@/lib/indexnow';
import { logAuditEvent } from '@/lib/audit-logger';
import { withAuth } from '@/lib/auth-helpers';
import { generateKdpEpub } from '@/lib/kdp-epub';
import { resolveTenantId } from '@/lib/tenant-context';

interface RouteContext {
  params: Promise<{ tenant: string; id: string }>;
}

// POST /api/books/[id]/editions/mint-doi - Mint a DOI for an edition via Zenodo
export const POST = withAuth(async (request, session, context) => {
  try {
    // Check Zenodo configuration
    if (!isZenodoConfigured()) {
      return NextResponse.json(
        { error: 'Zenodo is not configured. Set ZENODO_ACCESS_TOKEN environment variable.' },
        { status: 503 }
      );
    }

    const { tenant, id: bookId } = await context.params;
    const body = await request.json();
    const { edition_id } = body as { edition_id: string };

    if (!edition_id) {
      return NextResponse.json({ error: 'edition_id is required' }, { status: 400 });
    }

    const db = await getDb();
    const tenantId = await resolveTenantId(tenant);

    if (!tenantId) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    // Get book
    const book = await db.collection('books').findOne({ id: bookId, tenantId }) as unknown as Book | null;
    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    // Find the edition
    const editions = (book.editions || []) as TranslationEdition[];
    const editionIndex = editions.findIndex(e => e.id === edition_id);

    if (editionIndex === -1) {
      return NextResponse.json({ error: 'Edition not found' }, { status: 404 });
    }

    const edition = editions[editionIndex];

    // Check if already has DOI
    if (edition.doi) {
      return NextResponse.json(
        { error: 'Edition already has a DOI', doi: edition.doi },
        { status: 400 }
      );
    }

    // Get all translated pages for this edition
    const pages = await db.collection('pages')
      .find({
        book_id: bookId,
        tenantId,
        id: { $in: edition.page_ids }
      })
      .sort({ page_number: 1 })
      .toArray() as unknown as Page[];

    // Build translation text
    const translationText = pages
      .filter(p => p.translation?.data)
      .map(p => `--- Page ${p.page_number} ---\n\n${p.translation ? p.translation.data : ''}`)
      .join('\n\n\n');

    if (!translationText) {
      return NextResponse.json(
        { error: 'No translation content found' },
        { status: 400 }
      );
    }

    // Find previous Zenodo ID if this is a new version
    let previousZenodoId: number | undefined;
    if (edition.previous_version_id) {
      const previousEdition = editions.find(e => e.id === edition.previous_version_id);
      previousZenodoId = typeof previousEdition?.zenodo_id === 'number'
        ? previousEdition.zenodo_id
        : previousEdition?.zenodo_id ? parseInt(previousEdition.zenodo_id) : undefined;
    }

    // Generate scholarly EPUB directly (avoid fragile self-fetch)
    let epubBuffer: Buffer | undefined;
    try {
      epubBuffer = await generateKdpEpub(book, pages, db, {
        introduction: edition.front_matter?.introduction,
        methodology: edition.front_matter?.methodology,
        license: edition.license,
      });
      console.log(`Scholarly EPUB generated: ${(epubBuffer.length / 1024 / 1024).toFixed(1)}MB`);
    } catch (e) {
      console.warn('EPUB generation failed, uploading text only:', e);
    }

    // Mint DOI via Zenodo
    const result = await mintDoi(book, edition, translationText, {
      previousZenodoId,
      epubBuffer,
      epubFilename: `${(book as any).slug || book.id}-scholarly-v${edition.version}.epub`,
    });

    // Mark previous published editions as superseded
    for (let i = 0; i < editions.length; i++) {
      if (editions[i].status === 'published' && editions[i].id !== edition.id) {
        editions[i] = { ...editions[i], status: 'superseded' };
      }
    }

    // Update edition with DOI info and publish it
    editions[editionIndex] = {
      ...edition,
      status: 'published',
      published_at: new Date(),
      doi: result.doi,
      doi_url: result.doi_url,
      zenodo_id: result.zenodo_id,
      zenodo_url: result.zenodo_url,
    };

    // Update book
    await db.collection('books').updateOne(
      { id: bookId, tenantId },
      {
        $set: {
          editions,
          doi: result.doi, // Also set at book level for current edition
          updated_at: new Date(),
        }
      }
    );

    // Audit log (non-blocking)
    logAuditEvent({
      action: 'doi_minted',
      book_id: bookId,
      book_title: book.title,
      metadata: { doi: result.doi, zenodo_id: result.zenodo_id, edition_id },
    });

    // Notify search engines about the published edition (non-blocking)
    notifyEditionPublished(bookId, (book as any).slug).catch(console.error);

    return NextResponse.json({
      success: true,
      doi: result.doi,
      doi_url: result.doi_url,
      zenodo_id: result.zenodo_id,
      zenodo_url: result.zenodo_url,
      message: `DOI minted successfully: ${result.doi}`,
    });
  } catch (error) {
    console.error('Error minting DOI:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to mint DOI' },
      { status: 500 }
    );
  }
});
