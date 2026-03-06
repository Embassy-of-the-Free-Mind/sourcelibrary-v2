#!/usr/bin/env node
// Cuneiform Tablet OCR — Proof of Concept
// Imports 5 test tablets from CDLI as "books" in Source Library
// Each tablet face photo = one page
// Stores cuneiform-specific OCR + translation prompts in DB
//
// Usage: secret-lover run -- node _tmp-import-cuneiform.mjs [--dry-run] [--prompts-only]

import { MongoClient, ObjectId } from 'mongodb';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const PROMPTS_ONLY = args.includes('--prompts-only');

// ---------------------------------------------------------------------------
// CDLI URL helpers
// ---------------------------------------------------------------------------
const cdliPhoto = (p) => `https://cdli.earth/dl/photo/${p}.jpg`;
const cdliPhotoDetail = (p) => `https://cdli.earth/dl/photo/${p}_d.jpg`;
const cdliThumbnail = (p) => `https://cdli.earth/dl/tn_photo/${p}.jpg`;
const cdliLineart = (p) => `https://cdli.earth/dl/lineart/${p}_l.jpg`;
const cdliArtifact = (n) => `https://cdli.earth/artifacts/${n}`;
const cdliAtf = (n) => `https://cdli.earth/artifacts/${n}/inscription/atf`;

// ---------------------------------------------------------------------------
// 5 Test Tablets — curated for script/period diversity
// ---------------------------------------------------------------------------
const TABLETS = [
  {
    cdli_id: 'P102318',
    cdli_number: 102318,
    title: 'Ur III Administrative Tablet (Drehem)',
    author: 'Unknown scribe (Puzriš-Dagan)',
    language: 'Sumerian',
    published: 'ca. 2038 BC',
    year: -2038,
    period: 'Ur III (ca. 2100-2000 BC)',
    script_type: 'Neo-Sumerian',
    genre: 'administrative',
    museum: 'Michael C. Carlos Museum, Emory University',
    museum_number: 'X.3.072',
    description: 'Records receipt of 2 grain-fed sheep on the 7th day, from Abbasaga, accepted by Aḫu-wer. Dated to the Festival of Ninazu, reign of Amar-Suen.',
    difficulty: 'easy',
    faces: [
      { label: 'Obverse & Reverse', photo_id: 'P102318', type: 'photo' },
    ],
  },
  {
    cdli_id: 'P213189',
    cdli_number: 213189,
    title: 'Manishtusu Obelisk (Cruciform Monument)',
    author: 'Court scribe of Maništušu',
    language: 'Akkadian',
    published: 'ca. 2270 BC',
    year: -2270,
    period: 'Old Akkadian (ca. 2340-2200 BC)',
    script_type: 'Old Akkadian',
    genre: 'land-sale',
    museum: 'Louvre Museum, Paris',
    museum_number: 'Sb 00020',
    description: 'Records purchase of 8 parcels of land totaling 3,430 hectares by King Maništušu. One of the earliest known land sale records. Diorite obelisk with 4 surfaces, 73 columns.',
    difficulty: 'medium-hard',
    faces: [
      { label: 'Main view', photo_id: 'P213189', type: 'photo' },
      { label: 'Detail view', photo_id: 'P213189_d', type: 'photo' },
    ],
  },
  {
    cdli_id: 'P421809',
    cdli_number: 421809,
    title: 'Taylor Prism (Sennacherib\'s Annals)',
    author: 'Court scribe of Sennacherib',
    language: 'Akkadian',
    published: '691 BC',
    year: -691,
    period: 'Neo-Assyrian (ca. 911-612 BC)',
    script_type: 'Neo-Assyrian',
    genre: 'royal-inscription',
    museum: 'British Museum, London',
    museum_number: 'BM 091032',
    description: 'Sennacherib\'s military campaigns including the siege of Jerusalem ("Hezekiah, locked up like a bird in a cage"). 6 columns on hexagonal clay prism. One of the most important Neo-Assyrian royal inscriptions.',
    difficulty: 'medium',
    faces: [
      { label: 'Prism face', photo_id: 'P421809', type: 'photo' },
    ],
  },
  {
    cdli_id: 'P464358',
    cdli_number: 464358,
    title: 'Code of Hammurabi',
    author: 'Court scribe of Hammurabi',
    language: 'Akkadian',
    published: 'ca. 1750 BC',
    year: -1750,
    period: 'Old Babylonian (ca. 1900-1600 BC)',
    script_type: 'Old Babylonian',
    genre: 'legal',
    museum: 'Louvre Museum, Paris',
    museum_number: 'Sb 8',
    description: 'The complete Code of Hammurabi: prologue invoking divine authority, 282 legal provisions, and epilogue. Basalt stele with ~51 columns. Erased sections where Elamite king scraped off ~35 laws.',
    difficulty: 'hard',
    faces: [
      { label: 'Stele detail', photo_id: 'P464358', type: 'photo' },
      { label: 'Stele detail (alternate)', photo_id: 'P464358_d', type: 'photo' },
    ],
  },
  {
    cdli_id: 'P394421',
    cdli_number: 394421,
    title: 'Neo-Assyrian Medical Prescriptions (BAM 6, 555)',
    author: 'Library of Ashurbanipal',
    language: 'Akkadian',
    published: 'ca. 650 BC',
    year: -650,
    period: 'Neo-Assyrian (ca. 911-612 BC)',
    script_type: 'Neo-Assyrian',
    genre: 'medical',
    museum: 'British Museum, London',
    museum_number: 'K 02421 + K 02511 + K 13020 + K 13437 + K 16452 + K 16765',
    description: 'Medical prescriptions and treatments. Composite of 6 joined fragments from Nineveh. Mixes Sumerian logograms with Akkadian text. Multi-column layout with extensive damage.',
    difficulty: 'hard',
    faces: [
      { label: 'Tablet photograph', photo_id: 'P394421', type: 'photo' },
    ],
  },
];

// ---------------------------------------------------------------------------
// Cuneiform OCR Prompt (ATF transliteration from tablet photos)
// ---------------------------------------------------------------------------
const CUNEIFORM_OCR_PROMPT = `You are a cuneiform epigrapher examining a photograph of a clay tablet (or stone inscription).

**Task:** Produce an ATF (ASCII Transliteration Format) transliteration of the cuneiform signs visible in this photograph.

**ATF Format Rules:**
- Line numbers: prefix each line with its line number, e.g. "1." "2." etc.
- Broken signs: use square brackets [x] for damaged/missing signs
- Partial signs: use half-brackets ⸢x⸣ for partially visible signs
- Sign readings: use lowercase for syllabic values (e.g. lugal, en, an)
- Logograms: use UPPERCASE for Sumerian logograms in Akkadian text (e.g. LUGAL, DINGIR)
- Determinatives: use superscript notation {d} for divine, {ki} for place, {m} for male name, {f} for female
- Unknown signs: use "x" for completely illegible signs
- Sign dividers: use hyphens between signs in a word, spaces between words
- Column breaks: mark with "column i", "column ii" etc.
- Surface transitions: mark with @obverse, @reverse, @left, @right, @top, @bottom

**Process (think step by step):**
1. Assess the artifact's physical condition and photograph quality
2. Identify the script style and approximate period from sign forms
3. Identify the language(s) — Sumerian, Akkadian, bilingual, etc.
4. Determine the text genre from layout and formulae
5. Read line by line, left to right, top to bottom
6. For each sign, consider multiple possible readings and choose the most likely
7. Note any seal impressions, rulings, or non-textual features

**Output format:**

<surface>obverse|reverse|left-edge|right-edge|top|bottom|column-face|full-view</surface>
<script>Old Babylonian|Neo-Assyrian|Ur III|Old Akkadian|Neo-Sumerian|other</script>
<language>Sumerian|Akkadian|Elamite|Hittite|Bilingual Sumerian-Akkadian</language>
<period>approximate date range, e.g. "ca. 2100-2000 BC"</period>
<condition>description of physical state, damage, legibility, surface quality</condition>
<genre>administrative|royal-inscription|literary|legal|letter|ritual|lexical|medical|omen|other</genre>

<transliteration>
[ATF transliteration here — one line per tablet line, with line numbers]
</transliteration>

<confidence>0.0-1.0 overall confidence in the reading</confidence>
<notes>
- Line-by-line notes on uncertain readings
- Alternative readings for ambiguous signs
- Observations about tablet features (seal impressions, rulings, erasures, joins)
- Signs that could be read multiple ways
</notes>
<vocab>key terms with translations: divine names, place names, personal names, technical vocabulary</vocab>`;

// ---------------------------------------------------------------------------
// Cuneiform Translation Prompt (ATF → English)
// ---------------------------------------------------------------------------
const CUNEIFORM_TRANSLATION_PROMPT = `You are an Assyriologist translating a cuneiform text from its ATF transliteration.

**Input:** ATF transliteration of a cuneiform tablet.
**Output:** Readable English translation with scholarly annotations.

**Source language:** The text may be in Sumerian, Akkadian (Old Babylonian, Neo-Assyrian), or bilingual. Identify the language first.

**Instructions:**
1. Translate the ATF transliteration into clear, readable English
2. Preserve line structure so readers can follow line-by-line against the ATF
3. For Sumerian logograms in Akkadian text, provide the Akkadian reading and English meaning
4. Mark uncertain translations with [?]
5. Expand determinatives: {d}Marduk → "the god Marduk", {ki}Babylon → "the city of Babylon"
6. Handle broken passages: [x x x] → "[broken]" or "[approximately N signs missing]"
7. Use <note>...</note> for scholarly context (historical references, parallel texts, technical terms)
8. Use <term>...</term> for important Sumerian/Akkadian vocabulary with definition

**Format:**
- Line numbers matching the ATF (1. 2. 3. etc.)
- English translation with inline annotations
- Paragraph breaks at natural content divisions (e.g. between entries in administrative texts)

<summary>Brief description of the text's content, genre, and significance (2-3 sentences)</summary>
<keywords>key terms, names, places mentioned in the text</keywords>`;

// ---------------------------------------------------------------------------
// Slug generator
// ---------------------------------------------------------------------------
function slugify(text) {
  return text
    .toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 80);
}

// ---------------------------------------------------------------------------
// Check if a URL returns 200
// ---------------------------------------------------------------------------
async function urlExists(url) {
  try {
    const resp = await fetch(url, { method: 'HEAD' });
    return resp.ok;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Fetch ATF ground truth from CDLI
// ---------------------------------------------------------------------------
async function fetchAtf(cdliNumber) {
  const url = cdliAtf(cdliNumber);
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const text = await resp.text();
    // ATF pages may return HTML — check for actual ATF content
    if (text.includes('<!DOCTYPE') || text.includes('<html')) {
      // Try to extract ATF from HTML (CDLI may wrap it)
      const match = text.match(/<pre[^>]*>([\s\S]*?)<\/pre>/);
      return match ? match[1].trim() : text.substring(0, 5000);
    }
    return text.trim();
  } catch (e) {
    console.log(`  Warning: could not fetch ATF from ${url}: ${e.message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Store prompts in DB
// ---------------------------------------------------------------------------
async function storePrompts(db) {
  const prompts = db.collection('prompts');

  // Check if cuneiform prompts already exist
  const existingOcr = await prompts.findOne({ name: 'Cuneiform OCR' });
  const existingTranslation = await prompts.findOne({ name: 'Cuneiform Translation' });

  if (!existingOcr) {
    await prompts.insertOne({
      name: 'Cuneiform OCR',
      type: 'ocr',
      version: 1,
      is_default: false,
      content: CUNEIFORM_OCR_PROMPT,
      created_at: new Date(),
      updated_at: new Date(),
      description: 'ATF transliteration from cuneiform tablet photographs. Produces structured output with surface, script, language, period, condition, genre metadata plus line-by-line ATF.',
    });
    console.log('  Stored: Cuneiform OCR prompt (v1)');
  } else {
    console.log(`  Cuneiform OCR prompt already exists (v${existingOcr.version})`);
  }

  if (!existingTranslation) {
    await prompts.insertOne({
      name: 'Cuneiform Translation',
      type: 'translation',
      version: 1,
      is_default: false,
      content: CUNEIFORM_TRANSLATION_PROMPT,
      created_at: new Date(),
      updated_at: new Date(),
      description: 'English translation from ATF cuneiform transliteration. Preserves line structure, handles logograms, determinatives, and damage notation.',
    });
    console.log('  Stored: Cuneiform Translation prompt (v1)');
  } else {
    console.log(`  Cuneiform Translation prompt already exists (v${existingTranslation.version})`);
  }
}

// ---------------------------------------------------------------------------
// Import one tablet
// ---------------------------------------------------------------------------
async function importTablet(db, tablet) {
  const books = db.collection('books');
  const pages = db.collection('pages');

  // Check for existing import
  const existing = await books.findOne({
    'metadata.cdli_id': tablet.cdli_id,
  });
  if (existing) {
    console.log(`  SKIP: already imported as ${existing.id} (${existing.title})`);
    return existing.id;
  }

  // Fetch ATF ground truth
  console.log(`  Fetching ATF from CDLI...`);
  const atfGroundTruth = await fetchAtf(tablet.cdli_number);
  if (atfGroundTruth) {
    const lines = atfGroundTruth.split('\n').length;
    console.log(`  ATF: ${lines} lines fetched`);
  } else {
    console.log(`  ATF: not available (will need manual entry)`);
  }

  // Verify which photos exist
  const validFaces = [];
  for (const face of tablet.faces) {
    const fullUrl = cdliPhoto(face.photo_id);
    const tnUrl = cdliThumbnail(face.photo_id);
    const exists = await urlExists(fullUrl);
    const tnExists = !exists ? await urlExists(tnUrl) : false;

    if (exists) {
      validFaces.push({ ...face, url: fullUrl, thumbnail: cdliThumbnail(face.photo_id) });
      console.log(`  Photo OK: ${face.label} (full-res)`);
    } else if (tnExists) {
      validFaces.push({ ...face, url: tnUrl, thumbnail: tnUrl });
      console.log(`  Photo OK: ${face.label} (thumbnail only)`);
    } else {
      console.log(`  Photo MISSING: ${face.label} — ${fullUrl}`);
    }
  }

  if (validFaces.length === 0) {
    console.log(`  ERROR: No photos found for ${tablet.cdli_id}. Skipping.`);
    return null;
  }

  // Create book
  const bookId = new ObjectId();
  const bookIdStr = bookId.toHexString();
  const slug = slugify(`${tablet.title}-${tablet.cdli_id}`);

  const bookDoc = {
    _id: bookId,
    id: bookIdStr,
    slug,
    tenant_id: 'default',
    title: tablet.title,
    display_title: tablet.title,
    author: tablet.author,
    language: tablet.language,
    published: tablet.published,
    year: tablet.year,
    categories: ['Cuneiform Tablets'],
    thumbnail: validFaces[0].thumbnail || validFaces[0].url,
    pages_count: validFaces.length,
    pages_ocr: 0,
    pages_translated: 0,
    hidden: true, // Hidden until PoC is validated
    dublin_core: {
      dc_identifier: [`CDLI:${tablet.cdli_id}`],
      dc_source: cdliArtifact(tablet.cdli_number),
    },
    image_source: {
      provider: 'cdli',
      provider_name: 'Cuneiform Digital Library Initiative',
      source_url: cdliArtifact(tablet.cdli_number),
      identifier: tablet.cdli_id,
      license: 'varies', // BM = CC-BY-NC-SA-4.0, Louvre = varies
      access_date: new Date(),
    },
    metadata: {
      script_type: 'cuneiform',
      cuneiform_script: tablet.script_type,
      cdli_id: tablet.cdli_id,
      cdli_number: tablet.cdli_number,
      period: tablet.period,
      genre: tablet.genre,
      museum: tablet.museum,
      museum_number: tablet.museum_number,
      difficulty: tablet.difficulty,
      atf_ground_truth: atfGroundTruth || null,
      material: tablet.cdli_id === 'P464358' ? 'basalt' : tablet.cdli_id === 'P213189' ? 'diorite' : 'clay',
    },
    reading_summary: {
      overview: tablet.description,
    },
    status: 'draft',
    created_at: new Date(),
    updated_at: new Date(),
  };

  // Create page records
  const pageDocs = validFaces.map((face, i) => {
    const pageId = new ObjectId();
    return {
      _id: pageId,
      id: pageId.toHexString(),
      tenant_id: 'default',
      book_id: bookIdStr,
      page_number: i + 1,
      photo: face.url,
      thumbnail: face.thumbnail,
      photo_original: face.url,
      page_label: face.label,
      ocr: {
        language: tablet.language,
        model: null,
        data: '',
      },
      translation: {
        language: 'English',
        model: null,
        data: '',
      },
      created_at: new Date(),
      updated_at: new Date(),
    };
  });

  if (DRY_RUN) {
    console.log(`  DRY RUN: would create book "${tablet.title}" with ${pageDocs.length} pages`);
    console.log(`  Slug: ${slug}`);
    console.log(`  CDLI: ${cdliArtifact(tablet.cdli_number)}`);
    return null;
  }

  await books.insertOne(bookDoc);
  if (pageDocs.length > 0) {
    await pages.insertMany(pageDocs);
  }

  console.log(`  Created: ${bookIdStr} — ${validFaces.length} pages`);
  console.log(`  URL: https://sourcelibrary.org/book/${slug}`);
  console.log(`  CDLI: ${cdliArtifact(tablet.cdli_number)}`);

  return bookIdStr;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log('=== Cuneiform Tablet OCR — Import ===');
  console.log(`Tablets: ${TABLETS.length}`);
  if (DRY_RUN) console.log('MODE: dry run\n');
  else console.log('');

  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  try {
    // Step 1: Store prompts
    console.log('--- Storing prompts ---');
    if (!DRY_RUN) {
      await storePrompts(db);
    } else {
      console.log('  DRY RUN: would store Cuneiform OCR + Translation prompts');
    }
    console.log();

    if (PROMPTS_ONLY) {
      console.log('Done (prompts only).');
      return;
    }

    // Step 2: Import tablets
    const results = [];
    for (const tablet of TABLETS) {
      console.log(`--- ${tablet.cdli_id}: ${tablet.title} ---`);
      console.log(`  ${tablet.period} | ${tablet.language} | ${tablet.difficulty}`);
      const bookId = await importTablet(db, tablet);
      results.push({ cdli_id: tablet.cdli_id, title: tablet.title, bookId });
      console.log();
    }

    // Summary
    console.log('=== Summary ===');
    const imported = results.filter((r) => r.bookId);
    const skipped = results.filter((r) => !r.bookId);
    console.log(`Imported: ${imported.length}`);
    console.log(`Skipped:  ${skipped.length}`);

    if (imported.length > 0) {
      console.log('\nImported tablets:');
      for (const r of imported) {
        console.log(`  ${r.cdli_id}: ${r.bookId}`);
      }
    }

    console.log('\n--- Next steps ---');
    console.log('1. Run OCR on each tablet page:');
    console.log('   secret-lover run -- node _tmp-evaluate-cuneiform.mjs --run-ocr');
    console.log('2. Run translation on OCR\'d pages:');
    console.log('   secret-lover run -- node _tmp-evaluate-cuneiform.mjs --run-translate');
    console.log('3. Compare against ground truth:');
    console.log('   secret-lover run -- node _tmp-evaluate-cuneiform.mjs --evaluate');
  } finally {
    await client.close();
  }
}

main().catch(console.error);
