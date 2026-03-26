#!/usr/bin/env node
/**
 * Batch import: Missing Loeb Classical Library authors
 * GitHub issue #409
 *
 * Run: set -a; source .env.production.local; set +a; node scripts/import/batch-loeb-classics.mjs
 *
 * 8 early printed Latin editions from Internet Archive.
 * Tacitus and Horace already imported separately.
 */
const BASE = 'https://sourcelibrary.org';
const AUTH = `Bearer ${process.env.CRON_SECRET}`;

const imports = [
  {
    ia_identifier: 'exxiiiitliuiidec02livy',
    title: 'Historiarum Decades',
    author: 'Titus Livius',
    year: 1518,
    original_language: 'Latin',
  },
  {
    ia_identifier: 'gri_33125010921506',
    title: 'Vitae XII Caesarum',
    author: 'Gaius Suetonius Tranquillus',
    year: 1506,
    original_language: 'Latin',
  },
  {
    ia_identifier: 'opera00ovid',
    title: 'Opera',
    author: 'Publius Ovidius Naso',
    year: 1480,
    original_language: 'Latin',
  },
  {
    ia_identifier: 'TLucretiCaripoe00Lucr',
    title: 'De Rerum Natura',
    author: 'Titus Lucretius Carus',
    year: 1486,
    original_language: 'Latin',
  },
  {
    ia_identifier: 'demosthenisorati00demo_0',
    title: 'Orationes quatuor contra Philippum',
    author: 'Demosthenes',
    year: 1549,
    original_language: 'Latin',
  },
  {
    ia_identifier: 'ppn-1013785738',
    title: 'Geographia',
    author: 'Strabo',
    year: 1469,
    original_language: 'Latin',
  },
  {
    ia_identifier: 'mplautilinguaela00plau',
    title: 'Comoediae viginti',
    author: 'Titus Maccius Plautus',
    year: 1511,
    original_language: 'Latin',
  },
  {
    ia_identifier: 'OEXV815_2_P1',
    title: 'Comoediae sex',
    author: 'Publius Terentius Afer',
    year: 1495,
    original_language: 'Latin',
  },
];

let imported = 0, skipped = 0, errors = 0, totalPages = 0;

for (let i = 0; i < imports.length; i++) {
  const item = imports[i];
  console.log(`[${i + 1}/${imports.length}] ${item.ia_identifier} — ${item.author}`);
  try {
    const resp = await fetch(`${BASE}/api/import/ia`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': AUTH },
      body: JSON.stringify(item),
    });
    const data = await resp.json();
    if (!resp.ok) {
      if (resp.status === 409 || (data.error && data.error.includes('already'))) {
        console.log(`  SKIP (dupe): ${item.title}`);
        skipped++;
      } else {
        console.log(`  ERROR: ${item.title} — ${JSON.stringify(data.error || data.details || data).substring(0, 200)}`);
        errors++;
      }
    } else {
      const pages = data.book?.pages_count || data.pagesCreated || 0;
      console.log(`  OK: ${item.title} — ${pages} pages`);
      imported++;
      totalPages += pages;
    }
  } catch (err) {
    console.log(`  ERROR: ${item.title} — ${err.message}`);
    errors++;
  }
  if (i < imports.length - 1) await new Promise(r => setTimeout(r, 3000));
}

console.log(`\nDone: ${imported} imported, ${skipped} dupes, ${errors} errors, ${totalPages} pages`);
