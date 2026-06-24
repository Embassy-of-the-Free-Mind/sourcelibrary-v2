#!/usr/bin/env node
/**
 * Geocode books by *cultural origin* (language / textual tradition) for the
 * /explore/map view.
 *
 * WHY THIS EXISTS
 * ---------------
 * The map plots `books.locations[]`, which is populated from two signals:
 *   - publication place  (geocode-publication-places.mjs)
 *   - author birth/death (backfill-author-locations.mjs, via Wikidata)
 * Both are heavily Western-skewed: non-Western books almost never carry a
 * `place_of_publication`, and their authors are rarely linked to a Wikidata
 * entity with coordinates. The result is that whole traditions the library
 * actually holds — 1,400+ Tibetan, ~600 Chinese, Japanese, Korean, Ge'ez,
 * Sanskrit, cuneiform — were invisible on the map (see 2026-06-03 finding).
 *
 * This script adds a THIRD, clearly-labelled layer: `type: 'origin'`. For a
 * curated allowlist of languages whose textual tradition is tightly bound to
 * one region, it places the book at that tradition's historic heartland.
 *
 * SCOPE / HONESTY
 * ---------------
 * - Only "strongly-bound" traditions are included. Diffuse / heavily-diaspora
 *   or printed-in-Europe languages (Latin, Greek, Hebrew, Arabic, the European
 *   vernaculars) are deliberately EXCLUDED — a single dot would misrepresent
 *   them. Honest absence beats a misleading pin.
 * - The layer is `source: 'tradition'`, `confidence: 'inferred'` and renders as
 *   a distinct, toggleable type in the UI. It never claims a precise imprint.
 * - It is a FALLBACK: only added to books that have NO existing location, and
 *   never duplicated. Fully reversible — remove with:
 *     db.books.updateMany({}, { $pull: { locations: { source: 'tradition' } } })
 *
 * Usage:
 *   node scripts/enrichment/geocode-origin-by-tradition.mjs [--dry-run]
 */

import { MongoClient } from 'mongodb';

const DRY_RUN = process.argv.includes('--dry-run');

/**
 * Curated language/tradition → cultural-origin heartland.
 * Keys are normalized (lowercase, alpha-only). Coordinates point at the
 * historic center of the textual tradition, not a modern administrative seat.
 */
const ORIGIN_TRADITIONS = {
  // East / Inner Asia
  tibetan:   { city: 'Lhasa',        country: 'Tibet',        lat: 29.6520, lng: 91.1721 },
  chinese:   { city: 'Beijing',      country: 'China',        lat: 39.9042, lng: 116.4074 },
  japanese:  { city: 'Kyoto',        country: 'Japan',        lat: 35.0116, lng: 135.7681 },
  korean:    { city: 'Seoul',        country: 'South Korea',  lat: 37.5665, lng: 126.9780 },
  mongolian: { city: 'Ulaanbaatar',  country: 'Mongolia',     lat: 47.8864, lng: 106.9057 },
  manchu:    { city: 'Shenyang',     country: 'China',        lat: 41.8057, lng: 123.4315 },

  // South / Southeast Asia
  sanskrit:  { city: 'Varanasi',     country: 'India',        lat: 25.3176, lng: 82.9739 },
  hindi:     { city: 'Varanasi',     country: 'India',        lat: 25.3176, lng: 82.9739 },
  bengali:   { city: 'Kolkata',      country: 'India',        lat: 22.5726, lng: 88.3639 },
  tamil:     { city: 'Thanjavur',    country: 'India',        lat: 10.7870, lng: 79.1378 },
  pali:      { city: 'Anuradhapura', country: 'Sri Lanka',    lat: 8.3114,  lng: 80.4037 },
  javanese:  { city: 'Yogyakarta',   country: 'Indonesia',    lat: -7.7956, lng: 110.3695 },
  balinese:  { city: 'Denpasar',     country: 'Indonesia',    lat: -8.6705, lng: 115.2126 },

  // Ethiopia / Horn of Africa
  geez:      { city: 'Aksum',        country: 'Ethiopia',     lat: 14.1211, lng: 38.7245 },
  amharic:   { city: 'Gondar',       country: 'Ethiopia',     lat: 12.6030, lng: 37.4521 },
  tigrinya:  { city: 'Aksum',        country: 'Ethiopia',     lat: 14.1211, lng: 38.7245 },

  // Ancient Near East / Egypt
  sumerian:  { city: 'Nippur',       country: 'Iraq',         lat: 32.1264, lng: 45.2317 },
  akkadian:  { city: 'Babylon',      country: 'Iraq',         lat: 32.5355, lng: 44.4275 },
  egyptian:  { city: 'Thebes',       country: 'Egypt',        lat: 25.6872, lng: 32.6396 },
  coptic:    { city: 'Alexandria',   country: 'Egypt',        lat: 31.2001, lng: 29.9187 },

  // Caucasus / Levant
  syriac:    { city: 'Edessa',       country: 'Turkey',       lat: 37.1591, lng: 38.7969 },
  armenian:  { city: 'Echmiadzin',   country: 'Armenia',      lat: 40.1620, lng: 44.2910 },

  // Iran
  persian:   { city: 'Isfahan',      country: 'Iran',         lat: 32.6539, lng: 51.6660 },
};

/** Tibetan-script material from Bhutan (Tshamdrak monastery, BL Bhutan corpus). */
const BHUTAN_ORIGIN = { city: 'Thimphu', country: 'Bhutan', lat: 27.4712, lng: 89.6339 };

/**
 * Normalize a language label to an ORIGIN_TRADITIONS key.
 * Handles common variants and punctuation (Ge'ez/Geez/Ethiopic, Farsi, etc.).
 */
function normalizeLanguage(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const k = raw.toLowerCase().replace(/[^a-z]/g, '');
  const aliases = {
    ethiopic: 'geez', geez: 'geez',
    farsi: 'persian', persian: 'persian',
    egyptianhieroglyphs: 'egyptian', ancientegyptian: 'egyptian', egyptian: 'egyptian',
    classicalchinese: 'chinese', literarychinese: 'chinese', mandarin: 'chinese',
    classicaltibetan: 'tibetan',
  };
  if (aliases[k]) return aliases[k];
  return ORIGIN_TRADITIONS[k] ? k : null;
}

/** Pick the tradition key for a book from its language fields. */
function resolveTradition(book) {
  const candidates = [
    book.language,
    ...(Array.isArray(book.languages) ? book.languages : []),
    book.language_multi,
  ];
  for (const c of candidates) {
    const key = normalizeLanguage(c);
    if (key) return key;
  }
  return null;
}

/** Does this book's metadata indicate a Bhutanese (vs Tibetan) origin? */
function isBhutanese(book) {
  const hay = [
    book.author, book.place_published, book.place_of_publication,
    ...(Array.isArray(book.collections) ? book.collections : []),
  ].filter(Boolean).join(' ').toLowerCase();
  return /bhutan|tshamdrak|thimphu|drukpa/.test(hay);
}

async function main() {
  console.log(`Geocode Origin by Tradition — ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  console.log('─'.repeat(60));

  const client = await MongoClient.connect(process.env.MONGODB_URI);
  const db = client.db('bookstore');

  // Candidates: visible books with NO location at all.
  const cursor = db.collection('books').find(
    { visible: true, 'locations.0': { $exists: false } },
    { projection: {
      id: 1, language: 1, languages: 1, language_multi: 1,
      author: 1, place_published: 1, place_of_publication: 1, collections: 1,
    } },
  );

  const counts = {};
  let scanned = 0, matched = 0, updated = 0;

  for await (const book of cursor) {
    scanned++;
    const key = resolveTradition(book);
    if (!key) continue;
    matched++;

    let geo = ORIGIN_TRADITIONS[key];
    if (key === 'tibetan' && isBhutanese(book)) geo = BHUTAN_ORIGIN;

    const label = geo.country;
    counts[label] = (counts[label] || 0) + 1;

    if (DRY_RUN) continue;

    const location = {
      type: 'origin',
      city: geo.city,
      country: geo.country,
      lat: geo.lat,
      lng: geo.lng,
      source: 'tradition',
      confidence: 'inferred',
    };
    const res = await db.collection('books').updateOne(
      { _id: book._id, 'locations.source': { $ne: 'tradition' } },
      { $push: { locations: location } },
    );
    updated += res.modifiedCount;
  }

  console.log(`\nScanned ${scanned} location-less visible books`);
  console.log(`Matched a strongly-bound tradition: ${matched}`);
  console.log(`${DRY_RUN ? 'Would update' : 'Updated'}: ${DRY_RUN ? matched : updated} books\n`);

  console.log('By origin country:');
  for (const [c, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${c.padEnd(14)} ${n}`);
  }

  console.log('\n' + '─'.repeat(60));
  console.log('Done.');
  await client.close();
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
