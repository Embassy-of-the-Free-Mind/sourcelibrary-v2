/**
 * Import Genesis/Cosmogony Texts
 *
 * High-priority acquisition batch for creation narratives and cosmogonies.
 * Run: npx tsx scripts/import-cosmogony-texts.ts
 */

const COSMOGONY_TEXTS = [
  // Philo of Alexandria - De Opificio Mundi
  {
    ia_identifier: 'philonisalexandr0000phil',
    title: 'Philonis Alexandrini libellus De opificio mundi',
    author: 'Philo of Alexandria; ed. Leopold Cohn',
    year: 1889,
    original_language: 'Greek',
    notes: 'Critical edition of Greek text. Allegorical Genesis commentary bridging Hebrew Bible and Greek philosophy.'
  },
  // Alternative Philo with English translation
  {
    ia_identifier: 'philo0001unse',
    title: 'Philo: On the Creation (De Opificio Mundi)',
    author: 'Philo of Alexandria; trans. F.H. Colson',
    year: 1929,
    original_language: 'Greek',
    notes: 'Loeb Classical Library edition with Greek text and English translation.'
  },

  // 2 Enoch (Slavonic Enoch)
  {
    ia_identifier: 'booksecretsenoc00morfgoog',
    title: 'The Book of the Secrets of Enoch (2 Enoch)',
    author: 'trans. W.R. Morfill; ed. R.H. Charles',
    year: 1896,
    original_language: 'Slavonic',
    notes: 'First English translation from Slavonic. Seven heavens, creation of Adam from 7 substances.'
  },

  // Hesiod - Theogony
  {
    ia_identifier: 'hesiodtheogony0000mlwe',
    title: 'Hesiod: Theogony',
    author: 'Hesiod; ed. M.L. West',
    year: 1966,
    original_language: 'Greek',
    notes: 'Authoritative critical edition with prolegomena and commentary. THE Greek cosmogony.'
  },
  // Alternative: Loeb edition
  {
    ia_identifier: 'lcl-57-hesiod',
    title: 'Hesiod: Theogony, Works and Days, Testimonia',
    author: 'Hesiod; trans. Glenn W. Most',
    year: 2006,
    original_language: 'Greek',
    notes: 'New Loeb Classical Library edition with improved Greek text.'
  },

  // Enuma Elish - King edition (scholarly, with cuneiform)
  {
    ia_identifier: 'enumaelishvol1se0000leon',
    title: 'Enuma Elish Vol 1: The Seven Tablets of Creation',
    author: 'ed. Leonard William King',
    year: 1902,
    original_language: 'Akkadian',
    notes: 'British Museum edition with transliteration, translation, and commentary. Foundational.'
  },
  // Heidel edition (accessible scholarly)
  {
    ia_identifier: 'the-enuma-elish-the-babylon-genesis-the-story-of-creation.-by-alexander-heidel',
    title: 'The Babylonian Genesis: Enuma Elish',
    author: 'trans. Alexander Heidel',
    year: 1951,
    original_language: 'Akkadian',
    notes: 'Standard scholarly translation, widely cited. Compares with Genesis.'
  },
  // Lambert - comprehensive
  {
    ia_identifier: 'babyloniancreati0000unse',
    title: 'Babylonian Creation Myths',
    author: 'W.G. Lambert',
    year: 2013,
    original_language: 'Akkadian',
    notes: 'Comprehensive scholarly study including Enuma Elish and other creation texts.'
  },

  // BONUS: 3 Enoch if found
  {
    ia_identifier: 'hebrewbookofenoc0000unse',
    title: '3 Enoch or The Hebrew Book of Enoch',
    author: 'ed. Hugo Odeberg',
    year: 1928,
    original_language: 'Hebrew',
    notes: 'Sefer Hekhalot - Merkavah mysticism, Metatron traditions. Completes Enoch trilogy.'
  }
];

async function importBook(book: typeof COSMOGONY_TEXTS[0]) {
  const API_BASE = process.env.API_BASE || 'https://sourcelibrary.org';

  console.log(`\nImporting: ${book.title}`);
  console.log(`  IA ID: ${book.ia_identifier}`);
  console.log(`  Notes: ${book.notes}`);

  try {
    const response = await fetch(`${API_BASE}/api/import/ia`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ia_identifier: book.ia_identifier,
        title: book.title,
        author: book.author,
        year: book.year,
        original_language: book.original_language
      })
    });

    const data = await response.json();

    if (response.ok) {
      console.log(`  ✓ Success! Book ID: ${data.bookId}`);
      console.log(`  URL: ${data.url}`);
      return { success: true, bookId: data.bookId, title: book.title };
    } else {
      console.log(`  ✗ Failed: ${data.error || data.details}`);
      return { success: false, error: data.error, title: book.title };
    }
  } catch (error) {
    console.log(`  ✗ Error: ${error}`);
    return { success: false, error: String(error), title: book.title };
  }
}

async function main() {
  console.log('='.repeat(60));
  console.log('COSMOGONY TEXTS ACQUISITION BATCH');
  console.log('Genesis/Creation narratives across traditions');
  console.log('='.repeat(60));

  const results = [];

  for (const book of COSMOGONY_TEXTS) {
    const result = await importBook(book);
    results.push(result);
    // Small delay between imports
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));

  const successes = results.filter(r => r.success);
  const failures = results.filter(r => !r.success);

  console.log(`\nSuccessful imports: ${successes.length}`);
  for (const s of successes) {
    console.log(`  - ${s.title} (${s.bookId})`);
  }

  if (failures.length > 0) {
    console.log(`\nFailed imports: ${failures.length}`);
    for (const f of failures) {
      console.log(`  - ${f.title}: ${f.error}`);
    }
  }

  // Output book IDs for OCR queuing
  if (successes.length > 0) {
    console.log('\n\nBook IDs for OCR queue:');
    console.log(successes.map(s => s.bookId).join('\n'));
  }
}

main().catch(console.error);
