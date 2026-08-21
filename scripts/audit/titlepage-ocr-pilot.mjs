#!/usr/bin/env node
/**
 * PILOT: attribute books from the OCR'd TITLE PAGE, not the catalogue title.
 *
 * `title-page-attribution.mjs` reads `books.title` — a transcription of the
 * title page, which is why it works at all. But the transcription is whatever
 * the source catalogue chose to record: often truncated, sometimes just a short
 * form, and for the ~4,800 books that reach no author page it is frequently the
 * least informative field on the record.
 *
 * We hold the actual page. Every book in the held-verdict queue (#3951 A) has
 * page images AND OCR, and so does most of the corpus. Reading the title page is
 * GROUNDED evidence — the book's own claim about itself — where asking a model
 * "who wrote this 1610 fair catalogue" is recall, which is exactly the class
 * that produced 24 unresolvable verdicts.
 *
 * WHAT THIS MEASURES, and why it is built control-first. The question is not
 * "can it find names" — it is "when it finds one, is it right". So the pilot
 * runs on two populations:
 *
 *   CONTROL  books already at T4: linked and authority-anchored. We know the
 *            answer, so agreement rate IS precision. A pass that cannot
 *            reproduce known-good attributions must not be pointed at unknown
 *            ones. (A probe with no positive control reports nothing.)
 *   TARGET   books at T0/T2: absent or unlinked byline. Here the same extractor
 *            reports YIELD — how many gain a candidate at all.
 *
 * Cost: ZERO model calls. Everything is the existing grammar-based extractor.
 * If yield is poor this is the moment to decide whether a model pass is worth
 * paying for, with a real denominator instead of a guess.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * RESULT, 2026-08-13: NEGATIVE. Do not scale this. Do not re-run the experiment.
 *
 *   run          control n   fired   agreed   target n   yield
 *   first            120        4       3        120      3.3%
 *   + preprocessing  120        6       4        120      1.7%
 *
 * 110 of 120 title pages produce NO name. The precision figures (75%, 66.7%)
 * are on 4 and 6 rows — noise, and quoting them as precision would be a lie.
 * The measurement that matters is that the extractor fires on ~5% of pages.
 *
 * The second run fixed three real bugs and moved nothing: container tags carry
 * attributes so `<image-desc size=…>` leaked its prose; title pages hyphenate
 * across line breaks ("GVER- RA DI NICOLO MACHIAVEL-"); and every rule is
 * case-shaped, so solid caps like "PONTANI" could never match a genitive ending.
 * All three were genuine and fixing them was not enough, which is the useful
 * part of the finding.
 *
 * WHY IT FAILS, and it is not the concept. This extractor was built for
 * `books.title` — short, mixed-case, well-formed, already edited by a
 * cataloguer — and it is good there (112 usable rows in #3894). A title page is
 * none of those things: it is long, ornamented, set in capitals, and it is FULL
 * of names in author-shaped positions that are not the author. Every disagreement
 * here is that: `auctore` captured "Consiliario Aulico Hassiaco" (Wolff's OFFICE,
 * not his name), `di` captured "Papa Leone" (a dedicatee) and "Illustriss.
 * Signoria di Vinegia" (a state). A regex cannot tell an office from a person
 * standing in the same grammatical slot.
 *
 * WHAT TO DO INSTEAD: this is a reading task, so pay a model to read. Hand it
 * the title-page text and require a ROLE and a QUOTED LINE for every name, so
 * each proposal carries its own evidence and the office/dedicatee confusion is
 * checkable rather than silent. Keep this file's control-first shape — the value
 * of the pilot was the control, not the extractor. Budget from the real
 * denominator: ~4,800 target books, roughly $1–3 on flash-lite or ~$15 on
 * flash-preview.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Read-only. Writes nothing, proposes nothing.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/audit/titlepage-ocr-pilot.mjs
 *   node --env-file=.env.production.local scripts/audit/titlepage-ocr-pilot.mjs --n=500 --json
 */
import { MongoClient } from 'mongodb';
import { namesOnTitlePage } from '../lib/title-page-attribution.mjs';
import { sameNameForm, foldOrtho } from '../lib/name-equivalence.mjs';

const JSON_OUT = process.argv.includes('--json');
const N = Number((process.argv.find((a) => a.startsWith('--n=')) || '').split('=')[1] || 300);
const log = (...a) => { if (!JSON_OUT) console.log(...a); };

/**
 * Strip the OCR scaffolding. Pages carry `<language>`, `<page-type>`,
 * `<warning>`, `<meta>`, `<image-desc>` and markdown headings; none of that is
 * title-page prose and the genitive-head rule anchors at ^, so leaving it in
 * guarantees a miss on the commonest author position there is.
 */
function pageProse(raw) {
  return String(raw ?? '')
    // Container tags CARRY ATTRIBUTES (`<image-desc size="large" type=...>`), so
    // matching a bare `<image-desc>` leaves the whole description in the prose —
    // which is how "Small printer's ornament" was proposed as an author.
    .replace(/<(warning|meta|image-desc|insert|note|margin|vocab|figure)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    // Line-break hyphenation is universal on early-modern title pages and it
    // shatters exactly the word that matters: "GVER- RA DI NICOLO MACHIAVEL-".
    // Join before any whitespace collapse, or the newline is already gone.
    .replace(/([A-Za-zÀ-ÿ])[-‐‑—]\s*\n\s*([A-Za-zÀ-ÿ])/g, '$1$2')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^#+\s*/gm, ' ')
    .replace(/[*_`>]+/g, ' ')
    .replace(/->|<-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Title pages are SET IN CAPITALS, and every rule in the extractor is
 * case-shaped: `GENITIVE_HEAD` carries no `i` flag, so its endings (`i`, `is`,
 * `ae`, `orum`) cannot match `PONTANI`, and `NAME` expects `[A-Z][\w]*` runs
 * rather than solid caps. On a catalogue title — mixed case by convention — this
 * is invisible. On page text it scores a HARD ZERO, which is most of what the
 * first pilot run measured.
 *
 * Normalising here rather than loosening the shared lib: those rules are tuned
 * against 92 known same-person pairs and a case-insensitive flag would widen
 * every one of them at once, on a surface this pilot does not own.
 */
function softenCaps(s) {
  return String(s).replace(/\b[A-ZÀ-Ý][A-ZÀ-Ý'’À-Þ]{2,}\b/g, (w) =>
    w[0] + w.slice(1).toLowerCase());
}

const pageType = (raw) => (String(raw ?? '').match(/<page-type>\s*([^<]+)/i) || [])[1]?.trim().toLowerCase() || null;

/**
 * Find the title page. It is NOT page 1: the opening images are covers,
 * bindings, flyleaves and blanks — measured on the #3951 queue, most opening
 * pages carry `<page-type>blank</page-type>`. Walk forward and take the first
 * page the OCR itself calls a title page; failing that, the first page with
 * enough prose to carry a name.
 */
const TITLE_TYPES = new Set(['title-page', 'titlepage', 'title page', 'half-title']);
function pickTitlePage(pages) {
  const byNum = [...pages].sort((a, b) => (a.page_number ?? 0) - (b.page_number ?? 0));
  for (const p of byNum) {
    const raw = p.ocr?.data ?? p.ocr?.text ?? '';
    if (TITLE_TYPES.has(pageType(raw))) return { page: p, prose: softenCaps(pageProse(raw)), via: "page-type" };
  }
  for (const p of byNum) {
    const raw = p.ocr?.data ?? p.ocr?.text ?? '';
    const t = pageType(raw);
    if (t === 'blank' || t === 'illustration' || t === 'frontispiece') continue;
    const prose = pageProse(raw);
    if (prose.length >= 40) return { page: p, prose: softenCaps(prose), via: "first-prose" };
  }
  return null;
}

const mc = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
await mc.connect();
const db = mc.db('bookstore');
const books = db.collection('books');
const pages = db.collection('pages');
const authorsCol = db.collection('authors');

const TEXT_VISIBLE = { visible: true, resource_type: { $exists: false }, pages_ocr: { $gt: 0 } };

/** Books whose byline is already anchored — we know the answer here. */
async function controlSample(n) {
  const anchored = await authorsCol.find(
    { $or: [{ viaf_id: { $nin: [null, ''] } }, { wikidata_id: { $nin: [null, ''] } }] },
    { projection: { _id: 1, canonical_name: 1, variants: 1 } },
  ).toArray();
  const byId = new Map(anchored.map((a) => [a._id, a]));
  return {
    byId,
    rows: await books.aggregate([
      { $match: { ...TEXT_VISIBLE, author_id: { $in: [...byId.keys()] }, author: { $type: 'string', $ne: '' } } },
      { $sample: { size: n } },
      { $project: { id: 1, title: 1, author: 1, author_id: 1 } },
    ]).toArray(),
  };
}

/** Books that reach no author page: no byline, or a byline with no link. */
async function targetSample(n) {
  return books.aggregate([
    { $match: { ...TEXT_VISIBLE, $or: [{ author_id: { $in: [null] } }, { author_id: { $exists: false } }] } },
    { $sample: { size: n } },
    { $project: { id: 1, title: 1, author: 1 } },
  ]).toArray();
}

async function titlePageOf(book) {
  const key = book.id ?? book._id?.toString();
  const ps = await pages.find(
    { book_id: key, page_number: { $gte: 1, $lte: 14 } },
    { projection: { page_number: 1, 'ocr.data': 1, 'ocr.text': 1 } },
  ).toArray();
  if (!ps.length) return null;
  return pickTitlePage(ps);
}

/** Does an extracted name agree with the byline we already trust? */
function agrees(extracted, knownName, knownDoc) {
  if (sameNameForm(extracted, knownName)) return true;
  for (const v of knownDoc?.variants ?? []) if (sameNameForm(extracted, v)) return true;
  // A genitive-head capture is a DECLINED form ("Nicolai Clenardi"); compare on
  // stems so "Clenardi" still matches "Clenardus".
  const a = foldOrtho(extracted).split(' ');
  const b = foldOrtho(knownName).split(' ');
  return a.some((x) => x.length >= 5 && b.some((y) => y.length >= 5 && (x.startsWith(y.slice(0, 5)) || y.startsWith(x.slice(0, 5)))));
}

// ── CONTROL ───────────────────────────────────────────────────────────────────
log(`══ title-page attribution from OCR — pilot (n=${N} per population) ══\n`);
log('Running CONTROL first: books already anchored, where the answer is known.\n');

const { byId, rows: control } = await controlSample(N);
let cNoPages = 0, cNoTitlePage = 0, cNoName = 0, cAgree = 0, cDisagree = 0, cEditorOnly = 0;
const disagreements = [];
for (const b of control) {
  const tp = await titlePageOf(b);
  if (!tp) { cNoPages++; continue; }
  const names = namesOnTitlePage(tp.prose);
  if (!names.length) { cNoName++; continue; }
  const authorNames = names.filter((x) => x.role === 'author');
  if (!authorNames.length) { cEditorOnly++; continue; }
  const known = byId.get(b.author_id);
  const hit = authorNames.find((x) => agrees(x.name, b.author, known));
  if (hit) cAgree++;
  else {
    cDisagree++;
    if (disagreements.length < 14) {
      disagreements.push({ id: b.id, title: String(b.title).slice(0, 52), known: b.author, found: authorNames.map((x) => `${x.name}[${x.marker}]`).join(', '), via: tp.via });
    }
  }
}
const cJudged = cAgree + cDisagree;

// ── TARGET ────────────────────────────────────────────────────────────────────
log('Running TARGET: books that currently reach no author page.\n');
const target = await targetSample(N);
let tNoPages = 0, tNoName = 0, tEditorOnly = 0, tFound = 0;
const finds = [];
for (const b of target) {
  const tp = await titlePageOf(b);
  if (!tp) { tNoPages++; continue; }
  const names = namesOnTitlePage(tp.prose);
  const authorNames = names.filter((x) => x.role === 'author');
  if (!names.length) { tNoName++; continue; }
  if (!authorNames.length) { tEditorOnly++; continue; }
  tFound++;
  if (finds.length < 16) finds.push({ id: b.id, title: String(b.title).slice(0, 46), cur: b.author ?? '(none)', found: authorNames[0].name, marker: authorNames[0].marker, via: tp.via });
}

const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(1)}%` : 'n/a');
const result = {
  n: N,
  control: { sampled: control.length, no_pages: cNoPages, no_title_page: cNoTitlePage, no_name_found: cNoName, editor_only: cEditorOnly, agree: cAgree, disagree: cDisagree, precision_pct: cJudged ? Number(((100 * cAgree) / cJudged).toFixed(1)) : null },
  target: { sampled: target.length, no_pages: tNoPages, no_name_found: tNoName, editor_only: tEditorOnly, candidate_found: tFound, yield_pct: target.length ? Number(((100 * tFound) / target.length).toFixed(1)) : null },
};

if (JSON_OUT) console.log(JSON.stringify({ ...result, disagreements, finds }, null, 2));
else {
  log('══ CONTROL — books whose author we already know ══');
  log(`  sampled                 : ${control.length}`);
  log(`  no OCR'd pages found    : ${cNoPages}`);
  log(`  title page, no name     : ${cNoName}`);
  log(`  editor-role names only  : ${cEditorOnly}   (correctly NOT proposed)`);
  log(`  author-role name found  : ${cJudged}`);
  log(`     agrees with known    : ${cAgree}   ← PRECISION ${pct(cAgree, cJudged)}`);
  log(`     disagrees            : ${cDisagree}`);
  if (disagreements.length) {
    log('\n  disagreement sample (read these — some are the extractor, some are the CATALOGUE being wrong):');
    for (const d of disagreements) {
      log(`    ${d.title}`);
      log(`       catalogued: ${d.known}`);
      log(`       title page: ${d.found}   (${d.via})`);
    }
  }
  log('\n══ TARGET — books that reach no author page ══');
  log(`  sampled                 : ${target.length}`);
  log(`  no OCR'd pages found    : ${tNoPages}`);
  log(`  title page, no name     : ${tNoName}`);
  log(`  editor-role only        : ${tEditorOnly}`);
  log(`  CANDIDATE FOUND         : ${tFound}   ← YIELD ${pct(tFound, target.length)}`);
  if (finds.length) {
    log('\n  candidate sample:');
    for (const f of finds) log(`    ${String(f.cur).slice(0, 20).padEnd(20)} → ${f.found.padEnd(28)} ${f.title}`);
  }
  log('\n  Precision is the number that decides this. Yield only says how much work');
  log('  there is; precision says whether doing it makes the corpus better.');
}

await mc.close();
