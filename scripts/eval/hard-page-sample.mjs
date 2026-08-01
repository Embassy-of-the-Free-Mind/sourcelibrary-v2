#!/usr/bin/env node
/**
 * Draw a labelled exemplar set of HARD pages, one bucket per failure class (#3469).
 *
 * The 44 pinned ground-truth pages are selected for being easy — they exist
 * because scholarly etexts exist for them, which means clean canonical print.
 * This set answers the different question: does a prompt or model change help
 * where we are actually weak? It is deliberately NOT accuracy-scored (most hard
 * pages have no etext and never will); it feeds reference-free outcomes —
 * attribution, gap marking, two-pass stability.
 *
 * TWO SOURCING LANES, and the distinction is the whole point:
 *
 *   self_reported  — the page carries a `<warning>` naming its own condition.
 *                    CHEAP but BIASED: it selects pages the model already
 *                    NOTICED the defect on, i.e. where it partly succeeded.
 *                    Usable for "does the change help on damaged scans",
 *                    never for "how often do we miss damage".
 *
 *   proven_miss    — two OCR passes over the SAME page disagree, so at least
 *                    one is wrong, independent of anything the model claims.
 *                    This is the only lane that can surface false negatives
 *                    (the marginalia case: selecting pages by their stored
 *                    `<margin>` tag selects marginalia the model FOUND).
 *
 * #3473 FILTER — MANDATORY on the proven_miss lane. ~40% of `page_revisions`
 * pairs do not read the same image: the #3357 e-rara repair moved `ocr`
 * subdocuments between pages, so the "disagreement" is an administrative
 * artifact replicated across thousands of pages. Pairs whose printed
 * `<page-num>` disagrees are dropped. Without this the "hard" pages are mostly
 * re-archived ones.
 *
 * Blind spot, by construction: this cannot see FABRICATION. Two passes that
 * both recite the same memorized verse agree perfectly and look easy
 * (/blog/reciting-not-reading). That class comes from the synthetic cloze
 * probe in scripts/eval/cloze-probe.mjs, not from here.
 *
 * Usage:
 *   node scripts/eval/hard-page-sample.mjs [--sample=120000] [--per-class=20]
 *                                          [--out=scripts/eval/dataset/v0.4-difficulty/pages.jsonl]
 */

import { MongoClient } from 'mongodb';
import fs from 'fs';
import path from 'path';
import { getPageSource } from '../lib/page-image-url.mjs';

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true];
}));
const SAMPLE = parseInt(args.sample || '120000', 10);
const PER_CLASS = parseInt(args['per-class'] || '20', 10);
const MAX_PER_BOOK = parseInt(args['max-per-book'] || '2', 10);
const REV_SAMPLE = parseInt(args['rev-sample'] || '8000', 10);
const OUT = args.out || 'scripts/eval/dataset/v0.4-difficulty/pages.jsonl';

/** Damage classes the model names in its own `<warning>`. */
const WARNING_CLASSES = [
  ['bleed_through', /bleed[- ]?through|show[- ]?through|verso|reverse side|other side|ghost/i],
  ['staining', /stain|discolou?r|water damage|damp/i],
  ['ink_blot', /ink blot|blot|smudge|over[- ]?ink|saturat/i],
  ['fading', /fade|faded|faint|light print|weak impression|worn type/i],
  ['foxing', /fox(ing|ed)|speckl|mottl/i],
  ['gutter_loss', /gutter|tight bind|curvature|spine|obscured by the bind/i],
  ['cropping', /crop|cut off|edge of the page|outside the scan|occlud/i],
  ['blur', /blur|out of focus|unfocus/i],
  ['skew', /skew|tilt|rotat/i],
  ['handwriting', /handwrit|hand[- ]?written|cursive/i],
];

const SPACELESS = /tibet|chinese|japanese|thai|khmer|burmese|lao/i;
const pageNum = t => {
  const m = (t || '').match(/<page-num>\s*([0-9]{1,4})\s*<\/page-num>/i);
  return m ? parseInt(m[1], 10) : null;
};
const plain = t => (t || '').replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim();
const words = t => plain(t).split(' ').filter(Boolean);

/**
 * Degenerate output (#3273): a repetition loop, measured DIRECTLY as "how much
 * of the page is one repeated unit" rather than via type/token ratio.
 *
 * Word-level TTR cannot be used here. CLAUDE.md's rule that word metrics lie
 * about space-less scripts applies with force: a whitespace-tokenised Tibetan
 * or Javanese page reports a tiny unique-token count for reasons that have
 * nothing to do with looping, and a TTR<0.15 rule flagged ~20% of them.
 *
 * Measured over SLIDING windows, as the share of long windows that are repeats:
 *
 *     1 - (distinct K-grams / total K-grams)
 *
 * Natural prose in any script almost never repeats a 24-character window, so
 * this sits near 0; a looping page revisits a handful of windows forever and
 * sits near 1. It is phase-independent, which the first two attempts were not:
 * non-overlapping tiles scored a genuine `तत्रैव `-loop at only 0.14, because a
 * period-7 unit never aligns with a 24-character tile boundary. (An earlier
 * overlapping variant reported "coverage" above 1.0 by counting each character
 * K/step times.) Both failures were caught by the unit test, not by reading it.
 */
const LOOP_TILE = 24;
function loopCoverage(t) {
  const s = plain(t);
  if (s.length < 400) return 0;
  const seen = new Set();
  let total = 0;
  for (let i = 0; i + LOOP_TILE <= s.length; i++) {
    seen.add(s.slice(i, i + LOOP_TILE));
    total++;
  }
  if (!total) return 0;
  return 1 - seen.size / total;
}
/** Entity padding (#3273): `&nbsp;` runs inflate every length-based metric. */
function entityPadRatio(t) {
  const ents = ((t || '').match(/&[a-z]+;/gi) || []).length;
  return ents * 6 / Math.max(1, (t || '').length);
}
/**
 * The page's own OCR declares it blank. Uses the structured `<page-type>` tag
 * rather than prose matching — a regex over the warning text misfires both ways
 * ("significant bleed-through makes some text difficult to read" is a TRUE hard
 * page that a naive `remains legible` pattern would drop).
 */
function isBlankPage(t) {
  return /<page-type>\s*blank\s*<\/page-type>/i.test(t || '');
}

const LOOP_THRESHOLD = 0.5;
function isDegenerate(t) {
  return loopCoverage(t) >= LOOP_THRESHOLD || entityPadRatio(t) > 0.5;
}

async function main() {
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI not set. Use: set -a; source .env.production.local; set +a; node ...');
    process.exit(1);
  }
  const c = new MongoClient(process.env.MONGODB_URI);
  await c.connect();
  const db = c.db('bookstore');

  /** class -> [candidate] */
  const buckets = new Map();
  const add = (cls, row, lane, evidence) => {
    if (!buckets.has(cls)) buckets.set(cls, []);
    buckets.get(cls).push({ ...row, _lane: lane, _evidence: evidence });
  };

  // ---------------------------------------------------------------- lane 1
  console.log(`\n  Lane 1 (self_reported): sampling ${SAMPLE.toLocaleString()} pages…`);
  const pages = await db.collection('pages').aggregate([
    { $sample: { size: SAMPLE } },
    { $project: { id: 1, book_id: 1, page_number: 1, 'ocr.data': 1, scan_quality: 1,
                  display_photo: 1, archived_photo: 1, photo: 1, photo_original: 1, crop: 1 } },
  ], { allowDiskUse: true, maxTimeMS: 900000 }).toArray();

  let ocrCount = 0, blankCount = 0;
  for (const p of pages) {
    const t = p?.ocr?.data;
    if (!t) continue;
    ocrCount++;

    // A BLANK page cannot exemplify a text-difficulty class, and the warning
    // regexes happily match one: "the page is blank, save for text at the
    // extreme left edge (the gutter) which belongs to the facing page" was
    // selected as a `gutter_loss` exemplar. A spot check found 39 of 334 rows
    // (11.7%) were declared blank by their own OCR — `gutter_loss` was 8/20.
    //
    // They are not discarded, because "does the model invent text on an empty
    // page" is one of the few fabrication probes available without ground
    // truth. They become their own class instead of contaminating nine others.
    if (isBlankPage(t)) {
      blankCount++;
      add('blank_page', p, 'structural', 'OCR declares <page-type>blank</page-type>');
      continue;
    }

    const warn = (t.match(/<warning>([\s\S]*?)<\/warning>/gi) || []).join(' ');
    if (warn) {
      for (const [cls, re] of WARNING_CLASSES) {
        if (re.test(warn)) add(cls, p, 'self_reported', plain(warn).slice(0, 200));
      }
    }
    const sc = p.scan_quality?.scan_class;
    if (sc === 'bitonal_microfilm' || sc === 'microfiche') {
      add('microfilm', p, 'scan_quality', `scan_class=${sc} score=${p.scan_quality?.score ?? '?'}`);
    }
    if (sc === 'corrupt') add('corrupt_scan', p, 'scan_quality', `scan_class=${sc}`);
    if (/<columns>\s*[2-9]/i.test(t)) add('multi_column', p, 'structural', 'declared <columns> >= 2');
    if (/<table>|\|\s*-{2,}\s*\|/i.test(t)) add('tabular', p, 'structural', 'table markup present');
    if (isDegenerate(t)) add('degenerate_output', p, 'structural', 'type/token ratio < 0.15');
    // Image-bearing page whose only text is labels (#3437).
    if (/<image-desc>|<caption>|<figure>/i.test(t) && plain(t).length < 600) {
      add('image_only_labels', p, 'structural', `${plain(t).length} chars of body text`);
    }
  }
  console.log(`    ${ocrCount.toLocaleString()} of ${pages.length.toLocaleString()} sampled pages carry OCR text`);
  console.log(`    ${blankCount.toLocaleString()} declared blank → routed to blank_page, not to a damage class`);

  // ---------------------------------------------------------------- lane 2
  console.log(`  Lane 2 (proven_miss): ${REV_SAMPLE.toLocaleString()} revisions, with the #3473 shift filter…`);
  const revs = await db.collection('page_revisions').aggregate([
    { $match: { field: 'ocr' } },
    { $sample: { size: REV_SAMPLE } },
    { $project: { page_id: 1, data: 1 } },
  ], { allowDiskUse: true, maxTimeMS: 600000 }).toArray();

  const firstByPage = new Map();
  for (const r of revs) if (!firstByPage.has(r.page_id)) firstByPage.set(r.page_id, r);
  const revIds = [...firstByPage.keys()];
  const pageById = new Map();
  for (let i = 0; i < revIds.length; i += 500) {
    const chunk = await db.collection('pages').find(
      { id: { $in: revIds.slice(i, i + 500) } },
      { projection: { id: 1, book_id: 1, page_number: 1, 'ocr.data': 1, scan_quality: 1,
                      display_photo: 1, archived_photo: 1, photo: 1, photo_original: 1, crop: 1 } }
    ).maxTimeMS(180000).toArray();
    for (const p of chunk) pageById.set(p.id, p);
  }

  let comparable = 0, shiftDropped = 0;
  for (const [pid, rev] of firstByPage) {
    const p = pageById.get(pid);
    const now = p?.ocr?.data;
    if (!now) continue;
    const a = pageNum(rev.data), b = pageNum(now);
    // #3473: both sides must name the SAME printed leaf, or they are not two
    // reads of one image and the disagreement is meaningless.
    if (a !== null && b !== null && a !== b) { shiftDropped++; continue; }
    if (a === null || b === null) continue;   // unverifiable pairing → drop
    comparable++;

    const wOld = words(rev.data), wNew = words(now);
    const oldHasMargin = /<margin>|<gloss>/i.test(rev.data);
    const newHasMargin = /<margin>|<gloss>/i.test(now);
    // A later pass found marginal text an earlier pass missed → proven false
    // negative. This is the ONLY unbiased way to sample the marginalia class.
    if (newHasMargin && !oldHasMargin) {
      add('marginalia_missed', p, 'proven_miss', 'later pass found <margin>/<gloss> the earlier pass did not');
    }
    // One pass stopped early (a column, then nothing) — real truncation.
    const lo = Math.min(wOld.length, wNew.length), hi = Math.max(wOld.length, wNew.length);
    if (hi >= 200 && lo > 0 && lo / hi < 0.55 && !isDegenerate(rev.data) && !isDegenerate(now)) {
      add('truncation', p, 'proven_miss', `${wOld.length} vs ${wNew.length} words on the same leaf`);
    }
    if (isDegenerate(rev.data) !== isDegenerate(now)) {
      add('degenerate_output', p, 'proven_miss', 'one pass degenerated, the other did not');
    }
  }
  console.log(`    ${comparable.toLocaleString()} comparable pairs, ${shiftDropped.toLocaleString()} dropped as page-number shifts (#3473)`);

  // ------------------------------------------------------- book enrichment
  const allBookIds = new Set();
  for (const rows of buckets.values()) for (const r of rows) allBookIds.add(r.book_id);
  const bookById = new Map();
  const bidList = [...allBookIds];
  for (let i = 0; i < bidList.length; i += 500) {
    const chunk = await db.collection('books').find(
      { id: { $in: bidList.slice(i, i + 500) } },
      { projection: { id: 1, slug: 1, title: 1, author: 1, year: 1, published: 1, language: 1, ia_identifier: 1, visible: 1 } }
    ).maxTimeMS(180000).toArray();
    for (const b of chunk) bookById.set(b.id, b);
  }

  // Space-less script is a property of the book, applied after enrichment.
  for (const rows of [...buckets.values()]) {
    for (const r of rows) {
      const b = bookById.get(r.book_id);
      if (b?.language && SPACELESS.test(b.language)) r._spaceless = b.language;
    }
  }
  const spacelessRows = [];
  for (const rows of buckets.values()) for (const r of rows) if (r._spaceless) spacelessRows.push(r);
  if (spacelessRows.length) buckets.set('spaceless_script', spacelessRows.map(r => ({ ...r, _evidence: `language=${r._spaceless}` })));

  // ------------------------------------------------------------- selection
  // Diversify: at most MAX_PER_BOOK exemplars per book, so a class is not one
  // book's quirk. Deduplicate a page that qualified for the same class twice.
  const out = [];
  const summary = [];
  for (const [cls, rows] of [...buckets.entries()].sort()) {
    const perBook = new Map();
    const seen = new Set();
    const picked = [];
    for (const r of rows) {
      if (picked.length >= PER_CLASS) break;
      if (seen.has(r.id)) continue;
      const n = perBook.get(r.book_id) || 0;
      if (n >= MAX_PER_BOOK) continue;
      const b = bookById.get(r.book_id);
      // A book with no slug has no reader URL, so the exemplar cannot be
      // opened and eyeballed — which is the whole point of an exemplar set.
      if (!b || !b.slug) continue;
      seen.add(r.id);
      perBook.set(r.book_id, n + 1);
      picked.push({ r, b });
    }
    summary.push([cls, rows.length, picked.length, new Set(picked.map(x => x.b.id)).size, picked[0]?.r._lane || '-']);
    for (const { r, b } of picked) {
      out.push({
        slug: `${cls}-${b.slug || b.id}-${r.page_number}`,
        book_id: r.book_id,
        page_id: r.id,
        page_number: r.page_number,
        book: {
          title: b.title || null, author: b.author || null, year: b.year ?? null,
          language: b.language || null, ia_identifier: b.ia_identifier || null,
          url: b.slug ? `https://sourcelibrary.org/book/${b.slug}` : null,
        },
        reader_url: b.slug ? `https://sourcelibrary.org/book/${b.slug}/page/${r.id}` : null,
        image: { url: getPageSource(r) || r.archived_photo || r.photo || null },
        difficulty: [cls],
        sourced_by: r._lane,
        evidence: r._evidence,
        // Recorded on every row because the degenerate_output rate is
        // CONFOUNDED with script family: space-less scripts loop ~8x more
        // often than spaced ones on three independent measures. Whether that
        // is a real failure rate or a measurement artefact is unresolved, so
        // the class must be read WITHIN a script family, never pooled.
        script_family: b.language && SPACELESS.test(b.language) ? 'spaceless' : 'spaced',
        scan_quality: r.scan_quality || null,
        selected_at: new Date().toISOString().slice(0, 10),
      });
    }
  }

  // Merge rows for the same page so `difficulty[]` is a real multi-label array
  // rather than one row per class — a page is usually hard for several reasons.
  const byPage = new Map();
  for (const row of out) {
    const k = row.page_id;
    if (!byPage.has(k)) { byPage.set(k, row); continue; }
    const e = byPage.get(k);
    for (const d of row.difficulty) if (!e.difficulty.includes(d)) e.difficulty.push(d);
    if (row.sourced_by === 'proven_miss') { e.sourced_by = 'proven_miss'; e.evidence = row.evidence; }
  }
  const final = [...byPage.values()];

  console.log('\n  class                 candidates  picked  books  lane');
  for (const [cls, cand, pick, nb, lane] of summary) {
    const flag = pick < PER_CLASS ? '  ← under target' : '';
    console.log(`    ${cls.padEnd(20)} ${String(cand).padStart(7)} ${String(pick).padStart(7)} ${String(nb).padStart(6)}  ${lane}${flag}`);
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, final.map(r => JSON.stringify(r)).join('\n') + '\n');
  console.log(`\n  wrote ${final.length} unique pages across ${summary.length} classes → ${OUT}\n`);

  await c.close();
}

// Guarded so the detectors above can be imported and unit-tested without
// kicking off a corpus scan. `calibration-scorecard.mjs` had to COPY a metric
// out of an unguarded script for exactly this reason — don't add a second one.
export { loopCoverage, entityPadRatio, isDegenerate, plain, LOOP_THRESHOLD };

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
}
