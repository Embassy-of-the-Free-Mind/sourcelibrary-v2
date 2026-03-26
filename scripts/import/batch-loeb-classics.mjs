#!/usr/bin/env node
/**
 * Batch import: Missing Loeb Classical Library authors
 * GitHub issue #409
 *
 * Run: set -a; source .env.production.local; set +a; node scripts/import/batch-loeb-classics.mjs
 *
 * Mix of Gallica (IIIF manuscripts/incunabula) and IA sources.
 * Tacitus, Horace, and Ovid already imported separately.
 */
const BASE = 'https://sourcelibrary.org';
const AUTH = `Bearer ${process.env.CRON_SECRET}`;

const imports = [
  // Suetonius — Gallica, early printed edition ~1490-1508
  {
    route: 'gallica',
    body: {
      ark: 'btv1b530148127',
      title: 'De vita et moribus Caesarum libri duodecim',
      author: 'Gaius Suetonius Tranquillus',
      year: 1495,
      original_language: 'Latin',
    },
  },
  // Plautus — Gallica, c.1500 with Pii commentary
  {
    route: 'gallica',
    body: {
      ark: 'bpt6k60103h',
      title: 'Plautus integer cum interpretatione Joannis Baptistae Pii',
      author: 'Titus Maccius Plautus',
      year: 1500,
      original_language: 'Latin',
    },
  },
  // Terence — Gallica, 15th century manuscript with all 6 comedies
  {
    route: 'gallica',
    body: {
      ark: 'btv1b8451609j',
      title: 'Comoediae sex',
      author: 'Publius Terentius Afer',
      year: 1450,
      original_language: 'Latin',
    },
  },
  // Strabo — Gallica, 15th century Guarino Veronensis translation
  {
    route: 'gallica',
    body: {
      ark: 'btv1b8446961t',
      title: 'Geographica',
      author: 'Strabo',
      year: 1469,
      original_language: 'Latin',
    },
  },
  // Livy — Gallica, medieval manuscript
  {
    route: 'gallica',
    body: {
      ark: 'btv1b84540228',
      title: 'Historiarum ab urbe condita libri',
      author: 'Titus Livius',
      year: 1350,
      original_language: 'Latin',
    },
  },
  // Lucretius — IA, 1486 editio princeps
  {
    route: 'ia',
    body: {
      ia_identifier: 'TLucretiCaripoe00Lucr',
      title: 'De Rerum Natura',
      author: 'Titus Lucretius Carus',
      year: 1486,
      original_language: 'Latin',
    },
  },
  // Demosthenes — IA, 1549 orations
  {
    route: 'ia',
    body: {
      ia_identifier: 'demosthenisorati00demo_0',
      title: 'Orationes quatuor contra Philippum',
      author: 'Demosthenes',
      year: 1549,
      original_language: 'Latin',
    },
  },
];

let imported = 0, skipped = 0, errors = 0, totalPages = 0;

for (let i = 0; i < imports.length; i++) {
  const { route, body } = imports[i];
  const label = body.ark || body.ia_identifier;
  console.log(`[${i + 1}/${imports.length}] ${route}: ${label} — ${body.author}`);
  try {
    const resp = await fetch(`${BASE}/api/import/${route}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': AUTH },
      body: JSON.stringify(body),
    });
    const data = await resp.json();
    if (!resp.ok) {
      if (resp.status === 409 || (data.error && data.error.includes('already'))) {
        console.log(`  SKIP (dupe): ${body.title}`);
        skipped++;
      } else {
        console.log(`  ERROR: ${body.title} — ${JSON.stringify(data).substring(0, 300)}`);
        errors++;
      }
    } else {
      const pages = data.book?.pages_count || data.pagesCreated || 0;
      console.log(`  OK: ${body.title} — ${pages} pages`);
      imported++;
      totalPages += pages;
    }
  } catch (err) {
    console.log(`  ERROR: ${body.title} — ${err.message}`);
    errors++;
  }
  if (i < imports.length - 1) await new Promise(r => setTimeout(r, 3000));
}

console.log(`\nDone: ${imported} imported, ${skipped} dupes, ${errors} errors, ${totalPages} pages`);
