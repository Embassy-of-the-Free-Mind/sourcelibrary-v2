/**
 * Daily Quote Bot for Source Library
 *
 * Picks a random highlight or translated passage and posts to social media.
 * Run via cron: 0 9 * * * npx ts-node scripts/daily-quote-bot.ts
 *
 * Environment variables:
 * - MONGODB_URI: MongoDB connection string
 * - TWITTER_API_KEY, TWITTER_API_SECRET, TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_SECRET
 * - BLUESKY_HANDLE, BLUESKY_APP_PASSWORD
 */

import { MongoClient, Db } from 'mongodb';

// Shortlink encoding (copied from lib/shortlinks.ts for standalone use)
const BASE62_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

function bytesToBase62(bytes: Uint8Array): string {
  let num = BigInt(0);
  for (let i = 0; i < bytes.length; i++) {
    num = (num << BigInt(8)) | BigInt(bytes[i]);
  }
  if (num === BigInt(0)) return '0';
  let result = '';
  const base = BigInt(62);
  while (num > BigInt(0)) {
    result = BASE62_CHARS[Number(num % base)] + result;
    num = num / base;
  }
  return result;
}

function encodeShortlink(bookId: string, pageNumber: number): string {
  const bookBytes = new Uint8Array(12);
  for (let i = 0; i < 12; i++) {
    bookBytes[i] = parseInt(bookId.slice(i * 2, i * 2 + 2), 16);
  }
  const pageBytes = new Uint8Array(2);
  pageBytes[0] = (pageNumber >> 8) & 0xFF;
  pageBytes[1] = pageNumber & 0xFF;
  const combined = new Uint8Array(14);
  combined.set(bookBytes);
  combined.set(pageBytes, 12);
  return bytesToBase62(combined);
}

function getShortUrl(bookId: string, pageNumber: number): string {
  return `https://sourcelibrary.org/q/${encodeShortlink(bookId, pageNumber)}`;
}

interface Quote {
  text: string;
  bookTitle: string;
  bookAuthor?: string;
  pageNumber: number;
  bookId: string;
  source: 'highlight' | 'translation';
}

async function getRandomQuote(db: Db): Promise<Quote | null> {
  // Strategy: 50% chance highlights, 50% chance translated passages
  const useHighlights = Math.random() < 0.5;

  if (useHighlights) {
    // Get a random public highlight
    const highlights = await db.collection('highlights').aggregate([
      { $match: { text: { $exists: true } } },
      { $sample: { size: 1 } }
    ]).toArray();

    if (highlights.length > 0) {
      const h = highlights[0];
      return {
        text: h.text,
        bookTitle: h.book_title || 'Unknown',
        bookAuthor: h.book_author,
        pageNumber: h.page_number,
        bookId: h.book_id,
        source: 'highlight'
      };
    }
  }

  // Get a random translated passage with good content
  const pages = await db.collection('pages').aggregate([
    {
      $match: {
        'translation.data': { $exists: true, $ne: '', $regex: '.{200,}' }
      }
    },
    { $sample: { size: 1 } },
    {
      $lookup: {
        from: 'books',
        localField: 'book_id',
        foreignField: 'id',
        as: 'book'
      }
    },
    { $unwind: '$book' }
  ]).toArray();

  if (pages.length > 0) {
    const p = pages[0];
    const translation = p.translation?.data || '';

    // Extract a good quote (first paragraph or first 280 chars)
    const paragraphs = translation.split('\n\n').filter((p: string) => p.trim().length > 50);
    const quote = paragraphs[0] || translation.slice(0, 280);

    return {
      text: quote.trim(),
      bookTitle: p.book?.display_title || p.book?.title || 'Unknown',
      bookAuthor: p.book?.author,
      pageNumber: p.page_number,
      bookId: p.book_id,
      source: 'translation'
    };
  }

  return null;
}

function formatQuoteForTwitter(quote: Quote): string {
  const maxQuoteLength = 200;
  let text = quote.text;

  // Truncate if needed
  if (text.length > maxQuoteLength) {
    text = text.slice(0, maxQuoteLength - 3).trim() + '...';
  }

  // Build citation
  const citation = [
    quote.bookAuthor,
    `"${quote.bookTitle}"`,
    `p. ${quote.pageNumber}`
  ].filter(Boolean).join(', ');

  const url = getShortUrl(quote.bookId, quote.pageNumber);

  return `"${text}"\n\n— ${citation}\n\n${url}`;
}

function formatQuoteForBluesky(quote: Quote): string {
  // Bluesky allows 300 chars, but we want to be concise
  const maxQuoteLength = 180;
  let text = quote.text;

  if (text.length > maxQuoteLength) {
    text = text.slice(0, maxQuoteLength - 3).trim() + '...';
  }

  const citation = [
    quote.bookAuthor,
    `"${quote.bookTitle}"`,
    `p. ${quote.pageNumber}`
  ].filter(Boolean).join(', ');

  const url = getShortUrl(quote.bookId, quote.pageNumber);

  return `"${text}"\n\n— ${citation}\n\n${url}`;
}

async function postToTwitter(content: string): Promise<boolean> {
  const apiKey = process.env.TWITTER_API_KEY;
  const apiSecret = process.env.TWITTER_API_SECRET;
  const accessToken = process.env.TWITTER_ACCESS_TOKEN;
  const accessSecret = process.env.TWITTER_ACCESS_SECRET;

  if (!apiKey || !apiSecret || !accessToken || !accessSecret) {
    console.log('Twitter credentials not configured, skipping...');
    return false;
  }

  try {
    // Using Twitter API v2
    const { TwitterApi } = await import('twitter-api-v2');
    const client = new TwitterApi({
      appKey: apiKey,
      appSecret: apiSecret,
      accessToken: accessToken,
      accessSecret: accessSecret,
    });

    await client.v2.tweet(content);
    console.log('Posted to Twitter successfully!');
    return true;
  } catch (error) {
    console.error('Twitter post failed:', error);
    return false;
  }
}

async function postToBluesky(content: string): Promise<boolean> {
  const handle = process.env.BLUESKY_HANDLE;
  const password = process.env.BLUESKY_APP_PASSWORD;

  if (!handle || !password) {
    console.log('Bluesky credentials not configured, skipping...');
    return false;
  }

  try {
    // Login to Bluesky
    const loginRes = await fetch('https://bsky.social/xrpc/com.atproto.server.createSession', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: handle, password }),
    });

    if (!loginRes.ok) {
      throw new Error(`Login failed: ${loginRes.status}`);
    }

    const session = await loginRes.json();

    // Create post
    const postRes = await fetch('https://bsky.social/xrpc/com.atproto.repo.createRecord', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.accessJwt}`,
      },
      body: JSON.stringify({
        repo: session.did,
        collection: 'app.bsky.feed.post',
        record: {
          text: content,
          createdAt: new Date().toISOString(),
        },
      }),
    });

    if (!postRes.ok) {
      throw new Error(`Post failed: ${postRes.status}`);
    }

    console.log('Posted to Bluesky successfully!');
    return true;
  } catch (error) {
    console.error('Bluesky post failed:', error);
    return false;
  }
}

async function logQuote(db: Db, quote: Quote, posted: { twitter: boolean; bluesky: boolean }) {
  // Keep a log of posted quotes to avoid repeats
  await db.collection('quote_log').insertOne({
    quote_text: quote.text.slice(0, 100),
    book_id: quote.bookId,
    page_number: quote.pageNumber,
    source: quote.source,
    posted_twitter: posted.twitter,
    posted_bluesky: posted.bluesky,
    created_at: new Date(),
  });
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI not set');
    process.exit(1);
  }

  const client = new MongoClient(uri);

  try {
    await client.connect();
    const db = client.db();

    console.log('Fetching random quote...');
    const quote = await getRandomQuote(db);

    if (!quote) {
      console.log('No suitable quote found');
      process.exit(0);
    }

    console.log(`Found quote from "${quote.bookTitle}" (${quote.source})`);
    console.log(`Text: "${quote.text.slice(0, 100)}..."`);

    // Format for each platform
    const twitterContent = formatQuoteForTwitter(quote);
    const blueskyContent = formatQuoteForBluesky(quote);

    console.log('\n--- Twitter format ---');
    console.log(twitterContent);
    console.log('\n--- Bluesky format ---');
    console.log(blueskyContent);

    // Check for dry run mode
    if (process.argv.includes('--dry-run')) {
      console.log('\n[DRY RUN] Would post to social media');
      process.exit(0);
    }

    // Post to platforms
    const posted = {
      twitter: await postToTwitter(twitterContent),
      bluesky: await postToBluesky(blueskyContent),
    };

    // Log the quote
    await logQuote(db, quote, posted);

    console.log('\nDone!');
  } finally {
    await client.close();
  }
}

main().catch(console.error);
