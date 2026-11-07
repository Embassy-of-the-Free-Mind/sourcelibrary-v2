#!/usr/bin/env node
/**
 * JCB pre-1600 (#8049): turn the dedupe outcomes into an ia-manifest-direct.mjs manifest.
 *
 * PRIOR ART: scripts/import/ia-campaign-curate.mjs — emits the same manifest shape for a topic campaign
 * (relevance filter + work clustering + one scan per work); here the selection was already made per item
 * by scripts/import/jcb-1600/dedupe.ts and a by-record judgement, so only the field mapping is left.
 *
 *   node scripts/import/jcb-1600/build-manifest.mjs --outcomes $JOB_SCRATCH/s2/outcomes.jsonl \
 *        --candidates $JOB_SCRATCH/s1/candidates.json --out $JOB_SCRATCH/s3/jcb-1600-manifest.json
 *
 * Imports the outcomes `new`, `other_edition_held`, and `held_same_edition_ours_incomplete` (the last
 * with allow_duplicate, naming the held copy). Language is the record's MARC code list, first = edition
 * language (invariants/language-fields.md); `year` is the record's year.
 */
import fs from 'fs';
const arg = (f) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : null; };
const outcomes = fs.readFileSync(arg('--outcomes'), 'utf8').split('\n').filter(Boolean).map(JSON.parse);
const cands = new Map(JSON.parse(fs.readFileSync(arg('--candidates'), 'utf8')).map(c => [c.identifier, c]));

export const MARC_LANG = { lat: 'Latin', spa: 'Spanish', ita: 'Italian', ger: 'German', gmh: 'German', frm: 'French', fre: 'French',
  eng: 'English', enm: 'English', dut: 'Dutch', dum: 'Dutch', por: 'Portuguese', nah: 'Nahuatl', myn: 'Maya', gre: 'Greek', grc: 'Greek',
  heb: 'Hebrew', gem: 'German', nds: 'German', arc: 'Aramaic', cai: 'Nahuatl', tup: 'Tupi', cat: 'Catalan', ara: 'Arabic', pol: 'Polish', cze: 'Czech', dan: 'Danish', swe: 'Swedish', hun: 'Hungarian',
  que: 'Quechua', ice: 'Icelandic', wel: 'Welsh', tar: 'Tarascan', zap: 'Zapotec', mix: 'Mixtec', ota: 'Turkish', tur: 'Turkish', chi: 'Chinese',
  jpn: 'Japanese', syr: 'Syriac', arm: 'Armenian', gez: "Ge'ez", rus: 'Russian', sco: 'Scots', glg: 'Galician', aym: 'Aymara', oto: 'Otomi', srp: 'Serbian' };

const clean = s => String(s ?? '').replace(/\s+/g, ' ').replace(/\s*[:;,/]\s*$/, '').trim();
/** "Ortelius, Abraham, 1527-1598" → "Abraham Ortelius"; corporate or single-part names unchanged. */
export function displayAuthor(creator) {
  const raw = Array.isArray(creator) ? creator[0] : creator;
  if (!raw || /^unknown$/i.test(String(raw).trim())) return 'Unknown';
  let s = String(raw);
  if (/\(\d{4}-\d{4}\s*:/.test(s)) return s.trim();     // "Spain. Sovereign (1516-1556 : Charles I)": a heading, keep whole
  s = s.replace(/\.\s+(Letter|fmo)\b.*$/i, '').replace(/,\s*\d{1,2}(st|nd|rd|th) cent(ury)?\.?/i, '')
    .replace(/,\s*(ca\.\s*)?\d{3,4}-ca\.\s*\d{3,4}$/, '').replace(/,\s*\.?-?\d{3,4}( or \d{3,4})?$/, '')
    .replace(/\s*\([^)]*\)/g, '')                        // "Gaillard, P. D. (Pierre Droit de)"
    .replace(/,\s*(approximately\s*|ca\.\s*)?(\d{3,4}(\s*or\s*\d{3,4})?\??)?-(approximately\s*)?(\d{3,4})?\??\.?$/, '') // ", 1533 or 1534-1611", ", -1563", ", 1519-"
    .replace(/,\s*(active|fl\.|d\.|b\.)\s*.*$/i, '')
    .replace(/[.,;\s]+$/, '').trim();
  const parts = s.split(/,\s*/);
  if (parts.length === 2 && !/[.]\s|\b(church|kingdom|council|company|spain|portugal|france|england|scotland|catholic|university|city|inquisition|jesuits)\b/i.test(s)) return `${parts[1]} ${parts[0]}`.trim();
  return s || 'Unknown';
}

const IMPORT = new Set(['new', 'other_edition_held', 'held_same_edition_ours_incomplete']);
const BOOKS = [];
const unknownLang = new Map();
for (const o of outcomes) {
  if (!IMPORT.has(o.outcome)) continue;
  const c = cands.get(o.identifier);
  // IA language values are MARC codes in any case ('LAT', 'Ger'), sometimes a full name ('Latin'); 'mul' says nothing.
  const NAMES = new Set(Object.values(MARC_LANG));
  const codes = (Array.isArray(c.language) ? c.language : [c.language]).filter(x => typeof x === 'string').map(x => x.trim());
  const langs = [...new Set(codes.map(x => { const k = x.toLowerCase(); if (NAMES.has(x)) return x; if (k === 'mul') return null;
    if (!MARC_LANG[k]) unknownLang.set(x, (unknownLang.get(x) || 0) + 1); return MARC_LANG[k]; }).filter(Boolean))];
  const year = parseInt(String(c.year ?? ''), 10);
  if (!year || year < 1450 || year > 1600) { console.error(`skip ${o.identifier}: year ${c.year}`); continue; }
  const b = { id: o.identifier, title: clean(c.title).slice(0, 300) || o.identifier, author: displayAuthor(c.creator), year,
    lang: langs[0] || 'Unknown', ...(langs.length > 1 ? { languages: langs } : {}),
    note: `JCB pre-1600 acquisition (#8049); dedupe outcome ${o.outcome}${o.matched_book_id ? ` vs ${o.matched_book_id}` : ''}${c.call_number ? `; JCB call number ${c.call_number}` : ''}` };
  if (o.outcome === 'held_same_edition_ours_incomplete') b.allow_duplicate = `same edition as ${o.matched_book_id}, held copy incomplete: ${o.why}`;
  BOOKS.push(b);
}
if (unknownLang.size) console.error('unmapped MARC codes:', Object.fromEntries(unknownLang));
const out = { campaign: 'jcb-1600-8049', collections: [], BOOKS };
fs.writeFileSync(arg('--out'), JSON.stringify(out, null, 1));
const byLang = {}; for (const b of BOOKS) byLang[b.lang] = (byLang[b.lang] || 0) + 1;
console.log(`${BOOKS.length} books →`, arg('--out'), byLang);
