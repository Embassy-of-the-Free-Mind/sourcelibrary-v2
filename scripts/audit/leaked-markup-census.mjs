#!/usr/bin/env node
// PRIOR ART: scripts/eval/quality-census-score.mjs (`rawLeaks`/`visibleLeaks`, one page per book,
// classes named for the A2 stored-text cleanup) and scripts/audit/page-integrity.mjs (walks the
// local corpus mirror, which this box does not hold; counts the closed continuity <meta>, reused
// below). Neither counts what the READ-TIME repair in scripts/lib/leaked-markup.mjs changes.
/**
 * leaked-markup-census — how many served translation pages carry each class of leaked markup
 * (#5700 A1(c)). MEASUREMENT ONLY: reads `pages.translation.data`, writes local files.
 *
 * The fixable classes are counted by the repair itself (`repairLeakedMarkup(text, { fired })`),
 * so the census and the fix cannot disagree. The watch classes are counted and left alone.
 *
 *   node --env-file=.env.production.local scripts/audit/leaked-markup-census.mjs [--dir D] [--conc 4] [--limit-books N]
 *   node scripts/audit/leaked-markup-census.mjs --summary [--dir D]
 *
 * Resumable by book (books-done.txt under --dir). Prints counts; excerpts go to examples.jsonl.
 */
import fs from 'fs';
import path from 'path';
import { repairLeakedMarkup, LEAK_RULES } from '../lib/leaked-markup.mjs';
import { continuityMeta, META_PAYLOAD_MIN_WORDS } from '../lib/page-integrity.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const flag = (k) => process.argv.includes(k);
const DIR = arg('--dir', '/data/scratch/sl/markup-leak-5700-work/census');
const CONC = Number(arg('--conc', 4));
const LIVE = { visible: true, pages_count: { $gt: 0 }, pages_translated: { $gt: 0 } };
const HAS_TR = { 'translation.data': { $type: 'string', $ne: '' } };
const EXAMPLES_PER_CLASS = 80;

/** Tags the reader, the exports and the prompts know. Anything else is `unknown_tag`. */
const KNOWN_TAGS = new Set(('note margin gloss term insert unclear image-desc interp lacuna meta summary keywords vocab '
  + 'language lang scan-quality script page-type columns warning header page-num sig folio abbrev catchword '
  + 'column-break leaf-break detected-images condition period surface genre transliteration notes confidence '
  + 'sup sub br hr em strong del span div p a img table thead tbody tr th td ul ol li blockquote code pre h1 h2 h3 h4 h5 h6').split(' '));
const WATCH = ['meta_payload', 'hash_other', 'unknown_tag', 'tag_inside_word', 'entity_left'];
export const CLASSES = [...LEAK_RULES, ...WATCH];

/** Per-page verdict: { fired, watch, excerpt }. Pure — the unit tests call it. */
export function censusPage(text) {
  const fired = {};
  const fixed = repairLeakedMarkup(text, { fired });
  const hit = {};
  for (const [k, n] of Object.entries(fired)) hit[k] = n;
  const cm = continuityMeta(text);
  if (cm && cm.form === 'text' && cm.words >= META_PAYLOAD_MIN_WORDS) hit.meta_payload = 1;
  // A `#` the reader still prints: not a heading marker, not in a link.
  const hashes = fixed.split('\n').filter((l) => l.includes('#') && !/https?:\/\//.test(l)
    && l.replace(/^[ \t]*(?:>[ \t]*)*(?:[-*+][ \t]+)?(?:->[ \t]*)?#{1,6}(?:[ \t]|$)/, '').replace(/[ \t]#{1,6}[ \t]*(?:<-)?[ \t]*$/, '').includes('#')).length;
  if (hashes) hit.hash_other = hashes;
  let unknown = 0;
  for (const m of fixed.matchAll(/<\/?([a-zA-Z][\w-]*)(?:\s[^<>]*)?\/?>/g)) if (!KNOWN_TAGS.has(m[1].toLowerCase())) unknown++;
  if (unknown) hit.unknown_tag = unknown;
  const inside = (fixed.match(/\p{L}<(gloss|term|unclear|insert|margin)>[^<\n]{1,40}<\/\1>\p{L}|(?<=[\s(“"'])<(gloss|term|unclear|insert)>\p{L}{1,3}<\/\2>\p{Ll}/gu) || []).length;
  if (inside) hit.tag_inside_word = inside;
  const ent = (fixed.match(/&(?:[a-zA-Z]{2,10}|#\d{1,6}|#x[0-9a-fA-F]{1,5});/g) || []).length;
  if (ent) hit.entity_left = ent;
  return { hit, changed: fixed !== text, fixed };
}

function excerpt(before, after) {
  let i = 0; const n = Math.min(before.length, after.length);
  while (i < n && before[i] === after[i]) i++;
  const from = Math.max(0, i - 70);
  return { before: before.slice(from, i + 130), after: after.slice(from, i + 110) };
}

function summarise() {
  const rows = fs.readFileSync(path.join(DIR, 'books.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const s = { generated_at: new Date().toISOString(), books: rows.length, pages: 0, pages_changed: 0, books_changed: 0, by_class: {}, tibetan_canon: { books: 0, pages: 0, hash_other_pages: 0 } };
  for (const c of CLASSES) s.by_class[c] = { pages: 0, books: 0, marks: 0 };
  for (const r of rows) {
    s.pages += r.pages; s.pages_changed += r.changed; if (r.changed) s.books_changed++;
    for (const [c, v] of Object.entries(r.c || {})) { s.by_class[c].pages += v[0]; s.by_class[c].marks += v[1]; s.by_class[c].books++; }
    if (r.canon) { s.tibetan_canon.books++; s.tibetan_canon.pages += r.pages; s.tibetan_canon.hash_other_pages += r.c?.hash_other?.[0] || 0; }
  }
  for (const c of CLASSES) s.by_class[c].share_of_pages = +(100 * s.by_class[c].pages / Math.max(1, s.pages)).toFixed(3);
  fs.writeFileSync(path.join(DIR, 'summary.json'), JSON.stringify(s, null, 1));
  console.log(JSON.stringify(s, null, 1));
}

async function scan() {
  const { MongoClient } = await import('mongodb');
  const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: CONC + 2 });
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || 'bookstore');
  fs.mkdirSync(DIR, { recursive: true });
  const books = (await db.collection('books').find(LIVE, { projection: { _id: 1, id: 1, title: 1 } }).toArray())
    .map((b) => ({ id: b.id || String(b._id), canon: /Derge (?:Tengyur|Kangyur)/i.test(b.title || '') })).sort((a, b) => (a.id < b.id ? -1 : 1));
  const donePath = path.join(DIR, 'books-done.txt');
  const done = new Set(fs.existsSync(donePath) ? fs.readFileSync(donePath, 'utf8').split('\n').filter(Boolean) : []);
  const todo = books.filter((b) => !done.has(b.id));
  const limit = Number(arg('--limit-books', 0));
  if (limit) todo.length = Math.min(todo.length, limit);
  console.error(`census: ${books.length} live translated books, ${done.size} done, ${todo.length} to do`);
  const bookOut = fs.createWriteStream(path.join(DIR, 'books.jsonl'), { flags: 'a' });
  const exOut = fs.createWriteStream(path.join(DIR, 'examples.jsonl'), { flags: 'a' });
  const doneOut = fs.createWriteStream(donePath, { flags: 'a' });
  const seen = Object.fromEntries(CLASSES.map((c) => [c, 0]));
  let n = 0, pages = 0, i = 0;
  const t0 = Date.now();
  const work = async (b) => {
    let rows;
    for (let a = 0; ; a++) {
      try {
        rows = await db.collection('pages').find({ book_id: b.id, page_number: { $gte: 0 }, ...HAS_TR }, { projection: { _id: 0, id: 1, page_number: 1, 'translation.data': 1 } })
          .hint({ book_id: 1, page_number: 1 }).maxTimeMS(300000).toArray();
        break;
      } catch (e) { if (a >= 3) throw e; await new Promise((r) => setTimeout(r, 5000 * (a + 1))); }
    }
    const c = {}; let changed = 0;
    for (const r of rows) {
      const { hit, changed: ch, fixed } = censusPage(r.translation.data);
      if (ch) changed++;
      for (const [k, v] of Object.entries(hit)) {
        (c[k] ||= [0, 0])[0]++; c[k][1] += v;
        // Reservoir over the whole run, so the by-eye sample is not the first books alphabetically.
        seen[k]++;
        if (seen[k] <= EXAMPLES_PER_CLASS || Math.random() < EXAMPLES_PER_CLASS / seen[k]) {
          const ex = LEAK_RULES.includes(k) ? excerpt(r.translation.data, fixed) : {};
          exOut.write(JSON.stringify({ k, b: b.id, p: r.page_number, id: r.id, ...ex }) + '\n');
        }
      }
    }
    pages += rows.length;
    bookOut.write(JSON.stringify({ b: b.id, pages: rows.length, changed, ...(b.canon ? { canon: 1 } : {}), c }) + '\n');
    doneOut.write(b.id + '\n');
    if (++n % 500 === 0) console.error(`${done.size + n}/${books.length} books · ${pages} pages · ${Math.round((Date.now() - t0) / 1000)}s`);
  };
  await Promise.all(Array.from({ length: CONC }, async () => { while (i < todo.length) await work(todo[i++]); }));
  await Promise.all([bookOut, exOut, doneOut].map((s) => new Promise((r) => s.end(r))));
  await client.close();
  console.error(`done: ${n} books, ${pages} pages`);
  summarise();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  (flag('--summary') ? Promise.resolve(summarise()) : scan()).catch((e) => { console.error(e); process.exit(1); });
}
