#!/usr/bin/env node
/**
 * Batch import: Visual art from non-textual traditions
 * Theme: sex, drugs, aliens (broadly interpreted)
 *
 * Phase 1: Mesoamerican codices (IA + IIIF)
 * Phase 2: Egyptian erotica & fertility (museums)
 * Phase 3: Entheogen & field art documentation (IA)
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/import/batch-import-visual-art-2026-04.mjs
 *   Add --dry-run to skip actual imports
 *   Add --phase=2 to run only a specific phase
 */

const API_BASE = 'https://sourcelibrary.org';
const CRON_SECRET = process.env.CRON_SECRET;
const DRY_RUN = process.argv.includes('--dry-run');
const PHASE_ARG = process.argv.find(a => a.startsWith('--phase='));
const PHASE_FILTER = PHASE_ARG ? parseInt(PHASE_ARG.split('=')[1]) : null;

if (!CRON_SECRET) {
  console.error('CRON_SECRET not set. Source .env.production.local first.');
  process.exit(1);
}

// ========================================
// Phase 1: Mesoamerican Codices (Internet Archive)
// ========================================
const mesoamerican_ia = [
  // NOTE: Already in library: Codex Magliabechiano, Codex Telleriano-Remensis, Florentine Codex (3 vols),
  //       Codex Borgia, Codex Mendoza, Dresden Codex, Paris Codex, Codex Laud
  // NOTE: codex-borbonicus, codex-cospi, codex-zouche-nuttall on IA are text PDFs, not scans — use IIIF instead

  // --- AZTEC (proper facsimile scans on IA) ---
  {
    ia_identifier: 'codexfejeyrvayr00sele',
    title: 'Codex Fejérváry-Mayer',
    author: 'Unknown pre-Columbian scribes',
    year: 1400,
    original_language: 'Nahuatl',
    language: 'Nahuatl',
    categories: ['Mesoamerican', 'Visual Art'],
    notes: 'Cosmogram of the four directions, Aztec cosmology, ritual calendar. Seler edition. 86 pages.',
  },

  // --- MAYA (225 images, good scan) ---
  {
    ia_identifier: 'madrid-codex',
    title: 'Madrid Codex (Codex Tro-Cortesianus)',
    author: 'Unknown Maya scribes',
    year: 1400,
    original_language: 'Maya hieroglyphs',
    language: 'Maya hieroglyphs',
    categories: ['Mesoamerican', 'Visual Art'],
    notes: 'Longest surviving Maya codex — agriculture, bee-keeping, hunting, deity rituals. 225 images.',
  },
];

// ========================================
// Phase 1b: Mesoamerican Codices (IIIF)
// ========================================
const mesoamerican_iiif = [
  {
    manifest_url: 'https://digi.vatlib.it/iiif/MSS_Vat.lat.3773/manifest.json',
    title: 'Codex Vaticanus B (Codex Vaticanus 3773)',
    display_title: 'Codex Vaticanus B',
    author: 'Unknown Mixtec-Puebla scribes',
    published: '1400',
    language: 'Nahuatl',
    categories: ['Mesoamerican', 'Visual Art'],
    contributing_library: 'Biblioteca Apostolica Vaticana',
    notes: '111 pages of Mixtec cosmological art — deities, ritual calendar, night sky, underworld',
  },
  {
    manifest_url: 'https://digi.vatlib.it/iiif/MSS_Vat.lat.3738/manifest.json',
    title: 'Codex Vaticanus A (Codex Rios)',
    display_title: 'Codex Vaticanus A',
    author: 'Unknown Aztec-colonial scribes',
    published: '1570',
    language: 'Nahuatl',
    categories: ['Mesoamerican', 'Visual Art'],
    contributing_library: 'Biblioteca Apostolica Vaticana',
    notes: '222 pages — Five Suns cosmology, deity paintings, calendar, colonial-era copy with Italian glosses',
  },
  {
    manifest_url: 'https://iiif.bodleian.ox.ac.uk/iiif/manifest/2b06f496-3092-43fb-b0c1-fd0b377dabbd.json',
    title: 'Codex Bodley (MS. Mex. d. 1)',
    display_title: 'Codex Bodley',
    author: 'Unknown Mixtec scribes',
    published: '1500',
    language: 'Mixtec',
    categories: ['Mesoamerican', 'Visual Art'],
    contributing_library: 'Bodleian Library, University of Oxford',
    notes: '49 pages — Mixtec genealogy, dynastic history, conquest narratives',
  },
  {
    manifest_url: 'https://iiif.bodleian.ox.ac.uk/iiif/manifest/5fb5517b-0539-4531-b996-44fa52ede044.json',
    title: 'Codex Selden (Codex Añute, MS. Arch. Selden. A. 2)',
    display_title: 'Codex Selden',
    author: 'Unknown Mixtec scribes',
    published: '1560',
    language: 'Mixtec',
    categories: ['Mesoamerican', 'Visual Art'],
    contributing_library: 'Bodleian Library, University of Oxford',
    notes: '21 pages — Mixtec screenfold, genealogy of Lady 6 Monkey of Añute (Jaltepec)',
  },
  {
    route: 'gallica',
    ark: 'btv1b55005834g',
    title: 'Codex Mexicanus',
    author: 'Unknown Aztec scribes',
    published: '1590',
    language: 'Nahuatl',
    categories: ['Mesoamerican', 'Visual Art'],
    contributing_library: 'Bibliothèque nationale de France',
    notes: 'Aztec historical annals with calendar, genealogies, and colonial-era pictorial records',
  },
  {
    route: 'gallica',
    ark: 'btv1b84582686',
    title: 'Codex Azcatitlan',
    author: 'Unknown Aztec scribes',
    published: '1530',
    language: 'Nahuatl',
    categories: ['Mesoamerican', 'Visual Art'],
    contributing_library: 'Bibliothèque nationale de France',
    notes: 'Aztec migration narrative — from Aztlan to Tenochtitlan, Spanish conquest. Vivid painted scenes.',
  },
];

// ========================================
// Phase 2: Egyptian Erotica & Fertility
// (To be populated after Berlin/museum research)
// ========================================
const egyptian_ia = [
  {
    ia_identifier: 'papyrusdeturin02muse',
    title: 'Papyrus de Turin (Facsimile)',
    author: 'Museo Egizio di Torino',
    year: 1869,
    original_language: 'Egyptian',
    language: 'Italian',
    categories: ['Egyptian', 'Visual Art'],
    notes: '19th-century facsimile of Turin papyrus collection — includes geographic and satirical papyri',
  },
  {
    ia_identifier: 'derpapyrus55001u0000omli',
    title: 'Der Papyrus 55001 und seine satirisch-erotischen Zeichnungen und Inschriften',
    author: 'Joseph A. Omlin',
    year: 1973,
    original_language: 'German',
    language: 'German',
    categories: ['Egyptian', 'Visual Art'],
    notes: 'Definitive scholarly publication of the Turin Erotic Papyrus (Cat. 2031/CGT 55001). 136 pages with plates.',
  },
];

// ========================================
// Phase 3: Sacred Sexuality & Phallic Worship
// ========================================
const sex_ia = [
  {
    ia_identifier: 'primitiveerotica0000raws',
    title: 'Primitive Erotic Art',
    author: 'Philip Rawson (ed.)',
    year: 1973,
    original_language: 'English',
    language: 'English',
    categories: ['Visual Art', 'Anthropology'],
    notes: 'Survey of erotic art across pre-modern cultures worldwide — illustrated plates',
  },
  {
    ia_identifier: 'eroticartofeasts0000raws',
    title: 'Erotic Art of the East',
    author: 'Philip Rawson',
    year: 1968,
    original_language: 'English',
    language: 'English',
    categories: ['Visual Art', 'Anthropology'],
    notes: 'Sexual themes in oriental painting and sculpture — India, China, Japan',
  },
  {
    ia_identifier: 'shungaartoflovei0000evan_f8u7',
    title: 'Shunga: The Art of Love in Japan',
    author: 'Tom Evans & Mary Anne Evans',
    year: 1970,
    original_language: 'English',
    language: 'English',
    categories: ['Visual Art', 'Japanese Art'],
    notes: 'Japanese erotic woodblock prints — Hokusai, Utamaro, Kunisada. Heavily illustrated.',
  },
  {
    ia_identifier: 'yxhy_kama-kala-some-notes-on-the-philosophical-basis-of-hindu-erotic-sculpture-by-mul',
    title: 'Kama Kala: Notes on the Philosophical Basis of Hindu Erotic Sculpture',
    author: 'Mulk Raj Anand',
    year: 1958,
    original_language: 'English',
    language: 'English',
    categories: ['Visual Art', 'Sacred Architecture'],
    notes: 'Philosophical analysis of Hindu temple erotica — Khajuraho, Konark. Illustrated.',
  },
  {
    ia_identifier: 'ancientsymbolwor00west',
    title: 'Ancient Symbol Worship: Influence of the Phallic Idea in the Religions of Antiquity',
    author: 'Hodder M. Westropp & C. Staniland Wake',
    year: 1874,
    original_language: 'English',
    language: 'English',
    categories: ['Visual Art', 'Anthropology', 'Religion'],
    notes: 'Victorian comparative study of phallic symbolism across ancient religions — illustrated with plates',
  },
  {
    ia_identifier: 'cultusarborumdes00lond',
    title: 'Cultus Arborum: A Descriptive Account of Phallic Tree Worship',
    author: 'Anonymous',
    year: 1890,
    original_language: 'English',
    language: 'English',
    categories: ['Anthropology', 'Religion'],
    notes: 'Phallic tree worship across eastern and western nations from antiquity to modern times',
  },
  {
    ia_identifier: 'fishesflowersfi00readgoog',
    title: 'Fishes, Flowers & Fire as Elements and Deities in the Phallic Faiths',
    author: 'Anonymous',
    year: 1890,
    original_language: 'English',
    language: 'English',
    categories: ['Anthropology', 'Religion'],
    notes: 'Phallic symbolism in Greece, Babylon, Rome, India — illustrated with myths and legends',
  },
  {
    ia_identifier: 'annotationsonsac00sellrich',
    title: 'Annotations on the Sacred Writings of the Hindūs: Priapic Rites and Phallic Principles',
    author: 'Edward Sellon',
    year: 1902,
    original_language: 'English',
    language: 'English',
    categories: ['Anthropology', 'Religion'],
    notes: 'Hindu sacred sexuality and phallic worship — illustrated',
  },
  {
    ia_identifier: 'khajuraho00kris',
    title: 'Khajuraho',
    author: 'Krishna Deva',
    year: 1960,
    original_language: 'English',
    language: 'English',
    categories: ['Visual Art', 'Sacred Architecture'],
    notes: 'Photographic documentation of Khajuraho temple sculptures including erotic art',
  },
  {
    ia_identifier: 'kamasutraeroticf0000unse_n4p3',
    title: 'The Kama-Sutra: Erotic Figures in Indian Art',
    author: 'Various',
    year: 1980,
    original_language: 'English',
    language: 'English',
    categories: ['Visual Art', 'Sacred Architecture'],
    notes: 'Illustrated survey of Indian erotic sculpture — 114 pages of plates',
  },
  {
    ia_identifier: 'mocheartofperupr0000donn',
    title: 'Moche Art of Peru: Pre-Columbian Symbolic Communication',
    author: 'Christopher B. Donnan',
    year: 1978,
    original_language: 'English',
    language: 'English',
    categories: ['Visual Art', 'Pre-Columbian'],
    notes: 'Moche pottery and art including erotic ceramics — 234 pages, heavily illustrated',
  },
  {
    ia_identifier: 'mochepotteryfrom0000bank',
    title: 'Moche Pottery from Peru',
    author: 'George Bankes',
    year: 1980,
    original_language: 'English',
    language: 'English',
    categories: ['Visual Art', 'Pre-Columbian'],
    notes: 'Moche ceramic art including supernatural beings and erotic scenes — 62 pages',
  },
  {
    ia_identifier: 'hokusai-shunga',
    title: 'Hokusai Shunga',
    author: 'Katsushika Hokusai',
    year: 1820,
    original_language: 'Japanese',
    language: 'Japanese',
    categories: ['Visual Art', 'Japanese Art'],
    notes: 'Hokusai erotic woodblock prints — 21 images including The Dream of the Fisherman\'s Wife',
  },
];

// ========================================
// Phase 4: Entheogen & Sacred Plant Documentation
// ========================================
const entheogen_ia = [
  {
    ia_identifier: 'mobot31753000540531',
    title: 'Theatrum Fungorum',
    author: 'Franciscus van Sterbeeck',
    year: 1675,
    original_language: 'Dutch',
    language: 'Dutch',
    categories: ['Botany', 'Visual Art'],
    notes: 'One of the first books dedicated entirely to fungi — beautiful hand-colored plates',
  },
];

// ========================================
// Phase 5: "Aliens" — Ancient Anomalous Art & Rock Art
// ========================================
const anomalous_ia = [
  {
    ia_identifier: 'HenriLhoteTheSearchForTheTassiliFrescoesTheStoryOfThePrehistoricRockPaintingOfTheSahara1959',
    title: 'The Search for the Tassili Frescoes',
    author: 'Henri Lhote',
    year: 1959,
    original_language: 'French',
    language: 'English',
    categories: ['Visual Art', 'Archaeology'],
    notes: 'Saharan cave paintings including the famous "Great God" figures — often cited in ancient astronaut theories',
  },
  {
    ia_identifier: 'rockartofsouther0000lewi',
    title: 'The Rock Art of Southern Africa',
    author: 'David Lewis-Williams',
    year: 1983,
    original_language: 'English',
    language: 'English',
    categories: ['Visual Art', 'Archaeology'],
    notes: 'San/Bushman rock art — therianthropes, trance states, spirit beings. Heavily illustrated.',
  },
];

// ========================================
// Import functions
// ========================================

async function importIA(book, index, total) {
  console.log(`\n[${index + 1}/${total}] IA: ${book.title} (${book.year || 'undated'})`);
  console.log(`  identifier: ${book.ia_identifier}`);

  if (DRY_RUN) {
    console.log('  [DRY RUN] skipped');
    return { success: true, title: book.title, dry: true };
  }

  try {
    const res = await fetch(`${API_BASE}/api/import/ia`, {
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

async function importIIIF(item, index, total) {
  console.log(`\n[${index + 1}/${total}] IIIF: ${item.title}`);

  if (DRY_RUN) {
    console.log('  [DRY RUN] skipped');
    return { success: true, title: item.title, dry: true };
  }

  // Gallica items use the gallica route
  if (item.route === 'gallica') {
    console.log(`  ark: ${item.ark}`);
    try {
      const res = await fetch(`${API_BASE}/api/import/gallica`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${CRON_SECRET}`,
        },
        body: JSON.stringify({
          ark: item.ark,
          title: item.title,
          author: item.author,
          published: item.published,
          language: item.language,
          categories: item.categories,
          contributing_library: item.contributing_library,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        console.log(`  OK — ${data.slug || data.id || 'imported'}`);
        return { success: true, title: item.title };
      } else {
        console.log(`  FAIL — ${data.error || data.message || JSON.stringify(data)}`);
        return { success: false, title: item.title, error: data.error || data.message };
      }
    } catch (err) {
      console.log(`  ERROR — ${err.message}`);
      return { success: false, title: item.title, error: err.message };
    }
  }

  // Standard IIIF manifest import
  console.log(`  manifest: ${item.manifest_url}`);
  try {
    const res = await fetch(`${API_BASE}/api/import/iiif`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CRON_SECRET}`,
      },
      body: JSON.stringify({
        manifest_url: item.manifest_url,
        title: item.title,
        display_title: item.display_title,
        author: item.author,
        published: item.published,
        language: item.language,
        categories: item.categories,
        contributing_library: item.contributing_library,
      }),
    });
    const data = await res.json();
    if (res.ok) {
      console.log(`  OK — ${data.slug || data.id || 'imported'}`);
      return { success: true, title: item.title };
    } else {
      console.log(`  FAIL — ${data.error || data.message || JSON.stringify(data)}`);
      return { success: false, title: item.title, error: data.error || data.message };
    }
  } catch (err) {
    console.log(`  ERROR — ${err.message}`);
    return { success: false, title: item.title, error: err.message };
  }
}

async function runPhase(name, items, importFn) {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`  ${name} (${items.length} items)`);
  console.log(`${'='.repeat(50)}`);

  const results = [];
  for (let i = 0; i < items.length; i++) {
    results.push(await importFn(items[i], i, items.length));
    if (i < items.length - 1) await new Promise(r => setTimeout(r, 2000));
  }
  return results;
}

async function main() {
  console.log('=== Visual Art Import: Sex, Drugs & Aliens ===');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  if (PHASE_FILTER) console.log(`Phase filter: ${PHASE_FILTER}`);
  console.log('');

  const allResults = [];

  if (!PHASE_FILTER || PHASE_FILTER === 1) {
    allResults.push(...await runPhase('Phase 1a: Mesoamerican Codices (IA)', mesoamerican_ia, importIA));
    allResults.push(...await runPhase('Phase 1b: Mesoamerican Codices (IIIF)', mesoamerican_iiif, importIIIF));
  }

  if (!PHASE_FILTER || PHASE_FILTER === 2) {
    allResults.push(...await runPhase('Phase 2: Egyptian Erotica & Fertility', egyptian_ia, importIA));
  }

  if (!PHASE_FILTER || PHASE_FILTER === 3) {
    allResults.push(...await runPhase('Phase 3: Sacred Sexuality & Phallic Worship', sex_ia, importIA));
  }

  if (!PHASE_FILTER || PHASE_FILTER === 4) {
    allResults.push(...await runPhase('Phase 4: Entheogen Documentation', entheogen_ia, importIA));
  }

  if (!PHASE_FILTER || PHASE_FILTER === 5) {
    allResults.push(...await runPhase('Phase 5: Ancient Anomalous Art & Rock Art', anomalous_ia, importIA));
  }

  // Summary
  const ok = allResults.filter(r => r.success).length;
  const fail = allResults.filter(r => !r.success);
  console.log(`\n${'='.repeat(50)}`);
  console.log(`  ${ok}/${allResults.length} imported successfully`);
  if (fail.length) {
    console.log('  Failures:');
    fail.forEach(f => console.log(`    - ${f.title}: ${f.error}`));
  }
  console.log(`${'='.repeat(50)}`);
}

main().catch(console.error);
