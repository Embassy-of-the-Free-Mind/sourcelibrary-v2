#!/usr/bin/env node
/**
 * Batch import: Theosophical Society publications pre-1930
 * Focus on California/Point Loma + foundational texts
 */

const API_BASE = 'https://sourcelibrary.org/api/import/ia';
const CRON_SECRET = process.env.CRON_SECRET;
if (!CRON_SECRET) {
  console.error('CRON_SECRET not set. Source .env.production.local first.');
  process.exit(1);
}

const books = [
  // === FOUNDATIONAL TEXTS ===
  {
    ia_identifier: 'voiceofsilencebe0000blav',
    title: 'The Voice of the Silence: Being Chosen Fragments from the "Book of the Golden Precepts"',
    author: 'Helena Petrovna Blavatsky',
    year: 1889,
    original_language: 'English',
  },
  {
    ia_identifier: 'oceanoftheosophy00judgiala',
    title: 'The Ocean of Theosophy',
    author: 'William Quan Judge',
    year: 1893,
    original_language: 'English',
  },
  {
    ia_identifier: 'esotericbuddhis00sinn',
    title: 'Esoteric Buddhism',
    author: 'Alfred Percy Sinnett',
    year: 1883,
    original_language: 'English',
  },
  {
    ia_identifier: 'occultworld1885sinn',
    title: 'The Occult World',
    author: 'Alfred Percy Sinnett',
    year: 1885, // 4th edition; 1st was 1881
    original_language: 'English',
  },
  {
    ia_identifier: 'mahatmalettersto00sinnuoft',
    title: 'The Mahatma Letters to A. P. Sinnett from the Mahatmas M. & K. H.',
    author: 'Alfred Percy Sinnett',
    year: 1923,
    original_language: 'English',
  },

  // === BESANT & LEADBEATER ===
  {
    ia_identifier: 'ancientwisdomout00besa',
    title: 'The Ancient Wisdom: An Outline of Theosophical Teachings',
    author: 'Annie Besant',
    year: 1897,
    original_language: 'English',
  },
  {
    ia_identifier: 'b24885939',
    title: 'Esoteric Christianity, or The Lesser Mysteries',
    author: 'Annie Besant',
    year: 1901,
    original_language: 'English',
  },
  {
    ia_identifier: 'thoughtforms00besarich',
    title: 'Thought-Forms',
    author: 'Annie Besant & C. W. Leadbeater',
    year: 1901,
    original_language: 'English',
  },
  {
    ia_identifier: 'manvisibleandin00leadgoog',
    title: 'Man Visible and Invisible: Examples of Different Types of Men as Seen by Means of Trained Clairvoyance',
    author: 'Charles Webster Leadbeater',
    year: 1902,
    original_language: 'English',
  },
  {
    ia_identifier: 'theastralplane00leaduoft',
    title: 'The Astral Plane: Its Scenery, Inhabitants and Phenomena',
    author: 'Charles Webster Leadbeater',
    year: 1895,
    original_language: 'English',
  },
  {
    ia_identifier: 'Clairvoyance1899',
    title: 'Clairvoyance',
    author: 'Charles Webster Leadbeater',
    year: 1899,
    original_language: 'English',
  },

  // === CALIFORNIA / POINT LOMA ===
  {
    ia_identifier: 'theosophypathofm00tingrich',
    title: 'Theosophy: The Path of the Mystic',
    author: 'Katherine Tingley',
    year: 1922,
    original_language: 'English',
  },
  {
    ia_identifier: 'godsawait0000ting',
    title: 'The Gods Await',
    author: 'Katherine Tingley',
    year: 1926,
    original_language: 'English',
  },
  {
    ia_identifier: 'mysteriesofheart00tingrich',
    title: 'The Mysteries of the Heart Doctrine',
    author: 'Katherine Tingley',
    year: 1902,
    original_language: 'English',
  },
  {
    ia_identifier: 'fundamentalsofth032110mbp',
    title: 'Fundamentals of the Esoteric Philosophy',
    author: 'Gottfried de Purucker',
    year: 1932,
    original_language: 'English',
  },
  {
    ia_identifier: 'helenapetrovnabl00ting',
    title: 'Helena Petrovna Blavatsky: Foundress of the Original Theosophical Society in New York, 1875',
    author: 'Katherine Tingley',
    year: 1921,
    original_language: 'English',
  },

  // === OTHER KEY TEXTS ===
  {
    ia_identifier: 'lightonpath00coll_0',
    title: 'Light on the Path: A Treatise Written for the Personal Use of Those Who Are Ignorant of the Eastern Wisdom',
    author: 'Mabel Collins',
    year: 1885,
    original_language: 'English',
  },
  {
    ia_identifier: 'echoesfromorien02judggoog',
    title: 'Echoes from the Orient: A Broad Outline of Theosophical Doctrines',
    author: 'William Quan Judge',
    year: 1890,
    original_language: 'English',
  },
  {
    ia_identifier: 'philosophyofbhag00subbiala',
    title: 'The Philosophy of the Bhagavad-Gita',
    author: 'T. Subba Row',
    year: 1912,
    original_language: 'English',
  },
];

async function importBook(book, index) {
  console.log(`\n[${index + 1}/${books.length}] Importing: ${book.title} (${book.year})`);
  console.log(`  IA: ${book.ia_identifier}`);

  try {
    const res = await fetch(API_BASE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CRON_SECRET}`,
      },
      body: JSON.stringify(book),
    });

    const data = await res.json();

    if (res.ok) {
      console.log(`  ✓ Imported: ${data.id || data._id || 'OK'}`);
      return { success: true, title: book.title, id: data.id || data._id };
    } else {
      console.log(`  ✗ Failed: ${data.error || data.message || JSON.stringify(data)}`);
      return { success: false, title: book.title, error: data.error || data.message };
    }
  } catch (err) {
    console.log(`  ✗ Error: ${err.message}`);
    return { success: false, title: book.title, error: err.message };
  }
}

async function main() {
  console.log(`=== Theosophical Society Import ===`);
  console.log(`Books to import: ${books.length}`);
  console.log(`Focus: California/Point Loma + foundational texts\n`);

  const results = [];

  for (let i = 0; i < books.length; i++) {
    const result = await importBook(books[i], i);
    results.push(result);
    // 2s delay between imports
    if (i < books.length - 1) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  console.log(`\n=== SUMMARY ===`);
  const successes = results.filter(r => r.success);
  const failures = results.filter(r => !r.success);
  console.log(`Imported: ${successes.length}/${books.length}`);

  if (failures.length > 0) {
    console.log(`\nFailed:`);
    failures.forEach(f => console.log(`  - ${f.title}: ${f.error}`));
  }

  if (successes.length > 0) {
    console.log(`\nSuccessful imports:`);
    successes.forEach(s => console.log(`  - ${s.title} → ${s.id}`));
  }
}

main().catch(console.error);
