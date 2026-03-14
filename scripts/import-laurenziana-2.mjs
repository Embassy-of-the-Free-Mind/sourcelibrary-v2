#!/usr/bin/env node
/**
 * Batch import additional Biblioteca Medicea Laurenziana manuscripts via IIIF
 * Source: OCLC ContentDM (cdm21059.contentdm.oclc.org)
 *
 * This is the second batch — alchemy, astrology, Neoplatonism, Hermetica
 * that weren't in the initial import.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/import-laurenziana-2.mjs
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
  // ===== ALCHEMY =====
  {
    title: 'Democriti Ars sacra cum Sinesii scholiis',
    display_title: 'Democritus, Sacred Art of Alchemy (with Synesius commentary)',
    author: 'Pseudo-Democritus; Synesius',
    shelfmark: 'Plut.76.72',
    cdm_id: '1015107',
    language: 'Greek',
    published: '16th century',
    categories: ['Alchemy', 'Hermetica'],
  },
  {
    title: 'Ars sacra philosophorum',
    display_title: 'Sacred Art of the Philosophers (Greek alchemical anthology)',
    author: 'Various',
    shelfmark: 'Plut.86.16',
    cdm_id: '1130230',
    language: 'Greek',
    published: '15th century (1491–1500)',
    categories: ['Alchemy', 'Hermetica'],
  },
  {
    title: 'Georgius Parmensis de magica disciplina',
    display_title: 'George of Parma, On the Magical Discipline',
    author: 'Georgius Parmensis',
    shelfmark: 'Plut.44.35',
    cdm_id: '756504',
    language: 'Latin',
    published: '16th century (1501–1510)',
    categories: ['Magic', 'Alchemy'],
  },

  // ===== ASTROLOGY =====
  {
    title: 'Tractatus astronomicus incerti auctoris. Iulii Firmici Materni Matheseos quidam libri',
    display_title: 'Firmicus Maternus, Mathesis (astrological treatise)',
    author: 'Firmicus Maternus',
    shelfmark: 'Plut.29.14',
    cdm_id: '599816',
    language: 'Latin',
    published: '14th century',
    categories: ['Astrology', 'Philosophy'],
  },
  {
    title: 'Iulii Firmici Iunioris Mathesis',
    display_title: 'Firmicus Maternus, Mathesis (second copy)',
    author: 'Firmicus Maternus',
    shelfmark: 'Plut.29.31',
    cdm_id: '685085',
    language: 'Latin',
    published: '15th century',
    categories: ['Astrology', 'Philosophy'],
  },
  {
    title: 'Procli subfiguratio astronomicarum supputationum',
    display_title: 'Proclus, Astronomical Calculations (Hypotyposis)',
    author: 'Proclus',
    shelfmark: 'Plut.28.28',
    cdm_id: '580454',
    language: 'Greek',
    published: '15th century',
    categories: ['Astrology', 'Neoplatonism'],
  },
  {
    title: 'Theonis Expositio in astronomiam',
    display_title: 'Theon of Smyrna, Exposition on Astronomy',
    author: 'Theon of Smyrna',
    shelfmark: 'Plut.28.7',
    cdm_id: '667777',
    language: 'Greek',
    published: '14th century',
    categories: ['Astrology', 'Philosophy'],
  },
  {
    title: 'Theonis Smyrnaei de mathematicis utilibus ad Platonis lectionem',
    display_title: 'Theon of Smyrna, Mathematics Useful for Reading Plato',
    author: 'Theon of Smyrna',
    shelfmark: 'Plut.28.12',
    cdm_id: '643995',
    language: 'Greek',
    published: '14th century',
    categories: ['Philosophy', 'Neoplatonism'],
  },
  {
    title: 'Procli successoris designatio astronomicorum',
    display_title: 'Proclus, Designation of Astronomical [Hypotheses]',
    author: 'Proclus',
    shelfmark: 'Plut.28.48',
    cdm_id: '522526',
    language: 'Greek',
    published: '11th century',
    categories: ['Astrology', 'Neoplatonism'],
  },

  // ===== NEOPLATONISM =====
  {
    title: 'Proclus in Politiam Platonis',
    display_title: 'Proclus, Commentary on Plato\'s Republic',
    author: 'Proclus',
    shelfmark: 'Plut.80.9',
    cdm_id: '933214',
    language: 'Greek',
    published: '11th century',
    categories: ['Neoplatonism', 'Philosophy'],
  },
  {
    title: 'Procli Platonici Expositio in Parmenidem Platonis',
    display_title: 'Proclus, Commentary on Plato\'s Parmenides',
    author: 'Proclus',
    shelfmark: 'Plut.85.8',
    cdm_id: '1012570',
    language: 'Greek',
    published: '15th century',
    categories: ['Neoplatonism', 'Philosophy'],
  },
  {
    title: 'Iamblichus De Pythagorica secta; Marini Proclus; Aristotelis De mirabilibus; Theophrasti Characteres',
    display_title: 'Iamblichus, On the Pythagorean School (with Marinus Life of Proclus)',
    author: 'Iamblichus; Marinus; Aristotle; Theophrastus',
    shelfmark: 'Plut.86.3',
    cdm_id: '913126',
    language: 'Greek',
    published: '14th century',
    categories: ['Neoplatonism', 'Philosophy'],
  },
  {
    title: 'Chalcidius In Timaeum Platonis',
    display_title: 'Chalcidius, Commentary on Plato\'s Timaeus',
    author: 'Chalcidius',
    shelfmark: 'Plut.84.24',
    cdm_id: '1163427',
    language: 'Latin',
    published: '15th century',
    categories: ['Neoplatonism', 'Philosophy'],
  },
  {
    title: 'Plotini Enneades VI et Maximi Tyrii Dissertationes XI',
    display_title: 'Plotinus, Ennead VI & Maximus of Tyre, Dissertations (Greek)',
    author: 'Plotinus; Maximus of Tyre',
    shelfmark: 'Plut.85.15',
    cdm_id: '980143',
    language: 'Greek',
    published: '14th century',
    categories: ['Neoplatonism', 'Philosophy'],
  },
  {
    title: 'Scipionis somnium. Macrobii Commentaria. Georgii Gemisti opera',
    display_title: 'Dream of Scipio, Macrobius Commentary & Gemistus Pletho',
    author: 'Macrobius; Gemistus Pletho',
    shelfmark: 'Plut.80.24',
    cdm_id: '930888',
    language: 'Latin',
    published: '15th century (1491–1500)',
    categories: ['Neoplatonism', 'Philosophy'],
  },

  // ===== HERMETICA =====
  {
    title: 'Mercurius Trismeg. De potestate et sapientia Dei, et alia Ficini Opera',
    display_title: 'Hermes Trismegistus & Ficino, On Power and Wisdom of God (with other Ficino works)',
    author: 'Hermes Trismegistus; Marsilio Ficino',
    shelfmark: 'Plut.27.9',
    cdm_id: '501951',
    language: 'Latin',
    published: '15th century',
    categories: ['Hermetica', 'Neoplatonism'],
  },
  {
    title: 'Mercurius Trimegistus Ficino interprete. varia Marsilii Ficini opera',
    display_title: 'Hermes Trismegistus (Ficino translation) & Various Ficino Works',
    author: 'Hermes Trismegistus; Marsilio Ficino',
    shelfmark: 'Plut.21.8',
    cdm_id: '56234',
    language: 'Latin',
    published: '15th century',
    categories: ['Hermetica', 'Neoplatonism'],
  },
  {
    title: 'Mercurius Trismegistus a Ficino Latine interpretatus. aliorum philosophorum scripta',
    display_title: 'Hermes Trismegistus (Ficino Latin translation) with Philosophical Writings',
    author: 'Hermes Trismegistus; Marsilio Ficino',
    shelfmark: 'Plut.21.21',
    cdm_id: '224251',
    language: 'Latin',
    published: '15th century',
    categories: ['Hermetica', 'Neoplatonism'],
  },
  {
    title: 'Philosophica quaedam, Trismegistus per Apuleium et per Marsilium Ficinum traductus',
    display_title: 'Hermes Trismegistus translated by Apuleius & Ficino',
    author: 'Hermes Trismegistus; Apuleius; Marsilio Ficino',
    shelfmark: 'Plut.89 sup.71',
    cdm_id: '1096587',
    language: 'Latin',
    published: '15th century',
    categories: ['Hermetica'],
  },
  {
    title: 'Leonardi Arretini quaedam, Mercurius [Trismegistus]',
    display_title: 'Leonardo Bruni & Hermes Trismegistus',
    author: 'Leonardo Bruni; Hermes Trismegistus',
    shelfmark: 'Plut.90 sup.51',
    cdm_id: '1102710',
    language: 'Latin',
    published: '15th century',
    categories: ['Hermetica', 'Philosophy'],
  },
  {
    title: 'Hermetis Expositio Phaedri',
    display_title: 'Hermias, Commentary on Plato\'s Phaedrus',
    author: 'Hermias',
    shelfmark: 'Plut.86.4',
    cdm_id: '1048147',
    language: 'Greek',
    published: '15th century',
    categories: ['Neoplatonism', 'Philosophy'],
  },

  // ===== HIEROGLYPHICA =====
  {
    title: 'Aristotelis Moralia ad Eudemum. Ac praeterea Horapollinis Niloi Hieroglyphica',
    display_title: 'Horapollo, Hieroglyphica (with Aristotle Eudemian Ethics)',
    author: 'Horapollo; Aristotle',
    shelfmark: 'Plut.81.15',
    cdm_id: '1065201',
    language: 'Greek',
    published: '15th century',
    categories: ['Hermetica', 'Philosophy'],
  },
  {
    title: 'Aristotelis Moralia ad Eudemum. Ac praeterea Hori Apollinis hieroglyphica et Platonis definitiones',
    display_title: 'Horapollo, Hieroglyphica & Platonic Definitions (with Aristotle)',
    author: 'Horapollo; Aristotle; Plato',
    shelfmark: 'Plut.81.20',
    cdm_id: '1076628',
    language: 'Greek',
    published: '15th century',
    categories: ['Hermetica', 'Philosophy'],
  },

  // ===== PORPHYRY (additional) =====
  {
    title: 'Porphyrii et Ammonii Expositio in X praedicamenta',
    display_title: 'Porphyry & Ammonius, Commentary on Aristotle\'s Categories',
    author: 'Porphyry; Ammonius',
    shelfmark: 'Plut.71.3',
    cdm_id: '1201474',
    language: 'Greek',
    published: '13th century',
    categories: ['Neoplatonism', 'Philosophy'],
  },

  // ===== APOLLONIUS / ORPHIC =====
  {
    title: 'Lycophron; Apollonii Rhodii Argonautica; Orphei Argonautica et hymni',
    display_title: 'Apollonius Argonautica & Orphic Argonautica with Hymns',
    author: 'Apollonius Rhodius; Orpheus; Lycophron',
    shelfmark: 'Plut.32.45',
    cdm_id: '511600',
    language: 'Greek',
    published: '15th century',
    categories: ['Neoplatonism', 'Philosophy'],
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
  console.log(`\nLaurenziana IIIF Import — Batch 2${DRY_RUN ? ' (DRY RUN)' : ''}`);
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
