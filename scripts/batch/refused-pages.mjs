#!/usr/bin/env node
// PRIOR ART: scripts/batch/claude-ocr.mjs + cli-ocr.mjs apply, claude-translate.mjs + cli-translate.mjs apply — the
// readers and writers this job drives, unchanged (#7141 filled four Diels pages by hand with exactly this chain).
// scripts/workers/mineru-ocr-worker.mjs — the refusal ladder's old tier 3, `--book` only, run by nobody (no cron on
// main, l7a or gex45, checked 2026-10-22). scripts/lib/ia-ocr-cohort.mjs reads the same stamps to pick Archive-text
// candidates; it does not read pages. None selects refused pages corpus-wide or routes them by script (#7170).
/**
 * refused-pages — read the pages Gemini refused, with the next reader the routing table names for their script.
 *
 * WHO RUNS IT: cron on a Hetzner box with `claude` signed in (subscription) — or a session, by hand. It calls no paid
 * API: every reader here is Opus or Sonnet through `claude -p`. Pages whose next reader is a specialist lane (Paddle
 * for Siku manuscripts, Kraken for Syriac) are counted and left to that lane.
 *
 *   node --env-file=.env.production.local scripts/batch/refused-pages.mjs count
 *   node --env-file=.env.production.local scripts/batch/refused-pages.mjs run --out=DIR [--max-pages=40] [--apply]
 *
 * WHICH PAGES. `ocr.recitation_blocked: true` or `ocr.fail_blocked: true` (the batch collector's three-strike stamps),
 * with no OCR text, in a book that is VISIBLE (released) or `held` for a reason other than containment. The hidden
 * backlog is not selected: it waits for its own spend decision, as every other lane's hidden backlog does.
 *
 * WHICH READER. ocrRefusalFallback(chart) from scripts/lib/ocr-routing.mjs: the `refused-pages` row of
 * ocr-routing-table.json, adopted from scripts/eval/estimator/routing/derive_routes.py. The chart is the estimator's
 * script chart, taken from the book's FIRST language (language-normalize.mjs).
 *
 * WHAT A RUN DOES, per reader: claude-ocr.mjs reads the pages one per call; cli-ocr.mjs apply writes them through its
 * guards (provenance, revisions, sweep_log, book_events). Then the pages that now have OCR, in books that already
 * carry translations, are translated with claude-translate.mjs and written by cli-translate.mjs apply, so the
 * orchestrator's gap-fill never sends them to a paid model. Without --apply it reads and dry-runs both writers.
 *
 * HOW IT FAILS. A usage-limit reply makes claude-ocr / claude-translate exit 3; this job stops there and the next run
 * resumes (pages already read are skipped by the readers). Any other failed page stays empty and is reported.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import { ocrRefusalFallback } from '../lib/ocr-routing.mjs';
import { LATIN_SCRIPT_LANGUAGES } from '../lib/translate-core.mjs';
import { toLanguageCodes, codeFamily } from '../lib/language-normalize.mjs';
import { bookHand, loadOcrProfile } from '../lib/ocr-trust-gate.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NO_OCR = { $or: [{ 'ocr.data': { $exists: false } }, { 'ocr.data': null }, { 'ocr.data': '' }] };
const BLOCKED = { $or: [{ 'ocr.recitation_blocked': true }, { 'ocr.fail_blocked': true }] };
/** Readers this job can drive itself; other lanes keep their own runners. */
const CLAUDE_MODEL = { 'claude-opus-5-5': 'opus', 'claude-sonnet-5-5': 'sonnet' };
const FAMILY_CHART = { grc: 'greek', heb: 'hebrew', zho: 'chinese-print', syc: 'syriac', syr: 'syriac', hye: 'armenian', lat: 'latin', eng: 'english' };

/** The estimator chart for a book: its first language's family, else Latin-script-other, else null (row `otherwise`). */
export function chartForBook(book) {
  const first = toLanguageCodes(book?.language).codes[0];
  const fam = first ? codeFamily(first) : undefined;
  if (fam && FAMILY_CHART[fam]) return FAMILY_CHART[fam];
  const label = String(book?.language ?? '').split(/[,;/]/)[0].trim().toLowerCase();
  if (label && LATIN_SCRIPT_LANGUAGES.has(label)) return 'latin-script-other';
  return null;
}

/** A visible book, or a held one whose hold is not a containment (#containment-on-finding: those pages stay withheld). */
export function eligibleBook(book) {
  if (book?.visible === true) return true;
  const hold = book?.pipeline_auto?.hold;
  if (!hold) return false;
  return !/contain/i.test(`${hold.reason ?? ''} ${(book.labels ?? []).join(' ')}`);
}

/**
 * This box's Claude account's weekly percent from the climits meter, as claude-job.sh weekly_pct reads it (the meter
 * is pushed to every box; the account is the box's own login). null when the meter is absent, stale or unreadable.
 */
export function weeklyPct(meterFile = '/root/.claude-limits/latest.json', loginFile = '/root/.claude.json') {
  return weeklyMeter(meterFile, loginFile)?.pct ?? null;
}

/** weeklyPct plus the hours until that week resets (null when the meter has no resets_at). */
export function weeklyMeter(meterFile = '/root/.claude-limits/latest.json', loginFile = '/root/.claude.json') {
  try {
    if (Date.now() - fs.statSync(meterFile).mtimeMs > 30 * 60 * 1000) return null;
    const d = JSON.parse(fs.readFileSync(meterFile, 'utf8'));
    let me = d.claude_code_account;
    try { me = JSON.parse(fs.readFileSync(loginFile, 'utf8')).oauthAccount.emailAddress || me; } catch { /* the meter's account */ }
    const acct = (d.accounts ?? []).find((a) => a.email === me && a.ok);
    const l = acct?.limits?.find((x) => x.key === 'weekly_all:all');
    if (!l) return null;
    const reset = Date.parse(l.resets_at ?? '');
    return { pct: Math.round(Number(l.percent) || 0), hoursLeft: Number.isNaN(reset) ? null : (reset - Date.now()) / 3.6e6 };
  } catch { return null; }
}

async function selectPages(db) {
  const pages = await db.collection('pages').find({ $and: [BLOCKED, NO_OCR] }, { projection: { id: 1, book_id: 1, page_number: 1, 'ocr.recitation_blocked': 1, 'ocr.fail_blocked': 1 } }).toArray();
  const bookIds = [...new Set(pages.map((p) => p.book_id))];
  const books = new Map((await db.collection('books').find({ id: { $in: bookIds } }, { projection: { id: 1, title: 1, language: 1, visible: 1, 'pipeline_auto.hold': 1, labels: 1, pages_translated: 1 } }).toArray()).map((b) => [b.id, b]));
  const rows = [];
  for (const p of pages) {
    const book = books.get(p.book_id);
    const chart = chartForBook(book);
    const reader = ocrRefusalFallback(chart ?? 'none');
    rows.push({ page: p, book, chart: chart ?? 'other', reader, eligible: !!book && eligibleBook(book), stamp: p.ocr?.recitation_blocked ? 'recitation' : 'fail' });
  }
  return rows;
}

function run(cmd, args) {
  console.log(`$ node ${path.relative(process.cwd(), cmd)} ${args.join(' ')}`);
  const r = spawnSync(process.execPath, [cmd, ...args], { stdio: 'inherit', env: process.env });
  return r.status;
}

async function main() {
  const mode = process.argv[2];
  const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
  if (!['count', 'run'].includes(mode)) { console.error('usage: refused-pages.mjs count | run --out=DIR [--max-pages=N] [--apply] [--max-weekly-pct=70]'); process.exit(2); }
  if (mode === 'run') {
    // A cron spends the box account's subscription; stop well short of its week so sessions keep their headroom.
    const cap = Number(arg('max-weekly-pct') || 70);
    const wk = weeklyPct();
    if (wk != null && wk >= cap) { console.log(`skip: this box's Claude account is at ${wk}% of its week (cap ${cap}%)`); return; }
  }
  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
  await client.connect();
  const rows = await selectPages(client.db('bookstore'));
  if (mode === 'run') {
    // The estimator charts are print. A manuscript (most typed pages handwritten, the trust gate's rule) goes to the
    // manuscripts row's reader instead, Opus: on the first run Sonnet under-read a Catalan manuscript filed as print.
    const hands = new Map();
    for (const id of new Set(rows.filter((r) => r.eligible).map((r) => r.page.book_id))) {
      hands.set(id, bookHand(await loadOcrProfile(client.db('bookstore'), id)));
    }
    for (const r of rows) {
      if (hands.get(r.page.book_id) === 'manuscript') { r.chart = 'manuscript'; r.reader = ocrRefusalFallback('manuscript'); }
    }
  }
  await client.close();

  const tally = {};
  for (const r of rows) {
    const k = `${r.chart} -> ${r.reader.engine}`;
    tally[k] ??= { eligible: 0, hidden_or_contained: 0, books: new Set(), recitation: 0, fail: 0 };
    tally[k][r.eligible ? 'eligible' : 'hidden_or_contained']++;
    tally[k][r.stamp]++;
    if (r.eligible) tally[k].books.add(r.page.book_id);
  }
  console.log(`refused pages with no text: ${rows.length} (${rows.filter((r) => r.eligible).length} in visible or held books)`);
  for (const [k, t] of Object.entries(tally).sort((a, b) => b[1].eligible - a[1].eligible)) {
    console.log(`  ${k.padEnd(42)} eligible ${String(t.eligible).padStart(6)} in ${String(t.books.size).padStart(4)} books · hidden/contained ${String(t.hidden_or_contained).padStart(7)} · recitation ${t.recitation} / fail ${t.fail}`);
  }
  if (mode === 'count') return;

  const OUT = arg('out') && path.resolve(arg('out'));
  if (!OUT) { console.error('run needs --out=DIR'); process.exit(2); }
  const MAX = Number(arg('max-pages') || 40);
  const APPLY = process.argv.includes('--apply');
  const PER_CHART = Number(arg('per-chart') || Infinity);   // a sample across scripts, for a by-eye check
  // Pages Opus also failed (Claude's own output filter refused two Magnalia pages on the first run). Without this a
  // scheduled run would re-read them every time and, sorted first, they could fill the whole page budget. One JSON
  // line per page, beside the per-day output folders; delete a line to try that page again.
  const LEDGER = arg('ledger') || path.join(path.dirname(OUT), 'claude-refused.jsonl');
  const refused = new Set(fs.existsSync(LEDGER) ? fs.readFileSync(LEDGER, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).page_id) : []);
  const seen = {};
  const todo = rows.filter((r) => r.eligible && CLAUDE_MODEL[r.reader.engine] && !refused.has(r.page.id))
    .sort((a, b) => (a.book.visible === b.book.visible ? 0 : a.book.visible ? -1 : 1) || a.page.book_id.localeCompare(b.page.book_id) || a.page.page_number - b.page.page_number)
    .filter((r) => (seen[r.chart] = (seen[r.chart] ?? 0) + 1) <= PER_CHART)
    .slice(0, MAX);
  const reason = `#7170 refusal lane: page Gemini refused (stamp), next reader from ocr-routing-table refused-pages route`;
  const job = `refused-${new Date().toISOString().slice(0, 10)}`;
  // The table's reader first; a page it fails (Claude's own output filter, a reply without the page markers) goes to
  // the row's `otherwise` reader, Opus. First run, 2026-10-23: Sonnet read 2 of 6 such pages, Opus 8 of 8.
  const ESCALATE = 'claude-opus-5-5';
  const groups = new Map();
  for (const r of todo) groups.set(r.reader.engine, [...(groups.get(r.reader.engine) ?? []), r]);
  const order = [...groups.keys()].sort((a, b) => (a === ESCALATE) - (b === ESCALATE));   // Opus last, so it takes the escalations
  for (const engine of order) {
    const mine = groups.get(engine);
    const dir = path.join(OUT, CLAUDE_MODEL[engine]);
    fs.mkdirSync(dir, { recursive: true });
    const ids = path.join(dir, 'page-ids.json');
    fs.writeFileSync(ids, JSON.stringify(mine.map((r) => r.page.id)));
    console.log(`\n${engine}: ${mine.length} pages from ${new Set(mine.map((r) => r.page.book_id)).size} books`);
    const read = run(path.join(HERE, 'claude-ocr.mjs'), [`--out=${dir}/ocr`, `--page-ids-file=${ids}`, `--model=${CLAUDE_MODEL[engine]}`, '--per-call=1', '--concurrency=2', `--job=${job}`]);
    if (read === 3) { console.log('usage limit reached: stopping; the next run resumes'); process.exit(3); }
    if (engine === ESCALATE) {
      fs.mkdirSync(path.dirname(LEDGER), { recursive: true });
      for (const r of mine) {
        const meta = path.join(dir, 'ocr', `${r.page.id}.meta.json`);
        const m = fs.existsSync(meta) ? JSON.parse(fs.readFileSync(meta, 'utf8')) : null;
        if (m && m.exit !== 0 && !refused.has(r.page.id)) {
          refused.add(r.page.id);
          fs.appendFileSync(LEDGER, JSON.stringify({ page_id: r.page.id, book_id: r.page.book_id, page_number: r.page.page_number, error_class: m.error_class, stderr_tail: m.stderr_tail ?? null, at: new Date().toISOString() }) + '\n');
          console.log(`  ledger: p.${r.page.page_number} of ${r.page.book_id} failed on Opus too (${m.error_class}); not retried`);
        }
      }
    }
    if (engine !== ESCALATE) {
      const failed = mine.filter((r) => {
        const meta = path.join(dir, 'ocr', `${r.page.id}.meta.json`);
        return !fs.existsSync(meta) || JSON.parse(fs.readFileSync(meta, 'utf8')).exit !== 0;
      });
      if (failed.length) {
        console.log(`  ${failed.length} of ${mine.length} failed on ${engine}: escalated to ${ESCALATE}`);
        if (!groups.has(ESCALATE)) order.push(ESCALATE);
        groups.set(ESCALATE, [...(groups.get(ESCALATE) ?? []), ...failed]);
      }
    }
    const applied = run(path.join(HERE, 'cli-ocr.mjs'), ['apply', `--out=${dir}/ocr`, `--reason=${reason}`, ...(APPLY ? ['--apply'] : [])]);
    if (applied !== 0 || !APPLY) continue;
    // Translate what was just written, in books that already carry translations (else gap-fill would pick them up).
    const readOk = (r) => { const m = path.join(dir, 'ocr', `${r.page.id}.meta.json`); return fs.existsSync(m) && JSON.parse(fs.readFileSync(m, 'utf8')).exit === 0; };
    const tr = mine.filter((r) => readOk(r) && (r.book.pages_translated ?? 0) > 0).map((r) => r.page.id);
    if (!tr.length) continue;
    const trIds = path.join(dir, 'translate-ids.json');
    fs.writeFileSync(trIds, JSON.stringify(tr));
    const trRead = run(path.join(HERE, 'claude-translate.mjs'), ['read', `--page-ids-file=${trIds}`, `--out=${dir}/tr`, `--ocr-checked=${engine} read, ${job}, written by cli-ocr.mjs apply under its guards`, `--job=${job}-tr`]);
    if (trRead === 3) { console.log('usage limit reached during translation: stopping; the next run resumes'); process.exit(3); }
    run(path.join(HERE, 'cli-translate.mjs'), ['apply', `--out=${dir}/tr`, `--reason=${reason}; translated so gap-fill does not send it to a paid model`, '--apply']);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) await main();
