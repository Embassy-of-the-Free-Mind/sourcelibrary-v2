#!/usr/bin/env node
// Passages for arms B, C and D (#8142). Seeded; retrieval is the existing page-vector search through the production
// API, the route that reaches it from this box (the service's own token is not on gex45).
// PRIOR ART: /api/search/semantic?level=page (global) and /api/books/:id/search (its semantic leg, scoped to one book)
// are semanticPageSearchGlobal / semanticPageSearchScoped; nothing here builds a search. Text cleaning is
// scripts/lib/strip-editorial-wrappers.mjs + strip-markup-tags.mjs.
//
//   node --env-file=/root/sourcelibrary/.env.production.local select-passages.mjs inventory      # inventory.json from wisdom-texts.md
//   node --env-file=... select-passages.mjs select --set pilots|test                              # $OUT/passages-<set>.jsonl, resumable
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient, ObjectId } from 'mongodb';
import { readJson, here, OUT, SCRATCH, sha256, words, wc, shuffled, seedOf, appendJsonl, readJsonl } from './lib.mjs';
import { makeRng } from '../lib/paired-stats.mjs';
import { stripEditorialWrappers } from '../../lib/strip-editorial-wrappers.mjs';
import { stripMarkupTags } from '../../lib/strip-markup-tags.mjs';

const MIN_WORDS = 100, MAX_WORDS = 300, PER_ARM = 5;
const API = 'https://sourcelibrary.org';
const KEY = fs.readFileSync('/root/.sl-internal-key', 'utf8').trim();
const INVENTORY_MD = path.join(SCRATCH, 'ch/concepts/wisdom/research/wisdom-texts.md');
const ID_RE = /\b([0-9a-f]{24}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/g;

// The critique's genre groups (first comment on #8142), applied to the inventory's rows by work name. Exploratory only.
const GENRE_RULES = [
  ['weighing', /Qohelet|Job \(|Plato,|Aristotle|Aquinas|Montaigne|Lunyu|Charron|Cicero|Seneca|Boethius|Eloquent Peasant|Dialogue of Pessimism|Ludlul|Maimonides|Ibn Rushd|Mengzi|Agrippa, \*De incertitudine|Kant|Schopenhauer|Cusa/],
  ['instruction', /Šuruppag|Sumerian proverb|Ptahhotep|Merikare|Amenemope|Proverbs|Ben Sira|Pirqe Avot|Hesiod|Dhammapada|Pañcatantra|Hitopadeśa|Arthaśāstra|Cāṇakya|Tirukku|Nālaṭiyār|Dhammanīti|Gracián|Gulistān|Kalīla|Mivḥar|Pand-nāma|Huehuetlahtolli|Speculum sapientiae|Ahlâk|Shahnama|Lam rim/],
  ['insight', /Zhuangzi|Daodejing|Prajñā|Vajracchedikā|Mūlamadhyamaka|Bodhicaryāvatāra|Upaniṣad|Bhagavad|Milinda|prajñā|Ḥikmat|Hymn to/i],
  ['revealed', /Qur'an|Wisdom of Solomon|John 1|Pistis Sophia|Fama|Pordage|Philo/],
];

function parseInventory() {
  const md = fs.readFileSync(INVENTORY_MD, 'utf8');
  const rows = [];
  for (const line of md.split('\n')) {
    if (!line.startsWith('| ') || line.startsWith('| Work') || line.startsWith('|---')) continue;
    const c = line.split('|').map((s) => s.trim());
    const [work, tradition, date, genre, aboutTeaches, held] = c.slice(1, 7);
    if (!/^(about|teaches|both)$/.test(aboutTeaches)) continue;
    const ids = [...new Set([...held.matchAll(ID_RE)].map((m) => m[1]))];
    const klass = (GENRE_RULES.find(([, re]) => re.test(work)) || ['other'])[0];
    rows.push({ work, tradition, date, native_genre: genre, about_teaches: aboutTeaches, book_ids: ids, genre_class: klass });
  }
  return { source: 'JDerekLomas/conceptual-histories concepts/wisdom/research/wisdom-texts.md', source_sha256: sha256(md), rows };
}

export function cleanText(raw) {
  return stripMarkupTags(stripEditorialWrappers(String(raw || '')))
    .replace(/->|<-/g, ' ').replace(/\[\[[^\]]*\]\]/g, ' ').replace(/[*_#]+/g, ' ').replace(/\s+/g, ' ').trim();
}

const sentences = (t) => t.match(/[^.!?;:]+[.!?;:]+["')\]]*\s*|[^.!?;:]+$/g) || [];

/** Up to MAX_WORDS from the sentence holding `anchor`; extended backwards if short. Null when under MIN_WORDS. */
export function passageWindow(text, anchor = 0) {
  const ss = sentences(text);
  if (!ss.length) return null;
  let at = 0, pos = 0, startIdx = 0;
  for (let i = 0; i < ss.length; i++) { if (pos + ss[i].length > anchor) { startIdx = i; break; } pos += ss[i].length; at = i; }
  let lo = startIdx, hi = startIdx, n = wc(ss[startIdx]);
  if (n > MAX_WORDS) return null;
  while (hi + 1 < ss.length && n + wc(ss[hi + 1]) <= MAX_WORDS) { hi++; n += wc(ss[hi]); }
  while (n < MIN_WORDS && lo > 0 && n + wc(ss[lo - 1]) <= MAX_WORDS) { lo--; n += wc(ss[lo]); }
  if (n < MIN_WORDS) return null;
  return ss.slice(lo, hi + 1).join('').trim();
}

const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
/** A work key: work_id when the book has one, else author + the start of the title (editions of an unlinked work). */
const workKey = (b) => (b.work_id ? `w:${b.work_id}` : `t:${norm(b.author).slice(0, 24)}|${norm(b.title).slice(0, 32)}`);

async function apiGet(url) {
  for (let i = 0; i < 4; i++) {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${KEY}` }, signal: AbortSignal.timeout(60000) });
    if (r.ok) return r.json();
    if (r.status === 404) return null;
    await new Promise((s) => setTimeout(s, 2000 * (i + 1)));
  }
  throw new Error(`API failed: ${url.slice(0, 120)}`);
}

async function main() {
  const [cmd] = process.argv.slice(2);
  if (cmd === 'inventory') {
    const inv = parseInventory();
    fs.writeFileSync(here('inventory.json'), JSON.stringify(inv, null, 1));
    const by = {}; for (const r of inv.rows) by[r.genre_class] = (by[r.genre_class] || 0) + 1;
    console.log(inv.rows.length, 'rows', by, 'teaching rows held', inv.rows.filter((r) => r.about_teaches !== 'about' && r.book_ids.length).length);
    return;
  }
  const set = process.argv[process.argv.indexOf('--set') + 1];
  const d = readJson(here('dilemmas.json'));
  const dilemmas = set === 'pilots' ? d.pilots : [...d.dilemmas, ...readJson(here('known-selected.json')).selected];
  const client = await MongoClient.connect(process.env.MONGODB_URI);
  const db = client.db(process.env.MONGODB_DB || 'bookstore');
  const books = db.collection('books'), pages = db.collection('pages');

  const inv = readJson(here('inventory.json'));
  const PROJ = { id: 1, title: 1, author: 1, work_id: 1, visible: 1, pages_count: 1, pages_translated: 1, language: 1 };
  const invIds = [...new Set(inv.rows.flatMap((r) => r.book_ids))];
  const invBooks = await books.find({ id: { $in: invIds } }, { projection: PROJ }).toArray();
  // "English translation text": a book printed in English has no translation in that sense, even if a field holds text.
  const notEnglish = (b) => !/^(english|en|eng)$/i.test(String(Array.isArray(b.language) ? b.language[0] : b.language || '').trim());
  const live = (b) => b && b.visible === true && b.pages_count > 0 && notEnglish(b);
  const bookById = new Map(invBooks.map((b) => [b.id, b]));
  // A genre tag follows the work: an edition linked by work_id carries its row's tag too.
  const rowOfBook = new Map(); const rowOfWorkId = new Map();
  for (const r of inv.rows) for (const id of r.book_ids) { rowOfBook.set(id, r); const w = bookById.get(id)?.work_id; if (w) rowOfWorkId.set(w, r); }
  const genreOf = (b) => { const r = rowOfBook.get(b.id) || (b.work_id && rowOfWorkId.get(b.work_id)); return r ? { work: r.work, native_genre: r.native_genre, genre_class: r.genre_class, about_teaches: r.about_teaches } : { genre_class: 'not-in-inventory' }; };
  const teaching = inv.rows.filter((r) => r.about_teaches !== 'about').flatMap((r) => r.book_ids.map((id) => ({ id, row: r })));
  const dBooks = teaching.filter(({ id }) => live(bookById.get(id)) && bookById.get(id).pages_translated > 0);
  console.log(`arm D frame: ${dBooks.length} live translated books of ${teaching.length} listed under teaching rows`);

  const pool = await books.find({ visible: true, pages_count: { $gt: 0 }, pages_translated: { $gt: 0 } }, { projection: { id: 1, pages_count: 1, pages_translated: 1, language: 1 } }).sort({ id: 1 }).toArray().then((xs) => xs.filter(notEnglish));
  const cum = []; let total = 0; for (const b of pool) { total += b.pages_translated; cum.push(total); }
  console.log(`arm B frame: ${pool.length} books, ${total} translated pages`);
  const pick = (u) => { let lo = 0, hi = cum.length - 1; const t = u * total; while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] > t) hi = m; else lo = m + 1; } return pool[lo]; };

  const usable = (p) => p && (p.page_type === 'text' || p.page_type == null) && p.translation?.data && !p.translation_withheld;
  async function fetchPage(where) { return pages.findOne(where, { projection: { id: 1, book_id: 1, page_number: 1, page_type: 1, 'translation.data': 1, translation_withheld: 1 } }); }

  const file = path.join(OUT, `passages-${set}.jsonl`);
  const done = new Set(readJsonl(file).map((r) => `${r.dilemma}:${r.arm}`));
  const passageOf = (armLabel, dilemma, book, page, text, extra) => ({ dilemma, arm: armLabel, book_id: book.id, page_number: page.page_number, page_id: page.id || String(page._id), title: book.title, author: book.author, words: wc(text), text, genre: genreOf(book), ...extra });

  /** Walk a ranked list; first PER_ARM usable passages, at most one per work. */
  async function fromRanked(rows, armLabel, dilemma, keyOf) {
    const seen = new Set(), out = [], rejected = [];
    for (const row of rows) {
      if (out.length >= PER_ARM) break;
      const book = bookById.get(row.book_id) || await books.findOne({ id: row.book_id }, { projection: PROJ });
      if (book) bookById.set(book.id, book);
      if (!live(book)) { rejected.push([row.page_id, 'not live']); continue; }
      const k = keyOf(book);
      if (seen.has(k)) { rejected.push([row.page_id, 'same work']); continue; }
      const page = await fetchPage(row.page_id && /^[0-9a-f]{24}$/.test(row.page_id) ? { $or: [{ id: row.page_id }, { _id: new ObjectId(row.page_id) }] } : { id: row.page_id });
      if (!usable(page)) { rejected.push([row.page_id, 'not body translation']); continue; }
      const text = cleanText(page.translation.data);
      const anchor = row.snippet ? Math.max(0, text.indexOf(cleanText(row.snippet).slice(0, 40))) : 0;
      const win = passageWindow(text, anchor);
      if (!win) { rejected.push([row.page_id, 'outside length band']); continue; }
      seen.add(k);
      out.push(passageOf(armLabel, dilemma, book, page, win, { similarity: row.score ?? row.similarity ?? null, rank: out.length + 1 }));
    }
    return { out, rejected };
  }

  for (const dil of dilemmas) {
    if (!done.has(`${dil.id}:C`)) {
      const res = await apiGet(`${API}/api/search/semantic?q=${encodeURIComponent(dil.text)}&level=page&limit=50&diversity=off&exclude_languages=English`);
      const rows = (res?.results || []).filter((r) => r.text_lane !== 'original');
      const { out, rejected } = await fromRanked(rows, 'C', dil.id, workKey);
      for (const p of out) appendJsonl(file, p);
      appendJsonl(path.join(OUT, `passages-${set}-log.jsonl`), { dilemma: dil.id, arm: 'C', got: out.length, candidates: rows.length, rejected });
      console.log(dil.id, 'C', out.length, 'of', rows.length, out.map((p) => p.genre.genre_class).join(','));
    }
    if (!done.has(`${dil.id}:D`)) {
      const rows = [];
      for (const { id } of dBooks) {
        const res = await apiGet(`${API}/api/books/${id}/search?q=${encodeURIComponent(dil.text)}&limit=20`);
        for (const r of res?.results || []) if (r.similarity != null) rows.push({ page_id: r.pageId, book_id: id, score: r.similarity, snippet: r.matches?.find((m) => m.field === 'translation')?.snippet?.replace(/^\.\.\.|\.\.\.$/g, '') });
      }
      rows.sort((a, b) => b.score - a.score || (a.page_id < b.page_id ? -1 : 1));
      // One per inventory work (the row), not per edition: the inventory is what defines a work in this arm.
      const { out, rejected } = await fromRanked(rows, 'D', dil.id, (b) => rowOfBook.get(b.id)?.work || workKey(b));
      for (const p of out) appendJsonl(file, p);
      appendJsonl(path.join(OUT, `passages-${set}-log.jsonl`), { dilemma: dil.id, arm: 'D', got: out.length, candidates: rows.length, rejected });
      console.log(dil.id, 'D', out.length, 'of', rows.length, out.map((p) => p.genre.genre_class).join(','));
    }
    if (!done.has(`${dil.id}:B`)) {
      const rng = makeRng(seedOf(`B:${dil.id}`));
      const seen = new Set(), out = []; let tries = 0;
      while (out.length < PER_ARM && tries < 400) {
        tries++;
        const b = pick(rng());
        const n = 1 + Math.floor(rng() * b.pages_count);
        const u = rng();
        const book = bookById.get(b.id) || await books.findOne({ id: b.id }, { projection: PROJ });
        if (book) bookById.set(book.id, book);
        if (!live(book) || seen.has(workKey(book))) continue;
        const page = await fetchPage({ book_id: b.id, page_number: n });
        if (!usable(page)) continue;
        const text = cleanText(page.translation.data);
        const win = passageWindow(text, Math.floor(u * text.length));
        if (!win) continue;
        seen.add(workKey(book));
        out.push(passageOf('B', dil.id, book, page, win, { draw: tries }));
      }
      for (const p of out) appendJsonl(file, p);
      appendJsonl(path.join(OUT, `passages-${set}-log.jsonl`), { dilemma: dil.id, arm: 'B', got: out.length, tries });
      console.log(dil.id, 'B', out.length, 'tries', tries);
    }
  }
  await client.close();
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });
export { shuffled, words };
