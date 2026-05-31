#!/usr/bin/env node
/**
 * Duplicate detection + safe resolution for the books catalog.
 *
 *   node scripts/maintenance/dedup-books.mjs            # report only (default)
 *   node scripts/maintenance/dedup-books.mjs --plan     # print the safe deletion plan
 *   node scripts/maintenance/dedup-books.mjs --execute  # soft-delete the safe plan (reversible)
 *
 * Distinguishes SAME-edition duplicates (redundant scans of one edition) from
 * DIFFERENT editions/volumes (legitimate — never touched). Only the safe subset
 * is auto-resolvable:
 *   (a) exact duplicate ia_identifier (literally the same scan imported twice)
 *   (b) an unprocessed (pages_translated≈0), hidden copy when a fully-translated
 *       copy of near-identical page count exists
 *
 * Keeper selection (evidence-based, in priority order):
 *   pages_translated > pages_ocr > native-scan(non-goog) > pages_count > visible
 * This preserves translation/OCR work — the strongest signal.
 *
 * Guards: excludes artwork (resource_type), excludes volume/part/issue titles,
 * excludes highlighted_books (would break collection pages), requires near-equal
 * page counts for the rescan case (filters periodical issues that share a title).
 * Deletions are soft (archived to deleted_books, restorable for 7 days) and the
 * removed copy's collection tags are transferred to the keeper first.
 *
 * Everything riskier (two translated/visible copies, artwork dupes, multi-edition
 * clusters) is intentionally left for human/tooled review — see the dupe issue.
 */
import { MongoClient } from 'mongodb';

const MODE = process.argv.includes('--execute') ? 'execute' : process.argv.includes('--plan') ? 'plan' : 'report';
const BASE = process.env.SL_BASE || 'https://sourcelibrary.org';
const AUTH = { Authorization: `Bearer ${process.env.CRON_SECRET}` };

const norm = (t) => (t || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ')
  .replace(/\b(the|a|an|of|and|or|to|de|la|le|des|being|or)\b/g, ' ').replace(/\s+/g, ' ').trim();
const surname = (a) => { if (!a) return ''; a = String(a).replace(/\(.*?\)/g, '').split(/[,;(]/)[0].trim(); const p = a.split(/\s+/).filter(Boolean); return (p[p.length - 1] || '').toLowerCase().replace(/[^a-z]/g, ''); };
const VOL = /\b(vol|volume|tome|tomus|band|deel|teil|part|livre|bd|pt|no|nr|heft|issue)\b/i;
const score = (b) => [b.pages_translated || 0, b.pages_ocr || 0, /goog$/.test(b.ia_identifier || '') ? 0 : 1, b.pages_count || 0, b.visible ? 1 : 0];
const better = (a, b) => { const x = score(a), y = score(b); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] > y[i] ? a : b; return a; };
const near = (a, b) => { const x = a || 0, y = b || 0; if (!x || !y) return false; return Math.abs(x - y) / Math.max(x, y) <= 0.25; };

const client = new MongoClient(process.env.MONGODB_URI); await client.connect();
const db = client.db('bookstore');
const all = await db.collection('books').find({ content_type: { $ne: 'artwork' } },
  { projection: { id: 1, title: 1, display_title: 1, author: 1, year: 1, language: 1, ia_identifier: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1, visible: 1, collections: 1, resource_type: 1 } }).toArray();
const books = all.filter((b) => !b.resource_type);
const cols = await db.collection('collections').find({}, { projection: { highlighted_books: 1 } }).toArray();
const highlighted = new Set();
for (const cc of cols) for (const h of (cc.highlighted_books || [])) if (h.book_id) highlighted.add(h.book_id);

const plan = [];
const byIa = {};
for (const b of books) if (b.ia_identifier) (byIa[b.ia_identifier] = byIa[b.ia_identifier] || []).push(b);
for (const v of Object.values(byIa)) { if (v.length < 2) continue; const keep = v.reduce(better); for (const b of v) if (b.id !== keep.id && !highlighted.has(b.id)) plan.push({ del: b, keep, reason: 'exact-dup-ia' }); }

const g = {};
for (const b of books) { const t = b.display_title || b.title || ''; if (VOL.test(t)) continue; const k = `${norm(t)}|${surname(b.author)}|${b.year || '?'}|${(b.language || '?').toLowerCase()}`; if (norm(t).length < 6 || !surname(b.author)) continue; (g[k] = g[k] || []).push(b); }
for (const v of Object.values(g)) {
  if (v.length < 2) continue; const keep = v.reduce(better); if ((keep.pages_translated || 0) < 20) continue;
  for (const b of v) { if (b.id === keep.id || highlighted.has(b.id)) continue;
    const unproc = (b.pages_translated || 0) < 0.1 * (keep.pages_translated || 1);
    if (unproc && b.visible === false && near(b.pages_count, keep.pages_count) && !plan.find((p) => p.del.id === b.id)) plan.push({ del: b, keep, reason: 'unprocessed-hidden-rescan' });
  }
}

if (MODE === 'report' || MODE === 'plan') {
  const byR = {}; for (const p of plan) byR[p.reason] = (byR[p.reason] || 0) + 1;
  console.log(`Safe auto-resolvable plan: ${plan.length} deletions — ${JSON.stringify(byR)}`);
  if (MODE === 'plan') for (const p of plan) console.log(`  [${p.reason}] DEL ${p.del.id} (${p.del.ia_identifier || 'no-ia'}) -> KEEP ${p.keep.id} | ${(p.keep.display_title || p.keep.title || '').slice(0, 40)}`);
  console.log('\nRun with --execute to soft-delete (reversible). Riskier dupes are out of scope — see the dupe-audit issue.');
} else {
  let ok = 0;
  for (const p of plan) {
    if ((p.del.collections || []).length) { const kb = await db.collection('books').findOne({ id: p.keep.id }, { projection: { collections: 1 } }); const xfer = p.del.collections.filter((s) => !(kb?.collections || []).includes(s)); if (xfer.length) await db.collection('books').updateOne({ id: p.keep.id }, { $addToSet: { collections: { $each: xfer } }, $currentDate: { updated_at: true } }); }
    const r = await fetch(`${BASE}/api/books/${p.del.id}`, { method: 'DELETE', headers: AUTH });
    if (r.ok) ok++; else console.log(`  FAIL ${r.status} ${p.del.id}`);
  }
  console.log(`Soft-deleted ${ok}/${plan.length}. Re-run sync-books-catalog.mjs afterward.`);
}
await client.close();
