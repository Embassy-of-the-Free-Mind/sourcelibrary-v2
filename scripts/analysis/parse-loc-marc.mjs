/**
 * Parse LOC bulk MARC files for English translations of pre-modern texts.
 *
 * Reads gzipped MARC21 binary files, extracts records where:
 * - Language is English (008 pos 35-37 = 'eng')
 * - MARC 041 indicator 1 = '1' (translation) with $h in target languages
 * - OR 041 $a = 'eng' and $h in target languages
 *
 * Uses streaming to handle large files without loading everything into memory.
 */

import { createReadStream } from 'fs';
import { createGunzip } from 'zlib';
import { writeFileSync, readdirSync } from 'fs';

const TARGET_LANGS = new Set(['lat', 'ger', 'deu', 'fre', 'fra', 'ita', 'dut', 'nld', 'spa', 'por']);
const MAX_AUTHOR_YEAR = 1800;

// MARC21 binary parser — reads one record at a time from a buffer
function parseMarc21Records(buffer) {
  const records = [];
  let pos = 0;

  while (pos < buffer.length) {
    // Record length is first 5 bytes (ASCII digits)
    if (pos + 5 > buffer.length) break;
    const lenStr = buffer.toString('ascii', pos, pos + 5);
    const recordLen = parseInt(lenStr, 10);
    if (isNaN(recordLen) || recordLen < 25) { pos++; continue; }
    if (pos + recordLen > buffer.length) break;

    try {
      const recordBuf = buffer.subarray(pos, pos + recordLen);
      const record = parseOneRecord(recordBuf);
      if (record) records.push(record);
    } catch (e) {
      // Skip malformed records
    }

    pos += recordLen;
  }

  return records;
}

function parseOneRecord(buf) {
  // Leader: first 24 bytes
  const leader = buf.toString('ascii', 0, 24);
  const baseAddr = parseInt(leader.substring(12, 17), 10);

  // Directory: from byte 24 to baseAddr-1
  const dirEnd = baseAddr - 1;
  const directory = [];
  for (let i = 24; i < dirEnd; i += 12) {
    const tag = buf.toString('ascii', i, i + 3);
    const fieldLen = parseInt(buf.toString('ascii', i + 3, i + 7), 10);
    const fieldStart = parseInt(buf.toString('ascii', i + 7, i + 12), 10);
    if (!isNaN(fieldLen) && !isNaN(fieldStart)) {
      directory.push({ tag, fieldLen, fieldStart });
    }
  }

  const result = {};

  for (const { tag, fieldLen, fieldStart } of directory) {
    const start = baseAddr + fieldStart;
    const end = start + fieldLen;
    if (end > buf.length) continue;
    const fieldData = buf.toString('utf-8', start, end);

    if (tag === '008') {
      result.lang008 = fieldData.substring(35, 38);
      result.pubDate = fieldData.substring(7, 11);
    } else if (tag === '001') {
      result.controlNum = fieldData.replace(/\x1e/g, '').trim();
    } else if (tag === '041') {
      // Subfields separated by \x1f, field ends with \x1e
      const subs = fieldData.split('\x1f').slice(1); // first element is indicators
      if (!result.lang041h) result.lang041h = [];
      if (!result.lang041a) result.lang041a = [];
      for (const sf of subs) {
        const code = sf[0];
        const value = sf.substring(1).replace(/\x1e/g, '').trim();
        if (code === 'h') result.lang041h.push(value);
        if (code === 'a') result.lang041a.push(value);
      }
    } else if (tag === '100') {
      const subs = fieldData.split('\x1f').slice(1);
      for (const sf of subs) {
        if (sf[0] === 'a') result.author = sf.substring(1).replace(/[,.\x1e]/g, '').trim();
        if (sf[0] === 'd') result.authorDates = sf.substring(1).replace(/[,.\x1e]/g, '').trim();
      }
    } else if (tag === '245') {
      const subs = fieldData.split('\x1f').slice(1);
      const parts = [];
      for (const sf of subs) {
        if (sf[0] === 'a' || sf[0] === 'b') parts.push(sf.substring(1).replace(/[/:\x1e]/g, '').trim());
      }
      result.title = parts.join(' ').trim();
    } else if (tag === '240') {
      const subs = fieldData.split('\x1f').slice(1);
      for (const sf of subs) {
        if (sf[0] === 'a') result.originalTitle = sf.substring(1).replace(/[.\x1e]/g, '').trim();
      }
    } else if (tag === '260' || tag === '264') {
      if (!result.publisher) {
        const subs = fieldData.split('\x1f').slice(1);
        for (const sf of subs) {
          if (sf[0] === 'b') result.publisher = sf.substring(1).replace(/[,.\x1e]/g, '').trim();
          if (sf[0] === 'c') result.pubYear = sf.substring(1).replace(/[^0-9]/g, '').substring(0, 4);
        }
      }
    } else if (tag === '700') {
      const subs = fieldData.split('\x1f').slice(1);
      let name = '', role = '';
      for (const sf of subs) {
        if (sf[0] === 'a') name = sf.substring(1).replace(/[,.\x1e]/g, '').trim();
        if (sf[0] === 'e') role = sf.substring(1).replace(/[,.\x1e]/g, '').trim().toLowerCase();
      }
      if (role.includes('translator') || role.includes('tr')) {
        result.translator = name;
      }
    }
  }

  return result;
}

function isTranslationFromTarget(record) {
  // Must be English
  if (record.lang008 && record.lang008 !== 'eng') return false;

  // Check 041$h for source language
  const sourceLangs = (record.lang041h || []).filter(l => TARGET_LANGS.has(l.toLowerCase()));
  if (sourceLangs.length === 0) return false;

  // Filter out modern authors (born after 1800)
  if (record.authorDates) {
    const match = record.authorDates.match(/(\d{3,4})/);
    if (match) {
      const year = parseInt(match[1]);
      if (year > MAX_AUTHOR_YEAR) return false;
    }
  }

  record.sourceLangs = sourceLangs;
  return true;
}

async function processFile(filepath) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const stream = createReadStream(filepath).pipe(createGunzip());

    stream.on('data', chunk => chunks.push(chunk));
    stream.on('end', () => {
      const buffer = Buffer.concat(chunks);
      const allRecords = parseMarc21Records(buffer);
      const translations = allRecords.filter(isTranslationFromTarget);
      resolve({ total: allRecords.length, translations });
    });
    stream.on('error', reject);
  });
}

async function main() {
  const dir = '/tmp/loc-marc';
  const files = readdirSync(dir).filter(f => f.endsWith('.utf8.gz')).sort();

  console.log(`=== LOC Bulk MARC Parser ===`);
  console.log(`Files: ${files.length}`);
  console.log(`Target languages: ${[...TARGET_LANGS].join(', ')}`);
  console.log(`Max author year: ${MAX_AUTHOR_YEAR}\n`);

  let allTranslations = [];
  let totalRecords = 0;

  for (const file of files) {
    process.stdout.write(`Processing ${file}...`);
    const { total, translations } = await processFile(`${dir}/${file}`);
    totalRecords += total;
    allTranslations.push(...translations);
    console.log(` ${total.toLocaleString()} records, ${translations.length} translations`);
  }

  // Deduplicate
  const seen = new Set();
  const deduped = [];
  for (const r of allTranslations) {
    const key = r.controlNum || `${r.author}|||${r.title}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(r);
    }
  }

  console.log(`\nTotal MARC records scanned: ${totalRecords.toLocaleString()}`);
  console.log(`Translations found: ${allTranslations.length.toLocaleString()}`);
  console.log(`After dedup: ${deduped.length.toLocaleString()}`);

  // Language breakdown
  const byLang = {};
  for (const r of deduped) {
    for (const l of (r.sourceLangs || [])) {
      byLang[l] = (byLang[l] || 0) + 1;
    }
  }
  console.log('\nBy source language:');
  for (const [l, c] of Object.entries(byLang).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${l}: ${c}`);
  }

  // Author stats
  const authors = {};
  for (const r of deduped) {
    const a = (r.author || 'unknown').toLowerCase().trim();
    if (!authors[a]) authors[a] = new Set();
    authors[a].add((r.originalTitle || r.title || '').toLowerCase().trim());
  }
  const authorList = Object.entries(authors)
    .map(([a, w]) => ({ author: a, works: w.size }))
    .sort((a, b) => b.works - a.works);

  console.log(`\nDistinct authors: ${authorList.length}`);
  console.log('\nTop 30:');
  for (const { author, works } of authorList.slice(0, 30)) {
    console.log(`  ${String(works).padEnd(5)} ${author}`);
  }

  // MACHIAVELLI TEST
  const mach = deduped.filter(r => (r.author || '').toLowerCase().includes('machiavelli'));
  console.log(`\n--- MACHIAVELLI TEST ---`);
  console.log(`Records: ${mach.length}`);
  for (const r of mach.slice(0, 20)) {
    console.log(`  ${r.title?.substring(0, 60)} (${r.pubYear || '?'}) [orig: ${r.originalTitle || '?'}]`);
  }

  // Save
  const output = {
    timestamp: new Date().toISOString(),
    filesProcessed: files.length,
    totalMarcRecords: totalRecords,
    translationsFound: deduped.length,
    byLanguage: byLang,
    distinctAuthors: authorList.length,
    topAuthors: authorList.slice(0, 200),
    records: deduped,
  };
  writeFileSync('scripts/analysis/loc-marc-translations.json', JSON.stringify(output, null, 2));
  console.log(`\nSaved to scripts/analysis/loc-marc-translations.json`);
}

main().catch(console.error);
