import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

export const dynamic = 'force-dynamic';

interface CatalogResult {
  id: string;
  title: string;
  author: string;
  year: string;
  language: string;
  description: string;
  publisher?: string;
  placeOfPublication?: string;
  printer?: string;
  source: 'ia' | 'bph';
  iaIdentifier?: string;
  imageUrl?: string;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get('q')?.toLowerCase() || '';
  const source = searchParams.get('source') || 'all'; // 'ia', 'bph', or 'all'
  const limit = parseInt(searchParams.get('limit') || '20', 10);

  if (!query || query.length < 2) {
    return NextResponse.json({
      results: [],
      total: 0,
      message: 'Please enter at least 2 characters to search'
    });
  }

  try {
    const db = await getDb();

    // Split query into words and search for all of them
    const words = query.split(/\s+/).filter(w => w.length >= 2);

    // Build query - each word must match in title, author, year, or description
    const wordConditions = words.map(word => ({
      $or: [
        { title: { $regex: word, $options: 'i' } },
        { author: { $regex: word, $options: 'i' } },
        { year: { $regex: word, $options: 'i' } },
        { description: { $regex: word, $options: 'i' } }
      ]
    }));

    const searchQuery: Record<string, unknown> = wordConditions.length > 0
      ? { $and: wordConditions }
      : {};

    // Filter by source if specified
    if (source !== 'all') {
      searchQuery.source = source;
    }

    const docs = await db.collection('external_catalog')
      .find(searchQuery)
      .limit(limit)
      .toArray();

    const results: CatalogResult[] = docs.map(doc => ({
      id: doc.identifier || doc._id.toString(),
      title: doc.title || 'Untitled',
      author: doc.author || 'Unknown',
      year: doc.year || 'Unknown',
      language: doc.language || 'Unknown',
      description: doc.description || '',
      publisher: doc.publisher || undefined,
      placeOfPublication: doc.placeOfPublication || undefined,
      printer: doc.printer || undefined,
      source: doc.source as 'ia' | 'bph',
      iaIdentifier: doc.source === 'ia' ? doc.identifier : undefined,
      imageUrl: doc.imageUrl || undefined
    }));

    return NextResponse.json({
      results,
      total: results.length,
      query,
      source
    });
  } catch (error) {
    console.error('Catalog search error:', error);
    return NextResponse.json({
      results: [],
      total: 0,
      error: 'Search failed'
    }, { status: 500 });
  }
}
