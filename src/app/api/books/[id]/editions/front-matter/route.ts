import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { Book, Page, TranslationEdition } from '@/lib/types';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { withAuth } from '@/lib/auth-helpers';

interface RouteContext {
  params: Promise<{ id: string }>;
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

// POST /api/books/[id]/editions/front-matter - Generate front matter for an edition
export const POST = withAuth(async (request, session, context) => {
  try {
    const { id: bookId } = await context.params;
    const body = await request.json();
    const { edition_id, regenerate = false } = body as { edition_id?: string; regenerate?: boolean };

    const db = await getDb();

    // Get book with full details
    const book = await db.collection('books').findOne({ id: bookId }) as unknown as Book | null;
    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    // Merge full index from dedicated collection
    const indexDoc = await db.collection('book_indexes').findOne(
      { book_id: bookId },
      { projection: { _id: 0, book_id: 0 }, maxTimeMS: 5000 }
    ).catch(() => null);
    if (indexDoc) {
      (book as any).index = { ...(book as any).index, ...indexDoc };
    }

    // Get pages for context — only fields needed for front matter generation
    const pages = await db.collection('pages')
      .find(
        { book_id: bookId },
        { projection: { page_number: 1, summary: 1, 'translation.model': 1, 'translation.prompt_name': 1, 'ocr.model': 1, 'ocr.prompt_name': 1 } }
      )
      .sort({ page_number: 1 })
      .toArray() as unknown as Page[];

    // Find edition if specified, otherwise use current
    let edition: TranslationEdition | undefined;
    if (edition_id) {
      edition = (book.editions as TranslationEdition[] | undefined)?.find(e => e.id === edition_id);
    } else {
      edition = (book.editions as TranslationEdition[] | undefined)?.find(e => e.status === 'published');
    }

    // Check if front matter already exists and regenerate not requested
    if (edition?.front_matter?.introduction && !regenerate) {
      return NextResponse.json({
        success: true,
        front_matter: edition.front_matter,
        cached: true,
      });
    }

    // Gather context for AI generation
    const bookContext = buildBookContext(book, pages);

    // Generate introduction and methodology in parallel
    const model = genAI.getGenerativeModel({ model: 'gemini-3-flash-preview' });

    const [introResult, methodResult] = await Promise.all([
      generateIntroduction(model, book, bookContext),
      generateMethodology(model, book, pages),
    ]);

    const frontMatter = {
      introduction: introResult,
      methodology: methodResult,
      generated_at: new Date(),
      generated_by: 'gemini-3-flash-preview',
    };

    // Save to edition if one exists
    if (edition) {
      const editions = (book.editions as TranslationEdition[]).map(e =>
        e.id === edition!.id ? { ...e, front_matter: frontMatter } : e
      );
      await db.collection('books').updateOne(
        { id: bookId },
        { $set: { editions, updated_at: new Date() } }
      );
    }

    return NextResponse.json({
      success: true,
      front_matter: frontMatter,
      cached: false,
    });
  } catch (error) {
    console.error('Error generating front matter:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate front matter' },
      { status: 500 }
    );
  }
});

function buildBookContext(book: Book, pages: Page[]): string {
  const parts: string[] = [];
  const bookAny = book as any;

  // Bibliographic facts
  parts.push('=== BIBLIOGRAPHIC DATA (verified from title page) ===');
  parts.push(`Title: ${book.title}`);
  if (book.display_title) parts.push(`English Title: ${book.display_title}`);
  parts.push(`Author: ${book.author}`);
  parts.push(`Language: ${book.language}`);
  parts.push(`Published: ${book.published}`);
  if (book.place_published) parts.push(`Place of publication: ${book.place_published}`);
  if (book.publisher) parts.push(`Printer/Publisher: ${book.publisher}`);
  if (book.ustc_id) parts.push(`USTC catalog number: ${book.ustc_id}`);
  if (bookAny.is_first_translation) parts.push('NOTE: This is believed to be the FIRST English translation of this work.');
  if (bookAny.ia_identifier) parts.push(`Source scan: Internet Archive (${bookAny.ia_identifier})`);

  // Categories / tradition
  if (bookAny.categories?.length) {
    parts.push(`\nTradition/categories: ${bookAny.categories.join(', ')}`);
  }

  // AI-generated summary
  const bookIndex = book as unknown as { index?: { bookSummary?: { detailed?: string; abstract?: string }; people?: { term: string }[]; concepts?: { term: string }[] } };
  if (bookIndex.index?.bookSummary?.detailed) {
    parts.push(`\n=== BOOK SUMMARY (AI-generated from the translation) ===\n${bookIndex.index.bookSummary.detailed}`);
  } else if (bookIndex.index?.bookSummary?.abstract) {
    parts.push(`\n=== BOOK SUMMARY (AI-generated from the translation) ===\n${bookIndex.index.bookSummary.abstract}`);
  }

  // Chapter structure
  if (bookAny.chapters?.length) {
    const chapterList = bookAny.chapters
      .filter((c: any) => c.confidence === 'high')
      .slice(0, 15)
      .map((c: any) => `  p.${c.pageNumber}: ${c.titleEn || c.title}`)
      .join('\n');
    parts.push(`\n=== TABLE OF CONTENTS ===\n${chapterList}`);
  }

  // Key figures and concepts from the index
  if (bookIndex.index?.people) {
    parts.push(`\nKey people mentioned: ${bookIndex.index.people.slice(0, 15).map(p => p.term).join(', ')}`);
  }
  if (bookIndex.index?.concepts) {
    parts.push(`Key concepts: ${bookIndex.index.concepts.slice(0, 15).map(c => c.term).join(', ')}`);
  }

  // Sample page summaries
  const samplePages = [...pages.slice(0, 5), ...pages.slice(-3)];
  const summaries = samplePages
    .filter(p => p.summary?.data)
    .map(p => `  Page ${p.page_number}: ${p.summary!.data.slice(0, 200)}`);
  if (summaries.length > 0) {
    parts.push(`\n=== SAMPLE PAGE SUMMARIES ===\n${summaries.join('\n')}`);
  }

  return parts.join('\n');
}

async function generateIntroduction(
  model: ReturnType<typeof genAI.getGenerativeModel>,
  book: Book,
  context: string
): Promise<string> {
  const prompt = `You are writing the introduction for a scholarly digital edition published by Source Library, a project of the Embassy of the Free Mind in Amsterdam — one of the world's foremost collections of Hermetic, alchemical, Kabbalistic, and early modern philosophical texts.

Source Library's mission is to make these texts readable for the first time in centuries by producing AI-assisted English translations of works that have never been translated, or whose only translations are rare, incomplete, or inaccessible. The collection spans the Western esoteric tradition from antiquity through the early modern period — the Corpus Hermeticum, Paracelsian medicine, Rosicrucian manifestos, Christian Kabbalah, natural philosophy, and the roots of modern science.

Write an introduction (800-1200 words) for this edition:

${context}

Structure:

## The Author and the Work
Ground this in verifiable facts. Use the bibliographic data above. If you know specific, well-documented facts about the author (birth/death dates, city of activity, patrons, documented controversies), include them. If you are uncertain about a biographical detail, omit it — do not guess. Describe what the text actually contains, drawing on the table of contents and summary provided above. Name specific chapters or sections.

## Historical Significance
This is where your knowledge of intellectual history matters. Place this work in its documented tradition — who influenced the author, who was influenced by them, what debates or movements was this text part of? Be specific: name other authors, cite known connections, reference documented events. For example, if the author corresponded with known figures, or if the work was banned, praised, or plagiarized — say so, but only if you are confident it is true.

If the work is obscure and you cannot confidently place it in a broader intellectual context, say so honestly: "This work has received limited scholarly attention" or "The author is not well documented beyond what appears on the title page."

## This Edition
This is a new English translation produced by Source Library using AI (large language models). The original ${book.language || 'source language'} text was transcribed from page scans using OCR, then translated page by page with contextual continuity. This translation has NOT been reviewed or verified by human editors. Readers should treat it as a working translation — useful for access and orientation, but not a substitute for expert scholarship. The digital edition at sourcelibrary.org allows side-by-side viewing of the original page images alongside the translation. See the Methodology section for technical details.

Rules:
- Write in clear, scholarly prose for educated general readers
- Use ## markdown headings
- NEVER use em-dashes (—). Use commas, colons, semicolons, or separate sentences.
- Do NOT use vague praise like "groundbreaking," "seminal," "masterpiece," or "profoundly influential." Let specific facts speak.
- Do NOT use AI-isms: "delves into," "rich tapestry," "fascinating exploration," "comprehensive," "intricate," "nuanced," "multifaceted," "sheds light on," "offers a window into."
- Prefer short, direct sentences over long compound ones.
- Do NOT fabricate biographical details, publication histories, or scholarly reception you are not confident about
- Do NOT claim human editorial review occurred
- Do NOT include any preamble. Start directly with the first heading.
- If you include a claim about historical influence or reception, it should be something a scholar could verify`;

  const result = await model.generateContent(prompt);
  return result.response.text();
}

async function generateMethodology(
  model: ReturnType<typeof genAI.getGenerativeModel>,
  book: Book,
  pages: Page[]
): Promise<string> {
  const models = new Set<string>();
  pages.forEach(p => {
    if (p.ocr?.model) models.add(p.ocr.model);
    if (p.translation?.model) models.add(p.translation.model);
  });

  const bookAny = book as any;
  const prompt = `Write a concise methodology section (400-600 words) for this AI-translated scholarly edition.

**Facts about how this book was produced:**
- Title: ${book.title}
- Original language: ${book.language}
- Published: ${book.published}
- Total pages processed: ${pages.length}
- AI models used: ${Array.from(models).join(', ') || 'Google Gemini'}
- Source scan: ${bookAny.ia_identifier ? `Internet Archive (${bookAny.ia_identifier})` : 'digitized page images from a European digital library'}

**The actual pipeline (describe exactly this, no more):**
1. Page images were imported from a digital library and archived
2. Each page image was processed through an AI vision model for OCR, producing a transcription in the original ${book.language || 'source'} language
3. Each page was then translated into English by a large language model, with the previous page's translation provided as context for continuity
4. After translation, AI generated a reading summary, subject index, and chapter structure
5. The edition was assembled into this PDF with front matter and apparatus

**What to include:**
- ## How This Translation Was Produced — the pipeline above, stated plainly
- ## Editorial Conventions — explain what these inline tags mean in the translation text:
  - [Note: ...] = translator's explanatory comment
  - [Margin: ...] = marginalia from the original page
  - [?...] = uncertain or unclear reading
  - Technical terms are sometimes given with original language equivalents
- ## Limitations — be direct:
  - No human has reviewed this translation
  - AI may misread damaged or faded pages
  - Technical terminology, abbreviations, and wordplay are common failure points
  - ${book.language === 'Latin' ? 'Early modern Latin spelling and abbreviations differ from classical Latin and may cause errors' : book.language === 'German' ? 'Early modern German (Frühneuhochdeutsch) differs significantly from modern German' : `Early modern ${book.language || 'source language'} orthography may cause transcription errors`}
  - This edition is versioned and assigned a DOI — future improvements will be published as new versions
  - Corrections are welcome at sourcelibrary.org

**Rules:**
- Do NOT add steps or processes that aren't listed above
- Do NOT claim human review, editorial boards, or quality assurance processes
- Do NOT pad with filler. Short and honest is better than long and vague.
- NEVER use em-dashes (—). Use commas, colons, semicolons, or separate sentences.
- Avoid AI-isms: "delves into", "comprehensive", "intricate", "nuanced", "multifaceted".
- Use ## markdown headings
- Start directly with the first heading`;

  const result = await model.generateContent(prompt);
  return result.response.text();
}
