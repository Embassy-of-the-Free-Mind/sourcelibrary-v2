import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    // Load collection metadata
    const collectionPath = path.join(
      process.cwd(),
      'curator-data',
      'collections',
      `${id}.json`
    );

    const collectionData = await fs.readFile(collectionPath, 'utf-8');
    const collection = JSON.parse(collectionData);

    // Fetch actual book data from MongoDB
    const db = await getDb();
    const bookIds = collection.books.map((b: any) => {
      try {
        return new ObjectId(b.bookId);
      } catch {
        return null;
      }
    }).filter(Boolean);

    const books = await db.collection('books').find({
      _id: { $in: bookIds }
    }).toArray();

    // Create a map of bookId -> book data
    const bookMap = new Map();
    books.forEach(book => {
      bookMap.set(book._id.toString(), {
        id: book._id.toString(),
        title: book.title,
        author: book.author,
        language: book.language,
        published: book.published,
        pages_count: book.pages_count || 0,
        pages_translated: book.pages_translated || 0,
        pages_ocr: book.pages_ocr || 0,
        has_doi: book.has_doi || false,
        poster_url: book.poster_url || null,
        categories: book.categories || [],
      });
    });

    // Enrich collection books with actual data
    const enrichedBooks = collection.books.map((b: any) => {
      const bookData = bookMap.get(b.bookId);
      return {
        ...b,
        ...(bookData || {}),
      };
    }).filter((b: any) => b.id); // Only include books that were found

    // Return enriched collection
    return NextResponse.json({
      ...collection,
      books: enrichedBooks,
      stats: {
        totalBooks: enrichedBooks.length,
        totalPages: enrichedBooks.reduce((sum: number, b: any) => sum + (b.pages_count || b.pages || 0), 0),
        ocrComplete: enrichedBooks.filter((b: any) => b.pages_ocr > 0).length,
        translationsComplete: enrichedBooks.filter((b: any) => b.pages_translated > 0).length,
        withDOI: enrichedBooks.filter((b: any) => b.has_doi).length,
      }
    });
  } catch (error) {
    console.error(`Error loading enriched collection ${id}:`, error);
    return NextResponse.json(
      { error: 'Collection not found' },
      { status: 404 }
    );
  }
}
