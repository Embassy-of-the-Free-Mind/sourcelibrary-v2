#!/usr/bin/env node
/**
 * ingest-loc-bulk.mjs — build the reference set from BULK catalogue dumps
 * instead of per-book API lookups. (#3459, #3455)
 *
 * WHY BULK, NOT PER-BOOK
 * ----------------------
 * The natural implementation of "does a prior English translation exist?" is a
 * live catalogue query per book. That shape is the reason this whole area has
 * been hard to trust:
 *
 *   - Every lookup is a fresh, unreproducible act. Re-running it next week can
 *     legitimately give a different answer, and nothing records why.
 *   - 6,096 of them cannot be audited. The instrument and the measurement are
 *     entangled, so a good answer and a bad answer look identical.
 *   - Rate limits make a full pass take days, so it never actually completes.
 *   - "We searched and found nothing" is unfalsifiable — a third party cannot
 *     check it.
 *
 * Ingesting the catalogue in BULK inverts all four. The reference set becomes a
 * fixed, versioned, countable local artifact. A search over it is deterministic,
 * free, instant, and replayable by anyone with the same snapshot. "Absent from
 * this set" becomes a checkable claim rather than an assertion.
 *
 * THE SOURCE
 * ----------
 * LoC MDSConnect "Books All" — the Library of Congress book catalogue published
 * as 43 gzipped MARC-XML parts, free, no auth, no rate limit.
 *   https://www.loc.gov/cds/products/MDSConnect-books_all.html
 *
 * Measured 2026-07-29 on part01:
 *   250,000 records  →  3,689 English translations (1.5%)
 *   100% carry an LCCN          (every row re-checkable)
 *    66% carry a MARC 240 uniform title  (the work-identity join key)
 *   ~15s to process one part
 * Extrapolated over 43 parts: ~10.75M records → ~158,000 English translations.
 * For comparison, `translation_catalogs` today holds 24,061 rows, ZERO with an
 * identifier, of which 385 are usable to defeat a claim.
 *
 * ⚠️ SNAPSHOT BOUNDARY — this is a **2016** dump. Translations published after
 * 2016 are NOT in it. That is a stated, bounded gap, not a defect: the whole
 * point of a reference set is that its edges are known and declared. Top up the
 * recent tail with the live SRU path in fetch-bib-records.mjs.
 *
 * WHAT COUNTS AS AN ENGLISH TRANSLATION
 * -------------------------------------
 * MARC `041$h` present (language of the original — a cataloguer's explicit
 * assertion that this item renders something from another language) AND the
 * item's own language is English (`041$a` or the 008 language position 35-37).
 *
 * Usage:
 *   node scripts/enrichment/ingest-loc-bulk.mjs --parts 1-43 --out ./loc-bulk
 *   node scripts/enrichment/ingest-loc-bulk.mjs --parts 1-4 --keep-gz
 *   node scripts/enrichment/ingest-loc-bulk.mjs --parts 1-43 --load    # → Mongo
 */
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import readline from 'readline';
import { spawnSync } from 'child_process';
import { withMongo } from '../lib/mongo.mjs';

const argOf = (f) => { const i = process.argv.indexOf(f); return i === -1 ? null : process.argv[i + 1]; };
const KEEP_GZ = process.argv.includes('--keep-gz');
const LOAD = process.argv.includes('--load');
const OUT_DIR = argOf('--out') ?? path.join(process.cwd(), 'scripts', 'output', 'loc-bulk');

const SNAPSHOT = '2016';
const BASE = `https://www.loc.gov/cds/downloads/MDSConnect/BooksAll.${SNAPSHOT}`;

/** "1-43" | "1,5,9" | "3" → [1,5,...] */
function parseParts(spec) {
  if (!spec) return [1];
  const out = new Set();
  for (const chunk of spec.split(',')) {
    const m = chunk.trim().match(/^(\d+)(?:-(\d+))?$/);
    if (!m) throw new Error(`bad --parts segment "${chunk}"`);
    const lo = parseInt(m[1], 10);
    const hi = m[2] ? parseInt(m[2], 10) : lo;
    for (let i = lo; i <= hi; i++) out.add(i);
  }
  return [...out].sort((a, b) => a - b);
}

// ── Minimal MARC field readers ───────────────────────────────────────────────
// Deliberately string-based rather than a full XML parse: we touch ~10.7M
// records and discard 98.5% of them, so a full DOM parse per record is a large
// cost for data we throw away. The survivors are re-parsed properly by
// scripts/lib/bib-record.mjs before anything is asserted about them.

function subfieldValues(rec, tag, code) {
  const out = [];
  const dfRe = new RegExp(`<datafield tag="${tag}"[^>]*>([\\s\\S]*?)</datafield>`, 'g');
  let df;
  while ((df = dfRe.exec(rec))) {
    const sfRe = new RegExp(`<subfield code="${code}">([\\s\\S]*?)</subfield>`, 'g');
    let sf;
    while ((sf = sfRe.exec(df[1]))) out.push(sf[1].trim());
  }
  return out;
}
const controlField = (rec, tag) =>
  (rec.match(new RegExp(`<controlfield tag="${tag}">([^<]*)</controlfield>`)) || [])[1] || '';

const decode = (s) => (s || '')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'");

/** Extract the reference-set row, or null if this record is not an English translation. */
export function extractEnglishTranslation(rec) {
  if (!rec.includes('tag="041"')) return null;
  const originalLangs = subfieldValues(rec, '041', 'h');
  if (!originalLangs.length) return null;

  const f008 = controlField(rec, '008');
  const itemLang = (subfieldValues(rec, '041', 'a')[0] || f008.slice(35, 38) || '').toLowerCase().trim();
  if (!itemLang.startsWith('eng')) return null;

  const year = ((subfieldValues(rec, '264', 'c')[0]
    || subfieldValues(rec, '260', 'c')[0]
    || f008.slice(7, 11)).match(/(\d{4})/) || [])[1] || '';

  return {
    lccn: (subfieldValues(rec, '010', 'a')[0] || '').replace(/\s+/g, ''),
    author: decode(subfieldValues(rec, '100', 'a')[0] || subfieldValues(rec, '110', 'a')[0] || ''),
    added_entries: subfieldValues(rec, '700', 'a').map(decode),
    uniform_title: decode(subfieldValues(rec, '240', 'a')[0] || ''),
    title: decode(subfieldValues(rec, '245', 'a')[0] || ''),
    subtitle: decode(subfieldValues(rec, '245', 'b')[0] || ''),
    year,
    extent: decode(subfieldValues(rec, '300', 'a')[0] || ''),
    publisher: decode(subfieldValues(rec, '264', 'b')[0] || subfieldValues(rec, '260', 'b')[0] || ''),
    original_languages: originalLangs,
    item_language: itemLang,
    subjects: subfieldValues(rec, '650', 'a').concat(subfieldValues(rec, '600', 'a')).map(decode).slice(0, 8),
    source: 'loc_mdsconnect',
    snapshot: SNAPSHOT,
  };
}

/** Stream one gzipped MARC-XML part, writing matching rows as JSONL. */
async function processPart(gzPath, outPath) {
  const out = fs.createWriteStream(outPath);
  const rl = readline.createInterface({
    input: fs.createReadStream(gzPath).pipe(zlib.createGunzip()),
    crlfDelay: Infinity,
  });

  let buf = '';
  const stats = { records: 0, with_041h: 0, english_translations: 0, with_uniform_title: 0, with_lccn: 0 };
  const originalLangTally = {};

  for await (const line of rl) {
    buf += line + '\n';
    if (!line.includes('</record>')) continue;
    const rec = buf;
    buf = '';
    stats.records++;

    if (rec.includes('tag="041"') && subfieldValues(rec, '041', 'h').length) stats.with_041h++;
    const row = extractEnglishTranslation(rec);
    if (!row) continue;

    stats.english_translations++;
    if (row.uniform_title) stats.with_uniform_title++;
    if (row.lccn) stats.with_lccn++;
    for (const l of row.original_languages) originalLangTally[l] = (originalLangTally[l] || 0) + 1;
    out.write(JSON.stringify(row) + '\n');
  }
  await new Promise((res) => out.end(res));
  return { stats, originalLangTally };
}

/**
 * Download one part, streaming to disk, with retry and resume.
 *
 * Deliberately curl rather than node's fetch: these are ~70MB files over a long
 * connection, and `fetch` + `arrayBuffer()` buffers the whole part in memory and
 * dies on any mid-transfer socket close ("TypeError: terminated" /
 * UND_ERR_SOCKET). Observed failing on the very first part of a 43-part run.
 * curl streams, resumes a partial file (-C -), and retries transport errors
 * itself — which matters when a run is 3GB long and unattended.
 *
 * The gzip integrity check afterwards is the real guard: a truncated part would
 * otherwise silently yield fewer records and quietly understate the reference
 * set, which is the failure mode we can least afford here.
 */
async function download(url, dest) {
  const MAX_ATTEMPTS = 4;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = spawnSync('curl', [
      '--silent', '--show-error', '--location',
      '--retry', '5', '--retry-delay', '3', '--retry-all-errors',
      '--connect-timeout', '30', '--max-time', '1800',
      '-C', '-', // resume a partial file rather than restarting 70MB
      '--user-agent', 'SourceLibrary/1.0 (+https://sourcelibrary.org; reference-set build)',
      '-o', dest, url,
    ], { encoding: 'utf8' });

    // curl exit 33 = server does not support resume; drop the partial and retry clean.
    if (res.status === 33) { fs.rmSync(dest, { force: true }); continue; }

    if (res.status === 0) {
      const check = spawnSync('gzip', ['-t', dest], { encoding: 'utf8' });
      if (check.status === 0) return;
      // Truncated or corrupt — discard and retry from scratch.
      fs.rmSync(dest, { force: true });
      if (attempt === MAX_ATTEMPTS) throw new Error(`gzip integrity check failed for ${url}`);
      continue;
    }

    if (attempt === MAX_ATTEMPTS) {
      throw new Error(`curl exit ${res.status} for ${url}: ${(res.stderr || '').trim()}`);
    }
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

const parts = parseParts(argOf('--parts'));
fs.mkdirSync(OUT_DIR, { recursive: true });
console.log(`LoC MDSConnect ${SNAPSHOT} — ${parts.length} part(s) → ${OUT_DIR}\n`);

const totals = { records: 0, with_041h: 0, english_translations: 0, with_uniform_title: 0, with_lccn: 0 };
const langTotals = {};
const failedParts = [];

for (const p of parts) {
  const pp = String(p).padStart(2, '0');
  const gz = path.join(OUT_DIR, `BooksAll.${SNAPSHOT}.part${pp}.xml.gz`);
  const jsonl = path.join(OUT_DIR, `eng-translations.part${pp}.jsonl`);

  if (fs.existsSync(jsonl)) {
    console.log(`  part${pp}  already extracted, skipping`);
    continue;
  }
  // A 43-part run is ~3GB and unattended. One flaky part must not discard the
  // 40 that worked — record it and carry on, then report the gap loudly at the
  // end, because a silently short reference set understates coverage and that
  // biases every negative it supports.
  try {
    if (!fs.existsSync(gz)) {
      process.stdout.write(`  part${pp}  downloading…`);
      await download(`${BASE}.part${pp}.xml.gz`, gz);
    }
    process.stdout.write(`  part${pp}  extracting…`);
    const { stats, originalLangTally } = await processPart(gz, jsonl);
    if (!KEEP_GZ) fs.rmSync(gz, { force: true });

    for (const k of Object.keys(totals)) totals[k] += stats[k];
    for (const [l, n] of Object.entries(originalLangTally)) langTotals[l] = (langTotals[l] || 0) + n;
    console.log(` ${stats.records} records → ${stats.english_translations} English translations`);
  } catch (err) {
    failedParts.push({ part: pp, error: err.message });
    fs.rmSync(gz, { force: true });
    fs.rmSync(jsonl, { force: true }); // never leave a half-written extract behind
    console.log(` FAILED — ${err.message}`);
  }
}

console.log('\n─── Reference set ────────────────────────────────────────────');
console.log('  source                :', `LoC MDSConnect Books-All, snapshot ${SNAPSHOT}`);
console.log('  parts ingested        :', parts.length, `of 43`);
console.log('  MARC records scanned  :', totals.records.toLocaleString());
console.log('  with 041$h (any translation):', totals.with_041h.toLocaleString());
console.log('  ENGLISH translations  :', totals.english_translations.toLocaleString());
console.log('  ...with an LCCN       :', totals.with_lccn.toLocaleString(),
  totals.english_translations ? `(${((totals.with_lccn / totals.english_translations) * 100).toFixed(1)}%)` : '');
console.log('  ...with a 240 uniform title:', totals.with_uniform_title.toLocaleString(),
  totals.english_translations ? `(${((totals.with_uniform_title / totals.english_translations) * 100).toFixed(1)}%)` : '');

const topLangs = Object.entries(langTotals).sort((a, b) => b[1] - a[1]).slice(0, 30);
console.log('\n  original languages (top 30):');
for (const [l, n] of topLangs) console.log(`    ${l.padEnd(6)} ${String(n).padStart(6)}`);

console.log('\n  BOUNDARY: this snapshot ends in 2016. A translation published after');
console.log('  2016 is absent by construction, not by evidence. Any claim resting on');
console.log('  this set must say so, and be topped up from the live SRU path.');

const extractedParts = fs.readdirSync(OUT_DIR).filter((f) => /^eng-translations\.part\d+\.jsonl$/.test(f)).length;
console.log(`\n  parts on disk: ${extractedParts} of 43`);
if (failedParts.length) {
  console.log(`\n  ⚠️  ${failedParts.length} PART(S) FAILED — the reference set is INCOMPLETE:`);
  for (const f of failedParts) console.log(`      part${f.part}: ${f.error}`);
  console.log('      Re-run the same command; completed parts are skipped.');
  console.log('      Do NOT quote coverage numbers from this run until they land.');
}

if (LOAD) {
  console.log('\nLoading into Mongo `reference_translations`…');
  await withMongo(async (db) => {
    const coll = db.collection('reference_translations');
    await coll.createIndex({ lccn: 1 }, { unique: true, sparse: true });
    await coll.createIndex({ author_surname: 1 });
    await coll.createIndex({ original_languages: 1 });
    let loaded = 0;
    for (const f of fs.readdirSync(OUT_DIR).filter((f) => f.endsWith('.jsonl'))) {
      const rl = readline.createInterface({
        input: fs.createReadStream(path.join(OUT_DIR, f)), crlfDelay: Infinity,
      });
      let batch = [];
      for await (const line of rl) {
        if (!line.trim()) continue;
        const row = JSON.parse(line);
        batch.push({
          updateOne: {
            filter: { lccn: row.lccn || `nolccn:${row.title}:${row.year}` },
            update: { $set: row },
            upsert: true,
          },
        });
        if (batch.length >= 1000) { await coll.bulkWrite(batch, { ordered: false }); loaded += batch.length; batch = []; }
      }
      if (batch.length) { await coll.bulkWrite(batch, { ordered: false }); loaded += batch.length; }
      console.log(`  ${f} → running total ${loaded}`);
    }
    console.log(`Loaded ${loaded} rows into reference_translations.`);
  });
}
