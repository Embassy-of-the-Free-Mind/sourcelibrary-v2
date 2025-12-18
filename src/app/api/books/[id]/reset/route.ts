import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = await getDb();

    // 1. Delete all split pages (pages created from splits)
    const deleteResult = await db.collection('pages').deleteMany({
      book_id: id,
      split_from: { $exists: true, $ne: null }
    });

    // 2. Restore original photos and clear crop/split data for remaining pages
    const pages = await db.collection('pages')
      .find({ book_id: id })
      .toArray();

    for (const page of pages) {
      const updates: Record<string, unknown> = {
        updated_at: new Date(),
      };

      // Restore original photo if we have it
      if (page.photo_original) {
        updates.photo = page.photo_original;
      }

      // Clear split-related fields
      await db.collection('pages').updateOne(
        { id: page.id },
        {
          $set: updates,
          $unset: {
            photo_original: '',
            cropped_photo: '',
            crop: '',
            split_detection: '',
            thumbnail: '',
            compressed_photo: '',
          }
        }
      );
    }

    // 3. Renumber pages sequentially
    const allPages = await db.collection('pages')
      .find({ book_id: id })
      .sort({ page_number: 1 })
      .toArray();

    for (let i = 0; i < allPages.length; i++) {
      await db.collection('pages').updateOne(
        { id: allPages[i].id },
        { $set: { page_number: i + 1 } }
      );
    }

    return NextResponse.json({
      success: true,
      deleted: deleteResult.deletedCount,
      restored: pages.length,
      total: allPages.length,
    });
  } catch (error) {
    console.error('Reset error:', error);
    return NextResponse.json(
      { error: 'Reset failed' },
      { status: 500 }
    );
  }
}
