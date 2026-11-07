#!/usr/bin/env node
// PRIOR ART: scripts/audit/leaf-shift-controls-fixture-5021.mjs — writes the four by-eye controls as NUMBERS only, which
// is all the number vote reads. The block-page guard also reads LENGTHS (absorption) and each page's first and last
// characters (anchor), so this keeps those too, for the same four controls and for clean blocks of every script family.
/**
 * Writes tests/fixtures/block-page-guard-5021.json (#5021). Read-only. Each page is reduced to:
 *   src  [text, length]: the first and last 60 characters of its OCR (digits removed) and its running-head and body
 *        numbers, and the OCR's original length (the test pads the text with '~' to it: absorption reads raw lengths,
 *        the anchor fold drops '~');
 *   en   [text, length] for its English (numbers only), or '' when untranslated.
 * controls  the four by-eye shifts, English rebuilt as it stood before containment (--as-of, from page_revisions).
 * clean     per script family, 20 windows of 4 consecutive text pages, one per book, each page's translation written
 *           by a call of its own (translation.updated_at more than 2 s from its neighbours': not one block), so none can
 *           carry a neighbour's leaf from a block slide.
 *   node --env-file=.env.production.local scripts/audit/block-page-guard-fixture-5021.mjs
 */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
import { splitLayer, numbersIn, ABSORB_SAME_BLOCK_MS } from '../lib/leaf-shift.mjs';

const CONTROLS = [
  ['karl', '69b51e05768235dc6598b5c1', '2026-11-02T00:00:00Z', 13, 23, [16, 17, 18, 19, 20], 'EN(n) = DE(n+1) on pp.16-19; p.20 EN = p.19 footnotes (by eye, #7968)'],
  ['corpus-medicorum', '69af49c4d6be7ec9cc3246fd', '2026-11-02T00:00:00Z', 79, 87, [82, 83, 84], 'p.82 holds 82+83, p.83 EN = p.84 Latin; p.84 EN a model note (by eye, #7968)'],
  ['postel', '69b51e39768235dc6598dede', '2026-10-20T00:00:00Z', 176, 187, [178, 179, 180, 181, 182, 183, 184], 'scans 179-184: EN(n) = Latin(n+1) (by eye, #5021)'],
  ['sakuntala', '69dea23c4d19ec2e9ba75f5e', '2026-10-12T00:00:00Z', 288, 297, [291, 292, 293, 294], 'pp.291-294 EN = next leaf (by eye, #6672)'],
];
const FAMILIES = {
  latin: /^(latin|german|french|italian|dutch|spanish|portuguese)\b/i,
  greek: /^(ancient )?greek\b/i,
  han: /^(classical )?chinese\b|^japanese\b/i,
  tibetan: /^tibetan\b/i,
  devanagari: /^(sanskrit|hindi|marathi)\b/i,
  arabic: /^(arabic|persian|ottoman|urdu)\b/i,
  hebrew: /^(hebrew|aramaic|yiddish)\b/i,
};
const SKIP = /index|errata|title|blank|bibliograph|contents|toc|glossary|apparatus|spread|insert|illustration|plate|map/i;
const enc = (t, { ends = false } = {}) => {
  const raw = String(t || '');
  if (!raw.trim()) return '';
  const { head, body } = splitLayer(raw);
  const h = [...numbersIn(head, { brackets: false })], b = [...numbersIn(body)];
  const flat = body.replace(/\s+/g, ' ').trim().replace(/[0-9٠-٩۰-۹०-९༠-༩]/g, '');
  const core = `${h.length ? `<header>${h.join(' ')}</header>\n` : ''}${ends ? `${flat.slice(0, 60)}\n` : 'text\n'}${b.join(' ')}${ends ? `\n${flat.slice(-60)}` : ''}`;
  return [core, raw.length];
};
const c = new MongoClient(process.env.MONGODB_URI, { readPreference: 'secondaryPreferred' }); await c.connect(); const db = c.db('bookstore');
const PROJ = { id: 1, page_number: 1, page_type: 1, 'ocr.data': 1, 'translation.data': 1, 'translation.updated_at': 1 };
const out = { built: new Date().toISOString().slice(0, 10), controls: {}, clean: {} };
for (const [k, book, asOf, lo, hi, shifted, what] of CONTROLS) {
  const pages = await db.collection('pages').find({ book_id: book, page_number: { $gte: lo, $lte: hi } }, { projection: PROJ }).sort({ page_number: 1 }).toArray();
  const revs = await db.collection('page_revisions').find({ page_id: { $in: pages.map((p) => p.id) }, field: 'translation', created_at: { $gt: new Date(asOf) } }).sort({ created_at: 1 }).toArray();
  const first = new Map(); for (const r of revs) if (!first.has(r.page_id)) first.set(r.page_id, r);
  out.controls[k] = { book_id: book, as_of: asOf, by_eye: what, shifted, pages: pages.map((p) => ({ page_number: p.page_number, page_type: p.page_type ?? null, src: enc(p.ocr?.data, { ends: true }), en: enc(first.get(p.id)?.data ?? p.translation?.data ?? '') })) };
  console.log(k, pages.length, 'pages');
}
let seed = 5021;
const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const ok = (p) => (p.ocr?.data || '').length >= 300 && (p.translation?.data || '').length > 80 && !SKIP.test(p.page_type || '') && p.translation?.updated_at;
const apart = (a, b) => Math.abs(new Date(a.translation.updated_at) - new Date(b.translation.updated_at)) > ABSORB_SAME_BLOCK_MS;
for (const [fam, re] of Object.entries(FAMILIES)) {
  const books = (await db.collection('books').find({ visible: true, pages_translated: { $gte: 6 } }, { projection: { id: 1, language: 1 } }).toArray()).filter((b) => re.test(b.language || ''));
  books.sort(() => rnd() - 0.5);
  const wins = [];
  for (const b of books) {
    if (wins.length >= 20) break;
    const pages = await db.collection('pages').find({ book_id: b.id, page_number: { $gt: 0 }, translation_withheld: { $exists: false } }, { projection: PROJ }).sort({ page_number: 1 }).toArray();
    const starts = [];
    for (let i = 0; i + 4 <= pages.length; i++) {
      const w = pages.slice(i, i + 4);
      if (w.every((p, d) => ok(p) && p.page_number === w[0].page_number + d) && w.every((p, d) => d === 0 || apart(w[d - 1], p))) starts.push(i);
    }
    if (!starts.length) continue;
    const i = starts[Math.floor(rnd() * starts.length)];
    const w = pages.slice(i, i + 4);
    // The page either side, as the call's context (its source only).
    const prev = pages[i - 1]?.page_number === w[0].page_number - 1 ? pages[i - 1] : null, next = pages[i + 4]?.page_number === w[3].page_number + 1 ? pages[i + 4] : null;
    wins.push({ book_id: b.id, language: b.language, prevSrc: prev ? enc(prev.ocr?.data, { ends: true }) : null, nextSrc: next ? enc(next.ocr?.data, { ends: true }) : null, pages: w.map((p) => ({ page_number: p.page_number, page_type: p.page_type ?? null, src: enc(p.ocr?.data, { ends: true }), en: enc(p.translation?.data) })) });
  }
  out.clean[fam] = wins;
  console.log(fam, wins.length, 'clean windows of', books.length, 'books');
}
fs.writeFileSync('tests/fixtures/block-page-guard-5021.json', JSON.stringify(out) + '\n');
await c.close();
