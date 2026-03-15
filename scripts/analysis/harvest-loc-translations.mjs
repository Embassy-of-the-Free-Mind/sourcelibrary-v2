/**
 * Harvest Library of Congress translation records via SRU gateway.
 *
 * Queries LCSH subject "Translations into English", retrieves full MARCXML,
 * filters for pre-1800 source texts translated from Latin, German, French,
 * Italian, Dutch, or Spanish.
 *
 * Output: JSON file of normalized translation records for the census.
 */

import { writeFileSync, existsSync, readFileSync } from 'fs';

const SRU_BASE = 'http://lx2.loc.gov:210/LCDB';
const BATCH_SIZE = 50; // LOC SRU max is typically 50-100
const TARGET_LANGUAGES = new Set(['lat', 'ger', 'deu', 'fre', 'fra', 'ita', 'dut', 'nld', 'spa', 'por']);
const MAX_SOURCE_YEAR = 1800;

// Parse MARCXML to extract relevant fields
function parseRecords(xml) {
  const records = [];
  // Split on record boundaries
  const recordChunks = xml.split('<record ').slice(1);

  for (const chunk of recordChunks) {
    try {
      const record = {};

      // 008 field — fixed-length data (positions 7-10 = date, 35-37 = language)
      const f008Match = chunk.match(/<controlfield tag="008">([^<]+)<\/controlfield>/);
      if (f008Match) {
        const f008 = f008Match[1];
        record.pubDate = f008.substring(7, 11).trim();
        record.language008 = f008.substring(35, 38).trim();
      }

      // 001 - control number
      const f001Match = chunk.match(/<controlfield tag="001">([^<]+)<\/controlfield>/);
      if (f001Match) record.lccn = f001Match[1].trim();

      // Helper to extract all subfields from a datafield
      const getField = (tag) => {
        const regex = new RegExp(`<datafield tag="${tag}"[^>]*>(.*?)<\\/datafield>`, 'gs');
        const matches = [...chunk.matchAll(regex)];
        return matches.map(m => {
          const subfields = {};
          const sfRegex = /<subfield code="([^"]+)">([^<]*)<\/subfield>/g;
          let sf;
          while ((sf = sfRegex.exec(m[1])) !== null) {
            if (!subfields[sf[1]]) subfields[sf[1]] = [];
            subfields[sf[1]].push(sf[2]);
          }
          return subfields;
        });
      };

      // 041 - Language code (h = original language)
      const f041s = getField('041');
      record.originalLanguages = [];
      for (const f of f041s) {
        if (f.h) record.originalLanguages.push(...f.h);
      }

      // 100 - Main entry (author)
      const f100s = getField('100');
      if (f100s.length > 0 && f100s[0].a) {
        record.author = f100s[0].a[0].replace(/[,.]$/, '').trim();
        if (f100s[0].d) record.authorDates = f100s[0].d[0].replace(/[,.]$/, '').trim();
      }

      // 245 - Title
      const f245s = getField('245');
      if (f245s.length > 0) {
        let title = (f245s[0].a || [''])[0].replace(/[/:]$/, '').trim();
        if (f245s[0].b) title += ' ' + f245s[0].b[0].replace(/[/:]$/, '').trim();
        record.title = title;
      }

      // 240 - Uniform title (original title)
      const f240s = getField('240');
      if (f240s.length > 0 && f240s[0].a) {
        record.originalTitle = f240s[0].a[0].replace(/[.]$/, '').trim();
        if (f240s[0].l) record.translationLanguage = f240s[0].l[0];
      }

      // 260/264 - Publication info
      const f260s = getField('260');
      const f264s = getField('264');
      const pubField = f260s.length > 0 ? f260s[0] : (f264s.length > 0 ? f264s[0] : null);
      if (pubField) {
        record.pubPlace = (pubField.a || [''])[0].replace(/[: ;]$/, '').trim();
        record.publisher = (pubField.b || [''])[0].replace(/[,.]$/, '').trim();
        record.pubYear = (pubField.c || [''])[0].replace(/[^0-9]/g, '').substring(0, 4);
      }

      // 700 - Added entry (translator)
      const f700s = getField('700');
      for (const f of f700s) {
        if (f.e && f.e.some(e => e.toLowerCase().includes('translator') || e.toLowerCase().includes('tr.'))) {
          record.translator = (f.a || [''])[0].replace(/[,.]$/, '').trim();
          break;
        }
      }

      // 650 - Subject headings
      const f650s = getField('650');
      record.subjects = f650s.map(f => (f.a || [''])[0]).filter(Boolean);

      records.push(record);
    } catch (e) {
      // Skip malformed records
    }
  }

  return records;
}

// Filter for pre-modern translations from target languages
function isRelevant(record) {
  // Must be in English
  if (record.language008 && record.language008 !== 'eng') return false;

  // Must have original language in our target set
  const hasTargetLang = record.originalLanguages.some(l => TARGET_LANGUAGES.has(l.toLowerCase()));
  if (!hasTargetLang && record.originalLanguages.length > 0) return false;

  // Try to determine if the original text is pre-modern
  // Check author dates
  if (record.authorDates) {
    const yearMatch = record.authorDates.match(/(\d{3,4})/);
    if (yearMatch) {
      const year = parseInt(yearMatch[1]);
      if (year > MAX_SOURCE_YEAR) return false; // Modern author
    }
  }

  return true;
}

async function fetchBatch(query, startRecord) {
  const url = new URL(SRU_BASE);
  url.searchParams.set('version', '1.1');
  url.searchParams.set('operation', 'searchRetrieve');
  url.searchParams.set('query', query);
  url.searchParams.set('maximumRecords', String(BATCH_SIZE));
  url.searchParams.set('startRecord', String(startRecord));
  url.searchParams.set('recordSchema', 'marcxml');

  const res = await fetch(url.toString());
  if (!res.ok) {
    console.error(`SRU error: ${res.status} at startRecord ${startRecord}`);
    return { records: [], totalRecords: 0, error: true };
  }

  const xml = await res.text();

  // Extract total records count
  const totalMatch = xml.match(/<numberOfRecords>(\d+)<\/numberOfRecords>/);
  const totalRecords = totalMatch ? parseInt(totalMatch[1]) : 0;

  const records = parseRecords(xml);

  return { records, totalRecords, error: false };
}

async function harvestQuery(query, label) {
  console.log(`\nHarvesting: ${label}`);
  console.log(`Query: ${query}`);

  const allRecords = [];
  let startRecord = 1;
  let totalRecords = 0;
  let errorCount = 0;

  // First batch to get total
  const first = await fetchBatch(query, 1);
  if (first.error) {
    console.error('  Failed on first batch');
    return [];
  }

  totalRecords = first.totalRecords;
  console.log(`  Total available: ${totalRecords.toLocaleString()}`);

  allRecords.push(...first.records);
  startRecord += BATCH_SIZE;

  // Cap at 10,000 per query to avoid hammering the server
  const maxRecords = Math.min(totalRecords, 10000);

  while (startRecord <= maxRecords && errorCount < 5) {
    await new Promise(r => setTimeout(r, 500)); // Be polite

    const batch = await fetchBatch(query, startRecord);
    if (batch.error) {
      errorCount++;
      console.error(`  Error at record ${startRecord}, attempt ${errorCount}`);
      await new Promise(r => setTimeout(r, 2000));
      continue;
    }

    allRecords.push(...batch.records);
    startRecord += BATCH_SIZE;

    if (startRecord % 500 === 1 || startRecord > maxRecords) {
      process.stdout.write(`  ${Math.min(startRecord - 1, maxRecords).toLocaleString()} / ${maxRecords.toLocaleString()} records fetched\r`);
    }

    if (batch.records.length < BATCH_SIZE) break; // No more records
  }

  console.log(`  Fetched ${allRecords.length.toLocaleString()} raw records`);
  return allRecords;
}

async function main() {
  console.log('=== Library of Congress Translation Harvest ===');
  console.log(`Target: English translations from ${[...TARGET_LANGUAGES].join(', ')}`);
  console.log(`Source period: pre-${MAX_SOURCE_YEAR}\n`);

  // Check for cached results
  const cachePath = 'scripts/analysis/loc-raw-records.json';
  let allRaw = [];

  if (existsSync(cachePath)) {
    console.log('Loading cached raw records...');
    allRaw = JSON.parse(readFileSync(cachePath, 'utf-8'));
    console.log(`  ${allRaw.length.toLocaleString()} cached records\n`);
  } else {
    // Query by subject heading — cast a wide net
    const queries = [
      ['dc.subject="Latin literature Translations into English"', 'Latin literature'],
      ['dc.subject="Latin poetry Translations into English"', 'Latin poetry'],
      ['dc.subject="Latin drama Translations into English"', 'Latin drama'],
      ['dc.subject="Latin prose literature Translations into English"', 'Latin prose'],
      ['dc.subject="German literature Translations into English"', 'German literature'],
      ['dc.subject="German poetry Translations into English"', 'German poetry'],
      ['dc.subject="French literature Translations into English"', 'French literature'],
      ['dc.subject="French poetry Translations into English"', 'French poetry'],
      ['dc.subject="Italian literature Translations into English"', 'Italian literature'],
      ['dc.subject="Italian poetry Translations into English"', 'Italian poetry'],
      ['dc.subject="Spanish literature Translations into English"', 'Spanish literature'],
      ['dc.subject="Dutch literature Translations into English"', 'Dutch literature'],
      ['dc.subject="Church history Primitive and early church"', 'Church fathers'],
      ['dc.subject="Alchemy Early works to 1800"', 'Alchemy'],
      ['dc.subject="Theology Early works to 1800"', 'Theology early works'],
      ['dc.subject="Philosophy, Ancient"', 'Ancient philosophy'],
      ['dc.subject="Philosophy, Medieval"', 'Medieval philosophy'],
      ['dc.subject="Philosophy, Renaissance"', 'Renaissance philosophy'],
    ];

    for (const [query, label] of queries) {
      const records = await harvestQuery(query, label);
      allRaw.push(...records);
      await new Promise(r => setTimeout(r, 1000)); // Pause between queries
    }

    // Cache raw results
    writeFileSync(cachePath, JSON.stringify(allRaw, null, 2));
    console.log(`\nCached ${allRaw.length.toLocaleString()} raw records to ${cachePath}`);
  }

  // Filter for relevant records
  console.log('\nFiltering for relevant translations...');
  const relevant = allRaw.filter(isRelevant);
  console.log(`  ${relevant.length.toLocaleString()} relevant records (from ${allRaw.length.toLocaleString()} raw)`);

  // Deduplicate by LCCN
  const seen = new Set();
  const deduped = [];
  for (const r of relevant) {
    const key = r.lccn || `${r.author}|||${r.title}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(r);
    }
  }
  console.log(`  ${deduped.length.toLocaleString()} after deduplication`);

  // Language breakdown
  const byLang = {};
  for (const r of deduped) {
    for (const lang of r.originalLanguages) {
      const l = lang.toLowerCase();
      byLang[l] = (byLang[l] || 0) + 1;
    }
  }
  console.log('\nBy original language:');
  for (const [lang, count] of Object.entries(byLang).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${lang}: ${count}`);
  }

  // Author stats
  const authors = {};
  for (const r of deduped) {
    const a = (r.author || 'unknown').toLowerCase().trim();
    if (!authors[a]) authors[a] = new Set();
    const title = (r.originalTitle || r.title || '').toLowerCase().trim();
    if (title) authors[a].add(title);
  }
  const authorList = Object.entries(authors).map(([a, works]) => ({ author: a, works: works.size })).sort((a, b) => b.works - a.works);

  console.log(`\nDistinct authors: ${authorList.length}`);
  console.log('\nTop 30 authors by works:');
  for (const { author, works } of authorList.slice(0, 30)) {
    console.log(`  ${String(works).padEnd(5)} ${author}`);
  }

  // THE MACHIAVELLI TEST
  const mach = deduped.filter(r => (r.author || '').toLowerCase().includes('machiavelli'));
  console.log(`\n--- MACHIAVELLI TEST ---`);
  console.log(`Records: ${mach.length}`);
  for (const r of mach) {
    console.log(`  ${r.title} (${r.pubYear || '?'}) [${r.originalTitle || '?'}]`);
  }

  // Save results
  const outputPath = 'scripts/analysis/loc-translations.json';
  writeFileSync(outputPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    source: 'Library of Congress SRU gateway',
    totalRaw: allRaw.length,
    totalRelevant: relevant.length,
    totalDeduped: deduped.length,
    byLanguage: byLang,
    distinctAuthors: authorList.length,
    topAuthors: authorList.slice(0, 100),
    records: deduped,
  }, null, 2));

  console.log(`\nSaved ${deduped.length.toLocaleString()} records to ${outputPath}`);
}

main().catch(console.error);
