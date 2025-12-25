import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { Chapter } from '@/lib/types';

// Extract markdown headings from OCR text
function extractHeadingsFromOcr(ocrText: string): Array<{ title: string; level: number }> {
  const headings: Array<{ title: string; level: number }> = [];
  const lines = ocrText.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();

    // Match markdown headings: #, ##, ###
    // Also handle centered headings with ->
    const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      let title = headingMatch[2].trim();

      // Remove centering markers
      title = title.replace(/^->/, '').replace(/<-$/, '').trim();

      // Remove bold markers
      title = title.replace(/^\*\*/, '').replace(/\*\*$/, '').trim();

      // Skip if it's just a page number or meta tag
      if (title.startsWith('[[') || title.match(/^page\s*\d+$/i)) {
        continue;
      }

      // Skip very short titles (likely drop caps or fragments)
      if (title.length < 5) {
        continue;
      }

      // Skip if it looks like a sentence fragment (starts lowercase, or is just one word with no caps)
      if (/^[a-z]/.test(title) && !title.includes(' ')) {
        continue;
      }

      // Skip lines that are clearly continuation text (start with common Latin words mid-sentence)
      const continuationPatterns = /^(et|uel|aut|sed|nam|cum|si|in|de|ad|ex|per|pro|quod|quia|quam|tum|tunc|enim|autem|uero|ergo|igitur|itaque)\s/i;
      if (continuationPatterns.test(title)) {
        continue;
      }

      headings.push({ title, level });
    }
  }

  return headings;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = await getDb();

    // Get all pages for this book with OCR data
    const pages = await db.collection('pages')
      .find({ book_id: id, 'ocr.data': { $exists: true, $ne: '' } })
      .sort({ page_number: 1 })
      .toArray();

    if (pages.length === 0) {
      return NextResponse.json(
        { error: 'No pages with OCR found for this book' },
        { status: 404 }
      );
    }

    // Extract chapters from each page
    const chapters: Chapter[] = [];

    for (const page of pages) {
      const ocrText = page.ocr?.data || '';
      const headings = extractHeadingsFromOcr(ocrText);

      for (const heading of headings) {
        chapters.push({
          title: heading.title,
          pageId: page.id,
          pageNumber: page.page_number,
          level: heading.level,
        });
      }
    }

    // Update the book with extracted chapters
    await db.collection('books').updateOne(
      { id },
      {
        $set: {
          chapters,
          chapters_extracted_at: new Date(),
        }
      }
    );

    return NextResponse.json({
      success: true,
      chaptersCount: chapters.length,
      chapters,
    });
  } catch (error) {
    console.error('Error extracting chapters:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to extract chapters' },
      { status: 500 }
    );
  }
}

// GET endpoint to retrieve existing chapters
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = await getDb();

    const book = await db.collection('books').findOne({ id });

    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    return NextResponse.json({
      chapters: book.chapters || [],
      extractedAt: book.chapters_extracted_at,
    });
  } catch (error) {
    console.error('Error getting chapters:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get chapters' },
      { status: 500 }
    );
  }
}
