/**
 * Find Shareable Content
 *
 * Searches for promising quotes and images to share on social media.
 * Run: npx ts-node scripts/find-shareable-content.ts [--images] [--quotes] [--limit N]
 */

import { MongoClient, Db } from 'mongodb';

interface ShareableQuote {
  bookId: string;
  bookTitle: string;
  bookAuthor?: string;
  pageNumber: number;
  pageId: string;
  text: string;
  source: 'highlight' | 'translation';
  score: number;
  photoUrl?: string;
}

interface ShareableImage {
  bookId: string;
  bookTitle: string;
  pageNumber: number;
  pageId: string;
  description: string;
  photoUrl: string;
  croppedUrl?: string;
}

// Extract [[image: ...]] tags from OCR text
function extractImageDescriptions(text: string): string[] {
  const matches = text.match(/\[\[image:\s*([^\]]+)\]\]/gi) || [];
  return matches.map(m => m.replace(/\[\[image:\s*/i, '').replace(/\]\]$/, '').trim());
}

// Score a quote based on shareability
function scoreQuote(text: string): number {
  let score = 0;

  // Length: prefer 100-280 chars
  if (text.length >= 80 && text.length <= 280) score += 30;
  else if (text.length >= 50 && text.length <= 400) score += 15;

  // Complete sentences (ends with punctuation)
  if (/[.!?]["']?$/.test(text.trim())) score += 20;

  // Has interesting words
  const interestingWords = [
    'soul', 'spirit', 'wisdom', 'truth', 'nature', 'god', 'divine',
    'secret', 'mystery', 'light', 'fire', 'gold', 'stone', 'mercury',
    'transmutation', 'philosopher', 'alchemy', 'magic', 'cosmos',
    'heaven', 'earth', 'stars', 'sun', 'moon', 'life', 'death',
    'knowledge', 'power', 'love', 'beauty', 'eternal', 'infinite'
  ];
  const lowerText = text.toLowerCase();
  interestingWords.forEach(word => {
    if (lowerText.includes(word)) score += 5;
  });

  // Penalize fragments and lists
  if (text.startsWith('-') || text.startsWith('•')) score -= 20;
  if (/^\d+\./.test(text)) score -= 10;

  // Penalize if too many brackets (editorial markers)
  const bracketCount = (text.match(/\[/g) || []).length;
  if (bracketCount > 2) score -= 15;

  return score;
}

// Find interesting paragraphs from translations
function extractQuotesFromTranslation(text: string): string[] {
  // Split into paragraphs
  const paragraphs = text
    .split(/\n\n+/)
    .map(p => p.trim())
    .filter(p => p.length >= 50 && p.length <= 500);

  // Filter out obvious non-quotes
  return paragraphs.filter(p => {
    // Skip if mostly brackets/editorial
    if ((p.match(/\[/g) || []).length > 3) return false;
    // Skip if starts with meta markers
    if (p.startsWith('[[')) return false;
    // Skip if looks like a heading
    if (p.length < 80 && !p.includes(' ')) return false;
    return true;
  });
}

async function findShareableQuotes(db: Db, limit: number): Promise<ShareableQuote[]> {
  const quotes: ShareableQuote[] = [];

  // 1. Get highlights (already curated by readers)
  console.log('Searching highlights...');
  const highlights = await db.collection('highlights').aggregate([
    { $match: { text: { $exists: true } } },
    { $sort: { created_at: -1 } },
    { $limit: limit * 2 },
    {
      $lookup: {
        from: 'books',
        localField: 'book_id',
        foreignField: 'id',
        as: 'book'
      }
    },
    { $unwind: { path: '$book', preserveNullAndEmptyArrays: true } }
  ]).toArray();

  for (const h of highlights) {
    if (!h.text || h.text.length < 30) continue;
    quotes.push({
      bookId: h.book_id,
      bookTitle: h.book?.display_title || h.book_title || 'Unknown',
      bookAuthor: h.book?.author || h.book_author,
      pageNumber: h.page_number,
      pageId: h.page_id,
      text: h.text,
      source: 'highlight',
      score: scoreQuote(h.text) + 20, // Bonus for being user-selected
    });
  }

  // 2. Search translations for good paragraphs
  console.log('Searching translations...');
  const pages = await db.collection('pages').aggregate([
    {
      $match: {
        'translation.data': { $exists: true, $ne: '' }
      }
    },
    { $sample: { size: limit * 10 } },
    {
      $lookup: {
        from: 'books',
        localField: 'book_id',
        foreignField: 'id',
        as: 'book'
      }
    },
    { $unwind: { path: '$book', preserveNullAndEmptyArrays: true } }
  ]).toArray();

  for (const p of pages) {
    const translation = p.translation?.data || '';
    const potentialQuotes = extractQuotesFromTranslation(translation);

    for (const text of potentialQuotes.slice(0, 3)) { // Max 3 per page
      const score = scoreQuote(text);
      if (score >= 20) { // Only include decent ones
        quotes.push({
          bookId: p.book_id,
          bookTitle: p.book?.display_title || p.book?.title || 'Unknown',
          bookAuthor: p.book?.author,
          pageNumber: p.page_number,
          pageId: p.id,
          text,
          source: 'translation',
          score,
          photoUrl: p.cropped_photo || p.photo_original,
        });
      }
    }
  }

  // Sort by score and return top results
  return quotes
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

async function findShareableImages(db: Db, limit: number): Promise<ShareableImage[]> {
  const images: ShareableImage[] = [];

  console.log('Searching for pages with illustrations...');

  // Find pages with [[image: ...]] in OCR
  const pages = await db.collection('pages').aggregate([
    {
      $match: {
        'ocr.data': { $regex: '\\[\\[image:', $options: 'i' }
      }
    },
    { $limit: limit * 5 },
    {
      $lookup: {
        from: 'books',
        localField: 'book_id',
        foreignField: 'id',
        as: 'book'
      }
    },
    { $unwind: { path: '$book', preserveNullAndEmptyArrays: true } }
  ]).toArray();

  for (const p of pages) {
    const ocr = p.ocr?.data || '';
    const descriptions = extractImageDescriptions(ocr);

    for (const desc of descriptions) {
      if (desc.length < 10) continue; // Skip very short descriptions

      images.push({
        bookId: p.book_id,
        bookTitle: p.book?.display_title || p.book?.title || 'Unknown',
        pageNumber: p.page_number,
        pageId: p.id,
        description: desc,
        photoUrl: p.photo_original || '',
        croppedUrl: p.cropped_photo,
      });
    }
  }

  return images.slice(0, limit);
}

function formatOutput(quotes: ShareableQuote[], images: ShareableImage[]) {
  console.log('\n' + '='.repeat(80));
  console.log('SHAREABLE CONTENT REPORT');
  console.log('='.repeat(80));

  if (quotes.length > 0) {
    console.log('\n📝 TOP QUOTES\n');
    quotes.forEach((q, i) => {
      console.log(`${i + 1}. [Score: ${q.score}] ${q.source.toUpperCase()}`);
      console.log(`   Book: "${q.bookTitle}" by ${q.bookAuthor || 'Unknown'}`);
      console.log(`   Page: ${q.pageNumber}`);
      console.log(`   Text: "${q.text.slice(0, 200)}${q.text.length > 200 ? '...' : ''}"`);
      console.log(`   URL: https://sourcelibrary.org/book/${q.bookId}/read#page-${q.pageNumber}`);
      console.log('');
    });
  }

  if (images.length > 0) {
    console.log('\n🖼️  PAGES WITH ILLUSTRATIONS\n');
    images.forEach((img, i) => {
      console.log(`${i + 1}. "${img.bookTitle}" - Page ${img.pageNumber}`);
      console.log(`   Description: ${img.description}`);
      console.log(`   Image: ${img.croppedUrl || img.photoUrl}`);
      console.log(`   URL: https://sourcelibrary.org/book/${img.bookId}/read#page-${img.pageNumber}`);
      console.log('');
    });
  }

  // Output as JSON for programmatic use
  console.log('\n' + '='.repeat(80));
  console.log('JSON OUTPUT (for copy/paste)');
  console.log('='.repeat(80));
  console.log(JSON.stringify({ quotes, images }, null, 2));
}

async function main() {
  const args = process.argv.slice(2);
  const findImages = args.includes('--images') || !args.includes('--quotes');
  const findQuotes = args.includes('--quotes') || !args.includes('--images');
  const limitArg = args.find(a => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1]) : 20;

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI not set');
    process.exit(1);
  }

  const client = new MongoClient(uri);

  try {
    await client.connect();
    const db = client.db();

    let quotes: ShareableQuote[] = [];
    let images: ShareableImage[] = [];

    if (findQuotes) {
      quotes = await findShareableQuotes(db, limit);
    }

    if (findImages) {
      images = await findShareableImages(db, limit);
    }

    formatOutput(quotes, images);

  } finally {
    await client.close();
  }
}

main().catch(console.error);
