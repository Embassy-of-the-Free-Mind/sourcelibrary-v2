#!/usr/bin/env node
/**
 * PRIOR ART: scripts/audit/pipeline-hold-drift.mjs and withheld-translation-drift.mjs —
 * reconcile a stored marker against the predicate that should have produced it; the exit-code
 * contract (0 clean / 1 drift / 2 could-not-measure) is borrowed from them. Neither reads the
 * provenance of page text. tests/unit/ocr-write-stamps-updated-at.test.ts guards ONE field at
 * the write boundary statically; this checks the whole record in the data, after the fact.
 *
 * ── What this checks ─────────────────────────────────────────────────────────
 *
 * Every page whose OCR or translation was written in the window carries the full provenance
 * record its writer owes (#4613): `content_hash`, `updated_at`, and — for Gemini output — the
 * `gemini-engine/1` block (model, api, call_site, prompt by content, generation settings, run,
 * input). The rule set is `missingProvenance()` in scripts/lib/write-provenance.mjs, the same
 * function the unit tests run, so a writer that drifts fails in CI and here the same way.
 *
 * Pages are grouped by WRITER (`engine.call_site`, else `source`) and sampled per writer, so a
 * high-volume lane cannot hide a small broken one. The report is the table from the #4613
 * measurement, re-run.
 *
 *   MISSING  a required field is absent → exit 1. This is the failure the record exists to
 *            prevent: text nobody can say the origin of.
 *   MARKER   a field carries the explicit `not_recorded` marker (a batch job submitted before
 *            #4613 and collected after it; an unknown model's defaults). Reported; fails only
 *            with --strict. A marker stream that does not dry up within a week of go-live is a
 *            writer that is still not recording — read the counts, not just the exit code.
 *
 * Exit 0 = clean, 1 = missing fields found, 2 = could not measure (UNKNOWN is not PASS).
 *
 * `ocr.source` has no index (a per-source count is a ~20M-document scan); the window is cut on
 * the indexed `ocr.updated_at` / `translation.updated_at` and grouped in code.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/audit/provenance-coverage.mjs
 *     --days=2          window on updated_at (default 2)
 *     --since=<ISO>     explicit window start (overrides --days)
 *     --sample=200      pages checked per writer (default 200; the newest N)
 *     --scan=20000      newest pages read per field before grouping (default 20000)
 *     --strict          markers fail too
 *     --json            machine-readable summary on stdout
 */
import { MongoClient } from 'mongodb';
import { missingProvenance, GEMINI_SOURCES } from '../lib/write-provenance.mjs';

const arg = (k, d) => { const m = process.argv.find((a) => a.startsWith(`--${k}=`)); return m ? m.slice(k.length + 3) : d; };
const JSON_OUT = process.argv.includes('--json');
const STRICT = process.argv.includes('--strict');
const DAYS = Number(arg('days', 2));
const SAMPLE = Number(arg('sample', 200));
const SCAN = Number(arg('scan', 20000));
const SINCE = arg('since') ? new Date(arg('since')) : new Date(Date.now() - DAYS * 86400e3);
const log = (...a) => { if (!JSON_OUT) console.log(...a); };

if (Number.isNaN(SINCE.getTime())) { console.error('bad --since'); process.exit(2); }

const writerKey = (sub) => sub?.engine?.call_site || `${sub?.source || 'no-source'}${sub?.engine?.name ? `/${sub.engine.name}` : ''}`;

async function checkField(db, field) {
  const clock = `${field}.updated_at`;
  // The record is checked, never the text: `.data` only decides whether this was a text write.
  // Shipping it cost ~254 MB of Atlas egress per run (measured 2026-10-06, #5189), so the
  // server reduces it to a stand-in — 'x' for a non-empty string, else unchanged.
  const data = `$${field}.data`;
  const cursor = db.collection('pages').aggregate([
    { $match: { [clock]: { $gte: SINCE } } },
    { $sort: { [clock]: -1 } },
    { $limit: SCAN },
    { $project: { id: 1, book_id: 1, [field]: 1 } },
    { $set: { [`${field}.data`]: { $cond: [{ $and: [{ $eq: [{ $type: data }, 'string'] }, { $gt: [{ $strLenBytes: data }, 0] }] }, 'x', data] } } },
  ]);
  const byWriter = new Map();
  let scanned = 0;
  for await (const p of cursor) {
    scanned++;
    const sub = p[field];
    if (!sub || typeof sub.data !== 'string' || !sub.data) continue; // a marker or unset, not a text write
    const k = writerKey(sub);
    if (!byWriter.has(k)) byWriter.set(k, { writer: k, source: sub.source || null, model: sub.model || null, seen: 0, checked: 0, missing: new Map(), markers: new Map(), examples: [] });
    const w = byWriter.get(k);
    w.seen++;
    if (w.checked >= SAMPLE) continue;
    w.checked++;
    const { missing, markers } = missingProvenance(field, sub);
    for (const m of missing) { w.missing.set(m, (w.missing.get(m) || 0) + 1); if (w.examples.length < 3 && !w.examples.includes(p.id)) w.examples.push(p.id); }
    for (const m of markers) w.markers.set(m, (w.markers.get(m) || 0) + 1);
  }
  return { field, scanned, writers: [...byWriter.values()].sort((a, b) => b.seen - a.seen) };
}

let mongo;
try {
  mongo = new MongoClient(process.env.MONGODB_URI);
  await mongo.connect();
} catch (e) {
  console.error(`could not connect: ${e.message}`);
  process.exit(2);
}
const db = mongo.db('bookstore');

let results;
try {
  results = [await checkField(db, 'ocr'), await checkField(db, 'translation')];
} catch (e) {
  console.error(`could not measure: ${e.message}`);
  await mongo.close();
  process.exit(2);
}
await mongo.close();

let anyMissing = 0;
let anyMarker = 0;
const summary = { since: SINCE.toISOString(), sample: SAMPLE, strict: STRICT, fields: [] };
for (const r of results) {
  log(`\n== ${r.field}: ${r.scanned} pages written since ${SINCE.toISOString()} (newest ${SCAN} read) ==`);
  log(`${'writer'.padEnd(52)} ${'source'.padEnd(16)} ${'seen'.padStart(6)} ${'checked'.padStart(7)}  missing → count | markers → count`);
  const rows = [];
  for (const w of r.writers) {
    const gemini = GEMINI_SOURCES.has(w.source);
    const missing = [...w.missing.entries()];
    const markers = [...w.markers.entries()];
    const nMissing = missing.reduce((n, [, c]) => n + c, 0);
    const nMarker = markers.reduce((n, [, c]) => n + c, 0);
    anyMissing += nMissing;
    anyMarker += nMarker;
    const cell = (xs) => (xs.length ? xs.map(([k, c]) => `${k.replace(`${r.field}.`, '')}→${c}`).join(', ') : '—');
    log(`${w.writer.slice(0, 52).padEnd(52)} ${String(w.source).padEnd(16)} ${String(w.seen).padStart(6)} ${String(w.checked).padStart(7)}  ${nMissing ? 'MISSING ' : ''}${cell(missing)} | ${cell(markers)}${w.examples.length ? `  e.g. ${w.examples.join(' ')}` : ''}`);
    rows.push({ writer: w.writer, source: w.source, model: w.model, gemini, seen: w.seen, checked: w.checked, missing: Object.fromEntries(missing), markers: Object.fromEntries(markers), examples: w.examples });
  }
  summary.fields.push({ field: r.field, scanned: r.scanned, writers: rows });
}
summary.missing_total = anyMissing;
summary.marker_total = anyMarker;
summary.verdict = anyMissing ? 'MISSING' : (STRICT && anyMarker) ? 'MARKERS' : 'CLEAN';
if (JSON_OUT) console.log(JSON.stringify(summary, null, 2));
else log(`\nverdict: ${summary.verdict} (missing ${anyMissing}, markers ${anyMarker}${STRICT ? ', strict' : ''})`);
process.exit(summary.verdict === 'CLEAN' ? 0 : 1);
