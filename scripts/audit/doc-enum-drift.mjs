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
 * Needs MONGODB_URI. WITHOUT IT THIS REPORTS "NOT RUN" AND EXITS NON-ZERO under
 * --fail-on-findings, rather than printing a clean pass — an unrun check that
 * looks green is how the leak audit in CLAUDE.md nearly shipped twice.
 *
 * RUN IT ON HETZNER, not a laptop. The exact mode scans `pages` twice (19.1M
 * docs each) and takes longer than a consumer connection reliably stays up --
 * two of three attempts on 2026-08-04/05 died on a network blip mid-scan. The
 * scans are the point, so the fix is where you run it, not a weaker check.
 *
 *   set -a; source .env.production.local; set +a
 *   node scripts/audit/doc-enum-drift.mjs
 *   node scripts/audit/doc-enum-drift.mjs --fail-on-findings
 *   node scripts/audit/doc-enum-drift.mjs --json
 *   node scripts/audit/doc-enum-drift.mjs --fast     # sample big collections;
 *                                                    # can only find, never clear
 */
import { MongoClient } from 'mongodb';
import { readFileSync, existsSync } from 'node:fs';

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const failOnFindings = args.includes('--fail-on-findings');
const fast = args.includes('--fast');   // opt IN to sampling; exact is the default
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

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    const msg = 'NOT RUN — MONGODB_URI is unset. This check cannot pass without a database; treat this as a finding, not a skip.';
    console.log(asJson ? JSON.stringify({ status: 'not_run', reason: msg }, null, 2) : `\n${msg}\n`);
    // process.exitCode, never process.exit(): exit() discards buffered stdout
    // when stdout is a PIPE rather than a tty, so the report vanishes in CI and
    // under any redirect -- the exact places this check is meant to speak up.
    if (failOnFindings) process.exitCode = 1;
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
  try {
  for (const entry of REGISTRY) {
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
    console.log(JSON.stringify({ status: 'ran', findings }, null, 2));
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
  }

  // A sampled entry never counts as passing, even with nothing found.
  const bad = findings.filter(f => f.kind !== 'ok' || f.sampled);
  if (bad.length && failOnFindings) process.exitCode = 1;   // not process.exit() -- see above
}

main().catch(e => { console.error(e); process.exitCode = 1; });
