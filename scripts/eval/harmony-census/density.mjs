// PRIOR ART: harvest.mjs here (windows around one match) and scripts/eval/fragment-sort/term-harvest.mjs (#7065,
// laptop FTS) — neither counts how MUCH a page talks about a term. none fits #7117's "who discusses it most" ask.
//
// Read-only. One row per public page that names harmony or sympathy (original-language OCR lane, and our English
// translation lane): how many times it names each, and which neighbouring concepts the same page names (English
// lane only, for the concept map). Counting runs server-side ($regexFindAll sizes, $regexMatch flags), so only
// numbers cross the wire. Writes $OUT/density-<lane>.jsonl.gz + .done (checkpoint per lane).
// Usage: node --env-file=/root/sourcelibrary/.env.production.local density.mjs <harvest-dir> [ocr|tr|zh]
import { MongoClient } from 'mongodb';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const [H, ...want] = process.argv.slice(2);
const cat = JSON.parse(fs.readFileSync(path.join(H, 'catalog.json'), 'utf8'));

// Harmony and sympathy families, original languages (Latin, Greek, German, French, Italian, Spanish, English OCR)
const H_ORIG = '\\b(?:h?armoni[a-zæ]*|concent[a-z]*|consonan[a-z]*|concordi[a-z]*|symphoni[a-z]*|harmonie[n]?|harmonisch[a-z]*|mitklang|zusammenstimmung|einklang|eintracht|harmony|harmonies|harmonious|concord)\\b|[ἁἀα]ρμον|συμφων';
const S_ORIG = '\\b(?:s[iy]mpat[hií][a-z]*|antipat[hií][a-z]*|reson[a-z]*|mitklang|sympathy|sympathetic)\\b|συμπ[αά]θ|[αἀ]ντιπ[αά]θ';
const H_EN = '\\b(?:harmon[a-z]*|concord[a-z]*|consonan[a-z]*|symphon[a-z]*|attune[a-z]*)\\b';
const S_EN = '\\b(?:sympath[a-z]*|antipath[a-z]*|resonan[a-z]*|resound[a-z]*)\\b';
const ZH_H = '中和|太和|和聲|和声|和氣|和气|和諧|和谐|和而不同|謂之和|谓之和';
const ZH_S = '感應|感应|同聲相應|同声相应|同類相動|同类相动|相感|感通';

// Concepts for the co-occurrence map (English lane)
const CONCEPTS = {
  number: '\\b(?:numbers?|ratios?|proportion[a-z]*|octave|fifth|interval[a-z]*|arithmetic[a-z]*)\\b',
  music: '\\b(?:music[a-z]*|songs?|melod[a-z]*|tones?|strings?|lyre|lute|chords?)\\b',
  love: '\\b(?:love[sd]?|loving|friendship|amity|charity)\\b',
  concord_social: '\\b(?:citizens?|city|state|commonwealth|society|peace|kingdom|republic)\\b',
  soul: '\\b(?:souls?|spirits?|mind)\\b',
  temperament_health: '\\b(?:temperament|temper|humou?rs?|health|healthy|disease|complexion|medicine|cure)\\b',
  magnet: '\\b(?:magnet[a-z]*|lodestone|loadstone|iron)\\b',
  antipathy: '\\b(?:antipath[a-z]*|enmity|hatred|discord[a-z]*)\\b',
  cosmos: '\\b(?:spheres?|heavens?|cosmos|planets?|stars?|celestial)\\b',
  god: '\\b(?:god|divine|deity|creator)\\b',
  opposites: '\\b(?:opposites?|contrar[a-z]*|diverse|diversity|unlike|different)\\b',
  order: '\\b(?:order|ordered|rank|hierarch[a-z]*)\\b',
  body: '\\b(?:body|bodies|members|organs?)\\b',
};

const LANES = {
  ocr: { field: 'ocr.data', search: { text: { path: 'ocr.data', query: 'harmonia harmoniae harmoniam harmoniæ armonia concentus concentum consonantia consonantiae concordia concordiae symphonia Harmonie harmonie harmony harmonies concord sympathia sympathiae sympathiam antipathia antipathiae sympathie antipathie simpatia Sympathie Antipathie consensus resonantia resonare Mitklang Einklang Eintracht sympathy sympathetic συμφωνία ἁρμονία συμπάθεια' } }, H: H_ORIG, S: S_ORIG },
  tr: { field: 'translation.data', search: { text: { path: 'translation.data', query: 'harmony harmonies harmonious harmonic harmonize concord consonance symphony attunement sympathy sympathies sympathetic antipathy antipathies resonance resonant resound resounds consensus' } }, H: H_EN, S: S_EN, concepts: true },
  zh: { field: 'ocr.data', search: { compound: { should: [...ZH_H.split('|'), ...ZH_S.split('|')].map((query) => ({ phrase: { query, path: 'ocr.data' } })), minimumShouldMatch: 1 } }, H: ZH_H, S: ZH_S, opts: '' },
};

const c = new MongoClient(process.env.MONGODB_URI);
await c.connect();
const pages = c.db('bookstore').collection('pages');
for (const [id, L] of Object.entries(LANES)) {
  if (want.length && !want.includes(id)) continue;
  const file = path.join(H, `density-${id}.jsonl.gz`), done = file + '.done';
  if (fs.existsSync(done)) { console.log(id, 'done already'); continue; }
  const t0 = Date.now();
  const src = { $ifNull: ['$' + L.field, ''] };
  const opts = L.opts ?? 'i';
  const proj = {
    _id: 0, book_id: 1, page_number: 1, len: { $strLenCP: src },
    h: { $size: { $regexFindAll: { input: src, regex: L.H, options: opts } } },
    s: { $size: { $regexFindAll: { input: src, regex: L.S, options: opts } } },
  };
  if (L.concepts) for (const [k, re] of Object.entries(CONCEPTS)) proj['c_' + k] = { $regexMatch: { input: src, regex: re, options: 'i' } };
  const rows = [];
  for await (const r of pages.aggregate([{ $search: { index: 'pages_search', ...L.search } }, { $project: proj }], { maxTimeMS: 3_600_000, batchSize: 1000 })) {
    if (!cat[r.book_id] || (!r.h && !r.s)) continue;
    const o = { id: r.book_id, p: r.page_number, len: r.len, h: r.h, s: r.s };
    if (L.concepts) o.c = Object.keys(CONCEPTS).filter((k) => r['c_' + k]);
    rows.push(o);
  }
  fs.writeFileSync(file, zlib.gzipSync(rows.map((r) => JSON.stringify(r)).join('\n') + '\n'));
  fs.writeFileSync(done, JSON.stringify({ lane: id, pages: rows.length, books: new Set(rows.map((r) => r.id)).size, s: Math.round((Date.now() - t0) / 1000) }));
  console.log(id, fs.readFileSync(done, 'utf8'));
}
await c.close();
