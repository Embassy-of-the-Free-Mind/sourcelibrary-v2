#!/usr/bin/env node
/**
 * After a hand identity repair, does any stored summary still name the OLD author or title?
 *
 * A repair that fixes `title` and `author` leaves `index.bookSummary` and
 * `localized.<lang>.summary` behind, and the book page reads those first. #5001 and #6660
 * both shipped that way: Mulian Rescues His Mother went on saying "Matteo Ricci uses the
 * dramatic story of Mulian". Exit 1 when any repaired book still carries an old name.
 *
 * PRIOR ART: scripts/audit/derived-metadata-scope.mjs — finds poisoned derived fields by
 * shape (one derived title across many books). It cannot see a single book whose summary
 * names its former author; this compares against the repair's own `before` record.
 *
 *   node --env-file=.env.production.local scripts/audit/identity-repair-summary-scope.mjs
 */
import { MongoClient } from 'mongodb';

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');
const repairs = await db.collection('sweep_log').find({ action: 'identity-repaired-by-hand' }).toArray();
const textOf = (v) => (typeof v === 'string' ? v : v?.data || '');
let stale = 0;
for (const r of repairs) {
  const before = r.detail?.before || {};
  const b = await db.collection('books').findOne(
    { id: r.book_id },
    { projection: { author: 1, summary: 1, reading_summary: 1, 'index.bookSummary': 1, localized: 1 } },
  );
  if (!b) continue;
  const surname = String(before.author || '').split(/[ ,(]/).filter((t) => t.length > 3).pop() || '';
  // A name the record still legitimately carries is not stale.
  const oldNames = [before.display_title, String(b.author || '').includes(surname) ? '' : surname].filter(Boolean);
  const fields = {
    summary: textOf(b.summary),
    reading_summary: textOf(b.reading_summary),
    brief: b.index?.bookSummary?.brief,
    abstract: b.index?.bookSummary?.abstract,
    detailed: b.index?.bookSummary?.detailed,
  };
  for (const [lang, l] of Object.entries(b.localized || {})) fields[`localized.${lang}.summary`] = l?.summary;
  for (const [k, v] of Object.entries(fields)) {
    const hit = v && oldNames.find((n) => v.includes(n));
    if (hit) { stale++; console.log(`STALE ${r.book_id} ${k}: "${hit}"`); }
  }
}
console.log(`${repairs.length} hand-repaired books checked; ${stale} stale field(s)`);
await client.close();
process.exit(stale ? 1 : 0);
