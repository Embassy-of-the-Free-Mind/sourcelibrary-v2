#!/usr/bin/env node
/**
 * ingest-estc.mjs — the English Short Title Catalogue as a reference-set source. (#3522)
 *
 * WHY THIS SOURCE, MEASURED RATHER THAN ASSUMED
 * ---------------------------------------------
 * The LoC extract is a general catalogue, and a general catalogue treats
 * "is this a translation?" as optional metadata. Measured on one part (250,000
 * records, 136,193 of them English-language):
 *
 *     declare a translation via 041$h            3,918
 *     via 240$l English, no 041$h                  255
 *     via a translator relator or 245$c, no 041$h   120 matchable
 *     have a 240 but no language marker at all    1,349
 *     ── declare NOTHING, by any of the four        ~131,000  (96%)
 *
 * So reading LoC perfectly tops out near 4% of its English records. The gap is
 * missing data, not missed reading — three separate attempts to close it by
 * reading harder (#3556, #3599, the screening backlog) each recovered single
 * digits.
 *
 * ESTC records the same facts, because a short-title catalogue built for
 * 1473-1800 exists to record them. Spot-checked against records where LoC is bare:
 *
 *   Agrippa 1569  LoC: no 041 at all
 *                 ESTC S100458: uniform title "Della vanita delle scienze. English"
 *   Maier  1654   LoC: absent
 *                 ESTC R7027: language eng, relator "Hall, John, 1627-1656, translator."
 *
 * THE PAGINATION PROBLEM, AND WHY THE PARTITION IS BY ID
 * -----------------------------------------------------
 * `from` caps at 10,000 and fails SILENTLY — HTTP 200, no `rows` key, no error.
 * A naive harvester would take the first 10,000 records, record nothing for the
 * other 477,000, and every book downstream would read `none_found`. That is the
 * exact shape of the LoC throttle that once returned 200 with an HTML page.
 *
 * There is no OAI-PMH (every plausible endpoint 404s) and `sort`/`search_after`/
 * `scroll` are ignored. What works is `id:` with a prefix wildcard. Every record
 * has exactly one id, so a prefix tree is a COMPLETE, NON-OVERLAPPING partition,
 * and its completeness is checkable by arithmetic rather than by trust:
 * subdividing `id:T*` (223,099) yields children summing to exactly 223,099.
 *
 * Hence the two invariants this script enforces, and aborts on:
 *   1. every leaf must return exactly as many rows as it reported `hits`
 *   2. the leaves must sum to the catalogue total
 *
 * COST — stated up front because it is worse than it looks
 * -------------------------------------------------------
 * A size=100 page is ~1,125 KB (the `holdings` arrays dominate) and NO field
 * limiting is available: `_source`, `_source_includes`, `fields`, `fl`,
 * `include`, `mode=brief`, `format=brief`, `brief=true` all return the identical
 * payload. So a full harvest is ~4,875 requests and **~5.6 GB down**, larger
 * than the 3 GB LoC dump. What we keep is ~154 MB. One-time, free, no auth.
 *
 * Usage:
 *   node scripts/enrichment/ingest-estc.mjs --prefix C          # tiny smoke test
 *   node scripts/enrichment/ingest-estc.mjs --prefix P          # 4,319 records
 *   node scripts/enrichment/ingest-estc.mjs                     # everything
 *   node scripts/enrichment/ingest-estc.mjs --out ./estc
 */
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';
import { withMongo } from '../lib/mongo.mjs';

const argOf = (f) => { const i = process.argv.indexOf(f); return i === -1 ? null : process.argv[i + 1]; };
const OUT_DIR = argOf('--out') ?? path.join(process.cwd(), 'scripts', 'output', 'estc');
const ONLY_PREFIX = argOf('--prefix');
const DELAY_MS = parseInt(argOf('--delay') ?? '400', 10);
const LOAD = process.argv.includes('--load');
const LOAD_ONLY = process.argv.includes('--load-only');

const ENDPOINT = 'https://datb.cerl.org/estc/_search';
const UA = 'SourceLibrary/1.0 (+https://sourcelibrary.org; reference-set ingest)';
const PAGE = 100;      // server caps size at 100 regardless of what is asked
const FROM_CAP = 10000; // `from` beyond this returns HTTP 200 with no rows
const SNAPSHOT = new Date().toISOString().slice(0, 10);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * One search call. Returns {hits, rows} or throws.
 *
 * A response without a `rows` array is the silent-truncation signature, not an
 * empty result — it must never be read as "this slice is empty".
 */
async function search(query, from = 0, size = 1) {
  const url = `${ENDPOINT}?query=${encodeURIComponent(query)}&size=${size}&from=${from}`;
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
        signal: AbortSignal.timeout(60000),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      let json;
      try { json = JSON.parse(text); } catch { throw new Error(`non-JSON response (${text.slice(0, 60)})`); }
      if (typeof json.hits?.value !== 'number') throw new Error('response carries no hits count');
      if (size > 1 && !Array.isArray(json.rows)) {
        throw new Error(`no rows array at from=${from} — the ${FROM_CAP} paging cap, or a throttle`);
      }
      return { hits: json.hits.value, rows: json.rows ?? [] };
    } catch (e) {
      lastErr = e;
      await sleep(1500 * (attempt + 1));
    }
  }
  throw new Error(`${query} from=${from}: ${lastErr.message}`);
}

const countOf = async (prefix) => (await search(`id:${prefix}*`, 0, 1)).hits;

/**
 * Recursively split a prefix until every leaf fits under the paging cap.
 * Returns [{prefix, hits}]. A leaf that still exceeds the cap after exhausting
 * the alphabet is reported rather than silently truncated.
 */
const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
async function partition(prefix, hits, depth = 0) {
  if (hits === 0) return [];
  if (hits <= FROM_CAP) return [{ prefix, hits }];
  if (depth > 6) {
    throw new Error(`prefix ${prefix} still has ${hits} rows at depth ${depth} — cannot partition under the cap`);
  }
  const leaves = [];
  let childSum = 0;

  // A prefix can BE a complete id. `id:N1*` covers 10,895 records, of which
  // 10,894 are N10*…N1Z* and ONE is the record whose id is exactly "N1" —
  // nothing that appends a character can reach it. Left unhandled the sums
  // disagree by one, which is how the fail-closed check first surfaced this.
  // Count it explicitly and carry it as its own single-record leaf.
  const exact = (await search(`id:${prefix}`, 0, 1)).hits;
  await sleep(DELAY_MS);
  if (exact) {
    childSum += exact;
    leaves.push({ prefix, hits: exact, exactOnly: true });
  }

  for (const ch of CHARS) {
    const n = await countOf(prefix + ch);
    await sleep(DELAY_MS);
    if (!n) continue;
    childSum += n;
    leaves.push(...await partition(prefix + ch, n, depth + 1));
  }
  // Arithmetic, not trust: an id belongs to exactly one child, so the children
  // must account for the parent. Directional for the same reason as
  // harvestLeaf — children SHORT of the parent means the wildcard is not
  // behaving as a prefix and records are unreachable, which is fatal. Children
  // OVER the parent means the live index grew between the two counts; the
  // partition still covers everything, so it is reported, not thrown.
  if (childSum < hits) {
    throw new Error(
      `partition of ${prefix}* is lossy: children sum ${childSum} vs parent ${hits} — `
      + `${hits - childSum} records unreachable`,
    );
  }
  if (childSum > hits) {
    console.warn(`  ⚠ partition of ${prefix}*: children sum ${childSum} vs parent ${hits} — index grew between counts`);
  }
  return leaves;
}

/**
 * Page one leaf completely, asserting we received what it promised.
 *
 * THE ASSERTION IS DIRECTIONAL, AND THAT IS THE POINT.
 *
 * The hazard this whole script exists to prevent is SILENT TRUNCATION — `from`
 * past 10,000 returns HTTP 200 with no rows, so a naive harvester records
 * nothing for most of the catalogue and every book downstream reads
 * `none_found`. That failure is always `got < hits`. It stays fatal.
 *
 * `got > hits` cannot be that failure: we hold a superset of what was promised,
 * so nothing is missing. CERL is a LIVE index and `hits` was read during
 * partitioning, minutes before the paging — a record added or moved in between
 * gives exactly this. Observed 2026-08-07 on the first full run: leaf `R5*`
 * collected 2,284 against a promised 2,283 and killed a harvest that was 34%
 * done and correct. Failing closed on the safe direction is not caution, it is
 * a false alarm that costs the run.
 *
 * So: under-collection throws, over-collection is deduped by id (the ids are
 * what the partition's own arithmetic rests on, so they are exact), counted, and
 * reported. Drift is never swallowed — `main` prints the total at the end.
 */
export async function harvestLeaf(leaf, sink, drift = { leaves: 0, records: 0, dupes: 0 }, fetchPage = search) {
  // `exactOnly` leaves are the single record whose id IS the prefix; querying
  // them with a wildcard would re-collect the whole subtree.
  const query = leaf.exactOnly ? `id:${leaf.prefix}` : `id:${leaf.prefix}*`;
  const ids = new Set();
  let got = 0;
  let dupes = 0;
  for (let from = 0; from < leaf.hits; from += PAGE) {
    if (from >= FROM_CAP) throw new Error(`leaf ${leaf.prefix}* exceeds the ${FROM_CAP} cap — partition bug`);
    const { rows } = await fetchPage(query, from, PAGE);
    if (!rows.length) throw new Error(`leaf ${leaf.prefix}* returned 0 rows at from=${from} of ${leaf.hits}`);
    for (const row of rows) {
      // A record shifting position under a live index can surface twice across a
      // page boundary. Deduping by id keeps `got` a count of DISTINCT records,
      // so the comparison below measures coverage rather than paging noise.
      if (row.id && ids.has(row.id)) { dupes++; continue; }
      if (row.id) ids.add(row.id);
      sink(row);
      got++;
    }
    await sleep(DELAY_MS);
  }
  if (got < leaf.hits) {
    throw new Error(
      `leaf ${leaf.prefix}*: collected ${got} but it reported ${leaf.hits} — `
      + `${leaf.hits - got} records missing, refusing to record a short leaf`,
    );
  }
  if (got > leaf.hits) {
    drift.leaves++;
    drift.records += got - leaf.hits;
    console.warn(`  ⚠ leaf ${leaf.prefix}*: index grew under us — ${got} collected vs ${leaf.hits} promised (superset, kept)`);
  }
  if (dupes) drift.dupes += dupes;
  return got;
}

/**
 * Reduce an ESTC row to the reference-set shape.
 *
 * `search_titles` carries the MARC 240 uniform title WITH its `$l` language
 * ("De consolatione philosophiae. English"), which is the same join key
 * scripts/lib/work-identity-match.mjs is built and gold-tested against. The
 * language suffix is stripped into `translation_evidence` so the title matches
 * our books, and the fact that it was declared is not lost.
 */
/**
 * Pull the uniform title and its declared language out of an ESTC title string.
 *
 * A MARC 240 is a sequence of subfields flattened with ". " separators, and `$l`
 * is NOT necessarily last — `$k` (Selections), `$s` (Version) and `$f` (Date)
 * follow it routinely:
 *
 *   "De consolatione philosophiae. English"            $a … $l
 *   "Bible. Psalms. English. Sternhold and Hopkins."   $a $p $l $s   ← language mid-field
 *   "Bible. Old Testament. English. Authorised. Selections."         ← and again
 *
 * An end-anchored match drops every one of the second kind. Split into
 * components instead and find the language wherever it sits; everything before
 * it is the work's title, which is what the matcher joins on.
 *
 * The words must be a WHOLE component: "The English intelligencer" and "English
 * exercises for school-boys" are 245 display titles that merely contain the word,
 * and matching those would pour non-translations into the set.
 */
const LANG_COMPONENT = /^(English|English\s*(?:&|and)\s*[A-Za-z]+|[A-Za-z]+\s*(?:&|and)\s*English)$/i;

export function splitUniformTitle(title) {
  const parts = String(title || '').split('.').map((p) => p.trim()).filter(Boolean);
  const at = parts.findIndex((p) => LANG_COMPONENT.test(p));
  if (at <= 0) return null;                   // no language, or nothing before it
  return { uniform: parts.slice(0, at).join('. '), declared: parts[at] };
}

export function toReferenceRow(row) {
  const titles = row.search_titles ?? [];
  let uniform = '';
  let declared = '';
  for (const t of titles) {
    const m = splitUniformTitle(t);
    if (m) { uniform = m.uniform; declared = m.declared; break; }
  }
  const names = row.search_names ?? [];
  const translators = names.filter((n) => /translator/i.test(n));
  const authors = names.filter((n) => !/translator|printer|bookseller|publisher|engraver/i.test(n));

  return {
    // NO `lccn` KEY AT ALL — not `''`. `reference_translations` carries a
    // UNIQUE SPARSE index on `lccn`, and sparse skips only missing/null: an
    // empty string is a value, so 22,538 rows sharing `''` would collide on the
    // second upsert. The identifier here is `estc_id` (the ESTC S/R/T/N-number),
    // which is a citable access point in its own right.
    estc_id: row.id,
    author: authors[0] ?? '',
    added_entries: [...authors.slice(1), ...translators],
    uniform_title: uniform,
    title: titles.find((t) => !splitUniformTitle(t)) ?? titles[0] ?? '',
    subtitle: '',
    year: (row.dates ?? [])[0] ?? '',
    extent: '',
    publisher: '',
    // ESTC does not record the ORIGINAL language as a code. Leaving this empty is
    // correct and load-bearing: the language screen treats an unresolvable value
    // as UNKNOWN and keeps the candidate, rather than rejecting a real prior.
    original_languages: [],
    item_language: row.language ?? '',
    subjects: (row.subjects ?? []).slice(0, 8),
    translation_evidence: declared ? `uniform_title_lang:${declared}`
      : translators.length ? 'translator_relator' : '',
    source: 'estc',
    snapshot: SNAPSHOT,
  };
}

/** An ESTC row only enters the set if it declares itself an English translation. */
const isEnglishTranslation = (r) => Boolean(r.translation_evidence) && /eng/i.test(r.item_language || '');

// ── Main ─────────────────────────────────────────────────────────────────────

const IS_MAIN = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (IS_MAIN) {
  if (LOAD_ONLY) {
    // Load an artifact that already exists, without the ~15-minute partition
    // pass. The harvest is idempotent, but re-walking 427 prefixes to reach a
    // file sitting on disk is pure latency.
    const existing = fs.readdirSync(OUT_DIR).filter((f) => /^estc-translations\..*\.jsonl$/.test(f)).sort();
    if (!existing.length) throw new Error(`no estc-translations.*.jsonl in ${OUT_DIR} — run the harvest first`);
    await loadIntoMongo(path.join(OUT_DIR, existing[existing.length - 1]));
  } else {
    await main();
  }
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const total = (await search('*', 0, 1)).hits;
  console.log(`ESTC via CERL — ${total.toLocaleString()} records total\n`);

  const roots = ONLY_PREFIX ? [ONLY_PREFIX] : 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  console.log('Partitioning by id prefix (leaves must fit under the 10,000 paging cap)…');
  const leaves = [];
  for (const root of roots) {
    const n = await countOf(root);
    await sleep(DELAY_MS);
    if (!n) continue;
    const sub = await partition(root, n);
    leaves.push(...sub);
    console.log(`  id:${root}*  ${String(n).padStart(7)} → ${sub.length} leaf/leaves`);
  }

  const promised = leaves.reduce((s, l) => s + l.hits, 0);
  console.log(`\n${leaves.length} leaves, ${promised.toLocaleString()} records promised`);
  // Directional here too. SHORT of the total is an incomplete partition and is
  // fatal at any size. OVER the total is the live index having grown during the
  // ~15-minute partitioning pass — harmless, but say by how much, because a
  // silently-tolerated drift is how a real partition bug would hide.
  if (!ONLY_PREFIX && promised < total) {
    throw new Error(`partition covers ${promised} of ${total} — refusing to harvest an incomplete set`);
  }
  if (!ONLY_PREFIX && promised > total) {
    console.warn(`  ⚠ partition promises ${promised} vs a reported total of ${total} — index grew during partitioning (+${promised - total})`);
  }

  // ── RESUMABLE, per leaf ───────────────────────────────────────────────────
  //
  // The full harvest is ~4,875 requests at ~4.3s of SERVER latency each — about
  // six hours, and the wall time is CERL's, not the network's. A single-file
  // append that dies at hour five loses everything, which is the long-append-job
  // hazard CLAUDE.md warns about.
  //
  // So each leaf writes its own file and is skipped if already complete. A leaf
  // is only renamed into place after its row count is verified, so a half-written
  // leaf is never mistaken for a finished one — a partial file left behind by a
  // kill would otherwise read as "done" and silently shorten the set.
  const partsDir = path.join(OUT_DIR, 'leaves');
  fs.mkdirSync(partsDir, { recursive: true });

  // ONE definition of a leaf's filename, used by the writer AND the reader.
  //
  // These were built independently and drifted: the writer appended `.exact` for
  // an `exactOnly` leaf, the concatenator did not, and its `existsSync` turned
  // the mismatch into a silent skip. All 37 exact leaves were dropped from the
  // final file on the 2026-08-07 run — visible only because 2 of them happened
  // to carry English translations (`N4`, `T17`), so the artifact came out at
  // 22,536 rows against 22,538 collected. Same shape as the R2 key incident in
  // CLAUDE.md: two sites deriving one path, and nothing comparing them.
  const leafPathOf = (leaf) =>
    path.join(partsDir, `${leaf.prefix}${leaf.exactOnly ? '.exact' : ''}.jsonl`);

  let seen = 0, kept = 0, skipped = 0;
  const evidence = {};
  const started = Date.now();
  // How far the live index moved under the harvest. Tolerated, never swallowed:
  // reported at the end so a genuine partition bug cannot hide inside "drift".
  const drift = { leaves: 0, records: 0, dupes: 0 };

  for (const [i, leaf] of leaves.entries()) {
    const leafPath = leafPathOf(leaf);
    if (fs.existsSync(leafPath)) {
      // Re-tally the evidence breakdown from the resumed rows. Counting only
      // `kept` here made the printed breakdown cover fresh leaves ONLY: the
      // 2026-08-07 run reported 22,538 translations but 15,518 + 166 = 15,684
      // in the by-evidence lines, the 6,854 difference being exactly what the
      // 146 resumed leaves held. A total whose own parts do not sum to it
      // invites the reader to trust the wrong one.
      const lines = fs.readFileSync(leafPath, 'utf8').split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const k = String(JSON.parse(line).translation_evidence ?? '').split(':')[0];
          if (k) evidence[k] = (evidence[k] || 0) + 1;
        } catch { /* a malformed row would have failed its own leaf's rename */ }
      }
      kept += lines.length; seen += leaf.hits; skipped++;
      continue;
    }
    const tmp = `${leafPath}.partial`;
    const out = fs.createWriteStream(tmp);
    let leafKept = 0;
    await harvestLeaf(leaf, (raw) => {
      seen++;
      const row = toReferenceRow(raw);
      if (!isEnglishTranslation(row)) return;
      kept++; leafKept++;
      const k = row.translation_evidence.split(':')[0];
      evidence[k] = (evidence[k] || 0) + 1;
      out.write(JSON.stringify(row) + '\n');
    }, drift);
    await new Promise((r) => out.end(r));
    fs.renameSync(tmp, leafPath);   // atomic: only a verified leaf gets its name

    const pct = ((i + 1) / leaves.length * 100).toFixed(1);
    const rate = seen / ((Date.now() - started) / 1000);
    const eta = rate > 0 ? ((promised - seen) / rate / 60).toFixed(0) : '?';
    console.log(`  [${String(i + 1).padStart(4)}/${leaves.length}] ${pct}%  id:${leaf.prefix}* `
      + `${String(leaf.hits).padStart(6)} rows, kept ${leafKept}  |  total kept ${kept.toLocaleString()}  ETA ~${eta}m`);
  }
  if (skipped) console.log(`\n  (${skipped} leaf/leaves already on disk — resumed)`);
  if (drift.leaves || drift.dupes) {
    console.log(
      `\n  index drift: ${drift.leaves} leaf/leaves grew (+${drift.records} records), `
      + `${drift.dupes} duplicate id(s) collapsed across page boundaries.`,
    );
    console.log('  (a superset is safe — a SHORT leaf would have thrown)');
  }

  // Concatenate the verified leaves into the reference-set file.
  //
  // A missing leaf here is a BUG, not a condition to tolerate: every leaf in
  // `leaves` was either harvested and renamed into place this run, or found on
  // disk and skipped. `existsSync`-and-continue is what let the `.exact` path
  // mismatch drop 37 leaves without a word.
  const outPath = path.join(OUT_DIR, `estc-translations.${SNAPSHOT}.jsonl`);
  const final = fs.createWriteStream(outPath);
  let written = 0;
  for (const leaf of leaves) {
    const p = leafPathOf(leaf);
    if (!fs.existsSync(p)) {
      throw new Error(`leaf file missing at concatenation: ${p} — refusing to write a short reference set`);
    }
    const buf = fs.readFileSync(p);
    written += buf.toString('utf8').split('\n').filter(Boolean).length;
    final.write(buf);
  }
  await new Promise((r) => final.end(r));

  // Reconcile the ARTIFACT against the count, which the script never did on its
  // own output — the one place a silent shortfall would survive every upstream
  // guard and still reach the reference set.
  const onDisk = fs.readFileSync(outPath, 'utf8').split('\n').filter(Boolean).length;
  if (onDisk !== kept || written !== kept) {
    throw new Error(
      `reference set does not reconcile: ${onDisk} rows on disk, ${written} concatenated, ${kept} counted`,
    );
  }

  console.log(`\n\n─── ESTC reference set ───────────────────────────────────────`);
  console.log(`  records examined        : ${seen.toLocaleString()}`);
  console.log(`  English translations    : ${kept.toLocaleString()}`);
  for (const [k, v] of Object.entries(evidence)) console.log(`    via ${k.padEnd(20)} ${v.toLocaleString()}`);
  console.log(`\n  BOUNDARY: ESTC covers imprints 1473-1800 only. A translation`);
  console.log(`  published after 1800 is absent by construction, not by evidence.`);
  console.log(`\nWrote ${outPath}`);

  if (LOAD) await loadIntoMongo(outPath);
}

/**
 * Upsert the harvested rows into Mongo `reference_translations`.
 *
 * KEYED ON `estc_id`, NOT `lccn`. The LoC loader's key is the LCCN and its
 * fallback is `nolccn:${title}:${year}` — which for ESTC would collide any two
 * records sharing a title and year, of which a short-title catalogue of the hand
 * press era has many. `estc_id` is present on 100% of rows and unique by
 * construction (the id-prefix partition's arithmetic depends on it).
 *
 * `noTimeout` is REQUIRED, not tuning: `withMongo` kills the process after 300s,
 * and a watchdog firing mid-load exits 0 having written a PREFIX of the set. A
 * short reference set does not error — it fails to find priors, which reads as
 * `none_found`, which reads as "first translation". That exact failure left
 * 120,976 of 126,558 LoC rows loaded on 2026-08-04 while the log looked clean.
 */
async function loadIntoMongo(outPath) {
  if (!fs.existsSync(outPath)) {
    throw new Error(`nothing to load: ${outPath} does not exist — run the harvest first`);
  }
  const expected = fs.readFileSync(outPath, 'utf8').split('\n').filter(Boolean).length;
  console.log(`\nLoading ${expected.toLocaleString()} rows into Mongo \`reference_translations\`…`);

  await withMongo(async (db) => {
    const coll = db.collection('reference_translations');
    await coll.createIndex({ estc_id: 1 }, { unique: true, sparse: true });

    const before = await coll.countDocuments({ source: 'estc' });
    let batch = [];
    let loaded = 0;
    const flush = async () => {
      if (!batch.length) return;
      await coll.bulkWrite(batch, { ordered: false });
      loaded += batch.length;
      batch = [];
    };
    const rl = readline.createInterface({ input: fs.createReadStream(outPath), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.trim()) continue;
      const row = JSON.parse(line);
      if (!row.estc_id) throw new Error(`row without estc_id — refusing to load an unidentifiable record: ${line.slice(0, 120)}`);
      // Belt and braces against the sparse-unique `lccn` index: an older
      // artifact may still carry `lccn: ''`, which would collide across every
      // ESTC row. Absent means absent.
      if (!row.lccn) delete row.lccn;
      batch.push({ updateOne: { filter: { estc_id: row.estc_id }, update: { $set: row }, upsert: true } });
      if (batch.length >= 1000) await flush();
    }
    await flush();

    // Reconcile against the DESTINATION, not the log — the same rule the
    // concatenator now follows. A partial load is invisible from its own output.
    const after = await coll.countDocuments({ source: 'estc' });
    console.log(`  upserted ${loaded.toLocaleString()} · source:'estc' rows ${before.toLocaleString()} → ${after.toLocaleString()}`);
    if (after !== expected) {
      throw new Error(
        `load does not reconcile: ${after} rows with source:'estc' in Mongo vs ${expected} in the artifact`,
      );
    }
    console.log(`  ✓ reconciled: ${after.toLocaleString()} rows`);
  }, { noTimeout: true });
}
