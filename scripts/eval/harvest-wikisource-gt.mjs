#!/usr/bin/env node
// PRIOR ART: build-reference-groundtruth.mjs pins ONE hand-curated passage per work to a
// book we hold; it cannot scale past hand-written reference-works entries. bench2-export.mjs
// exports images for pages already pinned. Neither harvests GT in bulk, and neither can use
// a page we do NOT hold. This does: Wikisource supplies the transcription, Commons renders
// the matching page image, so no corpus join is required.
/**
 * harvest-wikisource-gt.mjs — bulk OCR ground truth from Wikisource proofread pages.
 *
 * Mechanism (verified 2026-09-04):
 *   Index:<file>            ns 106, carries |Year= |Language= |Progress=
 *   Page:<file>/<n>         ns 104, wikitext opens with <pagequality level="N" …/>
 *   File:<file> on Commons  renders any DjVu/PDF page as JPEG on demand:
 *                           prop=imageinfo&iiurlwidth=1500&iiurlparam=page<N>-1500px
 * level 4 = validated (two independent humans), level 3 = proofread (one).
 *
 * CAVEAT 1 — fidelity. Wikisource house style usually modernises long-s and expands
 * ligatures, so many pages are WORD-faithful, not GLYPH-diplomatic. Detected per page
 * (`fidelity`), because a substantial minority DO preserve ſ. Measured: la ~22% glyph,
 * de 0% — so German Fraktur glyph tests still need DTA original-orthography TEI.
 *
 * CAVEAT 2 — THESE PAGES ARE NOT A RANDOM SAMPLE OF HISTORICAL PRINT, and every
 * accuracy computed over them is conditioned on the following, all of which select
 * toward EASIER pages. Quote them with the number.
 *   a) Proofread-status selection: only pages a human volunteer chose to transcribe.
 *      Volunteers favour legible scans and works they care about; badly-scanned,
 *      damaged or dull pages are under-represented — exactly the OCR-hard tail.
 *   b) --min-chars (default 600) drops sparse pages: title pages, plates, blanks,
 *      colophons, tables. Those are a large share of real OCR failures, so excluding
 *      them flatters every arm and may not flatter them equally (layout-heavy pages
 *      are where VLMs beat line recognisers).
 *   c) Middle-of-book window (35-75%): avoids front matter, also avoids indices.
 *   d) Year filter needs a machine-readable year in the index template.
 *   e) One page per work (--per-work), which is the standing rule and is a FEATURE:
 *      pages within a book are one observation, not many.
 * Candidate order is shuffled (seeded) so the set is at least not the alphabetical
 * prefix of the wiki — see the sampling note further down.
 *
 *   node scripts/eval/harvest-wikisource-gt.mjs --wiki=la --from=1500 --to=1800 --max=40
 *   node scripts/eval/harvest-wikisource-gt.mjs --wiki=de --level=4 --max=25 --out=<dir>
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { cleanPageText, pageQuality } from './lib/wikisource-text.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const argOf = (n, d) => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const WIKI = argOf('wiki', 'la');
const YEAR_FROM = parseInt(argOf('from', '1450'), 10);
const YEAR_TO = parseInt(argOf('to', '1900'), 10);
const MIN_LEVEL = parseInt(argOf('level', '3'), 10);
const MAX_PAGES = parseInt(argOf('max', '40'), 10);
const MAX_PER_WORK = parseInt(argOf('per-work', '1'), 10);  // one page per book — the standing sampling rule
const OUT = argOf('out', path.join(__dirname, 'ground-truth-wikisource'));

const UA = 'SourceLibrary-GT-Harvest/1.0 (https://sourcelibrary.org; derek@sourcelibrary.org) node-fetch';
const WS = `https://${WIKI}.wikisource.org/w/api.php`;
const COMMONS = 'https://commons.wikimedia.org/w/api.php';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function api(base, params) {
  const qs = new URLSearchParams({ ...params, format: 'json', formatversion: '2' });
  const url = `${base}?${qs}`;
  // Non-Latin titles inflate ~6x when percent-encoded, so a 50-title batch of Greek
  // page names overran the URL limit and returned 414 (observed on el.wikisource).
  // The MediaWiki API accepts the same read query over POST; use it when the GET
  // would be long. Retries also fall back to POST rather than repeating a doomed GET.
  const usePost = url.length > 1800;
  // Exponential backoff with a long tail: the small wikis (el, la) rate-limit an
  // unauthenticated client hard, and a 4-try/2s ladder gave up while the wiki was
  // merely asking us to slow down. Honour Retry-After when the server sends one.
  for (let attempt = 0; attempt < 6; attempt++) {
    const r = usePost
      ? await fetch(base, { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' }, body: qs })
      : await fetch(url, { headers: { 'User-Agent': UA } });
    if (r.status === 429 || r.status >= 500) {
      const ra = parseInt(r.headers.get('retry-after') || '0', 10);
      await sleep(Math.max(ra * 1000, 3000 * 2 ** attempt));
      continue;
    }
    if (!r.ok) throw new Error(`${r.status} ${usePost ? base : url.slice(0, 120)}`);
    return r.json();
  }
  throw new Error(`giving up after retries: ${base}`);
}

// Index-template FIELD names are localized too, independently of the namespace names:
// de.ws writes |JAHR= |TITEL= |BEARBEITUNGSSTAND=, fr.ws |Annee=, it.ws |Anno=. Querying
// only for "Year" matched 0 of 6,500 German index pages while de.ws is the richest
// Fraktur source we have. Try every known alias.
const FIELD_ALIASES = {
  year: ['Year', 'JAHR', 'Jahr', 'Annee', 'Année', 'Anno', 'Annus', 'Ano', 'Έτος', 'Год'],
  title: ['Title', 'TITEL', 'Titel', 'Titre', 'Titolo', 'Titulus', 'Título', 'Τίτλος'],
  progress: ['Progress', 'BEARBEITUNGSSTAND', 'Avancement', 'Progresso', 'Prograditur', 'Πρόοδος'],
  language: ['Language', 'SPRACHE', 'Sprache', 'Langue', 'Lingua', 'Idioma'],
};

/** Wikitext of Index: pages carries the year/title/progress in a localized template. */
function parseIndexFields(text) {
  const field = (aliases) => {
    for (const name of aliases) {
      const m = text.match(new RegExp(`\\|\\s*${name}\\s*=\\s*([^\\n|]*)`, 'i'));
      if (m && m[1].trim()) return m[1].trim();
    }
    return '';
  };
  // A year can also arrive as a wikilinked or ranged value ("[[1618]]", "1723-1725").
  const yearRaw = field(FIELD_ALIASES.year);
  const year = (yearRaw.match(/\b(1[3-9]\d{2})\b/) || [])[1];
  return {
    year: year ? parseInt(year, 10) : null,
    progress: field(FIELD_ALIASES.progress),
    language: field(FIELD_ALIASES.language),
    title: field(FIELD_ALIASES.title).replace(/^\[\[|\]\]$/g, ''),
  };
}

console.log(`Harvesting ${WIKI}.wikisource — years ${YEAR_FROM}-${YEAR_TO}, level>=${MIN_LEVEL}, max ${MAX_PAGES} pages\n`);
fs.mkdirSync(OUT, { recursive: true });

// 0. The ProofreadPage namespaces are localized in BOTH name and NUMBER, and neither is
// guessable: en/la use 104/106, but de 102/104, fr 104/112, it 108/110, el 100/102.
// Hardcoding 104/106 + "Index:" silently harvests zero on most wikis (observed: de and
// el reported "no namespaces" while de.ws alone holds ~416k validated pages). Ask the
// extension for the ids, then siteinfo for the localized names.
const prinfo = await api(WS, { action: 'query', meta: 'proofreadinfo', prpiprop: 'namespaces' });
const NS_INDEX_ID = prinfo.query?.proofreadnamespaces?.index?.id;
const NS_PAGE_ID = prinfo.query?.proofreadnamespaces?.page?.id;
if (NS_INDEX_ID === undefined || NS_PAGE_ID === undefined) {
  console.error(`${WIKI}.wikisource does not expose ProofreadPage namespaces`); process.exit(1);
}
const siteinfo = await api(WS, { action: 'query', meta: 'siteinfo', siprop: 'namespaces' });
const NS_INDEX = siteinfo.query.namespaces[String(NS_INDEX_ID)]?.name;
const NS_PAGE = siteinfo.query.namespaces[String(NS_PAGE_ID)]?.name;
console.log(`  namespaces: index=${NS_INDEX_ID}:"${NS_INDEX}"  page=${NS_PAGE_ID}:"${NS_PAGE}"`);

// 1. Enumerate Index: pages (ns 106).
const indexTitles = [];
let cont;
do {
  const j = await api(WS, { action: 'query', list: 'allpages', apnamespace: String(NS_INDEX_ID), aplimit: '500', ...(cont ? { apcontinue: cont } : {}) });
  indexTitles.push(...(j.query?.allpages || []).map(p => p.title));
  cont = j.continue?.apcontinue;
  if (indexTitles.length > 6000) break;
} while (cont);
console.log(`  ${indexTitles.length} Index: pages on ${WIKI}.wikisource`);

// 2. Fetch Index wikitext in batches of 50; keep those in the year window.
const candidates = [];
for (let i = 0; i < indexTitles.length && candidates.length < MAX_PAGES * 6; i += 50) {
  const j = await api(WS, { action: 'query', prop: 'revisions', rvprop: 'content', rvslots: 'main', titles: indexTitles.slice(i, i + 50).join('|') });
  for (const p of j.query?.pages || []) {
    const text = p.revisions?.[0]?.slots?.main?.content;
    if (!text) continue;
    const f = parseIndexFields(text);
    if (!f.year || f.year < YEAR_FROM || f.year > YEAR_TO) continue;
    const file = p.title.slice(NS_INDEX.length + 1);   // strip the localized "<NS>:" prefix
    if (/\/styles\.css$/.test(file)) continue;
    candidates.push({ indexTitle: p.title, file, ...f });
  }
  await sleep(150);
}
console.log(`  ${candidates.length} in the ${YEAR_FROM}-${YEAR_TO} window`);

// SAMPLING — read this before quoting any number computed over this set.
//
// `list=allpages` returns titles ALPHABETICALLY, and the harvest loop below stops at
// --max. The first run therefore sampled the alphabetical prefix of each wiki: the 45
// Latin pages covered initial letters A-H and *nothing* from I-Z. That is not a sample
// of Wikisource, it is a sample of its first eighth, and any per-language accuracy
// computed over it inherits whatever those particular works happen to be.
// Shuffle first, deterministically (seeded), so the set is reproducible AND unbiased
// by title.
let seed = parseInt(argOf('seed', '20260904'), 10);
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
for (let i = candidates.length - 1; i > 0; i--) {
  const j = Math.floor(rnd() * (i + 1));
  [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
}
console.log(`  shuffled (seed ${argOf('seed', '20260904')})\n`);

// 3. For each candidate work, take up to MAX_PER_WORK pages at level >= MIN_LEVEL.
const harvested = [];
// A network failure mid-harvest must not discard the pages already collected — the
// first el.wikisource run threw on a rate-limit and lost 3 good pages plus all the
// API calls that produced them. Each work is isolated; failures are counted, not fatal.
let failedWorks = 0;
for (const cand of candidates) {
  if (harvested.length >= MAX_PAGES) break;
  try {
  const pref = await api(WS, { action: 'query', list: 'allpages', apnamespace: String(NS_PAGE_ID), apprefix: `${cand.file}/`, aplimit: '500' });
  const subpages = (pref.query?.allpages || []).map(p => p.title);
  if (!subpages.length) continue;

  // Sample from the middle of the book — front matter is atypical and often blank.
  const mid = subpages.slice(Math.floor(subpages.length * 0.35), Math.floor(subpages.length * 0.75));
  let takenForWork = 0;
  for (let i = 0; i < mid.length && takenForWork < MAX_PER_WORK && harvested.length < MAX_PAGES; i += 20) {
    const batch = mid.slice(i, i + 20);
    const j = await api(WS, { action: 'query', prop: 'revisions', rvprop: 'content', rvslots: 'main', titles: batch.join('|') });
    for (const p of j.query?.pages || []) {
      if (takenForWork >= MAX_PER_WORK || harvested.length >= MAX_PAGES) break;
      const raw = p.revisions?.[0]?.slots?.main?.content;
      if (!raw) continue;
      const level = pageQuality(raw);
      if (level === null || level < MIN_LEVEL) continue;
      const text = cleanPageText(raw);
      if (text.length < 600) continue;                    // need enough chars to score
      const pageNum = parseInt((p.title.match(/\/(\d+)$/) || [])[1], 10);
      if (!pageNum) continue;

      // 4. Commons renders the matching page image on demand.
      const ii = await api(COMMONS, {
        action: 'query', prop: 'imageinfo', iiprop: 'url|size', titles: `File:${cand.file}`,
        iiurlwidth: '1800', iiurlparam: `page${pageNum}-1800px`,
      });
      const info = ii.query?.pages?.[0]?.imageinfo?.[0];
      if (!info?.thumburl) continue;

      harvested.push({
        slug: `ws-${WIKI}-${cand.file.replace(/[^A-Za-z0-9]+/g, '-').slice(0, 48).replace(/-+$/, '')}-p${pageNum}`.toLowerCase(),
        work: cand.title || cand.file, year: cand.year, wiki: WIKI,
        source: `${WIKI}.wikisource proofread Page (level ${level})`,
        source_url: `https://${WIKI}.wikisource.org/wiki/${encodeURIComponent(p.title)}`,
        image_url: info.thurl || info.thumburl,
        commons_file: `File:${cand.file}`, page_number: pageNum, quality_level: level,
        // Fidelity is DETECTED, not assumed. Wikisource house style usually modernises
        // long-s, but plenty of editors keep it (e.g. "Arcana Cœleſtia", 1749), and those
        // pages ARE glyph-diplomatic — the only tier that can test long-s preservation.
        // Blanket-tagging everything 'word' would have thrown that tier away.
        fidelity: /[ſꝛﬁﬂﬀ]/.test(text) ? 'glyph' : 'word',
        glyph_marks: (text.match(/[ſꝛﬁﬂﬀ]/g) || []).length,
        reference: text.slice(0, 2000),
      });
      takenForWork++;
      console.log(`  + ${cand.year}  ${p.title.slice(0, 70)}  (L${level}, ${text.length} chars)`);
    }
    await sleep(150);
    }
  } catch (e) {
    failedWorks++;
    console.log(`  ! ${cand.file.slice(0, 50)}: ${e.message.slice(0, 80)}`);
  }
}

const glyphCount = harvested.filter(p => p.fidelity === 'glyph').length;
const outFile = path.join(OUT, `${WIKI}-${YEAR_FROM}-${YEAR_TO}.json`);
fs.writeFileSync(outFile, JSON.stringify({
  harvested_at: new Date().toISOString(), wiki: WIKI, year_from: YEAR_FROM, year_to: YEAR_TO,
  min_quality_level: MIN_LEVEL, failed_works: failedWorks,
  fidelity_counts: { glyph: glyphCount, word: harvested.length - glyphCount },
  caveat: 'Wikisource house style USUALLY modernises long-s and expands ligatures, but not always — '
    + 'per-page `fidelity` is detected from the text itself. Only fidelity="glyph" pages may be used to '
    + 'test long-s/ligature preservation; scoring glyph-faithful OCR against a fidelity="word" reference '
    + 'inflates CER. Measured: la.wikisource ~20% glyph, de.wikisource ~0% (so German Fraktur glyph tests '
    + 'still need DTA original-orthography TEI).',
  pages: harvested,
}, null, 2));
if (failedWorks) console.log(`  (${failedWorks} works failed; partial results still written)`);
console.log(`\nHarvested ${harvested.length} pages → ${outFile}`);
