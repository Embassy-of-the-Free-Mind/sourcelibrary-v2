#!/usr/bin/env node
/**
 * Batch import Biblioteca Medicea Laurenziana manuscripts via IIIF
 * Source: OCLC ContentDM (cdm21059.contentdm.oclc.org)
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/import-laurenziana.mjs
 *
 * Add --dry-run to test manifest fetching without importing.
 */

const API_BASE = process.env.NEXT_PUBLIC_SITE_URL || 'https://sourcelibrary.org';
const API_KEY = process.env.CRON_SECRET;
const DRY_RUN = process.argv.includes('--dry-run');

if (!API_KEY) {
  console.error('Missing CRON_SECRET. Source .env.production.local first.');
  process.exit(1);
}

const CONTRIBUTING_LIBRARY = 'Biblioteca Medicea Laurenziana';
const PROVIDER = 'Biblioteca Medicea Laurenziana';
const CDM_BASE = 'https://cdm21059.contentdm.oclc.org/iiif/plutei:';

const MANUSCRIPTS = [
  // Hermetica
  {
    title: 'Mercurii Trismegisti Pimander, Marsilio Ficino interprete',
    display_title: 'Corpus Hermeticum (Pimander), Ficino translation',
    author: 'Hermes Trismegistus; Marsilio Ficino (translator)',
    shelfmark: 'Plut.83.14',
    cdm_id: '1190117',
    language: 'Latin',
    published: '15th century',
    categories: ['Hermetica', 'Neoplatonism'],
  },
  {
    title: 'Trismegistus De potestate et sapientia Dei, Ficino interprete',
    display_title: 'Hermes Trismegistus, On the Power and Wisdom of God (Ficino)',
    author: 'Hermes Trismegistus; Marsilio Ficino (translator)',
    shelfmark: 'Plut.89 sup.69',
    cdm_id: '926791',
    language: 'Latin',
    published: '15th century',
    categories: ['Hermetica'],
  },
  {
    title: 'Hieroclis Expositio versuum Pythagorae, Hermes Trismegistus',
    display_title: 'Hierocles on Pythagoras & Hermes Trismegistus (Apuleius translation)',
    author: 'Hierocles; Hermes Trismegistus',
    shelfmark: 'Plut.52.12',
    cdm_id: '822457',
    language: 'Latin',
    published: '15th century',
    categories: ['Hermetica', 'Neoplatonism'],
  },
  // Neoplatonism — Ficino translations
  {
    title: 'Plotinus, Vita Plotini et eius Libri IV a Marsilio Ficino traducti',
    display_title: 'Plotinus, Enneads I–XXVI (Ficino translation, dedicatory copy)',
    author: 'Plotinus; Marsilio Ficino (translator)',
    shelfmark: 'Plut.82.10',
    cdm_id: '1035555',
    language: 'Latin',
    published: '15th century (before 1492)',
    categories: ['Neoplatonism', 'Philosophy'],
  },
  {
    title: 'Plotini Libri XXVII posteriores Marsilio Ficino interprete',
    display_title: 'Plotinus, Enneads XXVII–LIV (Ficino translation)',
    author: 'Plotinus; Marsilio Ficino (translator)',
    shelfmark: 'Plut.82.11',
    cdm_id: '1456157',
    language: 'Latin',
    published: '1490',
    categories: ['Neoplatonism', 'Philosophy'],
  },
  {
    title: 'Platonis Opera Marsilio Ficino interprete',
    display_title: 'Plato, Complete Works (Ficino translation)',
    author: 'Plato; Marsilio Ficino (translator)',
    shelfmark: 'Plut.82.7',
    cdm_id: '1025941',
    language: 'Latin',
    published: '15th century',
    categories: ['Neoplatonism', 'Philosophy'],
  },
  {
    title: 'Platonis Dialogi Marsilio Ficino interprete',
    display_title: 'Plato, Dialogues (Ficino translation, with De Amore)',
    author: 'Plato; Marsilio Ficino (translator)',
    shelfmark: 'Plut.82.6',
    cdm_id: '1189000',
    language: 'Latin',
    published: '15th century (after 1469)',
    categories: ['Neoplatonism', 'Philosophy'],
  },
  {
    title: 'Synesius De somniis, Iamblichus, Proclus, Porphyrius, Ficino interprete',
    display_title: 'Synesius On Dreams, Iamblichus, Proclus & Porphyry (Ficino)',
    author: 'Synesius; Iamblichus; Proclus; Porphyry; Marsilio Ficino (translator)',
    shelfmark: 'Plut.82.15',
    cdm_id: '1001905',
    language: 'Latin',
    published: '15th century',
    categories: ['Neoplatonism', 'Philosophy', 'Magic'],
  },
  // Iamblichus
  {
    title: 'Iamblichi De Mysteriis Aegyptiorum liber',
    display_title: 'Iamblichus, On the Mysteries of the Egyptians',
    author: 'Iamblichus',
    shelfmark: 'Plut.10.32',
    cdm_id: '64544',
    language: 'Greek',
    published: '15th century',
    categories: ['Neoplatonism', 'Hermetica', 'Magic'],
  },
  // Porphyry & Proclus
  {
    title: 'Porphyrii Introductio, Ammonii, Procli Diadochi commentarii',
    display_title: 'Porphyry Isagoge & Neoplatonic Commentaries (Proclus, Ammonius)',
    author: 'Porphyry; Proclus; Ammonius',
    shelfmark: 'Plut.71.32',
    cdm_id: '1209945',
    language: 'Greek',
    published: '14th century',
    categories: ['Neoplatonism', 'Philosophy'],
  },
  // Orphica
  {
    title: 'Orphei Hymni, Orphei Argonautica, Procli Hymni',
    display_title: 'Orphic Hymns, Orphic Argonautica & Hymns of Proclus',
    author: 'Orpheus; Proclus',
    shelfmark: 'Plut.70.35',
    cdm_id: '1198899',
    language: 'Greek',
    published: '15th century',
    categories: ['Neoplatonism', 'Philosophy'],
  },
  {
    title: 'Orphei Carmina',
    display_title: 'Orphic Poems',
    author: 'Orpheus',
    shelfmark: 'Plut.36.35',
    cdm_id: '597336',
    language: 'Greek',
    published: '16th century',
    categories: ['Neoplatonism', 'Philosophy'],
  },
  // Apuleius
  {
    title: 'Cornelius Tacitus, et Apuleius longobardis characteribus',
    display_title: 'Apuleius, Metamorphoses (Codex F — archetype manuscript)',
    author: 'Apuleius; Cornelius Tacitus',
    shelfmark: 'Plut.68.2',
    cdm_id: '1335097',
    language: 'Latin',
    published: '11th century',
    categories: ['Philosophy', 'Magic'],
  },
];

async function testManifest(url) {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'SourceLibrary/1.0 (https://sourcelibrary.org)',
        Accept: 'application/json, application/ld+json',
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const canvases = data.items?.length || data.sequences?.[0]?.canvases?.length || 0;
    return canvases > 1 ? { data, canvases } : null;
  } catch {
    return null;
  }
}

async function importBook(ms, manifestUrl, manifestData) {
  const payload = {
    manifest_url: manifestUrl,
    manifest_data: manifestData,
    title: ms.title,
    display_title: ms.display_title,
    author: ms.author,
    language: ms.language,
    published: ms.published,
    categories: ms.categories,
    provider: PROVIDER,
    contributing_library: CONTRIBUTING_LIBRARY,
    shelfmark: ms.shelfmark,
  };

  const res = await fetch(`${API_BASE}/api/import/iiif`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify(payload),
  });

  return res.json();
}

async function main() {
  console.log(`\nLaurenziana IIIF Import${DRY_RUN ? ' (DRY RUN)' : ''}`);
  console.log(`API: ${API_BASE}`);
  console.log(`Manuscripts: ${MANUSCRIPTS.length}\n`);

  let imported = 0;
  let failed = 0;
  let skipped = 0;

  for (const ms of MANUSCRIPTS) {
    const manifestUrl = `${CDM_BASE}${ms.cdm_id}/manifest.json`;
    process.stdout.write(`[${ms.shelfmark}] ${ms.display_title}... `);

    const manifest = await testManifest(manifestUrl);
    if (!manifest) {
      console.log('SKIP (no working manifest)');
      failed++;
      continue;
    }

    console.log(`${manifest.canvases} pages`);

    if (DRY_RUN) {
      console.log(`  -> Would import from ${manifestUrl}`);
      skipped++;
      continue;
    }

    try {
      const result = await importBook(ms, manifestUrl, manifest.data);
      if (result.success) {
        console.log(`  -> Imported: ${API_BASE}/book/${result.bookId} (${result.pagesCreated} pages)`);
        imported++;
      } else if (result.error?.includes('already exists')) {
        console.log(`  -> Already exists (${result.existingId})`);
        skipped++;
      } else {
        console.log(`  -> Error: ${result.error}`);
        failed++;
      }
    } catch (err) {
      console.log(`  -> Error: ${err.message}`);
      failed++;
    }

    // Be polite to ContentDM
    await new Promise((r) => setTimeout(r, 2000));
  }

  console.log(`\nDone. Imported: ${imported}, Skipped: ${skipped}, Failed: ${failed}`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
