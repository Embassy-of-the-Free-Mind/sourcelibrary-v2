/**
 * Split Detection Experiment
 *
 * Uses Gemini 3 Pro to find optimal split positions for two-page spreads.
 * Enhanced prompt asks for rich analysis to help optimize the process.
 *
 * Usage:
 *   npx tsx scripts/split-experiment.ts --list          # List unsplit books
 *   npx tsx scripts/split-experiment.ts --book-id=XXX   # Analyze one book
 *   npx tsx scripts/split-experiment.ts --sample=5      # Sample N pages across books
 *   npx tsx scripts/split-experiment.ts --page-id=XXX   # Analyze single page
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { MongoClient } from 'mongodb';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';

// ============================================================================
// CONFIGURATION
// ============================================================================

const MARGIN_PERCENT = 2; // 2% margin on each side of the split
const MODEL = 'gemini-3-flash-preview'; // Fast model with good vision

// ============================================================================
// ENHANCED PROMPT - Rich analysis for optimization
// ============================================================================

const ANALYSIS_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    // Core detection
    is_two_page_spread: {
      type: SchemaType.BOOLEAN,
      description: 'Whether this is a two-page spread (open book) vs single page'
    },
    confidence: {
      type: SchemaType.STRING,
      enum: ['high', 'medium', 'low'],
      description: 'Confidence in the detection'
    },

    // Page analysis
    page_analysis: {
      type: SchemaType.OBJECT,
      properties: {
        scan_type: {
          type: SchemaType.STRING,
          enum: ['flatbed', 'camera', 'phone', 'microfilm', 'unknown'],
          description: 'How the page appears to have been digitized'
        },
        scan_quality: {
          type: SchemaType.STRING,
          enum: ['excellent', 'good', 'fair', 'poor'],
          description: 'Quality of the scan/image'
        },
        book_binding_visible: {
          type: SchemaType.BOOLEAN,
          description: 'Whether book binding/spine is visible'
        },
        page_tilt_degrees: {
          type: SchemaType.NUMBER,
          description: 'Estimated tilt from vertical (-10 to +10 degrees, 0 is straight)'
        },
        lighting_issues: {
          type: SchemaType.STRING,
          description: 'Any lighting problems (shadows, glare, uneven)'
        }
      },
      required: ['scan_type', 'scan_quality', 'book_binding_visible', 'page_tilt_degrees']
    },

    // Proportions (key for optimization)
    proportions: {
      type: SchemaType.OBJECT,
      properties: {
        left_page_percent: {
          type: SchemaType.NUMBER,
          description: 'What percentage of image width the LEFT page occupies (0-100)'
        },
        right_page_percent: {
          type: SchemaType.NUMBER,
          description: 'What percentage of image width the RIGHT page occupies (0-100)'
        },
        gutter_width_percent: {
          type: SchemaType.NUMBER,
          description: 'Width of the gutter/gap between pages as percentage (0-20)'
        },
        left_text_margin_percent: {
          type: SchemaType.NUMBER,
          description: 'Distance from left edge to start of left page text (0-20)'
        },
        right_text_margin_percent: {
          type: SchemaType.NUMBER,
          description: 'Distance from right text to right edge (0-20)'
        }
      },
      required: ['left_page_percent', 'right_page_percent', 'gutter_width_percent']
    },

    // Gutter analysis (crucial for split position)
    gutter: {
      type: SchemaType.OBJECT,
      properties: {
        position_percent: {
          type: SchemaType.NUMBER,
          description: 'The CENTER of the gutter as percentage from left edge (0-100). This is where to split.'
        },
        appearance: {
          type: SchemaType.STRING,
          enum: ['dark_shadow', 'light_gap', 'curved', 'no_visible_gutter', 'mixed'],
          description: 'How the gutter appears visually'
        },
        text_gap_safe: {
          type: SchemaType.BOOLEAN,
          description: 'Whether there is a clear gap between left and right text columns'
        },
        safe_split_range: {
          type: SchemaType.OBJECT,
          properties: {
            min_percent: { type: SchemaType.NUMBER },
            max_percent: { type: SchemaType.NUMBER }
          },
          description: 'The safe range for splitting without cutting text (percentage)'
        },
        hazards: {
          type: SchemaType.STRING,
          description: 'Any risks at the split line (text bleeding into gutter, marginalia, etc.)'
        }
      },
      required: ['position_percent', 'appearance', 'text_gap_safe', 'safe_split_range']
    },

    // Text content analysis
    text_analysis: {
      type: SchemaType.OBJECT,
      properties: {
        left_page_has_text: { type: SchemaType.BOOLEAN },
        right_page_has_text: { type: SchemaType.BOOLEAN },
        text_language: {
          type: SchemaType.STRING,
          description: 'Primary language if identifiable (Latin, German, French, etc.)'
        },
        text_type: {
          type: SchemaType.STRING,
          enum: ['body_text', 'title_page', 'index', 'illustration', 'table', 'blank', 'mixed'],
          description: 'Type of content on the pages'
        },
        marginalia_present: {
          type: SchemaType.BOOLEAN,
          description: 'Whether there are handwritten notes or marginalia'
        },
        columns_per_page: {
          type: SchemaType.NUMBER,
          description: 'Number of text columns per page (1 or 2 typically)'
        }
      },
      required: ['left_page_has_text', 'right_page_has_text', 'text_type']
    },

    // Reasoning for learning
    reasoning: {
      type: SchemaType.STRING,
      description: 'Explain how you determined the split position, what visual cues you used'
    }
  },
  required: ['is_two_page_spread', 'confidence', 'page_analysis', 'proportions', 'gutter', 'text_analysis', 'reasoning']
};

const ANALYSIS_PROMPT = `You are an expert at analyzing digitized historical book scans.

TASK: Analyze this scan to determine if it's a two-page spread, and if so, where to split it.

CONTEXT: This is likely a scan from an early modern book (1400s-1800s). These were often:
- Scanned open, showing two facing pages (a "spread")
- Digitized via various methods: flatbed scanners, cameras, microfilm readers
- Varying quality with shadows, tilt, uneven lighting, or page curl

YOUR ANALYSIS SHOULD:
1. Determine if this is ONE page or TWO pages (a spread)
2. If two pages, find the GUTTER - the gap/binding between pages
3. Calculate exact percentages for where content falls
4. Identify the SAFE SPLIT RANGE - where we can cut without hitting text

CRITICAL FOR SPLIT POSITION:
- The split position should be the CENTER of the gutter
- Find where LEFT page text ENDS and where RIGHT page text BEGINS
- The safe range is between these two text boundaries
- We will add 2% margins on each side when cropping

VISUAL CUES FOR TWO-PAGE SPREADS:
- Dark shadow line in center (book spine shadow)
- Light gap in center (flatbed glass gap)
- Visible binding curve or page separation
- Different page numbers on each side
- Distinct text blocks with gap between

VISUAL CUES FOR SINGLE PAGE:
- Text flows across the whole image
- No binding line visible
- Only one page number
- Aspect ratio is tall/portrait rather than wide/landscape

Provide your analysis in the structured JSON format.`;

// ============================================================================
// DATABASE & API SETUP
// ============================================================================

const DB_NAME = process.env.MONGODB_DB || 'bookstore';

async function getClient() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI not set');
    process.exit(1);
  }
  const client = new MongoClient(uri);
  await client.connect();
  return client;
}

function getDb(client: MongoClient) {
  return client.db(DB_NAME);
}

function getGemini() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEY not set');
    process.exit(1);
  }
  return new GoogleGenerativeAI(apiKey);
}

// ============================================================================
// FIND UNSPLIT BOOKS
// ============================================================================

interface UnsplitBook {
  id: string;
  title: string;
  author: string;
  pageCount: number;
  needs_splitting: boolean | null;
  has_split_pages: boolean;
}

async function findUnsplitBooks(client: MongoClient): Promise<UnsplitBook[]> {
  const db = getDb(client);

  // Use book_id (underscore) field as per actual database structure
  // Find books with uncropped pages that might need splitting
  const booksWithUncropped = await db.collection('pages').aggregate([
    {
      $match: {
        crop: { $exists: false },
        split_from: { $exists: false }
      }
    },
    {
      $group: {
        _id: '$book_id',
        uncroppedCount: { $sum: 1 },
        samplePageId: { $first: '$id' },
        samplePhoto: { $first: '$photo' }
      }
    },
    { $sort: { uncroppedCount: -1 } },
    { $limit: 100 }
  ]).toArray();

  const results: UnsplitBook[] = [];

  for (const item of booksWithUncropped) {
    const book = await db.collection('books').findOne({
      $or: [{ id: item._id }, { _id: item._id }],
      deleted_at: { $exists: false }
    });

    if (book) {
      // Prioritize books that need splitting or haven't been checked
      if (book.needs_splitting === true || book.needs_splitting === null || book.needs_splitting === undefined) {
        results.push({
          id: item._id,
          title: book.title,
          author: book.author,
          pageCount: item.uncroppedCount,
          needs_splitting: book.needs_splitting,
          has_split_pages: false
        });
      }
    }
  }

  return results;
}

async function findBooksNeedingSplitCheck(client: MongoClient): Promise<UnsplitBook[]> {
  const db = getDb(client);

  // Find books with uncropped pages regardless of needs_splitting flag
  const booksWithUncropped = await db.collection('pages').aggregate([
    {
      $match: {
        crop: { $exists: false },
        split_from: { $exists: false }
      }
    },
    {
      $group: {
        _id: '$book_id',
        uncroppedCount: { $sum: 1 },
        samplePageId: { $first: '$id' },
        samplePhoto: { $first: '$photo' }
      }
    },
    { $sort: { uncroppedCount: -1 } },
    { $limit: 50 }
  ]).toArray();

  const results: UnsplitBook[] = [];

  for (const item of booksWithUncropped) {
    const book = await db.collection('books').findOne({
      $or: [{ id: item._id }, { _id: item._id }],
      deleted_at: { $exists: false }
    });

    if (book) {
      results.push({
        id: item._id,
        title: book.title,
        author: book.author,
        pageCount: item.uncroppedCount,
        needs_splitting: book.needs_splitting,
        has_split_pages: false,
        sample_page_id: item.samplePageId,
        sample_photo: item.samplePhoto
      } as any);
    }
  }

  return results;
}

// ============================================================================
// ANALYZE PAGE WITH GEMINI
// ============================================================================

interface PageAnalysis {
  pageId: string;
  bookId: string;
  pageNumber: number;
  imageUrl: string;
  analysis: unknown;
  splitPosition: number | null; // 0-1000 scale
  margins: { left: number; right: number }; // After applying 2% margins
  tokensUsed: number;
  error?: string;
}

async function analyzePage(
  genAI: GoogleGenerativeAI,
  page: { id: string; book_id: string; page_number: number; photo: string; photo_original?: string }
): Promise<PageAnalysis> {
  const imageUrl = page.photo_original || page.photo;

  const result: PageAnalysis = {
    pageId: page.id,
    bookId: page.book_id,
    pageNumber: page.page_number,
    imageUrl,
    analysis: null,
    splitPosition: null,
    margins: { left: 0, right: 0 },
    tokensUsed: 0
  };

  try {
    // Fetch image
    const response = await fetch(imageUrl);
    if (!response.ok) {
      result.error = `Failed to fetch image: ${response.status}`;
      return result;
    }

    const buffer = await response.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    let mimeType = response.headers.get('content-type') || 'image/jpeg';
    if (mimeType.includes('octet-stream')) mimeType = 'image/jpeg';

    // Run Gemini
    const model = genAI.getGenerativeModel({
      model: MODEL,
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: ANALYSIS_SCHEMA,
      }
    });

    const geminiResult = await model.generateContent([
      ANALYSIS_PROMPT,
      { inlineData: { mimeType, data: base64 } }
    ]);

    const analysisText = geminiResult.response.text();
    const analysis = JSON.parse(analysisText);

    result.analysis = analysis;
    result.tokensUsed = (geminiResult.response.usageMetadata?.totalTokenCount || 0);

    // Calculate split position with margins
    if (analysis.is_two_page_spread && analysis.gutter?.position_percent) {
      const gutterPercent = analysis.gutter.position_percent;
      const splitPosition = Math.round(gutterPercent * 10); // Convert to 0-1000 scale

      result.splitPosition = splitPosition;

      // Apply 2% margins
      const marginAmount = Math.round(MARGIN_PERCENT * 10); // 20 on 0-1000 scale
      result.margins = {
        left: Math.max(0, splitPosition - marginAmount),
        right: Math.min(1000, splitPosition + marginAmount)
      };
    }

  } catch (error) {
    result.error = error instanceof Error ? error.message : 'Unknown error';
  }

  return result;
}

// ============================================================================
// BATCH ANALYSIS
// ============================================================================

async function analyzeBook(
  client: MongoClient,
  genAI: GoogleGenerativeAI,
  bookId: string,
  options: { sampleSize?: number } = {}
): Promise<PageAnalysis[]> {
  const db = getDb(client);

  // Get book info - try multiple ID formats
  const book = await db.collection('books').findOne({
    $or: [{ id: bookId }, { _id: bookId }],
    deleted_at: { $exists: false }
  });
  if (!book) {
    console.error(`Book not found: ${bookId}`);
    return [];
  }

  console.log(`\nAnalyzing: ${book.title}`);
  console.log(`Author: ${book.author || 'Unknown'}`);

  // Get pages using book_id (underscore) field
  let pages = await db.collection('pages')
    .find({ book_id: bookId })
    .sort({ page_number: 1 })
    .toArray();

  console.log(`Total pages: ${pages.length}`);

  // Sample if requested
  if (options.sampleSize && options.sampleSize < pages.length) {
    // Take evenly distributed samples, avoiding first 5 pages (covers/front matter)
    const startIndex = Math.min(5, Math.floor(pages.length * 0.1));
    const availablePages = pages.slice(startIndex);
    const step = Math.floor(availablePages.length / options.sampleSize);
    pages = [];
    for (let i = 0; i < options.sampleSize && i * step < availablePages.length; i++) {
      pages.push(availablePages[i * step]);
    }
    console.log(`Sampling ${pages.length} pages`);
  }

  const results: PageAnalysis[] = [];

  for (const page of pages) {
    process.stdout.write(`  Page ${page.page_number}... `);

    const analysis = await analyzePage(genAI, page);
    results.push(analysis);

    if (analysis.error) {
      console.log(`ERROR: ${analysis.error}`);
    } else if (analysis.analysis) {
      const a = analysis.analysis as any;
      if (a.is_two_page_spread) {
        console.log(`SPREAD - split at ${a.gutter?.position_percent?.toFixed(1)}% (${a.gutter?.appearance})`);
      } else {
        console.log(`SINGLE PAGE`);
      }
    }

    // Rate limiting
    await new Promise(r => setTimeout(r, 500));
  }

  return results;
}

// ============================================================================
// REPORTING
// ============================================================================

function printReport(results: PageAnalysis[]) {
  console.log('\n' + '='.repeat(80));
  console.log('EXPERIMENT RESULTS');
  console.log('='.repeat(80));

  const spreads = results.filter(r => (r.analysis as any)?.is_two_page_spread);
  const singles = results.filter(r => r.analysis && !(r.analysis as any).is_two_page_spread);
  const errors = results.filter(r => r.error);

  console.log(`\nTotal pages analyzed: ${results.length}`);
  console.log(`  Two-page spreads: ${spreads.length}`);
  console.log(`  Single pages: ${singles.length}`);
  console.log(`  Errors: ${errors.length}`);

  if (spreads.length > 0) {
    console.log('\n--- SPREAD ANALYSIS ---');

    // Aggregate proportions
    const positions = spreads.map(r => (r.analysis as any).gutter?.position_percent).filter(Boolean);
    const avgPosition = positions.reduce((a, b) => a + b, 0) / positions.length;
    const minPosition = Math.min(...positions);
    const maxPosition = Math.max(...positions);

    console.log(`\nGutter positions (%):`);
    console.log(`  Average: ${avgPosition.toFixed(1)}%`);
    console.log(`  Min: ${minPosition.toFixed(1)}%`);
    console.log(`  Max: ${maxPosition.toFixed(1)}%`);
    console.log(`  Range: ${(maxPosition - minPosition).toFixed(1)}%`);

    // Gutter appearance distribution
    const appearances: Record<string, number> = {};
    spreads.forEach(r => {
      const app = (r.analysis as any).gutter?.appearance || 'unknown';
      appearances[app] = (appearances[app] || 0) + 1;
    });

    console.log(`\nGutter appearance:`);
    Object.entries(appearances).sort((a, b) => b[1] - a[1]).forEach(([type, count]) => {
      console.log(`  ${type}: ${count} (${(count / spreads.length * 100).toFixed(0)}%)`);
    });

    // Scan type distribution
    const scanTypes: Record<string, number> = {};
    spreads.forEach(r => {
      const type = (r.analysis as any).page_analysis?.scan_type || 'unknown';
      scanTypes[type] = (scanTypes[type] || 0) + 1;
    });

    console.log(`\nScan types:`);
    Object.entries(scanTypes).sort((a, b) => b[1] - a[1]).forEach(([type, count]) => {
      console.log(`  ${type}: ${count} (${(count / spreads.length * 100).toFixed(0)}%)`);
    });

    // Detailed per-page breakdown
    console.log('\n--- PER-PAGE DETAILS ---');
    spreads.forEach(r => {
      const a = r.analysis as any;
      console.log(`\nPage ${r.pageNumber}:`);
      console.log(`  Split position: ${a.gutter?.position_percent?.toFixed(1)}% (${r.splitPosition} on 0-1000)`);
      console.log(`  Safe range: ${a.gutter?.safe_split_range?.min_percent?.toFixed(1)}% - ${a.gutter?.safe_split_range?.max_percent?.toFixed(1)}%`);
      console.log(`  Gutter: ${a.gutter?.appearance}`);
      console.log(`  Left/Right: ${a.proportions?.left_page_percent?.toFixed(1)}% / ${a.proportions?.right_page_percent?.toFixed(1)}%`);
      console.log(`  Text gap safe: ${a.gutter?.text_gap_safe ? 'YES' : 'NO'}`);
      if (a.gutter?.hazards) console.log(`  Hazards: ${a.gutter.hazards}`);
      console.log(`  Reasoning: ${a.reasoning?.substring(0, 150)}...`);
    });
  }

  // Token usage
  const totalTokens = results.reduce((sum, r) => sum + r.tokensUsed, 0);
  console.log(`\n--- COST ---`);
  console.log(`Total tokens: ${totalTokens}`);
  // Gemini 3 Pro pricing estimate (placeholder)
  const estimatedCost = totalTokens * 0.000005; // Rough estimate
  console.log(`Estimated cost: $${estimatedCost.toFixed(4)}`);
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  const args = process.argv.slice(2);

  // Parse arguments
  const listBooks = args.includes('--list');
  const listUncropped = args.includes('--list-uncropped');
  const bookIdArg = args.find(a => a.startsWith('--book-id='));
  const pageIdArg = args.find(a => a.startsWith('--page-id='));
  const sampleArg = args.find(a => a.startsWith('--sample='));

  const bookId = bookIdArg?.split('=')[1];
  const pageId = pageIdArg?.split('=')[1];
  const sampleSize = sampleArg ? parseInt(sampleArg.split('=')[1]) : undefined;

  const client = await getClient();

  try {
    if (listUncropped) {
      // List books with uncropped pages that need checking
      console.log('Finding books with uncropped pages...\n');
      const books = await findBooksNeedingSplitCheck(client);

      if (books.length === 0) {
        console.log('All books have been processed!');
      } else {
        console.log(`Found ${books.length} books with uncropped pages:\n`);
        books.forEach((book: any, i: number) => {
          console.log(`${i + 1}. ${book.title}`);
          console.log(`   ID: ${book.id}`);
          console.log(`   Pages: ${book.pageCount}`);
          console.log(`   Sample page: ${book.sample_page_id}`);
          console.log('');
        });

        console.log('\nTo analyze a book:');
        console.log(`  npx tsx scripts/split-experiment.ts --book-id=<ID> --sample=5`);
      }

    } else if (listBooks) {
      // List unsplit books (flagged as needing splitting)
      console.log('Finding books flagged as needing splitting...\n');
      const unsplitBooks = await findUnsplitBooks(client);

      if (unsplitBooks.length === 0) {
        console.log('No books flagged as needing splitting.');
        console.log('\nTry --list-uncropped to find books with unprocessed pages.');
      } else {
        console.log(`Found ${unsplitBooks.length} books that may need splitting:\n`);
        unsplitBooks.forEach((book, i) => {
          const status = book.needs_splitting === true ? '✓ NEEDS SPLIT' : '? UNKNOWN';
          console.log(`${i + 1}. [${status}] ${book.title}`);
          console.log(`   ID: ${book.id}`);
          console.log(`   Author: ${book.author || 'Unknown'}`);
          console.log(`   Pages: ${book.pageCount}`);
          console.log('');
        });

        console.log('\nTo analyze a book:');
        console.log(`  npx tsx scripts/split-experiment.ts --book-id=<ID> --sample=5`);
      }

    } else if (pageId) {
      // Analyze single page
      const genAI = getGemini();
      const db = getDb(client);

      const page = await db.collection('pages').findOne({ id: pageId });
      if (!page) {
        console.error('Page not found');
        process.exit(1);
      }

      console.log(`Analyzing page ${page.page_number} from book ${page.book_id}...`);

      const result = await analyzePage(genAI, page as any);
      console.log('\n--- FULL ANALYSIS ---');
      console.log(JSON.stringify(result.analysis, null, 2));

      if (result.splitPosition !== null) {
        console.log(`\n--- SPLIT RECOMMENDATION ---`);
        console.log(`Split at: ${result.splitPosition} (0-1000 scale)`);
        console.log(`With ${MARGIN_PERCENT}% margins:`);
        console.log(`  Left page crop: 0 to ${result.margins.right}`);
        console.log(`  Right page crop: ${result.margins.left} to 1000`);
      }

    } else if (bookId) {
      // Analyze book
      const genAI = getGemini();
      const results = await analyzeBook(client, genAI, bookId, { sampleSize });
      printReport(results);

    } else if (sampleSize) {
      // Sample across multiple books
      const genAI = getGemini();
      const unsplitBooks = await findUnsplitBooks(client);

      if (unsplitBooks.length === 0) {
        console.log('No unsplit books found');
        process.exit(0);
      }

      console.log(`Sampling ${sampleSize} pages across ${Math.min(unsplitBooks.length, 5)} books...`);

      const allResults: PageAnalysis[] = [];
      const booksToSample = unsplitBooks.slice(0, 5);
      const pagesPerBook = Math.ceil(sampleSize / booksToSample.length);

      for (const book of booksToSample) {
        const results = await analyzeBook(client, genAI, book.id, { sampleSize: pagesPerBook });
        allResults.push(...results);
      }

      printReport(allResults);

    } else {
      console.log(`
Split Detection Experiment
==========================

Usage:
  npx tsx scripts/split-experiment.ts --list              # List books flagged as needing splitting
  npx tsx scripts/split-experiment.ts --list-uncropped    # List books with unprocessed pages
  npx tsx scripts/split-experiment.ts --book-id=XXX       # Analyze all pages of a book
  npx tsx scripts/split-experiment.ts --book-id=XXX --sample=5  # Sample 5 pages from book
  npx tsx scripts/split-experiment.ts --page-id=XXX       # Analyze single page (full output)
  npx tsx scripts/split-experiment.ts --sample=10         # Sample 10 pages across books

The experiment uses Gemini 3 Pro to analyze pages and provides:
- Whether pages are two-page spreads or single pages
- Exact gutter position for splitting
- Safe split range (where text won't be cut)
- Page proportions and scan quality analysis
- Detailed reasoning for optimization

Split crops will apply ${MARGIN_PERCENT}% margins on each side.
`);
    }

  } finally {
    await client.close();
  }
}

main().catch(console.error);
