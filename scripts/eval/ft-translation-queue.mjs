#!/usr/bin/env node
/**
 * ft-translation-queue.mjs — what has nobody translated yet? (#3459)
 *
 * The reference set was built to defend claims we already make. That is the job
 * it is WORST suited to, because defending a claim means asserting an absence and
 * catalogue recall is 27%. This script points the same evidence at the job it is
 * actually fit for: deciding what to translate next.
 *
 * The asymmetry is the whole argument. Prioritisation publishes nothing, so:
 *   - a MISSED prior costs a wasted translation, caught the moment someone reads it
 *   - a FALSE prior silently drops a genuinely untranslated work off the queue
 * Precision on "already done" is what matters, and that is the strong direction
 * of this instrument (32/32 live identity confirmations; zero contradictions
 * against 399 independently-classified never_translated books). Every prior found
 * removes a book with confidence; the 73% missed merely leave the queue noisy.
 *
 * THE ONE THING THIS SCRIPT REFUSES TO DO
 * --------------------------------------
 * Emit a single ranked list across languages. `none_found` for a French work is
 * asserted against 23,035 English translations from French in the set; for a
 * Syriac work it is asserted against 119, and for a Tibetan or Chinese work
 * against a set that structurally cannot answer (MARC 880 on 2.3% of rows). Those
 * are not the same finding and a shared sort order would silently equate them —
 * the exact conflation of "we could not ask" with "we asked and found nothing"
 * that this whole area exists to prevent.
 *
 * So the queue is FACETED by language, every language carries its own reference-
 * set depth, and languages whose depth cannot support a negative are reported
 * separately as UNANSWERABLE rather than ranked low.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/eval/ft-translation-queue.mjs [--min-depth 500] [--top 40]
 */
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';
import { withMongo } from '../lib/mongo.mjs';
import { canonicalLanguage } from '../lib/source-language-match.mjs';
import { classifySourceLanguage, samplePagesForLanguage } from '../lib/english-source-detect.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'output');
const argOf = (f) => { const i = process.argv.indexOf(f); return i === -1 ? null : process.argv[i + 1]; };

/**
 * Below this many English translations FROM a language in the reference set, a
 * `none_found` is not evidence of absence and the books are reported as
 * unanswerable rather than queued. 500 is a declared floor, not a tuned one —
 * it is stated here so a reader can disagree with it and recompute.
 */
const MIN_DEPTH = parseInt(argOf('--min-depth') ?? '500', 10);
const TOP = parseInt(argOf('--top') ?? '40', 10);

/**
 * `--visible` restricts to the PUBLIC shelf: books a reader can already reach.
 *
 * A different question from the full queue, and usually the more actionable one.
 * The unpublished holdings are the larger opportunity but every one of them
 * needs a curation decision before a translation is worth anything; a visible
 * book is one a reader can hit today and find untranslated.
 */
const VISIBLE_ONLY = process.argv.includes('--visible');

/**
 * Languages where DEPTH DOES NOT IMPLY ANSWERABILITY.
 *
 * The set holds 3,868 English translations from Chinese and 5,209 from Japanese,
 * so a depth floor waves them straight through. But CJK works are reachable in
 * this set only through an original-script (MARC 880) title, and LoC English-
 * translation records carry one on 205 of 8,774 CJK-source rows — 2.3%. A
 * romanized match is unusable (mixed pinyin/Wade-Giles, differing syllable
 * segmentation). So a Chinese `none_found` is close to uninformative no matter
 * how deep the set looks by row count.
 *
 * This matters more than any other caveat here: Chinese is the second-largest
 * block in the queue (12,364 works with no prior found) and the least
 * trustworthy. Ranking it on depth alone would put the least reliable evidence at
 * the top of the list and say nothing about it.
 */
const SCRIPT_UNREACHABLE = new Map([
  ['chinese', 'reachable only via MARC 880 original-script title, present on 2.3% of CJK rows'],
  ['japanese', 'reachable only via MARC 880 original-script title, present on 2.3% of CJK rows'],
  ['korean', 'reachable only via MARC 880 original-script title, present on 2.3% of CJK rows'],
  ['tibetan', 'romanized Wylie only; the generic-term stoplist is unreviewed by a Tibetanist'],
]);

const latest = (cohort) => {
  const f = fs.readdirSync(OUT_DIR)
    .filter((x) => new RegExp(`^ft-reference-set-search-${cohort}-\\d{4}-\\d{2}-\\d{2}\\.json$`).test(x))
    .sort().pop();
  if (!f) throw new Error(`no ${cohort} run — node scripts/eval/ft-reference-set-search.mjs --cohort ${cohort}`);
  return path.join(OUT_DIR, f);
};

// ── Reference-set depth, per source language ────────────────────────────────
// How many English translations FROM this language does the set actually hold?
// This is what bounds a null, and it is why a single ranked list would lie.
async function referenceDepth() {
  const depth = new Map();
  const add = (lang, n = 1) => {
    const c = canonicalLanguage(lang);
    if (c) depth.set(c, (depth.get(c) ?? 0) + n);
  };
  for (const dir of ['loc-bulk', 'wikidata']) {
    const full = path.join(OUT_DIR, dir);
    if (!fs.existsSync(full)) continue;
    for (const file of fs.readdirSync(full).filter((f) => f.endsWith('.jsonl'))) {
      const rl = readline.createInterface({
        input: fs.createReadStream(path.join(full, file)), crlfDelay: Infinity,
      });
      for await (const line of rl) {
        if (!line.trim()) continue;
        const row = JSON.parse(line);
        if (row.original_language_label) add(row.original_language_label);
        else for (const l of row.original_languages ?? []) add(l);
      }
    }
  }
  return depth;
}

const run = JSON.parse(fs.readFileSync(latest('untranslated'), 'utf8'));
console.log(`Reading ${path.basename(latest('untranslated'))} — ${run.efforts.length.toLocaleString()} efforts\n`);

const depth = await referenceDepth();

await withMongo(async (db) => {
  const books = await db.collection('books').find(
    { id: { $in: run.efforts.map((e) => e.book_id) } },
    { projection: { id: 1, slug: 1, title: 1, author: 1, language: 1, original_language: 1, year: 1, work_id: 1, pages_count: 1, pages_ocr: 1, visible: 1 } },
  ).toArray();
  const byId = new Map(books.map((b) => [b.id, b]));

  // Books sharing a work_id, and how many DISTINCT years are among them.
  //
  // The obvious significance proxy — "how many copies of this work do we hold" —
  // is wrong, and the first run of this script proved it: the entire head of the
  // queue was 御定佩文韻府, a Qing rhyme dictionary held as 728 sequential
  // 25-page VOLUME records under one work_id. That counted as 728 editions and
  // buried everything else. Multi-volume serials are not popularity.
  //
  // Distinct publication years separate the two: genuine re-editions of a valued
  // work differ in year, volumes of one set share it.
  const worksBooks = new Map();
  for (const b of books) {
    const k = b.work_id || `book:${b.id}`;
    if (!worksBooks.has(k)) worksBooks.set(k, []);
    worksBooks.get(k).push(b);
  }
  const editionsOfWork = new Map();
  for (const [k, list] of worksBooks) {
    editionsOfWork.set(k, new Set(list.map((b) => b.year).filter(Boolean)).size || 1);
  }

  const rows = [];
  for (const e of run.efforts) {
    const b = byId.get(e.book_id);
    if (!b) continue;
    if (VISIBLE_ONLY && b.visible !== true) continue;
    const canon = canonicalLanguage(b.original_language) ?? canonicalLanguage(b.language);
    rows.push({
      ...b,
      verdict: e.verdict,
      canon,
      depth: canon ? (depth.get(canon) ?? 0) : 0,
      ocrReady: (b.pages_ocr ?? 0) > 0,
      workKey: b.work_id || `book:${b.id}`,
      editions: editionsOfWork.get(b.work_id || `book:${b.id}`) ?? 1,
    });
  }

  const tally = {};
  for (const r of rows) tally[r.verdict] = (tally[r.verdict] || 0) + 1;
  console.log('─── Verdicts over the untranslated holdings ──────────────────');
  for (const [v, n] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${v.padEnd(22)} ${String(n).padStart(7)}`);
  }
  console.log('\n  none_found   = nobody in this reference set has done it. A LEAD, not a fact.');
  console.log('  inconclusive = a candidate prior nobody has screened. Screen BEFORE spending.');
  console.log('  prior_found  = English already exists. Drop it.');
  console.log('');
  console.log('  READ `prior_found` CAREFULLY — it is small for a mechanical reason, not');
  console.log('  because the holdings are untranslated. The mechanical screen never asserts');
  console.log('  PRIOR on its own; it defers anything needing bibliographic judgement to');
  console.log('  `unresolved`. So `prior_found` here counts only works a human already ruled');
  console.log('  on (60 durable decisions), and the real "already done" pile is the');
  console.log('  `inconclusive` column. Screening that is what actually shortens this queue —');
  console.log('  do not read a small prior_found as evidence the queue is clean.\n');

  // ── Faceted by language ───────────────────────────────────────────────────
  const byLang = new Map();
  for (const r of rows) {
    const k = r.canon ?? '(unresolved language)';
    if (!byLang.has(k)) byLang.set(k, { lang: k, depth: r.depth, total: 0, none: 0, prior: 0, inconc: 0, ready: 0 });
    const g = byLang.get(k);
    g.total++;
    if (r.verdict === 'none_found') { g.none++; if (r.ocrReady) g.ready++; }
    if (r.verdict === 'prior_found') g.prior++;
    if (r.verdict === 'inconclusive') g.inconc++;
  }
  const langs = [...byLang.values()].sort((a, b) => b.none - a.none);
  for (const l of langs) l.unreachable = SCRIPT_UNREACHABLE.get(l.lang) ?? null;
  const answerable = langs.filter((l) => l.depth >= MIN_DEPTH && !l.unreachable);
  const unanswerable = langs.filter((l) => l.depth < MIN_DEPTH || l.unreachable);

  console.log(`─── QUEUE — languages the reference set can actually answer (depth >= ${MIN_DEPTH}) ───`);
  console.log(`  ${'language'.padEnd(18)}${'set depth'.padStart(10)}${'held'.padStart(8)}${'no prior'.padStart(10)}${'OCR-ready'.padStart(11)}${'prior'.padStart(8)}${'unscreened'.padStart(11)}`);
  for (const l of answerable.slice(0, 20)) {
    console.log(`  ${l.lang.padEnd(18)}${String(l.depth).padStart(10)}${String(l.total).padStart(8)}`
      + `${String(l.none).padStart(10)}${String(l.ready).padStart(11)}${String(l.prior).padStart(8)}${String(l.inconc).padStart(11)}`);
  }
  const sum = (arr, k) => arr.reduce((n, x) => n + x[k], 0);
  console.log(`  ${'TOTAL'.padEnd(18)}${''.padStart(10)}${String(sum(answerable, 'total')).padStart(8)}`
    + `${String(sum(answerable, 'none')).padStart(10)}${String(sum(answerable, 'ready')).padStart(11)}`
    + `${String(sum(answerable, 'prior')).padStart(8)}${String(sum(answerable, 'inconc')).padStart(11)}`);

  console.log('\n─── NOT A QUEUE — the set cannot support a negative here ───');
  console.log('  These are not low-priority. They are UNMEASURED: a null says nothing, and');
  console.log('  answering them needs a tradition-native catalogue (84000/BDRC, CBETA/ctext).');
  console.log(`  Either the set is too thin (depth < ${MIN_DEPTH}) or the work is unreachable by`);
  console.log('  the only key the set indexes on — note that CJK fails on REACHABILITY while');
  console.log('  looking perfectly deep by row count.\n');
  for (const l of unanswerable.slice(0, 14)) {
    console.log(`  ${l.lang.padEnd(14)}${String(l.depth).padStart(7)} depth  ${String(l.total).padStart(6)} held, ${String(l.none).padStart(6)} unmeasured`
      + `${l.unreachable ? `\n      ^ ${l.unreachable}` : ''}`);
  }
  console.log(`  ${'TOTAL'.padEnd(18)}${''.padStart(10)}         ${String(sum(unanswerable, 'total')).padStart(6)} held, ${String(sum(unanswerable, 'none')).padStart(6)} unmeasured`);

  // ── The actionable head of the queue ──────────────────────────────────────
  //
  // ONE ROW PER WORK, not per book. You decide to translate the *Peiwen Yunfu*,
  // not volume 621 of it, and a per-book list makes a single 728-volume set look
  // like 728 opportunities. Collapsing by work_id also turns the size of a
  // multi-volume undertaking into visible information (18,200 pages) instead of
  // hiding it as repetition.
  // Must apply BOTH gates the language table applies — depth AND reachability.
  // Filtering on depth alone left 11,033 Chinese books in the head of the queue
  // while the table above reported them as unmeasured: the same run contradicting
  // itself, with the unreliable evidence sitting at the top.
  const eligible = rows.filter((r) => r.verdict === 'none_found' && r.ocrReady
    && r.depth >= MIN_DEPTH && !SCRIPT_UNREACHABLE.has(r.canon));
  const works = new Map();
  for (const r of eligible) {
    if (!works.has(r.workKey)) {
      works.set(r.workKey, {
        workKey: r.workKey, canon: r.canon, depth: r.depth, editions: r.editions,
        volumes: 0, pages: 0, title: r.title, author: r.author, year: r.year,
        slug: r.slug, id: r.id, visible: r.visible,
      });
    }
    const w = works.get(r.workKey);
    w.volumes++;
    w.pages += r.pages_ocr ?? 0;
    // Show the shortest title in the set — volume titles are the base title plus
    // an enumeration, so the shortest is closest to the work's own name.
    if ((r.title || '').length < (w.title || '').length) { w.title = r.title; w.slug = r.slug; w.id = r.id; }
  }
  let head = [...works.values()]
    .sort((a, b) => b.editions - a.editions || b.volumes - a.volumes || b.pages - a.pages);

  // ── Source-language screen ────────────────────────────────────────────────
  //
  // `books.language` records the language of the WORK, not of the pages we hold.
  // A re-hosted scholarly edition prints the ancient text with an English
  // translation, and some of our records are the translation itself: Ganguli's
  // *Mahābhārata* is catalogued Sanskrit, Avalon's *Serpent Power* is catalogued
  // Sanskrit, Boehme's *Works* (1781) is catalogued Latin. Every one of them is
  // already English and needs no translation at all.
  //
  // Nothing upstream catches this — it is invisible to the catalogue search,
  // which is asking a question about the WORK. Read the OCR model's own declared
  // page language (see english-source-detect.mjs for why provenance and
  // `pages.ocr.language` both fail here).
  if (!process.argv.includes('--no-source-screen')) {
    const pages = db.collection('pages');
    const kept = [];
    const alreadyEnglish = [];
    let undetermined = 0;
    for (const w of head) {
      // Sample from the MIDDLE of the book. Front matter (title page, preface,
      // editor's introduction) is routinely English even in a Latin edition, so
      // sampling from the start reports the apparatus rather than the text.
      // Sampling lives in `english-source-detect.mjs` and is imported, not
      // reimplemented. The copy that used to sit here got all three of its
      // hazards wrong — soft-hidden negative page numbers, an offset over
      // `pages_count` rather than the OCR'd set, and eight CONSECUTIVE pages
      // (which is one place in the book, so an English glossary at the back
      // spoke for the whole of it). Every book it flagged as already-English was
      // a false positive, and each false positive silently DROPPED a genuine
      // translation candidate off this queue.
      const { texts, available } = await samplePagesForLanguage(pages, w.id);
      // "We could not ask" is not "we asked and found nothing": a work with no
      // OCR is unscreenable, and must not be reported as undetermined evidence.
      const verdict = available === 0
        ? { verdict: 'no_ocr', basis: 'no_ocr_pages', pages_judged: 0 }
        : classifySourceLanguage(texts);
      w.source_language = verdict;
      if (verdict.verdict === 'english_source') alreadyEnglish.push(w);
      else { if (verdict.verdict === 'undetermined') undetermined++; kept.push(w); }
    }
    head = kept;
    console.log(`\n─── Source-language screen: ${alreadyEnglish.length} work(s) are ALREADY ENGLISH ───`);
    console.log('  Catalogued under a foreign language, but the pages we hold are an English');
    console.log('  edition. They need no translation and are removed from the queue.');
    for (const w of alreadyEnglish) {
      console.log(`  ${String(w.canon).padEnd(10)}${String(w.pages).padStart(6)}pp  ${(w.title || '').slice(0, 52).padEnd(54)}${w.source_language.basis}`);
    }
    if (undetermined) console.log(`  (${undetermined} work(s) undetermined — too little legible text; kept, flagged in the JSON)`);
  }

  console.log(`\n─── Head of the queue: OCR-ready, no prior found, answerable language ───`);
  console.log(`  ${eligible.length.toLocaleString()} books collapse to ${head.length.toLocaleString()} distinct works.`);
  console.log('  Ordered by distinct editions held, then volumes, then length. Deliberately');
  console.log('  NOT a score — no weights are invented, and the columns are shown so you can');
  console.log('  disagree with the ordering rather than trust it.\n');
  console.log(`  ${'lang'.padEnd(11)}${'ed'.padStart(3)}${'vol'.padStart(5)}${'pages'.padStart(8)}  title`);
  for (const w of head.slice(0, TOP)) {
    console.log(`  ${String(w.canon).padEnd(11)}${String(w.editions).padStart(3)}${String(w.volumes).padStart(5)}${String(w.pages).padStart(8)}  `
      + `${(w.title || '').slice(0, 50).padEnd(52)}${w.visible ? '' : '[hidden] '}${w.year || ''}`);
  }

  // Blocked on OCR, not on evidence. Same finding, different next action: these
  // need a pipeline run before a translator or a model can touch them, so they
  // belong on a separate list rather than buried in the queue's tail.
  const needsOcr = rows.filter((r) => r.verdict === 'none_found' && !r.ocrReady
    && r.depth >= MIN_DEPTH && !SCRIPT_UNREACHABLE.has(r.canon));
  console.log(`\n─── Blocked on OCR first: ${needsOcr.length} book(s), no prior found, answerable language ───`);
  for (const r of needsOcr.slice(0, 12)) {
    console.log(`  ${String(r.canon).padEnd(11)}${String(r.pages_count ?? 0).padStart(6)}pp  ${(r.title || '').slice(0, 54).padEnd(56)}${r.year || ''}`);
  }

  const out = path.join(OUT_DIR,
    `ft-translation-queue${VISIBLE_ONLY ? '-visible' : ''}-${new Date().toISOString().slice(0, 10)}.json`);
  fs.writeFileSync(out, JSON.stringify({
    min_depth: MIN_DEPTH,
    reference_depth: Object.fromEntries([...depth].sort((a, b) => b[1] - a[1])),
    verdicts: tally,
    by_language: langs,
    queue: head.map((w) => ({
      work_key: w.workKey, id: w.id, slug: w.slug, title: w.title, author: w.author,
      year: w.year, language: w.canon, reference_set_depth: w.depth,
      distinct_editions_held: w.editions, volumes: w.volumes, ocr_pages: w.pages,
      visible: w.visible,
    })),
  }, null, 2));
  console.log(`\nWrote ${out}`);
}, { noTimeout: true });
