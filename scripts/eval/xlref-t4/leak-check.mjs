#!/usr/bin/env node
// PRIOR ART: none in scripts/eval/lib or translation-vs-reference/ (looked for "facing", "leak") — the T2 job found that a book with facing English puts the published translation into the translator's context (previous page's translation, neighbour OCR), which inflates a score against that same translation. This flags such pages. Read-only.
/** For each reference record, measure how much English (Latin-script words) sits on the page and on its ±1 and ±2 neighbours' OCR, to flag facing-translation editions (#5695). */
//   node --env-file=… scripts/eval/xlref-t4/leak-check.mjs <records.jsonl> <out.json>
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
import { readJsonl } from '../translation-vs-reference/common.mjs';
const [IN, OUT] = process.argv.slice(2);
const latinShare = (t) => { const s = String(t || '').replace(/<[^>]+>/g, ' '); const w = s.split(/\s+/).filter((x) => /\p{L}{2,}/u.test(x)); if (!w.length) return null; return Math.round(100 * w.filter((x) => /^[\p{Script=Latin}\p{P}\d]+$/u.test(x)).length / w.length) / 100; };
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const pages = c.db('bookstore').collection('pages'); const out = [];
try {
  for (const r of readJsonl(IN)) {
    const ps = await pages.find({ book_id: r.book_id, page_number: { $gte: r.page_number - 2, $lte: r.page_number + 2 } }, { projection: { page_number: 1, 'ocr.data': 1 } }).toArray();
    const by = Object.fromEntries(ps.map((p) => [p.page_number - r.page_number, latinShare(p.ocr?.data)]));
    const neighbours = [-2, -1, 1, 2].map((d) => by[d]).filter((x) => x != null);
    out.push({ id: `${r.book_id}_${r.page_number}`, lang: r.lang, book_title: r.book_title, translator: r.reference_meta.translator, latin_share_page: by[0], latin_share_neighbours: { '-2': by[-2] ?? null, '-1': by[-1] ?? null, '+1': by[1] ?? null, '+2': by[2] ?? null },
      page_has_printed_english: !!r.page_has_printed_english, facing_translation_suspect: (by[0] ?? 0) > 0.3 || neighbours.some((x) => x > 0.6) });
  }
} finally { await c.close(); }
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
for (const o of out.filter((x) => x.facing_translation_suspect || x.page_has_printed_english)) console.log(o.id.slice(-10), o.lang, (o.book_title || '').slice(0, 40), '| page', o.latin_share_page, JSON.stringify(o.latin_share_neighbours), o.page_has_printed_english ? 'PRINTED-EN' : '');
