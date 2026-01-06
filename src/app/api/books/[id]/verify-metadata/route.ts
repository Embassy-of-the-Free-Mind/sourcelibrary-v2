import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

export const dynamic = 'force-dynamic';

// Supabase connection for USTC/EFM data
const SUPABASE_URL = 'https://ykhxaecbbxaaqlujuzde.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlraHhhZWNiYnhhYXFsdWp1emRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUwNjExMDEsImV4cCI6MjA4MDYzNzEwMX0.O2chfnHGQWLOaVSFQ-F6UJMlya9EzPbsUh848SEOPj4';

interface CatalogMatch {
  source: 'EFM' | 'USTC' | 'IA';
  confidence: number; // 0-100
  identifier: string;
  title: string;
  author?: string;
  year?: string;
  language?: string;
  place?: string;
  publisher?: string;
  matchDetails: string[];
}

interface VerificationResult {
  book: {
    id: string;
    title: string;
    author: string;
    year: string;
    language: string;
    place?: string;
    publisher?: string;
  };
  matches: CatalogMatch[];
  suggested: {
    year?: string;
    language?: string;
    place?: string;
    publisher?: string;
    confidence: number;
  };
}

// Normalize text for matching
function normalize(text: string | undefined | null): string {
  if (!text) return '';
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Calculate similarity between two strings (Jaccard-like)
function similarity(a: string, b: string): number {
  const normA = normalize(a);
  const normB = normalize(b);
  if (!normA || !normB) return 0;

  const wordsA = new Set(normA.split(' ').filter(w => w.length > 2));
  const wordsB = new Set(normB.split(' ').filter(w => w.length > 2));

  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  const intersection = [...wordsA].filter(w => wordsB.has(w)).length;
  const union = new Set([...wordsA, ...wordsB]).size;

  return Math.round((intersection / union) * 100);
}

// Extract year from various formats
function extractYear(text: string | undefined | null): string | undefined {
  if (!text) return undefined;
  const match = text.match(/\b(1[4-9]\d{2}|20[0-2]\d)\b/);
  return match ? match[1] : undefined;
}

// GET /api/books/[id]/verify-metadata - Find matches in external catalogs
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = await getDb();

    // Get the book
    const book = await db.collection('books').findOne({ id });
    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    const matches: CatalogMatch[] = [];

    // 1. Search local external_catalog (EFM + IA)
    const searchTerms = [book.title, book.author]
      .filter(Boolean)
      .join(' ')
      .split(' ')
      .filter((w: string) => w.length >= 3)
      .slice(0, 3); // Use first 3 significant words

    if (searchTerms.length > 0) {
      const wordConditions = searchTerms.map((word: string) => ({
        $or: [
          { title: { $regex: word, $options: 'i' } },
          { author: { $regex: word, $options: 'i' } },
        ]
      }));

      const catalogDocs = await db.collection('external_catalog')
        .find({ $and: wordConditions })
        .limit(20)
        .toArray();

      for (const doc of catalogDocs) {
        const titleSim = similarity(book.title, doc.title);
        const authorSim = similarity(book.author, doc.author);
        const confidence = Math.round((titleSim * 0.7) + (authorSim * 0.3));

        if (confidence > 30) {
          const matchDetails: string[] = [];
          if (titleSim > 50) matchDetails.push(`Title match: ${titleSim}%`);
          if (authorSim > 50) matchDetails.push(`Author match: ${authorSim}%`);

          matches.push({
            source: doc.source === 'bph' ? 'EFM' : 'IA',
            confidence,
            identifier: doc.identifier || doc._id.toString(),
            title: doc.title || 'Untitled',
            author: doc.author,
            year: doc.year?.toString(),
            language: doc.language,
            place: doc.placeOfPublication,
            publisher: doc.publisher,
            matchDetails,
          });
        }
      }
    }

    // 2. Search USTC (for older books)
    try {
      const headers = {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      };

      // Search enrichments first (has English translations)
      const searchQuery = normalize(book.title).split(' ').slice(0, 3).join(' ');
      if (searchQuery.length >= 3) {
        const enrichedUrl = new URL(`${SUPABASE_URL}/rest/v1/ustc_enrichments`);
        enrichedUrl.searchParams.set('select', 'id,std_title,english_title,detected_language,work_type,original_author');
        enrichedUrl.searchParams.set('limit', '10');
        enrichedUrl.searchParams.set('or', `(std_title.ilike.*${searchQuery}*,english_title.ilike.*${searchQuery}*,original_author.ilike.*${searchQuery}*)`);

        const enrichRes = await fetch(enrichedUrl.toString(), { headers });
        if (enrichRes.ok) {
          const enrichData = await enrichRes.json();

          for (const row of enrichData) {
            const titleSim = Math.max(
              similarity(book.title, row.std_title || ''),
              similarity(book.title, row.english_title || '')
            );
            const authorSim = similarity(book.author, row.original_author || '');
            const confidence = Math.round((titleSim * 0.7) + (authorSim * 0.3));

            if (confidence > 30) {
              // Fetch full edition data for year/place
              const edUrl = new URL(`${SUPABASE_URL}/rest/v1/ustc_editions`);
              edUrl.searchParams.set('select', 'id,title,author_1,language_1,year,place');
              edUrl.searchParams.set('id', `eq.${row.id}`);

              const edRes = await fetch(edUrl.toString(), { headers });
              const edData = edRes.ok ? await edRes.json() : [];
              const edition = edData[0];

              matches.push({
                source: 'USTC',
                confidence,
                identifier: `USTC-${row.id}`,
                title: row.std_title || edition?.title || '',
                author: row.original_author || edition?.author_1,
                year: edition?.year?.toString(),
                language: row.detected_language || edition?.language_1,
                place: edition?.place,
                matchDetails: [
                  `Title match: ${titleSim}%`,
                  authorSim > 30 ? `Author match: ${authorSim}%` : null,
                  row.english_title ? `English: "${row.english_title}"` : null,
                ].filter(Boolean) as string[],
              });
            }
          }
        }
      }
    } catch (e) {
      console.error('USTC search error:', e);
    }

    // Sort by confidence
    matches.sort((a, b) => b.confidence - a.confidence);

    // Build suggested metadata from highest confidence matches
    const suggested: VerificationResult['suggested'] = { confidence: 0 };

    const bestMatch = matches[0];
    if (bestMatch && bestMatch.confidence > 60) {
      suggested.confidence = bestMatch.confidence;

      // Only suggest fields that are currently Unknown or missing
      if ((!book.published || book.published === 'Unknown') && bestMatch.year) {
        suggested.year = extractYear(bestMatch.year) || bestMatch.year;
      }
      if ((!book.language || book.language === 'Unknown') && bestMatch.language && bestMatch.language !== 'Unknown') {
        suggested.language = bestMatch.language;
      }
      if (!book.place_of_publication && bestMatch.place) {
        suggested.place = bestMatch.place;
      }
      if (!book.publisher && bestMatch.publisher) {
        suggested.publisher = bestMatch.publisher;
      }
    }

    const result: VerificationResult = {
      book: {
        id: book.id,
        title: book.title,
        author: book.author,
        year: book.published,
        language: book.language,
        place: book.place_of_publication,
        publisher: book.publisher,
      },
      matches: matches.slice(0, 10), // Top 10 matches
      suggested,
    };

    return NextResponse.json(result);
  } catch (error) {
    console.error('Verify metadata error:', error);
    return NextResponse.json({ error: 'Verification failed' }, { status: 500 });
  }
}

// POST /api/books/[id]/verify-metadata - Apply verified metadata
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { year, language, place, publisher, source, confidence } = body;

    const db = await getDb();

    // Get current book
    const book = await db.collection('books').findOne({ id });
    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    const updates: Record<string, unknown> = {
      updated_at: new Date(),
    };
    const changes: string[] = [];

    // Only update if value provided and different from current
    if (year && book.published !== year) {
      updates.published = year;
      changes.push(`year: ${book.published} → ${year}`);
    }
    if (language && book.language !== language) {
      updates.language = language;
      changes.push(`language: ${book.language} → ${language}`);
    }
    if (place && book.place_of_publication !== place) {
      updates.place_of_publication = place;
      changes.push(`place: ${book.place_of_publication || 'none'} → ${place}`);
    }
    if (publisher && book.publisher !== publisher) {
      updates.publisher = publisher;
      changes.push(`publisher: ${book.publisher || 'none'} → ${publisher}`);
    }

    // Record verification
    updates.metadata_verified = {
      date: new Date(),
      source: source || 'catalog',
      confidence: confidence || 0,
      changes,
    };

    if (changes.length === 0) {
      return NextResponse.json({
        message: 'No changes to apply',
        book: { id: book.id, title: book.title }
      });
    }

    await db.collection('books').updateOne({ id }, { $set: updates });

    return NextResponse.json({
      message: 'Metadata updated',
      book: { id: book.id, title: book.title },
      changes,
      source,
      confidence,
    });
  } catch (error) {
    console.error('Apply metadata error:', error);
    return NextResponse.json({ error: 'Update failed' }, { status: 500 });
  }
}
