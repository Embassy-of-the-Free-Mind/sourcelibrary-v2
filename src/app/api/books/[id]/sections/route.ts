import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { Section } from '@/lib/types';
import { ObjectId } from 'mongodb';

// GET: Retrieve sections for a book (or auto-detect if none exist)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = await getDb();
    const { searchParams } = new URL(request.url);
    const autoDetect = searchParams.get('auto') !== 'false';

    // Find the book
    const book = await db.collection('books').findOne({ id });
    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    // If book has manually defined sections, return those
    if (book.reading_sections?.length > 0) {
      return NextResponse.json({
        sections: book.reading_sections,
        detection_method: book.reading_sections[0]?.detection_method || 'manual'
      });
    }

    // If auto-detection is disabled, return empty
    if (!autoDetect) {
      return NextResponse.json({
        sections: [],
        detection_method: 'none'
      });
    }

    // Auto-detect sections from page OCR/translation
    const pages = await db.collection('pages')
      .find({ book_id: id })
      .sort({ page_number: 1 })
      .project({ page_number: 1, ocr: 1, translation: 1 })
      .toArray();

    if (pages.length === 0) {
      return NextResponse.json({
        sections: [],
        detection_method: 'none',
        message: 'No pages found'
      });
    }

    // Simple section detection: look for chapter markers in OCR
    const sections: Section[] = [];
    let currentSection: { title: string; startPage: number } | null = null;

    const chapterPatterns = [
      /^#\s+(.+)/m,                           // # Chapter Title
      /^##\s+(Chapter|Caput|Liber|Book|Part)\s+/im,  // ## Chapter/Caput/Liber
      /^(Chapter|Caput|Liber|Book|Part)\s+[IVXLCDM\d]+/im,  // Chapter I, Liber II
      /^->(.+)<-/m,                           // Centered text (often titles)
    ];

    for (const page of pages) {
      const text = page.ocr?.data || page.translation?.data || '';

      // Check for chapter markers
      for (const pattern of chapterPatterns) {
        const match = text.match(pattern);
        if (match) {
          // Close previous section
          if (currentSection) {
            sections.push({
              id: new ObjectId().toHexString(),
              title: currentSection.title,
              startPage: currentSection.startPage,
              endPage: page.page_number - 1,
              detection_method: 'ai',
              detected_at: new Date()
            });
          }

          // Start new section
          const title = match[1]?.trim() || match[0].trim().replace(/^#+\s*/, '');
          currentSection = {
            title: title.substring(0, 100), // Limit title length
            startPage: page.page_number
          };
          break;
        }
      }
    }

    // Close final section
    if (currentSection) {
      sections.push({
        id: new ObjectId().toHexString(),
        title: currentSection.title,
        startPage: currentSection.startPage,
        endPage: pages[pages.length - 1].page_number,
        detection_method: 'ai',
        detected_at: new Date()
      });
    }

    // If no sections detected, create one section for the whole book
    if (sections.length === 0) {
      sections.push({
        id: new ObjectId().toHexString(),
        title: book.title || 'Full Text',
        startPage: 1,
        endPage: pages[pages.length - 1].page_number,
        detection_method: 'ai',
        detected_at: new Date()
      });
    }

    return NextResponse.json({
      sections,
      detection_method: 'ai',
      auto_detected: true
    });
  } catch (error) {
    console.error('Error fetching sections:', error);
    return NextResponse.json({ error: 'Failed to fetch sections' }, { status: 500 });
  }
}

// POST: Manually define sections
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = await getDb();
    const body = await request.json();

    // Find the book
    const book = await db.collection('books').findOne({ id });
    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    // Validate sections
    const { sections } = body;
    if (!Array.isArray(sections)) {
      return NextResponse.json({ error: 'sections must be an array' }, { status: 400 });
    }

    // Get total page count for validation
    const pageCount = await db.collection('pages').countDocuments({ book_id: id });

    // Build section objects
    const validatedSections: Section[] = sections.map((s, index) => {
      const startPage = Math.max(1, Math.min(s.startPage || 1, pageCount));
      const endPage = Math.max(startPage, Math.min(s.endPage || pageCount, pageCount));

      return {
        id: s.id || new ObjectId().toHexString(),
        title: (s.title || `Section ${index + 1}`).substring(0, 200),
        startPage,
        endPage,
        summary: s.summary,
        detection_method: 'manual' as const,
        detected_at: new Date()
      };
    });

    // Sort by startPage
    validatedSections.sort((a, b) => a.startPage - b.startPage);

    // Save to book
    await db.collection('books').updateOne(
      { id },
      {
        $set: {
          reading_sections: validatedSections,
          updated_at: new Date()
        }
      }
    );

    return NextResponse.json({
      success: true,
      sections: validatedSections
    });
  } catch (error) {
    console.error('Error saving sections:', error);
    return NextResponse.json({ error: 'Failed to save sections' }, { status: 500 });
  }
}

// DELETE: Clear manual sections (revert to auto-detection)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = await getDb();

    const result = await db.collection('books').updateOne(
      { id },
      {
        $unset: { reading_sections: '' },
        $set: { updated_at: new Date() }
      }
    );

    if (result.matchedCount === 0) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, message: 'Sections cleared' });
  } catch (error) {
    console.error('Error clearing sections:', error);
    return NextResponse.json({ error: 'Failed to clear sections' }, { status: 500 });
  }
}
