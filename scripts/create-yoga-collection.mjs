#!/usr/bin/env node
/**
 * Create the "Yoga" curated collection and tag its books.
 *
 * The collection surfaces ~30 recently imported classical asana manuals,
 * tantric/chakra texts, Patanjali editions, Western reception writers,
 * and a small Christian/Daoist parallel-tradition section.
 *
 * The script:
 *   1. Flips imported books from hidden -> visible (only when they have
 *      pages_translated > 0; books still in OCR keep hidden=true and are
 *      excluded from the page filter automatically).
 *   2. Tags every yoga book with collections: ['yoga', ...existing].
 *   3. Upserts the `collections` doc with editorial copy:
 *      - expanded_description (3 paragraphs)
 *      - highlighted_books (3 tiers, ~20 books with notes)
 *      - mentioned_books (title -> book_id mappings for linkBookTitles)
 *      - curation_todo (tracks pipeline-blocked work)
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/create-yoga-collection.mjs
 *   node scripts/create-yoga-collection.mjs --dry-run
 */

import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('MONGODB_URI not set. Source .env.production.local first.');
  process.exit(1);
}

const DRY_RUN = process.argv.includes('--dry-run');
const SLUG = 'yoga';

// ─── Book lists ────────────────────────────────────────────────────────

/**
 * Every slug in `BOOKS_TO_TAG` will be tagged with the yoga collection.
 * Books where pages_translated > 0 are also flipped visible:true,
 * hidden:false so they render on the collection page.
 * Books still untranslated keep hidden:true; they remain attached to the
 * collection and will appear automatically when translation lands.
 */
const BOOKS_TO_TAG = [
  // Asana / Hatha manuals
  'the-hatha-yoga-pradipika-sinh',
  'light-on-hatha-yoga-hathayogapradipika-with-commentaries-svatmarama',
  'hathayogapradipika-sanskrit-1867-svatmarama',
  'hatha-yoga-pradipika-1895-hindi-commentary',
  'the-gheranda-samhita-s-c-vasu-translation-vasu',
  'gheranda-samhita-sanskrit-english-gheranda',
  'the-siva-samhita-vasu',
  'siva-samhita-khemraj-publishers-edition-ed',

  // Chakra / tantric / kundalini
  'the-serpent-power-woodroffe',
  'shat-chakra-nirupana-of-purnananda-yati-shastri',
  'tantrik-texts-vol-2-shat-chakra-nirupana-paduka-panchaka-vidyaratna',
  'tantrik-texts-vol-ii-1913-woodroffe',
  'tantrik-texts-vol-iii-1914-woodroffe',
  'tantrik-texts-vol-iv-1915-woodroffe',
  'tantrik-texts-vol-v-1917-woodroffe',
  'tantrik-texts-vol-vi-1917-woodroffe',
  'tantrik-texts-vol-vii-1919-woodroffe',
  'tantrik-texts-vol-xi-hindi-1922-woodroffe',
  'tantra-of-the-great-liberation-mahanirvana-tantra-woodroffe',
  'mahanirvana-tantra-jibananda-vidyasagara-1884-ed',
  'kularnava-tantra-english-translation-arthur-avalon-woodroffe',
  'tantraraja-tantra-woodroffe-mishra',
  'tantric-texts-vol-i-tantrabhidhana-woodroffe',
  'shakti-and-shakta-1918-woodroffe',
  'shakti-and-shakta-3rd-ed-1927-woodroffe',
  'the-mysterious-kundalini-1927-rele',
  'sri-tattva-nidhi-vol-3-siva-nidhi-institute',
  'sri-tattva-nidhi-vol-4-brahma-nidhi-with-kannada-translation-institute',
  'illustrated-six-chakras-swaroop',           // book_id 6991d8978c1030b12444c035
  'chakra-and-nadi-in-the-shaiva-tradition',   // book_id 6991d89d8c1030b12444c140

  // Patanjali / philosophy
  'yoga-sutra-with-three-classical-commentaries-sanskrit-patanjali-with-vyasa',
  'yoga-darsana-sutras-with-the-commentary-of-vyasa-vyasa',
  'yoga-system-of-patanjali-woods-harvard-woods',
  'yoga-sastra-the-yoga-sutras-of-patanjali-examined-notice',

  // Mallakhamb
  'mallakhamb-1922-indian-pole-gymnastics-manual-sapre',

  // Western reception
  'raja-yoga-swami-vivekananda-vivekananda',
  'a-series-of-lessons-in-raja-yoga-atkinson',
  'a-series-of-lessons-in-gnani-yoga-atkinson',
  'an-introduction-to-yoga-besant',
  'advanced-course-in-yogi-philosophy-and-oriental-occultism-atkinson',
  'science-of-breath-atkinson',
  'the-yoga-philosophy-tookaram-tatya',
  'yoga-or-transformation-a-comparative-statement-of-the-flagg',

  // Non-Indic parallel traditions
  'dobrotolyubie-1793-slavonic-philokalia-eds',
  'sancti-patris-nostri-ioannis-scholastici-john-climacus-climacus',
  'indication-of-the-way-into-the-kingdom-of-heaven-veniaminov',
  'iohannis-cassiani-conlationes-xxiiii-petschenig-ed-1886-petschenig',
  'philokalia-greek-eds',
];

// ─── Editorial copy ────────────────────────────────────────────────────

const EXPANDED_DESCRIPTION = `Yoga is older and stranger than the modern studio reading suggests. The texts gathered here range from the eighth-century Patanjali commentary tradition through the Hatha Yoga Pradipika and its many editions, the chakra and kundalini literature of the tantras, and the Western reception that begins with Vivekananda's Raja Yoga in 1896 and continues through Annie Besant and the Yogi Publication Society. Asana — the postures most people now mean by "yoga" — is one strand among several. The Yoga Sūtra catalogues eight limbs; classical hatha manuals like the Hatha Yoga Pradipika, Gheranda Samhita, and Siva Samhita add detailed procedures for purification, breath, mudra, and meditation; tantric texts such as the Mahanirvana Tantra and Shat Chakra Nirupana frame the body as a cosmographic instrument.

Two thirds of this collection consists of original-language sources. The 1867 Sanskrit Hathayogapradipika prints Svatmarama's verses without the modernizing apparatus that later English editions impose. The 1895 Hindi commentary edition shows how the text was being read inside the tradition during the lifetime of Vivekananda. The Tantrik Texts series edited by John Woodroffe between 1913 and 1922 is the largest single body of tantric scholarship ever published in English, and most of it has remained out of print since. Alongside the Indian texts the collection includes a small parallel-tradition section — the 1793 Slavonic Philokalia, John Climacus's Ladder of Divine Ascent, and Cassian's Conlationes — texts that develop their own technical vocabulary for breath, attention, and the transformation of the body in prayer.

One thing this collection cannot yet offer is a printed Indian asana manual with plates. The earliest surviving illustrated asana manuscripts — the Sritattvanidhi of the Mysore court, the Joga Pradipika — circulated as palace copies and are still difficult to obtain in scanned form. Volumes 3 and 4 of the Sritattvanidhi are included here as Sanskrit text without their illustrations. The visual record of asana before the twentieth century remains a real gap, and a high-resolution scan of the illustrated Sritattvanidhi or of a complete Joga Pradipika manuscript would be the single most valuable addition this collection could acquire.`;

// Mentions whose `text` appears verbatim in the description. linkBookTitles
// matches longest-first so the heavier ones (full titles) win over short ones.
const MENTIONED_BOOKS = [
  { text: 'Yoga Sūtra', book_id: '69935b4d8e28d8f4c5d3cfaa' },
  { text: 'Hatha Yoga Pradipika', book_id: '6992cf0c284cdd19fef46e75' },
  { text: 'Gheranda Samhita', book_id: '6a0eb37c283b678bc95b9654' },
  { text: 'Siva Samhita', book_id: '6a0eb37f283b678bc95b9699' },
  { text: 'Mahanirvana Tantra', book_id: '69d7e0c5e9e5e67989c36f72' },
  { text: 'Shat Chakra Nirupana', book_id: '6a0eb388283b678bc95b97a9' },
  { text: 'Raja Yoga', book_id: '6953c81c77f38f6761bdbd7b' },
  { text: 'Sritattvanidhi', book_id: '6a0e582ab8ad266ebed2393f' },
  { text: 'Philokalia', book_id: '6953a54c77f38f6761bcf531' },
  { text: 'Ladder of Divine Ascent', book_id: '6a0efcb391042301b33812ae' },
  { text: 'Conlationes', book_id: '6a0f069f900fb4799cef1d4d' },
  { text: 'Hathayogapradipika', book_id: '6a0e54e98831ddc9459ad225' },
  { text: 'Tantrik Texts', book_id: '6a0f06b0900fb4799cef2302' },
];

// Three tiers, ordered by curatorial weight.
const HIGHLIGHTED_BOOKS = [
  // ── Tier 1: Essential reading ──
  {
    book_id: '6992cf0c284cdd19fef46e75',
    tier: 1, rank: 1,
    note: 'The Hatha Yoga Pradipika of Svatmarama is the foundational fifteenth-century manual of hatha. Pancham Sinh\'s 1915 edition gives Sanskrit verse with a literal English rendering — the cleanest entry into asana, pranayama, mudra, and samadhi as a unified discipline.',
  },
  {
    book_id: '69935b4d8e28d8f4c5d3cfaa',
    tier: 1, rank: 2,
    note: 'The Yoga-Sūtra of Patanjali with Vyasa\'s Bhashya, Vachaspati Mishra\'s Tattvavaisharadi, and Vijnanabhikshu\'s Yogavarttika. Three classical commentaries side by side — the canonical philosophical apparatus of yoga as Indian readers received it.',
  },
  {
    book_id: '6953c81677f38f6761bdb4c6',
    tier: 1, rank: 3,
    note: 'James Haughton Woods\'s 1914 Harvard Oriental Series translation of the Yoga-Sūtra with Vyasa\'s commentary. Still the most philologically careful English version, with Sanskrit transliteration and dense scholarly footnotes throughout.',
  },
  {
    book_id: '69d7e0c5e9e5e67989c36f72',
    tier: 1, rank: 4,
    note: 'Mahanirvana Tantra in the 1884 Jibananda Vidyasagara edition — the principal Bengali-school tantric text, with full Sanskrit, that John Woodroffe later translated. Cosmology, ritual, mantra, and the philosophical defense of tantric practice.',
  },
  {
    book_id: '6991d89a8c1030b12444c076',
    tier: 1, rank: 5,
    note: 'Hathayogapradipika with the Jyotsna commentary of Brahmananda and the Manobhilasini commentary. The two commentaries Indian practitioners actually used to make sense of Svatmarama — neither widely available in English translation.',
  },
  {
    book_id: '6953c81c77f38f6761bdbd7b',
    tier: 1, rank: 6,
    note: 'Vivekananda\'s Raja Yoga (1896) — the text that launched the Western reception of yoga. A Bengali Vedantin\'s reading of the Yoga-Sūtra, delivered as lectures in New York, that fixed the modern idiom for talking about meditation in English.',
  },

  // ── Tier 2: Important works ──
  {
    book_id: '6991d8978c1030b12444c035',
    tier: 2, rank: 7,
    note: 'Satchakranirupanacitram, an illustrated six-chakras manuscript. Among the few sources in the collection with finished diagrams of the cakra system.',
  },
  {
    book_id: '6991d89d8c1030b12444c140',
    tier: 2, rank: 8,
    note: 'Chakra and Nadi in the Shaiva Tradition — illustrated yogic anatomy showing the subtle channels of the body as Shaiva practitioners conceived them.',
  },
  {
    book_id: '69bd9bce46b01553e33bf05c',
    tier: 2, rank: 9,
    note: 'Woodroffe\'s 1924 Serpent Power — the 740-page foundational study of kundalini, the chakras, and the Shat Chakra Nirupana. Translation still in the pipeline; the page images and plates are already browsable.',
  },
  {
    book_id: '6a0eb388283b678bc95b97a9',
    tier: 2, rank: 10,
    note: 'Shat Chakra Nirupana of Purnananda Yati — the sixteenth-century Sanskrit core text on the six chakras that Woodroffe used as the spine of The Serpent Power.',
  },
  {
    book_id: '6a0eb37c283b678bc95b9654',
    tier: 2, rank: 11,
    note: 'Gheranda Samhita in a Sanskrit-English bilingual edition. The seven-limbed hatha system of Gheranda, more procedural than the Hatha Yoga Pradipika and stronger on body-cleansing techniques (shatkarma).',
  },
  {
    book_id: '6a0eb379283b678bc95b9611',
    tier: 2, rank: 12,
    note: 'S. C. Vasu\'s influential English translation of the Gheranda Samhita, widely circulated in the early Theosophical Society and among the first Western yoga teachers.',
  },
  {
    book_id: '6a0eb37f283b678bc95b9699',
    tier: 2, rank: 13,
    note: 'The Siva Samhita in Vasu\'s English translation. The third pillar of the classical hatha trilogy alongside the Hatha Yoga Pradipika and Gheranda Samhita.',
  },
  {
    book_id: '6953c81f77f38f6761bdbe34',
    tier: 2, rank: 14,
    note: 'Yoga-Darsana: the Yoga-Sūtra with Vyasa\'s Bhashya in the Bombay 1907 edition. A more accessible Sanskrit-with-English layout than the Harvard or Bombay critical editions.',
  },
  {
    book_id: '6953e30577f38f6761beb59f',
    tier: 2, rank: 15,
    note: 'Kularnava Tantra translated by Woodroffe — central to the Kaula tantric tradition, on the relation of ritual, ethics, and direct yogic experience.',
  },
  {
    book_id: '6991d46721124c9ad6944195',
    tier: 2, rank: 16,
    note: 'Tantraraja Tantra in Woodroffe and Mishra\'s edition — a long ritual-yogic synthesis of the Srividya school, dense with chakra and mantra material.',
  },

  // ── Tier 3: Also notable ──
  {
    book_id: '6991bd1c70254d38471e23cc',
    tier: 3, rank: 17,
    note: 'William Walker Atkinson, writing as Yogi Ramacharaka, A Series of Lessons in Raja Yoga (1906) — the most widely circulated American-yoga primer of its decade.',
  },
  {
    book_id: '6991bd1e70254d38471e250c',
    tier: 3, rank: 18,
    note: 'A Series of Lessons in Gnani Yoga, the jnana-yoga volume in Atkinson\'s Ramacharaka series — Vedanta repackaged for early-twentieth-century American readers.',
  },
  {
    book_id: '69528b6bab34727b1f04f53e',
    tier: 3, rank: 19,
    note: 'Annie Besant\'s 1908 Introduction to Yoga — four lectures from the Adyar Theosophical convention that show how Patanjali was being read inside the Theosophical Society.',
  },
  {
    book_id: '6991bd1470254d38471e1f0d',
    tier: 3, rank: 20,
    note: 'Atkinson\'s Science of Breath (1903) — the seed text behind Western pranayama instruction, often plagiarised, rarely cited.',
  },
  {
    book_id: '6a0e5628b8ad266ebed2350f',
    tier: 3, rank: 21,
    note: 'Mallakhamb (1922), the Marathi manual of pole-gymnastic yoga from Pune. An athletic counter-tradition to the seated practice the Hatha Yoga Pradipika describes, and an interesting bridge to modern physical-culture yoga.',
  },
  {
    book_id: '6a0efca491042301b338115f',
    tier: 3, rank: 22,
    note: 'The 1793 Slavonic Philokalia of Paisius Velichkovsky — the parallel-tradition manual of Eastern Christian hesychasm, where breath, posture, and the Jesus Prayer form their own praxis with strong structural parallels to yogic technique.',
  },
  {
    book_id: '6a0efcb391042301b33812ae',
    tier: 3, rank: 23,
    note: 'John Climacus\'s Ladder of Divine Ascent in the 1633 Greek-Latin edition — the seventh-century Sinai handbook on the stages of monastic practice that informed every later hesychast author.',
  },
  {
    book_id: '6a0f069f900fb4799cef1d4d',
    tier: 3, rank: 24,
    note: 'Cassian\'s Conlationes in Petschenig\'s 1886 critical Latin edition. The conferences of the Egyptian desert fathers that introduced contemplative breath-attention into the Latin West.',
  },
];

// ─── Run ────────────────────────────────────────────────────────────────

async function main() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  console.log(`${DRY_RUN ? '[DRY RUN] ' : ''}Building yoga collection...`);

  // 1. Resolve slugs -> book documents.
  const books = await db.collection('books').find(
    { slug: { $in: BOOKS_TO_TAG } },
    {
      projection: {
        _id: 1, id: 1, slug: 1, title: 1, year: 1, language: 1,
        pages_count: 1, pages_translated: 1, visible: 1, hidden: 1,
        collections: 1, thumbnail: 1, thumbnail_blob: 1, author: 1,
      },
    },
  ).toArray();

  const foundSlugs = new Set(books.map(b => b.slug));
  const missing = BOOKS_TO_TAG.filter(s => !foundSlugs.has(s));
  console.log(`  Resolved ${books.length}/${BOOKS_TO_TAG.length} books`);
  if (missing.length) {
    console.log('  Missing slugs (skipping):');
    for (const s of missing) console.log(`    - ${s}`);
  }

  // 2. Flip newly imported books to visible if they have at least some
  //    translation (pages_translated > 0). Books still in OCR keep hidden=true
  //    and are filtered out by the collection page automatically.
  const toUnhide = books.filter(b => b.hidden === true && (b.pages_translated || 0) > 0);
  console.log(`  ${toUnhide.length} books to flip visible (have pages_translated > 0):`);
  for (const b of toUnhide) {
    console.log(`    + ${b.slug} (t=${b.pages_translated}/${b.pages_count})`);
  }

  const stillHidden = books.filter(b => b.hidden === true && !(b.pages_translated > 0));
  if (stillHidden.length) {
    console.log(`  ${stillHidden.length} books kept hidden (no translation yet):`);
    for (const b of stillHidden) {
      console.log(`    - ${b.slug} (t=${b.pages_translated || 0}/${b.pages_count})`);
    }
  }

  if (!DRY_RUN && toUnhide.length) {
    const r = await db.collection('books').updateMany(
      { _id: { $in: toUnhide.map(b => b._id) } },
      { $set: { visible: true, hidden: false, updated_at: new Date() } },
    );
    console.log(`  ✓ Flipped ${r.modifiedCount} books visible`);
  }

  // 3. Tag every book with collections: 'yoga'.
  if (!DRY_RUN) {
    const r = await db.collection('books').updateMany(
      { _id: { $in: books.map(b => b._id) } },
      { $addToSet: { collections: SLUG } },
    );
    console.log(`  ✓ Tagged ${r.modifiedCount} books with collections:'${SLUG}'`);
  }

  // 4. Count visible books that will actually show on the collection page.
  const visibleCount = await db.collection('books').countDocuments({
    collections: SLUG,
    visible: true,
    pages_count: { $gt: 0 },
    pages_translated: { $gt: 0 },
  });
  console.log(`  ${visibleCount} books will appear on /collections/${SLUG}`);

  // 5. Build language breakdown for the collection's `languages` field.
  const langCounts = {};
  for (const b of books) {
    const lang = b.language || 'Unknown';
    langCounts[lang] = (langCounts[lang] || 0) + 1;
  }
  const languages = Object.entries(langCounts)
    .map(([lang, count]) => ({ lang, count }))
    .sort((a, b) => b.count - a.count);

  // 6. Upsert collections document.
  const now = new Date();
  const collectionDoc = {
    slug: SLUG,
    name: 'Yoga',
    subtitle: 'Asana, pranayama, chakra, and the philosophical schools — Sanskrit sources alongside their first Western readers.',
    description: 'Classical asana manuals, tantric chakra texts, the Yoga-Sūtra with its commentaries, and the early-twentieth-century writers — Vivekananda, Atkinson, Besant, Woodroffe — who carried yoga into English.',
    expanded_description: EXPANDED_DESCRIPTION,
    color: 'amber',
    order: 6,
    book_count: visibleCount,
    languages,
    highlighted_books: HIGHLIGHTED_BOOKS,
    mentioned_books: MENTIONED_BOOKS,
    featured_images: [],
    visible: true,
    type: 'curated',
    published: true,
    curation_todo: [
      { item: 'Acquire and import a complete illustrated Sritattvanidhi (with asana plates)', status: 'pending' },
      { item: 'Acquire scanned Joga Pradipika manuscript copies', status: 'pending' },
      { item: 'Finish Serpent Power translation pipeline (740 pages, chakra plates)', status: 'blocked', blocked_by: 'pipeline' },
      { item: 'Finish full OCR + translation of Tantrik Texts vols II–VII and XI', status: 'blocked', blocked_by: 'pipeline' },
      { item: 'Generate curated_gallery once Serpent Power and Sritattvanidhi images extract', status: 'blocked', blocked_by: 'pipeline' },
      { item: 'Add verified quotes from Yoga-Sūtra and Hatha Yoga Pradipika once page-aligned', status: 'pending' },
      { item: 'Unhide and add Mysterious Kundalini, Shakti and Shakta, Yoga Philosophy, Yoga or Transformation once translated', status: 'blocked', blocked_by: 'pipeline' },
    ],
    updated_at: now,
  };

  if (DRY_RUN) {
    console.log('\n[DRY RUN] Would upsert collection:');
    console.log('  slug:', collectionDoc.slug);
    console.log('  name:', collectionDoc.name);
    console.log('  expanded_description chars:', collectionDoc.expanded_description.length);
    console.log('  highlighted_books:', collectionDoc.highlighted_books.length);
    console.log('  mentioned_books:', collectionDoc.mentioned_books.length);
    console.log('  languages:', collectionDoc.languages.map(l => `${l.lang}(${l.count})`).join(', '));
    console.log('  book_count:', collectionDoc.book_count);
  } else {
    const existing = await db.collection('collections').findOne({ slug: SLUG });
    if (existing) {
      await db.collection('collections').updateOne(
        { slug: SLUG },
        { $set: collectionDoc },
      );
      console.log(`  ✓ Updated existing collection '${SLUG}'`);
    } else {
      collectionDoc.created_at = now;
      await db.collection('collections').insertOne(collectionDoc);
      console.log(`  ✓ Created collection '${SLUG}'`);
    }
  }

  await client.close();
  console.log('\nDone.');
  if (!DRY_RUN) {
    console.log(`Visit: https://sourcelibrary.org/collections/${SLUG}`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
