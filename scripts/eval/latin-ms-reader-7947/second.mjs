#!/usr/bin/env node
// PRIOR ART: scripts/eval/latin-strata-7947/build-second.mjs (the same packet for SECOND-READER.md, one arm, with the
// translation). Here every arm's serious calls go, under the judge's neutral labels, so the second reader is blind to arm.
/**
 *   node scripts/eval/latin-ms-reader-7947/second.mjs --set ms|inc --scratch <job dir>
 * Reads <scratch>/judge/<set>/{packets,first/reviews}; writes <scratch>/judge/<set>/second/packets/packet-N.json
 * (12 pages a packet; pages of one entry kept together, entries in a seeded order). No model.
 */
import fs from 'node:fs';
import path from 'node:path';
import { makeRng } from '../lib/paired-stats.mjs';
import { claimsOf } from '../latin-strata-7947/lib.mjs';

const args = process.argv.slice(2);
const opt = (k) => args[args.indexOf(`--${k}`) + 1];
const DIR = path.join(opt('scratch'), 'judge', opt('set'));
const PER = 12;
const entries = new Map();
for (const f of fs.readdirSync(path.join(DIR, 'packets'))) for (const e of JSON.parse(fs.readFileSync(path.join(DIR, 'packets', f), 'utf8'))) entries.set(e.book_id, e);
const reviews = fs.readdirSync(path.join(DIR, 'first/reviews')).filter((f) => f.endsWith('.json'))
  .flatMap((f) => JSON.parse(fs.readFileSync(path.join(DIR, 'first/reviews', f), 'utf8')));
const pages = [];
for (const r of reviews) {
  const e = entries.get(r.book_id);
  if (!e) { console.log(`review for unknown label ${r.book_id}`); continue; }
  for (const rp of r.pages || []) {
    const claims = claimsOf(r.book_id, rp).filter((c) => c.e.severity === 'serious' && c.lane !== 'tr');
    if (!claims.length) continue;
    const d = e.pages.find((p) => p.page_number === rp.page_number);
    pages.push({ book_id: r.book_id, title: e.book.title, published: e.book.published, page_number: rp.page_number, image_url: d.image_url,
      crop: d.crop, ocr: d.ocr, translation: null,
      claims: claims.map((c) => ({ claim_id: c.claim_id, lane: c.lane, class: c.e.class ?? null, stored: c.e.ocr ?? null,
        image: c.e.image ?? null, problem: c.e.problem ?? c.e.note ?? null })) });
  }
}
const rng = makeRng(20261103 + 7);
const order = [...new Set(pages.map((p) => p.book_id))].map((l) => [rng(), l]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
const sorted = order.flatMap((l) => pages.filter((p) => p.book_id === l));
const out = path.join(DIR, 'second/packets');
fs.mkdirSync(out, { recursive: true });
for (let k = 0; k * PER < sorted.length; k++) fs.writeFileSync(path.join(out, `packet-${String(k + 1).padStart(2, '0')}.json`), JSON.stringify(sorted.slice(k * PER, (k + 1) * PER), null, 1));
console.log(`${pages.reduce((s, p) => s + p.claims.length, 0)} serious calls on ${pages.length} pages → ${Math.ceil(sorted.length / PER)} packets`);
