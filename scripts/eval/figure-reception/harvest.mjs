// Harvest every page in the local corpus mirror whose English translation names a figure (#7073).
// Usage: node scripts/eval/figure-reception/harvest.mjs <figure>      (figure = a key in figures.json)
// Writes <work>/hits.json: one row per book with the sentence naming him on each page.
//
// PRIOR ART: ~/sl-work/figure-reception/py-harvest.mjs and term-harvest.mjs — the one-off Pythagoras and
// Philolaus/Archytas harvests this generalises (same apparatus stripping, same quote pattern, name from config).
//
// Needs the laptop's corpus mirror (~/sl-corpus: corpus.sqlite with the pages_en full-text index, catalog.jsonl,
// books/<id>.jsonl) and better-sqlite3 from ~/sourcelibrary-atlas. Reads only; free.
//
// The translation's own apparatus is removed before matching: <meta> summaries, <gloss>, <vocab>, and <note>s
// that do not open with a printed-footnote marker, so a page where only the translator names him does not count
// (auto-memory lesson: translation apparatus inflates name counts). A passage is q (reports his words) when the
// name sits near a verb of saying/teaching/forbidding, or after "according to", "doctrine of" and the like: a
// pattern, not a reading.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { figure, workDir } from './lib.mjs';

const KEY = process.argv[2];
const F = figure(KEY);
const Database = createRequire(path.join(process.env.HOME, 'sourcelibrary-atlas/scripts/local-corpus/x.js'))('better-sqlite3');
const C = process.env.SL_CORPUS || path.join(process.env.HOME, 'sl-corpus');

const FOOT = /<note\b[^>]*>(?!\s*(?:\d{1,3}[.)]?|[*†‡§¶]|\([a-z0-9]\))\s)[\s\S]*?<\/note>/gi;
const APP = /<(meta|gloss|vocab|summary|keywords|warning|header|page-num|page-type|language|sig|context|script|columns)\b[^>]*>[\s\S]*?<\/\1>/gi;
const stripApparatus = (s) => {
  let prev;
  do { prev = s; s = s.replace(FOOT, ' ').replace(APP, ' '); } while (s !== prev);
  return s.replace(/<\/?[a-z][a-z-]*[^>]*>/gi, ' ');
};

const VERBS = 'said|says|saying|sayeth|saith|taught|teaches|teach|held|holds|thought|believed|maintained|affirmed|affirms|declared|declares|asserted|bade|bids|commanded|commands|forbade|forbids|forbidding|enjoined|wrote|writes|written|used to say|would say|answered|replied|called|calls|defined|defines|named|argued|argues|demonstrated|showed|shows|proved|advised|advises|admonish\\w*|precept\\w*|counsel\\w*|prohibited';
const QUOTE = new RegExp(
  `\\b(${F.name})\\b[^.;:]{0,40}?\\b(${VERBS})\\b|(according to|in the words of|saying of|sayings of|precepts? of|symbols? of|maxims? of|doctrine of|teaching of|opinion of|verses of|fragments? of|books? of|treatise of|as) (the )?(divine |great |wise |old |ancient |philosopher |pythagorean )*(${F.name})`,
  'i',
);
const SENT = new RegExp(`[^.!?]*?${F.prefix}[^.!?]*[.!?]?`, 'i');
const NAME_G = new RegExp(F.prefix, 'gi');

const db = new Database(path.join(C, 'corpus.sqlite'), { readonly: true });
const cat = new Map();
for (const l of fs.readFileSync(path.join(C, 'catalog.jsonl'), 'utf8').split('\n')) {
  if (!l) continue;
  const r = JSON.parse(l);
  cat.set(r.id, { t: r.display_title || r.english_title || r.title, a: r.author, y: r.year, pub: r.published, lang: r.language, v: r.visible, pc: r.pages_count, w: r.work_id });
}
const hits = db.prepare('SELECT p.book_id b, p.p p, p.type type FROM pages_en JOIN pages p ON p.rowid=pages_en.rowid WHERE pages_en MATCH ?').all(`${F.prefix}*`);
const byBook = new Map();
for (const h of hits) (byBook.get(h.b) ?? byBook.set(h.b, []).get(h.b)).push(h);

const out = [];
let missing = 0;
for (const [b, hs] of byBook) {
  const types = new Map(hs.map((h) => [h.p, h.type]));
  const f = path.join(C, 'books', `${b}.jsonl`);
  if (!fs.existsSync(f)) { missing++; continue; }
  const passages = [];
  for (const l of fs.readFileSync(f, 'utf8').split('\n')) {
    if (!l) continue;
    let r;
    try { r = JSON.parse(l); } catch { continue; }
    // A negative page number is the site's soft-hide (a duplicate or an unsplit spread whose halves are separate
    // pages); the reader cannot open it, so it is never harvested.
    if (!(r.p > 0) || !types.has(r.p)) continue;
    const tr = stripApparatus(r.tr || '').replace(/[#*|]+/g, ' ').replace(/\s+/g, ' ');
    const m = tr.match(SENT);
    if (!m) continue;
    let s = m[0].trim();
    if (s.length > 420) {
      const i = s.toLowerCase().indexOf(F.prefix);
      s = (i > 200 ? '…' : '') + s.slice(Math.max(0, i - 200), i + 220) + '…';
    }
    passages.push({ p: r.p, s, n: (tr.match(NAME_G) || []).length, q: QUOTE.test(s), type: types.get(r.p) });
  }
  if (!passages.length) continue;
  passages.sort((x, y) => x.p - y.p);
  out.push({ id: b, ...(cat.get(b) || {}), hits: passages.length, passages });
}
const file = path.join(workDir(KEY), 'hits.json');
fs.writeFileSync(file, JSON.stringify(out));
const pub = out.filter((b) => b.v && b.pc > 0);
console.log(KEY, 'books', out.length, 'public', pub.length, 'missing files', missing,
  'public pages', pub.reduce((a, b) => a + b.passages.length, 0), 'public q-passages', pub.reduce((a, b) => a + b.passages.filter((p) => p.q).length, 0), '→', file);
