#!/usr/bin/env node
/**
 * ingest-wikidata-translations.mjs — a SECOND reference-set source. (#3459)
 *
 * WHY A SECOND SOURCE AT ALL
 * --------------------------
 * The asymmetry that governs this whole area: presence in one catalogue proves a
 * translation exists; absence from one proves nothing. Our dangerous claim is the
 * negative one, so it needs breadth that a single catalogue cannot provide.
 * Wikidata is free, has no rate limit worth worrying about at this scale, and is
 * independently curated from LoC — so a hit here is genuine corroboration.
 *
 * WHAT IT DOES *NOT* FIX — measured 2026-07-30, before building
 * -------------------------------------------------------------
 * Wikidata was proposed (by me) as the fix for the CJK and Tibetan gaps that LoC
 * structurally cannot answer. It is not. Counting English editions linked by
 * `P629` (edition or translation of) to a work in each language:
 *
 *     Tibetan            0        (119 Tibetan works exist in Wikidata)
 *     Classical Chinese  0        (0 works carry that language tag)
 *     Syriac             0
 *     Sanskrit          29        (against 4,493 Sanskrit works)
 *     Chinese           48
 *     Japanese         974
 *
 * The translations exist in the world; nobody has modelled them in Wikidata. The
 * `edition or translation of` relation is essentially unpopulated outside Western
 * literature. So this source adds real depth for Ancient Greek (1,490), Japanese
 * (974) and Latin (728), and nothing at all where we most need it.
 *
 * The honest structural conclusion is that there is no single reference set. Each
 * tradition needs its own — 84000 and BDRC for Tibetan, CBETA/ctext for Chinese,
 * GRETIL for Sanskrit — and the traditions we have been most confident about are
 * the ones with the least available. That is a finding about our claims, not just
 * about our tooling.
 *
 * SHAPE NOTE: Welsh is 4,037 of the 13,453 rows (30%), from a bulk import. It is
 * irrelevant to this corpus but harmless — it simply never matches.
 *
 * Usage:
 *   node scripts/enrichment/ingest-wikidata-translations.mjs --out <dir>
 */
import fs from 'fs';
import path from 'path';

const argOf = (f) => { const i = process.argv.indexOf(f); return i === -1 ? null : process.argv[i + 1]; };
const OUT_DIR = argOf('--out') ?? path.join(process.cwd(), 'scripts', 'output', 'wikidata');
const SNAPSHOT = new Date().toISOString().slice(0, 10);

const ENDPOINT = 'https://query.wikidata.org/sparql';
const UA = 'SourceLibrary/1.0 (https://sourcelibrary.org; reference-set build)';

/**
 * Native-script labels are the point of including Wikidata at all: they are the
 * one place a work carries its title in its own script alongside an English
 * edition link. Request them explicitly rather than relying on the label service,
 * which only serves one language at a time.
 */
const NATIVE_LANGS = ['zh', 'ja', 'ko', 'bo', 'sa', 'ar', 'he', 'fa', 'hy', 'syc', 'grc', 'el', 'ta'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * WDQS returns a transient 502/429 under load often enough that a single-attempt
 * fetch silently drops whole languages: the first run lost 9 of them, including
 * Italian and Armenian, and reported a slice that looked complete apart from a
 * warning. Retry with backoff, and let the caller record anything that still
 * fails so an incomplete slice is never mistaken for a thin one.
 */
async function sparql(query, attempts = 4) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(`${ENDPOINT}?query=${encodeURIComponent(query)}`, {
        headers: { Accept: 'application/sparql-results+json', 'User-Agent': UA },
        signal: AbortSignal.timeout(180_000),
      });
      if (res.status === 429 || res.status >= 500) throw new Error(`SPARQL ${res.status} ${res.statusText}`);
      if (!res.ok) throw new Error(`SPARQL ${res.status} ${res.statusText}`);
      return (await res.json()).results.bindings;
    } catch (err) {
      lastErr = err;
      if (i < attempts) await sleep(2000 * i * i);
    }
  }
  throw lastErr;
}

const qid = (uri) => (uri || '').split('/').pop();

/**
 * Chunked by original language. A single query for all 13,453 rows with optional
 * author/translator/date joins reliably exceeds the 60s WDQS timeout; per-language
 * it comfortably fits, and a failure costs one language rather than the run.
 */
async function fetchLanguageIndex() {
  const rows = await sparql(`
    SELECT ?ol ?olLabel (COUNT(*) AS ?n) WHERE {
      ?ed wdt:P629 ?w . ?ed wdt:P407 wd:Q1860 .
      ?w wdt:P407 ?ol . FILTER(?ol != wd:Q1860)
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en" }
    } GROUP BY ?ol ?olLabel ORDER BY DESC(?n)`);
  return rows.map((r) => ({
    qid: qid(r.ol.value),
    label: r.olLabel?.value ?? '',
    count: parseInt(r.n.value, 10),
  }));
}

async function fetchForLanguage(langQid) {
  const nativeOptionals = NATIVE_LANGS
    .map((l) => `OPTIONAL { ?w rdfs:label ?nat_${l.replace('-', '_')} . FILTER(LANG(?nat_${l.replace('-', '_')}) = "${l}") }`)
    .join('\n      ');

  const rows = await sparql(`
    SELECT ?ed ?edLabel ?w ?wLabel ?date ?authorLabel ?translatorLabel
           ${NATIVE_LANGS.map((l) => `?nat_${l.replace('-', '_')}`).join(' ')} WHERE {
      ?ed wdt:P629 ?w .
      ?ed wdt:P407 wd:Q1860 .
      ?w  wdt:P407 wd:${langQid} .
      OPTIONAL { ?ed wdt:P577 ?date }
      OPTIONAL { ?w  wdt:P50  ?author }
      OPTIONAL { ?ed wdt:P655 ?translator }
      ${nativeOptionals}
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en" }
    }`);

  return rows.map((r) => {
    const native = {};
    for (const l of NATIVE_LANGS) {
      const v = r[`nat_${l.replace('-', '_')}`]?.value;
      if (v) native[l] = v;
    }
    const year = r.date?.value ? (r.date.value.match(/(-?\d{4})/) || [])[1] : '';
    return {
      // Mirrors the LoC row shape so both sources feed one matcher.
      lccn: '',                                  // Wikidata rows carry no LCCN
      wikidata_edition: qid(r.ed.value),
      wikidata_work: qid(r.w.value),
      author: r.authorLabel?.value ?? '',
      added_entries: r.translatorLabel?.value ? [r.translatorLabel.value] : [],
      uniform_title: r.wLabel?.value ?? '',      // the WORK's title = the join key
      title: r.edLabel?.value ?? '',             // the English edition's title
      subtitle: '',
      year: year || '',
      extent: '',
      publisher: '',
      original_languages: [],                    // filled by the caller
      item_language: 'eng',
      subjects: [],
      // Native-script titles — the reason this source is worth having.
      vernacular_uniform_title: native.zh || native.ja || native.ko || native.bo
        || native.sa || native.ar || native.he || native.grc || native.el || '',
      native_labels: native,
      source: 'wikidata',
      snapshot: SNAPSHOT,
    };
  });
}

// ── Main ─────────────────────────────────────────────────────────────────────

fs.mkdirSync(OUT_DIR, { recursive: true });
console.log(`Wikidata — English editions of non-English works (snapshot ${SNAPSHOT})\n`);

const langs = await fetchLanguageIndex();
const total = langs.reduce((n, l) => n + l.count, 0);
console.log(`${langs.length} source languages, ${total.toLocaleString()} edition links\n`);

const out = fs.createWriteStream(path.join(OUT_DIR, `wikidata-translations.${SNAPSHOT}.jsonl`));
const failed = [];
let written = 0;
let withNative = 0;

for (const lang of langs) {
  if (lang.count < 3) continue; // long tail of singletons is not worth a request
  process.stdout.write(`  ${String(lang.label || lang.qid).padEnd(22)} ${String(lang.count).padStart(5)} …`);
  try {
    const rows = await fetchForLanguage(lang.qid);
    for (const row of rows) {
      row.original_languages = [lang.qid];
      row.original_language_label = lang.label;
      if (row.vernacular_uniform_title) withNative++;
      out.write(`${JSON.stringify(row)}\n`);
      written++;
    }
    console.log(` ${rows.length} rows`);
  } catch (err) {
    failed.push({ lang: lang.label, error: err.message });
    console.log(` FAILED — ${err.message}`);
  }
}
await new Promise((r) => out.end(r));

console.log('\n─── Wikidata reference-set slice ─────────────────────────────');
console.log('  rows written           :', written.toLocaleString());
console.log('  with a native-script title:', withNative.toLocaleString(),
  written ? `(${((withNative / written) * 100).toFixed(1)}%)` : '');
console.log('  languages fetched      :', langs.filter((l) => l.count >= 3).length - failed.length);
if (failed.length) {
  console.log(`\n  ⚠️  ${failed.length} language(s) FAILED — this slice is incomplete:`);
  for (const f of failed) console.log(`      ${f.lang}: ${f.error}`);
}
console.log('\n  KNOWN SHAPE: Welsh is ~30% of all rows (a bulk import) and simply never');
console.log('  matches this corpus. Tibetan, Classical Chinese and Syriac return ZERO —');
console.log('  the edition-of relation is unpopulated outside Western literature, so this');
console.log('  source does NOT close the gaps LoC leaves. It adds depth for Ancient Greek,');
console.log('  Japanese and Latin, and corroboration breadth everywhere.');
console.log(`\nWrote ${path.join(OUT_DIR, `wikidata-translations.${SNAPSHOT}.jsonl`)}`);
