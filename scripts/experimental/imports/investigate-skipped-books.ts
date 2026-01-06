/**
 * Investigate the 21 skipped books using Gemini 3 Flash
 *
 * For each book:
 * 1. Get correct page count from IA
 * 2. Sample existing OCR quality
 * 3. Check if missing pages have real content
 * 4. Make recommendation
 */

import { MongoClient } from 'mongodb';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from 'dotenv';

config({ path: '.env.local' });

const GEMINI_MODEL = 'gemini-2.0-flash';

interface BookToInvestigate {
  id: string;
  title: string;
  ia_identifier: string;
  pages_count: number;
  pages_ocr: number;
  pages_translated: number;
}

const booksToInvestigate: BookToInvestigate[] = [
  { id: 'f176cb65-a60e-4f8a-9514-39796f092cde', title: 'De Arte Cabalistica', ia_identifier: 'bub_gb_hgg8vG6num4C', pages_count: 457, pages_ocr: 456, pages_translated: 0 },
  { id: '694a8046458d70b8c6439c5f', title: 'De vitis, dogmatis...', ia_identifier: 'dionysiilambinid01john', pages_count: 476, pages_ocr: 451, pages_translated: 3 },
  { id: 'adad5f6d-4f68-4009-9406-d0e083cf0acc', title: 'Opera Omnia', ia_identifier: 'A335045', pages_count: 442, pages_ocr: 439, pages_translated: 0 },
  { id: '69526348ab34727b1f046c0b', title: 'Miracula et mysteria', ia_identifier: 'b32991265', pages_count: 334, pages_ocr: 332, pages_translated: 0 },
  { id: 'c87fadfa-1543-44b9-a138-573c144246e6', title: 'Musaeum Hermeticum', ia_identifier: 'musaeumhermeticu00meri', pages_count: 817, pages_ocr: 325, pages_translated: 0 },
  { id: '694b3b5b58a47807cc735dce', title: 'De revolutionibus', ia_identifier: 'ARes18421', pages_count: 209, pages_ocr: 209, pages_translated: 209 },
  { id: '6949af986ef4a68b726b7fa9', title: 'De architectura', ia_identifier: 'mvitrvviidearchi00vitr', pages_count: 328, pages_ocr: 198, pages_translated: 68 },
  { id: '695262d8ab34727b1f046ade', title: 'Summa perfectionis', ia_identifier: 'geberisphilosoph00gebe', pages_count: 191, pages_ocr: 187, pages_translated: 0 },
  { id: '4f4ff6f9-f0bd-4307-910c-65da7c36c0ef', title: 'Pansophiae Diatyposis', ia_identifier: 'bub_gb_MGhEAAAAcAAJ', pages_count: 148, pages_ocr: 148, pages_translated: 148 },
  { id: '912cf0da-035c-425b-8975-e5a195a47767', title: 'De Mysteriis Aegyptiorum', ia_identifier: 'A335081', pages_count: 145, pages_ocr: 145, pages_translated: 0 },
  { id: '40124cb0-8498-477f-be31-bc2cd8ab4375', title: 'Manly Palmer Hall MSS', ia_identifier: 'manlypalmerhabox4v3hall', pages_count: 119, pages_ocr: 118, pages_translated: 0 },
  { id: '69525855ab34727b1f045072', title: 'Lumen de Lumine', ia_identifier: 'lumendelumineorn00vaug', pages_count: 92, pages_ocr: 81, pages_translated: 0 },
  { id: '69525858ab34727b1f0450cf', title: 'Aula Lucis', ia_identifier: 'aulalucisorhouse00vaug', pages_count: 64, pages_ocr: 60, pages_translated: 0 },
  { id: '694f397023a1d0c2ad1d8814', title: 'Platonis Opera Ficino', ia_identifier: 'bub_gb_QOkjvOBiQAUC', pages_count: 634, pages_ocr: 43, pages_translated: 0 },
  { id: '695234ddab34727b1f044cd2', title: 'Hermetic Museum Vol.1', ia_identifier: 'b24927363_0001', pages_count: 239, pages_ocr: 43, pages_translated: 0 },
  { id: '31f2d90a-88af-4414-a445-68406caca58d', title: 'Astronomia Nova', ia_identifier: 'Astronomianovaa00Kepl', pages_count: 279, pages_ocr: 40, pages_translated: 0 },
  { id: '694d27e77219319474c057f4', title: 'Tetragonismus', ia_identifier: 'bub_gb_eZ04dG5e_JsC', pages_count: 34, pages_ocr: 34, pages_translated: 34 },
  { id: '694f397b53410e29f94e13ea', title: 'Ficini Platonica theol.', ia_identifier: 'bub_gb_mLvcAyPxuQoC', pages_count: 306, pages_ocr: 33, pages_translated: 0 },
  { id: '694b3abfde93d1d4cec196fd', title: 'Ficini Opera', ia_identifier: 'bub_gb_t187zmOeqAYC', pages_count: 701, pages_ocr: 10, pages_translated: 0 },
  { id: '69527313ab34727b1f048b15', title: 'Opera Latine Conscripta', ia_identifier: 'jordanibruninol06brungoog', pages_count: 100, pages_ocr: 10, pages_translated: 10 },
  { id: '69527326ab34727b1f048b7a', title: 'De Triplici Minimo', ia_identifier: 'bub_gb_PVRkCyp8u-AC', pages_count: 179, pages_ocr: 9, pages_translated: 9 },
];

async function getIAImagecount(identifier: string): Promise<number | null> {
  try {
    const res = await fetch(`https://archive.org/metadata/${identifier}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.metadata?.imagecount ? parseInt(data.metadata.imagecount, 10) : null;
  } catch {
    return null;
  }
}

function getIAPageImageUrl(identifier: string, pageNum: number): string {
  // IA BookReader uses 0-indexed leaf numbers
  const leaf = pageNum - 1;
  return `https://archive.org/download/${identifier}/page/leaf${leaf}_w800.jpg`;
}

async function analyzeWithGemini(
  genAI: GoogleGenerativeAI,
  imageUrl: string,
  prompt: string
): Promise<string> {
  try {
    const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });

    // Fetch image
    const imageRes = await fetch(imageUrl);
    if (!imageRes.ok) {
      return `[Image fetch failed: ${imageRes.status}]`;
    }

    const imageBuffer = await imageRes.arrayBuffer();
    const base64 = Buffer.from(imageBuffer).toString('base64');
    const mimeType = imageRes.headers.get('content-type') || 'image/jpeg';

    const result = await model.generateContent([
      prompt,
      { inlineData: { mimeType, data: base64 } }
    ]);

    return result.response.text();
  } catch (err) {
    return `[Gemini error: ${err}]`;
  }
}

async function investigateBook(
  book: BookToInvestigate,
  db: ReturnType<MongoClient['db']>,
  genAI: GoogleGenerativeAI
): Promise<string> {
  const lines: string[] = [];
  lines.push(`\n${'='.repeat(70)}`);
  lines.push(`📚 ${book.title}`);
  lines.push(`   ID: ${book.id}`);
  lines.push(`   URL: https://sourcelibrary.org/book/${book.id}`);
  lines.push(`   IA: https://archive.org/details/${book.ia_identifier}`);
  lines.push(`${'='.repeat(70)}`);

  // 1. Get correct page count from IA
  const iaCount = await getIAImagecount(book.ia_identifier);
  if (!iaCount) {
    lines.push(`❌ Could not fetch IA metadata`);
    return lines.join('\n');
  }

  const missing = iaCount - book.pages_count;
  lines.push(`\n📊 Page Counts:`);
  lines.push(`   Current: ${book.pages_count} | Correct: ${iaCount} | Missing: ${missing}`);
  lines.push(`   OCR'd: ${book.pages_ocr} | Translated: ${book.pages_translated}`);

  // 2. Sample a page with existing OCR to check quality
  const samplePage = await db.collection('pages').findOne({
    book_id: book.id,
    'ocr.data': { $ne: '' }
  });

  if (samplePage?.ocr?.data) {
    lines.push(`\n📝 Sample OCR (page ${samplePage.page_number}):`);
    const ocrPreview = samplePage.ocr.data.substring(0, 300).replace(/\n/g, ' ');
    lines.push(`   "${ocrPreview}..."`);
  }

  // 3. Check a missing page with Gemini
  if (missing > 0) {
    const missingPageNum = book.pages_count + Math.min(10, Math.floor(missing / 2));
    const missingPageUrl = getIAPageImageUrl(book.ia_identifier, missingPageNum);

    lines.push(`\n🔍 Checking missing page ${missingPageNum}:`);
    lines.push(`   ${missingPageUrl}`);

    const analysis = await analyzeWithGemini(
      genAI,
      missingPageUrl,
      `Briefly describe this page image in 1-2 sentences. Is this:
1. Real book content (text, illustrations, etc.)
2. A blank page or empty scan
3. A calibration target / color card
4. A library stamp / cover / frontmatter
5. Something else

Answer format: "TYPE: [description]"`
    );

    lines.push(`   ${analysis}`);
  }

  // 4. Make recommendation
  lines.push(`\n💡 RECOMMENDATION:`);

  const ocrPercent = Math.round((book.pages_ocr / book.pages_count) * 100);
  const transPercent = Math.round((book.pages_translated / book.pages_count) * 100);

  if (book.pages_translated > 50 || transPercent > 80) {
    lines.push(`   ⚠️  PRESERVE - ${book.pages_translated} translated pages would be lost`);
    lines.push(`   Consider: Manually add missing pages without losing translations`);
  } else if (book.pages_ocr < 50 && missing > book.pages_ocr) {
    lines.push(`   ✅ REIMPORT - Only ${book.pages_ocr} OCR pages, missing ${missing} pages`);
    lines.push(`   Loss is minimal compared to content gain`);
  } else if (ocrPercent > 90 && missing < 50) {
    lines.push(`   ⚠️  PRESERVE - High OCR coverage (${ocrPercent}%), small gap`);
    lines.push(`   Consider: Extend book by adding missing pages`);
  } else {
    lines.push(`   🤔 EVALUATE - ${book.pages_ocr} OCR vs ${missing} missing`);
    lines.push(`   Review the missing content before deciding`);
  }

  return lines.join('\n');
}

async function main() {
  const uri = process.env.MONGODB_URI;
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY;

  if (!uri) {
    console.error('MONGODB_URI not set');
    process.exit(1);
  }
  if (!apiKey) {
    console.error('GEMINI_API_KEY not set');
    process.exit(1);
  }

  const client = new MongoClient(uri);
  const genAI = new GoogleGenerativeAI(apiKey);

  try {
    await client.connect();
    const db = client.db(process.env.MONGODB_DB);

    console.log('🔬 Investigating 21 books with OCR work...\n');

    const results: string[] = [];

    for (let i = 0; i < booksToInvestigate.length; i++) {
      const book = booksToInvestigate[i];
      console.log(`[${i + 1}/${booksToInvestigate.length}] ${book.title}...`);

      const result = await investigateBook(book, db, genAI);
      results.push(result);
      console.log(result);

      // Rate limit
      await new Promise(r => setTimeout(r, 1000));
    }

    // Summary
    console.log('\n' + '='.repeat(70));
    console.log('📋 INVESTIGATION COMPLETE');
    console.log('='.repeat(70));

  } finally {
    await client.close();
  }
}

main().catch(console.error);
