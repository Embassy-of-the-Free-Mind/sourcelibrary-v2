#!/usr/bin/env node
/**
 * Batch import: Theosophical art & visual culture
 * Kandinsky, Bragdon, Leadbeater illustrated works, Hambidge
 */

const API_BASE = 'https://sourcelibrary.org/api/import/ia';
const CRON_SECRET = process.env.CRON_SECRET;
if (!CRON_SECRET) {
  console.error('CRON_SECRET not set. Source .env.production.local first.');
  process.exit(1);
}

const books = [
  // === KANDINSKY ===
  {
    ia_identifier: 'concerningspirit00kand',
    title: 'Concerning the Spiritual in Art',
    author: 'Wassily Kandinsky',
    year: 1914,
    original_language: 'German',
    language: 'English',
  },

  // === BRAGDON — Theosophist architect, 4D geometry ===
  {
    ia_identifier: 'beautifulnecessi00bragiala',
    title: 'The Beautiful Necessity: Seven Essays on Theosophy and Architecture',
    author: 'Claude Fayette Bragdon',
    year: 1910,
    original_language: 'English',
  },
  {
    ia_identifier: 'aprimerhighersp00braggoog',
    title: 'A Primer of Higher Space (The Fourth Dimension)',
    author: 'Claude Fayette Bragdon',
    year: 1913,
    original_language: 'English',
  },
  {
    ia_identifier: 'projectiveorname00brag',
    title: 'Projective Ornament',
    author: 'Claude Fayette Bragdon',
    year: 1915,
    original_language: 'English',
  },

  // === LEADBEATER — illustrated esoteric works ===
  {
    ia_identifier: 'hiddensideofthin0000cwle',
    title: 'The Hidden Side of Things',
    author: 'Charles Webster Leadbeater',
    year: 1913,
    original_language: 'English',
  },
  {
    ia_identifier: 'innerlife00lead',
    title: 'The Inner Life',
    author: 'Charles Webster Leadbeater',
    year: 1910,
    original_language: 'English',
  },
  {
    ia_identifier: 'invisiblehelpers00leadrich',
    title: 'Invisible Helpers',
    author: 'Charles Webster Leadbeater',
    year: 1896,
    original_language: 'English',
  },

  // === STEINER — art/color theory ===
  {
    ia_identifier: 'theosophyanintr01steigoog',
    title: 'Theosophy: An Introduction to the Supersensible Knowledge of the World and the Destination of Man',
    author: 'Rudolf Steiner',
    year: 1910,
    original_language: 'German',
    language: 'English',
  },

  // === HAMBIDGE — sacred geometry / dynamic symmetry ===
  {
    ia_identifier: 'dynamicsymmetry00hamb',
    title: 'Dynamic Symmetry: The Greek Vase',
    author: 'Jay Hambidge',
    year: 1920,
    original_language: 'English',
  },
  {
    ia_identifier: 'elementsofdynami0000hamb',
    title: 'The Elements of Dynamic Symmetry',
    author: 'Jay Hambidge',
    year: 1926,
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
      console.log(`  OK — ${data.slug || data.id || 'imported'}`);
      return { success: true, title: book.title };
    } else {
      console.log(`  FAIL — ${data.error || data.message || JSON.stringify(data)}`);
      return { success: false, title: book.title, error: data.error || data.message };
    }
  } catch (err) {
    console.log(`  ERROR — ${err.message}`);
    return { success: false, title: book.title, error: err.message };
  }
}

async function main() {
  console.log(`=== Theosophical Art & Visual Culture Import ===`);
  console.log(`Books: ${books.length}\n`);

  const results = [];
  for (let i = 0; i < books.length; i++) {
    results.push(await importBook(books[i], i));
    if (i < books.length - 1) await new Promise(r => setTimeout(r, 2000));
  }

  const ok = results.filter(r => r.success).length;
  const fail = results.filter(r => !r.success);
  console.log(`\n=== ${ok}/${books.length} imported ===`);
  if (fail.length) fail.forEach(f => console.log(`  FAIL: ${f.title} — ${f.error}`));
}

main().catch(console.error);
