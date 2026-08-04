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
import { fileURLToPath } from 'url';

const argOf = (f) => { const i = process.argv.indexOf(f); return i === -1 ? null : process.argv[i + 1]; };
const OUT_DIR = argOf('--out') ?? path.join(process.cwd(), 'scripts', 'output', 'estc');
const ONLY_PREFIX = argOf('--prefix');
const DELAY_MS = parseInt(argOf('--delay') ?? '400', 10);

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
  for (const ch of CHARS) {
    const n = await countOf(prefix + ch);
    await sleep(DELAY_MS);
    if (!n) continue;
    childSum += n;
    leaves.push(...await partition(prefix + ch, n, depth + 1));
  }
  // Arithmetic, not trust: an id belongs to exactly one child, so the children
  // must account for the parent exactly. Anything else means the wildcard is not
  // behaving as a prefix and the partition cannot be called complete.
  if (childSum !== hits) {
    throw new Error(`partition of ${prefix}* is lossy: children sum ${childSum} vs parent ${hits}`);
  }
  return leaves;
}

/** Page one leaf completely, asserting we received what it promised. */
async function harvestLeaf(leaf, sink) {
  let got = 0;
  for (let from = 0; from < leaf.hits; from += PAGE) {
    if (from >= FROM_CAP) throw new Error(`leaf ${leaf.prefix}* exceeds the ${FROM_CAP} cap — partition bug`);
    const { rows } = await search(`id:${leaf.prefix}*`, from, PAGE);
    if (!rows.length) throw new Error(`leaf ${leaf.prefix}* returned 0 rows at from=${from} of ${leaf.hits}`);
    for (const row of rows) sink(row);
    got += rows.length;
    await sleep(DELAY_MS);
  }
  if (got !== leaf.hits) {
    throw new Error(`leaf ${leaf.prefix}*: collected ${got} but it reported ${leaf.hits}`);
  }
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
    lccn: '',                                   // ESTC has none; the id is the identifier
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
if (IS_MAIN) await main();

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
  if (!ONLY_PREFIX && Math.abs(promised - total) > 1) {
    throw new Error(`partition covers ${promised} of ${total} — refusing to harvest an incomplete set`);
  }

  const outPath = path.join(OUT_DIR, `estc-translations.${SNAPSHOT}.jsonl`);
  const out = fs.createWriteStream(outPath);
  let seen = 0, kept = 0;
  const evidence = {};
  for (const leaf of leaves) {
    await harvestLeaf(leaf, (raw) => {
      seen++;
      const row = toReferenceRow(raw);
      if (!isEnglishTranslation(row)) return;
      kept++;
      evidence[row.translation_evidence.split(':')[0]] = (evidence[row.translation_evidence.split(':')[0]] || 0) + 1;
      out.write(JSON.stringify(row) + '\n');
    });
    process.stdout.write(`\r  harvested ${seen.toLocaleString()}/${promised.toLocaleString()}  kept ${kept.toLocaleString()}   `);
  }
  await new Promise((r) => out.end(r));

  console.log(`\n\n─── ESTC reference set ───────────────────────────────────────`);
  console.log(`  records examined        : ${seen.toLocaleString()}`);
  console.log(`  English translations    : ${kept.toLocaleString()}`);
  for (const [k, v] of Object.entries(evidence)) console.log(`    via ${k.padEnd(20)} ${v.toLocaleString()}`);
  console.log(`\n  BOUNDARY: ESTC covers imprints 1473-1800 only. A translation`);
  console.log(`  published after 1800 is absent by construction, not by evidence.`);
  console.log(`\nWrote ${outPath}`);
}
