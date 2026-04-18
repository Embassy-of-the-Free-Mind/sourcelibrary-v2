#!/usr/bin/env node
/**
 * Issue #1041 Final: Remaining missing books
 */

const CRON_SECRET = process.env.CRON_SECRET;
if (!CRON_SECRET) {
  console.error('CRON_SECRET not set. Source .env.production.local first.');
  process.exit(1);
}

const BASE = 'https://sourcelibrary.org/api/import';

async function importIA(book) {
  console.log(`\nImporting (IA): ${book.title}`);
  console.log(`  IA: ${book.ia_identifier}`);
  try {
    const res = await fetch(`${BASE}/ia`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${CRON_SECRET}` },
      body: JSON.stringify(book),
    });
    const data = await res.json();
    if (res.ok) {
      console.log(`  ✓ Imported: ${data.id || 'OK'} (${data.pages_count || '?'} pages)`);
      return { success: true, title: book.title };
    } else {
      console.log(`  ✗ Failed: ${data.error || data.message}`);
      return { success: false, title: book.title, error: data.error || data.message };
    }
  } catch (err) {
    console.log(`  ✗ Error: ${err.message}`);
    return { success: false, title: book.title, error: err.message };
  }
}

async function importIIIF(book) {
  console.log(`\nImporting (IIIF): ${book.title}`);
  console.log(`  Manifest: ${book.manifest_url}`);
  try {
    const res = await fetch(`${BASE}/iiif`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${CRON_SECRET}` },
      body: JSON.stringify(book),
    });
    const data = await res.json();
    if (res.ok) {
      console.log(`  ✓ Imported: ${data.id || 'OK'} (${data.pages_count || '?'} pages)`);
      return { success: true, title: book.title };
    } else {
      console.log(`  ✗ Failed: ${data.error || data.message}`);
      return { success: false, title: book.title, error: data.error || data.message };
    }
  } catch (err) {
    console.log(`  ✗ Error: ${err.message}`);
    return { success: false, title: book.title, error: err.message };
  }
}

async function main() {
  console.log('=== Issue #1041 Final Imports ===\n');
  const results = [];

  // IA imports
  const iaBooks = [
    { ia_identifier: 'tamburlainegreat1605marl', title: 'Tamburlaine the Great (1605 ed.)', author: 'Christopher Marlowe', year: 1605, original_language: 'English' },
    { ia_identifier: 'comediafamosalav00cald_0', title: 'La Vida es Sueño (c. 1650 ed.)', author: 'Pedro Calderón de la Barca', year: 1650, original_language: 'Spanish' },
    { ia_identifier: '02097225.cn', title: '閑情偶寄 (Xianqing Ouji, Casual Expressions of Idle Feeling), Vol. 1', author: 'Li Yu (李漁)', year: 1671, original_language: 'Chinese' },
  ];

  for (const book of iaBooks) {
    results.push(await importIA(book));
    await new Promise(r => setTimeout(r, 2000));
  }

  // IIIF imports
  const iiifBooks = [
    {
      manifest_url: 'https://digi.ub.uni-heidelberg.de/diglit/iiif/cpg466/manifest',
      title: 'Das Buch der Beispiele der Alten Weisen (illuminated MS, c. 1475)',
      author: 'Anton von Pforr',
      language: 'German',
      published: '1475',
    },
    {
      manifest_url: 'https://purl.stanford.edu/hg105nj7060/iiif/manifest',
      title: 'Anvar-i Suhaili (The Lights of Canopus, illuminated Persian MS, 1847)',
      author: 'Husayn Kashifi',
      language: 'Persian',
      published: '1847',
    },
  ];

  for (const book of iiifBooks) {
    results.push(await importIIIF(book));
    await new Promise(r => setTimeout(r, 3000));
  }

  console.log(`\n=== SUMMARY ===`);
  const s = results.filter(r => r.success);
  const f = results.filter(r => !r.success);
  console.log(`Imported: ${s.length}/${results.length}`);
  if (f.length) {
    console.log('Failed:');
    f.forEach(x => console.log(`  - ${x.title}: ${x.error}`));
  }
}

main().catch(console.error);
