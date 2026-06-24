#!/usr/bin/env node
/**
 * Normalize book language tags + build the canonical `languages[]` array.
 *
 * Background: `books.language` (scalar) accreted 264 distinct values mixing
 * full names, ISO 639 codes, case variants, compound/multilingual strings, and
 * synonym spellings. This script canonicalizes them and derives a multi-valued
 * `languages[]` array so queries can reliably ask "all Latin-bearing works"
 * (incl. compounds like "Latin-German") via `{ languages: 'Latin' }`.
 *
 * It performs three normalizations:
 *   1. ISO-code / case folding on the SCALAR `language` (e.g. lat→Latin,
 *      unknown→Unknown), preserving the original in `language_raw`.
 *   2. Parse each value into `languages[]` — splitting compounds on
 *      ,  /  ;  " and "  " & "  ". " delimiters (and hyphen, EXCEPT for genuine
 *      hyphenated single languages like Judeo-Arabic / Anglo-Saxon, kept whole
 *      via EXTRA), mapping codes, and applying SYNONYM canonicalization.
 *   3. Set `language_multi` (>1 language) and `language_unparsed` flags.
 *
 * Idempotent: re-running on already-normalized data is a no-op (language_raw is
 * only set once via $ifNull-equivalent guard; languages[] is recomputed
 * deterministically from the scalar each run).
 *
 * The scalar `language` is preserved as the human-facing primary; `languages[]`
 * is the canonical machine field. Sentinels (Visual, Unknown, …) → languages[].
 *
 * History: first run 2026-05-31. Bugs caught + fixed during development and
 * folded into this final logic: (a) hyphen-compounds ("Latin-German") were
 * wrongly absorbed as single languages until hyphens were excluded from the
 * KNOWN bootstrap; (b) a synonym merge used a curly apostrophe (Ge’ez) that
 * didn't match the straight-apostrophe canonical (Ge'ez) — SYNONYM now maps
 * both forms to the straight one.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/normalize-language-tags.mjs            # dry-run
 *   node scripts/maintenance/normalize-language-tags.mjs --apply    # write
 */
import { MongoClient } from 'mongodb';

const APPLY = process.argv.includes('--apply');

// ISO 639 codes + case variants → canonical full name (scalar + array)
const CODE = {
  lat: 'Latin', la: 'Latin', ita: 'Italian', it: 'Italian', fre: 'French', fr: 'French',
  eng: 'English', en: 'English', ger: 'German', de: 'German', german: 'German',
  grc: 'Greek', gre: 'Greek', jpn: 'Japanese', ja: 'Japanese', ara: 'Arabic', ar: 'Arabic',
  kor: 'Korean', per: 'Persian', fa: 'Persian', spa: 'Spanish', dut: 'Dutch',
  sa: 'Sanskrit', san: 'Sanskrit', heb: 'Hebrew', chi: 'Chinese', zh: 'Chinese',
  por: 'Portuguese', arm: 'Armenian', egy: 'Egyptian', geo: 'Georgian', hin: 'Hindi',
  ota: 'Ottoman Turkish', chu: 'Church Slavonic', nah: 'Nahuatl', ice: 'Icelandic',
  enm: 'Middle English', gmh: 'Middle High German', frm: 'Middle French', fro: 'Old French',
  unknown: 'Unknown',
};

// Synonym spellings → canonical (variant on the LEFT, incl. curly-apostrophe form)
const SYNONYM = {
  'geez': "Ge'ez", 'ge’ez': "Ge'ez", 'ethiopic': "Ge'ez",
  'anglo-saxon': 'Old English',
  'quiché maya': "K'iche' Maya", 'quiche maya': "K'iche' Maya",
};

// Non-language sentinels → languages: []
const SENTINEL = new Set(['Visual', 'Unknown', 'auto-detect', 'Multiple', 'A', 'e', null, 'zxx', 'mul', 'roa', 'Various Caucasian']);

// Genuine SINGLE languages that contain a hyphen (or appear only inside compounds)
const EXTRA = ['Judeo-Arabic', 'Judeo-Italian', 'Judeo-Greek', 'Judeo-Persian', 'Judeo-Occitan',
  'Anglo-Saxon', 'Samaritan Hebrew', 'Ladino', 'Aramaic', 'Coptic', 'Scottish Gaelic', 'Old Irish', 'Yiddish'];

const hasDelim = s => typeof s === 'string' && /[\/,;&]| and /i.test(s);
const canonSyn = name => SYNONYM[name.toLowerCase()] || name;

function buildKnown(values) {
  const known = new Map(); // lowercased → canonical
  for (const v of values) {
    if (typeof v === 'string' && !SENTINEL.has(v) && !hasDelim(v) && !v.includes('-')) known.set(v.toLowerCase(), v);
  }
  for (const e of EXTRA) known.set(e.toLowerCase(), e);
  return known;
}

function makeParser(known) {
  const clean = f => f.replace(/\(.*?\)/g, '').replace(/\s+in\s+[\w'-]+\s+script/ig, '')
    .replace(/^and\s+/i, '').replace(/[.\s]+$/, '').replace(/^[.\s]+/, '').trim();
  const lookup = f => { const l = f.toLowerCase(); return CODE[l] || known.get(l) || null; };
  return function parse(raw) {
    if (raw == null || SENTINEL.has(raw) || typeof raw !== 'string') return { langs: [], flag: 'sentinel' };
    if (CODE[raw]) return { langs: [canonSyn(CODE[raw])], flag: null };
    const whole = known.get(raw.toLowerCase());
    if (whole) return { langs: [canonSyn(whole)], flag: null };
    const frags = raw.split(/\s*[\/,;]\s*|\s+and\s+|\s+&\s+|\.\s+(?=[A-Z])/i);
    const langs = [], unmatched = [];
    const add = k => { const c = canonSyn(k); if (!langs.includes(c)) langs.push(c); };
    for (let f of frags) {
      f = clean(f); if (!f) continue;
      let k = lookup(f);
      if (!k && f.includes('-')) { const parts = f.split(/\s*-\s*/).map(lookup).filter(Boolean); if (parts.length) { parts.forEach(add); continue; } }
      if (k) add(k); else unmatched.push(f);
    }
    return { langs, flag: langs.length ? (unmatched.length ? 'partial' : null) : 'unparsed', unmatched };
  };
}

async function main() {
  if (!process.env.MONGODB_URI) { console.error('MONGODB_URI not set (source .env.production.local).'); process.exit(1); }
  const c = new MongoClient(process.env.MONGODB_URI);
  await c.connect();
  const B = c.db('bookstore').collection('books');

  const values = (await B.aggregate([{ $group: { _id: '$language' } }]).toArray()).map(v => v._id);
  const parse = makeParser(buildKnown(values));

  let scalarFolds = 0, arrayChanges = 0, ops = [];
  const flush = async () => { if (ops.length) { await B.bulkWrite(ops); ops = []; } };

  for await (const d of B.find({}, { projection: { language: 1, languages: 1, language_raw: 1 } })) {
    const raw = d.language;
    const scalarCanon = (typeof raw === 'string' && CODE[raw]) ? CODE[raw] : raw; // fold scalar code only
    const { langs, flag } = parse(raw);
    const set = {};
    if (scalarCanon !== raw) { set.language = scalarCanon; if (d.language_raw == null) set.language_raw = raw; scalarFolds++; }
    const curr = Array.isArray(d.languages) ? d.languages : null;
    const same = curr && curr.length === langs.length && curr.every((x, i) => x === langs[i]);
    if (!same) { set.languages = langs; arrayChanges++; }
    const wantMulti = langs.length > 1, wantUnparsed = flag === 'unparsed';
    if (d.language_multi !== wantMulti) set.language_multi = wantMulti;
    if (!!d.language_unparsed !== wantUnparsed) set.language_unparsed = wantUnparsed;
    if (Object.keys(set).length && APPLY) ops.push({ updateOne: { filter: { _id: d._id }, update: { $set: set } } });
    if (ops.length >= 1000) await flush();
  }
  if (APPLY) await flush();

  console.log(`${APPLY ? 'APPLIED' : 'DRY-RUN'} — scalar code-folds: ${scalarFolds}, languages[] (re)writes: ${arrayChanges}`);
  if (!APPLY && scalarFolds === 0 && arrayChanges === 0) console.log('(no changes — data already normalized; script is idempotent)');
  await c.close();
}
main().catch(e => { console.error(e); process.exit(1); });
