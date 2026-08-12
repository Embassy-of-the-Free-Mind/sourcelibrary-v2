// Segment Bekker 1854 Suda OCR into entries -> bekker-entries.jsonl. Issue #3884.
// One row per entry: {seq, lemma, text, scan_page, printed_page, margin_letter, joined_pages}
import { MongoClient } from 'mongodb';
import { writeFileSync } from 'node:fs';

const BOOK = '69a99ce86c7545e2236e12de';
const c = new MongoClient(process.env.MONGODB_URI);
await c.connect();
const pages = await c.db('bookstore').collection('pages')
  .find({ book_id: BOOK, page_number: { $gte: 12, $lte: 1172 } })
  .project({ page_number: 1, 'ocr.data': 1 })
  .sort({ page_number: 1 }).toArray();
await c.close();
console.log('pages fetched:', pages.length);

const ZWC = /[​‌‍⁠﻿]/g;
const entries = [];
let carry = null; // entry continuing from previous page

for (const p of pages) {
  let t = p.ocr?.data;
  if (!t) continue;
  const printed = t.match(/<page-num>(\d+)<\/page-num>/)?.[1];
  const header = t.match(/<header>([^<]*)<\/header>/)?.[1] ?? '';
  if (!/[α-ωΑ-Ω]/.test(header)) { carry = null; continue; } // front/back matter
  t = t.replace(ZWC, '')
    .replace(/<language>[^<]*<\/language>|<page-type>[^<]*<\/page-type>|<columns>[^<]*<\/columns>|<page-num>[^<]*<\/page-num>|<header>[^<]*<\/header>|<column-break\/>|<sig>[^<]*<\/sig>/g, '')
    .replace(/<insert>[\s\S]*?<\/insert>/g, '');
  // paragraphs; <margin>x</margin> may prefix an entry
  const paras = t.split(/\n+/).map((s) => s.trim()).filter(Boolean);
  for (let i = 0; i < paras.length; i++) {
    let para = paras[i];
    const margin = para.match(/^<margin>([^<]*)<\/margin>\s*/);
    if (margin) para = para.slice(margin[0].length);
    para = para.replace(/<margin>[^<]*<\/margin>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!para) continue;
    const first = para.match(/^[^\s]+/)?.[0] ?? '';
    // continuation heuristic: first para of a page joins carry if carry ended
    // hyphenated, or this para starts lowercase-Greek and carry lacks final punct.
    const startsNewEntry = /^[Α-ΩἈ-ᾯ]/.test(first) ||
      (/^[α-ωἀ-ῷ]/.test(first) && (!carry || /[.·;]$/.test(carry.text)));
    if (i === 0 && carry && (!startsNewEntry || /-$/.test(carry.text))) {
      carry.text = /-$/.test(carry.text)
        ? carry.text.slice(0, -1) + para
        : carry.text + ' ' + para;
      carry.joined_pages.push(p.page_number);
      continue;
    }
    if (carry) entries.push(carry);
    carry = {
      seq: entries.length,
      lemma: para.split(/[\s:·]+/).slice(0, 3).join(' '),
      text: para,
      scan_page: p.page_number,
      printed_page: printed ? Number(printed) : null,
      margin_letter: margin ? margin[1] : null,
      joined_pages: [p.page_number],
    };
  }
}
if (carry) entries.push(carry);
entries.forEach((e, i) => (e.seq = i));
writeFileSync((process.env.SOL_DATA_DIR ?? 'scripts/output/sol-harvest') + '/bekker-entries.jsonl',
  entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
console.log('entries:', entries.length,
  '| joined-across-pages:', entries.filter((e) => e.joined_pages.length > 1).length,
  '| with margin letter:', entries.filter((e) => e.margin_letter).length);
