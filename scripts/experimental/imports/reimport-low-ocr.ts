/**
 * Reimport 7 books with minimal OCR work
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

const booksToReimport = [
  { id: '694f397023a1d0c2ad1d8814', title: 'Platonis Opera Ficino' },
  { id: '695234ddab34727b1f044cd2', title: 'Hermetic Museum Vol.1' },
  { id: '31f2d90a-88af-4414-a445-68406caca58d', title: 'Astronomia Nova' },
  { id: '694f397b53410e29f94e13ea', title: 'Ficini Platonica theol.' },
  { id: '694b3abfde93d1d4cec196fd', title: 'Ficini Opera' },
  { id: '69527313ab34727b1f048b15', title: 'Opera Latine Conscripta' },
  { id: '69527326ab34727b1f048b7a', title: 'De Triplici Minimo' },
];

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://sourcelibrary.org';

async function main() {
  console.log('Reimporting 7 books with minimal OCR work...\n');

  for (const book of booksToReimport) {
    process.stdout.write(`${book.title}... `);

    try {
      const res = await fetch(`${BASE_URL}/api/books/${book.id}/reimport`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'full' })
      });

      if (res.ok) {
        console.log('✓');
      } else {
        const text = await res.text();
        console.log(`✗ ${res.status}: ${text.substring(0, 50)}`);
      }
    } catch (err) {
      console.log(`✗ ${err}`);
    }

    await new Promise(r => setTimeout(r, 500));
  }

  console.log('\nDone!');
}

main().catch(console.error);
