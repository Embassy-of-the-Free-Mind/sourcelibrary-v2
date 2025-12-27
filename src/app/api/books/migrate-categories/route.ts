import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

// Map old category IDs to new ones
const CATEGORY_MIGRATIONS: Record<string, string[]> = {
  // Old generic kabbalah → default to jewish-kabbalah (can be manually adjusted)
  'kabbalah': ['jewish-kabbalah'],
  'Kabbalah': ['jewish-kabbalah'],

  // Old generic magic → split into all three (user can refine)
  'magic': ['natural-magic', 'ritual-magic'],
  'Magic': ['natural-magic', 'ritual-magic'],

  // Egyptian was too vague - remove it (hermeticism and prisca-theologia cover it)
  'egyptian': [],
  'Egyptian': [],

  // Normalize capitalized variants
  'Alchemy': ['alchemy'],
  'Rosicrucianism': ['rosicrucianism'],
  'Christian Kabbalah': ['christian-cabala'],

  // Remove manual tags that are now redundant
  'Forshaw': [], // Remove - was a manual tag, not a category
};

// Categories that should be removed entirely (including ObjectIds)
const isObjectId = (str: string) => /^[0-9a-f]{24}$/.test(str);

export async function GET() {
  try {
    const db = await getDb();
    const books = await db.collection('books').find({
      categories: { $exists: true, $ne: [] }
    }).toArray();

    const preview: Array<{
      id: string;
      title: string;
      current: string[];
      willRemove: string[];
      willAdd: string[];
      final: string[];
    }> = [];

    for (const book of books) {
      const current = book.categories || [];
      const willRemove: string[] = [];
      const willAdd: string[] = [];
      const final = new Set<string>();

      for (const cat of current) {
        if (isObjectId(cat)) {
          // Remove ObjectIds
          willRemove.push(cat);
        } else if (CATEGORY_MIGRATIONS[cat] !== undefined) {
          // Migrate old category
          willRemove.push(cat);
          for (const newCat of CATEGORY_MIGRATIONS[cat]) {
            if (!current.includes(newCat)) {
              willAdd.push(newCat);
            }
            final.add(newCat);
          }
        } else {
          // Keep valid category
          final.add(cat);
        }
      }

      if (willRemove.length > 0 || willAdd.length > 0) {
        preview.push({
          id: book.id,
          title: book.display_title || book.title,
          current,
          willRemove,
          willAdd,
          final: Array.from(final),
        });
      }
    }

    return NextResponse.json({
      total: books.length,
      affected: preview.length,
      preview,
    });
  } catch (error) {
    console.error('Error previewing migration:', error);
    return NextResponse.json({ error: 'Failed to preview migration' }, { status: 500 });
  }
}

export async function POST() {
  try {
    const db = await getDb();
    const books = await db.collection('books').find({
      categories: { $exists: true, $ne: [] }
    }).toArray();

    let updated = 0;
    const results: Array<{ id: string; title: string; before: string[]; after: string[] }> = [];

    for (const book of books) {
      const current = book.categories || [];
      const final = new Set<string>();
      let changed = false;

      for (const cat of current) {
        if (isObjectId(cat)) {
          // Remove ObjectIds
          changed = true;
        } else if (CATEGORY_MIGRATIONS[cat] !== undefined) {
          // Migrate old category
          changed = true;
          for (const newCat of CATEGORY_MIGRATIONS[cat]) {
            final.add(newCat);
          }
        } else {
          // Keep valid category
          final.add(cat);
        }
      }

      if (changed) {
        const newCategories = Array.from(final);
        await db.collection('books').updateOne(
          { id: book.id },
          { $set: { categories: newCategories } }
        );
        updated++;
        results.push({
          id: book.id,
          title: book.display_title || book.title,
          before: current,
          after: newCategories,
        });
      }
    }

    return NextResponse.json({
      success: true,
      total: books.length,
      updated,
      results,
    });
  } catch (error) {
    console.error('Error running migration:', error);
    return NextResponse.json({ error: 'Failed to run migration' }, { status: 500 });
  }
}
