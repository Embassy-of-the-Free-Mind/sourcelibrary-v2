#!/usr/bin/env node
// PRIOR ART: scripts/maintenance/detect-translation-misalignment.mjs — compares the PRINTED page
// number tag in both layers; it needs <page-num> in the English (1 of 385 pages on Śakuntalā) and
// the block translator kept the right running head while moving the body, so it is blind to this
// shape by construction. scripts/lib/block-drift.mjs + scripts/audit/translation-page-boundary.mjs
// (#5021/#5031/#3918) — a CLAUSE moved across one boundary, tested by letter case; caseless
// scripts make no claim, and its anchorsNext looks only at the page edge. scripts/lib/text-shift.mjs
// is the repair transform for OCR shifts, not a detector. None reads the numbers a leaf prints in
// its BODY (verse numbers, footnote keys) in any numeral system, which is the only signal a
// Devanagari, Tibetan or Arabic page offers without a model.
/**
 * translation-leaf-shift — is a page's English the NEXT or PREVIOUS leaf's text? (#5021, #6672)
 * $0 and read-only: Mongo reads, no model, no writes.
 *
 * The shape (Śakuntalā 69dea23c4d19ec2e9ba75f5e pp.291-295, found by a volunteer run, #6418):
 * the 8-page block translator wrote each page's own running head and then the body of the
 * following leaf. Every text is healthy English; it is on the wrong page.
 *
 * Signal: numbers. Per page, the numbers in the body of the transcription (verse numbers such as
 * ॥१७३॥, "Verse 173." footnote keys, section and line numbers, years, cross-references; digits of
 * every Unicode numeral system, CJK numerals, upper-case Roman numerals) against the numbers in
 * the body of the English. A number in page N's English votes
 *   own   it is in N's transcription and in neither neighbour's
 *   next  it is in N+1's transcription, not in N's and not in N-1's
 *   prev  it is in N-1's transcription, not in N's and not in N+1's
 * and otherwise says nothing (shared with a neighbour, or in none of the three).
 * Left out: numbers below MIN_VALUE (footnote keys 1-9 are on every page); bracketed numbers
 * below BRACKET_MIN ("(12)", "[3]": list items and editorial counters, the false hits on
 * Śakuntalā p.360); the running head and the printed page number of both layers — the block
 * translator kept those right, so they vote "own" on a shifted page. The head is reported as a
 * second, separate class (hdr), never mixed into the verdict.
 *
 * Page class: next (next ≥ 1, own = 0, prev = 0), prev (mirror), own (own ≥ 1, no neighbour
 * vote), mixed (anything else with a vote), none (no vote: NO CLAIM, not "aligned").
 * A book is FLAGGED on a RUN (the gappy rule, 2026-11-03, scripts/lib/leaf-shift.mjs gappyRuns):
 * ≥ MIN_RUN pages voting one direction inside a window of page_numbers where no page votes the
 * other way, `own` or `mixed`, and at most MAX_GAP silent pages sit between two voting ones; a
 * `next` run may end on one `prev` page (the last leaf of a slipped block carries the previous
 * leaf's footnotes back: Karl Grosherzog p.20). Until 2026-11-03 the run had to be ≥ MIN_RUN
 * ADJACENT pages; that rule (`strictRuns`) is kept in the output and is still the write-time gate's.
 * A single `next` page is a boundary drift candidate (#5021's class), not a whole-page shift.
 * Tier A: some run where EVERY page also lacks at least one of its own body numbers (ownMissing)
 * and votes with a number ≥ STRONG_MIN — the small sequential numbers (10, 11, 12) that lists
 * and verse counts repeat on every other page cannot make a tier-A run. Tier B: the rest.
 *
 * MEASURED 2026-10-13 (#5021), scripts/eval/experiments/2026-10-13-translation-leaf-shift-5021.md:
 *   control    Śakuntalā as of 2026-10-13T00:00Z: one run, pp.291-294, each page voting the next
 *              leaf's verse number (171-174), head class `own`. Live text: no run.
 *   by eye     20 flagged books, one page each, scan opened: 12 carry the neighbour's English
 *              (tier A 8/10, tier B 4/10). The four tier-B flags on single-page-lane (v2) text,
 *              which cannot move a page, were all false: tier B is a noise floor there.
 *   coverage   84% of translated pages in caseless-label books cast no vote (Tibetan 99%), and
 *              3,862 of 5,903 such books have no testable pair. No flag is NOT "aligned".
 * MEASURED 2026-11-03 (#5021), scripts/eval/experiments/2026-11-03-leaf-shift-library-5021.md: every live
 *              translated book (24,859), gappy rule: 1,164 flagged, 310 tier A. Opus with the scans, blind to the
 *              direction (scripts/audit/leaf-shift-confirm-5021.mjs): tier A 76/80 real, tier B 156/220, 0/20 on
 *              random unflagged windows; the v2/v5 single-page lane 3/22 runs. Absorption (absorptionsOf, the
 *              `absorbed` field) confirms 40/59 outside the number runs. Names alone sit at the noise floor.
 * MEASURED 2026-11-10 (#8464), scripts/eval/experiments/2026-11-10-leaf-shift-ocr-gaps-8464.md: neighbours are the
 *              nearest pages with text, not page_number ±1 — Cicero 1546's English slipped one slot over leaves with
 *              no OCR (p.56 = p.59's leaf). On 600 seeded live books: number runs unchanged (17/17), one name run added.
 * A flag is a work list; open the scan before acting on it (measurement-instruments.md).
 *
 * Usage (node --env-file=.env.production.local):
 *   --book <id> [--as-of <ISO>] [--list]   one book; --as-of rebuilds the English as it stood
 *                                          at that time from page_revisions snapshots
 *   --frame caseless                       every translated book whose language label is a
 *                                          caseless script
 *   --frame rest --sample 300 [--seed 5021]  seeded draw from the other translated books
 *   --frame rest --sample all              every other translated book
 *   --live        only books readers can open (visible, pages_count > 0)
 *   --out <dir>   checkpoint file <dir>/<frame>.jsonl, one line per book, resumed on re-run
 *   --shard i/n   scan every n-th book from i into <dir>/<frame>.s<i>.jsonl (run n processes; the
 *                 classifier is CPU-bound, about 25 books a minute per process)
 *   --self-test   assertions on the extractor, no database
 */
import fs from 'node:fs';
import path from 'node:path';
import { stripMarkupTags } from '../lib/strip-markup-tags.mjs';
import {
  MIN_VALUE, BRACKET_MIN, MAX_VALUE, MIN_RUN, HEAD_LINE_MAX, STRONG_MIN, META_TAGS, HEAD_TAGS, tagBlock,
  foldDigits, cjkNumber, splitLayer, numbersIn, classifyBook,
} from '../lib/leaf-shift.mjs';

export { MIN_VALUE, BRACKET_MIN, MAX_VALUE, MIN_RUN, HEAD_LINE_MAX, STRONG_MIN, foldDigits, cjkNumber, splitLayer, numbersIn, classifyBook };

/** Dominant script of a book's transcription: 'caseless' when most letters have no case. */
export function scriptOf(sample) {
  const s = stripMarkupTags(String(sample || '').replace(tagBlock(`${META_TAGS}|${HEAD_TAGS}`), ' '), ' ');
  const cased = (s.match(/[\p{Lu}\p{Ll}]/gu) || []).length;
  const caseless = (s.match(/\p{Lo}/gu) || []).length;
  const by = {};
  for (const [name, re] of Object.entries({
    Devanagari: /\p{Script=Devanagari}/gu, Tibetan: /\p{Script=Tibetan}/gu, Han: /\p{Script=Han}/gu, Arabic: /\p{Script=Arabic}/gu,
    Hebrew: /\p{Script=Hebrew}/gu, Syriac: /\p{Script=Syriac}/gu, Hangul: /\p{Script=Hangul}/gu, Kana: /[\p{Script=Hiragana}\p{Script=Katakana}]/gu,
    Latin: /\p{Script=Latin}/gu, Greek: /\p{Script=Greek}/gu, Cyrillic: /\p{Script=Cyrillic}/gu,
  })) by[name] = (s.match(re) || []).length;
  const top = Object.entries(by).sort((a, b) => b[1] - a[1])[0];
  const letters = cased + caseless;
  return { caselessShare: letters ? caseless / letters : null, script: top && top[1] > 0 ? (top[0] === 'Kana' || (top[0] === 'Han' && by.Kana > by.Han * 0.15) ? 'Japanese' : top[0]) : 'none' };
}

export const CASELESS_LABEL = /chinese|tibetan|sanskrit|pali\b|prakrit|hindi|marathi|bengali|nepali|^ne$|tamil|telugu|kannada|malayalam|gujarati|punjabi|sinhal|burmese|thai\b|khmer|lao\b|japanese|korean|arabic|persian|farsi|urdu|ottoman|hebrew|aramaic|yiddish|ladino|syriac|samaritan|mandaic|ge'?ez|ethiopic|amharic|georgian|mongol|manchu|sumerian|akkadian|egyptian|demotic|hieroglyph|avestan|pahlavi|sogdian|uyghur/i;

function selfTest() {
  const eq = (a, b, what) => {
    if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`self-test: ${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
  };
  eq(foldDigits('॥१७३॥ ٤٢ ༡༢ １２'), '॥173॥ 42 12 12', 'foldDigits');
  eq(cjkNumber('一百七十三'), 173, 'cjk units');
  eq(cjkNumber('廿三'), 23, 'cjk 廿');
  eq(cjkNumber('一七三'), 173, 'cjk positional');
  eq([...numbersIn('Verse 173. See (12) and [45], p. 275; CLXXIV; MIX; 7')].sort((a, b) => a - b), [173, 174, 275], 'numbersIn');
  const mk = (n, own, eng) => ({ page_number: n, ocr: `<page-num>${n + 100}</page-num>\n\nपाठः ॥${own}॥\n\nVerse ${own}. note`, tr: `${n + 100} || Act VII ||\n\nText.\n\n<note>Verse ${eng}</note>` });
  const shifted = classifyBook([mk(1, 170, 170), mk(2, 171, 172), mk(3, 172, 173), mk(4, 173, 174), mk(5, 174, 174)], { rule: 'gappy' });
  eq(shifted.rows.map(r => r.cls), ['own', 'next', 'next', 'next', 'own'], 'shifted classes');
  eq(shifted.runs.map(r => [r.dir, r.start, r.end]), [['next', 2, 4]], 'shifted run');
  eq(classifyBook([mk(1, 170, 170), mk(2, 171, 171), mk(3, 172, 172)]).runs, [], 'aligned book');
  // #8464: leaves with no transcription between the shifted pages are skipped, not neighbours.
  const blank = n => ({ page_number: n, ocr: '', tr: '' });
  const gapped = classifyBook([mk(1, 170, 170), blank(2), mk(3, 171, 172), blank(4), blank(5), mk(6, 172, 173), mk(7, 173, 174), blank(8), mk(9, 174, 174)], { rule: 'gappy' });
  eq(gapped.runs.map(r => [r.dir, r.start, r.end, r.strict]), [['next', 3, 7, true]], 'run across untranscribed leaves');
  console.log('self-test ok');
}

// ---------------------------------------------------------------------------------------------
async function loadBook(db, bookId, asOf) {
  let pages = await db.collection('pages')
    .find({ book_id: bookId }, { projection: { page_number: 1, id: 1, page_type: 1, 'translation_withheld.updated_at': 1, 'translation_withheld.chars': 1, 'ocr.data': 1, 'translation.data': 1, 'translation.prompt_version': 1, 'translation.updated_at': 1, 'translation.model': 1 } })
    .sort({ page_number: 1 }).toArray();
  // Negative page_numbers are hidden pages (moved out of the reading order); readers never see them.
  pages = pages.filter(p => p.page_number >= 0);
  let restored = 0;
  if (asOf) {
    const ids = pages.map(p => p.id || String(p._id));
    const revs = await db.collection('page_revisions')
      .find({ page_id: { $in: ids }, field: 'translation', created_at: { $gt: asOf } }, { projection: { page_id: 1, data: 1, prompt_version: 1, created_at: 1 } })
      .sort({ created_at: 1 }).toArray();
    const firstAfter = new Map();
    for (const r of revs) if (!firstAfter.has(r.page_id)) firstAfter.set(r.page_id, r);
    for (const p of pages) {
      const r = firstAfter.get(p.id || String(p._id));
      // A revision row holds the value it REPLACED, so the first one after as-of is the text as-of.
      if (r && typeof r.data === 'string') {
        p.translation = { data: r.data, prompt_version: r.prompt_version, updated_at: p.translation?.updated_at ?? p.translation_withheld?.updated_at, model: p.translation?.model ?? null };
        restored++;
      }
    }
  }
  return {
    restored,
    pages: pages.map(p => ({ page_number: p.page_number, ocr: p.ocr?.data || '', tr: p.translation?.data || '', pv: p.translation?.prompt_version != null ? String(p.translation.prompt_version).replace(/^v/i, '') : null, model: p.translation?.model || null, page_type: p.page_type ?? null, updated: p.translation?.updated_at ? new Date(p.translation.updated_at).toISOString() : null })),
  };
}

function summarise(book, loaded) {
  const { pages } = loaded;
  const res = classifyBook(pages, { rule: 'gappy', names: true, absorb: true });
  const strict = res.strictRuns;
  const translated = res.rows.filter(r => r.translated);
  const pvCount = {};
  for (const r of translated) pvCount[r.pv ?? 'none'] = (pvCount[r.pv ?? 'none'] || 0) + 1;
  const modelCount = {};
  for (const p of pages) if (p.tr) modelCount[p.model ?? 'none'] = (modelCount[p.model ?? 'none'] || 0) + 1;
  // Runs the name signal adds: a numbers+names run that overlaps no numbers-only run.
  const overlaps = (a, b) => a.dir === b.dir && a.start <= b.end && b.start <= a.end;
  const nameOnly = res.runsNames.filter(x => !res.runs.some(y => overlaps(x, y)));
  const sc = scriptOf(pages.filter(p => p.tr).slice(0, 400).map(p => p.ocr.slice(0, 1500)).join('\n'));
  return {
    book_id: book.id || String(book._id),
    title: String(book.title || '').slice(0, 90),
    language: book.language ?? null,
    script: sc.script,
    caselessShare: sc.caselessShare == null ? null : Math.round(sc.caselessShare * 1000) / 1000,
    visible: !!book.visible,
    pages: pages.length,
    translated: translated.length,
    pv: pvCount,
    blockEra: (pvCount['10'] || 0) + (pvCount['11'] || 0),
    classes: res.classes,
    hdrClasses: res.hdrClasses,
    model: modelCount,
    signal: translated.filter(r => r.cls !== 'none').length,
    nameSignal: translated.filter(r => r.cls === 'none' && r.nameCls && r.nameCls !== 'none').length,
    // Consecutive translated pages that BOTH vote: the only places a run could have been seen.
    pairs: res.rows.filter((r, i) => i > 0 && r.translated && r.cls !== 'none' && res.rows[i - 1].translated && res.rows[i - 1].cls !== 'none' && res.rows[i - 1].pos === r.pos - 1).length,
    singles: { next: res.rows.filter(r => r.cls === 'next').length, prev: res.rows.filter(r => r.cls === 'prev').length },
    runs: res.runs,
    flagged: res.runs.length > 0,
    tier: !res.runs.length ? null : res.runs.some(x => x.strong) ? 'A' : 'B',
    // The 2026-10-13 rule on the same text: what the gappy rule changed.
    strictRuns: strict.map(x => [x.dir, x.start, x.end, x.strong]),
    strictTier: !strict.length ? null : strict.some(x => x.strong) ? 'A' : 'B',
    // Name-signal runs that no numbers-only run covers (reported separately; see --names notes).
    nameRuns: nameOnly,
    // Absorbing pages (scripts/lib/leaf-shift.mjs absorptionsOf): all, and those a vote corroborates.
    absorptions: res.absorptions.length,
    absorbed: res.absorptions.filter(a => a.corroborated.length),
    ...(loaded.restored ? { restored: loaded.restored } : {}),
  };
}

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const arg = (name, dflt = null) => {
    const i = argv.indexOf(name);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : dflt;
  };
  if (argv.includes('--self-test')) return selfTest();
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI not set: node --env-file=.env.production.local …');
  const { MongoClient, ObjectId } = await import('mongodb');
  const client = new MongoClient(process.env.MONGODB_URI, { readPreference: 'secondaryPreferred', maxPoolSize: 6, compressors: ['zlib'] });
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || 'bookstore');
  try {
    const BOOK = arg('--book');
    if (BOOK) {
      const or = [{ id: BOOK }];
      if (/^[0-9a-f]{24}$/i.test(BOOK)) or.push({ _id: new ObjectId(BOOK) });
      const book = await db.collection('books').findOne({ $or: or }, { projection: { id: 1, title: 1, language: 1, visible: 1 } });
      if (!book) throw new Error(`no book ${BOOK} by id or _id`);
      const asOf = arg('--as-of') ? new Date(arg('--as-of')) : null;
      const loaded = await loadBook(db, book.id || String(book._id), asOf);
      const s = summarise(book, loaded);
      console.log(JSON.stringify(s, null, 2));
      if (argv.includes('--list')) {
        for (const r of classifyBook(loaded.pages).rows) {
          if (r.cls === 'none' || r.cls === 'untranslated' || r.cls === 'own') continue;
          console.log(`p.${r.page_number}\t${r.cls}\thdr=${r.hdr}\town=${r.votes.own.join(',')}\tnext=${r.votes.next.join(',')}\tprev=${r.votes.prev.join(',')}\townMissing=${r.ownMissing}`);
        }
      }
      return;
    }

    const FRAME = arg('--frame');
    if (!['caseless', 'rest'].includes(FRAME)) throw new Error('give --book <id>, --frame caseless, --frame rest, or --self-test');
    const OUT = arg('--out', 'scripts/output/translation-leaf-shift');
    fs.mkdirSync(OUT, { recursive: true });
    // --shard i/n: this process scans every n-th book from i; each shard writes its own file.
    const [SH_I, SH_N] = (arg('--shard', '0/1')).split('/').map(Number);
    const file = path.join(OUT, SH_N > 1 ? `${FRAME}.s${SH_I}.jsonl` : `${FRAME}.jsonl`);
    const all = await db.collection('books')
      .find(argv.includes('--live') ? { pages_translated: { $gt: 0 }, visible: true, pages_count: { $gt: 0 } } : { pages_translated: { $gt: 0 } }, { projection: { id: 1, title: 1, language: 1, visible: 1, pages_translated: 1 } })
      .sort({ _id: 1 }).toArray();
    const isCaseless = b => CASELESS_LABEL.test(String(b.language || ''));
    let books = all.filter(b => (FRAME === 'caseless' ? isCaseless(b) : !isCaseless(b)));
    const frameSize = books.length;
    if (FRAME === 'rest' && arg('--sample', '300') !== 'all') {
      const n = Number(arg('--sample', '300'));
      const rnd = mulberry32(Number(arg('--seed', '5021')));
      for (let i = books.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [books[i], books[j]] = [books[j], books[i]];
      }
      books = books.slice(0, n);
    }
    const done = new Set();
    for (const f of fs.readdirSync(OUT).filter(f => f.startsWith(`${FRAME}.`) && f.endsWith('.jsonl'))) {
      for (const l of fs.readFileSync(path.join(OUT, f), 'utf8').split('\n')) {
        try { if (l) done.add(JSON.parse(l).book_id); } catch { /* a torn last line: re-scan that book */ }
      }
    }
    if (SH_N > 1) books = books.filter((_, i) => i % SH_N === SH_I);
    console.error(`${FRAME}: frame ${frameSize} books, ${books.length} to scan, ${done.size} already in ${file}`);
    const queue = books.filter(b => !done.has(b.id || String(b._id)));
    let n = 0;
    const worker = async () => {
      for (let b = queue.shift(); b; b = queue.shift()) {
        try {
          const s = summarise(b, await loadBook(db, b.id || String(b._id), null));
          fs.appendFileSync(file, JSON.stringify(s) + '\n');
        } catch (e) {
          fs.appendFileSync(path.join(OUT, `${FRAME}.errors.log`), `${b.id || b._id}\t${e.message}\n`);
        }
        if (++n % 100 === 0) console.error(`  ${n}/${queue.length + n}`);
      }
    };
    await Promise.all(Array.from({ length: Number(arg('--concurrency', '4')) }, worker));
    console.error(`DONE ${FRAME}: ${n} scanned this run`);
  } finally {
    await client.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
