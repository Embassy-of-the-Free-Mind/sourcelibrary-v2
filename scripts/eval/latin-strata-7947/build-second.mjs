#!/usr/bin/env node
// PRIOR ART: the spot-check skill §2b builds this packet by hand each round (no script in scripts/eval/spot-check/);
// this is that step for #7947, using analyze.mjs claimsOf() so the claim ids match what the analysis reads back.
/**
 * Why Latin struggles (#7947), stage 2b: (a) one packet per ~12 pages of every SERIOUS first-reader call, grouped by
 * page, for SECOND-READER.md; (b) a miss-check draw: books whose 3 pages carry no serious call, re-read blind with
 * REVIEWER.md by a fresh reader, so the rate's misses are measured as well as its over-calls.
 *
 *   node scripts/eval/latin-strata-7947/build-second.mjs --run <dir> [--miss-books 10]
 * Writes <dir>/second/packets/packet-N.json and <dir>/misses/packets/packet-N.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { makeRng } from '../lib/paired-stats.mjs';
import { claimsOf } from './lib.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const RUN = opt('run');
const MISS = Number(opt('miss-books', 10));
const PER = 12;
const J = (f) => JSON.parse(fs.readFileSync(path.join(RUN, f), 'utf8'));

const sample = J('draw/sample.json');
const reviews = fs.readdirSync(path.join(RUN, 'first/reviews')).filter((f) => f.endsWith('.json')).flatMap((f) => J(`first/reviews/${f}`));
const pages = [];
const clean = [];
for (const r of reviews) {
  const b = sample.find((s) => s.book_id === r.book_id);
  if (!b) continue;
  let anySerious = false;
  for (const rp of r.pages || []) {
    const claims = claimsOf(r.book_id, rp).filter((c) => c.e.severity === 'serious');
    if (!claims.length) continue;
    anySerious = true;
    const d = b.pages.find((p) => p.page_number === rp.page_number);
    pages.push({ book_id: r.book_id, title: b.book.title, published: b.book.published, page_number: rp.page_number, image_url: d.image_url,
      crop: d.crop, ocr: d.ocr, translation: d.translation,
      claims: claims.map((c) => ({ claim_id: c.claim_id, lane: c.lane, class: c.e.class ?? null,
        stored: c.e.ocr ?? c.e.english ?? null, source: c.e.source ?? null, image: c.e.image ?? null, problem: c.e.problem ?? c.e.note ?? null })) });
  }
  if (!anySerious) clean.push(b);
}
const dir2 = path.join(RUN, 'second/packets');
fs.mkdirSync(dir2, { recursive: true });
for (let k = 0; k * PER < pages.length; k++) fs.writeFileSync(path.join(dir2, `packet-${k + 1}.json`), JSON.stringify(pages.slice(k * PER, (k + 1) * PER), null, 1));
console.log(`second reader: ${pages.reduce((s, p) => s + p.claims.length, 0)} serious claims on ${pages.length} pages → ${Math.ceil(pages.length / PER)} packets`);

// Miss check: early or manuscript books first (where the question lives), then the rest, seeded.
const rng = makeRng(20261102 + 2);
const pri = (b) => (['pre-1450', '1450-1500'].includes(b.era) || b.hand_drawn === 'manuscript' ? 0 : 1);
const order = clean.map((b) => [pri(b), rng(), b]).sort((x, y) => x[0] - y[0] || x[1] - y[1]).map((x) => x[2]);
const take = [...order.filter((b) => pri(b) === 0).slice(0, Math.ceil(MISS / 2)), ...order.filter((b) => pri(b) === 1).slice(0, Math.floor(MISS / 2))];
const fill = order.filter((b) => !take.includes(b)).slice(0, MISS - take.length);
const miss = [...take, ...fill].slice(0, MISS);
const dirM = path.join(RUN, 'misses/packets');
fs.mkdirSync(dirM, { recursive: true });
const strip = (s) => ({ slot: s.slot, book_id: s.book_id, book_url: s.book_url, tradition: null, book: s.book, structure: s.structure, run: s.run,
  pages: s.pages.map(({ position, page_script_type, words, abbr_per_100_words, long_s, ...p }) => p) });
for (let k = 0; k * 5 < miss.length; k++) fs.writeFileSync(path.join(dirM, `packet-${k + 1}.json`), JSON.stringify(miss.slice(k * 5, (k + 1) * 5).map(strip), null, 1));
console.log(`miss check: ${miss.length} of ${clean.length} books with no serious call (${miss.filter((b) => pri(b) === 0).length} early or manuscript)`);
