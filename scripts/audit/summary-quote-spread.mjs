#!/usr/bin/env node
/**
 * Audit: do a long book's stored pull-quotes come from the whole book, or only from its opening? (#4387)
 *
 * PRIOR ART: none that fits. I looked in scripts/audit/ and scripts/maintenance/ (`ls | grep -i -E "summar|quote"`):
 *   audit-book-summaries.mjs and em-dash-prose.mjs read the summary PROSE for voice, and
 *   scripts/lib/declined-region.mjs screens single quotes for an unread region. Nothing measures WHERE in the
 *   book `reading_summary.quotes` sit. The one-off query in #4387 was never committed.
 *
 * WHAT IT COUNTS
 *   Live books (visible && pages_count > 0) of at least --min-pages pages (default 100) that carry
 *   `reading_summary.quotes[].page`. Per book, reach = max(quote page) / denominator, where the denominator is
 *     raw      pages_count (the #4387 measurement, comparable with its 2026-08-30 figures)
 *     sampled  the last page the summariser actually read (`reading_summary.pages_sampled`, written since #3584),
 *              so a book that is only half translated is not counted as front-loaded.
 *   If quotes were drawn across a book the mean reach sits near 1.0. Phase 6 used to keep `quotes.slice(0, 15)`,
 *   i.e. the first three to five batches; scripts/lib/spread-across-book.mjs replaced it.
 *
 *   The cause leaves a signature this prints separately: front-loading should appear only where the 15-quote cap
 *   was hit, and (where `pages_sampled` exists) the quotes should sit inside the first few batches.
 *
 *   Stored summaries do not change until a book is re-enriched, so the corpus-wide figure moves slowly. Use
 *   --since to read only summaries generated after the fix; --strict judges that group alone.
 *
 * USAGE (read-only, no model calls)
 *   node --env-file=.env.production.local scripts/audit/summary-quote-spread.mjs
 *   node --env-file=.env.production.local scripts/audit/summary-quote-spread.mjs --since 2026-10-12 --strict
 *   node --env-file=.env.production.local scripts/audit/summary-quote-spread.mjs --json
 *   node --env-file=.env.production.local scripts/audit/summary-quote-spread.mjs --samples 10   # worst offenders
 *   --strict exits 1 when, among summaries generated since --since (at least 30 of them), more than
 *   --max-front-share (default 0.15) have every quote in the first quarter of what was read.
 */

import { MongoClient } from 'mongodb';
import { pathToFileURL } from 'node:url';

const QUOTE_CAP = 15; // reading_summary.quotes is capped at this many in Phase 6

/** One book's reach figures, or null when it has no quote with a usable page. */
export function quoteReach(book) {
  const pages = (book.reading_summary?.quotes || []).map((q) => q?.page).filter((p) => Number.isFinite(p) && p > 0);
  if (pages.length === 0 || !(book.pages_count > 0)) return null;
  const maxQuote = Math.max(...pages);
  const sampled = (book.reading_summary?.pages_sampled || []).filter((r) => Number.isFinite(r?.start) && Number.isFinite(r?.end));
  const lastSampled = sampled.length ? Math.max(...sampled.map((r) => r.end)) : null;
  return {
    id: book.id,
    quotes: pages.length,
    capped: pages.length >= QUOTE_CAP,
    raw: Math.min(1, maxQuote / book.pages_count),
    sampled: lastSampled ? Math.min(1, maxQuote / lastSampled) : null,
    batches: sampled.length || null,
    // which batch (0-based) the furthest quote sits in; null when it falls outside every range
    lastQuoteBatch: sampled.length ? (() => { const i = sampled.findIndex((r) => maxQuote >= r.start && maxQuote <= r.end); return i < 0 ? null : i; })() : null,
    generated_at: book.reading_summary?.generated_at ? new Date(book.reading_summary.generated_at) : null,
  };
}

/** Share below each threshold, and the mean, of one reach column. */
export function summarise(rows, key) {
  const v = rows.map((r) => r[key]).filter((x) => x != null);
  const share = (t) => (v.length ? v.filter((x) => x < t).length / v.length : null);
  return { n: v.length, below_025: share(0.25), below_050: share(0.5), mean: v.length ? v.reduce((a, b) => a + b, 0) / v.length : null };
}

async function main() {
  const MONGODB_URI = process.env.MONGODB_URI;
  if (!MONGODB_URI) { console.error('Missing MONGODB_URI'); process.exit(2); }

  const args = process.argv.slice(2);
  const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : dflt; };
  const JSON_OUT = args.includes('--json');
  const STRICT = args.includes('--strict');
  const MIN_PAGES = parseInt(opt('--min-pages', '100'), 10);
  const SAMPLES = parseInt(opt('--samples', '0'), 10);
  const MAX_FRONT_SHARE = parseFloat(opt('--max-front-share', '0.15'));
  const sinceArg = opt('--since', null);
  const SINCE = sinceArg ? new Date(sinceArg) : null;
  if (SINCE && Number.isNaN(SINCE.getTime())) { console.error(`Bad --since: ${sinceArg}`); process.exit(2); }

  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  let rows;
  try {
    const db = client.db(process.env.MONGODB_DB || 'bookstore');
    const cursor = db.collection('books').find(
      { visible: true, pages_count: { $gte: MIN_PAGES }, 'reading_summary.quotes.0': { $exists: true } },
      { projection: { _id: 0, id: 1, pages_count: 1, 'reading_summary.quotes.page': 1, 'reading_summary.pages_sampled': 1, 'reading_summary.generated_at': 1 } },
    );
    rows = [];
    for await (const b of cursor) { const r = quoteReach(b); if (r) rows.push(r); }
  } finally {
    await client.close();
  }

  const groups = { all: rows };
  if (SINCE) {
    groups[`generated >= ${sinceArg}`] = rows.filter((r) => r.generated_at && r.generated_at >= SINCE);
    groups[`generated <  ${sinceArg}`] = rows.filter((r) => !r.generated_at || r.generated_at < SINCE);
  }
  const report = { measured_at: new Date().toISOString(), min_pages: MIN_PAGES, groups: {} };
  for (const [name, g] of Object.entries(groups)) {
    const withBatches = g.filter((r) => r.batches > 5 && r.lastQuoteBatch != null);
    report.groups[name] = {
      raw: summarise(g, 'raw'),
      sampled: summarise(g, 'sampled'),
      // the cause's signature
      capped: summarise(g.filter((r) => r.capped), 'raw'),
      under_cap: summarise(g.filter((r) => !r.capped), 'raw'),
      first_five_batches: { n: withBatches.length, share: withBatches.length ? withBatches.filter((r) => r.lastQuoteBatch < 5).length / withBatches.length : null },
    };
  }

  const judged = SINCE ? report.groups[`generated >= ${sinceArg}`] : report.groups.all;
  const judgedCol = judged.sampled.n >= 30 ? judged.sampled : judged.raw;
  const fail = STRICT && judgedCol.n >= 30 && judgedCol.below_025 > MAX_FRONT_SHARE;

  if (JSON_OUT) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    const pct = (x) => (x == null ? '   -' : `${(x * 100).toFixed(1)}%`.padStart(6));
    const line = (label, s) => console.log(`  ${label.padEnd(44)} n=${String(s.n).padStart(6)}  <0.25 ${pct(s.below_025)}  <0.50 ${pct(s.below_050)}  mean ${s.mean == null ? '-' : s.mean.toFixed(3)}`);
    console.log(`Pull-quote reach, live books of ${MIN_PAGES}+ pages (reach = furthest quote page / denominator)`);
    for (const [name, g] of Object.entries(report.groups)) {
      console.log(`\n${name}`);
      line('of pages_count (as #4387)', g.raw);
      line('of the last page the summariser read', g.sampled);
      line(`  ${QUOTE_CAP} quotes stored (cap hit), of pages_count`, g.capped);
      line(`  under ${QUOTE_CAP} quotes stored, of pages_count`, g.under_cap);
      console.log(`  ${'6+ batches: furthest quote in the first five'.padEnd(44)} n=${String(g.first_five_batches.n).padStart(6)}  ${pct(g.first_five_batches.share)}`);
    }
    if (SAMPLES > 0) {
      console.log(`\nFurthest quote nearest the front (${SAMPLES}):`);
      for (const r of [...rows].sort((a, b) => (a.sampled ?? a.raw) - (b.sampled ?? b.raw)).slice(0, SAMPLES)) {
        console.log(`  ${r.id}  reach ${(r.sampled ?? r.raw).toFixed(3)}  quotes ${r.quotes}  batches ${r.batches ?? '?'}  generated ${r.generated_at ? r.generated_at.toISOString().slice(0, 10) : '?'}`);
      }
    }
    if (STRICT) console.log(`\n--strict: ${judgedCol.n < 30 ? `only ${judgedCol.n} summaries in scope, not judged` : fail ? `FAIL, ${pct(judgedCol.below_025).trim()} front-loaded > ${(MAX_FRONT_SHARE * 100).toFixed(0)}%` : 'pass'}`);
  }
  process.exit(fail ? 1 : 0);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main().catch((e) => { console.error(e); process.exit(2); });
