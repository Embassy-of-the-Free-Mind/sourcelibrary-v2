#!/usr/bin/env node
/**
 * Standing detector: authored prose that links a book readers cannot see (#5049).
 *
 * Blog posts, collection intros and other hand-written pages link
 * `/book/<id-or-slug>`. Nothing checked that the linked book is visible. On
 * 2026-09-24 the Techniques of the Body page shipped a link to Opsopoeus 1607
 * (69bd9dc46120d54bd0379640, hidden_reason: unprocessed); fixed in #5044.
 *
 * A curl check cannot see this: a hidden book still serves its pages with a 200,
 * so scripts/maintenance/check-blog-links.mjs (HTTP, soft-404 titles) passes it.
 * This script asks Mongo instead: every linked ref is resolved the way the
 * /book route does (slug, id, _id, then slug_aliases — src/lib/book-lookup.ts)
 * and the book must be `visible: true`.
 *
 * Sources scanned:
 *   - files: every text file under src/app/articles/ (posts keep their prose in
 *     page.tsx AND in document.json), src/data/, src/components/, and every
 *     page.tsx under src/app/ outside admin/ and api/
 *   - Mongo `collections` (visible ones): `description`, `expanded_description`
 *     inline links, and `mentioned_books[].book_id`
 *
 * A ref that resolves to no book is reported but does not fail the run: that is
 * a dead link, which the HTTP checker already owns.
 *
 * Exit 0 = clean, 1 = at least one hidden book linked, 2 = Mongo unreachable
 * (never a silent "clean").
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/audit/authored-links-hidden-books.mjs
 *   ... --json                 machine-readable report on stdout
 *   ... --extra-file <path>    also scan this file (negative control: point it
 *                              at a file linking a hidden id and expect exit 1)
 *
 * PRIOR ART: scripts/maintenance/check-blog-links.mjs — HTTP-only, so it cannot
 * tell a hidden book from a visible one (both answer 200); it also skips
 * document.json and collection prose. scripts/audit/gallery-visibility-leak.mjs —
 * same question for gallery images, not links in prose.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { MongoClient, ObjectId } from 'mongodb';

const args = process.argv.slice(2);
const JSON_OUT = args.includes('--json');
const extraFiles = [];
for (let i = 0; i < args.length; i++) if (args[i] === '--extra-file') extraFiles.push(args[++i]);

const TEXT_FILE = /\.(tsx?|jsx?|mdx?|json|html)$/;
function walk(dir, keep, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === 'generated') continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, keep, out);
    else if (keep(p, entry)) out.push(p);
  }
  return out;
}
const notTest = (p) => !/\.test\.|__tests__/.test(p);
const files = [...new Set([
  ...walk('src/app/articles', (p, e) => TEXT_FILE.test(e) && notTest(p)),
  ...walk('src/data', (p, e) => TEXT_FILE.test(e) && notTest(p)),
  ...walk('src/components', (p, e) => TEXT_FILE.test(e) && notTest(p)),
  ...walk('src/app', (p, e) => e === 'page.tsx' && !/src\/app\/(admin|api)\//.test(p.replace(/\\/g, '/'))),
  ...extraFiles,
])];

// `/book/<ref>` as a literal: relative, absolute, or JSON-escaped (`\/book\/`).
// Template-literal refs (`/book/${id}`) and route patterns (`/book/[id]`) do not
// match the ref class, so they are skipped. A ref ends at the first character a
// slug cannot hold; a trailing '.' is prose punctuation, not part of the slug.
// Module paths (`@/components/book/X`, `src/app/book/…`) are not links.
const LINK_RE = /(?<!(?:components|lib|app|types))\\?\/book\\?\/([A-Za-z0-9][A-Za-z0-9._~-]*)/g;
const cleanRef = (r) => r.replace(/[.~-]+$/, '');

/** ref -> Set of "where" labels */
const refs = new Map();
const add = (ref, where) => {
  ref = cleanRef(ref);
  if (ref.length < 6) return; // `/book/foo` placeholders in examples
  if (!refs.has(ref)) refs.set(ref, new Set());
  refs.get(ref).add(where);
};

for (const file of files) {
  let src;
  try { src = readFileSync(file, 'utf8'); } catch { continue; }
  for (const m of src.matchAll(LINK_RE)) add(m[1], file);
}

const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI not set'); process.exit(2); }
let client;
try {
  client = new MongoClient(uri, { maxPoolSize: 2, serverSelectionTimeoutMS: 15000 });
  await client.connect();
} catch (err) {
  console.error(`Cannot reach Mongo: ${err.message}`);
  process.exit(2);
}
const db = client.db('bookstore');
const books = db.collection('books');

// Collection prose renders only on visible collections (src/app/collections/[id]).
const cols = await db.collection('collections')
  .find({ visible: { $ne: false } })
  .project({ slug: 1, description: 1, expanded_description: 1, mentioned_books: 1 })
  .toArray();
for (const c of cols) {
  const where = `collections:${c.slug}`;
  for (const field of ['description', 'expanded_description']) {
    if (typeof c[field] === 'string') for (const m of c[field].matchAll(LINK_RE)) add(m[1], `${where}.${field}`);
  }
  for (const mb of Array.isArray(c.mentioned_books) ? c.mentioned_books : []) {
    if (mb?.book_id) add(String(mb.book_id), `${where}.mentioned_books`);
  }
}

// Resolve every ref in bulk, in the /book route's order: slug, id, _id, slug_aliases.
const PROJ = { id: 1, slug: 1, slug_aliases: 1, title: 1, visible: 1, hidden_reason: 1, duplicate_of: 1 };
const all = [...refs.keys()];
const oids = all.filter(r => /^[0-9a-f]{24}$/i.test(r)).map(r => new ObjectId(r));
const found = await books.find({
  $or: [{ slug: { $in: all } }, { id: { $in: all } }, { _id: { $in: oids } }],
}).project(PROJ).toArray();
const bySlug = new Map(), byId = new Map(), byOid = new Map();
for (const b of found) {
  if (b.slug) bySlug.set(b.slug, b);
  if (b.id) byId.set(b.id, b);
  byOid.set(String(b._id), b);
}
const misses = all.filter(r => !bySlug.has(r) && !byId.has(r) && !byOid.has(r.toLowerCase()));
const byAlias = new Map();
if (misses.length) {
  for (const b of await books.find({ slug_aliases: { $in: misses } }).project(PROJ).toArray()) {
    for (const a of b.slug_aliases || []) byAlias.set(a, b);
  }
}
const resolve = (r) => bySlug.get(r) || byId.get(r) || byOid.get(r.toLowerCase()) || byAlias.get(r) || null;

const hidden = [];
const unresolved = [];
for (const [ref, where] of refs) {
  const b = resolve(ref);
  if (!b) { unresolved.push({ ref, where: [...where] }); continue; }
  if (b.visible !== true) {
    let keeper = null;
    if (b.duplicate_of) {
      const k = await books.findOne({ id: b.duplicate_of, visible: true }, { projection: { slug: 1, id: 1 } });
      if (k) keeper = k.slug || k.id;
    }
    hidden.push({
      ref, id: b.id, title: String(b.title || '').slice(0, 80),
      visible: b.visible ?? null, hidden_reason: b.hidden_reason ?? null,
      visible_keeper: keeper, where: [...where].sort(),
    });
  }
}
await client.close();

hidden.sort((a, b) => a.where[0].localeCompare(b.where[0]));
if (JSON_OUT) {
  console.log(JSON.stringify({ files: files.length, collections: cols.length, refs: refs.size, hidden, unresolved }, null, 2));
} else {
  console.log(`Scanned ${files.length} files and ${cols.length} visible collections: ${refs.size} unique /book/ refs.`);
  console.log(`Unresolved (no such book; the HTTP link checker owns these): ${unresolved.length}`);
  for (const u of unresolved) console.log(`  ${u.ref}  in ${u.where.join(', ')}`);
  console.log(`\nLinked but NOT visible: ${hidden.length}`);
  for (const h of hidden) {
    console.log(`  /book/${h.ref}  [${h.id}] visible=${h.visible} hidden_reason=${h.hidden_reason ?? '-'}`);
    console.log(`    "${h.title}"`);
    if (h.visible_keeper) console.log(`    visible keeper: /book/${h.visible_keeper}`);
    for (const w of h.where) console.log(`    in ${w}`);
  }
}

if (hidden.length > 0) {
  if (!JSON_OUT) console.error('\nFAIL: authored prose links hidden books. Relink to a visible edition, or unlink (keep the title as plain text).');
  process.exit(1);
}
if (!JSON_OUT) console.log('\nClean.');
