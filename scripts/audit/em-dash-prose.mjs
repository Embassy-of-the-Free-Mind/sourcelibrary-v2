#!/usr/bin/env node
/**
 * Audit: em dashes and AI-vocabulary tells in reader-facing prose stored in Mongo (#6215, #3038).
 *
 * PRIOR ART: none that fits. I looked in scripts/audit/ and scripts/maintenance/ (`git grep -il "em.dash\|u2014"`
 *   finds only translation-prompt migrations) and in #3038. Its 2026-07-06 AI-tell detector was a one-off session
 *   script and was never committed. The CI guard in #6215 covers code copy under src/, not stored prose.
 *
 * WHAT IT COUNTS
 *   Documents whose field contains an em dash (U+2014), and separately, documents that contain one of
 *   #3038's high-confidence AI tells. Collections: description, expanded_description, subtitle,
 *   highlighted_books[].note, localized.es.{description,subtitle}. Books (live only: visible && pages_count > 0):
 *   summary.data (or a legacy string summary), description, ai_metadata.description, reading_summary.overview,
 *   and the copy the book page actually renders first: book_indexes.bookSummary.{brief,abstract,detailed}
 *   (src/app/book/[id]/page.tsx reads index.bookSummary.brief before reading_summary and summary.data).
 *   The legacy embed books.index.bookSummary.* is counted only where the book has no book_indexes summary,
 *   because that is the only case in which a reader sees it.
 *
 *   A dash inside a quotation ("..." or “...”) is counted separately as `quoted`: those are verbatim
 *   quotes of a page translation, and changing them would break the quote (quote-and-snippet-integrity.md).
 *   `--strict` fails on `em_dash` only.
 *
 *   Not counted on purpose: titles and names (a dash there can be the source's own), translations and OCR.
 *   The seven long curator essays named in #3038 keep their vocabulary, so tells are not counted in their
 *   expanded_description (dashes still are).
 *
 * USAGE (read-only)
 *   node --env-file=.env.production.local scripts/audit/em-dash-prose.mjs            # table
 *   node --env-file=.env.production.local scripts/audit/em-dash-prose.mjs --json     # machine-readable
 *   node --env-file=.env.production.local scripts/audit/em-dash-prose.mjs --samples 3  # print 3 offenders per field
 *   node --env-file=.env.production.local scripts/audit/em-dash-prose.mjs --strict   # exit 1 if any em dash remains
 */

import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) { console.error('Missing MONGODB_URI'); process.exit(2); }

const args = process.argv.slice(2);
const JSON_OUT = args.includes('--json');
const STRICT = args.includes('--strict');
const SAMPLES = args.includes('--samples') ? Number(args[args.indexOf('--samples') + 1]) || 3 : 0;

const EM_DASH = /—/;
// Quoted spans: straight or curly double quotes, no nesting. Removed before the em_dash test.
const QUOTED = /"[^"]*"|“[^”]*”/g;
// #3038's list (Kobak et al. excess vocabulary + Wikipedia "Signs of AI writing").
// "Testament to" needs a lowercase t so that "the Old Testament to ..." does not match.
const TELLS = /\b(?:profound(?:ly)?|meticulous(?:ly)?|pivotal|landscape of|not only|not merely|showcas(?:e|es|ed|ing)|interplay|intricate(?:ly)?|vibrant|delv(?:e|es|ed|ing)|tapestry|testament to)\b/i;
const TESTAMENT_TO = /\btestament to\b/;
const hasTell = (s) => { const m = s.match(TELLS); if (!m) return null; if (/^testament to$/i.test(m[0]) && !TESTAMENT_TO.test(s)) return null; return m[0]; };

const CURATOR_ESSAYS = new Set([
  'Wine & the Vine', 'Yoga', 'Accademia dei Lincei', 'The Moon', 'Art & Architecture',
  'Renaissance Architecture', 'Gardens, Festivals & the Ephemeral Arts',
].map((n) => n.toLowerCase()));

const LIVE = { visible: true, pages_count: { $gt: 0 } };
const BOOK_FIELDS = [
  ['summary.data', (b) => (typeof b.summary === 'string' ? b.summary : b.summary?.data)],
  ['description', (b) => b.description],
  ['ai_metadata.description', (b) => b.ai_metadata?.description],
  ['reading_summary.overview', (b) => b.reading_summary?.overview],
];

function tally(stats, field, text, label, { tells = true } = {}) {
  if (typeof text !== 'string' || !text) return;
  const s = (stats[field] ??= { docs: 0, em_dash: 0, quoted: 0, tell: 0, samples: [] });
  s.docs++;
  const dash = EM_DASH.test(text.replace(QUOTED, ''));
  if (!dash && EM_DASH.test(text)) s.quoted++;
  const tell = tells ? hasTell(text) : null;
  if (dash) s.em_dash++;
  if (tell) s.tell++;
  if ((dash || tell) && s.samples.length < SAMPLES) s.samples.push({ label, tell, text: text.slice(0, 240) });
}

const client = new MongoClient(MONGODB_URI);
await client.connect();
const db = client.db('bookstore');
const stats = {};
try {
  const colls = await db.collection('collections').find({}, {
    projection: { name: 1, slug: 1, description: 1, expanded_description: 1, subtitle: 1, 'highlighted_books.note': 1, 'localized.es.description': 1, 'localized.es.subtitle': 1 },
  }).toArray();
  for (const c of colls) {
    const label = `collections/${c.slug}`;
    const essay = CURATOR_ESSAYS.has((c.name || '').trim().toLowerCase());
    tally(stats, 'collections.description', c.description, label);
    tally(stats, 'collections.expanded_description', c.expanded_description, label, { tells: !essay });
    tally(stats, 'collections.subtitle', c.subtitle, label);
    for (const h of c.highlighted_books || []) tally(stats, 'collections.highlighted_books.note', h.note, label);
    tally(stats, 'collections.localized.es.description', c.localized?.es?.description, label);
    tally(stats, 'collections.localized.es.subtitle', c.localized?.es?.subtitle, label);
  }

  // Only fetch books that could match; the regex runs server-side on the live set.
  const anyHit = { $regex: `—|${TELLS.source}`, $options: 'i' };
  const docsTotal = await db.collection('books').countDocuments(LIVE);
  const cursor = db.collection('books').find(
    { ...LIVE, $or: [{ summary: anyHit }, { 'summary.data': anyHit }, { description: anyHit }, { 'ai_metadata.description': anyHit }, { 'reading_summary.overview': anyHit }] },
    { projection: { id: 1, summary: 1, description: 1, 'ai_metadata.description': 1, 'reading_summary.overview': 1 } },
  );
  for await (const b of cursor) for (const [f, get] of BOOK_FIELDS) tally(stats, `books.${f}`, get(b), `book/${b.id || b._id}`);
  for (const [f] of BOOK_FIELDS) { (stats[`books.${f}`] ??= { docs: 0, em_dash: 0, quoted: 0, tell: 0, samples: [] }); stats[`books.${f}`].docs = `${docsTotal} live`; }

  // The rendered copy. book_indexes has no visibility of its own, so restrict to live book ids.
  const SUMMARY_KEYS = ['brief', 'abstract', 'detailed'];
  const liveIds = new Set();
  for await (const b of db.collection('books').find(LIVE, { projection: { _id: 0, id: 1 } })) if (b.id) liveIds.add(b.id);
  const idxHit = { $or: SUMMARY_KEYS.map((k) => ({ [`bookSummary.${k}`]: anyHit })) };
  for await (const d of db.collection('book_indexes').find(idxHit, { projection: { book_id: 1, bookSummary: 1 } })) {
    if (!liveIds.has(d.book_id)) continue;
    for (const k of SUMMARY_KEYS) tally(stats, `book_indexes.bookSummary.${k}`, d.bookSummary?.[k], `book/${d.book_id}`);
  }
  const embHit = { ...LIVE, $or: SUMMARY_KEYS.map((k) => ({ [`index.bookSummary.${k}`]: anyHit })) };
  const emb = await db.collection('books').find(embHit, { projection: { id: 1, 'index.bookSummary': 1 } }).toArray();
  const indexed = new Set();
  for await (const d of db.collection('book_indexes').find({ book_id: { $in: emb.map((b) => b.id) }, bookSummary: { $exists: true } }, { projection: { _id: 0, book_id: 1 } })) indexed.add(d.book_id);
  for (const b of emb) {
    if (indexed.has(b.id)) continue;
    for (const k of SUMMARY_KEYS) tally(stats, `books.index.bookSummary.${k} (no book_indexes row)`, b.index?.bookSummary?.[k], `book/${b.id}`);
  }
  for (const f of Object.keys(stats)) if (/bookSummary/.test(f)) stats[f].docs = `${stats[f].docs} hit`;
} finally {
  await client.close();
}

const totalDashes = Object.values(stats).reduce((n, s) => n + s.em_dash, 0);
if (JSON_OUT) {
  console.log(JSON.stringify({ at: new Date().toISOString(), total_em_dash: totalDashes, fields: stats }, null, 2));
} else {
  console.log('field'.padEnd(58), 'docs'.padStart(12), 'em_dash'.padStart(8), 'quoted'.padStart(7), 'tell'.padStart(6));
  for (const [f, s] of Object.entries(stats)) {
    console.log(f.padEnd(58), String(s.docs).padStart(12), String(s.em_dash).padStart(8), String(s.quoted).padStart(7), String(s.tell).padStart(6));
    for (const x of s.samples) console.log(`    ${x.label}${x.tell ? ` [${x.tell}]` : ''}: ${x.text.replace(/\s+/g, ' ')}`);
  }
  console.log(`\ntotal texts with an em dash outside a quotation: ${totalDashes}`);
}
if (STRICT && totalDashes > 0) process.exit(1);
