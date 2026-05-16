#!/usr/bin/env node
/**
 * Audit cover-field divergence: for every visible book (optionally scoped to a
 * tenant), count how many have `image_display` and `thumbnail` pointing at
 * different URLs (after light normalization). This surfaces books where
 * different writers updated different fields — the cause of the issue where
 * /book/<slug> shows one cover and /embed/<tenant> shows another.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/audit-cover-field-divergence.mjs                # all visible books
 *   node scripts/audit-cover-field-divergence.mjs --tenant bph   # BPH only
 *   node scripts/audit-cover-field-divergence.mjs --tenant bph --sample 20
 */

import { MongoClient } from 'mongodb';

const args = process.argv.slice(2);
const TENANT = (() => {
  const i = args.indexOf('--tenant');
  return i !== -1 ? args[i + 1] : null;
})();
const SAMPLE = (() => {
  const i = args.indexOf('--sample');
  return i !== -1 ? parseInt(args[i + 1], 10) : 10;
})();

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('MONGODB_URI not set. Source .env.production.local first.');
  process.exit(1);
}

const client = new MongoClient(MONGODB_URI);

function normalize(u) {
  if (!u) return null;
  // Treat /pages/.../X.jpg, X-thumb.jpg, X-full.jpg as the same logical page.
  return u
    .replace(/-thumb\.jpg(\?.*)?$/, '.jpg')
    .replace(/-full\.jpg(\?.*)?$/, '.jpg');
}

await client.connect();
try {
  const db = client.db('bookstore');
  const match = { visible: true };
  if (TENANT) {
    // BPH books are tagged via image_source.provider rather than tenantId slug.
    if (TENANT === 'bph') match['image_source.provider'] = 'bph';
    else match.tenantId = TENANT;
  }

  const cursor = db.collection('books').find(match, {
    projection: {
      id: 1, slug: 1, title: 1,
      image_display: 1, image_thumb: 1, thumbnail: 1, thumbnail_blob: 1,
      thumbnail_source: 1,
    },
  });

  let total = 0;
  let bothSet = 0;
  let onlyLegacy = 0;     // thumbnail set, image_display unset
  let onlyCanonical = 0;  // image_display set, thumbnail unset
  let neither = 0;
  let divergentDisplay = 0;
  const samples = [];

  for await (const b of cursor) {
    total++;
    const display = b.image_display || null;
    const legacy = b.thumbnail || null;
    if (display && legacy) {
      bothSet++;
      if (normalize(display) !== normalize(legacy)) {
        divergentDisplay++;
        if (samples.length < SAMPLE) {
          samples.push({
            id: b.id, slug: b.slug, title: (b.title || '').slice(0, 70),
            thumbnail_source: b.thumbnail_source || null,
            image_display: display,
            thumbnail: legacy,
          });
        }
      }
    } else if (legacy) {
      onlyLegacy++;
    } else if (display) {
      onlyCanonical++;
    } else {
      neither++;
    }
  }

  console.log(JSON.stringify({
    scope: TENANT ? `tenant=${TENANT}` : 'all visible',
    total,
    bothSet,
    divergentDisplay,
    onlyLegacy,
    onlyCanonical,
    neither,
    samples,
  }, null, 2));
} finally {
  await client.close();
}
