#!/usr/bin/env node
/**
 * Import Forshaw-aligned books from secondrenaissance into sourcelibrary-v2 MongoDB
 *
 * Usage:
 *   node scripts/import-forshaw-books.js
 *   node scripts/import-forshaw-books.js --book schweighardt
 */

const { MongoClient, ObjectId } = require('mongodb');
const fs = require('fs');
const path = require('path');

// Load .env.local
function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env.local');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    content.split('\n').forEach(line => {
      const match = line.match(/^([^=]+)=(.*)$/);
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2];
      }
    });
  }
}
loadEnv();

// Configuration
const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB = process.env.MONGODB_DB;
const TENANT_ID = 'default';

if (!MONGODB_URI || !MONGODB_DB) {
  console.error('Missing MONGODB_URI or MONGODB_DB in .env.local');
  process.exit(1);
}

// Path to secondrenaissance translations
const TRANSLATIONS_DIR = '/Users/dereklomas/secondrenaissance/data/translations';

// Forshaw book mappings with enhanced metadata
const FORSHAW_BOOKS = {
  'heinrich_khunrath_amphitheatrum_sapientiae_aeter': {
    title: 'Amphitheatrum Sapientiae Aeternae',
    display_title: 'Amphitheater of Eternal Wisdom',
    author: 'Heinrich Khunrath',
    language: 'Latin',
    published: '1609',
    publisher: 'Hanover',
    place_of_publication: 'Hanover, Germany',
    ia_identifier: 'BIUSante_pharma_res005272',
    dublin_core: {
      dc_subject: ['Alchemy', 'Kabbalah', 'Hermeticism', 'Christian theosophy', 'Rosicrucianism'],
      dc_description: 'Major alchemical-theosophical work combining Christian Kabbalah, Hermetic philosophy, and Paracelsian alchemy. Contains famous circular engravings including the Oratory-Laboratory.',
      dc_type: 'Text',
      dc_rights: 'Public Domain'
    },
    categories: ['Alchemy', 'Kabbalah', 'Forshaw'],
    forshaw_relevance: 'PRIMARY - Forshaw\'s 4-volume monograph (2024-2025) is the definitive study'
  },
  'john_dee_monas_hieroglyphica': {
    title: 'Monas Hieroglyphica',
    display_title: 'The Hieroglyphic Monad',
    author: 'John Dee',
    language: 'Latin',
    published: '1564',
    place_of_publication: 'Antwerp',
    ia_identifier: 'monashieroglyphi00deej',
    dublin_core: {
      dc_subject: ['Hermetic philosophy', 'Alchemy', 'Mathematics', 'Symbolism'],
      dc_description: 'Dee\'s most famous esoteric work. Presents a single hieroglyphic symbol synthesizing all knowledge - astronomical, alchemical, mathematical, and mystical.',
      dc_type: 'Text',
      dc_rights: 'Public Domain'
    },
    categories: ['Hermeticism', 'Alchemy', 'Forshaw'],
    forshaw_relevance: 'PRIMARY - Multiple publications on Dee\'s hieroglyphic symbolism'
  },
  'michael_maier_atalanta_fugiens': {
    title: 'Atalanta fugiens',
    display_title: 'Atalanta Fleeing',
    author: 'Michael Maier',
    language: 'Latin',
    published: '1617',
    place_of_publication: 'Oppenheim',
    publisher: 'Johann Theodor de Bry',
    ia_identifier: 'atalantafugiensh00maie',
    dublin_core: {
      dc_subject: ['Alchemy', 'Emblems', 'Music', 'Rosicrucianism'],
      dc_description: 'Famous alchemical emblem book with 50 emblems, each accompanied by an epigram, discourse, and musical fugue. Combines visual, textual, and musical symbolism.',
      dc_type: 'Text',
      dc_rights: 'Public Domain'
    },
    categories: ['Alchemy', 'Emblems', 'Forshaw'],
    forshaw_relevance: 'PRIMARY - Dedicated webinar on this work. Published on Maier and Rosicrucian context.'
  },
  'giovanni_pico_della_mirandola_900_conclusiones': {
    title: 'Conclusiones sive Theses DCCCC',
    display_title: '900 Theses',
    author: 'Giovanni Pico della Mirandola',
    language: 'Latin',
    published: '1486',
    place_of_publication: 'Rome',
    ia_identifier: 'pico-1486-900-conclusiones',
    dublin_core: {
      dc_subject: ['Christian Kabbalah', 'Philosophy', 'Magic', 'Theology'],
      dc_description: 'The founding document of Christian Kabbalah. 900 theses from all philosophical traditions - Scholastic, Platonic, Kabbalistic, Hermetic, Zoroastrian. Condemned by Pope Innocent VIII.',
      dc_type: 'Text',
      dc_rights: 'Public Domain'
    },
    categories: ['Christian Kabbalah', 'Philosophy', 'Forshaw'],
    forshaw_relevance: 'HIGH - Foundation of his Cabala Chymica research. Starting point for tracing Christian Kabbalah tradition.'
  },
  'petrus_severinus_idea_medicinae_philosophicae': {
    title: 'Idea medicinae philosophicae',
    display_title: 'The Idea of Philosophical Medicine',
    author: 'Petrus Severinus',
    language: 'Latin',
    published: '1571',
    place_of_publication: 'Basel',
    ia_identifier: 'BIUSante_06033',
    dublin_core: {
      dc_subject: ['Paracelsianism', 'Medicine', 'Alchemy', 'Natural philosophy'],
      dc_description: 'Foundational text of learned Paracelsianism. Systematized Paracelsus\'s scattered writings into a coherent medical-philosophical system. Highly influential on later iatrochemistry.',
      dc_type: 'Text',
      dc_rights: 'Public Domain'
    },
    categories: ['Paracelsianism', 'Medicine', 'Forshaw'],
    forshaw_relevance: 'MEDIUM - Foundational Paracelsianism, context for Khunrath'
  },
  'francesco_giorgi_de_harmonia_mundi_totius': {
    title: 'De harmonia mundi totius',
    display_title: 'On the Harmony of the Whole World',
    author: 'Francesco Giorgi (Zorzi)',
    language: 'Latin',
    published: '1525',
    place_of_publication: 'Venice',
    ia_identifier: 'FranciscusGeorgiusVenetusDeHarmoniaMundiTotiusParis1545',
    dublin_core: {
      dc_subject: ['Christian Kabbalah', 'Pythagorean philosophy', 'Cosmology', 'Music theory'],
      dc_description: 'Major Kabbalistic-Pythagorean synthesis by Venetian Franciscan. Influenced John Dee. Combines number mysticism, musical harmony, and Kabbalistic cosmology.',
      dc_type: 'Text',
      dc_rights: 'Public Domain'
    },
    categories: ['Christian Kabbalah', 'Cosmology', 'Forshaw'],
    forshaw_relevance: 'HIGH - Influenced John Dee. Kabbalistic-Pythagorean synthesis.'
  },
  'oswald_croll_basilica_chymica': {
    title: 'Basilica chymica',
    display_title: 'The Royal Chemistry',
    author: 'Oswald Croll',
    language: 'Latin',
    published: '1609',
    place_of_publication: 'Frankfurt',
    ia_identifier: 'osualdicrolliive00crol',
    dublin_core: {
      dc_subject: ['Paracelsianism', 'Iatrochemistry', 'Pharmacy', 'Alchemy'],
      dc_description: 'Influential Paracelsian pharmaceutical manual. Contains chemical preparations and the famous "De signaturis internis rerum" on the doctrine of signatures.',
      dc_type: 'Text',
      dc_rights: 'Public Domain'
    },
    categories: ['Paracelsianism', 'Pharmacy', 'Forshaw'],
    forshaw_relevance: 'HIGH - Cited in Cabala Chymica research. Paracelsian iatrochemistry.'
  },
  'theophilus_schweighardt_speculum_sophicum_rhodo-stauro': {
    title: 'Speculum Sophicum Rhodo-Stauroticum',
    display_title: 'Mirror of the Wisdom of the Rosy Cross',
    author: 'Theophilus Schweighardt (Daniel Mögling)',
    language: 'German',
    published: '1618',
    place_of_publication: 'Germany',
    ia_identifier: 'specvlvmsophicvm00schw',
    dublin_core: {
      dc_subject: ['Rosicrucianism', 'Christian mysticism', 'Hermetic philosophy', 'Secret societies'],
      dc_description: 'Key Rosicrucian manifesto defending the brotherhood. Contains famous allegorical engraving of the Collegium Fraternitatis. Written under pseudonym by Daniel Mögling.',
      dc_type: 'Text',
      dc_rights: 'Public Domain'
    },
    categories: ['Rosicrucianism', 'Forshaw'],
    forshaw_relevance: 'MEDIUM - Rosicrucian context for Michael Maier and Heinrich Khunrath'
  },
  'johannes_reuchlin_de_verbo_mirifico': {
    title: 'De verbo mirifico',
    display_title: 'On the Wonder-Working Word',
    author: 'Johannes Reuchlin',
    language: 'Latin',
    published: '1494',
    place_of_publication: 'Basel',
    ia_identifier: 'bub_gb_lS_ozB8_LlQC',
    dublin_core: {
      dc_subject: ['Christian Kabbalah', 'Hebrew studies', 'Philosophy', 'Theurgy'],
      dc_description: 'First systematic work on Christian Kabbalah in Germany. Dialogue exploring the power of divine names, especially the Tetragrammaton and Pentagrammaton (YHSVH/Jesus).',
      dc_type: 'Text',
      dc_rights: 'Public Domain'
    },
    categories: ['Christian Kabbalah', 'Forshaw'],
    forshaw_relevance: 'HIGH - Central to his Cabala Chymica research. First German Christian Kabbalah text.'
  },
  'john_dee_propaedeumata_aphoristica': {
    title: 'Propaedeumata Aphoristica',
    display_title: 'Preliminary Aphoristic Propositions',
    author: 'John Dee',
    language: 'Latin',
    published: '1568',
    place_of_publication: 'London',
    ia_identifier: 'bim_early-english-books-1475-1640_propaedeumata-aphoristic_dee-john_1568',
    dublin_core: {
      dc_subject: ['Natural philosophy', 'Astrology', 'Optics', 'Mathematics'],
      dc_description: 'Dee\'s first major publication. 120 aphorisms on astral influences and natural philosophy. Precursor to Monas Hieroglyphica. Dedicated to Gerard Mercator.',
      dc_type: 'Text',
      dc_rights: 'Public Domain'
    },
    categories: ['Natural Philosophy', 'Astrology', 'Forshaw'],
    forshaw_relevance: 'HIGH - Published on Dee\'s title pages and symbolism. Paired with Monas in his research.'
  }
};

async function importBook(db, dirName, bookMeta) {
  const projectDir = path.join(TRANSLATIONS_DIR, dirName);
  const pagesDir = path.join(projectDir, 'pages');

  // Check if directory exists
  if (!fs.existsSync(pagesDir)) {
    console.log(`  Skipping ${dirName} - pages directory not found`);
    return null;
  }

  // Read local metadata if exists
  let localMeta = {};
  const metadataPath = path.join(projectDir, 'metadata.json');
  if (fs.existsSync(metadataPath)) {
    localMeta = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
  }

  // Get page files
  const pageFiles = fs.readdirSync(pagesDir)
    .filter(f => /\.(jpg|jpeg|png)$/i.test(f))
    .sort();

  console.log(`  Found ${pageFiles.length} pages`);

  // Check if book already exists
  const booksCollection = db.collection('books');
  const existingBook = await booksCollection.findOne({
    $or: [
      { title: bookMeta.title },
      { 'dublin_core.dc_identifier': `IA:${bookMeta.ia_identifier}` }
    ]
  });

  let bookId;
  if (existingBook) {
    console.log(`  Book already exists (id: ${existingBook._id}), updating...`);
    bookId = existingBook._id;

    await booksCollection.updateOne(
      { _id: bookId },
      {
        $set: {
          ...bookMeta,
          pages_count: pageFiles.length,
          updated_at: new Date(),
          dublin_core: {
            ...bookMeta.dublin_core,
            dc_identifier: [`IA:${bookMeta.ia_identifier}`]
          }
        }
      }
    );
  } else {
    // Create new book
    const newId = new ObjectId();
    const bookDoc = {
      _id: newId,
      id: newId.toHexString(),  // Required string id field
      tenant_id: TENANT_ID,
      ...bookMeta,
      pages_count: pageFiles.length,
      status: 'draft',
      created_at: new Date(),
      updated_at: new Date(),
      dublin_core: {
        ...bookMeta.dublin_core,
        dc_identifier: [`IA:${bookMeta.ia_identifier}`]
      }
    };

    const result = await booksCollection.insertOne(bookDoc);
    bookId = result.insertedId;
    console.log(`  Created book (id: ${bookId})`);
  }

  // Import pages
  const pagesCollection = db.collection('pages');

  // Delete existing pages for this book (to avoid duplicates on re-import)
  const bookIdStr = bookId.toHexString ? bookId.toHexString() : bookId.toString();
  await pagesCollection.deleteMany({ book_id: bookIdStr });

  const pageDocs = pageFiles.map((filename, index) => {
    const pageNumber = index + 1;
    const imagePath = path.join(pagesDir, filename);
    const pageId = new ObjectId();

    // Determine page type from local metadata
    let hasContent = true;
    if (localMeta.page_structure) {
      const ps = localMeta.page_structure;
      if (ps.blank_pages?.includes(pageNumber)) hasContent = false;
      if (ps.cover_pages?.includes(pageNumber)) hasContent = false;
      if (ps.endpapers?.includes(pageNumber)) hasContent = false;
      if (ps.ia_notice?.includes(pageNumber)) hasContent = false;
    }

    return {
      _id: pageId,
      id: pageId.toHexString(),  // Add string id field
      tenant_id: TENANT_ID,
      book_id: bookIdStr,  // Use hex string consistently
      page_number: pageNumber,
      photo: imagePath,  // Local path - served via /api/image
      photo_local: imagePath,
      ocr: {
        language: bookMeta.language,
        model: null,
        data: ''
      },
      translation: {
        language: 'English',
        model: null,
        data: ''
      },
      has_content: hasContent,
      status: 'pending',
      created_at: new Date(),
      updated_at: new Date()
    };
  });

  if (pageDocs.length > 0) {
    await pagesCollection.insertMany(pageDocs);
    console.log(`  Imported ${pageDocs.length} pages`);
  }

  // Set thumbnail from first page with content
  const firstContentPage = pageDocs.find(p => p.has_content) || pageDocs[0];
  if (firstContentPage) {
    await booksCollection.updateOne(
      { _id: bookId },
      { $set: { thumbnail: firstContentPage.photo } }
    );
  }

  return bookId;
}

async function main() {
  const args = process.argv.slice(2);
  const specificBook = args.find(a => a.startsWith('--book='))?.split('=')[1];

  console.log('Connecting to MongoDB...');
  console.log(`URI: ${MONGODB_URI}`);
  console.log(`Database: ${MONGODB_DB}`);

  const client = await MongoClient.connect(MONGODB_URI);
  const db = client.db(MONGODB_DB);

  console.log('\nImporting Forshaw-aligned books...\n');

  // Get directories to import
  let dirsToImport;
  if (specificBook) {
    // Find matching directory
    const allDirs = fs.readdirSync(TRANSLATIONS_DIR);
    dirsToImport = allDirs.filter(d => d.includes(specificBook));
    if (dirsToImport.length === 0) {
      console.log(`No directory found matching: ${specificBook}`);
      console.log('Available directories:');
      allDirs.forEach(d => console.log(`  - ${d}`));
      process.exit(1);
    }
  } else {
    dirsToImport = Object.keys(FORSHAW_BOOKS);
  }

  const results = [];

  for (const dirName of dirsToImport) {
    const bookMeta = FORSHAW_BOOKS[dirName];
    if (!bookMeta) {
      console.log(`Skipping ${dirName} - no metadata defined`);
      continue;
    }

    console.log(`\nImporting: ${bookMeta.title}`);
    console.log(`  Author: ${bookMeta.author}`);
    console.log(`  Directory: ${dirName}`);

    try {
      const bookId = await importBook(db, dirName, bookMeta);
      if (bookId) {
        results.push({ dirName, bookId, title: bookMeta.title, status: 'success' });
      }
    } catch (err) {
      console.error(`  Error: ${err.message}`);
      results.push({ dirName, title: bookMeta.title, status: 'error', error: err.message });
    }
  }

  // Create indexes (skip text index - causes issues with language field)
  console.log('\nCreating indexes...');
  try {
    await db.collection('books').createIndex({ tenant_id: 1 });
    await db.collection('books').createIndex({ categories: 1 });
    await db.collection('pages').createIndex({ book_id: 1, page_number: 1 });
    await db.collection('pages').createIndex({ tenant_id: 1 });
  } catch (err) {
    console.log('Index creation warning:', err.message);
  }

  console.log('\n=== Import Summary ===');
  results.forEach(r => {
    if (r.status === 'success') {
      console.log(`✓ ${r.title} (${r.bookId})`);
    } else {
      console.log(`✗ ${r.title}: ${r.error}`);
    }
  });

  await client.close();
  console.log('\nDone!');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
