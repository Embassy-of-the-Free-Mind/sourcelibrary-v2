#!/usr/bin/env node
/**
 * Does a documented enum still match production?
 *
 * WHY THIS EXISTS. `.claude/docs/data-provenance.md` documented
 * `page_revisions.source` as five values. Production had twelve. The eight
 * undocumented ones covered 111,685 rows — including
 * `shift-repair-erara-2026-07`, the label that says which 29.5% of the "double
 * OCR" corpus is a maintenance sweep rather than a second reading.
 *
 * Because that value was undocumented, two sessions inferred the same fact the
 * hard way — page-number arithmetic, per-book offset signatures, and finally two
 * scans opened by hand — while `db.page_revisions.distinct('source')` answered
 * it in one query (#3473).
 *
 * NOTHING CAUGHT IT. The doc was living, referenced, undated, and carried no
 * date-plus-quantity pattern, so it passed every check in
 * `doc-staleness.mjs`. Schema drift is a distinct failure mode: the prose stays
 * true-looking while the world adds a value underneath it.
 *
 * SECOND CHECK: ACTIVE DEFAULTS (#3614). Same failure mode, different shape. The
 * doc's "Current defaults" table is not an enum but a set of pointers at live
 * rows, and it rotted the same way — it said OCR v10 while production ran v15,
 * translation v8 while production ran v12. And underneath it the collection
 * itself had drifted: TWO `is_default: true` rows for `summary`, so which prompt
 * produced a summary was decided by natural order, and `version` was mixed
 * string and number (`1` vs `'v1'`), which makes every `sort({version:-1})` in
 * the codebase follow BSON type order rather than intent. So this half asserts
 * three things: exactly one default per type, numeric versions, and a doc table
 * that names the versions actually running.
 *
 * THE CHECK. For each registered (collection, field, doc) triple: read the
 * distinct values from production, and require that each one appears SOMEWHERE
 * in the doc's text. That is deliberately crude — it does not parse structure,
 * so it cannot be fooled by a table being reformatted, and it catches the exact
 * failure above (a value exists in production and is absent from the doc).
 *
 * Values documented but ABSENT from production are reported separately and never
 * fail the run: a legitimate enum value can simply have no rows yet, and a
 * writer that has not fired is not a documentation defect.
 *
 * EXIT CONTRACT (under --fail-on-findings), per
 * `.claude/docs/invariants/measurement-instruments.md`:
 *
 *   0  ran, clean
 *   1  ran, FOUND something — file the finding
 *   2  COULD NOT RUN (no MONGODB_URI, connection died mid-scan) — go red
 *
 * Never branch a finding on `!= 0`. An unrun check that looks green, or an
 * infrastructure failure filed as a corpus finding, are both how this family of
 * detector has lied before.
 *
 * RUN THE ENUM HALF ON HETZNER, not a laptop. The exact mode scans `pages` twice
 * (19.1M docs each) and takes longer than a consumer connection reliably stays
 * up -- two of three attempts on 2026-08-04/05 died on a network blip mid-scan.
 * The scans are the point, so the fix is where you run it, not a weaker check.
 * The defaults half reads 55 documents and runs anywhere in a second, which is
 * why `--only=defaults` is what the scheduled workflow uses.
 *
 *   set -a; source .env.production.local; set +a
 *   node scripts/audit/doc-enum-drift.mjs
 *   node scripts/audit/doc-enum-drift.mjs --fail-on-findings
 *   node scripts/audit/doc-enum-drift.mjs --json
 *   node scripts/audit/doc-enum-drift.mjs --fast     # sample big collections;
 *                                                    # can only find, never clear
 *   node scripts/audit/doc-enum-drift.mjs --only=defaults   # active prompts only
 *   node scripts/audit/doc-enum-drift.mjs --only=enums      # documented enums only
 */
import { MongoClient } from 'mongodb';
import { readFileSync, existsSync } from 'node:fs';

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const failOnFindings = args.includes('--fail-on-findings');
const fast = args.includes('--fast');   // opt IN to sampling; exact is the default
const only = (args.find(a => a.startsWith('--only='))?.slice(7) || 'all');
if (!['all', 'enums', 'defaults'].includes(only)) {
  console.error(`unknown --only=${only} (expected: enums | defaults)`);
  process.exit(2);
}
const runEnums = only === 'all' || only === 'enums';
const runDefaults = only === 'all' || only === 'defaults';
/** Above this many documents, discover values by $sample rather than a full scan. */
const EXACT_MAX = 2_000_000;
const SAMPLE_SIZE = 50_000;

/**
 * Registered enums. Add a row when you document a value-list that production
 * also writes — that is the whole maintenance burden, and skipping it is what
 * this script exists to make visible.
 *
 * `filter` narrows the collection when a field's domain differs per subset.
 * `ignore` is for values that are genuinely not worth documenting (test rows,
 * one-off typos); keep it near-empty and justified inline.
 */
const REGISTRY = [
  {
    label: 'prompts.type (active defaults)',
    collection: 'prompts',
    field: 'type',
    doc: '.claude/docs/data-provenance.md',
    note: 'Prompt type vocabulary. See the separate active-defaults check below for the version/uniqueness invariants.',
  },
  {
    label: 'page_revisions.source',
    collection: 'page_revisions',
    field: 'source',
    doc: '.claude/docs/data-provenance.md',
    note: 'The mechanism label. A missing value here silently turns bulk maintenance into "a second OCR pass" for every consumer of the revision corpus.',
  },
  {
    label: 'pages.ocr.source',
    collection: 'pages',
    field: 'ocr.source',
    doc: '.claude/docs/data-provenance.md',
    note: 'Per-page provenance for the live OCR text.',
  },
  {
    label: 'pages.translation.source',
    collection: 'pages',
    field: 'translation.source',
    doc: '.claude/docs/data-provenance.md',
    note: 'Per-page provenance for the live translation text.',
  },
  {
    // The "doc" here is the guard module itself, deliberately. For this field the
    // question worth asking is not "is the prose current?" but "does production hold a
    // value the write-time guard does not allow?" — pointing the check at the canonical
    // vocabulary makes any such drift fail the run. Production carried 113 distinct
    // values before #3419, 96 of them chunks of raw model output.
    label: 'gallery_images.type',
    collection: 'gallery_images',
    field: 'type',
    doc: 'src/lib/gallery-image-types.ts',
    note: 'Illustration type vocabulary. A value outside this list means a writer bypassed coerceImageType() — the field is enum-shaped and the model will narrate into it given the chance (#3419).',
  },
];

/** Where the "Current defaults" table lives, and how a live default must appear in it. */
const DEFAULTS_DOC = '.claude/docs/data-provenance.md';

/**
 * `'v12'` → 12, `12` → 12. Anything else (missing field, `'latest'`) → null,
 * which this check reports rather than repairs — see
 * `scripts/maintenance/repair-prompt-defaults-3614.mjs`.
 */
function parseVersion(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') { const m = /^v?(\d+)$/i.exec(v.trim()); if (m) return Number(m[1]); }
  return null;
}

/**
 * The active-prompt invariants. Deliberately three separate assertions, because
 * they fail independently and a run that reports only the doc mismatch would
 * have missed the live bug in #3614.
 */
async function checkPromptDefaults(db) {
  const out = { doc: DEFAULTS_DOC, duplicates: [], missingDefault: [], nonNumeric: [], docDrift: [], defaults: [] };
  const rows = await db.collection('prompts').find({}).toArray();
  out.total = rows.length;

  for (const p of rows) {
    if (parseVersion(p.version) === null) {
      out.nonNumeric.push({ id: String(p._id), type: p.type, name: p.name ?? null, version: p.version ?? null });
    }
  }

  const types = [...new Set(rows.map(p => p.type).filter(Boolean))].sort();
  for (const type of types) {
    const defs = rows.filter(p => p.type === type && p.is_default === true);
    if (defs.length === 0) { out.missingDefault.push(type); continue; }
    if (defs.length > 1) {
      out.duplicates.push({ type, rows: defs.map(p => ({ id: String(p._id), name: p.name ?? null, version: p.version ?? null })) });
    }
    for (const p of defs) out.defaults.push({ type, id: String(p._id), name: p.name ?? null, version: parseVersion(p.version), rawVersion: p.version ?? null });
  }

  // Doc table. Crude on purpose, exactly like the enum half: find a line that
  // names the prompt, then check the version token on that line. A reformatted
  // table still passes; a stale version number does not.
  if (!existsSync(DEFAULTS_DOC)) {
    out.docMissing = true;
    return out;
  }
  const lines = readFileSync(DEFAULTS_DOC, 'utf8').split('\n');
  for (const d of out.defaults) {
    if (!d.name) { out.docDrift.push({ ...d, reason: 'live default has no `name` — nothing to match in the doc, and its output records prompt_name: undefined' }); continue; }
    const line = lines.find(l => l.includes(d.name) && /\bv\d+\b/.test(l));
    if (!line) { out.docDrift.push({ ...d, reason: `no line in the doc names "${d.name}" with a version` }); continue; }
    const documented = [...line.matchAll(/\bv(\d+)\b/g)].map(m => Number(m[1]));
    if (d.version === null || !documented.includes(d.version)) {
      out.docDrift.push({ ...d, reason: `doc says v${documented.join('/v')}, production runs v${d.version}` });
    }
  }
  return out;
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    const msg = 'NOT RUN — MONGODB_URI is unset. This check cannot pass without a database; this is exit 2 (instrument failure), NOT a finding.';
    console.log(asJson ? JSON.stringify({ status: 'not_run', reason: msg }, null, 2) : `\n${msg}\n`);
    // process.exitCode, never process.exit(): exit() discards buffered stdout
    // when stdout is a PIPE rather than a tty, so the report vanishes in CI and
    // under any redirect -- the exact places this check is meant to speak up.
    if (failOnFindings) process.exitCode = 2;
    return;
  }

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || 'bookstore');

  // try/finally, not a bare close at the end: without it an error mid-scan
  // leaves the connection pool open and, because we set process.exitCode rather
  // than calling process.exit(), node's event loop never drains and the process
  // hangs FOREVER. Observed 2026-08-04 -- a DNS blip left a run alive 2h43m,
  // printing its error and then simply never exiting.
  const findings = [];
  let defaults = null;
  try {
  if (runDefaults) defaults = await checkPromptDefaults(db);
  for (const entry of runEnums ? REGISTRY : []) {
    if (!existsSync(entry.doc)) {
      findings.push({ ...entry, kind: 'missing_doc', undocumented: [], phantom: [] });
      continue;
    }
    const text = readFileSync(entry.doc, 'utf8');
    const coll = db.collection(entry.collection);

    // ONE aggregation for values AND counts. The obvious spelling --
    // distinct() then countDocuments() per value -- is N full scans and does not
    // finish. Counts matter because "8 values undocumented" says nothing about
    // blast radius; 111,685 rows does.
    //
    // SAMPLED ON BIG COLLECTIONS. `pages` holds 19.1M documents and a full
    // $group over it takes many minutes -- and a check nobody runs is worth
    // nothing, which is the failure mode this whole script exists to fix. Above
    // EXACT_MAX we $sample instead and SAY SO, including the frequency below
    // which a value would likely be missed. Sampling cannot prove absence; the
    // report must never imply it does.
    const total = await coll.estimatedDocumentCount();
    const sampled = fast && total > EXACT_MAX;
    const pipeline = [
      ...(entry.filter ? [{ $match: entry.filter }] : []),
      ...(sampled ? [{ $sample: { size: SAMPLE_SIZE } }] : []),
      { $group: { _id: `$${entry.field}`, n: { $sum: 1 } } },
      { $sort: { n: -1 } },
    ];
    const grouped = await coll.aggregate(pipeline, { allowDiskUse: true }).toArray();

    const scale = sampled ? total / Math.min(SAMPLE_SIZE, total) : 1;
    const counts = {};
    for (const g of grouped) {
      if (typeof g._id === 'string' && g._id !== '') counts[g._id] = Math.round(g.n * scale);
    }
    const values = Object.keys(counts);
    // A value present on fewer than ~3x this many rows can be missed entirely by
    // the sample. Reported so a clean result is read with the right confidence.
    const floor = sampled ? Math.round(3 * total / SAMPLE_SIZE) : 0;

    const ignore = new Set(entry.ignore || []);
    const undocumented = values
      .filter(v => !ignore.has(v) && !text.includes(v))
      .sort((a, b) => (counts[b] || 0) - (counts[a] || 0));

    // Phantom: quoted in the doc as a value of this field but absent from
    // production. Informational only.
    // Values only: a token containing a dot is a FIELD PATH mentioned in prose
    // (`pages.translation.source`), not a value of the enum. Reporting those as
    // "documented but absent from production" was noise in a tool whose whole
    // job is to be trusted.
    const quoted = [...text.matchAll(/["'`]([a-z][a-z0-9_-]{2,40})["'`]/gi)].map(m => m[1]);
    const present = new Set(values);
    const phantom = [...new Set(quoted)].filter(q => !present.has(q) && !q.includes('.') &&
      new RegExp(`${entry.field.split('.').pop()}[^\\n]{0,80}["'\`]${q}["'\`]`).test(text));

    findings.push({ ...entry, kind: undocumented.length ? 'undocumented_values' : 'ok',
      values, counts, undocumented, phantom, sampled, total, floor });
  }

  } finally {
    await client.close().catch(() => {});
  }

  if (asJson) {
    console.log(JSON.stringify({ status: 'ran', findings, prompt_defaults: defaults }, null, 2));
  } else {
    console.log('');
    for (const f of findings) {
      const head = `${f.label}  ->  ${f.doc}`;
      if (f.kind === 'missing_doc') { console.log(`✗ ${head}\n    doc file does not exist`); continue; }
      const method = f.sampled
        ? `sampled ${SAMPLE_SIZE.toLocaleString()} of ${f.total.toLocaleString()} docs — counts are ESTIMATES and a value on under ~${f.floor.toLocaleString()} rows may be missed entirely (drop --fast for a full scan)`
        : `full scan of ${f.total.toLocaleString()} docs`;
      if (!f.undocumented.length) {
        // A SAMPLED run may never print a clean bill. Measured 2026-08-04:
        // sampling 50k of 19.1M reported pages.translation.source "all
        // documented" while an exact scan found four undocumented values, the
        // largest on 5,759 rows -- five times the stated detection floor.
        // MongoDB's $sample uses a pseudo-random cursor that is not uniform, so
        // a rare value can be missed at any frequency. A check that can report a
        // false clean is worse than no check.
        console.log(f.sampled
          ? `? ${head}\n    INCONCLUSIVE — no undocumented value found in the sample, which is NOT a clean bill\n    ${method}`
          : `✓ ${head}\n    ${f.values.length} values, all documented\n    ${method}`);
      } else {
        console.log(`✗ ${head}`);
        console.log(`    ${f.undocumented.length} of ${f.values.length} values NOT mentioned in the doc:`);
        for (const v of f.undocumented) console.log(`      ${String(f.counts[v]).padStart(9)} rows  ${v}`);
        console.log(`    ${f.note}`);
        console.log(`    ${method}`);
      }
      if (f.phantom.length) console.log(`    (documented but absent from production: ${f.phantom.join(', ')} — informational)`);
      console.log('');
    }

    const d = defaults;
    if (d) {
    const head = `prompts active defaults  ->  ${d.doc}`;
    const clean = !d.duplicates.length && !d.missingDefault.length && !d.nonNumeric.length && !d.docDrift.length && !d.docMissing;
    console.log(clean ? `✓ ${head}` : `✗ ${head}`);
    if (d.docMissing) console.log('    doc file does not exist');
    for (const dup of d.duplicates) {
      console.log(`    ${dup.type}: ${dup.rows.length} rows with is_default:true — the lookup picks one by natural order, not intent`);
      for (const r of dup.rows) console.log(`      ${r.id}  "${r.name}"  version=${JSON.stringify(r.version)}`);
    }
    for (const t of d.missingDefault) console.log(`    ${t}: NO default — every lookup for this type silently falls back to the hardcoded prompt`);
    if (d.nonNumeric.length) {
      console.log(`    ${d.nonNumeric.length} rows whose \`version\` is not a number — sort({version:-1}) follows BSON type order, not intent:`);
      for (const r of d.nonNumeric) console.log(`      ${r.id}  ${r.type}/${r.name}  version=${JSON.stringify(r.version)}`);
    }
    for (const dd of d.docDrift) console.log(`    ${dd.type} "${dd.name}": ${dd.reason}`);
    if (clean) {
      console.log(`    ${d.defaults.length} types, one default each, all documented at the running version:`);
      for (const x of d.defaults) console.log(`      ${x.type.padEnd(22)} "${x.name}" v${x.version}`);
    } else {
      console.log('    Repair rows with: node --env-file=.env.production.local scripts/maintenance/repair-prompt-defaults-3614.mjs');
      console.log(`    Repair the table by editing the "Current defaults" section of ${d.doc}`);
    }
    console.log('');
    }
  }

  // A sampled entry never counts as passing, even with nothing found.
  const bad = findings.filter(f => f.kind !== 'ok' || f.sampled);
  const defaultsBad = defaults && (defaults.docMissing || defaults.duplicates.length ||
    defaults.missingDefault.length || defaults.nonNumeric.length || defaults.docDrift.length);
  if ((bad.length || defaultsBad) && failOnFindings) process.exitCode = 1;   // not process.exit() -- see above
}

// An uncaught throw is an INSTRUMENT failure (exit 2), never a finding (exit 1):
// a connection that dies mid-scan measured nothing, and filing that as a corpus
// finding is precisely the mistake in measurement-instruments.md.
main().catch(e => { console.error(e); process.exitCode = 2; });
