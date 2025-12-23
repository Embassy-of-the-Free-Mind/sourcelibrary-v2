import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

interface SplitRequest {
  pageId: string;
  splitPosition: number; // 0-1000 scale
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { splits }: { splits: SplitRequest[] } = body;

    if (!splits || splits.length === 0) {
      return NextResponse.json({ error: 'No splits provided' }, { status: 400 });
    }

    const db = await getDb();

    // Get all pages to split
    const pageIds = splits.map(s => s.pageId);
    const pages = await db.collection('pages')
      .find({ id: { $in: pageIds } })
      .toArray();

    if (pages.length === 0) {
      return NextResponse.json({ error: 'No pages found' }, { status: 404 });
    }

    // Get book_id from first page (all should be same book)
    const bookId = pages[0].book_id;

    // Create all new pages and update existing pages
    const newPages: Array<{
      id: string;
      book_id: string;
      page_number: number;
      photo: string;
      photo_original: string;
      crop: { xStart: number; xEnd: number };
      split_from: string;
      ocr: null;
      translation: null;
      summary: null;
      created_at: Date;
      updated_at: Date;
    }> = [];
    const updateOps: Array<{
      updateOne: {
        filter: { id: string };
        update: { $set: { crop: { xStart: number; xEnd: number }; photo_original: string; updated_at: Date } };
      };
    }> = [];

    for (const split of splits) {
      const page = pages.find(p => p.id === split.pageId);
      if (!page || !page.photo) continue;

      // Add 1% overlap (10 on 0-1000 scale) on each side
      const overlap = 10;
      const leftCrop = { xStart: 0, xEnd: Math.min(1000, split.splitPosition + overlap) };
      const rightCrop = { xStart: Math.max(0, split.splitPosition - overlap), xEnd: 1000 };

      // Update existing page with left crop
      updateOps.push({
        updateOne: {
          filter: { id: page.id },
          update: {
            $set: {
              crop: leftCrop,
              photo_original: page.photo_original || page.photo,
              updated_at: new Date()
            }
          }
        }
      });

      // Create new page for right side
      const newPageId = new ObjectId().toHexString();
      newPages.push({
        id: newPageId,
        book_id: bookId,
        page_number: page.page_number + 0.5, // Will be renumbered
        photo: page.photo_original || page.photo,
        photo_original: page.photo_original || page.photo,
        crop: rightCrop,
        split_from: page.id,
        ocr: null,
        translation: null,
        summary: null,
        created_at: new Date(),
        updated_at: new Date()
      });
    }

    // Execute updates and inserts in parallel
    await Promise.all([
      updateOps.length > 0 ? db.collection('pages').bulkWrite(updateOps) : Promise.resolve(),
      newPages.length > 0 ? db.collection('pages').insertMany(newPages) : Promise.resolve()
    ]);

    // Renumber all pages once at the end
    const allPages = await db.collection('pages')
      .find({ book_id: bookId })
      .sort({ page_number: 1 })
      .toArray();

    const renumberOps = allPages.map((p, i) => ({
      updateOne: {
        filter: { id: p.id },
        update: { $set: { page_number: i + 1 } }
      }
    }));

    if (renumberOps.length > 0) {
      await db.collection('pages').bulkWrite(renumberOps);
    }

    // Update book page count
    await db.collection('books').updateOne(
      { id: bookId },
      { $set: { pages: allPages.length } }
    );

    return NextResponse.json({
      success: true,
      splitCount: newPages.length,
      totalPages: allPages.length
    });
  } catch (error) {
    console.error('Error batch splitting pages:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Batch split failed' },
      { status: 500 }
    );
  }
}
