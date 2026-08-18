#!/usr/bin/env node
/**
 * Field sprawl: how many fields does a collection carry, and how many are dead?
 *
 * THE PATTERN
 *   Every sweep here has written a new FIELD on `books` instead of a new ROW in
 *   a log collection. Measured 2026-08-13: `books` carries 403 top-level fields
 *   plus ~176 nested sub-keys; only 17 are present on >=99% of documents, while
 *   144 sit on fewer than 1% — one sweep's residue each. `books_warehouse`, the
 *   newest of the three book collections, carries 129 fields with 25 core. The
 *   difference is accretion, not necessary complexity.
 *
 * WHY IT MATTERS — this is a correctness problem, not a tidiness one
 *   A query against a field that exists but is 2%-populated returns a confident,
 *   well-formed, WRONG answer. It does not error and it does not return null; it
 *   returns a small clean number that reads like a finding. Concrete instances:
 *
 *     hidden_reason (23,483) vs hide_reason (500)
 *         a takedown sweep reading the wrong one touches 2% of the corpus (#3099)
 *     image_resolution_upgrade_source (1,986) vs image_upgrade_source (384)
 *         vs upgrade_source (290) — three answers to "where did this image
 *         come from", none complete
 *     first_translation_attempts.prior_relationship — 0 of 69,839 rows, while
 *         the invariant doc names it as the field that decides whether a prior
 *         defeats a first-translation claim. The judgement was written as prose
 *         in `notes` instead, and an adjudicator reading the structured fields
 *         got 2 of 4 spot-checked books wrong, both toward removing a correct
 *         public badge.
 *
 *   So: near-duplicate field names ranked by fill-rate gap are the highest-value
 *   output here, not the raw field count.
 *
 * WHAT IT REPORTS
 *   1. Field census per collection — count, fill-rate histogram, core set.
 *   2. The <1% tail, which is the list of sweeps that became columns.
 *   3. Near-duplicate name pairs (edit-distance + token-subset), ranked by the
 *      ratio between their fill rates. A big gap means one is a trap.
 *   4. Concept families declared in FAMILIES below — one concept, N fields.
 *   5. Nested sub-key sprawl for object-valued fields.
 *
 * READ-ONLY — it never writes. Exits non-zero if a threshold is breached, so it
 * can gate CI or run as a standing cron.
 *
 * PREVENTION — why this script also emits a validator
 *   Detection after the fact is the weak half. The strong half is a MongoDB
 *   `$jsonSchema` validator with `additionalProperties: false`: it blesses the
 *   fields that exist today and REJECTS the next new one, at the database,
 *   where no script can route around it. Measured 2026-08-13: zero of the 155
 *   collections here carry a validator, and the application credential holds
 *   `readWriteAnyDatabase` — which does NOT include `collMod`. That is the
 *   point. The 543 scripts that write to `books` can neither add a field past
 *   the validator nor remove the validator; installing it takes a dbAdmin
 *   credential used once, by hand.
 *
 *   `--emit-validator` writes that schema. It runs a FULL field enumeration,
 *   never a sample: a field on three documents can be missed by a 3,000-doc
 *   sample, and a validator generated from a sample would reject writes to a
 *   legitimate existing field. Same class of bug this script exists to find.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/audit/field-sprawl.mjs
 *   node --env-file=.env.production.local scripts/audit/field-sprawl.mjs --collection books
 *   node --env-file=.env.production.local scripts/audit/field-sprawl.mjs --all
 *   node --env-file=.env.production.local scripts/audit/field-sprawl.mjs --json out.json
 *   node --env-file=.env.production.local scripts/audit/field-sprawl.mjs --max-fields 420
 *   node --env-file=.env.production.local scripts/audit/field-sprawl.mjs \
 *       --collection books --emit-validator books-validator.json
 */
import fs from 'fs';
import { MongoClient } from 'mongodb';

const argv = process.argv.slice(2);
const argVal = (flag) => {
  const i = argv.indexOf(flag);
  return i > -1 ? argv[i + 1] : null;
};
const JSON_OUT = argVal('--json');
const EMIT_VALIDATOR = argVal('--emit-validator');
const ONE = argVal('--collection');
const ALL = argv.includes('--all');
const SAMPLE = Number(argVal('--sample') || 3000);
// Fail the run if a watched collection exceeds this many top-level fields.
// Set from the 2026-08-13 baseline (books = 403) so the number can only be
// ratcheted DOWN deliberately, never drift up unnoticed.
const MAX_FIELDS = Number(argVal('--max-fields') || 410);

// Ceiling on sub-keys inside a single object-valued field. The validator's
// additionalProperties:false only binds the top level, so a free-form object
// is the unguarded floor below it. 0 disables. Baseline 2026-08-14: the worst
// is books.metadata at 60, so 65 leaves headroom and still catches growth.
// NOTE: nestedCensus samples 1500 docs, so these counts JITTER a few either
// way between runs (field_provenance read 37 then 39 minutes apart). Leave
// several sub-keys of slack when ratcheting or the gate flakes on sampling
// noise rather than on real drift.
const MAX_NESTED = Number(argVal('--max-nested') || 0);

// Retired fields: consolidated away and never allowed back. A reappearance
// means some writer re-grew a field a consolidation removed (this happened to
// tenant_id within 3 months of PR #2085) — fail loudly. Comma-separated.
const FORBID = (argVal('--forbid') || '').split(',').map((s) => s.trim()).filter(Boolean);

// Collections worth watching by default. Everything else needs --all.
const WATCHED = ['books', 'deleted_books', 'books_warehouse', 'pages', 'first_translation_attempts', 'entities'];

// Object-valued fields whose sub-keys sprawl independently of the top level.
const NESTED = {
  books: ['translation_verification', 'first_translation', 'enrichment', 'metadata', 'field_provenance'],
};

/**
 * Declared concept families: one idea, many fields. Add a family when you find
 * one — the point is that the list is visible and shrinking, not that it is
 * complete. Ordered by blast radius: reading the wrong field in the first two
 * silently mis-serves readers.
 */
const FAMILIES = {
  books: {
    'visibility / deletion / archiving': ['hidden_reason', 'hide_reason', 'hidden_at', 'unhidden_at', 'unhidden_reason', 'archived_at', 'archive_reason', 'archived_reason', 'deleted_reason', 'deletion_reason', 'deletion_batch', 'restored_by', 'restored_at'],
    'image upgrade / repair': ['low_res', 'upgrade_available', 'image_resolution_upgraded_at', 'image_resolution_upgrade_source', 'image_upgraded', 'image_upgraded_at', 'image_upgrade_source', 'image_upgrade_reverted', 'upgrade_date', 'upgrade_source', 'upgrade_file', 'upgrade_resolution', 'image_repaired_at', 'image_repair_issue', 'image_repair_source'],
    language: ['language', 'original_language', 'language_source', 'language_confidence', 'language_review', 'language_review_detail', 'ai_detected_language', 'language_raw', '_language_backfill', 'language_relabeled_from', 'language_detected', 'language_corrected', 'language_relabel', 'language_correction', 'language_verified_content', 'language_corrected_at', 'language_corrected_by', 'script_type'],
    'first translation': ['is_first_translation', 'translation_verification', 'first_translation', 'translation_census', 'prior_translation', 'is_translation', 'first_translation_assessed_at', 'first_translation_reasoning', 'first_translation_assessment', 'translation_stale_reason', 'translation_audit_2026_06', 'translator_author_screen', 'ft_prediction', 'translation_status'],
    'external identifiers (per-provider)': ['bsb_id', 'mdz_id', 'erara_id', 'erara_doi', 'wikidata_id', 'etcsl_id', 'cdli_witnesses', 'gallica_ark', 'google_books_id', 'bodleian_uuid', 'met_object_id', 'doi', 'vatican_mss_id', 'cambridge_id', 'loc_lccn', 'berlpap_url_id', 'rijksmuseum_id', 'micrio_id', 'morgan_bibid', 'oraec_id', 'wellcome_id', 'wellcome_b_number'],
    'external identifiers (generic containers that never replaced them)': ['catalog_refs', 'catalog_ids', 'shelfmark', 'external_id', 'external_source', 'accession_number', 'inventory_number', 'catalog_numbers', 'external_url', 'original_id'],
    // Undeclared until 2026-08-18, and invisible to the near-duplicate pass
    // because these names are not spelling variants of each other. The pairwise
    // name heuristic cannot see a family whose members were named independently
    // — declare those here or they never surface. Values DISAGREE across these
    // fields (2,533 books hold two or more place fields; 539 name different
    // cities), so this family needs adjudication, not just a merge:
    // scripts/audit/imprint-reconciliation.mjs measures it. See #4043.
    'imprint / publication': ['publication_place', 'place_of_publication', 'place_published', 'place', 'printer', 'publisher', 'format'],
  },
};

/** Levenshtein, capped — we only care about distances of 1-3. */
function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > 3) return 99;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

const tokens = (s) => s.replace(/^_/, '').split('_').filter(Boolean);
const isSubset = (a, b) => a.every((t) => b.includes(t));

/**
 * Generic tokens that appear as a suffix on dozens of unrelated fields. A pair
 * that overlaps ONLY on these is not a near-duplicate — `id` vs `met_object_id`
 * and `source` vs `image_repair_source` are different concepts that happen to
 * share a noun. Without this stoplist the report is ~170 rows of noise and the
 * three real pairs are invisible.
 */
const GENERIC_TOKENS = new Set(['id', 'source', 'status', 'title', 'at', 'date', 'reason', 'url', 'ref', 'refs', 'name', 'type', 'key', 'count', 'note', 'notes', 'by']);

/**
 * Suffixes that mark a field's ROLE rather than its concept. `restored_at` and
 * `restored_by` are one edit apart and are simply the timestamp and the actor
 * for the same event — not a spelling collision. Same for promoted_at /
 * promoted_to and hidden_at / unhidden_at.
 */
const ROLE_SUFFIXES = new Set(['at', 'by', 'to', 'from', 'id', 'ids']);

/** Strip the role suffix so `restored_at` and `restored_by` compare as `restored`. */
const conceptOf = (s) => {
  const t = tokens(s);
  return t.length > 1 && ROLE_SUFFIXES.has(t[t.length - 1]) ? t.slice(0, -1).join('_') : t.join('_');
};

/**
 * Two field names are "near-duplicate" when one is a small edit of the other
 * (hide_reason / hidden_reason, deleted_reason / deletion_reason) or when one's
 * tokens are a proper subset of the other's AND the shorter name carries at
 * least one non-generic token of its own (upgrade_source ⊂ image_upgrade_source
 * qualifies on "upgrade"; source ⊂ image_repair_source does not). Both shapes
 * have produced real mis-reads here.
 */
function nearDuplicateCandidates(fields) {
  const out = [];
  for (let i = 0; i < fields.length; i++) {
    for (let j = i + 1; j < fields.length; j++) {
      const a = fields[i], b = fields[j];
      if (a.name === b.name) continue;
      const ta = tokens(a.name), tb = tokens(b.name);
      const [shortT, longT] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
      const meaningful = shortT.filter((t) => !GENERIC_TOKENS.has(t));
      const subset = shortT.length < longT.length && isSubset(shortT, longT) && meaningful.length > 0;

      // An edit-distance match is only a spelling collision when the two names
      // describe the same CONCEPT. Three exclusions, each of which was pure
      // noise in the first run: names too short for a 2-edit window to mean
      // anything (job/doi), a bare leading underscore (id/_id), and a differing
      // role suffix on the same concept (restored_at/restored_by).
      const shortName = Math.min(a.name.length, b.name.length) < 6;
      const underscoreOnly = a.name.replace(/^_/, '') === b.name.replace(/^_/, '');
      const sameConcept = conceptOf(a.name) === conceptOf(b.name);
      const ed = shortName || underscoreOnly || sameConcept ? 99 : editDistance(a.name, b.name);

      if (ed > 2 && !subset) continue;
      out.push({ a: a.name, b: b.name, reason: ed <= 2 ? `edit distance ${ed}` : 'token subset' });
    }
  }
  return out;
}

/**
 * Sampled counts bottom out at one sample hit (on `books` that is ~35 docs), so
 * every rare field looks identically rare and the gap ratio is meaningless.
 * The candidate list is short — count those fields exactly.
 */
async function scoreNearDuplicates(col, candidates, census) {
  const exact = new Map();
  const need = new Set(candidates.flatMap((c) => [c.a, c.b]));
  const sampled = new Map(census.fields.map((f) => [f.name, f.count]));

  // An unindexed `{field: {$exists: true}}` count is a collection scan, so on a
  // 19M-document collection like `pages` this would run for hours. Cap each
  // count and fall back to the sampled estimate, which is good enough for
  // ranking even though it bottoms out on rare fields.
  const BIG = 500_000;
  const huge = census.docs > BIG;
  let degraded = 0;
  for (const f of need) {
    if (huge) { exact.set(f, sampled.get(f) ?? 0); degraded++; continue; }
    try {
      exact.set(f, await col.countDocuments({ [f]: { $exists: true } }, { maxTimeMS: 20000 }));
    } catch {
      exact.set(f, sampled.get(f) ?? 0);
      degraded++;
    }
  }
  if (degraded) console.log(`   (note: ${degraded} field counts are sampled estimates, not exact — collection too large to scan)`);

  return candidates
    .map((c) => {
      const a_count = exact.get(c.a), b_count = exact.get(c.b);
      const hi = Math.max(a_count, b_count), lo = Math.min(a_count, b_count);
      // A large gap is the dangerous case: the sparse twin looks usable.
      return { ...c, a_count, b_count, gap_ratio: lo === 0 ? Infinity : Math.round((hi / lo) * 10) / 10 };
    })
    .filter((c) => c.a_count > 0 && c.b_count > 0)
    .sort((x, y) => y.gap_ratio - x.gap_ratio);
}

async function censusCollection(db, name) {
  const col = db.collection(name);
  const docs = await col.estimatedDocumentCount();
  if (docs === 0) return { name, docs: 0, fields: [] };
  const size = Math.min(SAMPLE, docs);
  const rows = await col
    .aggregate(
      [{ $sample: { size } }, { $project: { k: { $objectToArray: '$$ROOT' } } }, { $unwind: '$k' }, { $group: { _id: '$k.k', n: { $sum: 1 } } }, { $sort: { n: -1 } }],
      { maxTimeMS: 180000 },
    )
    .toArray();
  const fields = rows.map((r) => ({ name: r._id, sampled: r.n, pct: Math.round((1000 * r.n) / size) / 10, count: Math.round((r.n / size) * docs) }));
  return { name, docs, sampleSize: size, fields };
}

async function nestedCensus(db, name, parents) {
  const col = db.collection(name);
  const out = [];
  for (const p of parents) {
    const n = await col.countDocuments({ [p]: { $exists: true } });
    if (!n) continue;
    const subs = await col
      .aggregate(
        [{ $match: { [p]: { $type: 'object' } } }, { $sample: { size: 1500 } }, { $project: { k: { $objectToArray: `$${p}` } } }, { $unwind: '$k' }, { $group: { _id: '$k.k', n: { $sum: 1 } } }],
        { maxTimeMS: 120000 },
      )
      .toArray();
    out.push({ parent: p, docs: n, subKeys: subs.length, names: subs.map((s) => s._id).sort() });
  }
  return out;
}

const bucketOf = (pct) => (pct < 1 ? '<1%' : pct < 10 ? '1-10%' : pct < 50 ? '10-50%' : pct < 99 ? '50-99%' : '>=99%');

/**
 * Every top-level field name in the collection — a FULL scan, deliberately.
 * A validator built from a sample would omit fields on a handful of documents
 * and then reject legitimate writes to them.
 */
async function allFieldNames(col) {
  const rows = await col
    .aggregate([{ $project: { k: { $objectToArray: '$$ROOT' } } }, { $unwind: '$k' }, { $group: { _id: '$k.k' } }], {
      allowDiskUse: true,
      maxTimeMS: 900000,
    })
    .toArray();
  return rows.map((r) => r._id).sort();
}

/**
 * A `$jsonSchema` that accepts exactly today's fields and nothing else. Emitted
 * in `warn` mode: violations are logged by the server, writes still succeed.
 * Watch the Atlas log, then flip `validationAction` to `error` once quiet.
 *
 * `validationLevel: "moderate"` applies the rule to inserts and to updates of
 * documents that already validate — so a legacy document that somehow falls
 * outside the schema can still be repaired rather than becoming unwritable.
 */
function buildValidator(fields, retired = []) {
  const properties = {};
  for (const f of fields) properties[f] = {};
  return {
    _generated_by: 'scripts/audit/field-sprawl.mjs --emit-validator',
    _note: 'Blesses the fields that exist today and rejects the next new one. Shrink `properties` as concept families are consolidated; a name moved to `_retired` must never come back.',
    _retired: retired,
    collMod: null, // filled in by the caller with the collection name
    validator: { $jsonSchema: { bsonType: 'object', additionalProperties: false, properties } },
    validationLevel: 'moderate',
    validationAction: 'warn',
  };
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI not set');
    process.exit(2);
  }
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db('bookstore');

  let targets = WATCHED;
  if (ONE) targets = [ONE];
  else if (ALL) targets = (await db.listCollections().toArray()).map((c) => c.name).sort();

  const report = { measured_at: new Date().toISOString(), sample: SAMPLE, collections: [] };
  let breach = false;

  for (const name of targets) {
    const census = await censusCollection(db, name);
    if (!census.docs) continue;

    const buckets = { '<1%': [], '1-10%': [], '10-50%': [], '50-99%': [], '>=99%': [] };
    for (const f of census.fields) buckets[bucketOf(f.pct)].push(f.name);

    console.log(`\n${'='.repeat(72)}`);
    console.log(`### ${name} — ${census.docs.toLocaleString()} docs, ${census.fields.length} top-level fields`);
    console.log(`${'='.repeat(72)}`);
    for (const [b, v] of Object.entries(buckets)) console.log(`   ${b.padEnd(7)} ${String(v.length).padStart(3)} fields`);
    console.log(`\n   core (>=99%): ${buckets['>=99%'].join(', ') || '(none)'}`);

    if (buckets['<1%'].length) {
      console.log(`\n   --- the <1% tail: ${buckets['<1%'].length} fields, roughly one sweep each ---`);
      console.log('   ' + buckets['<1%'].sort().join(', '));
    }

    const pairs = await scoreNearDuplicates(db.collection(name), nearDuplicateCandidates(census.fields), census);
    const line = (p) => `   ${p.a} (${p.a_count.toLocaleString()})  vs  ${p.b} (${p.b_count.toLocaleString()})`;

    // Class 1: same word, two spellings. Always dangerous, whatever the fill
    // rates — deleted_reason / deletion_reason sit at 15 docs each and neither
    // is more correct than the other. Ranked by reach, not by gap.
    const spellings = pairs.filter((p) => p.reason.startsWith('edit distance')).sort((a, b) => Math.max(b.a_count, b.b_count) - Math.max(a.a_count, a.b_count));
    if (spellings.length) {
      console.log(`\n   --- SAME CONCEPT, TWO SPELLINGS (${spellings.length}) — a sweep picks one and misses the other ---`);
      spellings.slice(0, 20).forEach((p) => console.log(line(p)));
      if (spellings.length > 20) console.log(`   … and ${spellings.length - 20} more`);
    }

    // Class 2: a qualifier hanging off a universal field (author / display_author)
    // is ordinary design, so require BOTH sides to be non-core. What survives is
    // the "three partial sources of truth" shape: upgrade_source (290) vs
    // image_upgrade_source (384) vs image_resolution_upgrade_source (1,986).
    const CORE_FILL = 0.5;
    const partials = pairs
      .filter((p) => p.reason === 'token subset' && Math.max(p.a_count, p.b_count) < census.docs * CORE_FILL)
      .sort((a, b) => Math.max(b.a_count, b.b_count) - Math.max(a.a_count, a.b_count));
    if (partials.length) {
      console.log(`\n   --- OVERLAPPING PARTIAL FIELDS (${partials.length}) — neither is core, so neither is complete ---`);
      partials.slice(0, 20).forEach((p) => console.log(line(p)));
      if (partials.length > 20) console.log(`   … and ${partials.length - 20} more`);
    }

    const fams = FAMILIES[name];
    const familyReport = [];
    if (fams) {
      console.log(`\n   --- DECLARED CONCEPT FAMILIES (one idea, N fields) ---`);
      for (const [label, fieldNames] of Object.entries(fams)) {
        const counts = [];
        for (const f of fieldNames) counts.push({ field: f, count: await db.collection(name).countDocuments({ [f]: { $exists: true } }) });
        counts.sort((a, b) => b.count - a.count);
        const live = counts.filter((c) => c.count > 0);
        console.log(`   ${String(live.length).padStart(2)} fields — ${label}`);
        console.log(`        ${live.map((c) => `${c.field}(${c.count.toLocaleString()})`).join(' · ')}`);
        familyReport.push({ label, fields: counts });
      }
    }

    const nested = NESTED[name] ? await nestedCensus(db, name, NESTED[name]) : [];
    if (nested.length) {
      console.log(`\n   --- NESTED sub-key sprawl ---`);
      for (const n of nested) console.log(`   ${n.parent.padEnd(26)} on ${String(n.docs).padStart(7)} docs, ${n.subKeys} sub-keys`);
      const total = census.fields.length + nested.reduce((s, n) => s + n.subKeys, 0);
      console.log(`\n   TOTAL addressable fields (top-level + nested): ${total}`);

      // A $jsonSchema validator with additionalProperties:false constrains only
      // the TOP level — a free-form object field is an unguarded floor below it,
      // where the next sweep can put its column instead. Ceiling it too.
      if (MAX_NESTED) {
        for (const n of nested) {
          if (n.subKeys > MAX_NESTED) {
            console.log(`\n   !! nested '${n.parent}' has ${n.subKeys} sub-keys, over the --max-nested ceiling of ${MAX_NESTED}`);
            breach = true;
          }
        }
      }
    }

    if (WATCHED.includes(name) && census.fields.length > MAX_FIELDS) {
      console.log(`\n   !! ${census.fields.length} SAMPLED fields exceeds the --max-fields ceiling of ${MAX_FIELDS}`);
      breach = true;
    }

    if (FORBID.length) {
      // Exact countDocuments, not the sample: a retired field re-growing on
      // 0.1% of docs is precisely the case the sample would miss.
      for (const f of FORBID) {
        const n = await db.collection(name).countDocuments({ [f]: { $exists: true } });
        if (n > 0) {
          console.log(`\n   !! RETIRED field '${f}' is BACK on ${name}: ${n.toLocaleString()} docs. A writer re-grew it — find and strip the writer, then re-clean.`);
          breach = true;
        }
      }
    }

    report.collections.push({ ...census, buckets: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, v.length])), spellingPairs: spellings, partialPairs: partials, families: familyReport, nested });
  }

  if (EMIT_VALIDATOR) {
    if (!ONE) {
      console.error('\n--emit-validator needs exactly one --collection: a validator is per-collection.');
      await client.close();
      process.exit(2);
    }
    console.log(`\nenumerating every field on ${ONE} (full scan, not a sample)…`);
    const names = await allFieldNames(db.collection(ONE));

    // The ceiling above was checked against the SAMPLED census, which sees far
    // fewer fields than exist — reported by Mayank on #4002, who expected a
    // breach at 476 and got exit 0 because the gate read ~395. Two different
    // counts in one run is a trip hazard precisely at the moment someone flips
    // the validator to `error`, where a wrong field list becomes 500s. So the
    // authoritative count gets the same ceiling, and both are printed together.
    const sampledCount = report.collections.find((c) => c.name === ONE)?.fields?.length;
    if (sampledCount !== undefined) {
      console.log(`\nfield count: ${sampledCount} sampled (${SAMPLE} docs) vs ${names.length} FULL — the validator is built from the FULL count.`);
    }
    if (WATCHED.includes(ONE) && names.length > MAX_FIELDS) {
      console.log(`   !! ${names.length} FULL fields exceeds the --max-fields ceiling of ${MAX_FIELDS}`);
      breach = true;
    }
    const doc = buildValidator(names);
    doc.collMod = ONE;
    fs.writeFileSync(EMIT_VALIDATOR, JSON.stringify(doc, null, 2));
    console.log(`wrote ${EMIT_VALIDATOR} — ${names.length} fields blessed`);
    console.log(`\nTo install (needs a dbAdmin credential; the app user is readWriteAnyDatabase and`);
    console.log(`cannot run collMod — which is exactly why a sweep cannot route around it):`);
    console.log(`  mongosh "<admin-uri>" --eval 'db.runCommand(${JSON.stringify({ collMod: ONE, validator: '<validator from the file>', validationLevel: 'moderate', validationAction: 'warn' })})'`);
    console.log(`\nIt lands in WARN mode: violations are logged, writes still succeed. Watch the`);
    console.log(`Atlas log for a week, fix what shows up, then flip validationAction to "error".`);
  }

  if (JSON_OUT) {
    fs.writeFileSync(JSON_OUT, JSON.stringify(report, null, 2));
    console.log(`\nwrote ${JSON_OUT}`);
  }

  await client.close();

  console.log(`\n${'='.repeat(72)}`);
  console.log('The rule this audit exists to enforce: a sweep records a ROW in a log');
  console.log('collection keyed to the book, never a new FIELD on the book. That is what');
  console.log('books_warehouse (25 core / 129 total) got right and books (17 / 403) did not.');
  console.log(`${'='.repeat(72)}`);

  process.exit(breach ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
