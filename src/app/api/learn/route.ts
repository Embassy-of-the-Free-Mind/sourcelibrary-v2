import { NextRequest, NextResponse } from 'next/server';
import { getReadDb } from '@/lib/mongodb';

export const maxDuration = 15;
export const dynamic = 'force-dynamic';

interface TermEntry {
  term: string;
  definition: string;
  originalContext?: string;
  bookId: string;
  bookTitle: string;
  bookAuthor: string;
  bookDate?: string;
  bookLanguage?: string;
  pageNumber: number;
  slug?: string;
}

/** Parse <term>...</term> tags, extracting inline definitions when present */
function extractTerms(translationText: string): Array<{ term: string; definition: string; context: string }> {
  const results: Array<{ term: string; definition: string; context: string }> = [];

  // Pattern: <term>word</term> optionally followed by <note>definition</note> or <gloss>definition</gloss>
  // Also handles inline definitions like "word: definition" or "word; definition"
  const termRegex = /<term>([\s\S]*?)<\/term>\s*(?:<(?:note|gloss)>([\s\S]*?)<\/(?:note|gloss)>)?/g;

  let match;
  while ((match = termRegex.exec(translationText)) !== null) {
    const rawTerm = match[1].trim();
    const noteOrGloss = match[2]?.trim();

    let term: string;
    let definition: string;

    // Check if the term itself contains a definition (e.g., "spiritus: the breath of life")
    const inlineSplit = rawTerm.match(/^([^:;]+?)\s*[:;]\s+([\s\S]+)$/);
    if (inlineSplit) {
      term = inlineSplit[1].trim().replace(/\*/g, '');
      definition = inlineSplit[2].trim().replace(/\*/g, '');
    } else if (noteOrGloss) {
      term = rawTerm.replace(/\*/g, '');
      // Clean up note text — remove "original: " prefix and quote marks
      definition = noteOrGloss
        .replace(/^original:\s*/i, '')
        .replace(/^["']|["']$/g, '')
        .replace(/<[^>]+>/g, '') // strip nested tags
        .trim();
    } else {
      // Term without definition — skip these for quiz purposes
      continue;
    }

    // Skip very long terms (they're more like explanations)
    if (term.length > 60 || definition.length > 300) continue;
    // Skip very short/generic terms
    if (term.length < 3) continue;

    // Get surrounding context (sentence containing the term)
    const termIdx = translationText.indexOf(match[0]);
    const contextStart = Math.max(0, translationText.lastIndexOf('.', termIdx) + 1);
    const contextEnd = translationText.indexOf('.', termIdx + match[0].length);
    const context = translationText
      .slice(contextStart, contextEnd > 0 ? contextEnd + 1 : contextStart + 200)
      .replace(/<[^>]+>/g, '') // strip all tags
      .trim()
      .substring(0, 200);

    results.push({ term, definition, context });
  }

  return results;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const count = Math.min(parseInt(searchParams.get('count') || '10'), 50);
    const language = searchParams.get('language'); // filter by book language

    const db = await getReadDb();

    // Build query — find pages with <term> tags that also have adjacent <note> or <gloss>
    const query: Record<string, unknown> = {
      'translation.data': { $regex: '<term>.*?</term>\\s*<(?:note|gloss)>' },
    };

    // Get pages — we'll fetch more than needed since not all terms parse cleanly
    const pages = await db.collection('pages')
      .find(query)
      .project({ book_id: 1, page_number: 1, 'translation.data': 1 })
      .limit(count * 5)
      .maxTimeMS(10000)
      .toArray();

    // Also try pages with inline definitions (term; definition pattern)
    if (pages.length < count * 3) {
      const inlinePages = await db.collection('pages')
        .find({ 'translation.data': { $regex: '<term>[^<]*[:;][^<]*</term>' } })
        .project({ book_id: 1, page_number: 1, 'translation.data': 1 })
        .limit(count * 5)
        .maxTimeMS(10000)
        .toArray();
      const existingIds = new Set(pages.map(p => p._id.toString()));
      for (const p of inlinePages) {
        if (!existingIds.has(p._id.toString())) pages.push(p);
      }
    }

    // Extract all terms
    let allTerms: Array<{ term: string; definition: string; context: string; bookId: string; pageNumber: number }> = [];
    for (const page of pages) {
      const terms = extractTerms(page.translation?.data || '');
      for (const t of terms) {
        allTerms.push({
          ...t,
          bookId: page.book_id,
          pageNumber: page.page_number,
        });
      }
    }

    // Deduplicate by term (keep first occurrence)
    const seen = new Set<string>();
    allTerms = allTerms.filter(t => {
      const key = t.term.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Shuffle
    for (let i = allTerms.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [allTerms[i], allTerms[j]] = [allTerms[j], allTerms[i]];
    }

    // Take requested count
    const selected = allTerms.slice(0, count);

    // Enrich with book metadata
    const bookIds = [...new Set(selected.map(t => t.bookId))];
    const books = await db.collection('books')
      .find({ id: { $in: bookIds } })
      .project({ id: 1, title: 1, author: 1, date: 1, language: 1, slug: 1 })
      .toArray();
    const bookMap = new Map(books.map(b => [b.id as string, b]));

    // Filter by language if requested
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let enriched: TermEntry[] = selected.map(t => {
      const book: any = bookMap.get(t.bookId) || {};
      return {
        term: t.term,
        definition: t.definition,
        originalContext: t.context,
        bookId: t.bookId,
        bookTitle: book.title || 'Unknown',
        bookAuthor: book.author || 'Unknown',
        bookDate: book.date,
        bookLanguage: book.language,
        pageNumber: t.pageNumber,
        slug: book.slug,
      };
    });

    if (language) {
      enriched = enriched.filter(t => t.bookLanguage?.toLowerCase() === language.toLowerCase());
    }

    // Generate wrong answers from other terms' definitions (for multiple choice)
    const allDefinitions = allTerms.map(t => t.definition);

    const questions = enriched.map(entry => {
      // Pick 3 random wrong answers from other definitions
      const wrongs: string[] = [];
      const shuffledDefs = [...allDefinitions].sort(() => Math.random() - 0.5);
      for (const d of shuffledDefs) {
        if (d !== entry.definition && wrongs.length < 3) {
          wrongs.push(d);
        }
      }

      // Shuffle options
      const options = [entry.definition, ...wrongs].sort(() => Math.random() - 0.5);
      const correctIndex = options.indexOf(entry.definition);

      return {
        ...entry,
        options,
        correctIndex,
      };
    });

    return NextResponse.json({
      terms: questions,
      total: allTerms.length,
    });
  } catch (error) {
    console.error('Learn API error:', error);
    return NextResponse.json({ error: 'Failed to fetch terms' }, { status: 500 });
  }
}
