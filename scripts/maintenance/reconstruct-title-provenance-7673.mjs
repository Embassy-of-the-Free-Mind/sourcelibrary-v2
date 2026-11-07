#!/usr/bin/env node
// PRIOR ART: scripts/maintenance/apply-byline-proposals-3894.mjs — the model catalogue writer (dry run, sweep_log row
// before the write, one stamp per field); it CHANGES values from title-page reads, this only stamps values already
// stored. scripts/enrichment/fetch-bib-records.mjs fetches catalogue records but writes values, not attestations.
// scripts/audit/field-provenance.ts measures coverage; it does not look outside the database.
/**
 * Reconstruct where an unstamped title or author came from, by comparing it with the holding library's own catalogue
 * record (#7673).
 *
 * WHY. 94% of visible titles and 92% of authors carry no field_provenance stamp (audit, 2026-10-28). Most were copied
 * from the source library's record at import, before stamping existed — but "probably" is not provenance. The record
 * is still online: the IIIF manifest the images come from, or the Internet Archive's metadata. Where the stored value
 * matches it, that match is evidence, checked today, and is stamped as such. Where it does not, nothing is written:
 * the value was rewritten by something, and guessing what would be a false stamp (data-provenance.md §10).
 *
 * Grades, per field (normalised: case, accents and punctuation folded):
 *   exact         the record holds the same string                      → stamped, confidence high
 *   leading_part  the stored value is the record's opening words         → stamped, confidence medium
 *                 (an import that cut a long title; an author without dates)
 *   extends       the stored value is the record's plus more (a volume label added)   → reported, not stamped
 *   differs       rewritten since import, by a writer not recorded        → reported, not stamped
 *   no_record     the record is unreachable or has no such field          → reported
 *
 * Measured on 200 random unstamped visible books (2026-10-29): titles exact 35%, leading_part 8%, extends 20%,
 * differs 30%, no record 7%.
 *
 * Every book's grade, with the record's value, goes to the --out JSONL, so the `differs` set can be worked from it
 * (book_revisions, sweep_log, gemini_usage) without fetching again.
 *
 *   node --env-file=.env.production.local scripts/maintenance/reconstruct-title-provenance-7673.mjs --limit 300
 *   … --apply                   write the stamps (default: dry run)
 *   … --provider e-rara         one provider
 *   … --out /path/report.jsonl  (default scripts/output/reconstruct-title-provenance-7673.jsonl)
 *   … --concurrency 6
 */
import { MongoClient } from 'mongodb';
import { createWriteStream, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { buildAttestation } from '../lib/catalogue-fields.mjs';
import { recordSweepActions } from '../lib/sweep-log.mjs';

const SCRIPT = 'scripts/maintenance/reconstruct-title-provenance-7673.mjs';
const SWEEP = 'reconstruct-title-provenance-7673';
const FIELDS = ['title', 'author'];
const args = process.argv.slice(2);
const val = (k, d) => { const i = args.indexOf(k); return i > -1 ? args[i + 1] : d; };
const APPLY = args.includes('--apply');
const LIMIT = Number(val('--limit', 0));
const PROVIDER = val('--provider', null);
const OUT = val('--out', 'scripts/output/reconstruct-title-provenance-7673.jsonl');
const CONCURRENCY = Number(val('--concurrency', 6));

export const norm = (s) => String(s ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Grade a stored value against the record's candidates. Leading parts must end on a word boundary. */
export function grade(ours, theirs, minLead) {
  const o = norm(ours);
  if (!o) return { match: 'empty' };
  const ts = theirs.map((t) => [t, norm(t)]).filter(([, n]) => n);
  if (!ts.length) return { match: 'no_record' };
  const hit = (pred) => ts.find(([, n]) => pred(n));
  let h;
  if ((h = hit((n) => n === o))) return { match: 'exact', record_value: h[0] };
  if (o.length >= minLead && (h = hit((n) => n.startsWith(o + ' ')))) return { match: 'leading_part', record_value: h[0] };
  if ((h = hit((n) => n.length >= minLead && o.startsWith(n + ' ')))) return { match: 'extends', record_value: h[0] };
  return { match: 'differs', record_value: ts[0][0] };
}

const flat = (v) => (v == null ? [] : Array.isArray(v) ? v.flatMap(flat)
  : typeof v === 'object' ? flat(v['@value'] ?? Object.values(v)) : [String(v)]);

/** The holding library's record: { record_url, title: [], author: [] } or { error }. */
async function fetchRecord(b) {
  const manifest = b.image_source?.iiif_manifest || b.catalog_metadata?.manifest_url;
  try {
    if (b.ia_identifier) {
      const r = await fetch(`https://archive.org/metadata/${encodeURIComponent(b.ia_identifier)}/metadata`, { signal: AbortSignal.timeout(20000) });
      const m = (await r.json()).result || {};
      return { record_url: `https://archive.org/details/${b.ia_identifier}`, kind: 'internet_archive_metadata', title: flat(m.title), author: flat(m.creator) };
    }
    if (manifest) {
      const r = await fetch(manifest, { signal: AbortSignal.timeout(20000), headers: { accept: 'application/json' } });
      const j = await r.json();
      const rec = { record_url: manifest, kind: 'iiif_manifest', title: flat(j.label), author: [] };
      for (const p of j.metadata || []) {
        const label = norm(flat(p.label).join(' '));
        const value = flat(p.value).join(' ');
        if (/\b(title|titel|titre|titolo|titulo)\b/.test(label)) rec.title.push(value);
        if (/\b(author|authors|creator|auteur|autor|verfasser|contributor|who)\b/.test(label)) rec.author.push(value);
      }
      return rec;
    }
    return { error: 'no_source_link' };
  } catch (e) {
    return { error: `fetch_failed: ${e.name}` };
  }
}

function noteFor(match, kind, day) {
  const where = kind === 'internet_archive_metadata' ? "the Internet Archive's record" : "the holding library's catalogue record";
  return match === 'exact'
    ? `Matches ${where} (checked ${day}).`
    : `The opening of the entry in ${where} (checked ${day}).`;
}

async function main() {
  const c = new MongoClient(process.env.MONGODB_URI);
  await c.connect();
  const db = c.db('bookstore');
  const books = db.collection('books');
  const q = {
    visible: true, pages_count: { $gt: 0 },
    $or: FIELDS.map((f) => ({ [`field_provenance.${f}`]: { $exists: false }, [f]: { $nin: [null, ''] } })),
  };
  if (PROVIDER) q['image_source.provider'] = PROVIDER;
  const proj = { id: 1, title: 1, author: 1, ia_identifier: 1, 'image_source.provider': 1, 'image_source.iiif_manifest': 1,
    'catalog_metadata.manifest_url': 1, 'field_provenance.title': 1, 'field_provenance.author': 1 };
  let cursor = books.find(q, { projection: proj }).sort({ _id: 1 });
  if (LIMIT) cursor = cursor.limit(LIMIT);
  const todo = await cursor.toArray();
  mkdirSync(dirname(OUT), { recursive: true });
  const out = createWriteStream(OUT, { flags: 'a' });
  const day = new Date().toISOString().slice(0, 10);
  const tally = {};
  let stamped = 0, raced = 0, i = 0;
  console.log(`${todo.length} books with an unstamped title or author${PROVIDER ? ` (${PROVIDER})` : ''} · ${APPLY ? 'APPLY' : 'dry run'}`);

  async function one(b) {
    const rec = await fetchRecord(b);
    const row = { book_id: b.id ?? String(b._id), provider: b.image_source?.provider ?? null, record_url: rec.record_url ?? null, error: rec.error ?? null, fields: {} };
    const writes = [];
    for (const f of FIELDS) {
      if (b.field_provenance?.[f] || !b[f]) continue;
      const g = rec.error ? { match: 'no_record' } : grade(b[f], rec[f] || [], f === 'title' ? 12 : 8);
      row.fields[f] = { stored: b[f], ...g };
      const key = `${f}:${g.match}`; tally[key] = (tally[key] || 0) + 1;
      if (g.match !== 'exact' && g.match !== 'leading_part') continue;
      writes.push(buildAttestation(b, f, {
        source: 'source_catalogue', script: SCRIPT, method: 'reconstructed_match', match: g.match,
        record_url: rec.record_url, record_kind: rec.kind, record_value: String(g.record_value).slice(0, 500),
        provider: b.image_source?.provider ?? null, confidence: g.match === 'exact' ? 'high' : 'medium',
        note: noteFor(g.match, rec.kind, day), checked_at: new Date(),
      }));
    }
    out.write(JSON.stringify(row) + '\n');
    if (!APPLY || !writes.length) return;
    // The run's record lands before the write it describes (lesson: a sweep logs before it writes).
    await recordSweepActions(db, writes.map((w) => ({ sweep: SWEEP, book_id: row.book_id, action: 'stamp-reconstructed',
      detail: { fields: Object.keys(w.update.$set), record_url: rec.record_url } })));
    for (const w of writes) {
      const r = await books.updateOne(w.filter, w.update);
      if (r.modifiedCount === 1) stamped++; else raced++;
    }
  }

  const queue = [...todo];
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) {
      await one(queue.shift());
      if (++i % 500 === 0) console.log(`  ${i}/${todo.length} · stamped ${stamped} · ${JSON.stringify(tally)}`);
    }
  }));
  out.end();
  console.log(JSON.stringify({ books: todo.length, tally, stamped, raced_or_changed: raced, report: OUT }, null, 1));
  await c.close();
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(2); });
