#!/usr/bin/env node
/**
 * Audit: does `books.translation_state` still say what the pages say, and does
 * every public "readable in English" headline still equal its named view? (#5290)
 *
 * PRIOR ART: scripts/audit/fully-translated-coverage.mjs — same PASS/FAIL shape and
 *   the #5063 rule this carries forward, but one rule on a legacy flag, no recount
 *   and no read-path comparison. scripts/lib/stage-coverage.mjs — the positive-control
 *   convention (`probe_broken`, never PASS) reused here. scripts/audit/page-vector-truth.mjs
 *   — the seeded weekly sample and the one-open-issue filing, copied in shape.
 *
 * Design: .claude/docs/translation-state.md § The audit. The headline had no
 * outside check: every reader counts the stored rung, so a stale stamp or a
 * second definition creeping back into one surface is invisible from inside.
 *
 * WHAT IT CHECKS
 *   1. SAMPLE RECOUNT. N seeded-random live books; recount each from `pages`
 *      (buildVisiblePageCountPipeline), recompute the rung (computeTranslationState),
 *      compare with the stored one. FAIL above 1% disagreement, and on ANY book
 *      whose stored rung is higher than its recount.
 *   2. HEADLINE vs VIEW. A fresh Mongo count of `readable_in_english` against
 *        system_config.homepage_stats.readableInEnglish        (≤ 26 h: daily 05:15 + sync lag)
 *        system_config.dashboard_snapshot canon.readable_books (≤ 4 h: two-hourly; /contribute
 *                                                               and /api/analytics/canon read it)
 *        the number PRINTED on /, /about, /census, /contribute (no stamp; value only)
 *        Supabase books_catalog, the browse filter's own query (≤ 4 h on the sync watermark)
 *        collections.book_count on 20 seeded collections       (two-hourly; value only)
 *      FAIL on a surface older than its bound, or further from the view than 2%.
 *      Reported, never failed: the spend page's `books_90pct_translated` (ops_reports
 *      `spend-dashboard`, pushed by hand from the ops repo, no freshness bound in the
 *      design). Not checked, and listed as such: /api/analytics/canon and
 *      /api/platform/stats need a session; platform stats is also not on the view
 *      yet (#5288 item 5).
 *   3. #5063 CARRIED FORWARD on the rung (carryForwardFilter in the lib, and why its
 *      denominator is pages_count − pages_blank).
 *   4. POSITIVE CONTROLS, every run: one sampled book's stored rung is perturbed in
 *      memory and the comparator must flag it; the headline comparator must flag a
 *      planted stale stamp and a planted drift. A control that does not fire, or a
 *      surface that returns no number, makes the run `probe_broken`.
 *
 * READS ONLY. Nothing is written to Mongo or Supabase. With --file-issue it files or
 * comments on ONE GitHub issue (title prefix below) and closes it on the next PASS.
 *
 * USAGE
 *   node --env-file=.env.production.local scripts/audit/translation-state-audit.mjs
 *   node … --sample 300 --seed $(date +%G%V) --file-issue --json /var/log/sourcelibrary/translation-state-audit-last.json
 *   node … --include <book-id>     # force a book (hidden ones too) into the sample: the negative control
 *   node … --no-pages              # skip the four rendered pages (offline / local)
 *
 * EXIT: 0 = PASS, 1 = FAIL, 2 = could not run or probe_broken.
 */
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { MongoClient } from 'mongodb';
import {
  buildVisiblePageCountPipeline, pageCountersFromStats, computeTranslationState,
  READABLE_IN_ENGLISH_FILTER, READABLE_RUNGS, ENGLISH_ORIGINAL_READABLE_RUNGS, TRANSLATION_RUNGS,
} from '../lib/page-counts.mjs';
import { parseContentRangeCount } from '../lib/stage-coverage.mjs';
import { PAGES_MATERIALIZED_FILTER } from '../lib/pages-state.mjs';
import {
  compareRung, summarizeRecount, rungPositiveControl, checkHeadline, headlinePositiveControl,
  parseReadableFigures, carryForwardFilter, isCarryForwardShape, auditVerdict,
} from '../lib/translation-state-audit.mjs';

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const flag = (f, d) => (has(f) ? args[args.indexOf(f) + 1] : d);
const all = (f) => args.flatMap((a, i) => (a === f ? [args[i + 1]] : []));

function isoWeek(d = new Date()) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const week = Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 86_400_000 + 1) / 7);
  return `${t.getUTCFullYear()}${String(week).padStart(2, '0')}`;
}

const SAMPLE = Number(flag('--sample', 300));
const SEED = String(flag('--seed', isoWeek()));
const INCLUDE = all('--include');
const NCOLLECTIONS = Number(flag('--collections', 20));
const JSON_OUT = flag('--json', null);
const FILE_ISSUE = has('--file-issue');
const NO_PAGES = has('--no-pages');
const SITE = String(flag('--site', 'https://sourcelibrary.org')).replace(/\/$/, '');
const ISSUE_PREFIX = 'Translation state audit: ';
const PAGES = ['/', '/about', '/census', '/contribute'];
const HOUR = 3_600_000;
const LIVE = { visible: true, pages_count: { $gt: 0 } };

const log = (s) => console.log(s);
const sha = (s) => createHash('sha256').update(s).digest('hex');
const seeded = (rows, key) => rows.map(r => ({ r, k: sha(SEED + key(r)) })).sort((a, b) => (a.k < b.k ? -1 : 1)).map(x => x.r);

const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI not set'); process.exit(2); }

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const at = i++; out[at] = await fn(items[at]); }
  }));
  return out;
}

// ── 1. sample recount ────────────────────────────────────────────────────────
const BOOK_PROJECTION = { _id: 1, id: 1, title: 1, visible: 1, language: 1, content_type: 1, translation_state: 1 };

async function sampleRecount(db) {
  const books = db.collection('books');
  // A manifest-only book (#7343) has no pages to recount; its rung comes from its declared count.
  const frame = await books.find({ ...LIVE, ...PAGES_MATERIALIZED_FILTER }, { projection: { _id: 1, id: 1 } }).toArray();
  const picked = seeded(frame, b => String(b.id || b._id)).slice(0, SAMPLE).map(b => b._id);
  const docs = await books.find({ _id: { $in: picked } }, { projection: BOOK_PROJECTION }).toArray();
  for (const id of INCLUDE) {
    const b = await books.findOne({ id }, { projection: BOOK_PROJECTION });
    if (!b) throw new Error(`--include ${id}: no such book`);
    if (!docs.some(d => String(d._id) === String(b._id))) docs.push(b);
  }
  const rows = await pool(docs, 6, async (b) => {
    const id = b.id || String(b._id);
    const [stats] = await db.collection('pages').aggregate(buildVisiblePageCountPipeline(id)).toArray();
    // A book with no visible pages recounts to zeros — its true count (sync-worker does the same).
    const recount = computeTranslationState(pageCountersFromStats(stats), { language: b.language, content_type: b.content_type });
    return { id, title: b.title, forced: INCLUDE.includes(id), stored: b.translation_state ?? null, recount };
  });
  const summary = summarizeRecount(rows.map(compareRung));
  const byId = new Map(rows.map(r => [r.id, r]));
  return {
    frame: frame.length,
    rows,
    ...summary,
    disagreements: summary.disagreements.map(c => {
      const r = byId.get(c.id);
      return { ...c, title: (r.title || '').slice(0, 60), forced: r.forced, stored: r.stored, recount: r.recount };
    }),
  };
}

// ── 2. headlines ─────────────────────────────────────────────────────────────
async function catalogCount(query) {
  const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  try {
    // HEAD + count=exact: supabase-js caps a select at 1,000 rows, a count is not capped.
    const res = await fetch(`${url}/rest/v1/books_catalog?select=id&visible=is.true&pages_count=gt.0${query}`, {
      method: 'HEAD',
      headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: 'count=exact', Range: '0-0' },
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok && res.status !== 206) return null;
    return parseContentRangeCount(res.headers.get('content-range'));
  } catch { return null; }
}

async function pageFigures(path) {
  try {
    const res = await fetch(`${SITE}${path}`, {
      headers: { 'user-agent': 'sl-translation-state-audit/1 (+https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/5290)' },
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) return { figures: [], detail: `HTTP ${res.status}` };
    return { figures: parseReadableFigures(await res.text()) };
  } catch (e) { return { figures: [], detail: e.message }; }
}

async function headlines(db, now) {
  const books = db.collection('books');
  const config = db.collection('system_config');
  const view = 'readable_in_english';
  const expected = await books.countDocuments({ ...LIVE, ...READABLE_IN_ENGLISH_FILTER });
  const rows = [];

  const hs = await config.findOne({ _id: 'homepage_stats' });
  rows.push(checkHeadline({ surface: 'system_config.homepage_stats.readableInEnglish', view, value: hs?.readableInEnglish, expected, at: hs?.readableInEnglishAt ?? hs?.updatedAt, maxAgeMs: 26 * HOUR, now }));

  const snap = await config.findOne({ _id: 'dashboard_snapshot' });
  rows.push(checkHeadline({ surface: 'system_config.dashboard_snapshot canon.readable_books', view, value: snap?.data?.canon?.readable_books, expected, at: snap?.updated_at, maxAgeMs: 4 * HOUR, now }));

  if (!NO_PAGES) {
    for (const path of PAGES) {
      const { figures, detail } = await pageFigures(path);
      if (!figures.length) rows.push({ ...checkHeadline({ surface: `${SITE}${path}`, view, value: null, expected }), detail: detail || 'no "N readable in English" on the page' });
      for (const value of figures) rows.push(checkHeadline({ surface: `${SITE}${path}`, view, value, expected }));
    }
  }

  // Supabase: the browse filter's own query, and the mirror row by row of the ladder.
  const or = `&or=(translation_rung.in.(${READABLE_RUNGS.join(',')}),and(english_original.is.true,translation_rung.in.(${ENGLISH_ORIGINAL_READABLE_RUNGS.join(',')})))`;
  const mark = await config.findOne({ _id: 'books_catalog_sync_watermark' });
  rows.push(checkHeadline({ surface: 'supabase books_catalog (browse hasTranslation)', view, value: await catalogCount(or), expected, at: mark?.updated_at, maxAgeMs: 4 * HOUR, now }));
  const mongoByRung = new Map((await books.aggregate([{ $match: LIVE }, { $group: { _id: '$translation_state.rung', n: { $sum: 1 } } }]).toArray()).map(r => [r._id, r.n]));
  const byRung = [];
  for (const rung of TRANSLATION_RUNGS) byRung.push({ rung, mongo: mongoByRung.get(rung) || 0, catalog: await catalogCount(`&translation_rung=eq.${rung}`) });

  // Collections: the cached header count against its members in the view, with
  // sync-worker's own member filter (syncCollectionCounts).
  const frame = await db.collection('collections').find({ total_book_count: { $gt: 0 } }, { projection: { _id: 0, slug: 1, book_count: 1 } }).toArray();
  const cols = seeded(frame.filter(c => c.slug), c => c.slug).slice(0, NCOLLECTIONS);
  const members = new Map((await books.aggregate([
    { $match: { status: { $ne: 'deleted' }, ...LIVE, resource_type: { $exists: false }, ...READABLE_IN_ENGLISH_FILTER, collections: { $in: cols.map(c => c.slug) } } },
    { $unwind: '$collections' },
    { $group: { _id: '$collections', n: { $sum: 1 } } },
  ]).toArray()).map(r => [r._id, r.n]));
  const collections = cols.map(c => checkHeadline({ surface: `collections.book_count ${c.slug}`, view, value: c.book_count ?? 0, expected: members.get(c.slug) || 0, slack: 2 }));

  // Spend page: reported with its nearest view, never failed (see header).
  const spend = await db.collection('ops_reports').findOne({ _id: 'spend-dashboard' }, { projection: { generated_at: 1, 'data.output.books_90pct_translated': 1, 'data.output.measured': 1 } });
  const spendRow = {
    surface: 'ops_reports spend-dashboard output.books_90pct_translated',
    view: 'rung ∈ {readable, complete}, whole corpus',
    value: spend?.data?.output?.books_90pct_translated ?? null,
    expected: await books.countDocuments({ 'translation_state.rung': { $in: [...READABLE_RUNGS] } }),
    measured: spend?.data?.output?.measured ?? null,
    generated_at: spend?.generated_at ?? null,
    status: 'reported',
  };

  const notChecked = [
    { surface: `${SITE}/api/analytics/canon`, why: 'needs a session; its readable_books is the dashboard_snapshot figure checked above' },
    { surface: `${SITE}/api/platform/stats`, why: 'needs an admin session, and still counts pages_translated > 0 (#5288 item 5)' },
  ];
  return { view, expected, rows, collections, catalog_by_rung: byRung, spend: spendRow, not_checked: notChecked };
}

// ── report ───────────────────────────────────────────────────────────────────
function fileIssue(report) {
  const body = `${process.env.TMPDIR || '/tmp'}/translation-state-audit-issue-${process.pid}.md`;
  const block = '```json\n' + JSON.stringify({
    seed: report.seed, sample: { n: report.sample.n, disagree: report.sample.disagree, higher: report.sample.higher, disagreements: report.sample.disagreements.slice(0, 20) },
    headlines: report.headlines.rows, collections: report.headlines.collections.filter(c => c.status !== 'ok'),
    carry_forward: report.carry_forward, controls: report.controls,
  }, null, 1) + '\n```';
  const day = report.checked_at.slice(0, 10);
  try {
    const open = JSON.parse(execFileSync('gh', ['issue', 'list', '--state', 'open', '--search', `"${ISSUE_PREFIX}" in:title`, '--json', 'number,title'], { encoding: 'utf8' }))
      .filter(i => i.title.startsWith(ISSUE_PREFIX));
    if (report.verdict !== 'PASS') {
      const lines = report.verdict === 'FAIL' ? report.fails : [...report.unreadable.map(s => `no number from ${s}`), ...(report.controls.ok ? [] : ['a positive control did not fire'])];
      fs.writeFileSync(body, `Weekly \`scripts/audit/translation-state-audit.mjs\` (seed ${report.seed}): **${report.verdict}**\n\n${lines.map(l => `- ${l}`).join('\n')}\n\n` +
        'Reading it: a stored rung HIGHER than the recount means a book claims more than its pages show — find the writer (`git grep -n translation_state`; sync-worker is meant to be the only one). ' +
        'A `stale` surface has a writer that stopped; a `drift` surface is counting something other than `readable_in_english` (.claude/docs/translation-state.md § Named views). ' +
        '`probe_broken` means the audit could not read a surface or its own control did not fire: fix the audit, the corpus is not judged.\n\n' + `${block}\n`);
      execFileSync('bash', ['.github/scripts/file-or-update-issue.sh', ISSUE_PREFIX, `${ISSUE_PREFIX}${report.verdict} — ${lines[0]} (${day})`, body, 'translation'], { stdio: 'inherit' });
    } else {
      for (const i of open) {
        fs.writeFileSync(body, `This week's run (seed ${report.seed}) passes: ${report.sample.disagree} of ${report.sample.n} sampled rungs disagree, every headline is inside its bound. Closing; the next failing run files again.\n\n${block}\n`);
        execFileSync('gh', ['issue', 'close', String(i.number), '--comment', fs.readFileSync(body, 'utf8')], { stdio: 'inherit' });
      }
    }
  } catch (e) {
    log(`could not file/close the issue: ${e.message}`);
  }
}

const client = new MongoClient(uri);
let exit = 2;
try {
  await client.connect();
  const db = client.db('bookstore');
  const now = Date.now();

  const sample = await sampleRecount(db);
  const head = await headlines(db, now);
  const carryN = await db.collection('books').countDocuments(carryForwardFilter());
  const carrySample = carryN ? await db.collection('books').find(carryForwardFilter(), { projection: { _id: 0, id: 1, title: 1, visible: 1, pages_count: 1, pages_blank: 1, pages_ocr: 1, pages_translated: 1, 'translation_state.rung': 1 } }).limit(10).toArray() : [];

  const controls = {
    rung: rungPositiveControl(sample.rows),
    headline: headlinePositiveControl(head.expected, now),
    carry_forward: { ok: isCarryForwardShape({ translation_state: { rung: 'complete' }, pages_count: 300, pages_blank: 0, pages_translated: 25 }) && !isCarryForwardShape({ translation_state: { rung: 'complete' }, pages_count: 168, pages_blank: 86, pages_translated: 82 }) },
  };
  controls.ok = controls.rung.ok && controls.headline.ok && controls.carry_forward.ok;

  const judged = [...head.rows, ...head.collections];
  const fails = [
    ...sample.fails,
    ...judged.filter(r => r.status === 'stale').map(r => `${r.surface} is ${r.age_h} h old (bound ${r.max_age_h} h)`),
    ...judged.filter(r => r.status === 'drift').map(r => `${r.surface} shows ${r.value}, ${r.view} is ${r.expected} (off by ${r.diff}, allowed ±${r.allowed})`),
    ...(carryN ? [`${carryN} book(s) on readable/complete with more than 30 pages and under half translated (#5063 shape)`] : []),
  ];
  const unreadable = judged.filter(r => r.status === 'unreadable').map(r => r.surface);
  const { verdict, exit: code } = auditVerdict({ fails, controlsOk: controls.ok, unreadable });
  exit = code;

  const report = {
    checked_at: new Date(now).toISOString(), seed: SEED, verdict, fails, unreadable, controls,
    sample: { frame: sample.frame, n: sample.n, disagree: sample.disagree, share: sample.share, higher: sample.higher, forced: INCLUDE, disagreements: sample.disagreements },
    headlines: head,
    carry_forward: { count: carryN, sample: carrySample },
  };

  log(`translation-state audit — seed ${SEED}, ${report.checked_at}`);
  log(`\n1. sample recount: ${sample.n} books of ${sample.frame.toLocaleString('en-US')} live${INCLUDE.length ? ` (+${INCLUDE.length} forced)` : ''}`);
  log(`   disagree: ${sample.disagree} of ${sample.n} (${(100 * sample.share).toFixed(2)}%), stored higher than recount: ${sample.higher}`);
  for (const d of sample.disagreements.slice(0, 15)) log(`   ${d.direction.padEnd(16)} ${d.id} stored ${d.stored_rung} / recount ${d.recount_rung}  (${d.recount.translated}/${d.recount.translatable} translated, ocr ${d.recount.ocr}/${d.recount.whole}) "${d.title}"`);
  log(`\n2. headlines vs ${head.view} = ${head.expected.toLocaleString('en-US')} (fresh Mongo count)`);
  for (const r of head.rows) log(`   ${r.status.padEnd(10)} ${String(r.value ?? '—').padStart(7)}  ${r.surface}${r.age_h != null ? `  (${r.age_h} h old, bound ${r.max_age_h} h)` : ''}${r.detail ? `  [${r.detail}]` : ''}`);
  const badCols = head.collections.filter(c => c.status !== 'ok');
  log(`   collections.book_count: ${head.collections.length - badCols.length} of ${head.collections.length} agree with their members in the view`);
  for (const c of badCols) log(`   ${c.status.padEnd(10)} ${String(c.value).padStart(7)}  ${c.surface} (members ${c.expected})`);
  log('   books_catalog by rung (mongo / catalog): ' + head.catalog_by_rung.map(r => `${r.rung} ${r.mongo}/${r.catalog ?? '—'}`).join(', '));
  log(`   reported   ${String(head.spend.value ?? '—').padStart(7)}  ${head.spend.surface} (measured ${head.spend.measured ?? '?'}; ${head.spend.view} is ${head.spend.expected} today)`);
  for (const n of head.not_checked) log(`   not checked         ${n.surface} — ${n.why}`);
  log(`\n3. #5063 shape on the rung: ${carryN}`);
  for (const b of carrySample) log(`   ${b.id} ${b.translation_state?.rung} ${b.pages_translated ?? 0}/${b.pages_count} translated, ${b.pages_blank ?? 0} blank${b.visible ? '' : ' (hidden)'} "${(b.title || '').slice(0, 50)}"`);
  log(`\n4. controls: rung ${controls.rung.ok ? `fired (${controls.rung.book}: ${controls.rung.from} → ${controls.rung.to} flagged ${controls.rung.got})` : `DID NOT FIRE (${controls.rung.reason || `wanted ${controls.rung.expected}, got ${controls.rung.got}`})`}; headline ${controls.headline.ok ? 'fired' : 'DID NOT FIRE'}; #5063 ${controls.carry_forward.ok ? 'fired' : 'DID NOT FIRE'}`);
  log(`\n${verdict}${fails.length ? ' — ' + fails.join('; ') : ''}${verdict === 'probe_broken' ? ` — ${[...unreadable.map(s => `no number from ${s}`), ...(controls.ok ? [] : ['a control did not fire'])].join('; ')}` : ''}`);

  if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(report, null, 1));
  if (FILE_ISSUE) fileIssue(report);
} catch (err) {
  console.error(`Audit could not run: ${err?.message || err}`);
  exit = 2;
} finally {
  await client.close().catch(() => {});
}
process.exit(exit);
