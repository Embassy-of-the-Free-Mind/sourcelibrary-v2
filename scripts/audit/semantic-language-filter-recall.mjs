#!/usr/bin/env node
/**
 * Does a language filter on semantic page search actually PRE-filter? (#4439)
 *
 * This pins a MECHANISM, not an output. The bug it exists to catch is not "a
 * query returned nothing" — it is "the language predicate is applied to
 * candidates an HNSW index has already chosen, so a filter's recall tracks that
 * language's share of the table rather than the query." Under that failure the
 * dominant language keeps working perfectly, which is why the defect survived a
 * fix, a comment claiming the fix, and three months of use.
 *
 * The assertion is therefore deliberately awkward: for a query whose UNFILTERED
 * top hits are all Western, filtering to a NON-DOMINANT language must still
 * return rows. A test that only exercises Latin (36% of the table) passes
 * against the broken function.
 *
 * There is also a positive control on the instrument itself, because "0 rows"
 * from a filter and "0 rows" from a query nothing matches are the same shape:
 *   - the unfiltered arm must return rows (the query works at all), and
 *   - the target language must have rows in the corpus at all (checked against
 *     the table, not inferred from the search returning nothing).
 * If either control fails the run reports UNKNOWN and exits 2. An audit that
 * cannot tell "broken" from "nothing there" is not measuring anything.
 *
 * Read-only. Runs one Gemini embedding call per probe query (~$0.000002 each).
 *
 *   node --env-file=.env.production.local scripts/audit/semantic-language-filter-recall.mjs
 *   node --env-file=.env.production.local scripts/audit/semantic-language-filter-recall.mjs --rpc=match_semantic_prefilter_v2
 *   node --env-file=.env.production.local scripts/audit/semantic-language-filter-recall.mjs --sweep
 *   node --env-file=.env.production.local scripts/audit/semantic-language-filter-recall.mjs --dump-defs   # needs SUPABASE_DB_URL
 *
 * Exit codes: 0 pass, 1 fail (the defect is present), 2 unknown (a control failed).
 */
import { createClient } from '@supabase/supabase-js';

const args = process.argv.slice(2);
const val = (f) => { const m = args.find((a) => a.startsWith(`${f}=`)); return m ? m.slice(f.length + 1) : undefined; };
const RPC = val('--rpc') || 'match_semantic';
const SWEEP = args.includes('--sweep');
const DUMP_DEFS = args.includes('--dump-defs');
const LIMIT = parseInt(val('--limit') || '15', 10);

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GEMINI_KEY = process.env.GEMINI_API_KEY;

/**
 * Probes. Each pairs a query whose global nearest neighbours are Western with a
 * language whose corpus demonstrably covers that subject — so an empty result is
 * a retrieval failure, not an honest absence.
 *
 * `evidence` is the human reason we expect the corpus to answer; it goes in the
 * report so a future reader can re-judge the probe rather than trust it.
 */
const PROBES = [
  {
    query: 'the stone that draws iron, the south-pointing needle, magnetic attraction',
    language: 'Chinese',
    evidence: 'Shen Kuo describes the compass needle; the Bencao Gangmu treats loadstone as materia medica. Verified reachable at similarity 0.704 by scanning past the HNSW candidate set (#4439).',
  },
  {
    query: 'pitch pipes, bells and the tuning of musical tones',
    language: 'Chinese',
    evidence: 'Zhu Zaiyu on equal temperament; the lülü pitch-pipe literature is a core Chinese subject.',
  },
  {
    query: 'distillation of spirits, the alembic and the calcination of metals',
    language: 'Arabic',
    evidence: 'The apparatus is Arabic by descent — "alembic" is al-anbīq — and Jabir and al-Razi are the tradition the Latin alchemists were reading in translation.',
  },
  {
    query: 'grammar, the roots of words and the rules that generate speech',
    language: 'Sanskrit',
    evidence: 'Panini\'s Ashtadhyayi and its commentary literature are the densest grammatical corpus in any language we hold; Sanskrit is 3.2% of the table.',
  },
];

/**
 * Probes deliberately NOT used, and why — a rejected probe is as informative as
 * a kept one, and re-deriving this costs a Gemini call each time:
 *   "breath, the subtle body and the channels of vital force" / Sanskrit — the
 *     unfiltered top hits are already Sanskrit/Tibetan, so the filter has
 *     nothing to prove and the probe passes against the broken function.
 *   "the physician examines the pulse and prescribes a compound remedy" /
 *     Arabic — unfiltered hits include Chinese and Tibetan, so the candidate
 *     set is not Western-dominated; it returned 1 row of a requested 15, which
 *     is candidate exhaustion showing through rather than a clean failure.
 */

function fail(msg) { console.error(`\n  ERROR  ${msg}`); process.exit(2); }

if (!SUPABASE_URL || !SUPABASE_KEY) fail('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set.');
if (!GEMINI_KEY && !DUMP_DEFS) fail('GEMINI_API_KEY not set — the probe needs a query embedding.');

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

async function embed(query) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2-preview:batchEmbedContents?key=${GEMINI_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [{
          model: 'models/gemini-embedding-2-preview',
          content: { parts: [{ text: query }] },
          outputDimensionality: 768,
        }],
      }),
    },
  );
  if (!res.ok) fail(`Gemini embedding failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const v = data?.embeddings?.[0]?.values;
  if (!Array.isArray(v)) fail('Gemini returned no embedding.');
  return v;
}

async function search(emb, { languages = null } = {}) {
  const t0 = Date.now();
  const { data, error } = await sb.rpc(RPC, {
    query_embedding: JSON.stringify(emb),
    match_threshold: 0.3,
    match_count: LIMIT,
    filter_tenant_id: null,
    filter_language: null,
    filter_year_min: null,
    filter_year_max: null,
    filter_languages: languages,
    filter_exclude_languages: null,
  });
  if (error) fail(`${RPC} failed: ${error.message}`);
  return { rows: data || [], ms: Date.now() - t0 };
}

/**
 * Control: does the corpus hold embedded rows in this language at all? Asked of
 * the TABLE, never inferred from the search — that inference is the bug.
 */
async function corpusRows(language) {
  const { count, error } = await sb
    .from('page_translations')
    .select('page_id', { count: 'exact', head: true })
    .eq('book_language', language)
    .not('embedding', 'is', null);
  if (error) fail(`corpus control query failed: ${error.message}`);
  return count ?? 0;
}

// ── --dump-defs: what is ACTUALLY deployed ───────────────────────────────────
// A committed migration is not evidence of production. Requires a direct
// Postgres connection (SUPABASE_DB_URL); PostgREST cannot read pg_catalog.
if (DUMP_DEFS) {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) fail('--dump-defs needs SUPABASE_DB_URL (a direct Postgres connection). PostgREST cannot read pg_get_functiondef.');
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();
  const { rows: ext } = await client.query(`SELECT extversion FROM pg_extension WHERE extname = 'vector'`);
  console.log(`pgvector: ${ext[0]?.extversion ?? '(not installed)'}\n`);
  const { rows } = await client.query(
    `SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS sig, pg_get_functiondef(p.oid) AS def
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN ('match_semantic','match_page_texts','match_books_semantic',
                          'match_semantic_prefilter_v2','match_page_texts_prefilter_v2',
                          'match_books_semantic_prefilter_v2')
      ORDER BY p.proname`,
  );
  for (const r of rows) console.log(`── ${r.proname}(${r.sig})\n${r.def}\n`);
  await client.end();
  process.exit(0);
}

// ── The audit ────────────────────────────────────────────────────────────────

console.log(`# Semantic language-filter recall (#4439)\n`);
console.log(`RPC under test: **${RPC}**   match_count: ${LIMIT}\n`);

let failures = 0;
let unknown = 0;
const probes = SWEEP ? PROBES : PROBES.slice(0, 2);

for (const probe of probes) {
  const emb = await embed(probe.query);

  const base = await search(emb, {});
  const filtered = await search(emb, { languages: [probe.language] });
  const inCorpus = await corpusRows(probe.language);

  const baseLangs = [...new Set(base.rows.map((r) => r.book_language))];
  const baseIsWestern = baseLangs.every((l) => l !== probe.language);

  console.log(`## ${probe.query}`);
  console.log(`- target language: **${probe.language}** (${inCorpus.toLocaleString()} embedded rows in corpus)`);
  console.log(`- unfiltered: ${base.rows.length} rows in ${base.ms}ms — languages: ${baseLangs.join(', ') || '(none)'}`);
  console.log(`- filtered to ${probe.language}: **${filtered.rows.length} rows** in ${filtered.ms}ms`);
  if (filtered.rows.length) {
    const top = filtered.rows[0];
    console.log(`  - top hit: ${Number(top.similarity).toFixed(4)} — ${top.book_title} (p.${top.page_number})`);
  }
  console.log(`- why this language should answer: ${probe.evidence}`);

  // Controls first — an assertion on an instrument that did not fire is noise.
  if (base.rows.length === 0) {
    console.log(`\n  **UNKNOWN** — the unfiltered arm returned nothing, so this probe cannot`);
    console.log(`  distinguish a filter defect from a dead search path.\n`);
    unknown++;
    continue;
  }
  if (inCorpus === 0) {
    console.log(`\n  **UNKNOWN** — the corpus holds no embedded ${probe.language} rows, so an`);
    console.log(`  empty filtered result is honest, not a defect.\n`);
    unknown++;
    continue;
  }
  if (!baseIsWestern) {
    console.log(`\n  **UNKNOWN** — ${probe.language} already appears in the unfiltered top hits,`);
    console.log(`  so this probe no longer discriminates. Pick a query whose global`);
    console.log(`  neighbours are elsewhere.\n`);
    unknown++;
    continue;
  }

  if (filtered.rows.length === 0) {
    console.log(`\n  **FAIL** — ${inCorpus.toLocaleString()} embedded ${probe.language} rows exist and the`);
    console.log(`  filter reached none of them, while the same query unfiltered returned`);
    console.log(`  ${base.rows.length}. The predicate is being applied after ranking, not before.\n`);
    failures++;
  } else {
    console.log(`\n  **PASS** — the filter reached ${probe.language} material on a query whose`);
    console.log(`  global neighbours are ${baseLangs.join('/')}.\n`);
  }
}

console.log(`---\n`);
if (failures > 0) {
  console.log(`**${failures} of ${probes.length} probes FAILED.** Language filtering on \`${RPC}\` is a`);
  console.log(`post-filter over ranked candidates. See scripts/migration/fix-semantic-language-prefilter.sql.`);
  process.exit(1);
}
if (unknown > 0) {
  console.log(`**${unknown} of ${probes.length} probes returned UNKNOWN** — a control failed, so this run`);
  console.log(`measured nothing. Do not read it as a pass.`);
  process.exit(2);
}
console.log(`**PASS** — every probe reached its non-dominant language.`);
