/**
 * Split Detection Quality Evaluation
 *
 * Samples random pages for human verification of Gemini split detection.
 * Outputs clickable image URLs alongside predicted split positions.
 *
 * Usage:
 *   npx tsx scripts/split-eval.ts --random=10           # Sample 10 random pages
 *   npx tsx scripts/split-eval.ts --concerned           # Show only concerning results
 *   npx tsx scripts/split-eval.ts --book-id=XXX --all   # Analyze all pages of a book
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { MongoClient } from 'mongodb';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';

const DB_NAME = process.env.MONGODB_DB || 'bookstore';
const MODEL = 'gemini-3-flash-preview';
const MARGIN_PERCENT = 2;

// Simplified schema for faster evaluation
const EVAL_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    is_two_page_spread: { type: SchemaType.BOOLEAN },
    confidence: { type: SchemaType.STRING, enum: ['high', 'medium', 'low'] },
    split_position_percent: {
      type: SchemaType.NUMBER,
      description: 'Position to split as percentage from left (0-100). Return 0 if single page.'
    },
    safe_split_min: { type: SchemaType.NUMBER },
    safe_split_max: { type: SchemaType.NUMBER },
    text_gap_safe: { type: SchemaType.BOOLEAN },
    gutter_type: {
      type: SchemaType.STRING,
      enum: ['dark_shadow', 'light_gap', 'curved', 'no_visible_gutter', 'mixed']
    },
    concerns: {
      type: SchemaType.STRING,
      description: 'Any concerns about splitting this page (text at gutter, marginalia, tilted, etc.). Empty if none.'
    }
  },
  required: ['is_two_page_spread', 'confidence', 'split_position_percent', 'text_gap_safe', 'gutter_type']
};

const EVAL_PROMPT = `Analyze this book scan for splitting into left/right pages.

If this is a TWO-PAGE SPREAD (open book with two facing pages):
- Find the gutter (binding/gap between pages)
- Return the split position as a percentage from left edge
- Check if it's safe to split (no text crossing the gutter)

If this is a SINGLE PAGE:
- Set is_two_page_spread to false
- Set split_position_percent to 0

Note any concerns (marginalia at gutter, text bleeding, extreme tilt, poor quality).`;

interface EvalResult {
  pageId: string;
  bookId: string;
  bookTitle: string;
  pageNumber: number;
  imageUrl: string;
  isSpread: boolean;
  splitPosition: number;
  confidence: string;
  textGapSafe: boolean;
  gutterType: string;
  concerns: string;
  isConcerning: boolean;
  error?: string;
}

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

async function getRandomPages(client: MongoClient, count: number) {
  const db = getDb(client);

  // Get random uncropped pages
  const pages = await db.collection('pages').aggregate([
    {
      $match: {
        crop: { $exists: false },
        split_from: { $exists: false },
        book_id: { $exists: true, $ne: null }
      }
    },
    { $sample: { size: count * 2 } }, // Get extra in case some fail
    { $limit: count }
  ]).toArray();

  return pages;
}

async function analyzePage(
  genAI: GoogleGenerativeAI,
  page: any,
  bookTitle: string
): Promise<EvalResult> {
  const imageUrl = page.photo_original || page.photo;

  const result: EvalResult = {
    pageId: page.id,
    bookId: page.book_id,
    bookTitle,
    pageNumber: page.page_number,
    imageUrl,
    isSpread: false,
    splitPosition: 0,
    confidence: 'unknown',
    textGapSafe: true,
    gutterType: 'unknown',
    concerns: '',
    isConcerning: false
  };

  try {
    const response = await fetch(imageUrl);
    if (!response.ok) {
      result.error = `Failed to fetch: ${response.status}`;
      result.isConcerning = true;
      return result;
    }

    const buffer = await response.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    let mimeType = response.headers.get('content-type') || 'image/jpeg';
    if (mimeType.includes('octet-stream')) mimeType = 'image/jpeg';

    const model = genAI.getGenerativeModel({
      model: MODEL,
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: EVAL_SCHEMA,
      }
    });

    const geminiResult = await model.generateContent([
      EVAL_PROMPT,
      { inlineData: { mimeType, data: base64 } }
    ]);

    const analysis = JSON.parse(geminiResult.response.text());

    result.isSpread = analysis.is_two_page_spread;
    result.splitPosition = analysis.split_position_percent || 0;
    result.confidence = analysis.confidence;
    result.textGapSafe = analysis.text_gap_safe;
    result.gutterType = analysis.gutter_type;
    result.concerns = analysis.concerns || '';

    // Flag concerning results
    result.isConcerning = (
      result.confidence === 'low' ||
      !result.textGapSafe ||
      result.concerns.length > 0 ||
      (result.isSpread && (result.splitPosition < 35 || result.splitPosition > 65)) // Extreme asymmetry
    );

  } catch (error) {
    result.error = error instanceof Error ? error.message : 'Unknown error';
    result.isConcerning = true;
  }

  return result;
}

function printResult(result: EvalResult, index: number) {
  const flag = result.isConcerning ? '⚠️ ' : '✓ ';
  const type = result.isSpread ? 'SPREAD' : 'SINGLE';

  console.log(`\n${flag}#${index + 1} - ${type} (${result.confidence})`);
  console.log(`   Book: ${result.bookTitle.substring(0, 50)}`);
  console.log(`   Page: ${result.pageNumber}`);

  if (result.isSpread) {
    console.log(`   Split: ${result.splitPosition.toFixed(1)}%`);
    console.log(`   Gutter: ${result.gutterType}`);
    console.log(`   Text safe: ${result.textGapSafe ? 'YES' : 'NO'}`);
  }

  if (result.concerns) {
    console.log(`   Concerns: ${result.concerns}`);
  }

  if (result.error) {
    console.log(`   ERROR: ${result.error}`);
  }

  // Clickable image URL for verification
  console.log(`   Image: ${result.imageUrl}`);
}

function printSummary(results: EvalResult[]) {
  console.log('\n' + '='.repeat(70));
  console.log('EVALUATION SUMMARY');
  console.log('='.repeat(70));

  const spreads = results.filter(r => r.isSpread);
  const singles = results.filter(r => !r.isSpread && !r.error);
  const errors = results.filter(r => r.error);
  const concerning = results.filter(r => r.isConcerning);

  console.log(`\nTotal pages analyzed: ${results.length}`);
  console.log(`  Two-page spreads: ${spreads.length}`);
  console.log(`  Single pages: ${singles.length}`);
  console.log(`  Errors: ${errors.length}`);
  console.log(`  Concerning: ${concerning.length}`);

  if (spreads.length > 0) {
    const positions = spreads.map(r => r.splitPosition);
    const avg = positions.reduce((a, b) => a + b, 0) / positions.length;
    const min = Math.min(...positions);
    const max = Math.max(...positions);

    console.log(`\nSplit positions:`);
    console.log(`  Average: ${avg.toFixed(1)}%`);
    console.log(`  Range: ${min.toFixed(1)}% - ${max.toFixed(1)}%`);

    // Distribution
    const byGutter: Record<string, number> = {};
    spreads.forEach(r => {
      byGutter[r.gutterType] = (byGutter[r.gutterType] || 0) + 1;
    });
    console.log(`\nGutter types:`);
    Object.entries(byGutter).forEach(([type, count]) => {
      console.log(`  ${type}: ${count}`);
    });
  }

  if (concerning.length > 0) {
    console.log('\n--- CONCERNING PAGES (need review) ---');
    concerning.forEach((r, i) => {
      console.log(`\n${i + 1}. Page ${r.pageNumber} of "${r.bookTitle.substring(0, 40)}"`);
      console.log(`   Reason: ${r.error || r.concerns || (r.confidence === 'low' ? 'Low confidence' : 'Extreme split position')}`);
      console.log(`   Image: ${r.imageUrl}`);
    });
  }
}

async function main() {
  const args = process.argv.slice(2);

  const randomArg = args.find(a => a.startsWith('--random='));
  const concernedOnly = args.includes('--concerned');
  const bookIdArg = args.find(a => a.startsWith('--book-id='));
  const analyzeAll = args.includes('--all');

  const randomCount = randomArg ? parseInt(randomArg.split('=')[1]) : 10;
  const bookId = bookIdArg?.split('=')[1];

  const client = await getClient();
  const genAI = getGemini();
  const db = getDb(client);

  try {
    let pages: any[] = [];

    if (bookId && analyzeAll) {
      // Analyze all pages of a specific book
      pages = await db.collection('pages')
        .find({ book_id: bookId })
        .sort({ page_number: 1 })
        .toArray();
      console.log(`Analyzing all ${pages.length} pages of book ${bookId}...`);
    } else {
      // Random sample
      console.log(`Sampling ${randomCount} random pages for evaluation...\n`);
      pages = await getRandomPages(client, randomCount);
    }

    if (pages.length === 0) {
      console.log('No pages found to analyze');
      return;
    }

    const results: EvalResult[] = [];

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];

      // Get book title
      const book = await db.collection('books').findOne({
        $or: [{ id: page.book_id }, { _id: page.book_id }]
      });
      const bookTitle = book?.title || 'Unknown';

      process.stdout.write(`Analyzing ${i + 1}/${pages.length}: page ${page.page_number}... `);

      const result = await analyzePage(genAI, page, bookTitle);
      results.push(result);

      const status = result.error ? 'ERROR' : (result.isSpread ? `SPREAD ${result.splitPosition.toFixed(0)}%` : 'SINGLE');
      console.log(status);

      // Rate limiting
      await new Promise(r => setTimeout(r, 300));
    }

    // Print results
    console.log('\n' + '='.repeat(70));
    console.log('DETAILED RESULTS');
    console.log('='.repeat(70));

    const toShow = concernedOnly ? results.filter(r => r.isConcerning) : results;
    toShow.forEach((r, i) => printResult(r, i));

    printSummary(results);

  } finally {
    await client.close();
  }
}

main().catch(console.error);
