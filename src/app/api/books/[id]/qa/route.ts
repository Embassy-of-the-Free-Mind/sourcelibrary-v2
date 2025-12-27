import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { validateTranslation, ValidationIssue } from '@/lib/validateTranslation';

interface PageIssue {
  pageId: string;
  pageNumber: number;
  field: 'translation' | 'ocr';
  issues: ValidationIssue[];
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = await getDb();

    // Get book to verify it exists
    const book = await db.collection('books').findOne({ id });
    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    // Get all pages with translations
    const pages = await db.collection('pages')
      .find({ book_id: id })
      .sort({ page_number: 1 })
      .toArray();

    const pageIssues: PageIssue[] = [];
    let totalWithTranslation = 0;

    for (const page of pages) {
      const pageProblems: PageIssue[] = [];

      // Check translation
      if (page.translation?.data) {
        totalWithTranslation++;
        const result = validateTranslation(page.translation.data);
        if (!result.valid) {
          pageProblems.push({
            pageId: page.id,
            pageNumber: page.page_number,
            field: 'translation',
            issues: result.issues
          });
        }
      }

      // Also check OCR for formatting issues
      if (page.ocr?.data) {
        const result = validateTranslation(page.ocr.data);
        if (!result.valid) {
          pageProblems.push({
            pageId: page.id,
            pageNumber: page.page_number,
            field: 'ocr',
            issues: result.issues
          });
        }
      }

      pageIssues.push(...pageProblems);
    }

    // Count unique pages with issues
    const uniquePagesWithIssues = new Set(pageIssues.map(p => p.pageId)).size;

    return NextResponse.json({
      bookId: id,
      bookTitle: book.title,
      totalPages: pages.length,
      translatedPages: totalWithTranslation,
      pagesWithIssues: uniquePagesWithIssues,
      totalIssues: pageIssues.reduce((sum, p) => sum + p.issues.length, 0),
      issues: pageIssues
    });
  } catch (error) {
    console.error('Error scanning book for QA issues:', error);
    return NextResponse.json({ error: 'Failed to scan book' }, { status: 500 });
  }
}
