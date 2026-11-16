#!/usr/bin/env node
/**
 * #3716 — `books.year` disagrees with a plain-year `books.published` on ~1,070 live books, and the book's own title
 * page (read by the dating run, #6721) sides with `published`. Set `year` to that year.
 *
 * PRIOR ART: scripts/maintenance/fill-published-from-title-page-6056.mjs — the evidence source
 * (source_work_dates_meta.edition with basis title_page/colophon), its exclusion rules (copied below, because that
 * script connects to Mongo at module scope and cannot be imported), and the evidence-leaf check. It writes
 * `published` where `published` is Unknown; this writes `year` where `published` is a plain year the title page
 * confirms. scripts/maintenance/fix-era-year.mjs — the same write (`year` through setCatalogueFields, sweep_log row,
 * catalogue sync picks the change up from `updated_at`) for era-marked dates; it never touches a plain-year pair
 * because catalogYear() lets a stored `year` win.
 *
 * WHY `year` and not `published`. Doctrine (visibility-and-stats.md, #3718): compute with `year`, DISPLAY and CITE
 * `published` (citationYear() in src/lib/publication-date.ts reads only `published`). When `published` is a bare
 * year the two are the same quantity, so a disagreement is one of them being wrong. Which one is NOT uniform:
 * Huygens, Oeuvres complètes Tome 22 has published 1888 (the series' first volume) and year 1950 (correct). So
 * nothing here is decided by a rule over the two fields; only the book's own printed imprint decides, and only
 * when it names `published` and not `year`.
 *
 * PLAN CLASSES (every disagreeing live book gets exactly one; written to the plan file):
 *   write                        title page / colophon prints `published`, the edition window excludes `year`,
 *                                and every exclusion below passes → `year := Number(published)`
 *   review-published-wrong       the title page sides with `year`: `published` is the wrong one. NOT written here —
 *                                `published` is reader-facing and cited; a person decides (listed for that)
 *   no-independent-evidence      the dating run's basis is catalogue / model_knowledge, or there is none: it only
 *                                echoes the record, so it cannot arbitrate
 *   ambiguous                    the edition window holds both years, or neither
 *   year-printed-on-front-leaves the `year` value is also printed on the leaves the dater read
 *   recent-year                  `published` is 1990 or later: in this corpus that is a scan/documentation date
 *                                far more often than an imprint, so a person decides
 *   call-number                  the quote is a library shelfmark ("BT 301 .R38 1860"), not an imprint
 *   <exclusion reason>           as fill-published-from-title-page-6056.mjs, plus `year-human-edited` and
 *                                `year-printed-in-evidence` (the quote also prints the `year` value)
 *
 * Writes, per `write` row: one sweep_log row (sweep `year-from-title-page-3716`, BEFORE the book write), then
 * setCatalogueFields(year) — value, field_provenance.year stamp with the value it replaced, history entry, and an
 * `updated_at` bump so sync-books-catalog carries it to books_catalog. Then revalidates /book/<id>: the page
 * emits `DC.date` from `year` (assertableYear). Downstream copy to re-run after an apply: locus_books
 * (scripts/locus/extract-locus-anchors.mjs).
 *
 * Usage (node --env-file=/root/sourcelibrary/.env.production.local …):
 *   align-year-to-title-page-3716.mjs                 dry run: plan file + diff file, nothing written
 *   align-year-to-title-page-3716.mjs --apply         write the `write` rows (re-checks each row at write time)
 *   align-year-to-title-page-3716.mjs --revert        dry run of putting back every `from` the sweep_log holds
 *   align-year-to-title-page-3716.mjs --revert --apply
 *   --out DIR   where the plan/diff go (default $JOB_SCRATCH or /tmp)
 */
import { MongoClient } from 'mongodb';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { recordSweepAction } from '../lib/sweep-log.mjs';
import { setCatalogueFields } from '../lib/catalogue-fields.mjs';
import { findImprint, loose, DESCRIBING, LABEL } from '../lib/date-works.mjs';
import { stripEditorialWrappers } from '../lib/strip-editorial-wrappers.mjs';
import { stripMarkupTags } from '../lib/strip-markup-tags.mjs';

const SWEEP = 'year-from-title-page-3716';
const SCRIPT = 'scripts/maintenance/align-year-to-title-page-3716.mjs';
const METHOD = 'title-page imprint via dating run #6721 confirms plain-year `published`';
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const REVERT = args.includes('--revert');
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const OUT = opt('out', process.env.JOB_SCRATCH || '/tmp');

// Copied from fill-published-from-title-page-6056.mjs (see PRIOR ART).
const LIFE_DATE = /\b(?:aetat\w*|florvit|floruit|natus|obiit|denatus)\b/i;
const CJK = /[぀-ヿ㐀-䶿一-鿿豈-﫿가-힯]/u;
const ERA = /\b(samvat|sa[mṃ]vat|[sś]ak[ae]|shaka|hijr\w*|a\.\s?h\.|kangxi|yongzheng|qianlong|jiaqing|daoguang|xianfeng|tongzhi|guangxu|xuantong|meiji|taish[oō]|sh[oō]wa|kaei|ansei|bunsei|tenp[oō]|kyōhō|rabjung|regni)\b|संवत|शक|शके|ई०|हिजरी|هجر|سنة|ཟླ|ལོ་/iu;
const HAND = /hand(?:written|schrift\w*)?\b|by hand|pencil|manuscript note|\bms\.|\bvid\. in fine|inscri(?:bed|ption)/i;
const RELEASE = /release date|posting date|e-?text|vervaardigd|copied by|abgeschrieben/i;
const HUMAN_SOURCE = /admin|editor|manual|human|by[-_ ]?hand|curator|platform|derek|user/i;
const PLAIN_YEAR = /^\d{4}$/;
// Shapes the 6056 rules miss, found in this run's by-eye draws: a library call number read as an imprint
// ("BT 301 .R38 1860", "BS 2940 .T5 H5813 1885", "c R 126 G2 1821 t. 14") and a sentence about the scan
// ("The bleed-through", "Table of Contents Column", a "SEEN BY PRESERVATION" stamp).
const CALL_NUMBER = /\s\.[A-Z]\d{1,4}\b|\b[A-Z]{1,2}\s?\d{2,4}\s+[A-Z]\d{1,3}\b|\b[A-Z]{1,2}\d{2,4}\b/;
const SCAN_NOTE = /bleed|table of contents|\bcolumn\b|preservation|\bstamp|title page|assigned date|date range|said to have been/i;
// By-eye reading of every `write` row on 2026-11-12 (#3716): quotes no rule above catches, where the year is a
// date the text mentions, not this volume's imprint. Kept as data so the reason travels with the plan.
const EYE_EXCLUDED = new Map([
  ['69b3f75c2634d3a89f921c90', 'a year cited mid-sentence ("ob artem Cabalisticam, a. 1490")'],
  ['6993797ab0a84a5763964ff1', 'a quoted article\'s date ("Pädagogische Reform, 18. Dezember 1901")'],
]);
const eyeExcluded = (id) => (EYE_EXCLUDED.has(id) ? id : null);
// Read off the front leaves by eye for #3716 where the dating run only echoed the catalogue. The Bekker
// Aristotle vol. II is the issue's own repro and the reference frame for /api/locus: its `year` 1890 is the
// shelfmark "PB 1890" on p6, the imprint on the same leaf is MDCCCXXXI.
const EYE_CONFIRMED = new Map([
  ['69937973b0a84a5763964d43', { page: 6, quote: 'BEROLINI APUD GEORGIUM REIMERUM A. 1831 / MDCCCXXXI (p5–p6; "PB 1890" on p6 is a shelfmark)' }],
]);

/** Whether any line of `text` prints `year` (Arabic or Roman figures, findImprint's rules applied line by line). */
export const printsYear = (text, year) => String(text || '').split('\n').some((line) => findImprint(line, year));

/** Plan class for one disagreeing book. Pure. */
export function classify(b) {
  const P = Number(b.published), Y = b.year;
  const ed = b.source_work_dates_meta?.edition;
  const eye = eyeExcluded(String(b.id));
  if (eye) return { cls: 'eye-excluded', why: EYE_EXCLUDED.get(eye) };
  const seen = EYE_CONFIRMED.get(String(b.id));
  if (seen) return { cls: 'write', value: P, page: seen.page, eye_quote: seen.quote };
  if (!ed || typeof ed.year !== 'number' || !['title_page', 'colophon'].includes(ed.basis)) return { cls: 'no-independent-evidence' };
  const lo = typeof ed.from === 'number' ? ed.from : ed.year, hi = typeof ed.to === 'number' ? ed.to : ed.year;
  const inW = (v) => v >= lo && v <= hi;
  if (inW(Y) && !inW(P)) return { cls: 'review-published-wrong' };
  if (inW(P) === inW(Y)) return { cls: 'ambiguous' };
  const stamps = [b.field_provenance?.year, ...(b.field_provenance_history?.year || [])].filter(Boolean);
  if (stamps.some((s) => s.edited_by || s.user || HUMAN_SOURCE.test(`${s.source || ''} ${s.method || ''}`))) return { cls: 'year-human-edited' };
  const ev = String(ed.evidence || '');
  if (!ev) return { cls: 'no-evidence-quote' };
  if (LIFE_DATE.test(ev)) return { cls: 'portrait-or-life-date' };
  if (CJK.test(ev)) return { cls: 'cjk-script' };
  if (ERA.test(ev) || ERA.test(String(ed.display || ''))) return { cls: 'era-formula' };
  if (HAND.test(ev)) return { cls: 'hand-note' };
  if (RELEASE.test(ev)) return { cls: 'release-or-copy-date' };
  if (ed.from_book) return { cls: 'other-volume' };
  if (P >= 1990) return { cls: 'recent-year' }; // a scan or documentation date ("… Das (HPD) on 12 June 2014.")
  if (CALL_NUMBER.test(ev)) return { cls: 'call-number' };
  if (SCAN_NOTE.test(ev)) return { cls: 'label-or-describing' };
  if (findImprint(ev, Y)) return { cls: 'year-printed-in-evidence' };
  const others = [...ev.matchAll(/(?<!\d)(1[4-9]\d\d|20[0-3]\d)(?!\d)/g)].map((m) => +m[1]).filter((y) => !inW(y));
  if (others.length) return { cls: 'other-year-in-evidence' };
  if (!findImprint(ev, P)) return { cls: 'year-not-printed' };
  if (!ed.rule && (DESCRIBING.test(ev) || LABEL.test(ev))) return { cls: 'label-or-describing' };
  return { cls: 'write', value: P };
}

const mc = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
await mc.connect();
const db = mc.db('bookstore');
const books = db.collection('books');

if (REVERT) {
  const rows = await db.collection('sweep_log').find({ sweep: SWEEP, action: 'year-from-title-page' }).toArray();
  let n = 0, moved = 0;
  for (const r of rows) {
    const { from, to } = r.detail || {};
    const b = await books.findOne({ id: r.book_id }, { projection: { year: 1 } });
    if (!b || b.year !== to) { moved++; continue; } // edited since: leave it
    n++;
    if (!APPLY) continue;
    await recordSweepAction(db, { sweep: SWEEP, book_id: r.book_id, action: 'year-reverted', detail: { from: to, to: from, issue: 3716 } });
    await setCatalogueFields(db, r.book_id, { year: from }, { source: 'revert', script: SCRIPT, run: SWEEP, method: `revert of ${SWEEP}` });
  }
  console.log(APPLY ? `reverted ${n} of ${rows.length}` : `would revert ${n} of ${rows.length} (add --apply)`, `· ${moved} changed since, left alone`);
  await mc.close(); process.exit(0);
}

// ── plan ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const live = await books.find({ visible: true, pages_count: { $gt: 0 }, published: { $regex: /^\d{4}$/ }, year: { $type: 'number', $gt: 0 } }, {
  projection: { _id: 0, id: 1, title: 1, published: 1, year: 1, pages_count: 1, field_provenance: 1, field_provenance_history: 1,
    'source_work_dates_meta.edition': 1, 'source_work_dates_meta.run_id': 1 },
}).toArray();
const dis = live.filter((b) => PLAIN_YEAR.test(b.published) && Number(b.published) !== b.year);
console.log(`live plain-year pairs: ${live.length} · disagree: ${dis.length}`);

const plan = dis.map((b) => ({ id: b.id, title: String(b.title || '').slice(0, 100), published: b.published, year: b.year,
  year_source: b.field_provenance?.year?.source ?? null, edition: b.source_work_dates_meta?.edition ?? null,
  dating_run: b.source_work_dates_meta?.run_id ?? null, pages_count: b.pages_count, ...classify(b) }));

// The quote must be on a leaf the dater read (pages ≤ 12 for a title page, the last four for a colophon), so every
// write cites a page a person can open.
const toFind = plan.filter((p) => p.cls === 'write' && !p.eye_quote);
for (let i = 0; i < toFind.length; i += 150) {
  const chunk = toFind.slice(i, i + 150);
  const rows = await db.collection('pages').find({
    $or: chunk.map((p) => (p.edition.basis === 'colophon' ? { book_id: p.id, page_number: { $gt: p.pages_count - 4 } } : { book_id: p.id, page_number: { $lte: 12 } })),
    'ocr.data': { $type: 'string', $ne: '' },
  }, { projection: { _id: 0, book_id: 1, page_number: 1, text: { $substrCP: ['$ocr.data', 0, 2400] } }, maxTimeMS: 120_000 }).toArray();
  const by = new Map();
  for (const r of rows) by.set(r.book_id, [...(by.get(r.book_id) || []), r]);
  for (const p of chunk) {
    const want = loose(p.edition.evidence);
    const hit = (by.get(p.id) || []).sort((a, b) => a.page_number - b.page_number)
      .find((r) => loose(stripMarkupTags(stripEditorialWrappers(r.text || '') || '', ' ')).includes(want));
    if (!hit) { p.cls = 'evidence-page-not-found'; delete p.value; continue; }
    p.page = hit.page_number;
    if (!(p.page > 0)) { p.cls = 'evidence-page-not-found'; delete p.value; continue; } // a negative page_number cites nothing
    // The competing value printed anywhere on the same leaves means the leaves carry two dates (an edition that
    // reprints its source's date, "В ЛѢТО 1762" inside a 1914 printing): the quote alone cannot pick one.
    const other = (by.get(p.id) || []).find((r) => printsYear(stripMarkupTags(stripEditorialWrappers(r.text || '') || '', ' '), p.year));
    if (other) { p.cls = 'year-printed-on-front-leaves'; p.other_page = other.page_number; delete p.value; }
  }
}

const counts = {};
for (const p of plan) counts[p.cls] = (counts[p.cls] || 0) + 1;
mkdirSync(OUT, { recursive: true });
const PLAN = join(OUT, 'year-from-title-page-3716-plan.jsonl');
const DIFF = join(OUT, 'year-from-title-page-3716-diff.tsv');
writeFileSync(PLAN, plan.map((p) => JSON.stringify(p)).join('\n') + '\n');
const ready = plan.filter((p) => p.cls === 'write');
writeFileSync(DIFF, ['id\tfield\tbefore\tafter\tpage\tevidence\ttitle',
  ...ready.map((p) => [p.id, 'year', p.year, p.value, p.page, String(p.eye_quote || p.edition.evidence).replace(/\s+/g, ' '), p.title].join('\t'))].join('\n') + '\n');
for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(5)}  ${k}`);
console.log(`plan → ${PLAN}\ndiff → ${DIFF} (${ready.length} rows)`);

if (!APPLY) { console.log('\n-- dry run (nothing written) --'); await mc.close(); process.exit(0); }

// ── apply ────────────────────────────────────────────────────────────────────────────────────────────────────────
let wrote = 0;
const skipped = [], written = [];
for (const p of ready) {
  const cur = await books.findOne({ id: p.id }, { projection: { published: 1, year: 1 } });
  if (!cur || cur.published !== p.published || cur.year !== p.year) { skipped.push([p.id, `changed since plan: ${JSON.stringify(cur)}`]); continue; }
  const evidence = p.eye_quote
    ? { quote: p.eye_quote, page_number: p.page, basis: 'title_page_by_eye', issue: 3716, published: p.published }
    : { quote: p.edition.evidence, page_number: p.page, basis: p.edition.basis, dating_run: p.dating_run, published: p.published };
  await recordSweepAction(db, { sweep: SWEEP, book_id: p.id, action: 'year-from-title-page', detail: { from: p.year, to: p.value, page_number: p.page, evidence: evidence.quote, issue: 3716 } });
  try {
    const r = await setCatalogueFields(db, p.id, { year: p.value }, { source: 'title_page_imprint', script: SCRIPT, run: SWEEP, method: METHOD, evidence });
    if (r.modified) { wrote++; written.push(p.id); } else skipped.push([p.id, 'nothing to change']);
  } catch (e) { skipped.push([p.id, e.message]); }
}
console.log(`\n-- applied --\n  written: ${wrote} · skipped: ${skipped.length}`);
for (const [id, why] of skipped) console.log(`      ${id}  ${why}`);
async function revalidate(id) {
  if (!process.env.CRON_SECRET) return false;
  const r = await fetch(`https://sourcelibrary.org/api/admin/revalidate-book/${id}`, {
    method: 'POST', headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` }, signal: AbortSignal.timeout(60000),
  }).catch(() => null);
  return !!r?.ok;
}
let ok = 0;
for (let i = 0; i < written.length; i += 8) ok += (await Promise.all(written.slice(i, i + 8).map(revalidate))).filter(Boolean).length;
console.log(`  revalidated: ${ok} of ${written.length}`);
await mc.close();
