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

    // Get surrounding context (sentence containing the term), stripping the definition
    // so the context doesn't give away the answer
    const termIdx = translationText.indexOf(match[0]);
    const contextStart = Math.max(0, translationText.lastIndexOf('.', termIdx) + 1);
    const contextEnd = translationText.indexOf('.', termIdx + match[0].length);
    let context = translationText
      .slice(contextStart, contextEnd > 0 ? contextEnd + 1 : contextStart + 200)
      .replace(/<[^>]+>[^<]*<\/[^>]+>/g, '') // strip tag pairs and their content (definitions)
      .replace(/<[^>]+>/g, '') // strip remaining tags
      .replace(/\s{2,}/g, ' ')
      .trim()
      .substring(0, 200);
    // If the definition text still appears in context, redact it
    if (definition.length > 10 && context.toLowerCase().includes(definition.toLowerCase().substring(0, 30))) {
      context = context.replace(new RegExp(definition.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').substring(0, 40), 'i'), '...');
    }

    results.push({ term, definition, context });
  }

  return results;
}

// Topics map to collection slugs in the database
const TOPICS: Record<string, { label: string; description: string; collections: string[] }> = {
  alchemy: {
    label: 'Alchemy',
    description: 'The art of transformation — prima materia, the philosopher\'s stone, and the Great Work',
    collections: ['alchemy', 'alchemical-emblems'],
  },
  hermetica: {
    label: 'Hermetica',
    description: 'The teachings of Hermes Trismegistus and the Hermetic tradition',
    collections: ['hermetica', 'neoplatonism'],
  },
  kabbalah: {
    label: 'Kabbalah',
    description: 'Jewish mystical tradition — the sefirot, the Tree of Life, and divine emanation',
    collections: ['kabbalah', 'christian-kabbalah'],
  },
  astrology: {
    label: 'Astrology & Astronomy',
    description: 'Celestial influences, planetary spheres, and the music of the heavens',
    collections: ['astrology', 'astronomy'],
  },
  magic: {
    label: 'Magic & Divination',
    description: 'Natural magic, ceremonial practice, and the hidden forces of nature',
    collections: ['magic', 'divination', 'natural-magic'],
  },
  medicine: {
    label: 'Medicine & Natural Philosophy',
    description: 'Humors, signatures, Paracelsian medicine, and the book of nature',
    collections: ['medicine', 'natural-philosophy', 'paracelsus'],
  },
  philosophy: {
    label: 'Philosophy',
    description: 'Neoplatonism, Aristotelian thought, Renaissance humanism',
    collections: ['philosophy', 'neoplatonism', 'renaissance-philosophy'],
  },
  rosicrucianism: {
    label: 'Rosicrucianism',
    description: 'The Rosicrucian manifestos and the invisible brotherhood',
    collections: ['rosicrucianism', 'freemasonry'],
  },
};

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const count = Math.min(parseInt(searchParams.get('count') || '10'), 50);
    const language = searchParams.get('language');
    const topic = searchParams.get('topic');

    // If no topic specified and no count, return available topics
    if (searchParams.get('topics') === 'true') {
      return NextResponse.json({ topics: Object.entries(TOPICS).map(([id, t]) => ({ id, ...t })) });
    }

    const db = await getReadDb();

    // If topic specified, first get book IDs from that collection
    let topicBookIds: string[] | null = null;
    if (topic && TOPICS[topic]) {
      const collSlugs = TOPICS[topic].collections;
      const collections = await db.collection('collections')
        .find({ slug: { $in: collSlugs } })
        .project({ 'books': 1 })
        .toArray();
      topicBookIds = collections.flatMap(c => (c.books || []).map((b: { book_id?: string }) => b.book_id)).filter(Boolean);
      if (!topicBookIds.length) {
        return NextResponse.json({ terms: [], total: 0 });
      }
    }

    // Build query — find pages with <term> tags that also have adjacent <note> or <gloss>
    const query: Record<string, unknown> = {
      'translation.data': { $regex: '<term>.*?</term>\\s*<(?:note|gloss)>' },
    };
    if (topicBookIds) {
      query.book_id = { $in: topicBookIds };
    }

    // Get pages — we'll fetch more than needed since not all terms parse cleanly
    const pages = await db.collection('pages')
      .find(query)
      .project({ book_id: 1, page_number: 1, 'translation.data': 1 })
      .limit(count * 5)
      .maxTimeMS(10000)
      .toArray();

    // Also try pages with inline definitions (term; definition pattern)
    if (pages.length < count * 3) {
      const inlineQuery: Record<string, unknown> = {
        'translation.data': { $regex: '<term>[^<]*[:;][^<]*</term>' },
      };
      if (topicBookIds) {
        inlineQuery.book_id = { $in: topicBookIds };
      }
      const inlinePages = await db.collection('pages')
        .find(inlineQuery)
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
