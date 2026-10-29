#!/usr/bin/env node
/**
 * ingest-openlibrary-translations.mjs — English translations of European-language
 * works, from the Open Library bulk dumps, as a STAGED set (#7769, feeds #7751).
 *
 * PRIOR ART: scripts/enrichment/import-translation-catalogs.mjs loads a one-off
 * `openlibrary_latin_pre1979.csv` (Latin only, no per-row edition key) INTO
 * translation_catalogs; scripts/enrichment/discover-prior-translations.mjs hits
 * the OL search API one claim at a time. Neither reads the dumps, covers the
 * other seven languages, or stays out of translation_catalogs.
 *
 * Writes NOTHING to Mongo or Supabase. translation_catalogs feeds public
 * first-translation badges and /census; merging staged rows there is a separate
 * decision. Output is read by
 * `scripts/translation-layer/01-build-external-works.mjs --staging`.
 *
 * WHAT COUNTS AS A TRANSLATION HERE
 *   An edition with `languages` ∋ /languages/eng AND (`translated_from` OR
 *   `translation_of`). The original language is:
 *     - `translated_from` when present (orig_lang_basis: 'translated_from'); else
 *     - the ONE target language among the work's other, non-English editions
 *       (orig_lang_basis: 'sibling_editions'). Ambiguous or absent → not staged,
 *       but counted in the summary so the loss is visible.
 *   orig_title = `translation_of` (a free-text original title) when present, else
 *   the title of the earliest sibling edition in the original language, else the
 *   OL work title (often English — orig_title_basis says which).
 *   orig_year = the earliest publish year among sibling editions in the original
 *   language (OL's own holdings, so an UPPER bound on first printing).
 *
 * PASSES (each streams a .txt.gz dump; nothing is unpacked to disk):
 *   1. editions → English translation candidates
 *   2. editions again → sibling editions of the candidate works (lang + year + title)
 *   3. works → work title + author keys;  4. authors → names
 *
 * Usage:
 *   node scripts/enrichment/ingest-openlibrary-translations.mjs \
 *     --dumps <dir with ol_dump_{editions,works,authors}.txt.gz> --out <file.jsonl>
 */
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { spawn } from 'child_process';

const argOf = (f) => { const i = process.argv.indexOf(f); return i === -1 ? null : process.argv[i + 1]; };
const DUMPS = argOf('--dumps');
const OUT = argOf('--out');
if (!DUMPS || !OUT) {
  console.error('usage: --dumps <dir> --out <file.jsonl>');
  process.exit(2);
}
const dump = (t) => path.join(DUMPS, `ol_dump_${t}.txt.gz`);

// MARC language codes as OL uses them → the orig_lang names external-translation-works.jsonl uses.
const TARGET = {
  lat: 'latin', ger: 'german', fre: 'french', ita: 'italian', dut: 'dutch',
  spa: 'spanish', gre: 'greek', grc: 'greek', por: 'portuguese',
};
const langCode = (l) => (l?.key || '').replace('/languages/', '');
const yearOf = (s) => { const m = String(s || '').match(/\b(1[0-9]\d\d|20[0-2]\d)\b/); return m ? Number(m[1]) : null; };

/** Stream a gzipped dump line by line. Each line: type \t key \t revision \t last_modified \t json */
async function* lines(file) {
  const gz = spawn('gzip', ['-dc', file], { stdio: ['ignore', 'pipe', 'inherit'] });
  const rl = readline.createInterface({ input: gz.stdout, crlfDelay: Infinity });
  for await (const line of rl) yield line;
  const code = await new Promise((r) => (gz.exitCode != null ? r(gz.exitCode) : gz.on('close', r)));
  // A truncated dump must not read as a complete one.
  if (code !== 0) throw new Error(`gzip -dc ${file} exited ${code}`);
}
const jsonOf = (line) => { const i = line.lastIndexOf('\t{'); try { return JSON.parse(line.slice(i + 1)); } catch { return null; } };
const progress = (n, label) => { if (n % 5_000_000 === 0) console.log(`    ${label}: ${(n / 1e6).toFixed(0)}M lines`); };

// ── pass 1: English editions marked as translations ─────────────────────────
console.log('pass 1: editions → English translation candidates');
const cands = [];
let n = 0;
for await (const line of lines(dump('editions'))) {
  progress(++n, 'editions');
  if (!line.includes('"translated_from"') && !line.includes('"translation_of"')) continue;
  const e = jsonOf(line);
  if (!e || !(e.languages || []).some((l) => langCode(l) === 'eng')) continue;
  const from = (e.translated_from || []).map(langCode).filter(Boolean);
  if (from.length && from.every((c) => c === 'eng')) continue;
  cands.push({
    key: e.key,
    title: [e.title, e.subtitle].filter(Boolean).join(': '),
    publish_date: e.publish_date || '',
    work: e.works?.[0]?.key || null,
    authors: (e.authors || []).map((a) => a.key).filter(Boolean),
    from: from.filter((c) => c !== 'eng'),
    translation_of: e.translation_of || '',
  });
}
console.log(`  ${n.toLocaleString()} editions read, ${cands.length.toLocaleString()} English translation candidates`);

// ── pass 2: sibling editions of the candidate works ──────────────────────────
console.log('pass 2: editions → siblings of candidate works');
const workSet = new Set(cands.map((c) => c.work).filter(Boolean));
const siblings = new Map(); // work → [{lang, year, title}]
n = 0;
for await (const line of lines(dump('editions'))) {
  progress(++n, 'editions');
  const m = line.match(/"works": \[\{"key": "(\/works\/OL\d+W)"/);
  if (!m || !workSet.has(m[1])) continue;
  const e = jsonOf(line);
  if (!e) continue;
  const langs = (e.languages || []).map(langCode).filter((c) => c && c !== 'eng');
  if (!langs.length) continue;
  if (!siblings.has(m[1])) siblings.set(m[1], []);
  for (const lang of langs) siblings.get(m[1]).push({ lang, year: yearOf(e.publish_date), title: e.title || '' });
}
console.log(`  ${siblings.size.toLocaleString()} candidate works have a non-English sibling edition`);

// ── pass 3 + 4: works and authors ────────────────────────────────────────────
console.log('pass 3: works');
const works = new Map();
for await (const line of lines(dump('works'))) {
  const k = line.split('\t', 2)[1];
  if (!workSet.has(k)) continue;
  const w = jsonOf(line);
  if (!w) continue;
  works.set(k, {
    title: [w.title, w.subtitle].filter(Boolean).join(': '),
    authors: (w.authors || []).map((a) => a.author?.key || a.key).filter(Boolean),
  });
}
const authorSet = new Set();
for (const c of cands) {
  for (const a of [...(works.get(c.work)?.authors || []), ...c.authors]) authorSet.add(a);
}
console.log(`  ${works.size.toLocaleString()} works joined; pass 4: ${authorSet.size.toLocaleString()} authors`);
const authors = new Map();
for await (const line of lines(dump('authors'))) {
  const k = line.split('\t', 2)[1];
  if (!authorSet.has(k)) continue;
  const a = jsonOf(line);
  if (a?.name) authors.set(k, a.name);
}

// ── emit ─────────────────────────────────────────────────────────────────────
fs.mkdirSync(path.dirname(OUT), { recursive: true });
const out = fs.createWriteStream(OUT);
const tally = { staged: 0, non_target: 0, sibling_ambiguous: 0, no_language: 0 };
const byLang = {};
for (const c of cands) {
  const sib = siblings.get(c.work) || [];
  let codes = [...new Set(c.from)];
  let basis = 'translated_from';
  if (!codes.length) {
    basis = 'sibling_editions';
    const sibTargets = [...new Set(sib.map((s) => TARGET[s.lang]).filter(Boolean))];
    if (sibTargets.length > 1) { tally.sibling_ambiguous++; continue; }
    if (!sibTargets.length) { tally.no_language++; continue; }
    codes = sib.filter((s) => TARGET[s.lang] === sibTargets[0]).map((s) => s.lang).slice(0, 1);
  }
  const langs = [...new Set(codes.map((cd) => TARGET[cd]).filter(Boolean))];
  if (!langs.length) { tally.non_target++; continue; }
  const w = works.get(c.work);
  const authorKeys = w?.authors?.length ? w.authors : c.authors;
  for (const lang of langs) {
    const orig = sib.filter((s) => TARGET[s.lang] === lang);
    const years = orig.map((s) => s.year).filter((y) => y != null);
    const earliest = orig.filter((s) => s.year != null).sort((a, b) => a.year - b.year)[0];
    let origTitle = c.translation_of; let titleBasis = 'translation_of';
    if (!origTitle && earliest?.title) { origTitle = earliest.title; titleBasis = 'sibling_edition'; }
    if (!origTitle) { origTitle = w?.title || ''; titleBasis = 'ol_work_title'; }
    const id = c.key.replace('/books/', '');
    out.write(`${JSON.stringify({
      source: 'openlibrary_translated_from',
      source_id: id,
      url: `https://openlibrary.org${c.key}`,
      orig_lang: lang,
      orig_author: authorKeys.map((k) => authors.get(k)).filter(Boolean).join('; '),
      orig_title: origTitle,
      en_title: c.title,
      en_year: yearOf(c.publish_date),
      orig_year: years.length ? Math.min(...years) : null,
      ol_work: c.work,
      orig_lang_basis: basis,
      orig_title_basis: titleBasis,
      orig_year_basis: years.length ? 'earliest_ol_edition_in_orig_lang' : null,
    })}\n`);
    tally.staged++;
    byLang[lang] = (byLang[lang] || 0) + 1;
  }
}
await new Promise((r) => out.end(r));

console.log('\n─── Open Library staged set ─────────────────────────────');
console.log(`  English translation candidates : ${cands.length.toLocaleString()}`);
console.log(`  staged rows (target languages) : ${tally.staged.toLocaleString()}`);
for (const [l, k] of Object.entries(byLang).sort((a, b) => b[1] - a[1])) console.log(`    ${l.padEnd(11)} ${k}`);
console.log(`  dropped — non-target language  : ${tally.non_target.toLocaleString()}`);
console.log(`  dropped — no language at all   : ${tally.no_language.toLocaleString()} (translation_of only, no non-English sibling)`);
console.log(`  dropped — siblings ambiguous   : ${tally.sibling_ambiguous.toLocaleString()}`);
console.log(`\nWrote ${OUT}`);
