/**
 * Translation Census v2: Proper name normalization
 *
 * Matches USTC Latin editions against known English translation catalogs
 * with comprehensive Latin-to-English author name mapping.
 *
 * Approach:
 * 1. Build translation catalog lookup with multiple name keys per entry
 * 2. Build USTC author name → alias mapping (Latin form → English form)
 * 3. Match at surname level first, then estimate work-level coverage
 * 4. For matched authors, compare USTC distinct works vs catalog works
 */

import { MongoClient } from 'mongodb';
import { writeFileSync } from 'fs';

const SUPABASE_URL = 'https://ykhxaecbbxaaqlujuzde.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
const headers = { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` };

// Comprehensive Latin → English author name aliases
// USTC uses Latin forms; translation catalogs use English forms
const LATIN_TO_ENGLISH = {
  // Classical
  'ovidius naso': ['ovid'],
  'ovidius': ['ovid'],
  'vergilius maro': ['virgil', 'vergil'],
  'vergilius': ['virgil', 'vergil'],
  'horatius flaccus': ['horace'],
  'horatius': ['horace'],
  'terentius afer': ['terence'],
  'terentius': ['terence'],
  'sallustius crispus': ['sallust'],
  'sallustius': ['sallust'],
  'plinius secundus': ['pliny'],
  'plinius caecilius secundus': ['pliny'],
  'plinius': ['pliny'],
  'livius': ['livy'],
  'titus livius': ['livy'],
  'suetonius tranquillus': ['suetonius'],
  'tacitus': ['tacitus'],
  'martialis': ['martial'],
  'juvenalis': ['juvenal'],
  'lucanus': ['lucan'],
  'statius': ['statius'],
  'curtius rufus': ['curtius'],
  'quintilianus': ['quintilian'],
  'gellius': ['gellius'],
  'apuleius': ['apuleius'],
  'catullus': ['catullus'],
  'propertius': ['propertius'],
  'tibullus': ['tibullus'],
  'lucretius carus': ['lucretius'],
  'lucretius': ['lucretius'],
  'persius flaccus': ['persius'],
  'persius': ['persius'],
  'petronius arbiter': ['petronius'],
  'petronius': ['petronius'],
  'valerius maximus': ['valerius'],
  'valerius flaccus': ['valerius flaccus'],
  'cornelius nepos': ['nepos'],
  'aulus gellius': ['gellius'],
  'ammianus marcellinus': ['ammianus'],
  'claudianus': ['claudian'],
  'caesar': ['caesar'],
  'julius caesar': ['caesar'],

  // Greek authors with Latin editions
  'aristoteles': ['aristotle'],
  'plato': ['plato'],
  'plutarchus': ['plutarch'],
  'aesopus': ['aesop'],
  'homerus': ['homer'],
  'euclides': ['euclid'],
  'hippocrates': ['hippocrates'],
  'galenus': ['galen'],
  'ptolemaeus': ['ptolemy'],
  'xenophon': ['xenophon'],
  'thucydides': ['thucydides'],
  'herodotus': ['herodotus'],
  'demosthenes': ['demosthenes'],
  'isocrates': ['isocrates'],
  'epictetus': ['epictetus'],
  'diogenes laertius': ['diogenes'],
  'josephus flavius': ['josephus'],
  'josephus': ['josephus'],

  // Church Fathers & Medieval
  'augustinus': ['augustine', 'augustin', 'aurelius'],
  'thomas aquinas': ['aquinas', 'thomas'],
  'thomas de aquino': ['aquinas', 'thomas'],
  'boethius': ['boethius'],
  'hieronymus': ['jerome'],
  'gregorius magnus': ['gregory'],
  'gregorius i': ['gregory'],
  'gregorius nazianzenus': ['gregory nazianzen'],
  'ambrosius': ['ambrose'],
  'chrysostomus': ['chrysostom'],
  'johannes chrysostomus': ['chrysostom'],
  'basilius magnus': ['basil'],
  'basilius': ['basil'],
  'origenes': ['origen'],
  'tertullianus': ['tertullian'],
  'cyprianus': ['cyprian'],
  'athanasius': ['athanasius'],
  'beda': ['bede'],
  'beda venerabilis': ['bede'],
  'bernardus claraevallensis': ['bernard'],
  'bernardus': ['bernard'],
  'anselmus cantuariensis': ['anselm'],
  'anselmus': ['anselm'],
  'petrus lombardus': ['lombard', 'peter lombard'],
  'duns scotus': ['scotus', 'duns'],
  'ockham': ['ockham', 'occam'],
  'guillelmus de ockham': ['ockham', 'occam'],
  'isidorus hispalensis': ['isidore'],
  'isidorus': ['isidore'],
  'lactantius': ['lactantius'],
  'cassianus': ['cassian'],
  'cassiodorus': ['cassiodorus'],
  'dionysius areopagita': ['dionysius', 'pseudo-dionysius'],

  // Renaissance
  'petrarca': ['petrarch'],
  'boccaccio': ['boccaccio'],
  'ficinus': ['ficino'],
  'marsilius ficinus': ['ficino'],
  'pico della mirandola': ['pico'],
  'machiavelli': ['machiavelli'],
  'guicciardini': ['guicciardini'],
  'valla': ['valla'],
  'laurentius valla': ['valla'],
  'poliziano': ['poliziano', 'politian'],
  'pontano': ['pontano'],
  'bembo': ['bembo'],
  'sadoleto': ['sadoleto'],
  'vida': ['vida'],
  'sannazaro': ['sannazaro'],
  'scaliger': ['scaliger'],
  'castiglione': ['castiglione'],
  'budaeus': ['bude'],

  // Reformation
  'lutherus': ['luther'],
  'luther': ['luther'],
  'calvinus': ['calvin'],
  'calvin': ['calvin'],
  'melanchthon': ['melanchthon'],
  'zwingli': ['zwingli'],
  'beza': ['beza'],

  // Early Modern
  'justinianus i': ['justinian'],
  'justinianus': ['justinian'],
  'erasmus': ['erasmus'],
  'erasmus roterodamus': ['erasmus'],
  'morus': ['more', 'thomas more'],
  'thomas morus': ['more', 'thomas more'],
  'lipsius': ['lipsius'],
  'justus lipsius': ['lipsius'],
  'grotius': ['grotius'],
  'hugo grotius': ['grotius'],
  'pufendorf': ['pufendorf'],
  'samuel pufendorf': ['pufendorf'],
  'spinoza': ['spinoza'],
  'benedictus de spinoza': ['spinoza'],
  'descartes': ['descartes'],
  'renatus descartes': ['descartes'],
  'leibniz': ['leibniz'],
  'leibnitius': ['leibniz'],
  'newton': ['newton'],
  'isaacus newton': ['newton'],
  'bacon': ['bacon'],
  'franciscus bacon': ['bacon'],
  'hobbes': ['hobbes'],
  'thomas hobbes': ['hobbes'],
  'locke': ['locke'],
  'comenius': ['comenius'],

  // Sciences
  'copernicus': ['copernicus'],
  'nicolaus copernicus': ['copernicus'],
  'kepler': ['kepler'],
  'kepplerus': ['kepler'],
  'vesalius': ['vesalius'],
  'andreas vesalius': ['vesalius'],
  'paracelsus': ['paracelsus'],
  'harvey': ['harvey'],
  'guilielmus harvey': ['harvey'],
  'kircher': ['kircher'],
  'athanasius kircher': ['kircher'],

  // Hermetica & Esoterica
  'hermes trismegistus': ['hermes'],
  'agrippa': ['agrippa'],
  'agrippa von nettesheim': ['agrippa', 'nettesheim'],
  'iamblichus': ['iamblichus'],
  'proclus': ['proclus'],
  'plotinus': ['plotinus'],
  'porphyrius': ['porphyry'],
  'synesius': ['synesius'],
};

// Build reverse lookup: english form → [latin forms]
function buildAliasLookup() {
  // surname in USTC → set of catalog surnames to check
  const ustcToCatalog = new Map();

  for (const [latin, englishForms] of Object.entries(LATIN_TO_ENGLISH)) {
    const latinSurname = latin.split(' ')[0].toLowerCase().trim();
    if (!ustcToCatalog.has(latinSurname)) ustcToCatalog.set(latinSurname, new Set());
    for (const eng of englishForms) {
      ustcToCatalog.get(latinSurname).add(eng.toLowerCase().trim());
    }
    // Also add the full Latin form
    const fullLatin = latin.toLowerCase().trim();
    if (!ustcToCatalog.has(fullLatin)) ustcToCatalog.set(fullLatin, new Set());
    for (const eng of englishForms) {
      ustcToCatalog.get(fullLatin).add(eng.toLowerCase().trim());
    }
  }

  return ustcToCatalog;
}

async function buildCatalogLookup() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  const catalogs = await db.collection('translation_catalogs').find({}, {
    projection: {
      canonical_author_normalized: 1,
      canonical_work_normalized: 1,
      author_surname: 1,
      english_title_normalized: 1,
      source: 1,
    }
  }).toArray();

  // Build multiple indexes: by surname, by full author name
  const bySurname = new Map();
  const byFullName = new Map();

  for (const c of catalogs) {
    const surname = (c.author_surname || '').toLowerCase().trim();
    const fullName = (c.canonical_author_normalized || '').toLowerCase().trim();

    if (surname && surname.length >= 2) {
      if (!bySurname.has(surname)) bySurname.set(surname, []);
      bySurname.get(surname).push({
        author: fullName,
        work: (c.canonical_work_normalized || '').toLowerCase().trim(),
        source: c.source,
      });
    }

    if (fullName && fullName.length >= 2) {
      if (!byFullName.has(fullName)) byFullName.set(fullName, []);
      byFullName.get(fullName).push({
        work: (c.canonical_work_normalized || '').toLowerCase().trim(),
        source: c.source,
      });
    }
  }

  await client.close();
  return { bySurname, byFullName, totalRecords: catalogs.length };
}

async function getUstcLatinAuthors() {
  console.log('Fetching USTC Latin editions (paginated by year)...');

  const authorEditionCount = new Map();
  const authorTitles = new Map();
  let totalEditionsScanned = 0;

  for (let y = 1450; y <= 1700; y += 5) {
    let offset = 0;
    const limit = 1000;

    while (true) {
      const url = new URL(`${SUPABASE_URL}/rest/v1/ustc_editions`);
      url.searchParams.set('select', 'author_1,title');
      url.searchParams.set('language_1', 'eq.Latin');
      url.searchParams.set('year', `gte.${y}`);
      url.searchParams.set('and', `(year.lte.${y + 4})`);
      url.searchParams.set('limit', String(limit));
      url.searchParams.set('offset', String(offset));
      url.searchParams.set('order', 'id');

      const res = await fetch(url.toString(), { headers });
      if (!res.ok) break;

      const data = await res.json();
      if (data.length === 0) break;

      for (const row of data) {
        const author = (row.author_1 || '').trim();
        if (!author) continue;

        // Extract surname (before first comma) and full name
        const parts = author.split(',');
        const surname = parts[0].toLowerCase().trim();
        if (!surname || surname.length < 2) continue;

        // Also store full author in "surname given" form, lowercased
        const fullName = author.toLowerCase().replace(/,\s*/g, ' ').trim();

        // Use surname as primary key for counting
        authorEditionCount.set(surname, (authorEditionCount.get(surname) || 0) + 1);
        if (!authorTitles.has(surname)) authorTitles.set(surname, new Set());

        const title = (row.title || '').toLowerCase().trim();
        if (title) authorTitles.get(surname).add(title);
      }

      totalEditionsScanned += data.length;
      offset += limit;
      if (data.length < limit) break;
    }

    if ((y - 1450) % 50 === 0) {
      process.stdout.write(`  ${y}: ${totalEditionsScanned.toLocaleString()} editions, ${authorEditionCount.size.toLocaleString()} authors\r`);
    }
  }

  console.log(`\nTotal: ${totalEditionsScanned.toLocaleString()} editions, ${authorEditionCount.size.toLocaleString()} distinct author surnames`);
  return { authorEditionCount, authorTitles, totalEditionsScanned };
}

function matchAuthors(catalog, ustcAuthors, ustcTitles, aliasLookup) {
  const matched = [];
  const unmatched = [];
  let editionsMatched = 0;
  let editionsUnmatched = 0;

  for (const [surname, editionCount] of ustcAuthors.entries()) {
    const workCount = ustcTitles.get(surname)?.size || 0;

    // Try direct match first
    let catalogEntries = catalog.bySurname.get(surname);

    // If no direct match, try aliases
    if (!catalogEntries) {
      const aliases = aliasLookup.get(surname);
      if (aliases) {
        catalogEntries = [];
        for (const alias of aliases) {
          const found = catalog.bySurname.get(alias);
          if (found) catalogEntries.push(...found);
          // Also check by full name
          const foundFull = catalog.byFullName.get(alias);
          if (foundFull) catalogEntries.push(...foundFull.map(f => ({ ...f, author: alias })));
        }
        if (catalogEntries.length === 0) catalogEntries = null;
      }
    }

    if (catalogEntries && catalogEntries.length > 0) {
      const catalogWorks = new Set(catalogEntries.map(e => e.work).filter(w => w));
      const catalogSources = new Set(catalogEntries.map(e => e.source).filter(s => s));

      matched.push({
        surname,
        ustcEditions: editionCount,
        ustcDistinctWorks: workCount,
        catalogTranslations: catalogEntries.length,
        catalogDistinctWorks: catalogWorks.size,
        sources: [...catalogSources],
        sampleUstcTitles: ustcTitles.get(surname) ? [...ustcTitles.get(surname)].slice(0, 3) : [],
        sampleCatalogWorks: [...catalogWorks].slice(0, 5),
      });
      editionsMatched += editionCount;
    } else {
      unmatched.push({
        surname,
        editions: editionCount,
        works: workCount,
        sampleTitles: ustcTitles.get(surname) ? [...ustcTitles.get(surname)].slice(0, 3) : [],
      });
      editionsUnmatched += editionCount;
    }
  }

  matched.sort((a, b) => b.ustcEditions - a.ustcEditions);
  unmatched.sort((a, b) => b.editions - a.editions);

  return { matched, unmatched, editionsMatched, editionsUnmatched };
}

async function main() {
  console.log('=== Translation Census v2 ===\n');

  const aliasLookup = buildAliasLookup();
  console.log(`Alias mappings: ${aliasLookup.size} USTC name forms\n`);

  console.log('Loading translation catalogs...');
  const catalog = await buildCatalogLookup();
  console.log(`  ${catalog.totalRecords.toLocaleString()} records, ${catalog.bySurname.size} surnames, ${catalog.byFullName.size} full names\n`);

  const { authorEditionCount, authorTitles, totalEditionsScanned } = await getUstcLatinAuthors();
  console.log();

  console.log('Matching...');
  const { matched, unmatched, editionsMatched, editionsUnmatched } = matchAuthors(catalog, authorEditionCount, authorTitles, aliasLookup);

  // Calculate work-level stats
  let totalWorksMatched = 0;
  let totalWorksUnmatched = 0;
  let estimatedTranslatedWorks = 0;

  for (const a of matched) {
    totalWorksMatched += a.ustcDistinctWorks;
    estimatedTranslatedWorks += Math.min(a.catalogDistinctWorks, a.ustcDistinctWorks);
  }
  for (const a of unmatched) {
    totalWorksUnmatched += a.works;
  }
  const totalDistinctWorks = totalWorksMatched + totalWorksUnmatched;

  // Report
  console.log('\n' + '='.repeat(70));
  console.log('  TRANSLATION CENSUS: LATIN EDITIONS (1450-1700)');
  console.log('='.repeat(70));

  console.log('\n--- Corpus ---');
  console.log(`Latin editions scanned:         ${totalEditionsScanned.toLocaleString()}`);
  console.log(`Distinct author surnames:        ${authorEditionCount.size.toLocaleString()}`);
  console.log(`Distinct works (by title):       ${totalDistinctWorks.toLocaleString()}`);

  console.log('\n--- Translation Catalog ---');
  console.log(`Known English translations:      ${catalog.totalRecords.toLocaleString()}`);
  console.log(`Distinct author surnames:        ${catalog.bySurname.size.toLocaleString()}`);

  console.log('\n--- Author-Level Matching ---');
  console.log(`Authors with known translation:  ${matched.length.toLocaleString()} (${(matched.length / authorEditionCount.size * 100).toFixed(1)}%)`);
  console.log(`Authors with NO translation:     ${unmatched.length.toLocaleString()} (${(unmatched.length / authorEditionCount.size * 100).toFixed(1)}%)`);

  console.log('\n--- Edition-Level ---');
  console.log(`Editions by translated authors:  ${editionsMatched.toLocaleString()} (${(editionsMatched / totalEditionsScanned * 100).toFixed(1)}%)`);
  console.log(`Editions by untranslated authors:${editionsUnmatched.toLocaleString()} (${(editionsUnmatched / totalEditionsScanned * 100).toFixed(1)}%)`);

  console.log('\n--- Work-Level Estimate ---');
  console.log(`Total distinct works:            ${totalDistinctWorks.toLocaleString()}`);
  console.log(`Works with likely translation:   ${estimatedTranslatedWorks.toLocaleString()}`);
  console.log(`Works with no known translation: ${(totalDistinctWorks - estimatedTranslatedWorks).toLocaleString()}`);
  console.log(`% translated (upper bound):      ${(estimatedTranslatedWorks / totalDistinctWorks * 100).toFixed(2)}%`);
  console.log(`% untranslated (lower bound):    ${((totalDistinctWorks - estimatedTranslatedWorks) / totalDistinctWorks * 100).toFixed(2)}%`);

  console.log('\n--- Caveats ---');
  console.log('1. "Distinct works" = distinct titles per author. Variants of the');
  console.log('   same work with slightly different titles count separately.');
  console.log('2. "Works with likely translation" is an UPPER BOUND: it assumes');
  console.log('   every catalog entry corresponds to a USTC work. True overlap');
  console.log('   is lower because catalog titles often don\'t match USTC titles.');
  console.log('3. The translation catalog (13,862 records) is not exhaustive.');
  console.log('   Some translations exist in dissertations, journal articles,');
  console.log('   or out-of-print 19th-century editions not in any database.');
  console.log('4. USTC coverage is strongest for 1450-1600; 1600-1700 data is');
  console.log('   still being added and may be incomplete.');

  // Top 30 matched
  console.log('\n--- Top 30 Authors with Known Translations ---');
  console.log('-'.repeat(95));
  console.log('Author'.padEnd(28) + 'USTC ed.'.padEnd(10) + 'USTC works'.padEnd(12) + 'Translations'.padEnd(14) + 'Cat. works'.padEnd(12) + 'Coverage');
  console.log('-'.repeat(95));
  for (const a of matched.slice(0, 30)) {
    const coverage = a.ustcDistinctWorks > 0
      ? (Math.min(a.catalogDistinctWorks, a.ustcDistinctWorks) / a.ustcDistinctWorks * 100).toFixed(0) + '%'
      : '?';
    console.log(
      a.surname.padEnd(28) +
      String(a.ustcEditions).padEnd(10) +
      String(a.ustcDistinctWorks).padEnd(12) +
      String(a.catalogTranslations).padEnd(14) +
      String(a.catalogDistinctWorks).padEnd(12) +
      coverage
    );
  }

  // Top 30 unmatched
  console.log('\n--- Top 30 Authors with NO Known Translation ---');
  console.log('-'.repeat(70));
  console.log('Author'.padEnd(30) + 'Editions'.padEnd(12) + 'Distinct works'.padEnd(16) + 'Sample title');
  console.log('-'.repeat(70));
  for (const a of unmatched.slice(0, 30)) {
    const sample = (a.sampleTitles[0] || '').substring(0, 40);
    console.log(
      a.surname.padEnd(30) +
      String(a.editions).padEnd(12) +
      String(a.works).padEnd(16) +
      sample
    );
  }

  // Save results
  const output = {
    timestamp: new Date().toISOString(),
    methodology: {
      description: 'Match USTC Latin editions (1450-1700) against known English translation catalogs',
      ustcSource: 'Supabase ustc_editions table, language_1=Latin',
      catalogSources: 'MongoDB translation_catalogs: UNESCO Index Translationum, Open Library, HathiTrust, Loeb, Penguin, Brill, Cambridge, etc.',
      nameNormalization: 'Surname extraction from USTC "Surname, Given" format + 120+ Latin-to-English author name aliases',
      caveats: [
        'Distinct works counted by unique title per author — title variants inflate the count',
        'Translation coverage is an upper bound — catalog works may not correspond 1:1 to USTC works',
        'Translation catalog is not exhaustive — misses dissertations, journal articles, out-of-print editions',
        'USTC 1600-1700 data may be incomplete',
      ],
    },
    corpus: {
      totalLatinEditions: totalEditionsScanned,
      distinctAuthors: authorEditionCount.size,
      distinctWorks: totalDistinctWorks,
      yearRange: '1450-1700',
    },
    catalog: {
      totalRecords: catalog.totalRecords,
      distinctSurnames: catalog.bySurname.size,
      distinctFullNames: catalog.byFullName.size,
    },
    results: {
      authorsWithTranslation: matched.length,
      authorsWithoutTranslation: unmatched.length,
      pctAuthorsTranslated: parseFloat((matched.length / authorEditionCount.size * 100).toFixed(2)),
      editionsByTranslatedAuthors: editionsMatched,
      editionsByUntranslatedAuthors: editionsUnmatched,
      pctEditionsTranslatedAuthor: parseFloat((editionsMatched / totalEditionsScanned * 100).toFixed(2)),
      estimatedWorksTranslated: estimatedTranslatedWorks,
      estimatedWorksUntranslated: totalDistinctWorks - estimatedTranslatedWorks,
      pctWorksTranslated: parseFloat((estimatedTranslatedWorks / totalDistinctWorks * 100).toFixed(2)),
      pctWorksUntranslated: parseFloat(((totalDistinctWorks - estimatedTranslatedWorks) / totalDistinctWorks * 100).toFixed(2)),
    },
    sourceLibraryContribution: {
      note: 'Source Library books matched separately — not included in catalog counts above',
      latinBooks: 3112,
      // TODO: cross-reference SL translations against USTC
    },
    topTranslatedAuthors: matched.slice(0, 100).map(a => ({
      ...a,
      coveragePct: a.ustcDistinctWorks > 0
        ? parseFloat((Math.min(a.catalogDistinctWorks, a.ustcDistinctWorks) / a.ustcDistinctWorks * 100).toFixed(1))
        : null,
    })),
    topUntranslatedAuthors: unmatched.slice(0, 100),
  };

  writeFileSync('scripts/analysis/census-v2-results.json', JSON.stringify(output, null, 2));
  console.log('\nResults saved to scripts/analysis/census-v2-results.json');
}

main().catch(console.error);
