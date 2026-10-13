#!/usr/bin/env node
// PRIOR ART: scripts/audit/page-integrity.mjs — the walk whose `leaf-order` repair list this
// sharpens (#5059); it flags a printed-number break unless a Dice ≥ 0.9 copy sits beside it, and
// stops there. scripts/lib/page-integrity.mjs — pageNumberBreaks / duplicateScan / pagesChain,
// imported here, not rewritten. The verdict rules are in scripts/lib/leaf-order-sharpen.mjs.
/**
 * leaf-order-sharpen — sort the printed page-number breaks of #5059 into what each one IS,
 * from the text already stored: a copy the 0.9 Dice missed, a break whose text demonstrably
 * does not join (a missing leaf), a printer's misnumbering, another counter, or still unknown.
 * MEASUREMENT ONLY: reads `pages` (or a mirror directory), writes files, touches no store.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/audit/leaf-order-sharpen.mjs --fetch --dir=<dir>
 *        [--list=scripts/eval/results/page-integrity-repair-leaf-order-2026-09-24.jsonl.gz] [--limit=N]
 *        → <dir>/<book>.jsonl.gz, one row per page {p, ocr, type, leaf} (the mirror's row shape, plus the source leaf), for
 *          every book on the list. Read-only, secondary preferred, resumable (a book already on
 *          disk is skipped). Not needed on a box that has ~/sl-corpus/books: pass that as --dir.
 *   node scripts/audit/leaf-order-sharpen.mjs --dir=<dir> [--list=…] [--out=<file.jsonl.gz>]
 *        → one row per break of the list with its verdict and evidence, and a summary on stdout.
 *   node scripts/audit/leaf-order-sharpen.mjs --dir=<dir> --sample=N --verdict=<v> [--seed=S] [--rows=<out file>]
 *        → N breaks of one verdict (one per book, seeded) with the foot of `from` and the head of
 *          `to`, for the hand-read.
 *   node scripts/audit/leaf-order-sharpen.mjs --dir=<dir> --rows=<out file> --packet-dir=<dir> [--per=80] [--seed=S]
 *        → the READING packet for the jumps the rules cannot sort: <dir>/packet-NN.txt (id, foot,
 *          head), shuffled together with controls from the same books that the reader cannot tell
 *          apart — neighbouring scans whose numbers run on (the text joins) and the same foot
 *          against the head two or three scans later (a leaf is missing by construction).
 *          <dir>/key.jsonl says which is which and is NOT given to the reader.
 *   node scripts/audit/leaf-order-sharpen.mjs --rows=<out file> --score=<packet dir> [--out=<file>]
 *        → reads <dir>/out-NN.txt (`id<TAB>J|B|U` per line), scores the reader on the controls,
 *          and writes the rows again with the read applied to the jumps. --reads-out=<file>
 *          keeps every item's kind and read (the controls included), so the score can be redone.
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import zlib from 'zlib';
import { sharpenBook, seamText, VERDICTS } from '../lib/leaf-order-sharpen.mjs';
import { parsePageNum, sourceProse, NON_TEXT_TYPES } from '../lib/page-integrity.mjs';

const arg = (k, d) => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? d;
const flag = (k) => process.argv.includes(`--${k}`);
const LIST = arg('list', 'scripts/eval/results/page-integrity-repair-leaf-order-2026-09-24.jsonl.gz');
const DIR = arg('dir', path.join(os.homedir(), 'sl-corpus/books'));

const readJsonl = (f) => (f.endsWith('.gz') ? zlib.gunzipSync(fs.readFileSync(f)).toString('utf8') : fs.readFileSync(f, 'utf8'))
  .split('\n').filter(Boolean).map(l => JSON.parse(l));

/** A book's rows in scan order, from <dir>/<id>.jsonl(.gz). p ≤ 0 = soft-hidden, never a scan a reader turns. */
function readBook(id) {
  for (const f of [path.join(DIR, `${id}.jsonl.gz`), path.join(DIR, `${id}.jsonl`)]) {
    if (fs.existsSync(f)) return readJsonl(f).filter(r => r.p > 0).sort((a, b) => a.p - b.p);
  }
  return null;
}

function listByBook() {
  const byBook = new Map();
  for (const r of readJsonl(LIST)) (byBook.get(r.book) || byBook.set(r.book, []).get(r.book)).push(r);
  return byBook;
}

/** The holding library's own leaf index, where the image URL carries one (the Archive's
 *  `/page/n61/`): consecutive leaves either side of a break mean the SOURCE scan has no leaf
 *  between them; a gap means the leaf exists there and we did not take it. null elsewhere. */
export function sourceLeaf(url) {
  const m = String(url || '').match(/archive\.org\/download\/[^/]+\/page\/n(\d+)[/_.]/);
  return m ? +m[1] : null;
}

async function fetchBooks() {
  const { getScriptClient } = await import('../lib/mongo.mjs');
  const { client, db } = await getScriptClient({ maxPoolSize: 6, noTimeout: true });
  fs.mkdirSync(DIR, { recursive: true });
  const ids = [...listByBook().keys()].slice(0, +arg('limit', 1e9));
  const todo = ids.filter(id => !fs.existsSync(path.join(DIR, `${id}.jsonl.gz`)));
  console.log(`${ids.length} books on the list, ${todo.length} to fetch`);
  let done = 0, pages = 0;
  const pagesCol = db.collection('pages');
  const worker = async () => {
    for (let id; (id = todo.pop());) {
      const rows = await pagesCol.find({ book_id: id }, { projection: { _id: 0, page_number: 1, page_type: 1, 'ocr.data': 1, photo_original: 1, photo: 1 }, readPreference: 'secondaryPreferred' }).toArray();
      const out = rows.map(r => JSON.stringify({ p: r.page_number, ocr: typeof r.ocr?.data === 'string' ? r.ocr.data : '', type: r.page_type || null, leaf: sourceLeaf(r.photo_original || r.photo) })).join('\n');
      const f = path.join(DIR, `${id}.jsonl.gz`);
      fs.writeFileSync(f + '.tmp', zlib.gzipSync(out + (out ? '\n' : '')));
      fs.renameSync(f + '.tmp', f);
      pages += rows.length;
      if (++done % 200 === 0) console.log(`${done}/${ids.length - (ids.length - todo.length - done)} books, ${pages} pages`);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  console.log(`fetched ${done} books, ${pages} pages`);
  await client.close();
}

/** Seeded shuffle (mulberry32), so a hand-read sample can be drawn again. */
function shuffled(arr, seed) {
  let a = seed >>> 0;
  const rnd = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

export const SEAM_CHARS = 320;      // of the foot and of the head shown to the reader
export const SEAM_MIN_CHARS = 120;  // a shorter foot or head is not read
export const CONTROL_EVERY = 5;     // one control (a join, or a made gap, alternately) per this many jumps

/** The jumps a reader must decide, and controls from the same books. Returns { items, key }. */
function buildPacket(rows, seed) {
  const targets = rows.filter(r => r.shape === 'jump' && !(r.verdict === 'unresolved' && r.why) && ['unresolved', 'text-breaks'].includes(r.verdict));
  const key = [];
  const rnd = shuffled(Array.from({ length: 9973 }, (_, i) => i), seed);
  let n = 0, short = 0;
  const byBook = new Map();
  for (const r of targets) (byBook.get(r.book) || byBook.set(r.book, []).get(r.book)).push(r);
  for (const [book, list] of byBook) {
    const pages = readBook(book);
    if (!pages) continue;
    for (const r of list) {
      const s = seamText(pages, r.from, r.to, SEAM_CHARS);
      if (s.foot.length < SEAM_MIN_CHARS || s.head.length < SEAM_MIN_CHARS) { short++; continue; }
      key.push({ kind: 'jump', book, from: r.from, to: r.to, ...s });
      if (++n % CONTROL_EVERY) continue;
      // controls: scans i, i+1 whose printed numbers run on, away from every listed break
      const near = new Set(list.flatMap(x => [x.from - 3, x.from - 2, x.from - 1, x.from, x.to, x.to + 1, x.to + 2, x.to + 3]));
      const ok = (p) => p && !NON_TEXT_TYPES.has(p.type) && sourceProse(p.ocr).length >= 400;
      const runs = [];
      for (let i = 0; i + 3 < pages.length; i++) {
        const q = pages.slice(i, i + 4);
        if (!q.every(ok) || q.some(p => near.has(p.p)) || q.some((p, k) => p.p !== q[0].p + k)) continue;
        const v = q.map(p => parsePageNum(p.ocr));
        if (v.every(x => x && x.kind === 'arabic') && v.every((x, k) => x.value === v[0].value + k)) runs.push(i);
      }
      if (!runs.length) continue;
      const i = runs[rnd[n % rnd.length] % runs.length], gap = 2 + (rnd[(n + 1) % rnd.length] % 2);
      const j = seamText(pages, pages[i].p, pages[i + 1].p, SEAM_CHARS), g = seamText(pages, pages[i].p, pages[i + gap].p, SEAM_CHARS);
      if (j.foot.length < SEAM_MIN_CHARS || j.head.length < SEAM_MIN_CHARS || g.head.length < SEAM_MIN_CHARS) continue;
      // one of the two per site (alternating), so no foot is ever shown twice
      if ((n / CONTROL_EVERY) % 2) key.push({ kind: 'control-join', book, from: pages[i].p, to: pages[i + 1].p, ...j });
      else key.push({ kind: 'control-gap', book, from: pages[i].p, to: pages[i + gap].p, ...g });
    }
  }
  const items = shuffled(key, seed + 1).map((k, i) => ({ id: i + 1, ...k }));
  return { items, short };
}

/** What the reader is told (written beside the packets as INSTRUCTIONS.md). The 2026-10-13 read
 *  used exactly this text; change it and the control scores no longer describe the read. */
export const READER_INSTRUCTIONS = `# Reading task: does the HEAD continue the FOOT?

Each item in the packet file is two fragments of OCR text from one early printed (or modern) book,
in whatever language the book is in (Latin, German, Greek, French, Dutch, English, Italian,
Sanskrit, Armenian, Hebrew …):

- \`FOOT\` = the LAST ~320 characters of one scanned page.
- \`HEAD\` = the FIRST ~320 characters of the scan that comes next in our copy.

For every item decide ONE letter:

- **J (joins)** — the head demonstrably continues the foot: the sentence, word or verse left open
  at the foot is carried on by the head (grammar and sense run on); or a word broken with a hyphen
  at the foot is finished by the head; or the head opens by repeating the foot's last word(s)
  (a printed catchword — "… mit hinab" | "hinab in Egypten" joins); or a numbered sequence
  (verses, list items, index entries in alphabetical order, section numbers) runs on without a hole.
- **B (breaks)** — the head CANNOT be what follows the foot: the foot stops mid-sentence or
  mid-word and the head starts in the middle of a different sentence, or with something that does
  not complete it grammatically or in sense; a hyphen-broken word is left unfinished; a numbered
  sequence visibly skips (verse 44 then verse 61; alphabetical index jumping far).
  Text is missing between the two.
- **U (cannot tell)** — no evidence either way: the foot ends a complete sentence / paragraph /
  chapter and the head begins a new one; tables, lists, apparatus or indexes with no visible
  order; one side is a title, a caption, a heading only, or is too garbled; a language or script
  you cannot actually read well enough to judge.

Rules:
- Judge only from the text. Do not guess from the item number; items are independent and shuffled.
- A foot that ends mid-sentence followed by a head that starts with a running head, a chapter
  title or a page heading and THEN resumes mid-sentence: look at the first running prose in the
  head. If that prose completes the foot → J. If it cannot → B.
- Bilingual pages (e.g. Latin below Greek, facing translations): the foot may be in one language
  and the head in another. If you cannot follow the same language across, answer U.
- OCR noise, long-s (ſ), u/v, abbreviations and odd spacing are normal; read through them.
- Footnotes or marginalia at the very end of a foot can hide where the main text stopped; if
  that makes it undecidable, answer U.
- Prefer U to a guess. But do not hide in U: when the foot clearly stops mid-sentence and the
  head clearly does or does not continue it, say J or B.

Output: write a plain text file with ONE line per item, every item of the packet, in the form

    <id><TAB><J|B|U>

(for example \`4012	B\`). No header, no commentary, no other text in the file. Read the packet file
in pieces if needed — it has 150 items — and make sure every id in the packet has a line.
Do the reading yourself, item by item; do not write a script or heuristic to decide.
Your final reply: just the number of J, B and U lines you wrote.
`;

function writePacket(rows) {
  const dir = arg('packet-dir'), per = +arg('per', 80);
  fs.mkdirSync(dir, { recursive: true });
  const { items, short } = buildPacket(rows, +arg('seed', 5059));
  fs.writeFileSync(path.join(dir, 'INSTRUCTIONS.md'), READER_INSTRUCTIONS);
  fs.writeFileSync(path.join(dir, 'key.jsonl'), items.map(({ foot: _f, head: _h, ...k }) => JSON.stringify(k)).join('\n') + '\n');
  let files = 0;
  for (let i = 0; i < items.length; i += per, files++) {
    fs.writeFileSync(path.join(dir, `packet-${String(files + 1).padStart(3, '0')}.txt`),
      items.slice(i, i + per).map(k => `#${k.id}\nFOOT: …${k.foot}\nHEAD: ${k.head}…\n`).join('\n'));
  }
  const c = items.reduce((o, k) => ((o[k.kind] = (o[k.kind] || 0) + 1), o), {});
  console.log(JSON.stringify({ items: items.length, files, tooShortToRead: short, ...c }));
}

/** Apply the read. A jump read B (the head cannot continue the foot) is text-breaks; read J (it
 *  continues it) is misnumbered, also where the split-word rule said otherwise; U, or no read,
 *  stays where the rules left it. */
function score(rows) {
  const dir = arg('score');
  const key = new Map(readJsonl(path.join(dir, 'key.jsonl')).map(k => [k.id, k]));
  const read = new Map();
  for (const f of fs.readdirSync(dir).filter(f => /^out-\d+\.txt$/.test(f))) {
    for (const line of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) {
      const m = line.match(/^#?(\d+)\s+([JBU])\b/);
      if (m && key.has(+m[1])) read.set(+m[1], m[2]);
    }
  }
  const tab = { 'control-join': { J: 0, B: 0, U: 0 }, 'control-gap': { J: 0, B: 0, U: 0 }, jump: { J: 0, B: 0, U: 0 } };
  const verdictOf = new Map();
  for (const [id, v] of read) {
    const k = key.get(id);
    tab[k.kind][v]++;
    if (k.kind === 'jump') verdictOf.set(`${k.book}:${k.from}:${k.to}`, v);
  }
  let agree = 0, disagree = 0;
  const out = rows.map((r) => {
    const v = verdictOf.get(`${r.book}:${r.from}:${r.to}`);
    if (!v || r.shape !== 'jump') return r;
    // the rule's own text-breaks, read: 10 of 10 disagreements checked by eye went to the reader
    // (a running head above the resumed word), so a J read overrides the rule
    if (r.verdict === 'text-breaks') { if (v === 'B') agree++; else if (v === 'J') disagree++; if (v !== 'J') return { ...r, read: v }; }
    if (v === 'B') return { ...r, verdict: 'text-breaks', why: 'read', read: v };
    if (v === 'J') return { ...r, verdict: 'misnumbered', why: 'read-joins', read: v };
    return { ...r, read: v };
  });
  if (arg('reads-out')) {
    fs.writeFileSync(arg('reads-out'), zlib.gzipSync([...key.values()].map(k => JSON.stringify({ ...k, read: read.get(k.id) || null })).join('\n') + '\n'));
  }
  const j = tab['control-join'], g = tab['control-gap'];
  console.log(JSON.stringify({
    items: key.size, read: read.size, table: tab,
    // of the reader's decided calls on controls: how often B is a made gap, how often J is a real join
    controlPrecisionB: +(g.B / Math.max(1, g.B + j.B)).toFixed(3), controlPrecisionJ: +(j.J / Math.max(1, j.J + g.J)).toFixed(3),
    gapRecall: +(g.B / Math.max(1, g.B + g.J + g.U)).toFixed(3), joinRecall: +(j.J / Math.max(1, j.J + j.B + j.U)).toFixed(3),
    ruleTextBreaksVsRead: { agree, disagree },
  }));
  return out;
}

function sharpenAll() {
  const byBook = listByBook();
  const rows = [];
  let missingBooks = 0;
  for (const [book, listed] of byBook) {
    const pages = readBook(book);
    if (!pages) { missingBooks++; for (const r of listed) rows.push({ ...r, verdict: 'no-text', why: 'book not in --dir' }); continue; }
    rows.push(...sharpenBook(pages, listed).map(r => ({ book, ...r })));
  }
  return { rows, books: byBook.size, missingBooks };
}

function summarize(rows) {
  const s = { breaks: rows.length, books: new Set(rows.map(r => r.book)).size, byVerdict: {}, byShape: {} };
  for (const v of VERDICTS) s.byVerdict[v] = { breaks: 0, books: new Set(), visibleBooks: new Set() };
  for (const r of rows) {
    const v = (s.byVerdict[r.verdict] ||= { breaks: 0, books: new Set(), visibleBooks: new Set() });
    v.breaks++; v.books.add(r.book); if (r.visible) v.visibleBooks.add(r.book);
    const sh = (s.byShape[r.shape] ||= {});
    sh[r.verdict] = (sh[r.verdict] || 0) + 1;
  }
  for (const v of Object.values(s.byVerdict)) { v.books = v.books.size; v.visibleBooks = v.visibleBooks.size; }
  return s;
}

async function main() {
  if (flag('fetch')) return fetchBooks();
  const rowsFile = arg('rows');
  let { rows, books, missingBooks } = rowsFile ? { rows: readJsonl(rowsFile), books: null, missingBooks: null } : sharpenAll();
  if (arg('packet-dir')) return writePacket(rows);
  if (arg('score')) rows = score(rows);
  if (arg('sample')) {
    const want = arg('verdict');
    const seen = new Set(), picked = [];
    for (const r of shuffled(rows.filter(r => r.verdict === want), +arg('seed', 5059))) {
      if (seen.has(r.book)) continue;
      seen.add(r.book); picked.push(r);
      if (picked.length >= +arg('sample')) break;
    }
    for (const r of picked) {
      const pages = readBook(r.book);
      const { foot, head } = seamText(pages, r.from, r.to, +arg('chars', 260));
      console.log(`\n=== ${r.book}  ${r.from}->${r.to} (${r.fromValue}->${r.toValue}) ${r.shape} d=${r.d} ${r.why || ''}\nFOOT: ${foot}\nHEAD: ${head}`);
    }
    return;
  }
  const out = arg('out');
  if (out) fs.writeFileSync(out, zlib.gzipSync(rows.map(r => JSON.stringify(r)).join('\n') + '\n'));
  console.log(JSON.stringify({ list: LIST, listBooks: books, booksWithoutText: missingBooks, ...summarize(rows) }, null, 1));
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error(e); process.exit(1); });
