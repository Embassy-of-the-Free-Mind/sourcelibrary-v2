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
 * assertion that this item renders something from another language) AND English
 * appearing among the item's OWN languages (any `041$a`, or the 008 language
 * position 35-37).
 *
 * ⚠️ "among" is load-bearing (#3556). This used to read only the FIRST `041$a`
 * and require it to start with `eng`. MARC lists an item's languages in order of
 * PREDOMINANCE, so a facing-page scholarly edition names the ancient language
 * first — and `$a lat $a eng`, plus the concatenated `$a lateng`, were both
 * rejected outright. That silently discarded the whole Loeb / I Tatti /
 * Dumbarton Oaks class, i.e. the main vehicle for scholarly English translations
 * of exactly the works this set exists to check. A bilingual edition IS an
 * English translation — arguably the most citable kind.
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
import { fileURLToPath } from 'url';
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

/**
 * Extract MARC 880 — the ORIGINAL-SCRIPT form of a field.
 *
 * This is the only workable access point for CJK works, and it took a failed
 * attempt to establish why. Romanized matching cannot work here:
 *   - LoC mixes schemes (pinyin "Dao de jing" and Wade-Giles "Li Chao-ji po shih")
 *   - pinyin is syllable-SEPARATED while our titles use joined forms
 *     ("Huangji Jingshi Shu" vs "Huang ji jing shi shu")
 *   - most pinyin syllables are under the 4-character token floor
 * Concatenating and substring-matching to work around all that produced almost
 * pure noise — 38 matches of which ~2 were real, because romanized Chinese is a
 * dense syllable soup where short keys collide by accident ("mingshi" sits inside
 * "zhiwumingshitukao", matching a herbal to the *Ming History*).
 *
 * The original script has none of those problems: Han characters are morphemes,
 * so a shared run of them is strong evidence, and there is exactly one spelling.
 *
 * `$6` links each 880 back to the field it duplicates ("245-02/$1" → tag 245), so
 * the vernacular uniform title and display title are recoverable separately.
 */
function extractVernacular(rec) {
  const out = {};
  const dfRe = /<datafield tag="880"[^>]*>([\s\S]*?)<\/datafield>/g;
  let df;
  while ((df = dfRe.exec(rec))) {
    const subs = [...df[1].matchAll(/<subfield code="(\w)">([\s\S]*?)<\/subfield>/g)]
      .map((m) => ({ code: m[1], value: decode(m[2].trim()) }));
    const link = subs.find((s) => s.code === '6')?.value ?? '';
    const linkedTag = link.slice(0, 3);
    if (linkedTag !== '240' && linkedTag !== '245') continue;
    const text = subs.filter((s) => s.code === 'a' || s.code === 'b')
      .map((s) => s.value).join(' ')
      .replace(/\s+/g, ' ').replace(/\s*[\/:;,.]\s*$/, '').trim();
    if (!text) continue;
    if (linkedTag === '240') out.vernacular_uniform_title = text;
    else if (!out.vernacular_title) out.vernacular_title = text;
  }
  return out;
}

/**
 * Every language code in which this item's own text appears.
 *
 * MARC 041$a lists the languages of the item **in order of predominance**, and it
 * does so in two encodings that both occur in this dump: repeated subfields
 * (`$a lat $a eng`) and a single concatenated run of 3-letter codes
 * (`$a lateng`). Fixed-width chunking handles both.
 *
 * THIS IS WHY IT MATTERS (#3556). The previous test read only the FIRST $a and
 * asked `startsWith('eng')`. A facing-page scholarly edition puts the ancient
 * language first, because the ancient text is the primary content — so
 * `$a lat $a eng` and `$a lateng` were BOTH rejected outright. That is the
 * Loeb / I Tatti / Dumbarton Oaks / Clay Sanskrit form: the dominant vehicle for
 * scholarly English translations of exactly the classical and early-modern works
 * this reference set exists to check. Caplan's Loeb *Ad Herennium* returned zero
 * rows; Lemay's *Women's Secrets* was absent.
 *
 * The bug's signature survived in the extract it produced: 4,622 rows passed
 * carrying a multi-language item code (424 distinct forms — `engsan`, `englat`,
 * `engfre`…) purely because `eng` happened to be listed first. The mirror
 * population was discarded silently.
 */
export function itemLanguages(rec, f008 = controlField(rec, '008')) {
  const fromSubfields = subfieldValues(rec, '041', 'a')
    .flatMap((v) => (v.toLowerCase().replace(/[^a-z]/g, '').match(/.{1,3}/g) ?? []))
    .filter((c) => c.length === 3);
  if (fromSubfields.length) return [...new Set(fromSubfields)];
  const fallback = (f008.slice(35, 38) || '').toLowerCase().trim();
  return fallback ? [fallback] : [];
}

/**
 * Does the MARC 240 declare this item to be the ENGLISH version of the work?
 *
 * `240$l` is *Language of a work* — the cataloguer stating exactly what `041$h`
 * states, in a different field. It is NOT necessarily the last subfield: `$s`
 * (version), `$k` (selections) and `$f` (date) follow it routinely, so
 * "Bible. Psalms. English. Sternhold and Hopkins." must match as readily as
 * "De consolatione philosophiae. English".
 */
export function uniformTitleDeclaresEnglish(rec) {
  const l = subfieldValues(rec, '240', 'l');
  return l.some((v) => /\beng(lish)?\b/i.test(v));
}

/**
 * Extract the reference-set row, or null if this record is not an English
 * translation.
 *
 * THREE GRADES OF EVIDENCE, and requiring only the first was the dominant cause
 * of 27% catalogue recall (#3599). Measured on one part: of 136,193
 * English-language records, 3,918 carry `041$h` — and ~131,000 declare nothing
 * at all by any means. Every confirmed-absent prior we chased was sitting in LoC
 * with a perfectly good MARC 240 and no 041 whatsoever: Caplan's Loeb
 * *Ad Herennium* (LCCN 55004252, `240 Rhetorica ad Herennium.`), Böhme
 * (`36037588`).
 *
 *   041h               a cataloguer's explicit "translated from <lang>"
 *   uniform_title_lang `240$l English` — the same assertion, different field
 *   uniform_title_only a 240 exists on an English item, but no language marker.
 *                      Noisier — roughly a third are genuine, the rest English
 *                      works with collective uniform titles ("Works.", "Poems.").
 *                      Kept because this is where Caplan lives, and because the
 *                      matcher already screens the noise: containment against
 *                      OUR title cannot fire on an unrelated English work, and
 *                      generic 1-2 token uniform titles demand author
 *                      corroboration.
 *
 * `original_languages` is empty for the latter two, which is correct and
 * load-bearing — the language screen reads an unresolvable value as UNKNOWN and
 * KEEPS the candidate rather than rejecting a real prior.
 */
export function extractEnglishTranslation(rec, reject = () => {}) {
  const f008 = controlField(rec, '008');
  const itemLangs = itemLanguages(rec, f008);
  const originalLangs = rec.includes('tag="041"') ? subfieldValues(rec, '041', 'h') : [];
  const uniform = subfieldValues(rec, '240', 'a')[0] || '';

  const evidence = originalLangs.length ? '041h'
    : uniformTitleDeclaresEnglish(rec) ? 'uniform_title_lang'
      : uniform ? 'uniform_title_only'
        : null;
  if (!evidence) { reject(rec.includes('tag="041"') ? 'no_041h' : 'no_041'); return null; }
  // The item must contain English SOMEWHERE. A bilingual edition is still an
  // English translation — arguably the most citable kind, since the reader can
  // check it against the original on the facing page.
  if (!itemLangs.includes('eng')) {
    reject('item_not_english', itemLangs.join('+') || '(none)');
    return null;
  }
  const itemLang = itemLangs.join('');

  const year = ((subfieldValues(rec, '264', 'c')[0]
    || subfieldValues(rec, '260', 'c')[0]
    || f008.slice(7, 11)).match(/(\d{4})/) || [])[1] || '';

  return {
    ...extractVernacular(rec),
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
    // Kept for compatibility with the existing extract's shape; `item_languages`
    // is the honest field. A consumer needs the distinction: a row that is
    // ['eng'] is a standalone English translation, while ['lat','eng'] is a
    // facing-page edition — which bears on the completeness screen in the demote
    // packet, where "is this a complete rendering" reads differently for a
    // bilingual critical edition than for a trade translation.
    item_language: itemLang,
    item_languages: itemLangs,
    bilingual: itemLangs.length > 1,
    // HOW this row was established to be a translation. Screening needs it: an
    // `041h` row is a cataloguer's assertion, `uniform_title_only` is our
    // inference from the presence of a 240 on an English item.
    translation_evidence: evidence,
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
  const stats = { records: 0, with_041h: 0, english_translations: 0, with_uniform_title: 0, with_lccn: 0, bilingual: 0 };
  const originalLangTally = {};
  /**
   * WHAT THE FILTER THREW AWAY, and why this is not optional bookkeeping.
   *
   * #3556 — the item-language test rejected every facing-page bilingual edition
   * for two years' worth of runs, and it was invisible because this script
   * reported only what it KEPT. The raw dump is deleted after extraction, so the
   * discarded population could not be counted after the fact either: the only
   * evidence of the blind spot was an absence nobody could measure.
   *
   * A filter that reports only its survivors cannot be audited. This tally is the
   * fix for the CLASS, where the one-line change above is the fix for the
   * instance.
   */
  const rejects = { no_041: 0, no_041h: 0, item_not_english: 0 };
  const rejectedItemLangs = {};
  const onReject = (reason, detail) => {
    rejects[reason] = (rejects[reason] || 0) + 1;
    if (reason === 'item_not_english' && detail) {
      rejectedItemLangs[detail] = (rejectedItemLangs[detail] || 0) + 1;
    }
  };

  for await (const line of rl) {
    buf += line + '\n';
    if (!line.includes('</record>')) continue;
    const rec = buf;
    buf = '';
    stats.records++;

    if (rec.includes('tag="041"') && subfieldValues(rec, '041', 'h').length) stats.with_041h++;
    const row = extractEnglishTranslation(rec, onReject);
    if (!row) continue;

    stats.english_translations++;
    if (row.uniform_title) stats.with_uniform_title++;
    if (row.lccn) stats.with_lccn++;
    if (row.bilingual) stats.bilingual++;
    for (const l of row.original_languages) originalLangTally[l] = (originalLangTally[l] || 0) + 1;
    out.write(JSON.stringify(row) + '\n');
  }
  await new Promise((res) => out.end(res));
  return { stats, originalLangTally, rejects, rejectedItemLangs };
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

/**
 * Only run the ingest when this file is EXECUTED, never when it is imported.
 *
 * The extractor functions above are unit-tested (#3556,
 * tests/unit/loc-bulk-item-language.test.ts), and without this guard importing
 * them runs the whole pipeline as a side effect — which on a machine with no
 * extract present means a unit test silently downloads a ~70MB MARC part from
 * loc.gov. Fast and invisible locally where the parts already exist; a surprise
 * network fetch inside CI.
 */
const IS_MAIN = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (IS_MAIN) {
  await main();
}

async function main() {
const parts = parseParts(argOf('--parts'));
fs.mkdirSync(OUT_DIR, { recursive: true });
console.log(`LoC MDSConnect ${SNAPSHOT} — ${parts.length} part(s) → ${OUT_DIR}\n`);

const totals = { records: 0, with_041h: 0, english_translations: 0, with_uniform_title: 0, with_lccn: 0, bilingual: 0 };
const langTotals = {};
const rejectTotals = { no_041: 0, no_041h: 0, item_not_english: 0 };
const rejectedLangTotals = {};
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
    const { stats, originalLangTally, rejects, rejectedItemLangs } = await processPart(gz, jsonl);
    if (!KEEP_GZ) fs.rmSync(gz, { force: true });

    for (const k of Object.keys(totals)) totals[k] += stats[k];
    for (const [l, n] of Object.entries(originalLangTally)) langTotals[l] = (langTotals[l] || 0) + n;
    for (const [k, n] of Object.entries(rejects)) rejectTotals[k] = (rejectTotals[k] || 0) + n;
    for (const [l, n] of Object.entries(rejectedItemLangs)) rejectedLangTotals[l] = (rejectedLangTotals[l] || 0) + n;
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

console.log('  ...bilingual (facing-page):', totals.bilingual.toLocaleString(),
  totals.english_translations ? `(${((totals.bilingual / totals.english_translations) * 100).toFixed(1)}%)` : '');

// ── WHAT THE FILTER DISCARDED ───────────────────────────────────────────────
// #3556. This block is the fix for the CLASS; the item-language change is the
// fix for the instance. The bilingual bug survived every previous run because
// this script reported only its survivors, and the raw dump is deleted after
// extraction — so the discarded population could not be counted afterwards
// either. A filter that never reports its rejects cannot be audited, and its
// blind spot is indistinguishable from the world simply not containing the thing.
console.log('\n─── Rejected (what this filter can NOT see) ──────────────────');
console.log('  no 041 field at all   :', rejectTotals.no_041.toLocaleString());
console.log('  041 but no $h original:', rejectTotals.no_041h.toLocaleString());
console.log('  item not in English   :', rejectTotals.item_not_english.toLocaleString());
const topRejected = Object.entries(rejectedLangTotals).sort((a, b) => b[1] - a[1]).slice(0, 15);
if (topRejected.length) {
  console.log('\n  item-language codes most often rejected — any of these containing a');
  console.log('  language we translate FROM is a bilingual edition class worth checking:');
  for (const [l, n] of topRejected) console.log(`    ${l.padEnd(14)} ${String(n).padStart(8)}`);
}

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
  },
  /**
   * `noTimeout` is REQUIRED here, not a tuning choice.
   *
   * `withMongo` kills the process after 300s to stop zombie scripts. Upserting
   * 126,558 rows across 43 files takes longer than that, so the watchdog fires
   * MID-LOAD and the process exits 0 having written a PREFIX of the extract.
   *
   * Observed 2026-08-04: the run reported a complete 43-of-43 extraction and a
   * full statistics block, then died at `eng-translations.part30.jsonl` with
   * `[mongo] Script timeout after 300s`. `reference_translations` held 120,976 of
   * the 126,558 rows — a partial reference set that looks exactly like a complete
   * one from the log, and which would understate coverage in every downstream
   * recall measurement while appearing authoritative.
   *
   * Same failure as the demote packet (31 of 33 works) and the source-language
   * screen (2,000 of 17,072). Any script that loops over the corpus inside
   * `withMongo` needs this.
   */
  { noTimeout: true });
}
}
