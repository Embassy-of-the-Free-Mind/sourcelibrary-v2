#!/usr/bin/env node
// PRIOR ART: scripts/maintenance/withhold-stale-translations.mjs withdrawQuotesOnWithheldPages (moves a quote on a
// withheld page to reading_summary.quotes_withheld); scripts/maintenance/restore-withheld-translation.mjs restores
// the English but not the quotes. Neither asks which leaf a withdrawn quote's words are printed on, so this lists it.
/**
 * Which leaf does each withdrawn featured quote belong to? (#5274) The 518 near-blank pages withheld on 2026-11-04
 * carried their neighbour's English, so a quote drawn from page n may be good text from page n-1 or n+1. Read only.
 *
 *   node --env-file=.env.production.local scripts/eval/context-bleed-5274/quote-leaf.mjs --queue=FILE.jsonl --out=FILE.json
 *
 * For each quote in books.reading_summary.quotes_withheld whose page is in --queue (state withheld): the share of the
 * quote's words (4+ letters) found in the served English of pages n-1 and n+1, and in page n's REPAIRED read if the
 * runner has written one (`translation.data`; its withheld text is where the quote came from, so it is not compared).
 * `leaf` = prev / next when that share is ≥ 0.8; `own` when the repaired read carries it; else `none` (on no leaf:
 * the composed text the screen called invented).
 */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const q = fs.readFileSync(arg('queue'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.state === 'withheld' && (r.src || []).includes('near-blank-invented'));
const want = new Map();
for (const r of q) (want.get(r.book_id) ?? want.set(r.book_id, new Set()).get(r.book_id)).add(r.page);
const words = (s) => String(s || '').replace(/<[^>]+>/g, ' ').toLowerCase().match(/\p{L}{4,}/gu) || [];
const c = new MongoClient(process.env.MONGODB_URI, { readPreference: 'secondaryPreferred' });
await c.connect();
const db = c.db('bookstore');
const out = [];
for (const b of await db.collection('books').find({ id: { $in: [...want.keys()] }, 'reading_summary.quotes_withheld.0': { $exists: true } }, { projection: { _id: 0, id: 1, title: 1, 'reading_summary.quotes_withheld': 1 } }).toArray()) {
  for (const qt of b.reading_summary.quotes_withheld) {
    if (!want.get(b.id).has(qt.page)) continue;
    const text = qt.text || qt.quote || qt.english || '';
    const ps = await db.collection('pages').find({ book_id: b.id, page_number: { $in: [qt.page - 1, qt.page, qt.page + 1] } }, { projection: { _id: 0, page_number: 1, 'translation.data': 1, 'translation_withheld.text': 1, 'translation.updated_at': 1 } }).toArray();
    const W = words(text);
    const share = {};
    for (const p of ps) { const en = p.translation?.data; if (!en) continue; const S = new Set(words(en)); share[p.page_number - qt.page] = W.length ? +(W.filter((w) => S.has(w)).length / W.length).toFixed(2) : null; }
    const repaired = share['0'] != null;
    const best = Object.entries(share).filter(([, v]) => v != null).sort((a, z) => z[1] - a[1])[0];
    const leaf = best && best[1] >= 0.8 ? ({ '-1': 'prev', 0: 'own', 1: 'next' })[best[0]] : 'none';
    out.push({ book_id: b.id, title: b.title, page: qt.page, leaf, repaired, belongs_to_page: leaf === 'prev' ? qt.page - 1 : leaf === 'next' ? qt.page + 1 : leaf === 'own' ? qt.page : null, share, n_words: W.length, text: String(text).slice(0, 240) });
  }
}
await c.close();
const by = {}; for (const o of out) by[o.leaf] = (by[o.leaf] || 0) + 1;
fs.writeFileSync(arg('out'), JSON.stringify({ at: new Date().toISOString(), n: out.length, by_leaf: by, quotes: out }, null, 1));
console.log(JSON.stringify({ n: out.length, by_leaf: by }));
