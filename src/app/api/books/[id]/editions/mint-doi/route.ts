import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { TranslationEdition, Book, Page } from '@/lib/types';
import { mintDoi, isZenodoConfigured } from '@/lib/zenodo';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// POST /api/books/[id]/editions/mint-doi - Mint a DOI for an edition via Zenodo
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    // Check Zenodo configuration
    if (!isZenodoConfigured()) {
      return NextResponse.json(
        { error: 'Zenodo is not configured. Set ZENODO_ACCESS_TOKEN environment variable.' },
        { status: 503 }
      );
    }

    const { id: bookId } = await context.params;
    const body = await request.json();
    const { edition_id } = body as { edition_id: string };

    if (!edition_id) {
      return NextResponse.json({ error: 'edition_id is required' }, { status: 400 });
    }

    const db = await getDb();

    // Get book
    const book = await db.collection('books').findOne({ id: bookId }) as unknown as Book | null;
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

    // Mint DOI via Zenodo
    const result = await mintDoi(book, edition, translationText, previousZenodoId);

    // Update edition with DOI info
    editions[editionIndex] = {
      ...edition,
      doi: result.doi,
      doi_url: result.doi_url,
      zenodo_id: result.zenodo_id,
      zenodo_url: result.zenodo_url,
    };

    // Update book
    await db.collection('books').updateOne(
      { id: bookId },
      {
        $set: {
          editions,
          doi: result.doi, // Also set at book level for current edition
          updated_at: new Date(),
        }
      }
    );

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
}
