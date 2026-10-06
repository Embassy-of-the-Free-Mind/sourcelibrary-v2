#!/usr/bin/env node
// #6012 step 3a: CANDIDATE pairs (typed text × one of our books), from identifiers first and catalogue
// fields second. Read-only: reads the local books projection (export-books.mjs) and the manifests.
// A candidate is not a match. verify.mjs reads the text of both sides and decides, and it is the page
// breaks, not the catalogue, that say "same edition" (edition-identity.md: the catalogue year and title
// are the edition's marketing line; #5126: confirm that the transcription's <pb> fall where ours do).
//
// PRIOR ART: /data/scratch latin-5126/camena-match.js and join-tcp.js (job-local, never committed):
//   title-token + surname + year±1 for CAMENA, STC/Wing/ESTC number for the IA microfilm books. Same
//   tiers here, for three sources, with the reason kept on every row. The edition key is
//   scripts/lib/identity-fields.mjs `buildEditionKey` (the only definition; not reimplemented), title
//   tokens and stems are scripts/lib/work-identity-match.mjs.
//
//   node scripts/eval/typed-refs-6012/match.mjs --source=dta|camena|eebo-tcp [--work=DIR]
// Writes <work>/<source>/candidates.jsonl

import fs from 'node:fs';
import path from 'node:path';
import { buildEditionKey, editionSurname, editionYear } from '../../lib/identity-fields.mjs';
import { titleTokens, stem } from '../../lib/work-identity-match.mjs';
import { argOf } from './lib.mjs';

const SOURCE = argOf('source');
const WORK = argOf('work', '/data/scratch/sl/typed-refs-6012');
const dirOf = { dta: 'dta', camena: 'camena', 'eebo-tcp': 'eebo' }[SOURCE];
const readJsonl = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

// Our side. Language of the EDITION (language-fields.md), so a Latin CAMENA text is offered Latin books.
const LANGS = { dta: ['German', 'Latin'], camena: ['Latin'], 'eebo-tcp': ['English', 'Latin', 'Middle English', 'French', 'Welsh'] }[SOURCE];
const books = readJsonl(`${WORK}/books.jsonl`).filter((b) => (b.pages_ocr || 0) > 0);
const foldTok = (t) => stem(t.replace(/v/g, 'u').replace(/j/g, 'i').replace(/y/g, 'i').replace(/ß/g, 'ss').replace(/ſ/g, 's'));
const toks = (s) => new Set(titleTokens(String(s || '').replace(/ſ/g, 's').replace(/ß/g, 'ss').replace(/æ/gi, 'ae').replace(/œ/gi, 'oe')).filter((t) => t.length >= 5).map(foldTok));
const surnameOf = (a) => editionSurname(String(a || '').split(';')[0]).replace(/[^a-z]/g, '').replace(/v/g, 'u').replace(/j/g, 'i');
const idsOfBook = (b) => {
  const s = [b.ia_identifier, b.image_source?.identifier, b.image_source?.source_url].filter(Boolean).join(' ');
  return new Set([...(s.match(/bsb\d{8}/gi) || []).map((x) => x.toLowerCase()), ...(s.match(/PPN\d+[0-9X]/gi) || []).map((x) => x.toUpperCase()),
    ...(b.ia_identifier ? [`ia:${b.ia_identifier}`] : []), ...((s.match(/e-rara\.ch\/[^\s"]*?(\d{5,})/) || []).slice(1).map((x) => `erara:${x}`))]);
};
const pool = books.filter((b) => LANGS.includes(b.language) || (b.languages || []).some((l) => LANGS.includes(l)));
const byId = new Map(), byKey = new Map(), bySurname = new Map(), byYear = new Map();
for (const b of pool) {
  b._t = toks(b.title); b._s = surnameOf(b.author); b._y = editionYear(b);
  for (const i of idsOfBook(b)) { if (!byId.has(i)) byId.set(i, []); byId.get(i).push(b); }
  if (b.edition_key) { if (!byKey.has(b.edition_key)) byKey.set(b.edition_key, []); byKey.get(b.edition_key).push(b); }
  if (b._s.length >= 4) { if (!bySurname.has(b._s)) bySurname.set(b._s, []); bySurname.get(b._s).push(b); }
  if (b._y) { if (!byYear.has(b._y)) byYear.set(b._y, []); byYear.get(b._y).push(b); }
}
// Token rarity over our pool: a shared rare token is evidence, a shared "historia" is not.
const df = new Map();
for (const b of pool) for (const t of b._t) df.set(t, (df.get(t) || 0) + 1);
const rare = (t) => (df.get(t) || 0) <= 40;

// IA microfilm catalogue numbers → our books (EEBO-TCP only).
const catIdx = new Map();
if (SOURCE === 'eebo-tcp' && fs.existsSync(`${WORK}/ia-catalog-numbers.jsonl`)) {
  const iaBook = new Map(pool.filter((b) => /^bim_/.test(b.ia_identifier || '')).map((b) => [b.ia_identifier, b]));
  for (const r of readJsonl(`${WORK}/ia-catalog-numbers.jsonl`)) {
    const b = iaBook.get(r.ia); if (!b || !r.cat) continue;
    const coll = r.ia.split('_')[1] || ''; const cat = String(r.cat).replace(/\s+/g, '').replace(/\+$/, '').toUpperCase();
    for (const k of coll.includes('1475') ? [`STC:${cat}`] : coll.includes('1641') ? [`WING:${cat}`] : [`ESTC:${cat}`]) { if (!catIdx.has(k)) catIdx.set(k, []); catIdx.get(k).push(b); }
  }
}
const catKeysOfTcp = (ids) => {
  const out = [];
  for (const raw of ids.stc || []) for (const part of String(raw).split(';')) {
    const m = part.trim().match(/^(STC|Wing)\s*(?:\(2nd ed\.?\)\s*)?(.+)$/i);
    if (m && !/^ESTC/i.test(part.trim())) out.push(`${m[1].toUpperCase()}:${m[2].replace(/\s+/g, '').toUpperCase()}`);
  }
  for (const e of ids.estc || []) out.push(`ESTC:${String(e).toUpperCase()}`);
  return out;
};

const manifest = readJsonl(path.join(WORK, dirOf, 'manifest.jsonl'));
const out = fs.createWriteStream(path.join(WORK, dirOf, 'candidates.jsonl'));
const tally = {};
let nRef = 0;
for (const r of manifest) {
  if (!r.chars || r.chars < 3000) continue;                       // a letter or a one-leaf notice: nothing to align
  const cands = new Map();
  const add = (b, tier, reason, score) => { const c = cands.get(b.id); if (!c || c.score < score) cands.set(b.id, { book_id: b.id, tier, reason, score, book: { title: String(b.title || '').slice(0, 140), author: b.author || null, published: b.published ?? null, language: b.language, provider: b.image_source?.provider || null, pages_ocr: b.pages_ocr, work_id: b.work_id || null, visible: !!b.visible } }); };
  // 1. identifiers
  const idStr = [r.ids?.images_urn, r.ids?.images_url, r.ids?.catalogue_url].filter(Boolean).join(' ');
  for (const k of [...(idStr.match(/bsb\d{8}/gi) || []).map((x) => x.toLowerCase()), ...(idStr.match(/PPN\d+[0-9X]/gi) || []).map((x) => x.toUpperCase()), ...((idStr.match(/archive\.org\/details\/([\w.-]+)/) || []).slice(1).map((x) => `ia:${x}`))])
    for (const b of byId.get(k) || []) add(b, 'copy-id', `same digitised copy: ${k}`, 100);
  if (SOURCE === 'eebo-tcp') for (const k of catKeysOfTcp(r.ids || {})) for (const b of catIdx.get(k) || []) add(b, 'catalogue-number', `${k} = Internet Archive collection-catalog-number of the microfilm scan`, 95);
  // 2. the edition key (the one definition)
  const key = buildEditionKey({ title: r.title, author: String(r.author || '').split(';')[0], published: r.year ? String(r.year) : null }).key;
  if (key) for (const b of byKey.get(key) || []) add(b, 'edition-key', 'edition_key equal', 90);
  // 3. catalogue fields: surname + title tokens (+ year)
  const rt = toks(r.title_short ? `${r.title} ${r.title_short}` : r.title), rs = surnameOf(r.author);
  const consider = new Set([...(rs.length >= 4 ? bySurname.get(rs) || [] : [])]);
  if (r.year) for (const y of [r.year - 1, r.year, r.year + 1]) for (const b of byYear.get(y) || []) consider.add(b);
  for (const b of consider) {
    let n = 0, nr = 0;
    for (const t of rt) if (b._t.has(t)) { n++; if (rare(t)) nr++; }
    const am = rs.length >= 4 && (b._s === rs || (b._s.length >= 5 && rs.length >= 5 && (b._s.startsWith(rs) || rs.startsWith(b._s))));
    const sameYear = r.year && b._y && Math.abs(r.year - b._y) <= 1;
    if (am && (n >= 2 || nr >= 1) && sameYear) add(b, 'author-title-year', `surname ${rs}, ${n} title tokens (${nr} rare), year ${b._y}~${r.year}`, 60 + Math.min(20, n * 3 + nr * 3));
    else if (am && (n >= 2 || nr >= 1)) add(b, 'author-title', `surname ${rs}, ${n} title tokens (${nr} rare), years ${b._y ?? '?'} vs ${r.year ?? '?'}`, 40 + Math.min(15, n * 2 + nr * 3));
    else if (!am && sameYear && n >= 3 && nr >= 2) add(b, 'title-year', `${n} title tokens (${nr} rare), year ${b._y}~${r.year}, author differs or absent`, 35 + Math.min(15, n * 2));
  }
  const top = [...cands.values()].sort((a, b) => b.score - a.score).slice(0, 8);
  if (!top.length) continue;
  nRef++;
  for (const c of top) { tally[c.tier] = (tally[c.tier] || 0) + 1; out.write(JSON.stringify({ source: r.source, source_id: r.source_id, ref: { title: String(r.title || '').slice(0, 140), author: r.author, year: r.year, chars: r.chars, n_pages: r.n_pages, derived_shard: r.derived_shard }, ...c }) + '\n'); }
}
out.end(); await new Promise((res) => out.on('finish', res));
console.log(JSON.stringify({ source: SOURCE, pool: pool.length, texts: manifest.length, texts_with_candidates: nRef, pairs_by_tier: tally }));
