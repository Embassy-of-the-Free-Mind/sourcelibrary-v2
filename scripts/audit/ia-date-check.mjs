#!/usr/bin/env node
/**
 * IA date check (#5458) — runner. Classifies Internet Archive items as old / modern /
 * unknown from IA metadata with the rules in scripts/lib/ia-date-check.mjs.
 * Zero AI spend; reads files, writes files. Writes NOTHING to Mongo.
 *
 * PRIOR ART: scripts/iiif-discovery/sources/ia-language.mjs — the scrape-API crawler
 *   that created these candidates (same queries are re-run by `fetch` here, with the
 *   date fields it never stored). scripts/iiif-discovery/classify-candidates.mjs —
 *   tier-0 classification, no dates. Neither checks whether a date is believable.
 *
 * Subcommands (all paths under --dir, default scratch/):
 *   dump       targets.jsonl      ← import_candidates (ia_language, discovered, <1900 or undated)
 *   dump-lib   lib-targets.jsonl  ← books from IA whose free-text `published` reads <1800
 *   fetch      ia-meta/<q>.jsonl  ← IA scrape API, re-running the discovery queries,
 *                                   keeping only target ids. Sequential, ≥1s apart,
 *                                   contact User-Agent; resumable via <q>.cursor.
 *   fetch-ids  <ids.txt> <out>    ← IA scrape API by identifier, 100 per request
 *   classify   verdicts.jsonl + tables (by language, by reason)
 *   classify-lib  lib-verdicts.jsonl + tables
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/audit/ia-date-check.mjs dump
 *   node scripts/audit/ia-date-check.mjs fetch
 *   node scripts/audit/ia-date-check.mjs classify
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { classifyIaDate, METHOD } from '../lib/ia-date-check.mjs';

const args = process.argv.slice(2);
const cmd = args[0];
const opt = (k, d) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? a.split('=').slice(1).join('=') : d; };
const DIR = opt('dir', 'scratch');
const UA = 'SourceLibrary/1.0 (https://sourcelibrary.org; contact j.d.lomas@tudelft.nl; IA date check #5458)';
const FIELDS = 'identifier,title,creator,date,year,publicdate,addeddate,publisher,imagecount,collection,language,ppi,isbn,edition,volume,scanner,sponsor,contributor,scanningcenter,subject,mediatype';
const QUERIES = {
  arabic: 'language:(ara OR ar OR arabic) AND mediatype:texts',
  latin: 'language:(lat OR latin OR la) AND mediatype:texts',
  chinese: 'language:(chi OR zho OR zh OR cmn OR chinese) AND mediatype:texts',
  sanskrit: 'language:(san OR sanskrit OR sa) AND mediatype:texts',
  persian: 'language:(per OR fas OR fa OR persian OR farsi) AND mediatype:texts',
  hebrew: 'language:(heb OR he OR hebrew) AND mediatype:texts',
  digitallibraryindia: 'collection:digitallibraryindia AND mediatype:texts',
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const p = (f) => path.join(DIR, f);

async function* jsonl(file) {
  if (!fs.existsSync(file)) return;
  for await (const l of readline.createInterface({ input: fs.createReadStream(file) })) if (l.trim()) yield JSON.parse(l);
}
const trimSubject = (it) => { if (it.subject) it.subject = [].concat(it.subject).join(' | ').slice(0, 300); return it; };

async function scrape(params) {
  for (let errs = 0; ; ) {
    try {
      const r = await fetch(`https://archive.org/services/search/v1/scrape?${params}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(180000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      if (++errs > 8) throw e;
      console.error(`  ${e.message} — retry ${errs}`);
      await sleep(15000 * errs);
    }
  }
}

async function withDb(fn) {
  const { MongoClient } = await import('mongodb');
  const c = new MongoClient(process.env.MONGODB_URI);
  await c.connect();
  try { return await fn(c.db(process.env.MONGODB_DB || 'bookstore')); } finally { await c.close(); }
}

const TARGET_FILTER = { source: 'ia_language', status: 'discovered', $or: [{ date_earliest: { $lt: 1900 } }, { date_earliest: null }] };

async function dump() {
  fs.mkdirSync(DIR, { recursive: true });
  await withDb(async (db) => {
    const out = fs.createWriteStream(p('targets.jsonl'));
    let n = 0;
    for await (const d of db.collection('import_candidates').find(TARGET_FILTER, { projection: { source_id: 1, title: 1, author: 1, language: 1, date_text: 1, date_earliest: 1, 'metadata.languages': 1, 'metadata.collections': 1, 'metadata.discovery_query': 1 } })) {
      out.write(JSON.stringify({ _id: String(d._id), id: d.source_id, title: d.title, author: d.author, language: d.language, date_text: d.date_text, date_earliest: d.date_earliest, langs: d.metadata?.languages, colls: d.metadata?.collections, dq: d.metadata?.discovery_query }) + '\n');
      n++;
    }
    out.end();
    console.log('targets', n);
  });
}

async function dumpLib() {
  const { editionYear } = await import('../lib/syriac-kraken-lane.mjs');
  fs.mkdirSync(DIR, { recursive: true });
  await withDb(async (db) => {
    const out = fs.createWriteStream(p('lib-targets.jsonl'));
    let n = 0;
    for await (const d of db.collection('books').find({ $or: [{ ia_identifier: { $exists: true, $nin: [null, ''] } }, { 'image_source.provider': 'internet_archive' }] },
      { projection: { id: 1, title: 1, author: 1, language: 1, published: 1, ia_identifier: 1, 'image_source.identifier': 1, visible: 1, pages_count: 1 } })) {
      const y = editionYear(d.published); // free text — first 3–4 digit year, never parseInt
      const ia = d.ia_identifier || d.image_source?.identifier;
      if (y === null || y >= 1800 || !ia) continue;
      out.write(JSON.stringify({ book_id: d.id || String(d._id), id: ia, title: d.title, author: d.author, language: d.language, published: d.published, pub_year: y, visible: d.visible, pages_count: d.pages_count }) + '\n');
      n++;
    }
    out.end();
    console.log('library books (IA, published <1800)', n);
  });
}

async function fetchQueries() {
  const targets = new Set();
  for await (const t of jsonl(p('targets.jsonl'))) targets.add(t.id);
  fs.mkdirSync(p('ia-meta'), { recursive: true });
  for (const [name, q] of Object.entries(QUERIES)) {
    const ck = p(`ia-meta/${name}.cursor`), outF = p(`ia-meta/${name}.jsonl`);
    if (fs.existsSync(ck) && fs.readFileSync(ck, 'utf8') === 'DONE') continue;
    let cursor = fs.existsSync(ck) ? fs.readFileSync(ck, 'utf8') || null : null;
    while (true) {
      const params = new URLSearchParams({ q, fields: FIELDS, count: '10000' });
      if (cursor) params.set('cursor', cursor);
      const t0 = Date.now();
      const d = await scrape(params);
      const lines = (d.items || []).filter((it) => targets.has(it.identifier)).map((it) => JSON.stringify(trimSubject(it)));
      if (lines.length) fs.appendFileSync(outF, lines.join('\n') + '\n');
      cursor = d.cursor || null;
      fs.writeFileSync(ck, cursor || 'DONE');
      console.log(name, 'kept', lines.length, 'remaining', d.total);
      if (!cursor) break;
      await sleep(Math.max(0, 1000 - (Date.now() - t0)));
    }
  }
}

async function fetchIds(inF, outF) {
  const ids = [...new Set(fs.readFileSync(inF, 'utf8').split('\n').filter(Boolean))];
  const done = new Set(fs.existsSync(outF + '.done') ? fs.readFileSync(outF + '.done', 'utf8').split('\n') : []);
  const todo = ids.filter((i) => !done.has(i));
  const quote = (s) => (/^[A-Za-z0-9._-]+$/.test(s) ? s : `"${s.replace(/"/g, '')}"`);
  for (let i = 0; i < todo.length; i += 100) {
    const batch = todo.slice(i, i + 100);
    const t0 = Date.now();
    const d = await scrape(new URLSearchParams({ q: `identifier:(${batch.map(quote).join(' OR ')})`, fields: FIELDS, count: '1000' }));
    const lines = (d.items || []).map((it) => JSON.stringify(trimSubject(it)));
    if (lines.length) fs.appendFileSync(outF, lines.join('\n') + '\n');
    fs.appendFileSync(outF + '.done', batch.join('\n') + '\n');
    await sleep(Math.max(0, 1000 - (Date.now() - t0)));
  }
  console.log('fetched', todo.length);
}

async function loadMeta(files) {
  const meta = new Map();
  for (const f of files) for await (const it of jsonl(f)) meta.set(it.identifier, it);
  return meta;
}

// Display language for tables: the candidate's language, codes folded to names.
const LANG_NAME = { ara: 'Arabic', ar: 'Arabic', per: 'Persian', fas: 'Persian', urd: 'Urdu', guj: 'Gujarati', hin: 'Hindi', ben: 'Bengali', tam: 'Tamil', mar: 'Marathi', tib: 'Tibetan', kan: 'Kannada', tel: 'Telugu', mal: 'Malayalam', kas: 'Kashmiri', mni: 'Manipuri', asm: 'Assamese', pan: 'Punjabi', snd: 'Sindhi', ori: 'Oriya', nep: 'Nepali', san: 'Sanskrit', lat: 'Latin', gre: 'Greek', grc: 'Greek', heb: 'Hebrew', en_US: 'English', eng: 'English', chi: 'Chinese', 'Chinese (traditional)': 'Chinese', 'Hebrew.': 'Hebrew', 'hebrew-handwritten': 'Hebrew', 'english-handwritten': 'English', 'ಕನ್ನಡ': 'Kannada', mul: 'Multilingual', other: 'Unknown' };
export function displayLanguage(l) {
  if (!l) return 'Unknown';
  if (LANG_NAME[l]) return LANG_NAME[l];
  if (/;/.test(l)) return 'Multilingual';
  return l;
}

function table(rows, keyFn, minN = 0) {
  const t = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    const e = t.get(k) || { old: 0, modern: 0, unknown: 0, n: 0 };
    e[r.verdict]++; e.n++;
    t.set(k, e);
  }
  const lines = ['| | old | modern | unknown | total |', '|---|---:|---:|---:|---:|'];
  const tot = { old: 0, modern: 0, unknown: 0, n: 0 };
  const other = { old: 0, modern: 0, unknown: 0, n: 0 };
  for (const [k, e] of [...t].sort((a, b) => b[1].n - a[1].n)) {
    for (const c of ['old', 'modern', 'unknown', 'n']) tot[c] += e[c];
    if (e.n < minN) { for (const c of ['old', 'modern', 'unknown', 'n']) other[c] += e[c]; continue; }
    lines.push(`| ${k} | ${e.old.toLocaleString()} | ${e.modern.toLocaleString()} | ${e.unknown.toLocaleString()} | ${e.n.toLocaleString()} |`);
  }
  if (other.n) lines.push(`| (other, <${minN} each) | ${other.old.toLocaleString()} | ${other.modern.toLocaleString()} | ${other.unknown.toLocaleString()} | ${other.n.toLocaleString()} |`);
  lines.push(`| **total** | **${tot.old.toLocaleString()}** | **${tot.modern.toLocaleString()}** | **${tot.unknown.toLocaleString()}** | **${tot.n.toLocaleString()}** |`);
  return lines.join('\n');
}

async function classify(lib) {
  const metaFiles = lib ? [p('ia-meta-lib.jsonl')] : fs.readdirSync(p('ia-meta')).filter((f) => f.endsWith('.jsonl')).map((f) => p(`ia-meta/${f}`));
  const meta = await loadMeta(metaFiles);
  const rows = [];
  const out = fs.createWriteStream(p(lib ? 'lib-verdicts.jsonl' : 'verdicts.jsonl'));
  for await (const t of jsonl(p(lib ? 'lib-targets.jsonl' : 'targets.jsonl'))) {
    const v = classifyIaDate(t, meta.get(t.id) || null);
    const row = { ...(lib ? { book_id: t.book_id, published: t.published } : { _id: t._id }), id: t.id, language: displayLanguage(t.language), title: String(t.title || '').slice(0, 120), ...v, method: METHOD };
    out.write(JSON.stringify(row) + '\n');
    rows.push({ language: row.language, verdict: v.verdict, reason: v.reason.replace(/:.*/, ''), provenance: v.provenance });
  }
  out.end();
  const md = [
    `## ${lib ? 'In-library IA books, published <1800' : 'ia_language candidates, <1900 or undated'} — ${METHOD}`,
    '', '### By language', table(rows, (r) => r.language, lib ? 20 : 300),
    '', '### By provenance', table(rows, (r) => r.provenance || 'gone'),
    '', '### By reason', table(rows, (r) => r.reason),
  ].join('\n');
  fs.writeFileSync(p(lib ? 'lib-tables.md' : 'tables.md'), md + '\n');
  console.log(md);
}

if (cmd === 'dump') await dump();
else if (cmd === 'dump-lib') await dumpLib();
else if (cmd === 'fetch') await fetchQueries();
else if (cmd === 'fetch-ids') await fetchIds(args[1], args[2]);
else if (cmd === 'classify') await classify(false);
else if (cmd === 'classify-lib') await classify(true);
else { console.error('usage: ia-date-check.mjs dump|dump-lib|fetch|fetch-ids <ids> <out>|classify|classify-lib [--dir=scratch]'); process.exit(1); }
