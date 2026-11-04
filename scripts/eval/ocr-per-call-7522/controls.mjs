#!/usr/bin/env node
// PRIOR ART: scripts/eval/agy-per-call-7503/prep.mjs `controls` (PR #7518) — the same seeded pick (3 drop, 2 bleed,
// one page per book with its next page in the draw), copied here because that file reads the #7503 draw beside it.
/**
 * #7522 planted controls: 5 pages from 5 different books, 3 `drop` (a line taken out) and 2 `bleed` (a line of the
 * next page added), each with its next page in the draw. They get their own fresh one-per-call read (the CTL arm),
 * which prep.mjs tampers: a judge holding another arm's text beside an untouched copy could find the fault by diffing.
 *
 *   node scripts/eval/ocr-per-call-7522/controls.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { makeRng } from '../lib/paired-stats.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const SEED = 75221;
const draw = JSON.parse(fs.readFileSync(path.join(HERE, 'draw.json'), 'utf8'));
const rng = makeRng(SEED);
const books = [...draw.books];
for (let i = books.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [books[i], books[j]] = [books[j], books[i]]; }
const controls = books.slice(0, 5).map((b, i) => { const k = Math.floor(rng() * 3); return { page_id: b.pages[k].page_id, book_id: b.book_id, page_number: b.pages[k].page_number, kind: i < 3 ? 'drop' : 'bleed', neighbour_id: b.pages[k + 1].page_id }; });
fs.writeFileSync(path.join(HERE, 'controls.json'), JSON.stringify({ seed: SEED, controls }, null, 1) + '\n');
fs.writeFileSync(path.join(HERE, 'control-ids.json'), JSON.stringify(controls.map((c) => c.page_id)) + '\n');
console.log(controls);
