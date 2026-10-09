// PRIOR ART: /root/tattva-6184/crop.mjs + decide.mjs (#6184 tie-break, not in the repo) — single-pair majority, no per-slot print scoring; copied and extended here.
// Build the ground-truth slot list (#6184 reader diversity): disputed tokens from the tie-break (gate table + by-eye sample)
// and seeded random control tokens where lite = Flash. Print readings are filled in BY EYE afterwards (gt.json).
import fs from 'node:fs';
import { makeRng } from '../lib/paired-stats.mjs';
const T = JSON.parse(fs.readFileSync('texts.json', 'utf8'));
const dec = JSON.parse(fs.readFileSync('/root/tattva-6184/decisions.json', 'utf8'));
const eye = JSON.parse(fs.readFileSync('/root/tattva-6184/eye2.json', 'utf8'));
const log = JSON.parse(fs.readFileSync('/root/tattva-6184/apply-log.json', 'utf8'));
const key = (b, p) => `${b.slice(-4)}:${p}`;
const page = new Map(T.map((t) => [key(t.book_id, t.page_number), t]));
const GATE = [['eddd',760,'स्मरण'],['f107',300,'युक्तम्'],['f107',300,'कारणभेद'],['eddd',206,'नुपलम्भाद'],['eddd',432,'प्रासाद'],['eddd',432,'प्रसूतिर'],['eddd',601,'अभिव्य'],['eddd',601,'हेतोरभिव्य'],['f107',91,'किञ्च'],['f107',91,'सकल्प'],['f107',194,'न्तर'],['f107',194,'यथाभूत'],['f107',259,'ज्ञान'],['eddd',155,'संस्कृते']];
const slots = []; const seen = new Set();
function add(kind, d) {
  const k = `${key(d.book, d.page)}|${d.flash}|${d.lite}`; if (seen.has(k)) return; seen.add(k);
  slots.push({ id: `${kind[0]}${String(slots.length).padStart(2, '0')}`, kind, book_id: d.book, page: d.page, page_id: d.page_id, flash: d.flash, lite: d.lite, src: d.src });
}
for (const [b, p, needle] of GATE) {
  const d = dec.find((x) => x.book.endsWith(b) && x.page === p && (x.flash.includes(needle) || x.lite.includes(needle)) && x.pro !== 'neither' || (x.book.endsWith(b) && x.page === p && x.page === 155 && x.flash.includes(needle)));
  if (d) add('disputed', { ...d, src: 'gate' });
}
for (const e of [...eye, ...log.filter((l) => l.applied && [[ 'eddd', 174], ['eddd', 284], ['f107', 284], ['eddd', 521], ['eddd', 752]].some(([b, p]) => l.book.endsWith(b) && l.page === p))])
  add('disputed', { book: e.book, page: e.page, page_id: e.page_id, flash: e.from, lite: e.to, src: 'eye-sample' });
// controls: seeded, one per page, a word with a mark that carries negation/length (ā sign, virāma, म, न), identical in lite and Flash.
// The control words in the committed results/reader-diversity-6184/slots-final.json were drawn and read by eye on 2026-10-07
// with an earlier generator (the double-arithmetic LCG that #5373 retired). That file is the record of the judged draw;
// a re-run of this script picks different control words.
const rnd = makeRng(6184);
const words = (t) => t.replace(/<[^>]+>/g, ' ').replace(/-\s*\n\s*/g, '').split(/[\s।॥,;:()'‘’"\-—\[\]0-9०-९?]+/).filter(Boolean);
const disputedWords = new Set(dec.flatMap((d) => [d.flash, d.lite]));
for (const t of T) {
  if (key(t.book_id, t.page_number) === 'f107:315') continue;
  const lw = words(t.lite), fw = words(t.flash);
  const cnt = (arr, w) => arr.filter((x) => x === w).length;
  const pool = [...new Set(fw)].filter((w) => w.length >= 7 && w.length <= 22 && /[ा्मन]/.test(w) && cnt(fw, w) === 1 && cnt(lw, w) === 1 && !disputedWords.has(w)).sort();
  const w = pool[Math.floor(rnd() * pool.length)];
  slots.push({ id: `c${String(slots.length).padStart(2, '0')}`, kind: 'control', book_id: t.book_id, page: t.page_number, page_id: t.page_id, flash: w, lite: w, src: 'seeded-6184' });
}
fs.writeFileSync('slots.json', JSON.stringify(slots, null, 1));
for (const x of slots) console.log(x.id, x.kind, key(x.book_id, x.page), x.flash, '|', x.lite, x.src);
