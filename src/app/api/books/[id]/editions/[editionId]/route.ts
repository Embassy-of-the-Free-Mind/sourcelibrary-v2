import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { TranslationEdition } from '@/lib/types';

interface RouteContext {
  params: Promise<{ id: string; editionId: string }>;
}

// GET /api/books/[id]/editions/[editionId] - Get a specific edition
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { id: bookId, editionId } = await context.params;

    const db = await getDb();
    const book = await db.collection('books').findOne({ id: bookId });

    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    const editions = (book.editions || []) as TranslationEdition[];
    const edition = editions.find(e => e.id === editionId);

    if (!edition) {
      return NextResponse.json({ error: 'Edition not found' }, { status: 404 });
    }

    return NextResponse.json({ edition });
  } catch (error) {
    console.error('Error fetching edition:', error);
    return NextResponse.json({ error: 'Failed to fetch edition' }, { status: 500 });
  }
}

// PATCH /api/books/[id]/editions/[editionId] - Update an edition (e.g., front matter)
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { id: bookId, editionId } = await context.params;
    const body = await request.json();

    const db = await getDb();
    const book = await db.collection('books').findOne({ id: bookId });

    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    const editions = (book.editions || []) as TranslationEdition[];
    const editionIndex = editions.findIndex(e => e.id === editionId);

    if (editionIndex === -1) {
      return NextResponse.json({ error: 'Edition not found' }, { status: 404 });
    }

    const edition = editions[editionIndex];

    // Check if DOI is already minted - can't edit after that
    if (edition.doi) {
      return NextResponse.json(
        { error: 'Cannot edit edition after DOI is minted. Create a new version instead.' },
        { status: 400 }
      );
    }

    // Update allowed fields
    const {
      version_label,
      changelog,
      front_matter,
      contributors,
    } = body;

    const updatedEdition: TranslationEdition = {
      ...edition,
      ...(version_label !== undefined && { version_label }),
      ...(changelog !== undefined && { changelog }),
      ...(contributors !== undefined && { contributors }),
      ...(front_matter !== undefined && {
        front_matter: {
          ...edition.front_matter,
          ...front_matter,
        },
      }),
    };

    editions[editionIndex] = updatedEdition;

    await db.collection('books').updateOne(
      { id: bookId },
      {
        $set: {
          editions,
          updated_at: new Date(),
        },
      }
    );

    return NextResponse.json({
      success: true,
      edition: updatedEdition,
    });
  } catch (error) {
    console.error('Error updating edition:', error);
    return NextResponse.json({ error: 'Failed to update edition' }, { status: 500 });
  }
}
