#!/usr/bin/env node
/**
 * PRIOR ART: scripts/batch/realtime-ocr.mjs (THE caller — it reads the pages, snapshots the
 * Archive text to page_revisions and writes `ocr.source: 'ai'`; this script only decides WHICH
 * pages and records what happened); scripts/maintenance/apply-reocr-verdicts.mjs (applies a
 * model re-read from text files under an adjudication — no adjudication here, the model reading
 * always wins over the Archive's); scripts/maintenance/repair-ia-ocr-leaf-offset.mjs (repairs
 * the leaf MAPPING of the same lane, never the reading); scripts/lib/title-page-ocr.mjs (finds
 * the title page in existing OCR — the identification this pass gets as a by-product).
 *
 * reocr-ia-frontmatter — re-read the Archive-filled front matter with our own model (#4815).
 *
 * WHY. The free OCR lane (#4780/#4790) fills untranscribed pages of Internet Archive books
 * with the Archive's own OCR when it agrees with a Gemini sample. The sample was deliberately
 * taken from the INTERIOR (front matter is unrepresentative for calibration), so on 191 books
 * the first 25 leaves — the title page, the verso with the imprint and any copyright line, the
 * contents, the list of plates — carry no model reading at all. Those are exactly the pages a
 * classical engine reads worst (display type, ornament, blackletter, library marks: hand-read,
 * *De Dea Syria* became "De Dea Syrian" and *Bushman Folk-Lore* "Bushman Foli-Loee") and
 * exactly the pages the catalogue derives from. No title-page classifier is built: our OCR
 * emits <page-type>, so identification falls out of reading the whole front matter.
 *
 * THREE STEPS, each idempotent:
 *
 *   --plan    lane books (book_events `ia_ocr_ingest` with pages_written > 0) minus the books
 *             held out of every lane (pipeline_auto.hold, #4790) → their pages with
 *             page_number ≤ --leaves (25) and ocr.source 'ia_djvu' → a page-ids file for
 *             realtime-ocr.mjs. A page already re-read is no longer 'ia_djvu' and drops out.
 *
 *             node scripts/batch/realtime-ocr.mjs --page-ids-file=<out>/pages.json --model=lite \
 *               --reason="#4815 front matter" --concurrency=20 --limit=4000
 *
 *   --record  after the run: for every planned page find the page_revisions row realtime-ocr
 *             wrote (source 'ia_djvu', reason 'reocr_realtime') and the gemini_usage skip rows
 *             (refusals); one sweep_log row per book, one book_events row per book (type
 *             `ia_frontmatter_reocr`, keyed on run id — a second --record writes nothing).
 *
 *   --report  the number #4815 asks for: for every page the model tagged title-page, diff the
 *             Archive text (page_revisions) against the model text and count books whose title,
 *             author, imprint or year differ; plus the counts the downstream consumers need —
 *             pages tagged toc (#4816, list-of-illustrations parse) and books with a readable
 *             copyright verso (rights screen, #4809). Writes JSON + a markdown summary.
 *
 * Reads `pages` by book_id + page_number (indexed) and filters ocr.source in memory — never a
 * corpus scan on ocr.* . Nothing here calls Gemini. Dry by default; --record needs --apply.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/reocr-ia-frontmatter.mjs --plan   --out /root/frontmatter-4815
 *   node scripts/maintenance/reocr-ia-frontmatter.mjs --record --out /root/frontmatter-4815 --run-id <jobs.id> [--apply]
 *   node scripts/maintenance/reocr-ia-frontmatter.mjs --report --out /root/frontmatter-4815
 */
import fs from 'node:fs';
import path from 'node:path';
import { withMongo } from '../lib/mongo.mjs';
import { recordSweepAction } from '../lib/sweep-log.mjs';
import { pageProse } from '../lib/title-page-ocr.mjs';
import { extractPageType } from '../lib/ocr-result-parse.mjs';

const ARG = (n, d) => process.argv.find((a) => a.startsWith(`${n}=`))?.split('=').slice(1).join('=') ?? d;
const FLAG = (n) => process.argv.includes(n);
const OUT = ARG('--out', 'scripts/output/frontmatter-4815');
const LEAVES = parseInt(ARG('--leaves', '25'), 10);
const RUN_ID = ARG('--run-id', null);
/** --plan: leave out pages a run since this time already tried and recorded a skip on (a restart must not re-pay refusals). */
const SKIP_ATTEMPTED_SINCE = ARG('--skip-attempted-since', null) ? new Date(ARG('--skip-attempted-since')) : null;
const APPLY = FLAG('--apply');
const SWEEP = 'ia-frontmatter-reocr-2026-09';
const EVENT = 'ia_frontmatter_reocr';
const REVISION_REASON = 'reocr_realtime';
const ISSUE = 4815;
/** The digitizer insert the model tags `title-page` (Cornell's leaf) — same test realtime-ocr.mjs now applies at write time. */
const DIGITIZER_INSERT = /the original of this book is in the .{0,60}library|no known copyright restrictions|digitized by the internet archive in \d{4}|this is a digital copy of a book/i;
const isInsert = (text) => DIGITIZER_INSERT.test(String(text || '').replace(/<meta>[\s\S]*?<\/meta>/g, ''));
const FOUR_HOURS = 4 * 60 * 60 * 1000;

fs.mkdirSync(OUT, { recursive: true });
const outPath = (f) => path.join(OUT, f);
const readJson = (f) => JSON.parse(fs.readFileSync(outPath(f), 'utf8'));
const writeJson = (f, v) => fs.writeFileSync(outPath(f), JSON.stringify(v, null, 1));

/** The lane: every book the ingester wrote pages into, minus the held ones. */
async function laneBooks(db) {
  const ev = await db.collection('book_events').find({ type: 'ia_ocr_ingest', 'details.pages_written': { $gt: 0 } }, { projection: { book_id: 1 } }).toArray();
  const ids = [...new Set(ev.map((e) => e.book_id))];
  const books = await db.collection('books').find({ id: { $in: ids } }, { projection: { _id: 0, id: 1, title: 1, author: 1, published: 1, pages_count: 1, ia_identifier: 1, 'pipeline_auto.status': 1, 'pipeline_auto.hold': 1 } }).toArray();
  return { lane: books, held: books.filter((b) => b.pipeline_auto?.hold), live: books.filter((b) => !b.pipeline_auto?.hold) };
}

async function frontMatterPages(db, bookIds, projection) {
  return db.collection('pages').find({ book_id: { $in: bookIds }, page_number: { $lte: LEAVES } }, { projection: { _id: 0, id: 1, book_id: 1, page_number: 1, ...projection } }).toArray();
}

async function plan(db) {
  const { lane, held, live } = await laneBooks(db);
  const pages = await frontMatterPages(db, live.map((b) => b.id), { 'ocr.source': 1, 'ocr.recitation_blocked': 1, 'ocr.fail_blocked': 1, 'ocr.last_skip.at': 1 });
  const target = pages.filter((p) => p.ocr?.source === 'ia_djvu');
  const blocked = target.filter((p) => p.ocr?.recitation_blocked || p.ocr?.fail_blocked);
  const attempted = SKIP_ATTEMPTED_SINCE ? target.filter((p) => p.ocr?.last_skip?.at && p.ocr.last_skip.at >= SKIP_ATTEMPTED_SINCE) : [];
  const attemptedIds = new Set(attempted.map((p) => p.id));
  const todo = target.filter((p) => !(p.ocr?.recitation_blocked || p.ocr?.fail_blocked) && !attemptedIds.has(p.id));
  const perBook = new Map();
  for (const p of todo) perBook.set(p.book_id, (perBook.get(p.book_id) || 0) + 1);
  const heldPages = held.length ? (await frontMatterPages(db, held.map((b) => b.id), { 'ocr.source': 1 })).filter((p) => p.ocr?.source === 'ia_djvu').length : 0;
  writeJson('pages.json', { issue: ISSUE, leaves: LEAVES, planned_at: new Date().toISOString(), pages: todo.map((p) => ({ page_id: p.id, book_id: p.book_id, page_number: p.page_number })) });
  writeJson('books.json', live.filter((b) => perBook.has(b.id)).map((b) => ({ ...b, planned_pages: perBook.get(b.id) })));
  writeJson('held-books.json', held.map((b) => b.id));
  console.log(`lane books ${lane.length} (held ${held.length}, live ${live.length})`);
  console.log(`front matter (page_number ≤ ${LEAVES}) in live books: ${pages.length} pages; Archive-read: ${target.length}; blocked ${blocked.length}; already attempted ${attempted.length}; TO READ ${todo.length} in ${perBook.size} books`);
  console.log(`excluded with the held books: ${heldPages} Archive-read front-matter pages`);
  console.log(`wrote ${outPath('pages.json')} — feed it to realtime-ocr.mjs --page-ids-file`);
}

/** What realtime-ocr did to each planned page, from the two records it leaves. */
async function outcomes(db, planned, since) {
  const ids = planned.map((p) => p.page_id);
  const revs = await db.collection('page_revisions').find({ page_id: { $in: ids }, field: 'ocr', source: 'ia_djvu', reason: REVISION_REASON, created_at: { $gte: since } }, { projection: { _id: 0, page_id: 1, data: 1, created_at: 1 } }).toArray();
  const usage = await db.collection('gemini_usage').find({ endpoint: 'scripts/realtime-ocr.mjs', page_ids: { $in: ids }, timestamp: { $gte: since } }, { projection: { _id: 0, page_ids: 1, status: 1, skip_reason: 1, finish_reason: 1, error_message: 1, input_tokens: 1, output_tokens: 1, cost_usd: 1, model: 1 } }).toArray();
  const pages = await db.collection('pages').find({ id: { $in: ids } }, { projection: { _id: 0, id: 1, book_id: 1, page_number: 1, page_type: 1, 'ocr.source': 1, 'ocr.model': 1, 'ocr.data': 1, 'ocr.last_skip': 1 } }).toArray();
  const rev = new Map(); for (const r of revs) if (!rev.has(r.page_id) || rev.get(r.page_id).created_at < r.created_at) rev.set(r.page_id, r);
  const use = new Map(); for (const u of usage) for (const pid of u.page_ids || []) { (use.get(pid) || use.set(pid, []).get(pid)).push(u); }
  const page = new Map(pages.map((p) => [p.id, p]));
  return planned.map((pl) => {
    const p = page.get(pl.page_id);
    const reread = p?.ocr?.source === 'ai' && rev.has(pl.page_id);
    const rows = use.get(pl.page_id) || [];
    const skip = rows.find((u) => u.status === 'skipped');
    const err = rows.find((u) => u.status === 'error');
    const ok = rows.find((u) => u.status === 'success');
    return {
      ...pl,
      outcome: reread ? 'reread' : skip ? `skipped:${skip.skip_reason}` : err ? 'error' : p?.ocr?.source === 'ia_djvu' ? 'untouched' : `other:${p?.ocr?.source ?? 'none'}`,
      page_type: p?.page_type ?? (p?.ocr?.data ? extractPageType(p.ocr.data) : null) ?? null,
      model: p?.ocr?.model ?? null,
      archive_text: rev.get(pl.page_id)?.data ?? null,
      model_text: reread ? p.ocr.data : null,
      tokens: ok ? { in: ok.input_tokens || 0, out: ok.output_tokens || 0, cost_usd: ok.cost_usd ?? null } : null,
      finish_reason: skip?.finish_reason ?? null,
      error: err?.error_message ?? null,
    };
  });
}

async function record(db) {
  if (!RUN_ID) throw new Error('--record needs --run-id=<jobs.id of the realtime-ocr run> (comma-separated if the pass was restarted)');
  // A restarted pass is several realtime-ocr runs; outcomes are read from the earliest start.
  const runs = await db.collection('jobs').find({ id: { $in: RUN_ID.split(',') }, type: 'realtime_ocr' }, { projection: { id: 1, created_at: 1, config: 1, progress: 1 } }).sort({ created_at: 1 }).toArray();
  if (runs.length !== RUN_ID.split(',').length) throw new Error(`realtime_ocr jobs found ${runs.map((r) => r.id).join(',')} for ${RUN_ID}`);
  const run = runs[0];
  const { pages: planned } = readJson('pages.json');
  const res = await outcomes(db, planned, run.created_at);
  writeJson('outcomes.json', res.map(({ archive_text, model_text, ...r }) => r));
  const byBook = new Map();
  for (const r of res) (byBook.get(r.book_id) || byBook.set(r.book_id, []).get(r.book_id)).push(r);
  const tally = {}; for (const r of res) tally[r.outcome] = (tally[r.outcome] || 0) + 1;
  const spend = res.reduce((a, r) => a + (r.tokens?.cost_usd || 0), 0);
  const tokens = res.reduce((a, r) => ({ in: a.in + (r.tokens?.in || 0), out: a.out + (r.tokens?.out || 0) }), { in: 0, out: 0 });
  console.log(`run ${RUN_ID} started ${run.created_at.toISOString()} model ${run.config?.model}`);
  console.log(`outcomes ${JSON.stringify(tally)}; tokens in ${tokens.in} out ${tokens.out}; computed spend $${spend.toFixed(2)} (Mongo gemini_usage rows only — realtime-ocr writes no Supabase rows)`);
  const already = new Set((await db.collection('book_events').find({ type: EVENT, 'details.run_id': RUN_ID }, { projection: { book_id: 1 } }).toArray()).map((e) => e.book_id));
  // Pages this pass wrote as `title-page` that are really a digitizer insert (the
  // Cornell leaf): relabel, so title-page-ocr / cover scoring do not pick them.
  const inserts = res.filter((r) => r.outcome === 'reread' && r.page_type === 'title-page' && isInsert(r.model_text));
  if (inserts.length && APPLY) {
    const u = await db.collection('pages').updateMany({ id: { $in: inserts.map((r) => r.page_id) }, page_type: 'title-page' }, { $set: { page_type: 'digitizer-insert', updated_at: new Date() } });
    console.log(`relabelled ${u.modifiedCount}/${inserts.length} digitizer inserts the model had tagged title-page`);
  } else if (inserts.length) console.log(`would relabel ${inserts.length} digitizer inserts tagged title-page`);
  let wrote = 0, skipped = 0;
  for (const [bookId, rows] of byBook) {
    const reread = rows.filter((r) => r.outcome === 'reread');
    const refused = rows.filter((r) => r.outcome.startsWith('skipped:'));
    const errored = rows.filter((r) => r.outcome === 'error' || r.outcome === 'untouched');
    if (!reread.length && !refused.length) { skipped++; continue; }
    if (already.has(bookId)) { skipped++; continue; }
    if (!APPLY) { wrote++; continue; }
    const detail = { issue: ISSUE, run_id: RUN_ID, leaves: LEAVES, model: run.config?.model ?? null, pages_reread: reread.length, pages_refused: refused.length, pages_not_read: errored.length, inserts_relabelled: inserts.filter((r) => r.book_id === bookId).length, refused: refused.map((r) => ({ page: r.page_number, reason: r.outcome.slice(8), finish_reason: r.finish_reason })), page_types: Object.fromEntries(Object.entries(reread.reduce((a, r) => { a[r.page_type || 'untagged'] = (a[r.page_type || 'untagged'] || 0) + 1; return a; }, {}))) };
    await recordSweepAction(db, { sweep: SWEEP, book_id: bookId, action: 'front-matter-reread', detail });
    await db.collection('book_events').insertOne({ book_id: bookId, type: EVENT, at: new Date(), source: 'reocr-ia-frontmatter', details: detail });
    wrote++;
  }
  console.log(`${APPLY ? 'wrote' : 'would write'} sweep_log + book_events for ${wrote} books; ${skipped} skipped (nothing happened, or already recorded for this run)`);
}

// ── report helpers ─────────────────────────────────────────────────────────────
/** pageProse keeps the CONTENT of the scalar tags (`<script>printed</script>` → "printed"), and
 *  "printed" is an imprint word — every model reading would count as an imprint difference. */
const prose = (raw) => pageProse(String(raw ?? '').replace(/<(scan-quality|language|script|page-type|header|footer|page-number)\b[^>]*>[\s\S]*?<\/\1>/gi, ' '));
const fold = (s) => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
const words = (s) => fold(s).split(' ').filter((w) => w.length > 1);
/** Fraction of the catalogue field's words present in the page, so a field is "present" at ≥ 0.8. */
function fieldCoverage(field, text) {
  const fw = words(field); if (!fw.length) return null;
  const tw = new Set(words(text));
  return fw.filter((w) => tw.has(w)).length / fw.length;
}
const years = (s) => new Set((String(s ?? '').match(/\b1[4-9]\d\d\b/g) || []));
const IMPRINT = /\b(printed|published|press|publishers?|verlag|imprimerie|libraire|typis|apud|sumptibus|excudebat|editore|tipografia|imprenta|london|paris|leipzig|berlin|new york|boston|edinburgh|oxford|cambridge|amsterdam|venetiis|lugduni|basileae|parisiis|londini)\b/i;
const imprintTokens = (text) => new Set(words(text).filter((w) => IMPRINT.test(w)));
const COPYRIGHT = /©|\bcopyright\b|all rights reserved|entered according to act|entered at stationers|droits? de (traduction|reproduction) r[ée]serv|alle rechte vorbehalten|printed in (great britain|the united states|germany|france)/i;
/** Character-level similarity of two proses (token Dice) — a coarse "how different" number. */
function dice(a, b) {
  const A = words(a), B = words(b); if (!A.length && !B.length) return 1;
  const m = new Map(); for (const w of A) m.set(w, (m.get(w) || 0) + 1);
  let hit = 0; for (const w of B) { const c = m.get(w); if (c) { hit++; m.set(w, c - 1); } }
  return (2 * hit) / (A.length + B.length);
}

async function report(db) {
  const { pages: planned } = readJson('pages.json');
  const books = new Map(readJson('books.json').map((b) => [b.id, b]));
  const since = new Date(readJson('pages.json').planned_at);
  const res = await outcomes(db, planned, since);
  const reread = res.filter((r) => r.outcome === 'reread');
  const insertPages = reread.filter((r) => r.page_type === 'title-page' && isInsert(r.model_text));
  const titlePages = reread.filter((r) => r.page_type === 'title-page' && !isInsert(r.model_text));
  const rows = [];
  for (const r of titlePages) {
    const b = books.get(r.book_id) || {};
    const A = prose(r.archive_text), M = prose(r.model_text);
    const cov = (f) => ({ archive: fieldCoverage(f, A), model: fieldCoverage(f, M) });
    const title = cov(b.title), author = cov(b.author);
    const ya = years(A), ym = years(M);
    const ia = imprintTokens(A), im = imprintTokens(M);
    // A field "differs" when the two readings disagree on it in EITHER direction; the
    // direction is kept so the report can separate what the model recovered from what
    // it lost — one number would hide a model that reads title pages worse.
    const differs = {
      title: title.archive != null && title.model != null && title.archive !== title.model,
      author: author.archive != null && author.model != null && author.archive !== author.model,
      year: [...ym].some((y) => !ya.has(y)) || [...ya].some((y) => !ym.has(y)),
      imprint: [...im].some((w) => !ia.has(w)) || [...ia].some((w) => !im.has(w)),
    };
    const recovers = {
      title: differs.title && title.model > title.archive,
      author: differs.author && author.model > author.archive,
      year: [...ym].some((y) => !ya.has(y)),
      imprint: [...im].some((w) => !ia.has(w)),
    };
    rows.push({ book_id: r.book_id, page_number: r.page_number, page_id: r.page_id, title: b.title, author: b.author, published: b.published, coverage: { title, author }, years: { archive: [...ya], model: [...ym] }, imprint_words_only_in_model: [...im].filter((w) => !ia.has(w)), imprint_words_only_in_archive: [...ia].filter((w) => !im.has(w)), similarity: +dice(A, M).toFixed(3), differs, recovers, any: Object.values(differs).some(Boolean), archive_prose: A.slice(0, 600), model_prose: M.slice(0, 600) });
  }
  const perBook = new Map();
  for (const x of rows) { const cur = perBook.get(x.book_id) || { title: false, author: false, year: false, imprint: false, any: false }; for (const k of Object.keys(cur)) cur[k] = cur[k] || (k === 'any' ? x.any : x.differs[k]); perBook.set(x.book_id, cur); }
  const count = (k) => [...perBook.values()].filter((v) => v[k]).length;
  const perBookRecovers = new Map();
  for (const x of rows) { const cur = perBookRecovers.get(x.book_id) || { title: false, author: false, year: false, imprint: false }; for (const k of Object.keys(cur)) cur[k] = cur[k] || x.recovers[k]; perBookRecovers.set(x.book_id, cur); }
  const countRecovers = (k) => [...perBookRecovers.values()].filter((v) => v[k]).length;
  const typeTally = {}; for (const r of reread) typeTally[r.page_type || 'untagged'] = (typeTally[r.page_type || 'untagged'] || 0) + 1;
  const toc = reread.filter((r) => r.page_type === 'toc');
  const copyright = reread.filter((r) => COPYRIGHT.test(prose(r.model_text)));
  const refused = res.filter((r) => r.outcome.startsWith('skipped:'));
  const refusedTally = {}; for (const r of refused) refusedTally[r.outcome.slice(8)] = (refusedTally[r.outcome.slice(8)] || 0) + 1;
  const spend = res.reduce((a, r) => a + (r.tokens?.cost_usd || 0), 0);
  const out = {
    issue: ISSUE, generated_at: new Date().toISOString(), leaves: LEAVES,
    planned: planned.length, reread: reread.length, refused: refusedTally, not_read: res.filter((r) => r.outcome === 'error' || r.outcome === 'untouched').length,
    computed_spend_usd: +spend.toFixed(2), page_types: typeTally,
    digitizer_inserts_tagged_title_page: insertPages.length,
    title_pages: { pages: titlePages.length, books: perBook.size, books_differing: { any: count('any'), title: count('title'), author: count('author'), year: count('year'), imprint: count('imprint') }, books_where_model_recovers: { title: countRecovers('title'), author: countRecovers('author'), year: countRecovers('year'), imprint: countRecovers('imprint') } },
    toc_pages: toc.length, toc_books: new Set(toc.map((r) => r.book_id)).size,
    copyright_versos: copyright.map((r) => ({ book_id: r.book_id, page_number: r.page_number, ia_identifier: books.get(r.book_id)?.ia_identifier ?? null, title: books.get(r.book_id)?.title ?? null, line: (prose(r.model_text).match(COPYRIGHT) || [''])[0] })),
    title_page_rows: rows.sort((a, b) => a.similarity - b.similarity),
  };
  writeJson('report.json', out);
  fs.writeFileSync(outPath('toc-pages.json'), JSON.stringify(toc.map((r) => ({ book_id: r.book_id, page_id: r.page_id, page_number: r.page_number }))));
  const md = [
    `# Front-matter re-read (#${ISSUE}) — ${out.generated_at.slice(0, 10)}`, '',
    `Planned ${out.planned} Archive-read pages (page_number ≤ ${LEAVES}); re-read ${out.reread}; refused ${JSON.stringify(refusedTally)}; not read ${out.not_read}; computed spend $${out.computed_spend_usd}.`, '',
    `Page types on the re-read pages: ${Object.entries(typeTally).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}.`, '',
    `## Title pages`, '',
    `${titlePages.length} pages in ${perBook.size} books tagged \`title-page\` (a further ${insertPages.length} tagged title-page are the Cornell digitizer insert, excluded and relabelled). Books where the Archive reading and the model reading differ on: any field **${count('any')}**, title ${count('title')}, author ${count('author')}, year ${count('year')}, imprint ${count('imprint')}.`,
    `Of those, books where the MODEL reading recovers something the Archive reading lacks: title ${countRecovers('title')}, author ${countRecovers('author')}, year ${countRecovers('year')}, imprint ${countRecovers('imprint')}.`,
    `(title/author = the fraction of the catalogue field's words present in each reading differs; year = the set of 4-digit years differs; imprint = a place/printer word one reading has and the other lacks. Directional counts say which reading has more.)`, '',
    `Lowest-similarity title pages (token Dice, Archive vs model):`, '',
    '| book | p. | sim | differs | catalogue title |', '|---|---|---|---|---|',
    ...rows.slice(0, 25).map((x) => `| ${x.book_id} | ${x.page_number} | ${x.similarity} | ${Object.entries(x.differs).filter(([, v]) => v).map(([k]) => k).join(' ') || '—'} | ${String(x.title || '').slice(0, 60)} |`), '',
    `## Downstream`, '',
    `- #4816: ${toc.length} re-read pages in ${out.toc_books} books are now tagged \`toc\` (ids in toc-pages.json).`,
    `- rights screen (#4809): ${copyright.length} pages in ${new Set(copyright.map((c) => c.book_id)).size} books carry a copyright / rights line the model read (list in report.json → copyright_versos).`,
  ];
  fs.writeFileSync(outPath('report.md'), md.join('\n') + '\n');
  console.log(md.slice(0, 8).join('\n'));
  console.log(`\nwrote ${outPath('report.json')} and report.md`);
}

const mode = FLAG('--plan') ? plan : FLAG('--record') ? record : FLAG('--report') ? report : null;
if (!mode) { console.error('one of --plan | --record | --report'); process.exit(1); }
await withMongo(mode, { timeoutMs: FOUR_HOURS });
