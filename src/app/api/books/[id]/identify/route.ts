import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

const IDENTIFY_PROMPT = `Analyze these pages from a historical book and extract bibliographic information.

**Your task:** Identify the book's metadata from the title page, colophon, or content.

**Return JSON with these fields (use null if not found):**
{
  "title": "The book's title in its original language",
  "title_english": "English translation of the title",
  "author": "Author name(s)",
  "year": "Year of publication (just the number, e.g., 1634)",
  "place": "Place of publication",
  "publisher": "Publisher or printer name",
  "language": "Primary language (e.g., Latin, German, French)",
  "search_terms": ["term1", "term2", "term3"]
}

**For search_terms:** Include 3-5 key terms that would help find this book in a catalog:
- Simplified versions of the title (without diacritics)
- Author's last name
- Common alternate spellings (e.g., "Boehme" and "Böhme")
- Latin or vernacular title variants

**IMPORTANT:** Return ONLY valid JSON, no markdown or extra text.`;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: bookId } = await params;
    const db = await getDb();

    // Find the book
    const book = await db.collection('books').findOne({ id: bookId });
    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    // Get first 5 pages (title page, etc.) and last 3 (colophon)
    const pages = await db.collection('pages')
      .find({ book_id: bookId })
      .sort({ page_number: 1 })
      .toArray();

    if (pages.length === 0) {
      return NextResponse.json({ error: 'No pages in this book' }, { status: 400 });
    }

    // Get relevant pages for identification
    const relevantPages = [
      ...pages.slice(0, Math.min(5, pages.length)),
      ...pages.slice(-Math.min(3, pages.length))
    ];

    // Build context from OCR and translations
    const contextParts: string[] = [];
    for (const p of relevantPages) {
      const ocr = p.ocr?.data || '';
      const translation = p.translation?.data || '';
      if (ocr || translation) {
        contextParts.push(`--- Page ${p.page_number} ---`);
        if (ocr) contextParts.push(`[Original]: ${ocr.slice(0, 2000)}`);
        if (translation) contextParts.push(`[Translation]: ${translation.slice(0, 2000)}`);
      }
    }

    if (contextParts.length === 0) {
      return NextResponse.json({
        error: 'No OCR or translation data. Process pages first.'
      }, { status: 400 });
    }

    const context = contextParts.join('\n\n');

    // Ask AI to identify
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    const prompt = `${IDENTIFY_PROMPT}\n\n**Pages:**\n\n${context}`;

    const result = await model.generateContent(prompt);
    const responseText = result.response.text();

    // Parse JSON response
    let identified;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        identified = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No JSON found');
      }
    } catch {
      console.error('Failed to parse AI response:', responseText);
      return NextResponse.json({ error: 'Failed to parse AI response' }, { status: 500 });
    }

    // Search catalogs with the extracted terms
    const searchTerms = identified.search_terms || [];
    if (identified.author) searchTerms.push(identified.author.split(',')[0]);
    if (identified.title) {
      // Add simplified title words
      const titleWords = identified.title.split(/\s+/).filter((w: string) => w.length > 4);
      searchTerms.push(...titleWords.slice(0, 3));
    }

    // Search local catalog
    const catalogResults: Array<{
      id: string;
      title: string;
      author?: string;
      year?: string;
      place?: string;
      source: string;
    }> = [];

    for (const term of [...new Set(searchTerms)].slice(0, 5)) {
      if (!term || term.length < 3) continue;

      try {
        const docs = await db.collection('external_catalog')
          .find({
            $or: [
              { title: { $regex: term, $options: 'i' } },
              { author: { $regex: term, $options: 'i' } },
            ]
          })
          .limit(5)
          .toArray();

        for (const doc of docs) {
          // Avoid duplicates
          if (!catalogResults.find(r => r.id === doc.identifier)) {
            catalogResults.push({
              id: doc.identifier || doc._id.toString(),
              title: doc.title,
              author: doc.author,
              year: doc.year,
              place: doc.placeOfPublication,
              source: doc.source === 'bph' ? 'EFM' : 'IA',
            });
          }
        }
      } catch (e) {
        console.error('Catalog search error:', e);
      }
    }

    return NextResponse.json({
      identified,
      catalog_matches: catalogResults.slice(0, 10),
    });
  } catch (error) {
    console.error('Error identifying book:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to identify book' },
      { status: 500 }
    );
  }
}
