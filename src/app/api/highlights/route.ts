import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

export interface Highlight {
  id: string;
  book_id: string;
  page_id: string;
  page_number: number;
  book_title: string;
  book_author?: string;
  text: string;
  context?: string;  // Surrounding text for context
  note?: string;     // Optional user note
  color?: string;    // Highlight color
  user_name?: string; // Who highlighted this (public)
  created_at: Date;
}

// GET /api/highlights - Get all highlights, optionally filtered
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const bookId = searchParams.get('book_id');
    const pageId = searchParams.get('page_id');
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '50')));
    const skip = Math.max(0, parseInt(searchParams.get('skip') || '0'));

    const db = await getDb();

    const query: Record<string, string> = {};
    if (bookId) query.book_id = bookId;
    if (pageId) query.page_id = pageId;

    const highlights = await db.collection('highlights')
      .find(query)
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(limit)
      .toArray();

    return NextResponse.json({ highlights, pagination: { limit, skip } });
  } catch (error) {
    console.error('Error fetching highlights:', error);
    return NextResponse.json(
      { error: 'Failed to fetch highlights' },
      { status: 500 }
    );
  }
}

// POST /api/highlights - Create a new highlight
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { book_id, page_id, page_number, book_title, book_author, text, context, note, color, user_name } = body;

    if (!book_id || !page_id || !text) {
      return NextResponse.json(
        { error: 'book_id, page_id, and text are required' },
        { status: 400 }
      );
    }

    // Length validation
    const MAX_TEXT = 2000;
    const MAX_CONTEXT = 5000;
    const MAX_NOTE = 1000;

    if (text.length < 3) {
      return NextResponse.json(
        { error: 'Highlight text must be at least 3 characters' },
        { status: 400 }
      );
    }

    if (text.length > MAX_TEXT) {
      return NextResponse.json(
        { error: `Text too long (max ${MAX_TEXT} chars)` },
        { status: 400 }
      );
    }

    if (context && context.length > MAX_CONTEXT) {
      return NextResponse.json(
        { error: `Context too long (max ${MAX_CONTEXT} chars)` },
        { status: 400 }
      );
    }

    if (note && note.length > MAX_NOTE) {
      return NextResponse.json(
        { error: `Note too long (max ${MAX_NOTE} chars)` },
        { status: 400 }
      );
    }

    const db = await getDb();

    const highlight: Highlight = {
      id: new ObjectId().toHexString(),
      book_id,
      page_id,
      page_number: page_number || 0,
      book_title: book_title || '',
      book_author: book_author || undefined,
      text: text.trim(),
      context: context?.trim(),
      note: note?.trim(),
      color: color || 'yellow',
      user_name: user_name?.trim() || undefined,
      created_at: new Date(),
    };

    await db.collection('highlights').insertOne(highlight);

    return NextResponse.json(highlight, { status: 201 });
  } catch (error) {
    console.error('Error creating highlight:', error);
    return NextResponse.json(
      { error: 'Failed to create highlight' },
      { status: 500 }
    );
  }
}
