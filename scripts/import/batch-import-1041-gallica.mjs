#!/usr/bin/env node
/**
 * Issue #1041: Gallica imports (French Classical Theater + Directorium + Kalila wa-Dimna)
 * Uses /api/import/gallica endpoint
 */

const API_BASE = 'https://sourcelibrary.org/api/import/gallica';
const CRON_SECRET = process.env.CRON_SECRET;
if (!CRON_SECRET) {
  console.error('CRON_SECRET not set. Source .env.production.local first.');
  process.exit(1);
}

const books = [
  // === FRENCH CLASSICAL THEATER ===
  {
    ark: 'bpt6k70391c',
    title: 'Le Cid (first edition, 1637)',
    author: 'Pierre Corneille',
    language: 'French',
    published: '1637',
  },
  {
    ark: 'btv1b8610800k',
    title: 'Le Tartuffe, ou l\'Imposteur',
    author: 'Molière',
    language: 'French',
    published: '1669',
  },
  {
    ark: 'bpt6k70169n',
    title: 'Phèdre et Hippolyte',
    author: 'Jean Racine',
    language: 'French',
    published: '1677',
  },

  // === ASIAN FABLE TRADITIONS ===
  {
    ark: 'btv1b8410889v',
    title: 'Kalila wa-Dimna (BnF Arabe 3465, c. 1220, 98 miniatures)',
    author: 'Ibn al-Muqaffa',
    language: 'Arabic',
    published: '1220',
  },
  {
    ark: 'bpt6k209277j',
    title: 'Directorium Humanae Vitae (Latin Panchatantra)',
    author: 'John of Capua',
    language: 'Latin',
    published: '1480',
  },
];

async function importBook(book, index) {
  console.log(`\n[${index + 1}/${books.length}] Importing: ${book.title}`);
  console.log(`  ARK: ${book.ark}`);

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
      console.log(`  ✓ Imported: ${data.id || data._id || 'OK'} (${data.pages_count || '?'} pages)`);
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
  console.log(`=== Issue #1041: Gallica Imports ===`);
  console.log(`Books to import: ${books.length}\n`);

  const results = [];

  for (let i = 0; i < books.length; i++) {
    const result = await importBook(books[i], i);
    results.push(result);
    if (i < books.length - 1) {
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  console.log(`\n=== SUMMARY ===`);
  const successes = results.filter(r => r.success);
  const failures = results.filter(r => !r.success);
  console.log(`Imported: ${successes.length}/${books.length}`);
  if (failures.length > 0) {
    console.log(`Failed:`);
    failures.forEach(f => console.log(`  - ${f.title}: ${f.error}`));
  }
  if (successes.length > 0) {
    console.log(`\nNew imports:`);
    successes.forEach(s => console.log(`  - ${s.title} → ${s.id}`));
  }
}

main().catch(console.error);
