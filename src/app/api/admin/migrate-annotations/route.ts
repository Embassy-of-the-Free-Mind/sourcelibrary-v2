import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

/**
 * Migrate annotation syntax from [[tag:content]] to <tag>content</tag>
 *
 * POST /api/admin/migrate-annotations
 * Body: { bookId?: string, dryRun?: boolean }
 *
 * If bookId is provided, migrates only that book's pages.
 * If omitted, migrates all pages in the database.
 */

// Map of old [[tag:]] syntax to new <tag></tag> XML syntax
const TAG_MAPPINGS = [
  // Display annotations (visible to readers)
  { old: /\[\[(notes?):\s*([\s\S]*?)\]\]/gi, new: '<note>$2</note>' },
  { old: /\[\[margin:\s*([\s\S]*?)\]\]/gi, new: '<margin>$1</margin>' },
  { old: /\[\[gloss:\s*([\s\S]*?)\]\]/gi, new: '<gloss>$1</gloss>' },
  { old: /\[\[insert:\s*([\s\S]*?)\]\]/gi, new: '<insert>$1</insert>' },
  { old: /\[\[unclear:\s*([\s\S]*?)\]\]/gi, new: '<unclear>$1</unclear>' },
  { old: /\[\[term:\s*([\s\S]*?)\]\]/gi, new: '<term>$1</term>' },
  { old: /\[\[image:\s*([\s\S]*?)\]\]/gi, new: '<image-desc>$1</image-desc>' },

  // Metadata tags (hidden from readers)
  { old: /\[\[language:\s*([\s\S]*?)\]\]/gi, new: '<lang>$1</lang>' },
  { old: /\[\[page\s*number:\s*([\s\S]*?)\]\]/gi, new: '<page-num>$1</page-num>' },
  { old: /\[\[folio:\s*([\s\S]*?)\]\]/gi, new: '<folio>$1</folio>' },
  { old: /\[\[signature:\s*([\s\S]*?)\]\]/gi, new: '<sig>$1</sig>' },
  { old: /\[\[header:\s*([\s\S]*?)\]\]/gi, new: '<header>$1</header>' },
  { old: /\[\[meta:\s*([\s\S]*?)\]\]/gi, new: '<meta>$1</meta>' },
  { old: /\[\[warning:\s*([\s\S]*?)\]\]/gi, new: '<warning>$1</warning>' },
  { old: /\[\[abbrev:\s*([\s\S]*?)\]\]/gi, new: '<abbrev>$1</abbrev>' },
  { old: /\[\[vocabulary:\s*([\s\S]*?)\]\]/gi, new: '<vocab>$1</vocab>' },
  { old: /\[\[summary:\s*([\s\S]*?)\]\]/gi, new: '<summary>$1</summary>' },
  { old: /\[\[keywords:\s*([\s\S]*?)\]\]/gi, new: '<keywords>$1</keywords>' },
];

function migrateText(text: string): { migrated: string; changesCount: number } {
  let result = text;
  let changesCount = 0;

  for (const mapping of TAG_MAPPINGS) {
    const matches = result.match(mapping.old);
    if (matches) {
      changesCount += matches.length;
      result = result.replace(mapping.old, mapping.new);
    }
  }

  return { migrated: result, changesCount };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { bookId, dryRun = true } = body;

    const db = await getDb();

    // Build query
    const query = bookId ? { book_id: bookId } : {};

    // Get pages
    const pages = await db.collection('pages')
      .find(query)
      .project({ _id: 1, book_id: 1, page_number: 1, 'translation.data': 1, 'ocr.data': 1 })
      .toArray();

    const results = {
      totalPages: pages.length,
      pagesWithChanges: 0,
      totalChanges: 0,
      dryRun,
      details: [] as Array<{
        pageId: string;
        bookId: string;
        pageNumber: number;
        translationChanges: number;
        ocrChanges: number;
      }>,
    };

    for (const page of pages) {
      let translationChanges = 0;
      let ocrChanges = 0;
      const updates: Record<string, string> = {};

      // Migrate translation
      if (page.translation?.data) {
        const { migrated, changesCount } = migrateText(page.translation.data);
        if (changesCount > 0) {
          translationChanges = changesCount;
          updates['translation.data'] = migrated;
        }
      }

      // Migrate OCR
      if (page.ocr?.data) {
        const { migrated, changesCount } = migrateText(page.ocr.data);
        if (changesCount > 0) {
          ocrChanges = changesCount;
          updates['ocr.data'] = migrated;
        }
      }

      if (translationChanges > 0 || ocrChanges > 0) {
        results.pagesWithChanges++;
        results.totalChanges += translationChanges + ocrChanges;

        results.details.push({
          pageId: page._id.toString(),
          bookId: page.book_id,
          pageNumber: page.page_number,
          translationChanges,
          ocrChanges,
        });

        // Apply updates if not dry run
        if (!dryRun && Object.keys(updates).length > 0) {
          await db.collection('pages').updateOne(
            { _id: page._id },
            { $set: { ...updates, 'annotation_syntax': 'xml', updated_at: new Date() } }
          );
        }
      }
    }

    return NextResponse.json({
      success: true,
      message: dryRun
        ? `Dry run complete. Would migrate ${results.pagesWithChanges} pages with ${results.totalChanges} changes.`
        : `Migration complete. Updated ${results.pagesWithChanges} pages with ${results.totalChanges} changes.`,
      ...results,
    });
  } catch (error) {
    console.error('Migration error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Migration failed' },
      { status: 500 }
    );
  }
}

// GET endpoint to check migration status
export async function GET() {
  try {
    const db = await getDb();

    // Count pages by annotation syntax
    const stats = await db.collection('pages').aggregate([
      {
        $group: {
          _id: '$annotation_syntax',
          count: { $sum: 1 },
        },
      },
    ]).toArray();

    // Count pages with old [[tag:]] syntax in translation or OCR
    const oldSyntaxCount = await db.collection('pages').countDocuments({
      $or: [
        { 'translation.data': { $regex: '\\[\\[(notes?|margin|gloss|insert|unclear|term|image|language|page\\s*number|folio|signature|header|meta|warning|abbrev|vocabulary|summary|keywords):' } },
        { 'ocr.data': { $regex: '\\[\\[(notes?|margin|gloss|insert|unclear|term|image|language|page\\s*number|folio|signature|header|meta|warning|abbrev|vocabulary|summary|keywords):' } }
      ]
    });

    return NextResponse.json({
      syntaxStats: stats,
      pagesWithOldSyntax: oldSyntaxCount,
      hint: 'POST with { dryRun: false } to migrate, or { bookId: "...", dryRun: false } for a specific book',
    });
  } catch (error) {
    console.error('Migration status error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to check status' },
      { status: 500 }
    );
  }
}
