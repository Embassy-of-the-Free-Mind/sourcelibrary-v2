#!/usr/bin/env node
// PRIOR ART: scripts/eval/experiments/2026-10-03-reference-free-reversal-detectors-5695.md (D1 negation
// counts, $0; D2/D3 model checks) — D1 was at chance on Tibetan (AUC 0.52) and the model checks cost money.
// scripts/eval/tengyur-arms/negcheck.py counts negations. None checks objection voice, named technical
// terms or Pali forms, which is what #5800 round 2 found and #5829 asks for.
/**
 * detect.mjs — read-only, $0. Step 4 of #5829: three detectors over every Derge Tengyur page with English.
 *   (a) opponent voice: the Tibetan marks an objection (ཞེ་ན, ཟེར་ན, ཞེས་ཟེར་བ, སྙམ་ན …) and the English has
 *       no objection signal ("if someone says", "objection", "?" …) within 15% of the page of the same
 *       relative position.
 *   (b) technical terms: a term in the Tibetan with none of its accepted renderings in the English.
 *       Two inventories: hand lists (Dharmakīrti reason-types, Vinaya offence classes; term-lists.json) and
 *       Mahāvyutpatti entries of 3+ syllables that 84000's glossary also lists (build-terms.py, on the box).
 *   (c) Pali forms in the English of this Sanskrit-tradition canon (term-lists.json `pali`).
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/tengyur-characterize/detect.mjs \
 *        [--terms /root/tchar/terms-mvy.json] [--out /root/tchar/detect.jsonl]
 *
 * Writes one line per page with English: {page_id, vol, section, a:{bo,en,flag}, b:{hand:[…], mvy:[…]}, c:[…]}.
 */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
import { sectionOf } from './common.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const L = JSON.parse(fs.readFileSync(new URL('./term-lists.json', import.meta.url), 'utf8'));
const MVY = fs.existsSync(arg('terms', '/root/tchar/terms-mvy.json')) ? JSON.parse(fs.readFileSync(arg('terms', '/root/tchar/terms-mvy.json'), 'utf8')) : [];
const OUT = arg('out', '/root/tchar/detect.jsonl');

export const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]+/g, ' ');
export const cleanBo = (s) => s.replace(/\{[^}]*\}/g, '').replace(/\(([^,()]*),([^()]*)\)/g, '$2').replace(/[#\\]/g, '').replace(/\s*\n\s*/g, '');
export const cleanEn = (s) => s.replace(/<(summary|keywords|meta)[^>]*>[\s\S]*?<\/\1>/g, '');
const STOP = new Set(['the', 'of', 'and', 'to', 'in', 'a', 'an', 'for', 'by', 'with', 'one', 'who', 'that', 'which', 'is', 'are', 'as', 'or', 'on', 'from', 'its', 'their', 'his', 'her', 'not']);
// A rendering is present when every content word of it starts a word of the English (first 5 letters).
export function hasRendering(enFolded, r) {
  const ws = fold(r).trim().split(' ').filter((w) => w.length >= 3 && !STOP.has(w));
  if (!ws.length) return false;
  return ws.every((w) => enFolded.includes(' ' + w.slice(0, Math.min(5, w.length))));
}
const boRe = (t) => new RegExp(`(?:^|[་།\\s])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[་།\\s]|འི|ར[་།\\s]|ས[་།\\s])`);
const HAND = [...L.reason_types.map((x) => ({ ...x, list: 'reason' })), ...L.vinaya.map((x) => ({ ...x, list: 'vinaya' }))].map((x) => ({ ...x, re: boRe(x.bo) }));
const MV = MVY.filter((x) => x.bo.split('་').length >= 3).map((x) => ({ ...x, re: boRe(x.bo) }));
const PALI = L.pali.map(([p, s]) => ({ p, s, re: new RegExp(`\\b${p}\\b`) }));
const OBJ_BO = new RegExp(L.objection_bo.map((m) => (m.endsWith('ན') ? `${m}(?=[་]?(?:།|\\s|$|ཡང|ཀྱང))` : m)).join('|'), 'g');
const OBJ_EN = new RegExp(L.objection_en, 'gi');
const WINDOW = 0.15;
// Variant without the question mark: a bare "?" also follows rhetorical questions and the author's own.
const OBJ_EN_NOQ = new RegExp(L.objection_en.replace(/^\\\?\|/, ''), 'gi');

export function detectPage(bo0, en0) {
  const bo = cleanBo(bo0 || '');
  const en = cleanEn(en0 || '');
  const enBody = en.replace(/<note>[\s\S]*?<\/note>/g, ' ');
  const ef = ' ' + fold(en) + ' ';
  // Position of each mark as a fraction of the page; an objection is "voiced" when the English has a
  // marker within WINDOW of the same relative position (sides are translated in order, so position is
  // a rough alignment).
  const posBo = [...bo.matchAll(OBJ_BO)].map((m) => m.index / Math.max(1, bo.length));
  const posEn = [...enBody.matchAll(OBJ_EN)].map((m) => m.index / Math.max(1, enBody.length));
  const unvoiced = posBo.filter((f) => !posEn.some((g) => Math.abs(g - f) <= WINDOW)).length;
  const posEnNoq = [...enBody.matchAll(OBJ_EN_NOQ)].map((m) => m.index / Math.max(1, enBody.length));
  const unvoicedNoq = posBo.filter((f) => !posEnNoq.some((g) => Math.abs(g - f) <= WINDOW)).length;
  const objBo = posBo.length, objEn = posEn.length;
  const missing = (list) => list.filter((t) => t.re.test(bo) && ![...t.en, ...(t.skt ? [].concat(t.skt) : [])].some((r) => hasRendering(ef, r))).map((t) => t.skt ? [].concat(t.skt)[0] : t.bo);
  const hand = missing(HAND);
  const mvy = missing(MV);
  const efBody = ' ' + fold(enBody) + ' ';
  const efRaw = ' ' + en.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase() + ' ';
  const pali = PALI.filter((x) => x.re.test(efRaw)).map((x) => x.p);
  return { a: { bo: objBo, en: objEn, unvoiced, flag: unvoiced > 0, unvoiced_noq: unvoicedNoq, flag_noq: unvoicedNoq > 0, strict: objBo > 0 && objEn === 0 }, b: { hand, mvy, flag: hand.length > 0 || mvy.length > 0 }, c: { forms: pali, flag: pali.length > 0 }, _efBody: efBody.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const c = new MongoClient(process.env.MONGODB_URI);
  await c.connect();
  const db = c.db('bookstore');
  const books = await db.collection('books').find({ 'catalog_ids.derge_tengyur_volume': { $exists: true } }, { projection: { id: 1, title: 1, catalog_ids: 1 } }).toArray();
  const out = fs.createWriteStream(OUT);
  let n = 0;
  for (const b of books.sort((x, y) => x.catalog_ids.derge_tengyur_volume - y.catalog_ids.derge_tengyur_volume)) {
    const vol = b.catalog_ids.derge_tengyur_volume, section = sectionOf(b.title);
    const cur = db.collection('pages').find({ book_id: b.id, 'translation.data': { $type: 'string', $nin: [''] } }, { projection: { id: 1, page_number: 1, 'ocr.data': 1, 'translation.data': 1 } });
    for await (const p of cur) {
      const r = detectPage(p.ocr?.data, p.translation.data);
      delete r._efBody;
      out.write(JSON.stringify({ page_id: p.id, vol, section, page_number: p.page_number, ...r }) + '\n');
      n++;
    }
    process.stdout.write(`v${vol} `);
  }
  out.end();
  console.log(`\n${n} pages -> ${OUT}`);
  await c.close();
}
