#!/usr/bin/env node
// PRIOR ART: scripts/eval/tengyur-characterize/build-controls.mjs (#5829) planted one negation, agent or
// term error per real page; its planters are reused here unchanged (plants.mjs). #6121 draws the plant
// pages from the four weak sections and adds one control kind, a SPAN plant, because the context arm's
// known cost is span errors (#5704).
/**
 * build-controls.mjs — read-only, $0. 20 blind planted controls for #6121, on stored English of pages in
 * the four sections that are NOT in the sample: 6 negation flips, 6 agent swaps, 4 wrong terms, and
 * 4 span plants (the last body sentence(s) of the previous side's stored English prepended to the page's
 * English, the shape a context arm produces when it re-translates the side before).
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/tengyur-levers/build-controls.mjs
 *   ... build-controls.mjs --round 2 [--attempt 1]        # round 2: fresh plants, defects filtered
 *   ... build-controls.mjs --round 2 --attempt 2 --calib  # a re-plant: 12 reversal/agent plants + 8 unplanted pages
 *
 * Writes /root/tlev/controls.jsonl and <out>/controls-log.json (round 2: /root/tlev2/controls-<attempt>.jsonl and
 * results/tengyur-models-6121/controls-log-<attempt>.json). Round 2 skips every page used by round 1's controls
 * or an earlier attempt, and drops two planter defects seen in round 1: a plant that leaves the sentence
 * unchanged, and "the opponent → we", which yields ungrammatical English ("we argues").
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { rng as mkRng, shuffle, sectionOf } from '../tengyur-characterize/common.mjs';
import { makePlanters } from '../tengyur-characterize/plants.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
// --round 3 (#6182): fresh plants for the fresh reviewer sample, with round 2's defect filter; every page
// of rounds 1–3 (samples, aligned sides, all earlier controls) is skipped.
const R3 = opt('round', '1') === '3';
const R2 = opt('round', '1') === '2' || R3;
const ATTEMPT = Number(opt('attempt', 1));
const CALIB = argv.includes('--calib');
const out = 'scripts/eval/results/tengyur-levers-6121';
const work = '/root/tlev';
const SEED = R3 ? 6182 * 7 + ATTEMPT : R2 ? 6121 * 7 + 100 + ATTEMPT : 6121 * 7 + 2;
const R = mkRng(SEED);
const { plantReversal, plantAgent, plantTerm, bodySentences } = makePlanters(R);
const sample = JSON.parse(fs.readFileSync(path.join(out, 'sample.json'), 'utf8'));
const used = new Set(sample.pages.map((p) => p.page_id));
if (R2) {
  const prior = R3 ? ['/root/tlev/controls.jsonl', '/root/tlev2/controls-1.jsonl', '/root/tlev2/controls-2.jsonl', '/root/tlev2/controls-3.jsonl', '/root/tlev/ref-pages.jsonl', '/root/pareto-6182/rev/sample-pages.jsonl',
    ...Array.from({ length: ATTEMPT - 1 }, (_, i) => `/root/pareto-6182/rev/controls-${i + 1}.jsonl`)]
    : ['/root/tlev/controls.jsonl', ...Array.from({ length: ATTEMPT - 1 }, (_, i) => `/root/tlev2/controls-${i + 1}.jsonl`)];
  for (const f of prior.filter((f) => fs.existsSync(f))) for (const l of fs.readFileSync(f, 'utf8').split('\n').filter(Boolean)) used.add(JSON.parse(l).page_id);
}
const SECTIONS = Object.keys(sample.plan);

const HAS_EN = { 'translation.data': { $type: 'string', $nin: [''] } };
const c = new MongoClient(process.env.MONGODB_URI);
await c.connect();
const db = c.db('bookstore');
const pages = db.collection('pages');
const vols = [];
for (const b of (await db.collection('books').find({ 'catalog_ids.derge_tengyur_volume': { $exists: true } }, { projection: { id: 1, title: 1, catalog_ids: 1 } }).toArray())
  .sort((a, b) => a.catalog_ids.derge_tengyur_volume - b.catalog_ids.derge_tengyur_volume)) {
  const section = sectionOf(b.title);
  if (SECTIONS.includes(section)) vols.push({ vol: b.catalog_ids.derge_tengyur_volume, book_id: b.id, section, with_english: await pages.countDocuments({ book_id: b.id, ...HAS_EN }) });
}
const total = vols.reduce((s, x) => s + x.with_english, 0);
const ln = (s) => (s || '').split('\n').filter((l) => l.trim());
async function full(book_id, page_number) {
  const p = await pages.findOne({ book_id, page_number }, { projection: { id: 1, page_number: 1, 'ocr.data': 1, 'ocr.text_edition.folio': 1, 'translation.data': 1 } });
  const nb = await pages.find({ book_id, page_number: { $in: [page_number - 1, page_number + 1] } }, { projection: { page_number: 1, 'ocr.data': 1, 'translation.data': 1 } }).toArray();
  const prev = nb.find((x) => x.page_number === page_number - 1);
  return { page_id: p.id, bo: p.ocr?.data || '', en: p.translation?.data || '', folio: p.ocr?.text_edition?.folio || null,
    prev_en: prev?.translation?.data || '',
    prev_last: ln(prev?.ocr?.data).slice(-1)[0] || '', next_first: ln(nb.find((x) => x.page_number === page_number + 1)?.ocr?.data)[0] || '' };
}
// Span plant: the previous side's last body sentences (≥ 120 chars together) put in front of the page.
function plantSpan(f) {
  const s = bodySentences(f.prev_en);
  if (s.length < 3) return null;
  const tail = [];
  for (let i = s.length - 1; i >= 0 && tail.join(' ').length < 120; i--) tail.unshift(s[i]);
  const body = f.en.replace(/^(\s*<meta>[\s\S]*?<\/meta>\s*)?/, '');
  const head = f.en.slice(0, f.en.length - body.length);
  return { old: '', new: tail.join(' '), how: 'previous side\'s last sentences prepended', en: `${head}${tail.join(' ')} ${body}` };
}

const items = [], log = [];
const plan = CALIB ? [...Array(6).fill('reversal'), ...Array(6).fill('agent'), ...Array(8).fill('none')]
  : [...Array(6).fill('reversal'), ...Array(6).fill('agent'), ...Array(4).fill('term'), ...Array(4).fill('span')];
const defect = (p) => R2 && p && (p.old === p.new || /the opponent/.test(p.how));
for (const kind of plan) {
  for (let tries = 0; ; tries++) {
    if (tries > 200) throw new Error('ran out of plant candidates');
    const g = Math.floor(R() * total);
    let k = g, v;
    for (const x of vols) { if (k < x.with_english) { v = x; break; } k -= x.with_english; }
    const [pg] = await pages.find({ book_id: v.book_id, ...HAS_EN }, { projection: { id: 1, page_number: 1 } }).sort({ page_number: 1 }).skip(k).limit(1).toArray();
    if (used.has(pg.id)) continue;
    const f = await full(v.book_id, pg.page_number);
    if (kind === 'none') {
      if (!f.en || f.en.length < 400) continue;
      used.add(pg.id);
      const { prev_en, ...rest } = f;
      items.push({ ctype: 'REAL', plant_kind: 'none', vol: v.vol, section: v.section, book_id: v.book_id, page_number: pg.page_number, ...rest, plant: null });
      log.push({ page_id: pg.id, vol: v.vol, section: v.section, page_number: pg.page_number, kind });
      break;
    }
    const p = kind === 'reversal' ? plantReversal(f.en) : kind === 'agent' ? plantAgent(f.en) : kind === 'term' ? plantTerm(f.en) : plantSpan(f);
    if (!p) { log.push({ skipped: pg.id, kind, why: 'no plantable sentence' }); continue; }
    if (defect(p)) { log.push({ skipped: pg.id, kind, why: 'planter defect (no-op or "the opponent → we")', how: p.how }); continue; }
    used.add(pg.id);
    const en = kind === 'span' ? p.en : f.en.replace(p.old, p.new);
    delete p.en;
    const { prev_en, ...rest } = f;
    items.push({ ctype: 'PLANT', plant_kind: kind, vol: v.vol, section: v.section, book_id: v.book_id, page_number: pg.page_number, ...rest, en, plant: p });
    log.push({ page_id: pg.id, vol: v.vol, section: v.section, page_number: pg.page_number, kind, ...p });
    break;
  }
}
const cFile = R3 ? `/root/pareto-6182/rev/controls-${ATTEMPT}.jsonl` : R2 ? `/root/tlev2/controls-${ATTEMPT}.jsonl` : path.join(work, 'controls.jsonl');
const lFile = R3 ? `scripts/eval/results/pareto-6182/tib-rev/controls-log-${ATTEMPT}.json` : R2 ? `scripts/eval/results/tengyur-models-6121/controls-log-${ATTEMPT}.json` : path.join(out, 'controls-log.json');
fs.mkdirSync(path.dirname(cFile), { recursive: true }); fs.mkdirSync(path.dirname(lFile), { recursive: true });
fs.writeFileSync(cFile, shuffle(items, R).map((x) => JSON.stringify(x)).join('\n') + '\n');
fs.writeFileSync(lFile, JSON.stringify({ seed: SEED, calib: CALIB, plants: log }, null, 1));
console.log(`controls: ${items.length}`, items.reduce((m, x) => ((m[x.plant_kind] = (m[x.plant_kind] || 0) + 1), m), {}));
await c.close();
