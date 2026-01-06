/**
 * Archive archive.org images like a human browsing
 * - Random delays (2-12s, occasional longer breaks)
 * - Rotating user agents
 * - Random access order (not sequential)
 * - Referrer headers
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { MongoClient } from 'mongodb';
import { put } from '@vercel/blob';

// Realistic user agents (recent browsers)
const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0',
];

// Random delay between min and max ms
function randomDelay(minMs, maxMs) {
  return Math.floor(Math.random() * (maxMs - minMs)) + minMs;
}

// Occasionally take a "break" like a human would
function shouldTakeBreak() {
  return Math.random() < 0.03; // 3% chance of longer break
}

async function archiveHumanLike() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB);

  console.log('=== Archiving archive.org (Human-like) ===');
  console.log('Random delays: 2-12s, occasional breaks\n');

  const query = {
    photo: { $regex: 'archive\\.org', $options: 'i' },
    $or: [
      { archived_photo: { $exists: false } },
      { archived_photo: null },
      { archived_photo: '' }
    ]
  };

  const totalCount = await db.collection('pages').countDocuments(query);
  console.log(`Found ${totalCount} archive.org pages needing archiving\n`);

  if (totalCount === 0) {
    await client.close();
    return;
  }

  let archived = 0;
  let failed = 0;
  let consecutive403 = 0;
  const startTime = Date.now();
  let currentUserAgent = USER_AGENTS[0];
  let requestsWithCurrentUA = 0;

  while (true) {
    // Random access: skip random number of results
    const skip = Math.floor(Math.random() * Math.min(100, totalCount - archived));
    const page = await db.collection('pages').findOne(query, { skip });

    if (!page) break;

    // Rotate user agent every 10-30 requests
    requestsWithCurrentUA++;
    if (requestsWithCurrentUA > 10 + Math.floor(Math.random() * 20)) {
      currentUserAgent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
      requestsWithCurrentUA = 0;
    }

    const sourceUrl = page.photo;

    // Build referrer from the book's archive.org page
    const urlMatch = sourceUrl.match(/archive\.org\/download\/([^/]+)/);
    const itemId = urlMatch ? urlMatch[1] : null;
    const referrer = itemId
      ? `https://archive.org/details/${itemId}`
      : 'https://archive.org/';

    try {
      const response = await fetch(sourceUrl, {
        headers: {
          'User-Agent': currentUserAgent,
          'Referer': referrer,
          'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        }
      });

      if (response.status === 403) {
        consecutive403++;
        failed++;
        console.log(`⚠ 403 (${consecutive403}/5) - backing off...`);

        if (consecutive403 >= 5) {
          console.log('\n❌ 5 consecutive 403s - stopping.');
          break;
        }
        // Longer backoff on 403
        await new Promise(r => setTimeout(r, randomDelay(30000, 60000)));
        continue;
      }

      if (!response.ok) {
        failed++;
        console.log(`✗ HTTP ${response.status}`);
        await new Promise(r => setTimeout(r, randomDelay(2000, 5000)));
        continue;
      }

      consecutive403 = 0;

      const buffer = await response.arrayBuffer();
      const bytes = buffer.byteLength;

      const filename = `archived/${page.book_id}/${page.page_number}.jpg`;
      const blob = await put(filename, Buffer.from(buffer), {
        access: 'public',
        contentType: response.headers.get('content-type') || 'image/jpeg',
        addRandomSuffix: false,
        allowOverwrite: true,
      });

      await db.collection('pages').updateOne(
        { id: page.id },
        {
          $set: {
            archived_photo: blob.url,
            'archive_metadata.archived_at': new Date(),
            'archive_metadata.source_url': sourceUrl,
            'archive_metadata.bytes': bytes,
            updated_at: new Date()
          }
        }
      );

      archived++;
      const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
      const rate = (archived / (Date.now() - startTime) * 60000).toFixed(1);
      const remaining = totalCount - archived - failed;
      console.log(`✓ ${archived} done | ${remaining} left | ${rate}/min | ${elapsed}m`);

    } catch (error) {
      failed++;
      console.log(`✗ ${error.message.slice(0, 40)}`);
    }

    // Human-like delays (~9/min average = ~6.5s avg delay)
    if (shouldTakeBreak()) {
      const breakTime = randomDelay(15000, 30000);
      console.log(`   ☕ Taking a ${(breakTime/1000).toFixed(0)}s break...`);
      await new Promise(r => setTimeout(r, breakTime));
    } else {
      // Normal random delay between 3-10 seconds (~6.5s avg)
      await new Promise(r => setTimeout(r, randomDelay(3000, 10000)));
    }
  }

  const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log(`\n=== Done ===`);
  console.log(`Archived: ${archived} | Failed: ${failed} | Time: ${duration}min`);

  await client.close();
}

archiveHumanLike().catch(e => {
  console.error('Error:', e);
  process.exit(1);
});
