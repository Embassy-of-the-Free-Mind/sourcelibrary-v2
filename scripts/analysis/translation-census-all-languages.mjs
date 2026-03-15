/**
 * Translation Census: All Languages
 *
 * Runs the USTC-vs-catalog match for every major non-English language.
 * Reuses the alias logic from v2 for Latin, and does direct surname
 * matching for other languages.
 */

import { MongoClient } from 'mongodb';
import { writeFileSync } from 'fs';

const SUPABASE_URL = 'https://ykhxaecbbxaaqlujuzde.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlraHhhZWNiYnhhYXFsdWp1emRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUwNjExMDEsImV4cCI6MjA4MDYzNzEwMX0.O2chfnHGQWLOaVSFQ-F6UJMlya9EzPbsUh848SEOPj4';
const headers = { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` };

// Latin aliases from v2 (abbreviated — full set in census-v2)
const LATIN_ALIASES = {
  'ovidius naso': ['ovid'], 'ovidius': ['ovid'],
  'vergilius maro': ['virgil', 'vergil'], 'vergilius': ['virgil'],
  'horatius flaccus': ['horace'], 'horatius': ['horace'],
  'terentius afer': ['terence'], 'terentius': ['terence'],
  'sallustius crispus': ['sallust'], 'sallustius': ['sallust'],
  'plinius secundus': ['pliny'], 'plinius caecilius secundus': ['pliny'], 'plinius': ['pliny'],
  'livius': ['livy'], 'titus livius': ['livy'],
  'suetonius tranquillus': ['suetonius'],
  'martialis': ['martial'], 'juvenalis': ['juvenal'],
  'lucanus': ['lucan'], 'statius': ['statius'],
  'curtius rufus': ['curtius'], 'quintilianus': ['quintilian'],
  'gellius': ['gellius'], 'apuleius': ['apuleius'],
  'catullus': ['catullus'], 'propertius': ['propertius'],
  'tibullus': ['tibullus'], 'lucretius carus': ['lucretius'], 'lucretius': ['lucretius'],
  'persius flaccus': ['persius'], 'persius': ['persius'],
  'petronius arbiter': ['petronius'], 'petronius': ['petronius'],
  'claudianus': ['claudian'], 'caesar': ['caesar'],
  'aristoteles': ['aristotle'], 'plutarchus': ['plutarch'],
  'aesopus': ['aesop'], 'homerus': ['homer'],
  'euclides': ['euclid'], 'hippocrates': ['hippocrates'],
  'galenus': ['galen'], 'ptolemaeus': ['ptolemy'],
  'josephus flavius': ['josephus'], 'josephus': ['josephus'],
  'augustinus': ['augustine', 'augustin', 'aurelius'],
  'thomas aquinas': ['aquinas', 'thomas'], 'thomas de aquino': ['aquinas'],
  'boethius': ['boethius'], 'hieronymus': ['jerome'],
  'gregorius magnus': ['gregory'], 'gregorius i': ['gregory'],
  'ambrosius': ['ambrose'], 'chrysostomus': ['chrysostom'],
  'johannes chrysostomus': ['chrysostom'],
  'basilius magnus': ['basil'], 'basilius': ['basil'],
  'origenes': ['origen'], 'tertullianus': ['tertullian'],
  'cyprianus': ['cyprian'], 'beda': ['bede'], 'beda venerabilis': ['bede'],
  'bernardus claraevallensis': ['bernard'], 'bernardus': ['bernard'],
  'anselmus cantuariensis': ['anselm'], 'anselmus': ['anselm'],
  'petrus lombardus': ['lombard', 'peter lombard'],
  'duns scotus': ['scotus', 'duns'],
  'isidorus hispalensis': ['isidore'], 'isidorus': ['isidore'],
  'lactantius': ['lactantius'], 'dionysius areopagita': ['dionysius'],
  'petrarca': ['petrarch'], 'ficinus': ['ficino'], 'marsilius ficinus': ['ficino'],
  'pico della mirandola': ['pico'],
  'machiavelli': ['machiavelli'], 'valla': ['valla'], 'laurentius valla': ['valla'],
  'lutherus': ['luther'], 'calvinus': ['calvin'],
  'justinianus i': ['justinian'], 'justinianus': ['justinian'],
  'erasmus roterodamus': ['erasmus'],
  'morus': ['more', 'thomas more'], 'thomas morus': ['more'],
  'grotius': ['grotius'], 'hugo grotius': ['grotius'],
  'spinoza': ['spinoza'], 'benedictus de spinoza': ['spinoza'],
  'descartes': ['descartes'], 'renatus descartes': ['descartes'],
  'leibnitius': ['leibniz'], 'copernicus': ['copernicus'],
  'vesalius': ['vesalius'], 'kircher': ['kircher'],
};

function buildAliasLookup(aliases) {
  const map = new Map();
  for (const [latin, englishForms] of Object.entries(aliases)) {
    for (const key of [latin, latin.split(' ')[0]]) {
      const k = key.toLowerCase().trim();
      if (!map.has(k)) map.set(k, new Set());
      for (const eng of englishForms) map.get(k).add(eng.toLowerCase().trim());
    }
  }
  return map;
}

async function buildCatalogLookup() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const catalogs = await db.collection('translation_catalogs').find({}, {
    projection: { canonical_author_normalized: 1, canonical_work_normalized: 1, author_surname: 1, source: 1 }
  }).toArray();

  const bySurname = new Map();
  for (const c of catalogs) {
    const surname = (c.author_surname || '').toLowerCase().trim();
    if (!surname || surname.length < 2) continue;
    if (!bySurname.has(surname)) bySurname.set(surname, []);
    bySurname.get(surname).push({
      author: (c.canonical_author_normalized || '').toLowerCase().trim(),
      work: (c.canonical_work_normalized || '').toLowerCase().trim(),
    });
  }

  await client.close();
  return { bySurname, totalRecords: catalogs.length };
}

async function scanLanguage(language) {
  const authorEditions = new Map();
  const authorTitles = new Map();
  let total = 0;

  for (let y = 1450; y <= 1700; y += 5) {
    let offset = 0;
    while (true) {
      const url = new URL(`${SUPABASE_URL}/rest/v1/ustc_editions`);
      url.searchParams.set('select', 'author_1,title');
      url.searchParams.set('language_1', `eq.${language}`);
      url.searchParams.set('year', `gte.${y}`);
      url.searchParams.set('and', `(year.lte.${y + 4})`);
      url.searchParams.set('limit', '1000');
      url.searchParams.set('offset', String(offset));
      url.searchParams.set('order', 'id');

      const res = await fetch(url.toString(), { headers });
      if (!res.ok) break;
      const data = await res.json();
      if (data.length === 0) break;

      for (const row of data) {
        const author = (row.author_1 || '').trim();
        if (!author) continue;
        const surname = author.split(',')[0].toLowerCase().trim();
        if (!surname || surname.length < 2) continue;

        authorEditions.set(surname, (authorEditions.get(surname) || 0) + 1);
        if (!authorTitles.has(surname)) authorTitles.set(surname, new Set());
        const title = (row.title || '').toLowerCase().trim();
        if (title) authorTitles.get(surname).add(title);
      }

      total += data.length;
      offset += 1000;
      if (data.length < 1000) break;
    }
  }

  return { authorEditions, authorTitles, total };
}

function match(catalogBySurname, authorEditions, authorTitles, aliasLookup) {
  let authorsMatched = 0, authorsUnmatched = 0;
  let editionsMatched = 0, editionsUnmatched = 0;
  let worksMatched = 0, worksUnmatched = 0;
  let estimatedTranslated = 0;
  const topUnmatched = [];

  for (const [surname, editions] of authorEditions.entries()) {
    const works = authorTitles.get(surname)?.size || 0;

    // Direct match
    let found = catalogBySurname.get(surname);

    // Alias match (primarily for Latin)
    if (!found && aliasLookup) {
      const aliases = aliasLookup.get(surname);
      if (aliases) {
        found = [];
        for (const alias of aliases) {
          const f = catalogBySurname.get(alias);
          if (f) found.push(...f);
        }
        if (found.length === 0) found = null;
      }
    }

    if (found && found.length > 0) {
      authorsMatched++;
      editionsMatched += editions;
      worksMatched += works;
      const catalogWorks = new Set(found.map(e => e.work).filter(w => w));
      estimatedTranslated += Math.min(catalogWorks.size, works);
    } else {
      authorsUnmatched++;
      editionsUnmatched += editions;
      worksUnmatched += works;
      topUnmatched.push({ surname, editions, works });
    }
  }

  topUnmatched.sort((a, b) => b.editions - a.editions);
  const totalWorks = worksMatched + worksUnmatched;

  return {
    totalAuthors: authorEditions.size,
    authorsMatched,
    authorsUnmatched,
    editionsMatched,
    editionsUnmatched,
    totalWorks,
    estimatedTranslated,
    pctAuthorsTranslated: authorEditions.size > 0 ? (authorsMatched / authorEditions.size * 100) : 0,
    pctWorksTranslated: totalWorks > 0 ? (estimatedTranslated / totalWorks * 100) : 0,
    topUnmatched: topUnmatched.slice(0, 10),
  };
}

async function main() {
  console.log('=== Translation Census: All Languages ===\n');

  const catalog = await buildCatalogLookup();
  console.log(`Translation catalog: ${catalog.totalRecords.toLocaleString()} records, ${catalog.bySurname.size} author surnames\n`);

  const latinAliases = buildAliasLookup(LATIN_ALIASES);

  const languages = [
    { name: 'Latin', aliases: latinAliases },
    { name: 'German', aliases: null },
    { name: 'French', aliases: null },
    { name: 'Italian', aliases: null },
    { name: 'Dutch', aliases: null },
    { name: 'Spanish', aliases: null },
    { name: 'Portuguese', aliases: null },
  ];

  const results = [];
  let grandTotalEditions = 0;
  let grandTotalWorks = 0;
  let grandTotalTranslated = 0;

  for (const lang of languages) {
    process.stdout.write(`Scanning ${lang.name}...`);
    const { authorEditions, authorTitles, total } = await scanLanguage(lang.name);
    process.stdout.write(` ${total.toLocaleString()} editions, ${authorEditions.size.toLocaleString()} authors\n`);

    const m = match(catalog.bySurname, authorEditions, authorTitles, lang.aliases);

    results.push({
      language: lang.name,
      editions: total,
      ...m,
    });

    grandTotalEditions += total;
    grandTotalWorks += m.totalWorks;
    grandTotalTranslated += m.estimatedTranslated;
  }

  // Report
  console.log('\n' + '='.repeat(80));
  console.log('  TRANSLATION CENSUS: ALL LANGUAGES (USTC 1450-1700)');
  console.log('='.repeat(80));

  console.log('\n' + 'Language'.padEnd(14) + 'Editions'.padEnd(12) + 'Works'.padEnd(10) +
    'Authors'.padEnd(10) + 'Translated'.padEnd(12) + 'Authors w/'.padEnd(12) +
    '% works'.padEnd(10) + '% authors');
  console.log(' '.repeat(14) + ' '.repeat(12) + ' '.repeat(10) +
    ' '.repeat(10) + 'works'.padEnd(12) + 'translation'.padEnd(12) +
    'translated'.padEnd(10) + 'translated');
  console.log('-'.repeat(90));

  for (const r of results) {
    console.log(
      r.language.padEnd(14) +
      r.editions.toLocaleString().padEnd(12) +
      r.totalWorks.toLocaleString().padEnd(10) +
      r.totalAuthors.toLocaleString().padEnd(10) +
      r.estimatedTranslated.toLocaleString().padEnd(12) +
      r.authorsMatched.toLocaleString().padEnd(12) +
      r.pctWorksTranslated.toFixed(2).padEnd(10) +
      r.pctAuthorsTranslated.toFixed(1)
    );
  }

  console.log('-'.repeat(90));
  const grandPctWorks = grandTotalWorks > 0 ? (grandTotalTranslated / grandTotalWorks * 100) : 0;
  console.log(
    'TOTAL'.padEnd(14) +
    grandTotalEditions.toLocaleString().padEnd(12) +
    grandTotalWorks.toLocaleString().padEnd(10) +
    ''.padEnd(10) +
    grandTotalTranslated.toLocaleString().padEnd(12) +
    ''.padEnd(12) +
    grandPctWorks.toFixed(2)
  );

  console.log('\n--- Top Untranslated Authors by Language ---');
  for (const r of results) {
    if (r.topUnmatched.length === 0) continue;
    console.log(`\n${r.language}:`);
    for (const a of r.topUnmatched.slice(0, 5)) {
      console.log(`  ${a.surname.padEnd(30)} ${String(a.editions).padEnd(8)} editions, ${a.works} works`);
    }
  }

  // Save
  const output = {
    timestamp: new Date().toISOString(),
    grandTotal: {
      editions: grandTotalEditions,
      works: grandTotalWorks,
      estimatedTranslated: grandTotalTranslated,
      pctTranslated: parseFloat(grandPctWorks.toFixed(2)),
    },
    byLanguage: results.map(r => ({
      language: r.language,
      editions: r.editions,
      distinctWorks: r.totalWorks,
      distinctAuthors: r.totalAuthors,
      authorsWithTranslation: r.authorsMatched,
      estimatedWorksTranslated: r.estimatedTranslated,
      pctWorksTranslated: parseFloat(r.pctWorksTranslated.toFixed(2)),
      pctAuthorsTranslated: parseFloat(r.pctAuthorsTranslated.toFixed(1)),
      topUntranslatedAuthors: r.topUnmatched,
    })),
  };

  writeFileSync('scripts/analysis/census-all-languages.json', JSON.stringify(output, null, 2));
  console.log('\nSaved to scripts/analysis/census-all-languages.json');
}

main().catch(console.error);
