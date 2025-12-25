import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { TranslationEdition, Contributor, Page, Book } from '@/lib/types';
import crypto from 'crypto';

// SPDX license options
export const LICENSES = [
  { id: 'CC0-1.0', name: 'CC0 1.0 (Public Domain)', description: 'No rights reserved' },
  { id: 'CC-BY-4.0', name: 'CC BY 4.0', description: 'Attribution required' },
  { id: 'CC-BY-SA-4.0', name: 'CC BY-SA 4.0', description: 'Attribution + ShareAlike' },
  { id: 'CC-BY-NC-4.0', name: 'CC BY-NC 4.0', description: 'Attribution + NonCommercial' },
  { id: 'CC-BY-NC-SA-4.0', name: 'CC BY-NC-SA 4.0', description: 'Attribution + NonCommercial + ShareAlike' },
] as const;

interface RouteContext {
  params: Promise<{ id: string }>;
}

// GET /api/books/[id]/editions - List all editions for a book
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { id: bookId } = await context.params;
    const db = await getDb();

    const book = await db.collection('books').findOne({ id: bookId });
    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    const editions = book.editions || [];

    return NextResponse.json({ editions });
  } catch (error) {
    console.error('Error fetching editions:', error);
    return NextResponse.json(
      { error: 'Failed to fetch editions' },
      { status: 500 }
    );
  }
}

// POST /api/books/[id]/editions - Create a new edition
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id: bookId } = await context.params;
    const body = await request.json();
    const {
      version_label,
      license,
      contributors = [],
      changelog,
      front_matter,
    } = body as {
      version_label?: string;
      license: string;
      contributors?: Contributor[];
      changelog?: string;
      front_matter?: {
        introduction?: string;
        methodology?: string;
        acknowledgments?: string;
        generated_at?: Date;
        generated_by?: string;
      };
    };

    if (!license) {
      return NextResponse.json({ error: 'License is required' }, { status: 400 });
    }

    const db = await getDb();

    // Get book
    const book = await db.collection('books').findOne({ id: bookId }) as unknown as Book | null;
    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    // Get all pages with translations
    const pages = await db.collection('pages')
      .find({ book_id: bookId })
      .sort({ page_number: 1 })
      .toArray() as unknown as Page[];

    const translatedPages = pages.filter(p => p.translation?.data);
    if (translatedPages.length === 0) {
      return NextResponse.json(
        { error: 'No translated pages found. Complete some translations first.' },
        { status: 400 }
      );
    }

    // Calculate content hash (SHA-256 of all translation text)
    const translationText = translatedPages
      .map(p => `--- Page ${p.page_number} ---\n${p.translation.data}`)
      .join('\n\n');
    const contentHash = crypto.createHash('sha256').update(translationText).digest('hex');

    // Determine version number
    const existingEditions = (book.editions || []) as TranslationEdition[];
    let version: string;

    if (existingEditions.length === 0) {
      version = '1.0.0';
    } else {
      // Find the latest version and increment
      const latestVersion = existingEditions
        .map(e => e.version)
        .sort((a, b) => {
          const [aMajor, aMinor, aPatch] = a.split('.').map(Number);
          const [bMajor, bMinor, bPatch] = b.split('.').map(Number);
          if (aMajor !== bMajor) return bMajor - aMajor;
          if (aMinor !== bMinor) return bMinor - aMinor;
          return bPatch - aPatch;
        })[0];

      const [major, minor, patch] = latestVersion.split('.').map(Number);
      // Default to minor version bump
      version = `${major}.${minor + 1}.0`;
    }

    // Build contributors list - add AI translator if not specified
    const allContributors: Contributor[] = [...contributors];

    // Check if we have translation model info from pages
    const models = new Set<string>();
    translatedPages.forEach(p => {
      if (p.translation?.model) {
        models.add(p.translation.model);
      }
    });

    // Add AI contributors for each model used
    models.forEach(model => {
      if (!allContributors.some(c => c.model === model)) {
        allContributors.push({
          name: model.includes('gemini') ? 'Google Gemini' : model,
          role: 'translator',
          type: 'ai',
          model: model,
        });
      }
    });

    // Get previous edition info
    const previousEdition = existingEditions.find(e => e.status === 'published');

    // Create the edition
    const edition: TranslationEdition = {
      id: crypto.randomUUID(),
      book_id: bookId,
      version,
      version_label,
      status: 'published',
      created_at: new Date(),
      published_at: new Date(),
      page_ids: translatedPages.map(p => p.id),
      page_count: translatedPages.length,
      content_hash: contentHash,
      contributors: allContributors,
      citation: {
        title: `English Translation of ${book.display_title || book.title}`,
        original_title: book.title,
        original_author: book.author,
        original_language: book.language,
        original_published: book.published,
        target_language: 'en',
      },
      license,
      previous_version_id: previousEdition?.id,
      previous_version_doi: previousEdition?.doi,
      changelog,
      front_matter,
    };

    // Mark previous published edition as superseded
    const updatedEditions = existingEditions.map(e =>
      e.status === 'published' ? { ...e, status: 'superseded' as const } : e
    );
    updatedEditions.push(edition);

    // Update the book
    await db.collection('books').updateOne(
      { id: bookId },
      {
        $set: {
          editions: updatedEditions,
          current_edition_id: edition.id,
          updated_at: new Date(),
        }
      }
    );

    return NextResponse.json({
      success: true,
      edition,
      message: `Edition ${version} published successfully`,
    });
  } catch (error) {
    console.error('Error creating edition:', error);
    return NextResponse.json(
      { error: 'Failed to create edition' },
      { status: 500 }
    );
  }
}

// PATCH /api/books/[id]/editions - Update edition (add DOI after minting)
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { id: bookId } = await context.params;
    const body = await request.json();
    const { edition_id, doi, doi_url } = body as {
      edition_id: string;
      doi?: string;
      doi_url?: string;
    };

    if (!edition_id) {
      return NextResponse.json({ error: 'edition_id is required' }, { status: 400 });
    }

    const db = await getDb();

    const book = await db.collection('books').findOne({ id: bookId }) as unknown as Book | null;
    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    const editions = (book.editions || []) as TranslationEdition[];
    const editionIndex = editions.findIndex(e => e.id === edition_id);

    if (editionIndex === -1) {
      return NextResponse.json({ error: 'Edition not found' }, { status: 404 });
    }

    // Update the edition
    if (doi) editions[editionIndex].doi = doi;
    if (doi_url) editions[editionIndex].doi_url = doi_url;

    await db.collection('books').updateOne(
      { id: bookId },
      {
        $set: {
          editions,
          // Also update book-level DOI if this is current edition
          ...(book.current_edition_id === edition_id && doi ? { doi } : {}),
          updated_at: new Date(),
        }
      }
    );

    return NextResponse.json({
      success: true,
      edition: editions[editionIndex],
    });
  } catch (error) {
    console.error('Error updating edition:', error);
    return NextResponse.json(
      { error: 'Failed to update edition' },
      { status: 500 }
    );
  }
}
