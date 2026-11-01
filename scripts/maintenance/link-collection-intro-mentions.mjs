#!/usr/bin/env node
/**
 * Link the works and authors a collection's introduction names (#7897).
 *
 * PRIOR ART: src/app/collections/[id]/page.tsx linkBookTitles() — the renderer's
 *   auto-linker only matches a book's FULL catalogue title as a substring, so prose
 *   naming "Monas Hieroglyphica" or "Ficino" links nothing; this fills the
 *   `mentioned_books` field it already reads instead of changing the matcher.
 *   .claude/docs/collection-description-linking.md prescribes exactly this
 *   ("patching link coverage onto prose you do not want to rewrite").
 *   scripts/maintenance/relink-hidden-book-links-5049.mjs repairs links to hidden
 *   books; it does not add new ones.
 *
 * WHY: the best-written intros (Alchemy, Hermetica, Kabbalah, Yoga) rendered zero
 * links on 2026-11-01 — a reader meets a named book and has to go hunt for it.
 *
 * HOW: per collection, the description plus the collection's READABLE member books
 * (visible, pages_count > 0) and their canonical authors go to a Sonnet `claude -p`
 * on the subscription. It returns {text, book_id} / {text, author_id} pairs. Every
 * pair is then checked here, not trusted: `text` must occur verbatim in the prose,
 * every case-insensitive occurrence must sit on word boundaries (the renderer's
 * matcher has none — "Dee" would otherwise light up "indeed"), and the id must be
 * one we offered. The prose is never rewritten.
 *
 * Writes ONLY with --apply, merging into existing `mentioned_books` (an existing
 * entry's text always wins), and saves every prior value to --backup first.
 *
 *   node --env-file=.env.production.local scripts/maintenance/link-collection-intro-mentions.mjs \
 *     --slugs hermetica,alchemy [--all] [--apply] [--out FILE] [--backup FILE] [--concurrency 3]
 */
import { MongoClient } from 'mongodb';
import { spawn } from 'node:child_process';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const flag = (k) => args.includes(`--${k}`);
const APPLY = flag('apply');
const OUT = opt('out', `/tmp/collection-intro-mentions-${Date.now()}.json`);
const BACKUP = opt('backup', null);
const CONCURRENCY = Number(opt('concurrency', '3'));
const MAX_CANDIDATES = 350;
const MIN_TEXT = 5;

if (APPLY && !BACKUP) { console.error('--apply needs --backup FILE'); process.exit(1); }

const STOP = new Set(['the', 'and', 'of', 'de', 'in', 'et', 'la', 'le', 'des', 'du', 'der', 'die', 'das', 'und', 'von', 'with', 'from', 'for', 'per', 'sive', 'seu', 'cum', 'libri', 'liber', 'book', 'books', 'opera', 'omnia', 'tractatus', 'about', 'which', 'their', 'there']);
const tokens = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .split(/[^a-z0-9]+/).filter((t) => t.length >= 5 && !STOP.has(t));

function runClaude(prompt) {
  return new Promise((resolve, reject) => {
    // Subscription only: an API key in the env (.env.production.local carries one)
    // would bill the API instead (feedback: Claude only via subscription).
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY; delete env.ANTHROPIC_AUTH_TOKEN;
    const p = spawn('claude', ['-p', '--model', 'sonnet', '--output-format', 'text'], { stdio: ['pipe', 'pipe', 'pipe'], env });
    let out = '', err = '';
    const timer = setTimeout(() => { p.kill('SIGTERM'); reject(new Error('timeout')); }, 240_000);
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => { clearTimeout(timer); code === 0 ? resolve(out) : reject(new Error(`claude exit ${code}: ${err.slice(0, 300)}`)); });
    p.stdin.end(prompt);
  });
}

/** Every case-insensitive occurrence of `needle` in `hay` is a whole-word match. */
function onWordBoundaries(hay, needle) {
  const h = hay.toLowerCase(), n = needle.toLowerCase();
  let i = h.indexOf(n), seen = 0;
  const isWord = (c) => !!c && /[\p{L}\p{N}]/u.test(c);
  while (i >= 0) {
    seen++;
    if (isWord(h[i - 1]) || isWord(h[i + n.length])) return false;
    i = h.indexOf(n, i + 1);
  }
  return seen > 0;
}

// Single words that are ordinary English ("Treatise", "Mirror") would light up
// every occurrence in the prose — the renderer matches case-insensitively.
const DICT = (() => {
  try { return new Set(readFileSync('/usr/share/dict/words', 'utf8').split('\n').filter((w) => w && w === w.toLowerCase())); }
  catch { return new Set(); }
})();
const isCommonWord = (t) => !/\s/.test(t.trim()) && DICT.has(t.trim().toLowerCase());

/** A book mention must share a distinctive word with the book's own title
 *  (catalogue title or display title; 5-letter stems so "Hieroglyphica" meets
 *  "Hieroglyphic"). The model mapped "Sepher Raziel" onto *Icon philosophiae
 *  occultae* in the pilot — this is the check that refuses that. */
function sharesTitleWord(mention, book) {
  const stem = (t) => t.slice(0, 5);
  const titleStems = new Set(tokens(`${book.title || ''} ${book.display_title || ''}`).map(stem));
  return tokens(mention).some((t) => titleStems.has(stem(t)));
}

function buildPrompt(col, text, books, authors) {
  const bookLines = books.map((b) => `${b.id} | ${String(b.display_title || b.title).slice(0, 140)} | ${b.author || ''} | ${b.published || b.year || ''} | ${b.language || ''}`).join('\n');
  const authorLines = authors.map((a) => `${a.id} | ${a.name}`).join('\n');
  return `You are linking a library collection's introduction to the books and authors the library actually holds.

COLLECTION: ${col.name} (${col.slug})

INTRODUCTION:
<<<
${text}
>>>

BOOKS HELD (id | title | author | date | language):
${bookLines}

AUTHORS (author_id | canonical name):
${authorLines || '(none)'}

Task: find every WORK and every PERSON the introduction names that matches an entry above, and return the phrase to link.

Rules:
- "text" must be copied EXACTLY as it appears in the introduction (same spelling, accents, case). Use the shortest phrase that names the work unambiguously, e.g. "Monas Hieroglyphica", "Corpus Hermeticum", "Hatha Yoga Pradipika". Never include a trailing date or article.
- Link a work only if a listed book IS that work (the same text — an edition, translation or commentary of it is fine; a different work that merely shares a word is not). If the prose gives a date or language and several editions are held, pick the one that matches; otherwise the earliest original-language edition.
- Link a person only to the listed author who is that person. Use the form the prose uses ("Ficino", "John Dee"). Skip a bare surname that could mean two listed authors.
- Do not link generic words ("alchemy", "the Bible", "tantras"), series names, institutions, or anything not in the lists. When unsure, leave it out — a missing link is better than a wrong one.
- Each text at most once.

Reply with ONLY a JSON object, no prose:
{"mentions":[{"text":"...","book_id":"..."},{"text":"...","author_id":"..."}]}`;
}

async function processCollection(db, col) {
  // The prose a reader sees: the collection intro, plus — on a curated
  // exhibition page, which renders its own text — the exhibition's description
  // and section blurbs. All of it reads the same `mentioned_books`.
  const draft = await db.collection('curation_drafts').findOne({ collection_slug: col.slug, status: 'draft' }, { projection: { 'curation.layout': 1 } });
  const exhibitionText = (draft?.curation?.layout || []).flatMap((b) =>
    b.component === 'description' ? (b.paragraphs || [])
      : b.component === 'sections' ? (b.sections || []).map((x) => x.description || '')
      : b.component === 'thematic_gallery' ? (b.clusters || []).map((x) => x.description || '') : []).filter(Boolean);
  const text = [String(col.expanded_description || col.description || ''), ...exhibitionText].filter(Boolean).join('\n\n');
  const all = await db.collection('books').find(
    { collections: col.slug, visible: true, pages_count: { $gt: 0 } },
    { projection: { _id: 0, id: 1, title: 1, display_title: 1, author: 1, author_id: 1, published: 1, year: 1, language: 1 } },
  ).toArray();
  let books = all.filter((b) => b.id);
  if (books.length > MAX_CANDIDATES) {
    const prose = new Set(tokens(text));
    books = books
      .map((b) => ({ b, hit: tokens(`${b.display_title || ''} ${b.title || ''} ${b.author || ''}`).filter((t) => prose.has(t)).length }))
      .filter((x) => x.hit > 0).sort((a, b) => b.hit - a.hit).slice(0, MAX_CANDIDATES).map((x) => x.b);
  }
  const aids = [...new Set(books.map((b) => b.author_id).filter((a) => typeof a === 'string' && a))];
  const authorDocs = aids.length ? await db.collection('authors').find({ _id: { $in: aids } }, { projection: { canonical_name: 1 } }).toArray() : [];
  const authors = authorDocs.filter((a) => a.canonical_name).map((a) => ({ id: String(a._id), name: a.canonical_name }));
  if (!books.length) return { slug: col.slug, skipped: 'no readable member books', proposed: [], rejected: [] };

  let mentions = null, raw = '';
  for (let attempt = 0; attempt < 2 && !mentions; attempt++) {
    raw = await runClaude(buildPrompt(col, text, books, authors));
    const m = raw.match(/\{\s*"mentions"\s*:\s*\[[\s\S]*?\]\s*\}/);
    try { mentions = JSON.parse(m ? m[0] : raw).mentions || []; } catch { mentions = null; }
  }
  if (!mentions) return { slug: col.slug, error: 'unparseable reply', raw: raw.slice(0, 500), proposed: [], rejected: [] };

  const bookIds = new Map(books.map((b) => [b.id, b]));
  const authorIds = new Map(authors.map((a) => [a.id, a]));
  const existing = new Set((col.mentioned_books || []).map((m) => String(m.text || '').toLowerCase()));
  const proposed = [], rejected = [], seen = new Set();
  for (const m of mentions) {
    const t = String(m?.text || '').trim();
    const why = !t ? 'empty'
      : t.length < MIN_TEXT ? 'too short'
      : !text.includes(t) ? 'not verbatim in prose'
      : isCommonWord(t) ? 'common English word'
      : !onWordBoundaries(text, t) ? 'matches inside another word'
      : m.book_id && !bookIds.has(m.book_id) ? 'book not offered'
      : m.book_id && !sharesTitleWord(t, bookIds.get(m.book_id)) ? 'no title word in common'
      : m.author_id && !authorIds.has(m.author_id) ? 'author not offered'
      : !m.book_id && !m.author_id ? 'no target'
      : existing.has(t.toLowerCase()) ? 'already mentioned'
      : seen.has(t.toLowerCase()) ? 'duplicate' : null;
    if (why) { rejected.push({ ...m, why }); continue; }
    seen.add(t.toLowerCase());
    proposed.push(m.book_id
      ? { text: t, book_id: m.book_id, _title: String(bookIds.get(m.book_id).display_title || bookIds.get(m.book_id).title).slice(0, 90) }
      : { text: t, author_id: m.author_id, _name: authorIds.get(m.author_id).name });
  }
  return { slug: col.slug, candidates: books.length, proposed, rejected };
}

const client = await MongoClient.connect(process.env.MONGODB_URI);
const db = client.db('bookstore');
const slugs = opt('slugs', '').split(',').filter(Boolean);
const filter = flag('all')
  ? { hidden: { $ne: true }, visible: { $ne: false }, collection_type: { $ne: 'visual_art' }, $or: [{ expanded_description: { $type: 'string', $ne: '' } }, { description: { $type: 'string', $ne: '' } }] }
  : { slug: { $in: slugs } };
// --all: every listed collection with prose OR a curated exhibition.
const cols = await db.collection('collections').find(filter, { projection: { slug: 1, name: 1, description: 1, expanded_description: 1, mentioned_books: 1 } }).toArray();
console.log(`${cols.length} collections; ${APPLY ? 'APPLY' : 'dry run'}; report → ${OUT}`);

const results = [];
let next = 0;
async function worker() {
  while (next < cols.length) {
    const col = cols[next++];
    try { results.push(await processCollection(db, col)); }
    catch (e) { results.push({ slug: col.slug, error: String(e.message || e), proposed: [], rejected: [] }); }
    const r = results.at(-1);
    console.log(`${r.slug}: +${r.proposed.length} (${r.rejected.length} rejected)${r.error ? ' ERROR ' + r.error : ''}${r.skipped ? ' skipped: ' + r.skipped : ''}`);
    writeFileSync(OUT, JSON.stringify(results, null, 1));
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

if (APPLY) {
  const backup = existsSync(BACKUP) ? JSON.parse(readFileSync(BACKUP, 'utf8')) : {};
  for (const c of cols) if (!(c.slug in backup)) backup[c.slug] = c.mentioned_books ?? null;
  writeFileSync(BACKUP, JSON.stringify(backup, null, 1));
  let wrote = 0;
  for (const r of results) {
    if (!r.proposed.length) continue;
    const col = cols.find((c) => c.slug === r.slug);
    const add = r.proposed.map(({ _title, _name, ...m }) => m);
    const res = await db.collection('collections').updateOne({ slug: r.slug }, { $set: { mentioned_books: [...(col.mentioned_books || []), ...add] } });
    wrote += res.modifiedCount;
  }
  console.log(`modified ${wrote} collections; prior values in ${BACKUP}`);
}
await client.close();
