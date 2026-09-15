#!/usr/bin/env node
/**
 * Native-language probe terms DERIVED FROM DATA: which source-language terms (the <vocab>/<term>/<note original>
 * tags the OCR and translation prompts already write per page — harvested to ~/sl-corpus/page-terms by
 * sourcelibrary-atlas scripts/local-corpus/harvest-page-terms.mjs, #4695) are enriched on the pages the July
 * classifier (classify-v3) judged experiential, per feature, relative to the other pages of the same books?
 *
 * PRIOR ART: scripts/maintenance/aggregate-page-terms.mjs — the global term table for #4695; it does not fit
 * because it aggregates the whole corpus by term, and here we need a per-(feature, language) contrast against a
 * within-book background. probes-native-authored.json is the model-authored complement; both are positive-
 * controlled against pages_src by retrieve-v5-lexical.mjs, which records the provenance of every term it fires.
 *
 *   node scripts/analysis/experience-map/probes/derive-native-terms.mjs
 * → probes/probes-native-derived.json  {dimensions:[{id, terms:{Latin:[...]}, stats:{term:{tf,pages,df,bg,lift}}}]}
 */
import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib';
const HOME = process.env.HOME; const CORPUS = process.env.SL_CORPUS || path.join(HOME, 'sl-corpus');
const HERE = path.dirname(new URL(import.meta.url).pathname);
const CLASSIFIED = process.env.CLASSIFIED || path.join(HOME, 'sourcelibrary', 'scripts', 'output', 'experience-map', 'classified-v3.jsonl');
const MIN_TF = 2, MIN_LIFT = 3, MAX_PER = 12;
const CJK = /[㐀-䶿一-鿿]/;
const okTerm = (t) => { const s = [...t.replace(/\s+/g, ' ').trim()]; return CJK.test(t) ? s.length >= 2 && s.length <= 6 : s.length >= 4 && s.length <= 40 && !/^[\d\W]+$/.test(t); };

const exp = new Map(); // book_id → Map(page → features[])
let nrows = 0, nexp = 0;
for (const l of fs.readFileSync(CLASSIFIED, 'utf8').split('\n')) { if (!l) continue; const r = JSON.parse(l); nrows++; if (!r.experiential || !r.features?.length) continue; nexp++; if (!exp.has(r.book_id)) exp.set(r.book_id, new Map()); exp.get(r.book_id).set(Number(r.page_number), r.features); }
console.log(`${nrows} classified rows, ${nexp} experiential, ${exp.size} books`);

// per (feature, lang, term_key): tf on experiential pages; per (lang, term_key): df over all pages of those books
const tf = new Map(), pagesPerFeat = new Map(), df = new Map(), pagesPerLang = new Map(); const display = new Map(); let shards = 0, missing = 0;
for (const [book, pages] of exp) {
  const f = path.join(CORPUS, 'page-terms', `${book}.jsonl.gz`); if (!fs.existsSync(f)) { missing++; continue; } shards++;
  const seenPage = new Map(); // page → Set(lang|term_key)
  for (const l of zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').split('\n')) { if (!l) continue; const r = JSON.parse(l); if (!['vocab', 'term', 'original'].includes(r.kind) || !r.lang || r.lang === 'English' || !okTerm(r.term)) continue; const k = `${r.lang}|${r.term_key}`; if (!seenPage.has(r.page_number)) seenPage.set(r.page_number, new Set()); if (seenPage.get(r.page_number).has(k)) continue; seenPage.get(r.page_number).add(k); if (!display.has(k)) display.set(k, r.term); }
  for (const [pn, keys] of seenPage) { for (const k of keys) { const lang = k.split('|')[0]; df.set(k, (df.get(k) || 0) + 1); pagesPerLang.set(lang, (pagesPerLang.get(lang) || 0) + 1); }
    const feats = pages.get(pn); if (!feats) continue; for (const ft of feats) { for (const k of keys) { const fk = `${ft}|${k}`; tf.set(fk, (tf.get(fk) || 0) + 1); } const lang = [...keys][0]?.split('|')[0]; } for (const ft of feats) for (const lang of new Set([...keys].map((k) => k.split('|')[0]))) pagesPerFeat.set(`${ft}|${lang}`, (pagesPerFeat.get(`${ft}|${lang}`) || 0) + 1); }
}
console.log(`${shards} shards read (${missing} books without a shard); ${df.size} distinct (lang, term) keys`);
const dims = new Map();
for (const [fk, n] of tf) { if (n < MIN_TF) continue; const [ft, lang, key] = fk.split('|'); const k = `${lang}|${key}`; const pf = pagesPerFeat.get(`${ft}|${lang}`) || 1; const pl = pagesPerLang.get(lang) || 1; const lift = (n / pf) / ((df.get(k) || 1) / pl); if (lift < MIN_LIFT) continue; if (!dims.has(ft)) dims.set(ft, new Map()); if (!dims.get(ft).has(lang)) dims.get(ft).set(lang, []); dims.get(ft).get(lang).push({ term: display.get(k), tf: n, pages: pf, df: df.get(k), bg: pl, lift: +lift.toFixed(1) }); }
const out = { version: 'native-derived-v1', written: new Date().toISOString().slice(0, 10), method: `page-terms lift on classify-v3 experiential pages vs same-book background; tf≥${MIN_TF}, lift≥${MIN_LIFT}, top ${MAX_PER} per (feature, language)`, dimensions: [] };
let total = 0; const perLang = {};
for (const [ft, langs] of [...dims].sort()) { const terms = {}, stats = {}; for (const [lang, list] of langs) { list.sort((a, b) => b.tf * b.lift - a.tf * a.lift); const top = list.slice(0, MAX_PER); terms[lang] = top.map((t) => t.term); for (const t of top) stats[`${lang}|${t.term}`] = t; total += top.length; perLang[lang] = (perLang[lang] || 0) + top.length; } out.dimensions.push({ id: ft, terms, stats }); }
fs.writeFileSync(path.join(HERE, 'probes-native-derived.json'), JSON.stringify(out, null, 1));
console.log(`${out.dimensions.length} features, ${total} terms; per language:`, Object.entries(perLang).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([l, n]) => `${l}:${n}`).join(' '));
