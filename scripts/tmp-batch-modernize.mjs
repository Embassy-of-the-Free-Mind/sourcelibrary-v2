#!/usr/bin/env node
/**
 * Chapter-level batch modernization for Source Library.
 *
 * Processes multiple pages at once with a full book outline for context,
 * producing better cross-page continuity than page-by-page modernization.
 *
 * Usage:
 *   node scripts/tmp-batch-modernize.mjs BOOK_ID [options]
 *
 * Options:
 *   --chapter N      Process only chapter at index N
 *   --from N --to M  Process only pages N through M
 *   --dry-run        Build and print outline + prompt without calling Gemini
 *   --chunk-size N   Max pages per Gemini call (default: 15)
 *
 * Run:
 *   set -a; source .env.production.local; set +a; node scripts/tmp-batch-modernize.mjs BOOK_ID
 */

import { MongoClient } from 'mongodb';
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';

// ── Config ──────────────────────────────────────────────────────────────────

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) throw new Error('MONGODB_URI not set');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set');

const MODEL = 'gemini-3-flash-preview';
const MAX_CHUNK_SIZE = 15;

const SAFETY_SETTINGS = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_CIVIC_INTEGRITY, threshold: HarmBlockThreshold.BLOCK_NONE },
];

// Model pricing per 1M tokens (USD)
const MODEL_PRICING = {
  'gemini-3-flash-preview': { input: 0.50, output: 3.00 },
};

const MODERNIZATION_PROMPT = `You are an editor turning a scholarly translation of a pre-modern text into clear, compelling modern prose — the kind you'd find in a well-edited trade paperback or hear in a quality podcast.

**Your reader:** An intelligent person with no specialist knowledge. They should be able to read this aloud naturally.

**Core rules:**
1. **Short, direct sentences.** Split Latinate periods into 1-2 clause sentences. No sentence longer than 25 words unless quoting.
2. **Modern vocabulary.** "Wherefore" → so/therefore. "Lest" → in case. "It is not easy to describe how" → "You can't imagine how." "Most honest men" → "genuinely honest people."
3. **Active voice.** "A banquet was prepared by the king" → "The king prepared a banquet."
4. **Paragraph breaks every 3-5 sentences.** The original has none. Create logical groupings.
5. **Section headers** — Add a brief editorial line before major topic shifts, wrapped in XML: <section-intro>Leo describes the food and customs of the mountain people</section-intro> or <section-intro>A night encounter with bandits on the Atlas</section-intro>. These are your editorial additions and will be styled separately from the author's text.
6. **Cut formulaic Latin filler:** Remove "wherefore," "the aforementioned," "as we have already said," "it is incredible to relate," "which I believe happened for this reason," and similar throat-clearing. Just say what happened.
7. **Preserve every fact, name, date, and detail.** Never summarize or skip content. Change HOW things are said, not WHAT is said.
8. **Preserve the author's voice** — humor, irony, asides, opinions, first-person moments. These are the best parts. Make them shine, don't flatten them.
9. **Read-aloud test:** Every sentence should sound natural if spoken aloud. Avoid nested subordinate clauses, double negatives, and inverted word order.

**Cross-page continuity:**
- Your text MUST flow seamlessly across [PAGE N] markers. If a thought spans two pages, continue it naturally across the marker.
- Match tone and style consistently throughout.

**What to remove:**
- Redundant transitions: "Wherefore," "Moreover," "Furthermore," "Now," "Indeed"
- Formulaic qualifiers: "a certain," "of that kind," "as has already been said"
- Latinate padding: "it is not to be doubted that," "one could hardly believe," "it is incredible to say how"
- Passive constructions where active is clearer

**What to keep/enhance:**
- Specific details (numbers, distances, prices, names)
- Direct speech and dialogue
- Personal observations ("I remember," "I saw," "I was there when")
- Humor and irony
- Cultural details and customs

**Format:** Clean prose with paragraph breaks and occasional <section-intro> headers at major topic shifts. Do NOT add new markdown headings, but DO preserve original document structure: book titles, author names, chapter headings, and section titles from the source text should be kept as markdown headings (# ## ###) exactly as they appear in the input.

**IMPORTANT:** If the translation has <note>...</note>, <term>...</term>, or other XML/bracket tags, incorporate that information naturally into the text rather than preserving the markup. Remove all tags from output except <section-intro>.`;

// ── Helpers ─────────────────────────────────────────────────────────────────

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return hash.toString(16);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { bookId: null, chapter: null, from: null, to: null, dryRun: false, chunkSize: MAX_CHUNK_SIZE };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--chapter') { opts.chapter = parseInt(args[++i], 10); }
    else if (arg === '--from') { opts.from = parseInt(args[++i], 10); }
    else if (arg === '--to') { opts.to = parseInt(args[++i], 10); }
    else if (arg === '--dry-run') { opts.dryRun = true; }
    else if (arg === '--chunk-size') { opts.chunkSize = parseInt(args[++i], 10); }
    else if (!arg.startsWith('--') && !opts.bookId) { opts.bookId = arg; }
  }

  if (!opts.bookId) {
    console.error('Usage: node scripts/tmp-batch-modernize.mjs BOOK_ID [--chapter N] [--from N --to M] [--dry-run]');
    process.exit(1);
  }

  return opts;
}

function calculateCost(inputTokens, outputTokens) {
  const pricing = MODEL_PRICING[MODEL] || { input: 0.10, output: 0.40 };
  return (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output;
}

/**
 * Build chapter-organized outline from book chapters + page summaries.
 * Marks pages in the current chunk with ► YOU ARE HERE.
 */
function buildOutline(chapters, allPages, currentChunkPageNumbers) {
  const currentSet = new Set(currentChunkPageNumbers);
  let outline = '';

  if (!chapters || chapters.length === 0) {
    // No chapters — just list pages by number
    for (const p of allPages) {
      if (!p.translation_summary) continue;
      const marker = currentSet.has(p.page_number) ? ' ► YOU ARE HERE' : '';
      outline += `  p.${p.page_number}: ${p.translation_summary}${marker}\n`;
    }
    return outline;
  }

  for (let ci = 0; ci < chapters.length; ci++) {
    const ch = chapters[ci];
    const title = ch.titleEn || ch.title || `Chapter ${ci + 1}`;
    const startPage = ch.pageNumber || ch.page_number || 0;
    const endPage = ch.endPage || ch.end_page || startPage;
    outline += `\n${title} (pages ${startPage}-${endPage})\n`;

    // Find pages in this chapter range
    const chapterPages = allPages.filter(p => p.page_number >= startPage && p.page_number <= endPage);
    for (const p of chapterPages) {
      if (!p.translation_summary) continue;
      const marker = currentSet.has(p.page_number) ? ' ► YOU ARE HERE' : '';
      outline += `  p.${p.page_number}: ${p.translation_summary}${marker}\n`;
    }
  }

  return outline;
}

/**
 * Build the full prompt for a batch of pages.
 */
function buildPrompt(outline, pages) {
  let prompt = MODERNIZATION_PROMPT;

  prompt += `\n\n## BOOK OUTLINE\n(This shows where the current pages fit in the overall work. Use it to understand narrative context, but only modernize the pages marked below.)\n`;
  prompt += outline;

  prompt += `\n\n## PAGES TO MODERNIZE\nModernize the following pages into flowing modern prose. Keep [PAGE N] markers exactly where they appear — they mark page boundaries. Your modernized text between each marker will be saved as that page's modern version.\n\nCRITICAL: Preserve every [PAGE N] marker exactly. Do not skip, merge, or renumber them.\n`;

  for (const page of pages) {
    prompt += `\n[PAGE ${page.page_number}]\n${page.translation.data}\n`;
  }

  return prompt;
}

/**
 * Parse Gemini output into per-page modernized text.
 * Returns a Map of page_number → text.
 */
function parseOutput(output, expectedPageNumbers) {
  const result = new Map();
  const pattern = /\[PAGE\s+(\d+)\]/g;
  const markers = [];

  let match;
  while ((match = pattern.exec(output)) !== null) {
    markers.push({ pageNum: parseInt(match[1], 10), index: match.index, matchLength: match[0].length });
  }

  if (markers.length === 0) {
    console.warn('  ⚠ No [PAGE N] markers found in output! Assigning entire output to first page.');
    if (expectedPageNumbers.length > 0) {
      result.set(expectedPageNumbers[0], output.trim());
    }
    return result;
  }

  for (let i = 0; i < markers.length; i++) {
    const start = markers[i].index + markers[i].matchLength;
    const end = i + 1 < markers.length ? markers[i + 1].index : output.length;
    const text = output.substring(start, end).trim();
    result.set(markers[i].pageNum, text);
  }

  // Check for missing pages
  for (const pn of expectedPageNumbers) {
    if (!result.has(pn)) {
      console.warn(`  ⚠ Page ${pn} missing from output!`);
    }
  }

  return result;
}

/**
 * Split pages into chunks of at most chunkSize.
 */
function chunkPages(pages, chunkSize) {
  const chunks = [];
  for (let i = 0; i < pages.length; i += chunkSize) {
    chunks.push(pages.slice(i, i + chunkSize));
  }
  return chunks;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();
  const startTime = Date.now();

  console.log(`\n📖 Batch Modernization`);
  console.log(`   Book: ${opts.bookId}`);
  console.log(`   Mode: ${opts.dryRun ? 'DRY RUN' : 'LIVE'}`);
  if (opts.from != null) console.log(`   Pages: ${opts.from}-${opts.to}`);
  if (opts.chapter != null) console.log(`   Chapter: ${opts.chapter}`);
  console.log();

  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  try {
    // 1. Load book
    const book = await db.collection('books').findOne({
      $or: [{ id: opts.bookId }, { _id: opts.bookId }]
    });
    if (!book) { console.error('Book not found'); process.exit(1); }
    console.log(`   Title: ${book.title}`);
    console.log(`   Chapters: ${book.chapters?.length || 0}`);

    // 2. Load all pages with summaries (for outline)
    const allPages = await db.collection('pages').find(
      { book_id: book.id || book._id },
      { projection: { page_number: 1, translation_summary: 1, id: 1 } }
    ).sort({ page_number: 1 }).toArray();
    console.log(`   Total pages with summaries: ${allPages.filter(p => p.translation_summary).length}/${allPages.length}`);

    // 3. Determine which pages to process
    let pageFilter = { book_id: book.id || book._id, 'translation.data': { $exists: true, $ne: '' } };

    if (opts.from != null && opts.to != null) {
      pageFilter.page_number = { $gte: opts.from, $lte: opts.to };
    } else if (opts.chapter != null && book.chapters?.length > opts.chapter) {
      const ch = book.chapters[opts.chapter];
      const startPage = ch.pageNumber || ch.page_number;
      const endPage = ch.endPage || ch.end_page || startPage;
      pageFilter.page_number = { $gte: startPage, $lte: endPage };
      console.log(`   Chapter "${ch.titleEn || ch.title}": pages ${startPage}-${endPage}`);
    }

    const pagesToProcess = await db.collection('pages').find(
      pageFilter,
      { projection: { page_number: 1, 'translation.data': 1, id: 1, _id: 1 } }
    ).sort({ page_number: 1 }).toArray();

    console.log(`   Pages to modernize: ${pagesToProcess.length}`);
    if (pagesToProcess.length === 0) {
      console.log('   No pages with translations found in range. Exiting.');
      return;
    }

    const totalWords = pagesToProcess.reduce((sum, p) => sum + (p.translation?.data?.split(/\s+/).length || 0), 0);
    console.log(`   Total translation words: ${totalWords.toLocaleString()}`);

    // 4. Chunk pages
    const chunks = chunkPages(pagesToProcess, opts.chunkSize);
    console.log(`   Chunks: ${chunks.length} (max ${opts.chunkSize} pages each)\n`);

    // 5. Initialize Gemini
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({
      model: MODEL,
      safetySettings: SAFETY_SETTINGS,
    });

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCost = 0;
    let pagesModernized = 0;

    // 6. Process each chunk
    for (let ci = 0; ci < chunks.length; ci++) {
      const chunk = chunks[ci];
      const pageNumbers = chunk.map(p => p.page_number);
      const chunkWords = chunk.reduce((sum, p) => sum + (p.translation?.data?.split(/\s+/).length || 0), 0);

      console.log(`── Chunk ${ci + 1}/${chunks.length}: pages ${pageNumbers[0]}-${pageNumbers[pageNumbers.length - 1]} (${chunk.length} pages, ${chunkWords.toLocaleString()} words) ──`);

      // Build outline with current chunk marked
      const outline = buildOutline(book.chapters, allPages, pageNumbers);

      // Build full prompt
      const prompt = buildPrompt(outline, chunk);

      if (opts.dryRun) {
        console.log('\n--- PROMPT (first 3000 chars) ---');
        console.log(prompt.substring(0, 3000));
        console.log(`\n--- END (total ${prompt.length} chars) ---\n`);
        continue;
      }

      // Call Gemini
      const t0 = Date.now();
      let result;
      try {
        result = await model.generateContent(prompt);
      } catch (err) {
        console.error(`  ERROR calling Gemini: ${err.message}`);
        console.error(`  Skipping chunk ${ci + 1}. Continuing...`);
        continue;
      }
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

      const usageMetadata = result.response.usageMetadata;
      const inputTokens = usageMetadata?.promptTokenCount || 0;
      const outputTokens = usageMetadata?.candidatesTokenCount || 0;
      const cost = calculateCost(inputTokens, outputTokens);

      totalInputTokens += inputTokens;
      totalOutputTokens += outputTokens;
      totalCost += cost;

      console.log(`  Gemini: ${inputTokens.toLocaleString()} in / ${outputTokens.toLocaleString()} out | $${cost.toFixed(4)} | ${elapsed}s`);

      // Parse output
      const outputText = result.response.text();
      const parsed = parseOutput(outputText, pageNumbers);
      console.log(`  Parsed: ${parsed.size}/${chunk.length} pages`);

      // Save each page
      const missingPages = [];
      for (const page of chunk) {
        const modernizedText = parsed.get(page.page_number);
        if (!modernizedText) {
          missingPages.push(page);
          continue;
        }

        await db.collection('pages').updateOne(
          { _id: page._id },
          { $set: {
            'modernized.data': modernizedText,
            'modernized.model': MODEL,
            'modernized.updated_at': new Date(),
            'modernized.source_translation_hash': hashString(page.translation.data),
          }}
        );

        pagesModernized++;
        const wordCount = modernizedText.split(/\s+/).length;
        console.log(`  ✓ Page ${page.page_number}: ${wordCount} words | "${modernizedText.substring(0, 80)}..."`);
      }

      // Retry missing pages individually
      for (const page of missingPages) {
        console.log(`  ↻ Retrying page ${page.page_number} individually...`);
        const retryPrompt = MODERNIZATION_PROMPT + `\n\n**Text to modernize:**\n${page.translation.data}`;
        try {
          const t1 = Date.now();
          const retryResult = await model.generateContent(retryPrompt);
          const retryElapsed = ((Date.now() - t1) / 1000).toFixed(1);
          const retryUsage = retryResult.response.usageMetadata;
          const rIn = retryUsage?.promptTokenCount || 0;
          const rOut = retryUsage?.candidatesTokenCount || 0;
          totalInputTokens += rIn;
          totalOutputTokens += rOut;
          totalCost += calculateCost(rIn, rOut);

          const retryText = retryResult.response.text();
          await db.collection('pages').updateOne(
            { _id: page._id },
            { $set: {
              'modernized.data': retryText,
              'modernized.model': MODEL,
              'modernized.updated_at': new Date(),
              'modernized.source_translation_hash': hashString(page.translation.data),
            }}
          );
          pagesModernized++;
          console.log(`  ✓ Page ${page.page_number} (retry): ${retryText.split(/\s+/).length} words | ${retryElapsed}s`);
        } catch (err) {
          console.error(`  ✗ Page ${page.page_number} retry failed: ${err.message}`);
        }
      }

      console.log();
    }

    // Summary
    const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n════════════════════════════════════════`);
    console.log(`  ${opts.dryRun ? 'DRY RUN' : 'COMPLETE'}`);
    console.log(`  Pages modernized: ${pagesModernized}`);
    console.log(`  Total tokens: ${totalInputTokens.toLocaleString()} in / ${totalOutputTokens.toLocaleString()} out`);
    console.log(`  Total cost: $${totalCost.toFixed(4)}`);
    console.log(`  Total time: ${totalElapsed}s`);
    console.log(`════════════════════════════════════════\n`);

  } finally {
    await client.close();
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
