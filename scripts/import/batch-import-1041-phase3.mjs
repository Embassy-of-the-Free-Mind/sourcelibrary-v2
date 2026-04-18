#!/usr/bin/env node
/**
 * Issue #1041 Phase 3: Remaining missing books
 * Mix of IA and IIIF sources
 */

const CRON_SECRET = process.env.CRON_SECRET;
if (!CRON_SECRET) {
  console.error('CRON_SECRET not set. Source .env.production.local first.');
  process.exit(1);
}

const BASE = 'https://sourcelibrary.org/api/import';

// IA-importable books
const iaBooks = [
  // Calderon — search for IA identifier
  // Li Yu 閑情偶寄 — search for IA identifier
];

// IIIF-importable books
const iiifBooks = [
  {
    endpoint: 'iiif',
    manifest_url: 'https://iiif.bodleian.ox.ac.uk/iiif/manifest/390fd0e8-9eae-475d-9564-ed916ab9035c.json',
    title: 'Mr. William Shakespeares Comedies, Histories, & Tragedies (First Folio, 1623)',
    author: 'William Shakespeare',
    language: 'English',
    published: '1623',
  },
  {
    endpoint: 'iiif',
    manifest_url: 'https://digi.ub.uni-heidelberg.de/diglit/iiif3/cpg466/manifest.json',
    title: 'Das Buch der Beispiele der Alten Weisen (illuminated MS, c. 1475)',
    author: 'Anton von Pforr',
    language: 'German',
    published: '1475',
  },
];

// Gallica books
const gallicaBooks = [
  {
    endpoint: 'gallica',
    ark: 'btv1b8410889v',
    title: 'Kalila wa-Dimna (BnF Arabe 3465, c. 1220, 98 miniatures)',
    author: 'Ibn al-Muqaffa',
    language: 'Arabic',
    published: '1220',
  },
];

async function importIIIF(book, index, total) {
  console.log(`\n[${index + 1}/${total}] Importing (IIIF): ${book.title}`);
  console.log(`  Manifest: ${book.manifest_url}`);

  try {
    const res = await fetch(`${BASE}/iiif`, {
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

async function importGallica(book, index, total) {
  console.log(`\n[${index + 1}/${total}] Importing (Gallica): ${book.title}`);
  console.log(`  ARK: ${book.ark}`);

  try {
    const res = await fetch(`${BASE}/gallica`, {
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
  const allBooks = [...iiifBooks, ...gallicaBooks];
  console.log(`=== Issue #1041 Phase 3: IIIF + Gallica Imports ===`);
  console.log(`Books to import: ${allBooks.length}\n`);
  console.log(`Note: Marlowe Tamburlaine, Calderon, Li Yu, Anvar-i Suhaili need manual research for identifiers\n`);

  const results = [];
  let idx = 0;

  for (const book of iiifBooks) {
    const result = await importIIIF(book, idx, allBooks.length);
    results.push(result);
    idx++;
    await new Promise(r => setTimeout(r, 3000));
  }

  for (const book of gallicaBooks) {
    const result = await importGallica(book, idx, allBooks.length);
    results.push(result);
    idx++;
    await new Promise(r => setTimeout(r, 3000));
  }

  console.log(`\n=== SUMMARY ===`);
  const successes = results.filter(r => r.success);
  const failures = results.filter(r => !r.success);
  console.log(`Imported: ${successes.length}/${allBooks.length}`);
  if (failures.length > 0) {
    console.log(`\nFailed:`);
    failures.forEach(f => console.log(`  - ${f.title}: ${f.error}`));
  }
  if (successes.length > 0) {
    console.log(`\nNew imports:`);
    successes.forEach(s => console.log(`  - ${s.title} → ${s.id}`));
  }

  console.log(`\n=== STILL NEEDS MANUAL IMPORT ===`);
  console.log(`- Marlowe, Tamburlaine (1590) — need IA identifier or Kit Marlowe Project`);
  console.log(`- Calderón, La vida es sueño — need Cervantes Virtual IIIF or IA identifier`);
  console.log(`- Li Yu 閑情偶寄 — need IA/CADAL identifier`);
  console.log(`- Anvar-i Suhaili (Walters W.599) — need Walters IIIF manifest URL`);
}

main().catch(console.error);
