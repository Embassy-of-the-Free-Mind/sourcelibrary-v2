#!/usr/bin/env node
/**
 * PRIOR ART: scripts/eval/orig-lang-recall/gold.json — one drawn page per
 * query; scripts/eval/librarian-search/golden-set.json — page-grain answers to
 * factual questions inside one tradition. Neither has passages in several
 * traditions for one concept. The atlas golden set (#4773) is in another repo
 * and is nugget-per-book.
 *
 * Assembles the #6173 gold set from the three readers' files (gold-A/B/C.json,
 * found by lexical grep + reading, never by an embedding arm), enforces the
 * verbatim-quote gate (a passage whose quote is not a substring of its page is
 * DROPPED, not counted), and keeps 25 of the 33 candidate concepts by a rule
 * that looks at nothing but the gold itself:
 *
 *   the six seed concepts named in the brief and its issues (c01–c06), then
 *   the 19 others with the most traditions (ties: more passages, then qid).
 *
 *   node scripts/eval/embed-granularity/build-gold.mjs --dir DIR
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { arg, loadPool } from './lib.mjs';

const DIR = arg('--dir');
const here = path.dirname(fileURLToPath(import.meta.url));
const pool = loadPool(DIR);
const queries = JSON.parse(fs.readFileSync(path.join(here, 'candidate-queries.json'), 'utf8')).queries;
const norm = (s) => s.replace(/\s+/g, ' ').trim();
const TRADS = new Set(['jewish-kabbalistic', 'islamic-sufi', 'chinese-daoist-confucian', 'buddhist', 'hindu-indic', 'christian', 'hermetic-esoteric', 'greek-roman', 'zoroastrian']);
let dropped = 0;
const all = [];
for (const f of ['gold-A.json', 'gold-B.json', 'gold-C.json']) {
  for (const c of JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')).concepts) {
    const seen = new Set();
    const passages = [];
    for (const p of c.passages) {
      const page = pool[p.i];
      const ok = page && TRADS.has(p.tradition) && !seen.has(p.i) && norm(page.text).includes(norm(p.quote));
      if (!ok) { dropped++; console.log(`DROP ${c.qid} i=${p.i} (${!page ? 'no page' : !TRADS.has(p.tradition) ? 'label' : seen.has(p.i) ? 'dup' : 'quote not on page'})`); continue; }
      seen.add(p.i);
      passages.push({ i: p.i, book_id: page.book_id, page_number: page.page_number, url: `https://sourcelibrary.org/book/${page.book_id}?page=${page.page_number}`, title: page.title, tradition: p.tradition, strength: p.strength, quote: norm(p.quote), why: p.why });
    }
    all.push({ qid: c.qid, query: queries.find((q) => q.qid === c.qid).query, traditions: [...new Set(passages.map((p) => p.tradition))].sort(), passages, reader_notes: c.notes || '' });
  }
}
const SEEDS = new Set(['c01', 'c02', 'c03', 'c04', 'c05', 'c06']);
const rest = all.filter((c) => !SEEDS.has(c.qid) && c.traditions.length >= 3)
  .sort((a, b) => b.traditions.length - a.traditions.length || b.passages.length - a.passages.length || a.qid.localeCompare(b.qid));
const keep = new Set([...SEEDS, ...rest.slice(0, 19).map((c) => c.qid)]);
const kept = all.filter((c) => keep.has(c.qid)).sort((a, b) => a.qid.localeCompare(b.qid));
console.log(`dropped ${dropped} passages at the gate; kept ${kept.length} concepts, ${kept.reduce((s, c) => s + c.passages.length, 0)} passages; left out: ${all.filter((c) => !keep.has(c.qid)).map((c) => `${c.qid}(${c.traditions.length})`).join(' ')}`);
for (const c of kept) console.log(` ${c.qid} ${c.traditions.length} traditions, ${c.passages.length} passages — ${c.query}`);
fs.writeFileSync(path.join(here, 'gold.json'), JSON.stringify({
  note: 'Cross-tradition gold set for #6173. Passages were found by lexical grep and reading of the pool page text (three AI readers, 2026-10-07), never with an embedding arm and never from memory; each carries a verbatim quote that is machine-checked against the page. `tradition` is the reader\'s by-eye label for the passage. `i` is the pool index (build-pool.mjs --seed 6173).',
  queries: kept,
  left_out: all.filter((c) => !keep.has(c.qid)),
}, null, 1));
