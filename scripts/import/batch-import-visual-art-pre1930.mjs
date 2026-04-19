#!/usr/bin/env node
/**
 * Batch import: Pre-1930 visual art — sex, drugs, aliens (broadly interpreted)
 * All items are public domain (pre-1930 publication)
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/import/batch-import-visual-art-pre1930.mjs
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
// Phase 1: Sacred Sexuality & Phallic Worship (pre-1930)
// ========================================
const sex_ia = [
  {
    ia_identifier: 'discourseonworsh00knig',
    title: 'A Discourse on the Worship of Priapus',
    author: 'Richard Payne Knight',
    year: 1865,
    original_language: 'English',
    language: 'English',
    categories: ['Visual Art', 'Anthropology', 'Religion'],
    notes: 'Classic study of Priapic worship and its connection to mystic theology. Illustrated plates of phallic art.',
  },
  {
    ia_identifier: '4725496worshipofpriapus',
    title: 'Two Essays on the Worship of Priapus',
    author: 'Richard Payne Knight & Thomas Wright',
    year: 1894,
    original_language: 'English',
    language: 'English',
    categories: ['Visual Art', 'Anthropology', 'Religion'],
    notes: 'Knight on Priapus worship + Wright on generative powers in the Middle Ages. Illustrated.',
  },
  {
    ia_identifier: 'phallicobjectsmo0000unse',
    title: 'Phallic Objects, Monuments and Remains',
    author: 'Anonymous',
    year: 1889,
    original_language: 'English',
    language: 'English',
    categories: ['Visual Art', 'Anthropology', 'Religion'],
    notes: 'Illustrated survey of phallic art across cultures — rise and development of the phallic idea in nature and art.',
  },
  {
    ia_identifier: 'natureworshipacc00jenn',
    title: 'Nature Worship: An Account of Phallic Faiths and Practices',
    author: 'Anonymous (attr. Hargrave Jennings)',
    year: 1891,
    original_language: 'English',
    language: 'English',
    categories: ['Anthropology', 'Religion'],
    notes: 'Adoration of male and female creative powers across nations. Sacti Puja of Indian Gnosticism.',
  },
  {
    ia_identifier: 'primitivesymboli00inwest',
    title: 'Primitive Symbolism, as Illustrated in Phallic Worship',
    author: 'Hodder M. Westropp',
    year: 1885,
    original_language: 'English',
    language: 'English',
    categories: ['Anthropology', 'Religion'],
    notes: 'The reproductive principle in primitive symbolism — illustrated.',
  },
  {
    ia_identifier: 'phallicworshipou00camp',
    title: 'Phallic Worship: An Outline of the Worship of the Generative Organs',
    author: 'Anonymous',
    year: 1887,
    original_language: 'English',
    language: 'English',
    categories: ['Anthropology', 'Religion'],
    notes: 'Influence of the phallic idea on religious creeds, ceremonies, customs and symbolism.',
  },
  {
    ia_identifier: 'masculinecrossor00lond',
    title: 'The Masculine Cross: A History of Ancient and Modern Crosses and Sex Worship',
    author: 'Anonymous',
    year: 1904,
    original_language: 'English',
    language: 'English',
    categories: ['Anthropology', 'Religion'],
    notes: 'Connection between crosses and phallic faiths — illustrated.',
  },
  {
    ia_identifier: 'sexandsexworshi01wallgoog',
    title: 'Sex and Sex Worship (Phallic Worship)',
    author: 'O.A. Wall',
    year: 1920,
    original_language: 'English',
    language: 'English',
    categories: ['Anthropology', 'Religion', 'Visual Art'],
    notes: 'Scientific treatise on sex worship and its influence on art, architecture, and religion. Illustrated.',
  },
  {
    ia_identifier: 'sexworshipexposi00howa_0',
    title: 'Sex Worship: An Exposition of the Phallic Origin of Religion',
    author: 'Clifford Howard',
    year: 1899,
    original_language: 'English',
    language: 'English',
    categories: ['Anthropology', 'Religion'],
    notes: 'Phallic origins of religious practice across ancient civilizations.',
  },
  {
    ia_identifier: 'alexandrianeroti00unse',
    title: 'An Alexandrian Erotic Fragment and Other Greek Papyri',
    author: 'Bernard P. Grenfell (ed.)',
    year: 1896,
    original_language: 'Greek',
    language: 'English',
    categories: ['Classical', 'Visual Art'],
    notes: 'Ptolemaic erotic papyrus fragment — one of the earliest published Greek erotic texts.',
  },
];

// ========================================
// Phase 2: Japanese & Asian Art (pre-1930)
// ========================================
const asian_art_ia = [
  {
    ia_identifier: 'legendinjapanese00jolyuoft',
    title: 'Legend in Japanese Art',
    author: 'Henri L. Joly',
    year: 1908,
    original_language: 'English',
    language: 'English',
    categories: ['Visual Art', 'Japanese Art'],
    notes: 'Historical episodes, legendary characters, folk-lore myths, religious symbolism. Heavily illustrated.',
  },
  {
    ia_identifier: 'specimensjapane00tomk',
    title: 'Specimens of Japanese Art',
    author: 'Michael Tomkinson',
    year: 1899,
    original_language: 'English',
    language: 'English',
    categories: ['Visual Art', 'Japanese Art'],
    notes: 'Fine art plates from the Tomkinson collection — includes woodblocks and prints.',
  },
];

// ========================================
// Phase 3: Egyptian Art (pre-1930)
// ========================================
const egyptian_art_ia = [
  {
    ia_identifier: 'egyptianartstudi00masprich',
    title: 'Egyptian Art: Studies',
    author: 'Gaston Maspero',
    year: 1913,
    original_language: 'French',
    language: 'English',
    categories: ['Egyptian', 'Visual Art'],
    notes: 'Maspero\'s illustrated survey of Egyptian art — painting, sculpture, temple decoration.',
  },
  {
    ia_identifier: 'egyptianartintro00capa',
    title: 'Egyptian Art: Introductory Studies',
    author: 'Jean Capart',
    year: 1920,
    original_language: 'French',
    language: 'English',
    categories: ['Egyptian', 'Visual Art'],
    notes: 'Illustrated introduction to Egyptian art — architecture, sculpture, painting.',
  },
];

// ========================================
// Phase 4: Pre-Columbian Art & Archaeology (pre-1930)
// ========================================
const precolumbian_ia = [
  {
    ia_identifier: 'nazcapotteryofan0000uhle',
    title: 'The Nazca Pottery of Ancient Peru',
    author: 'Max Uhle',
    year: 1914,
    original_language: 'English',
    language: 'English',
    categories: ['Visual Art', 'Pre-Columbian', 'Archaeology'],
    notes: 'Early scientific documentation of Nazca pottery — supernatural beings, nature spirits, geometric designs.',
  },
];

// ========================================
// Phase 5: Entheogens & Sacred Plants (pre-1930)
// ========================================
const entheogen_ia = [
  {
    ia_identifier: 'lagnistomadescri01cala',
    title: "L'Agnistoma: Description complète du sacrifice de soma dans le culte védique",
    author: 'Willem Caland',
    year: 1906,
    original_language: 'French',
    language: 'French',
    categories: ['Religion', 'Vedic'],
    notes: 'Complete description of the Vedic Soma sacrifice ritual — the sacred entheogenic ceremony.',
  },
  {
    ia_identifier: 'kluver-mescal-the-divine-plant-and-its-psychological-effects',
    title: 'Mescal, the Divine Plant and Its Psychological Effects',
    author: 'Heinrich Klüver',
    year: 1928,
    original_language: 'English',
    language: 'English',
    categories: ['Botany', 'Psychology'],
    notes: 'Early scientific study of mescaline/peyote — hallucination phenomenology, form constants.',
  },
  {
    ia_identifier: '101751140.nlm.nih.gov',
    title: 'Anhalonium Lewinii (Mescal Buttons)',
    author: 'D.W. Prentiss & Francis P. Morgan',
    year: 1895,
    original_language: 'English',
    language: 'English',
    categories: ['Botany', 'Medicine'],
    notes: 'Earliest scientific study of peyote — physiological effects on man. Groundbreaking.',
  },
];

// ========================================
// Import function
// ========================================

async function importIA(book, index, total) {
  console.log(`\n[${index + 1}/${total}] ${book.title} (${book.year})`);
  console.log(`  IA: ${book.ia_identifier}`);

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

async function runPhase(name, items) {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`  ${name} (${items.length} items)`);
  console.log(`${'='.repeat(50)}`);

  const results = [];
  for (let i = 0; i < items.length; i++) {
    results.push(await importIA(items[i], i, items.length));
    if (i < items.length - 1) await new Promise(r => setTimeout(r, 2000));
  }
  return results;
}

async function main() {
  console.log('=== Pre-1930 Visual Art Import: Sex, Drugs & Aliens ===');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  if (PHASE_FILTER) console.log(`Phase filter: ${PHASE_FILTER}`);
  console.log('');

  const allResults = [];

  if (!PHASE_FILTER || PHASE_FILTER === 1) {
    allResults.push(...await runPhase('Phase 1: Sacred Sexuality & Phallic Worship', sex_ia));
  }
  if (!PHASE_FILTER || PHASE_FILTER === 2) {
    allResults.push(...await runPhase('Phase 2: Japanese & Asian Art', asian_art_ia));
  }
  if (!PHASE_FILTER || PHASE_FILTER === 3) {
    allResults.push(...await runPhase('Phase 3: Egyptian Art', egyptian_art_ia));
  }
  if (!PHASE_FILTER || PHASE_FILTER === 4) {
    allResults.push(...await runPhase('Phase 4: Pre-Columbian Art', precolumbian_ia));
  }
  if (!PHASE_FILTER || PHASE_FILTER === 5) {
    allResults.push(...await runPhase('Phase 5: Entheogens & Sacred Plants', entheogen_ia));
  }

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
