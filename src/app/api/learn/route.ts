import { NextRequest, NextResponse } from 'next/server';
import { getReadDb } from '@/lib/mongodb';
import { getTenantContextFromRequest } from '@/lib/tenant-context';

export const maxDuration = 15;
export const dynamic = 'force-dynamic';

// ── Types ──

interface QuestionBase {
  mode: string;
  bookId: string;
  bookTitle: string;
  bookAuthor: string;
  bookDate?: string | number;
  bookLanguage?: string;
  pageNumber: number;
  slug?: string;
  options: string[];
  correctIndex: number;
}

interface VocabQuestion extends QuestionBase {
  mode: 'vocab';
  term: string;
  definition: string;
  originalContext?: string;
}

interface DateQuestion extends QuestionBase {
  mode: 'date';
  passage: string;
}

interface AuthorQuestion extends QuestionBase {
  mode: 'author';
  passage: string;
}

interface TraditionQuestion extends QuestionBase {
  mode: 'tradition';
  passage: string;
  collection: string;
}

type Question = VocabQuestion | DateQuestion | AuthorQuestion | TraditionQuestion;

// ── Topics ──

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

// ── Helpers ──

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Pick n random items from arr, excluding items matching `exclude` */
function pickDistractors(pool: string[], correct: string, n: number): string[] {
  const candidates = pool.filter(d => d !== correct);
  return shuffle(candidates).slice(0, n);
}

/** Pick distractors that are similar in length to the correct answer */
function pickSimilarLengthDistractors(pool: string[], correct: string, n: number): string[] {
  const correctLen = correct.length;
  const candidates = pool
    .filter(d => d !== correct)
    .map(d => ({ d, diff: Math.abs(d.length - correctLen) }))
    .sort((a, b) => a.diff - b.diff);
  // Take the top ~3x candidates by similarity, then shuffle to avoid always picking the same ones
  const topCandidates = candidates.slice(0, n * 3).map(c => c.d);
  return shuffle(topCandidates).slice(0, n);
}

function buildOptions(correct: string, distractors: string[]): { options: string[]; correctIndex: number } {
  const options = shuffle([correct, ...distractors]);
  return { options, correctIndex: options.indexOf(correct) };
}

/** Extract a readable passage from translation text (strip tags, take first ~200 chars of body) */
function extractPassage(translationText: string): string {
  // Remove metadata tags at start/end
  let text = translationText
    .replace(/<(?:meta|summary|keywords|vocab|warning|page-type|page-num|header|sig|script|language|columns|folio|abbrev)[^>]*>[\s\S]*?<\/[^>]+>/g, '')
    .replace(/<[^>]+>/g, '') // strip all remaining tags
    .replace(/\s{2,}/g, ' ')
    .trim();
  // Skip to first substantial sentence
  const sentences = text.split(/(?<=[.!?])\s+/).filter(s => s.length > 30);
  if (sentences.length === 0) return text.substring(0, 200);
  // Take 1-2 sentences
  const passage = sentences.slice(0, 2).join(' ');
  return passage.substring(0, 250);
}

/** Parse <term>...</term> tags, extracting inline definitions when present */
function extractTerms(translationText: string): Array<{ term: string; definition: string; context: string }> {
  const results: Array<{ term: string; definition: string; context: string }> = [];
  const termRegex = /<term>([\s\S]*?)<\/term>\s*(?:<(?:note|gloss)>([\s\S]*?)<\/(?:note|gloss)>)?/g;

  let match;
  while ((match = termRegex.exec(translationText)) !== null) {
    const rawTerm = match[1].trim();
    const noteOrGloss = match[2]?.trim();

    let term: string;
    let definition: string;

    const inlineSplit = rawTerm.match(/^([^:;]+?)\s*[:;]\s+([\s\S]+)$/);
    if (inlineSplit) {
      term = inlineSplit[1].trim().replace(/\*/g, '');
      definition = inlineSplit[2].trim().replace(/\*/g, '');
    } else if (noteOrGloss) {
      term = rawTerm.replace(/\*/g, '');
      definition = noteOrGloss
        .replace(/^original:\s*/i, '')
        .replace(/^["']|["']$/g, '')
        .replace(/<[^>]+>/g, '')
        .trim();
    } else {
      continue;
    }

    if (term.length > 60 || definition.length > 300) continue;
    if (term.length < 3) continue;

    // Context with definition stripped
    const termIdx = translationText.indexOf(match[0]);
    const contextStart = Math.max(0, translationText.lastIndexOf('.', termIdx) + 1);
    const contextEnd = translationText.indexOf('.', termIdx + match[0].length);
    let context = translationText
      .slice(contextStart, contextEnd > 0 ? contextEnd + 1 : contextStart + 200)
      .replace(/<[^>]+>[^<]*<\/[^>]+>/g, '')
      .replace(/<[^>]+>/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim()
      .substring(0, 200);
    if (definition.length > 10 && context.toLowerCase().includes(definition.toLowerCase().substring(0, 30))) {
      context = context.replace(new RegExp(definition.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').substring(0, 40), 'i'), '...');
    }

    results.push({ term, definition, context });
  }

  return results;
}

/** Normalize a date string or number to a decade label like "1610s" */
function dateToDecade(date?: string | number): string | null {
  if (!date) return null;
  const str = String(date);
  const m = str.match(/(\d{4})/);
  if (!m) return null;
  const year = parseInt(m[1]);
  if (year < 1000 || year > 2000) return null;
  const decade = Math.floor(year / 10) * 10;
  return `${decade}s`;
}

/** Generate plausible decade distractors near the correct one */
function decadeDistractors(correctDecade: string): string[] {
  const base = parseInt(correctDecade);
  // Pick from a range of +/- 30-100 years, skip the correct one
  const offsets = [-100, -70, -50, -30, -20, -10, 10, 20, 30, 50, 70, 100];
  const candidates = offsets
    .map(o => `${base + o}s`)
    .filter(d => {
      const y = parseInt(d);
      return y >= 1400 && y <= 1800 && d !== correctDecade;
    });
  return shuffle(candidates).slice(0, 3);
}

// ── Main handler ──

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const count = Math.min(parseInt(searchParams.get('count') || '10'), 50);
    const topic = searchParams.get('topic');
    const mode = searchParams.get('mode') || 'mixed'; // vocab, date, author, tradition, mixed
    const { id: tenantId } = getTenantContextFromRequest(request);

    if (searchParams.get('topics') === 'true') {
      return NextResponse.json({ topics: Object.entries(TOPICS).map(([id, t]) => ({ id, ...t })) });
    }

    const db = await getReadDb();

    // Resolve topic to book IDs by querying books with matching collection slugs
    let topicBookIds: string[] | null = null;
    const topicCollSlugs = topic && TOPICS[topic] ? TOPICS[topic].collections : null;
    if (topicCollSlugs) {
      const topicBooks = await db.collection('books')
        .find({ collections: { $in: topicCollSlugs }, visible: true, pages_count: { $gt: 0 }, ...(tenantId ? { tenantId } : {}) })
        .project({ id: 1 })
        .limit(500)
        .maxTimeMS(10000)
        .toArray();
      topicBookIds = topicBooks.map(b => b.id as string).filter(Boolean);
      if (!topicBookIds.length) {
        return NextResponse.json({ questions: [], total: 0 });
      }
    }

    const questions: Question[] = [];

    // ── Vocab questions ──
    if (mode === 'vocab' || mode === 'mixed') {
      const vocabCount = mode === 'mixed' ? Math.ceil(count * 0.4) : count;
      const vocabQuery: Record<string, unknown> = {
        'translation.data': { $regex: '<term>.*?</term>\\s*<(?:note|gloss)>' },
      };
      if (topicBookIds) vocabQuery.book_id = { $in: topicBookIds };      if (tenantId) vocabQuery.tenantId = tenantId;
      const pages = await db.collection('pages')
        .find(vocabQuery)
        .project({ book_id: 1, page_number: 1, 'translation.data': 1 })
        .limit(vocabCount * 5)
        .maxTimeMS(10000)
        .toArray();

      // Also inline definitions
      if (pages.length < vocabCount * 3) {
        const inlineQuery: Record<string, unknown> = {
          'translation.data': { $regex: '<term>[^<]*[:;][^<]*</term>' },
        };
        if (topicBookIds) inlineQuery.book_id = { $in: topicBookIds };
        if (tenantId) inlineQuery.tenantId = tenantId;
        const more = await db.collection('pages')
          .find(inlineQuery)
          .project({ book_id: 1, page_number: 1, 'translation.data': 1 })
          .limit(vocabCount * 5)
          .maxTimeMS(10000)
          .toArray();
        const ids = new Set(pages.map(p => p._id.toString()));
        for (const p of more) {
          if (!ids.has(p._id.toString())) pages.push(p);
        }
      }

      // Extract and deduplicate
      const seen = new Set<string>();
      let allTerms: Array<{ term: string; definition: string; context: string; bookId: string; pageNumber: number }> = [];
      for (const page of pages) {
        for (const t of extractTerms(page.translation?.data || '')) {
          const key = t.term.toLowerCase();
          if (!seen.has(key)) {
            seen.add(key);
            allTerms.push({ ...t, bookId: page.book_id, pageNumber: page.page_number });
          }
        }
      }
      allTerms = shuffle(allTerms).slice(0, vocabCount);

      // Collect all definitions for distractor pool
      const allDefs = allTerms.map(t => t.definition);

      // Enrich with book metadata
      const bookIds = [...new Set(allTerms.map(t => t.bookId))];
      const books = await db.collection('books')
        .find({ id: { $in: bookIds } })
        .project({ id: 1, title: 1, author: 1, published: 1, year: 1, language: 1, slug: 1 })
        .toArray();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bookMap = new Map(books.map((b: any) => [b.id, b]));

      for (const t of allTerms) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const book: any = bookMap.get(t.bookId) || {};
        const distractors = pickSimilarLengthDistractors(allDefs, t.definition, 3);
        if (distractors.length < 2) continue; // need at least 2 wrong answers
        const { options, correctIndex } = buildOptions(t.definition, distractors);
        questions.push({
          mode: 'vocab',
          term: t.term,
          definition: t.definition,
          originalContext: t.context,
          bookId: t.bookId,
          bookTitle: book.title || 'Unknown',
          bookAuthor: book.author || 'Unknown',
          bookDate: book.published || book.year,
          bookLanguage: book.language,
          pageNumber: t.pageNumber,
          slug: book.slug,
          options,
          correctIndex,
        });
      }
    }

    // ── Date, Author, Tradition questions ── (need translated pages with book metadata)
    if (mode === 'date' || mode === 'author' || mode === 'tradition' || mode === 'mixed') {
      const needDate = mode === 'date' || mode === 'mixed';
      const needAuthor = mode === 'author' || mode === 'mixed';
      const needTradition = mode === 'tradition' || mode === 'mixed';

      const dateCount = mode === 'mixed' ? Math.ceil(count * 0.2) : count;
      const authorCount = mode === 'mixed' ? Math.ceil(count * 0.2) : count;
      const traditionCount = mode === 'mixed' ? Math.ceil(count * 0.2) : count;
      const totalNeeded = (needDate ? dateCount : 0) + (needAuthor ? authorCount : 0) + (needTradition ? traditionCount : 0);

      // Get books with translations for these modes
      const bookQuery: Record<string, unknown> = {
        pages_translated: { $gt: 10 },
        visible: true,
        pages_count: { $gt: 0 },
      };
      if (topicBookIds) bookQuery.id = { $in: topicBookIds };
      if (tenantId) bookQuery.tenantId = tenantId;

      const candidateBooks = await db.collection('books')
        .find(bookQuery)
        .project({ id: 1, title: 1, author: 1, published: 1, year: 1, language: 1, slug: 1, collections: 1 })
        .limit(totalNeeded * 4)
        .maxTimeMS(10000)
        .toArray();

      if (candidateBooks.length > 0) {
        const shuffledBooks = shuffle(candidateBooks);

        // Collect pools for distractors
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const allAuthors = [...new Set(candidateBooks.map((b: any) => b.author).filter(Boolean))] as string[];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const allDecades = [...new Set(candidateBooks.map((b: any) => dateToDecade(b.published || b.year)).filter(Boolean))] as string[];

        // Get collection labels for tradition mode
        let collectionLabelMap = new Map<string, string>();
        if (needTradition) {
          const allCollections = await db.collection('collections')
            .find({})
            .project({ slug: 1, title: 1 })
            .limit(200)
            .maxTimeMS(5000)
            .toArray();
          collectionLabelMap = new Map(allCollections.map(c => [c.slug, c.name]));
        }

        // For each candidate book, get a page with translation for the passage
        let dateQs = 0, authorQs = 0, traditionQs = 0;

        for (const book of shuffledBooks) {
          if (questions.length >= count) break;

          // Determine which mode to use for this book
          let bookMode: 'date' | 'author' | 'tradition' | null = null;
          if (needDate && dateQs < dateCount && dateToDecade(book.published || book.year)) {
            bookMode = 'date';
          } else if (needAuthor && authorQs < authorCount && book.author && allAuthors.length >= 4) {
            bookMode = 'author';
          } else if (needTradition && traditionQs < traditionCount && book.collections?.length > 0) {
            bookMode = 'tradition';
          }
          if (!bookMode) continue;

          // Get a page with translation text
          const page = await db.collection('pages').findOne(
            { book_id: book.id, 'translation.data': { $exists: true, $ne: '' }, page_number: { $gt: 3 } },
            { projection: { page_number: 1, 'translation.data': 1 } },
          );
          if (!page?.translation?.data) continue;

          const passage = extractPassage(page.translation.data);
          if (passage.length < 50) continue;

          const base = {
            bookId: book.id,
            bookTitle: book.title || 'Unknown',
            bookAuthor: book.author || 'Unknown',
            bookDate: book.published || book.year,
            bookLanguage: book.language,
            pageNumber: page.page_number,
            slug: book.slug,
          };

          if (bookMode === 'date') {
            const correctDecade = dateToDecade(book.published || book.year)!;
            // Prefer nearby decades from actual books, fall back to generated
            const bookDecadeDistractors = pickDistractors(allDecades, correctDecade, 3);
            const distractors = bookDecadeDistractors.length >= 3
              ? bookDecadeDistractors
              : [...bookDecadeDistractors, ...decadeDistractors(correctDecade)].slice(0, 3);
            if (distractors.length < 3) continue;
            const { options, correctIndex } = buildOptions(correctDecade, distractors);
            questions.push({ mode: 'date', passage, ...base, options, correctIndex });
            dateQs++;
          } else if (bookMode === 'author') {
            const distractors = pickDistractors(allAuthors, book.author, 3);
            if (distractors.length < 3) continue;
            const { options, correctIndex } = buildOptions(book.author, distractors);
            questions.push({ mode: 'author', passage, ...base, options, correctIndex });
            authorQs++;
          } else if (bookMode === 'tradition') {
            // Use first collection as the "tradition"
            const collSlug = book.collections[0];
            const collLabel = collectionLabelMap.get(collSlug) || collSlug;
            const allLabels = [...collectionLabelMap.values()];
            const distractors = pickDistractors(allLabels, collLabel, 3);
            if (distractors.length < 3) continue;
            const { options, correctIndex } = buildOptions(collLabel, distractors);
            questions.push({ mode: 'tradition', passage, collection: collLabel, ...base, options, correctIndex });
            traditionQs++;
          }
        }
      }
    }

    // Final shuffle and trim
    const finalQuestions = shuffle(questions).slice(0, count);

    return NextResponse.json({
      questions: finalQuestions,
      total: finalQuestions.length,
    });
  } catch (error) {
    console.error('Learn API error:', error);
    return NextResponse.json({ error: 'Failed to fetch questions' }, { status: 500 });
  }
}
