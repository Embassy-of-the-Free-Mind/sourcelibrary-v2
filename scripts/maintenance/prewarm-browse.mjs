#!/usr/bin/env node
/**
 * Pre-warm all browse pages so no visitor ever hits a cold ISR build.
 * Just fetches each URL — Vercel serves the cached page or triggers a rebuild.
 *
 * Run daily via cron (Hetzner or local):
 *   0 5 * * * node /path/to/prewarm-browse.mjs >> /tmp/prewarm-browse.log 2>&1
 *
 * Also refreshes homepage stats in system_config if MONGODB_URI is set.
 */

const BASE = process.env.SITE_URL || 'https://sourcelibrary.org';
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const PERIODS = ['ancient', 'medieval', '1400s', '1500s', '1600s', '1700s', '1800s', '1900s'];

const urls = [
  '/browse',
  ...LETTERS.map(l => `/browse/titles/${l}`),
  ...LETTERS.map(l => `/browse/authors/${l}`),
  ...PERIODS.map(p => `/browse/years/${p}`),
];

console.log(`Pre-warming ${urls.length} browse pages on ${BASE}...`);

let ok = 0;
let fail = 0;

// Fetch in batches of 5 to be polite
for (let i = 0; i < urls.length; i += 5) {
  const batch = urls.slice(i, i + 5);
  const results = await Promise.allSettled(
    batch.map(async (path) => {
      const res = await fetch(`${BASE}${path}`, { method: 'GET', redirect: 'follow' });
      if (!res.ok) throw new Error(`${res.status}`);
      // Consume body to complete the request
      await res.text();
      return path;
    })
  );
  for (const r of results) {
    if (r.status === 'fulfilled') {
      ok++;
    } else {
      fail++;
      console.error(`  FAIL: ${r.reason}`);
    }
  }
}

console.log(`Done: ${ok} OK, ${fail} failed (${new Date().toISOString()})`);

// Optionally refresh homepage stats. Filter logic must stay in sync with
// scripts/maintenance/update-homepage-stats.mjs — homepage reads the same
// system_config doc and expects all 7 fields (incl. artwork + illustration counts).
if (process.env.MONGODB_URI) {
  try {
    const { MongoClient } = await import('mongodb');
    const client = await MongoClient.connect(process.env.MONGODB_URI);
    const db = client.db('bookstore');
    const books = db.collection('books');

    const filter = { visible: true, pages_count: { $gt: 0 } };
    const translatedFilter = { ...filter, pages_translated: { $gt: 0 } };
    const readableFilter = {
      ...translatedFilter,
      $expr: { $gte: ['$pages_translated', { $multiply: [{ $subtract: [{ $ifNull: ['$pages_ocr', 0] }, { $ifNull: ['$pages_blank', 0] }] }, 0.9] }] },
    };
    // Artworks: single-object entries (content_type:'artwork') — see update-homepage-stats.mjs for rationale.
    const artworkFilter = { visible: true, content_type: 'artwork' };

    const [totalBooks, translatedToEnglish, firstTranslationCount, authorCount, languageCount, artworkCount, illustrationCount] = await Promise.all([
      books.countDocuments(filter),
      books.countDocuments(readableFilter),
      books.countDocuments({ ...translatedFilter, is_first_translation: true }),
      books.distinct('author', translatedFilter).then(a => a.length),
      books.distinct('language', translatedFilter).then(l => l.filter(x => x && !x.includes(',') && !x.includes(' and ')).length),
      books.countDocuments(artworkFilter),
      db.collection('gallery_images').countDocuments({}),
    ]);

    const stats = { totalBooks, translatedToEnglish, firstTranslationCount, authorCount, languageCount, artworkCount, illustrationCount, updatedAt: new Date() };
    await db.collection('system_config').updateOne(
      { _id: 'homepage_stats' },
      { $set: stats },
      { upsert: true },
    );
    console.log('Homepage stats refreshed:', stats);
    await client.close();
  } catch (e) {
    console.error('Stats refresh failed (non-fatal):', e.message);
  }
}
