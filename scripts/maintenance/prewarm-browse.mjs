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

// Optionally refresh homepage stats
if (process.env.MONGODB_URI) {
  try {
    const { MongoClient } = await import('mongodb');
    const client = await MongoClient.connect(process.env.MONGODB_URI);
    const db = client.db('bookstore');
    const books = db.collection('books');

    const filter = { hidden: { $ne: true }, pages_count: { $gt: 0 } };
    const translatedFilter = { ...filter, pages_translated: { $gt: 0 } };

    const [totalBooks, translatedToEnglish, firstTranslationCount, authorCount, languageCount] = await Promise.all([
      books.countDocuments(filter),
      books.countDocuments(translatedFilter),
      books.countDocuments({ ...translatedFilter, is_first_translation: true }),
      books.distinct('author', translatedFilter).then(a => a.length),
      books.distinct('language', translatedFilter).then(l => l.filter(x => x && !x.includes(',') && !x.includes(' and ')).length),
    ]);

    const stats = { totalBooks, translatedToEnglish, firstTranslationCount, authorCount, languageCount, updatedAt: new Date() };
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
