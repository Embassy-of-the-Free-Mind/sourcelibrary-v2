#!/usr/bin/env node
/**
 * Audit: do the six stored page counters on `books` still say what `pages` says? (#5331)
 *
 * PRIOR ART: scripts/audit/translation-state-audit.mjs — the sibling audit (#5290):
 *   same seeded sample, `--include` negative control, one-open-issue filing and exit
 *   codes, copied in shape; it recounts the RUNG, not the six counters.
 *   scripts/lib/stage-coverage.mjs `checkPageCounters()` — a 5% guard on five
 *   counters inside the coverage snapshot, blind to direction and to a missing field
 *   (see scripts/lib/page-count-audit.mjs).
 *
 * Design: .claude/docs/page-counts.md § The audit. Every counter drift measured so far
 * has run HIGH, and high is the direction that overclaims to a reader ("N of M
 * translated") and understates the backlog to an operator.
 *
 * WHAT IT CHECKS
 *   1. SAMPLE RECOUNT. N seeded-random live books (visible && pages_count > 0); recount
 *      each from `pages` with buildVisiblePageCountPipeline() and compare all six
 *      counters. FAIL when more than 1% of settled books disagree on any one counter,
 *      and on ANY counter stored HIGHER than the recount by more than the book's pages
 *      written in the last 2 h. Books recounted in the last 2 h (`page_counts_at`) are
 *      skipped: the reconciler has not had its turn.
 *   2. MISSING FIELD. Live books without a numeric `pages_translatable`. FAIL above 100,
 *      and on growth over the reading of about a week ago (--history keeps the readings).
 *   3. POSITIVE CONTROLS, every run: each of the six counters of one agreeing sampled
 *      book is raised by one in memory and the comparator must flag it HIGH; the
 *      missing-field rule must fail on 101. A control that does not fire makes the run
 *      `probe_broken`, never PASS.
 *
 * READS ONLY. Nothing is written to Mongo. --history appends one line per run to a
 * local JSONL file. With --file-issue it files or comments on ONE GitHub issue (title
 * prefix below) and closes it on the next PASS.
 *
 * USAGE
 *   node --env-file=.env.production.local scripts/audit/page-count-audit.mjs
 *   node … --sample 300 --file-issue --history /var/log/sourcelibrary/page-count-audit-history.jsonl --json /var/log/sourcelibrary/page-count-audit-last.json
 *   node … --include <book-id>     # force a book (hidden ones too, never skipped) into the sample: the negative control
 *   node … --seed 20261013         # default: today's date, so each daily run draws a new sample
 *
 * EXIT: 0 = PASS, 1 = FAIL, 2 = could not run or probe_broken.
 */
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { MongoClient } from 'mongodb';
import { buildVisiblePageCountPipeline, PAGE_COUNTERS } from '../lib/page-counts.mjs';
import {
  compareBookCounters, summarizeCounters, counterPositiveControl, checkMissingTranslatable,
  auditVerdict, IN_FLIGHT_MS, MAX_MISSING_TRANSLATABLE,
} from '../lib/page-count-audit.mjs';

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const flag = (f, d) => (has(f) ? args[args.indexOf(f) + 1] : d);
const all = (f) => args.flatMap((a, i) => (a === f ? [args[i + 1]] : []));

const SAMPLE = Number(flag('--sample', 300));
const SEED = String(flag('--seed', new Date().toISOString().slice(0, 10).replace(/-/g, '')));
const INCLUDE = all('--include');
const JSON_OUT = flag('--json', null);
const HISTORY = flag('--history', null);
const FILE_ISSUE = has('--file-issue');
const ISSUE_PREFIX = 'Page count audit: ';
const LIVE = { visible: true, pages_count: { $gt: 0 } };
const MAX_TIME_MS = 120_000;

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

const BOOK_PROJECTION = { _id: 0, id: 1, title: 1, visible: 1, page_counts_at: 1, ...Object.fromEntries(PAGE_COUNTERS.map(c => [c, 1])) };

// ── 1. sample recount ────────────────────────────────────────────────────────
async function sampleRecount(db, now) {
  const books = db.collection('books');
  const cutoff = new Date(now - IN_FLIGHT_MS);
  const frame = await books.find(LIVE, { projection: { _id: 0, id: 1, page_counts_at: 1 } }).toArray();
  const recent = frame.filter(b => b.page_counts_at && new Date(b.page_counts_at) >= cutoff).length;
  // Draw from the settled frame, so the sample size does not shrink on a busy day.
  const picked = seeded(frame.filter(b => b.id && !(b.page_counts_at && new Date(b.page_counts_at) >= cutoff)), b => b.id)
    .slice(0, SAMPLE).map(b => b.id);
  const ids = [...picked, ...INCLUDE.filter(id => !picked.includes(id))];

  const rows = await pool(ids, 6, async (id) => {
    const forced = INCLUDE.includes(id);
    // Read the book right before its recount (stage-coverage's rule): a book the
    // pipeline advanced between the draw and the recount is not reported as drift.
    const [book, [stats], recentPages] = await Promise.all([
      books.findOne({ id }, { projection: BOOK_PROJECTION, maxTimeMS: MAX_TIME_MS }),
      db.collection('pages').aggregate(buildVisiblePageCountPipeline(id), { maxTimeMS: MAX_TIME_MS }).toArray(),
      db.collection('pages').countDocuments(
        { book_id: id, $or: [{ updated_at: { $gte: cutoff } }, { 'ocr.updated_at': { $gte: cutoff } }, { 'translation.updated_at': { $gte: cutoff } }] },
        { maxTimeMS: MAX_TIME_MS },
      ),
    ]);
    if (!book) { if (forced) throw new Error(`--include ${id}: no such book`); return null; }
    return { id, title: book.title, forced, book, stats: stats ?? null, recentPages };
  });
  const live = rows.filter(Boolean);
  const summary = summarizeCounters(live.map(compareBookCounters));
  const byId = new Map(live.map(r => [r.id, r]));
  return {
    frame: frame.length,
    skipped_recent_recount: recent,
    rows: live,
    ...summary,
    disagreements: summary.disagreements.map(d => ({ ...d, title: (byId.get(d.id).title || '').slice(0, 60), forced: byId.get(d.id).forced })),
  };
}

// ── 2. missing field ─────────────────────────────────────────────────────────
function readHistory() {
  if (!HISTORY || !fs.existsSync(HISTORY)) return [];
  return fs.readFileSync(HISTORY, 'utf8').split('\n').filter(Boolean).flatMap(l => { try { return [JSON.parse(l)]; } catch { return []; } });
}

// ── report ───────────────────────────────────────────────────────────────────
function fileIssue(report) {
  const body = `${process.env.TMPDIR || '/tmp'}/page-count-audit-issue-${process.pid}.md`;
  const block = '```json\n' + JSON.stringify({
    seed: report.seed,
    sample: { n: report.sample.n, settled: report.sample.settled, by_counter: report.sample.by_counter, disagreements: report.sample.disagreements.slice(0, 15) },
    missing_translatable: report.missing_translatable, controls: report.controls,
  }, null, 1) + '\n```';
  const day = report.checked_at.slice(0, 10);
  try {
    const open = JSON.parse(execFileSync('gh', ['issue', 'list', '--state', 'open', '--search', `"${ISSUE_PREFIX}" in:title`, '--json', 'number,title'], { encoding: 'utf8' }))
      .filter(i => i.title.startsWith(ISSUE_PREFIX));
    if (report.verdict !== 'PASS') {
      const lines = report.verdict === 'FAIL' ? report.fails : ['a positive control did not fire'];
      fs.writeFileSync(body, `Daily \`scripts/audit/page-count-audit.mjs\` (seed ${report.seed}): **${report.verdict}**\n\n${lines.map(l => `- ${l}`).join('\n')}\n\n` +
        'Reading it: a counter stored HIGHER than its recount is one a writer set from a private count, or one nothing recounted after a page was hidden or cleared. ' +
        'Fix the writer (`.claude/docs/page-counts.md` § The single writer: `recountBook()` or the reconciler, nothing else), then `recountBook()` the books listed. ' +
        'Never hand-set a counter. A counter that is off in one direction across many books names a broken job-time writer; the reconciler log (`/var/log/sourcelibrary/sync.log`) tallies per counter. ' +
        '`probe_broken` means the audit\'s own control did not fire: fix the audit, the corpus is not judged.\n\n' + `${block}\n`);
      execFileSync('bash', ['.github/scripts/file-or-update-issue.sh', ISSUE_PREFIX, `${ISSUE_PREFIX}${report.verdict} — ${lines[0]} (${day})`, body, 'data-quality'], { stdio: 'inherit' });
    } else {
      for (const i of open) {
        fs.writeFileSync(body, `Today's run (seed ${report.seed}) passes: ${report.sample.disagree} of ${report.sample.n} sampled books disagree on any counter, none is stored high, ${report.missing_translatable.missing} live books lack pages_translatable. Closing; the next failing run files again.\n\n${block}\n`);
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

  const sample = await sampleRecount(db, now);
  const missingN = await db.collection('books').countDocuments({ ...LIVE, pages_translatable: { $not: { $type: 'number' } } }, { maxTimeMS: MAX_TIME_MS });
  const history = readHistory();
  const missing = checkMissingTranslatable(missingN, history, now);

  const controls = {
    counters: counterPositiveControl(sample.rows),
    missing: { ok: checkMissingTranslatable(MAX_MISSING_TRANSLATABLE + 1).fails.length === 1 && checkMissingTranslatable(5, [{ at: new Date(now - 7 * 86_400_000).toISOString(), missing: 4 }], now).fails.length === 1 && checkMissingTranslatable(0).fails.length === 0 },
  };
  controls.ok = controls.counters.ok && controls.missing.ok;

  const fails = [...sample.fails, ...missing.fails];
  const { verdict, exit: code } = auditVerdict({ fails, controlsOk: controls.ok, unreadable: [] });
  exit = code;

  const report = {
    checked_at: new Date(now).toISOString(), seed: SEED, verdict, fails, controls,
    sample: {
      frame: sample.frame, skipped_recent_recount: sample.skipped_recent_recount, n: sample.n, settled: sample.settled, in_flight: sample.in_flight,
      disagree: sample.disagree, forced: INCLUDE, by_counter: sample.by_counter, disagreements: sample.disagreements,
    },
    missing_translatable: missing,
  };

  log(`page-count audit — seed ${SEED}, ${report.checked_at}`);
  log(`\n1. sample recount: ${sample.n} books of ${sample.frame.toLocaleString('en-US')} live${INCLUDE.length ? ` (+${INCLUDE.length} forced)` : ''}; ${sample.skipped_recent_recount} recounted in the last 2 h not drawn; ${sample.in_flight} with page writes in the last 2 h (HIGH rule only)`);
  log(`   ${'counter'.padEnd(20)} off/settled   high  low  missing  high-unexplained (pages)`);
  for (const c of PAGE_COUNTERS) {
    const s = sample.by_counter[c];
    log(`   ${c.padEnd(20)} ${`${s.off}/${sample.settled}`.padStart(11)} ${String(s.higher).padStart(6)} ${String(s.lower).padStart(4)} ${String(s.missing).padStart(8)}  ${s.higher_unexplained} (${s.pages_high})`);
  }
  for (const d of sample.disagreements.slice(0, 15)) {
    const off = Object.entries(d.counters).filter(([, v]) => !v.agree).map(([k, v]) => `${k} ${v.stored ?? '—'}→${v.recount}`).join(', ');
    log(`   ${d.id}${d.forced ? ' (forced)' : ''}${d.recent_pages ? ` [${d.recent_pages} pages written <2 h]` : ''}: ${off}  "${d.title}"`);
  }
  log(`\n2. live books without a numeric pages_translatable: ${missing.missing} (max ${missing.max}; ${missing.week_ago ? `week ago ${missing.week_ago.missing}, growth ${missing.growth}` : 'no baseline a week old yet'})`);
  log(`\n3. controls: counters ${controls.counters.ok ? `fired on all six (${controls.counters.book})` : `DID NOT FIRE (${controls.counters.reason || `missed ${controls.counters.missed.join(', ')}`})`}; missing-field ${controls.missing.ok ? 'fired' : 'DID NOT FIRE'}`);
  log(`\n${verdict}${fails.length ? ' — ' + fails.join('; ') : ''}${verdict === 'probe_broken' ? ' — a positive control did not fire' : ''}`);

  if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(report, null, 1));
  if (HISTORY) fs.appendFileSync(HISTORY, JSON.stringify({ at: report.checked_at, missing: missing.missing, verdict, disagree: sample.disagree, n: sample.n }) + '\n');
  if (FILE_ISSUE) fileIssue(report);
} catch (err) {
  console.error(`Audit could not run: ${err?.message || err}`);
  exit = 2;
} finally {
  await client.close().catch(() => {});
}
process.exit(exit);
