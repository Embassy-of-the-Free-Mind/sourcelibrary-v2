#!/usr/bin/env node
/**
 * Build the /admin/quality document (#5474): "is the text we serve good, and is it getting better?"
 *
 * PRIOR ART: the ops repo's costs/spend-dashboard/build-data.py — same shape (read the instruments'
 * result files, write ONE `ops_reports` document the renderer reads, no deploy). It does not fit as
 * code: it is Python in the private repo and reads billing exports; every input here is an eval
 * result file in THIS repo, plus the paid-vs-got ledger docs and live counters for the trends.
 * scripts/eval/benchmark-dashboard-data.mjs is the OCR half's builder; this script reads its OUTPUT (src/data/ocr-benchmark-evidence.json) rather
 * than re-scoring anything.
 *
 * The script judges nothing and calls no model. It copies what each instrument wrote, attaches
 * n / instrument / date / source to every figure, and records "no measurement" (with the date the
 * instrument last ran, when known) where an instrument has not run. The only arithmetic it adds:
 * Wilson 95% intervals on the unweighted script-group rates (labelled as such), and the trend
 * lines (trends.mjs, #6429): the #6388 panel scored against its key, and pooled 7-day ratios.
 *
 * Usage (daily on Hetzner, infrastructure/hetzner-crontab):
 *   node --env-file=.env.production.local scripts/eval/quality-dashboard/build.mjs           # print summary, write the JSON
 *   node --env-file=.env.production.local scripts/eval/quality-dashboard/build.mjs --push    # also append today's history points
 *                                                                                              and upsert ops_reports/quality-dashboard
 *   --no-mongo         skip reader signals and the history store (both show "no measurement")
 *   --no-github        skip issue-state and pending-branch lookups
 *   --out-dir <dir>    where the JSON copy goes (default $JOB_SCRATCH, else scripts/output/)
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildTrends, recordHistory, readHistory } from './trends.mjs';

export const REPORT_ID = 'quality-dashboard';
export const SCHEMA_VERSION = 2; // 2: trends added; lanes and round1 removed (#6429)
const GH = 'https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2';
const blob = (p) => `${GH}/blob/main/${p}`;
const tree = (p) => `${GH}/tree/main/${p}`;
const issueUrl = (n) => `${GH}/issues/${n}`;

const TCA_PREFIX = 'translation-corpus-audit-';
const RESULTS = 'scripts/eval/results';
const OCR_EVIDENCE = 'src/data/ocr-benchmark-evidence.json';
const NALANDA = `${RESULTS}/nalanda-readiness-2026-09-30.json`;
const TAXONOMY = '.claude/docs/page-error-taxonomy.md';

/** PR #5315 (the reader's "report a problem" control) merged — no page report can predate it. */
const PAGE_REPORT_LAUNCH = '2026-09-30';

/**
 * Corpus-audit flag → nearest page-error-taxonomy class(es). A judgement made once, here, in code
 * review — the renderer only shows it. Codes resolve to titles and issue numbers from the taxonomy doc.
 */
export const FLAG_TO_TAXONOMY = {
  omission: ['T9', 'O5'],
  invention: ['T10', 'O1'],
  inversion: ['T8'],
  garble_passthrough: ['T7'],
  truncated: ['T1'],
  wrong_page: ['I1'],
  untranslated: ['T2'],
  wrong_language: ['T2', 'T12'],
  repetition: ['O4'],
};
const FLAG_LABEL = {
  omission: 'Omission', invention: 'Invention', inversion: 'Sense inverted', garble_passthrough: 'Garbled source rendered as prose',
  truncated: 'Truncated', wrong_page: 'Wrong page', untranslated: 'Untranslated', wrong_language: 'Wrong language', repetition: 'Repetition loop',
};
const SCRIPT_GROUP_LABEL = { all: 'All languages', 'latin-script': 'Latin-script languages', 'non-latin-script': 'Non-Latin-script languages' };

const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

export function wilson(k, n) {
  if (!n) return null;
  const z = 1.96, p = k / n, d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d, h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.round(Math.max(0, c - h) * 1000) / 10, Math.round(Math.min(1, c + h) * 1000) / 10];
}

/** Parse "### T9 · Quiet omission … — NEW · #5151" headings. */
export function parseTaxonomy(md) {
  const out = {};
  for (const line of md.split('\n')) {
    const m = /^### ([A-Z]\d+) · (.+?)(?: — (.*))?$/.exec(line.trim());
    if (!m) continue;
    const issue = /#(\d+)/.exec(m[3] || '');
    out[m[1]] = { code: m[1], title: m[2].trim(), issue: issue ? Number(issue[1]) : null };
  }
  return out;
}

function populationOf(dirName) {
  return dirName.startsWith(`${TCA_PREFIX}chained-`) ? 'chained' : 'served';
}

/** One corpus-audit run, reduced to what the page shows. Runs whose controls failed are kept but marked. */
export function readAuditRun(root, dirName) {
  const rel = `${RESULTS}/${dirName}`;
  const r = readJson(path.join(root, rel, 'report.json'));
  const ce = r.corpus_estimate || {};
  const ou = r.overall_unweighted || {};
  const groupCell = (c) => {
    if (!c?.n) return null;
    const kGe4 = Math.round((c.pct_ge4 / 100) * c.n), kMaj = Math.round((c.any_major / 100) * c.n);
    return {
      n: c.n, weighting: 'unweighted',
      ge4: { est: c.pct_ge4, ci: wilson(kGe4, c.n), ci_kind: 'Wilson 95%' },
      any_major: { est: c.any_major, ci: wilson(kMaj, c.n), ci_kind: 'Wilson 95%' },
    };
  };
  const groups = {
    all: ce.pct_fidelity_ge4 ? {
      n: r.n_main_judged, weighting: 'post-stratified by language',
      ge4: { est: ce.pct_fidelity_ge4.est, ci: ce.pct_fidelity_ge4.ci, ci_kind: 'bootstrap 95%' },
      any_major: { est: ce.any_major_defect.est, ci: ce.any_major_defect.ci, ci_kind: 'bootstrap 95%' },
    } : groupCell(ou),
  };
  for (const [k, c] of Object.entries(r.by_script_class || {})) groups[k] = groupCell(c);
  const n = r.n_main_judged ?? ou.n ?? 0;
  const flags = Object.entries(ce.flags || {}).map(([flag, v]) => ({
    flag, est: v?.est ?? null, ci: v?.ci ?? null,
    count: ou.flags?.[flag] != null ? Math.round((ou.flags[flag] / 100) * n) : null,
  }));
  return {
    id: dirName.slice(TCA_PREFIX.length),
    population: populationOf(dirName),
    label: populationOf(dirName) === 'chained' ? 'Chained-lane sample' : dirName.includes('-monthly-') ? 'Monthly audit' : 'Baseline audit',
    drawn_at: r.drawn_at,
    n, n_books: r.n_books,
    judge: r.primary_judge, second_judge: r.second_judge || null,
    controls_pass: Boolean(r.controls_gate?.pass),
    source: tree(rel),
    report: blob(`${rel}/report.md`),
    groups,
    flags,
    defect_types: Object.entries(r.defect_types || {}).map(([k, count]) => {
      const [type, severity] = k.split('/');
      return { type, severity, count };
    }),
  };
}

export function buildTranslation(root, pendingBranches = []) {
  const dirs = fs.readdirSync(path.join(root, RESULTS))
    .filter((d) => d.startsWith(TCA_PREFIX) && fs.existsSync(path.join(root, RESULTS, d, 'report.json')));
  const runs = dirs.map((d) => readAuditRun(root, d)).sort((a, b) => String(a.drawn_at).localeCompare(String(b.drawn_at)));
  const served = runs.filter((r) => r.population === 'served' && r.controls_pass);
  const pick = (r) => r && ({
    run: r.id, label: r.label, drawn_at: r.drawn_at, n: r.n, judge: r.judge, source: r.report,
    ge4: r.groups.all.ge4, any_major: r.groups.all.any_major, weighting: r.groups.all.weighting,
  });
  return {
    runs,
    latest: pick(served.at(-1)) || null,
    previous: pick(served.at(-2)) || null,
    // A monthly branch with no judged run on main yet: drawn, waiting for the judge routine.
    pending: pendingBranches
      .map((b) => /^eval\/tca-(\d{4}-\d{2})$/.exec(b)?.[1])
      .filter((m) => m && !runs.some((r) => r.id === `monthly-${m}`))
      .map((m) => ({ month: m, branch: `eval/tca-${m}` })),
    group_labels: SCRIPT_GROUP_LABEL,
    instrument: 'translation corpus audit — Opus judge, source-grounded, reference-free (a judge rating, not accuracy)',
    instrument_source: blob('scripts/eval/translation-corpus-audit/MONTHLY.md'),
  };
}

export function buildOcr(root) {
  const f = path.join(root, OCR_EVIDENCE);
  if (!fs.existsSync(f)) return null;
  const d = readJson(f);
  const dates = (d.generated_from || []).map((g) => g.date).filter(Boolean).sort();
  const rows = (d.cells || [])
    .filter((c) => c.factor === 'script' && c.engine === d.production_engine)
    .map((c) => ({
      script: c.level, n_run: c.n_run, n: c.cer_vs_reference?.n ?? 0,
      median_cer: c.cer_vs_reference?.median ?? null, ci: c.cer_vs_reference?.ci95 ?? null, grade: c.grade,
    }))
    .sort((a, b) => b.n - a.n);
  return {
    production_engine: d.production_engine,
    measure: 'median character error rate against a ground-truth reference (lower is better)',
    latest_file_date: dates.at(-1) || null,
    n_files: (d.generated_from || []).length,
    thresholds: { directional_n: d.thresholds?.directional_n, decision_n: d.thresholds?.decision_n },
    rows,
    page: 'https://sourcelibrary.org/platform/admin/ocr-evidence?by=script',
    source: blob(OCR_EVIDENCE),
  };
}

export function buildNalanda(root) {
  const f = path.join(root, NALANDA);
  if (!fs.existsSync(f)) return [];
  const d = readJson(f);
  const out = [];
  const tib = d.tibetan_ocr_vs_derge?.kanjur_served;
  if (tib?.n) out.push({
    label: 'Tibetan Kangyur OCR vs Derge e-text', value: tib.median, value_kind: 'median identity (higher is better)',
    n: tib.n, chance: d.tibetan_ocr_vs_derge?.chance_floor_wrong_page?.median ?? null, date: d.generated, source: blob(NALANDA),
  });
  const sk = d.sanskrit_translation_fidelity?.served?.served;
  if (sk?.n) out.push({
    label: 'Sanskrit translation, two judges', value: sk.ge4 / sk.n, value_kind: 'share of judgements rated ≥ 4/5',
    n: sk.n, n_note: `${sk.n} judgements on ${(d.sanskrit_translation_fidelity.per_page || []).length} pages`,
    chance: null, date: d.generated, source: blob(NALANDA),
  });
  return out;
}

export function buildDefects(latestRun, taxonomy, issueStates = {}) {
  if (!latestRun) return null;
  const rows = latestRun.flags
    .map((f) => ({
      ...f,
      label: FLAG_LABEL[f.flag] || f.flag,
      classes: (FLAG_TO_TAXONOMY[f.flag] || []).map((code) => {
        const t = taxonomy[code];
        return {
          code, title: t?.title ?? null, issue: t?.issue ?? null,
          issue_state: t?.issue ? (issueStates[t.issue] ?? null) : null,
          url: t?.issue ? issueUrl(t.issue) : null,
        };
      }),
    }))
    .sort((a, b) => (b.est ?? -1) - (a.est ?? -1));
  return {
    run: latestRun.id, drawn_at: latestRun.drawn_at, n: latestRun.n, source: latestRun.report,
    rows, defect_types: latestRun.defect_types, taxonomy: blob(TAXONOMY),
  };
}

export function buildReport({ root, now = new Date(), reader = null, issueStates = {}, pendingBranches = [], history = null }) {
  const translation = buildTranslation(root, pendingBranches);
  const latestServed = translation.runs.filter((r) => r.population === 'served' && r.controls_pass).at(-1) || null;
  const taxonomy = parseTaxonomy(fs.readFileSync(path.join(root, TAXONOMY), 'utf8'));
  return {
    generated: now.toISOString(),
    sampling: 'Every rate on this page samples one page per book: pages in a book are one observation, not many.',
    // The four daily trend lines (#6429); null when the history store was not read (--no-mongo).
    trends: buildTrends(history, now),
    translation,
    ocr: buildOcr(root),
    other_instruments: buildNalanda(root),
    defects: buildDefects(latestServed, taxonomy, issueStates),
    reader,
  };
}

// ── IO (not exercised by the fixture test) ──────────────────────────────────

async function readerSignals(days = 30) {
  const { withMongo } = await import('../../lib/mongo.mjs');
  let result = null; // withMongo does not return the callback's value
  await withMongo(async (db) => {
    const to = new Date(), from = new Date(to.getTime() - days * 864e5);
    const fb = db.collection('feedback');
    const [reports, feedbackTotal] = await Promise.all([
      fb.find({ created_at: { $gte: from }, page_report: { $type: 'object' } }, { projection: { page_report: 1 } }).toArray(),
      fb.countDocuments({ created_at: { $gte: from } }),
    ]);
    const byKind = {}, byBook = {};
    for (const r of reports) {
      const k = r.page_report.kind || 'unclassified';
      byKind[k] = (byKind[k] || 0) + 1;
      byBook[r.page_report.book_id] = (byBook[r.page_report.book_id] || 0) + 1;
    }
    const top = Object.entries(byBook).sort((a, b) => b[1] - a[1]).slice(0, 3);
    const ids = top.map(([id]) => id);
    const books = ids.length ? await db.collection('books')
      .find({ $or: [{ id: { $in: ids } }, { _id: { $in: ids } }] }, { projection: { id: 1, title: 1, display_title: 1 } }).toArray() : [];
    const title = (id) => { const b = books.find((x) => x.id === id || String(x._id) === id); return b?.display_title || b?.title || null; };
    result = {
      window_days: days, from: from.toISOString(), to: to.toISOString(),
      page_reports: {
        total: reports.length,
        by_kind: Object.entries(byKind).map(([kind, count]) => ({ kind, count })).sort((a, b) => b.count - a.count),
        top_books: top.map(([book_id, count]) => ({ book_id, title: title(book_id), count, url: `https://sourcelibrary.org/book/${book_id}` })),
        instrument: 'feedback rows with a structured page_report (reader "report a problem", #5315)',
        instrument_since: PAGE_REPORT_LAUNCH,
      },
      feedback_total: feedbackTotal,
      poorly_read: null,
      poorly_read_note: 'The "poorly read" note is computed when a page renders and is not logged, so there is no count of how often readers saw it.',
    };
  });
  return result;
}

function issueStatesFor(numbers) {
  const out = {};
  for (const n of numbers) {
    try { out[n] = JSON.parse(execFileSync('gh', ['issue', 'view', String(n), '--json', 'state'], { encoding: 'utf8', timeout: 20000 })).state; }
    catch { out[n] = null; }
  }
  return out;
}

function pendingAuditBranches() {
  try {
    const out = execFileSync('git', ['ls-remote', '--heads', 'origin', 'eval/tca-*'], { encoding: 'utf8', timeout: 20000 });
    return out.split('\n').map((l) => l.split('refs/heads/')[1]).filter(Boolean).sort();
  } catch { return []; }
}

async function main() {
  const args = process.argv.slice(2);
  const flag = (f) => args.includes(f);
  const opt = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

  const taxonomy = parseTaxonomy(fs.readFileSync(path.join(root, TAXONOMY), 'utf8'));
  const needed = [...new Set(Object.values(FLAG_TO_TAXONOMY).flat().map((c) => taxonomy[c]?.issue).filter(Boolean))];
  const issueStates = flag('--no-github') ? {} : issueStatesFor(needed);
  const pendingBranches = flag('--no-github') ? [] : pendingAuditBranches();
  const reader = flag('--no-mongo') ? null : await readerSignals(30);

  // The history store (#6429): --push appends today's points first, then every run reads the store.
  let history = null;
  if (!flag('--no-mongo')) {
    const { withMongo } = await import('../../lib/mongo.mjs');
    await withMongo(async (db) => {
      if (flag('--push')) await recordHistory(db, { root });
      history = await readHistory(db);
    });
  }

  const data = buildReport({ root, reader, issueStates, pendingBranches, history });
  const outFile = path.join(opt('--out-dir', process.env.JOB_SCRATCH || path.join(root, 'scripts/output')), 'quality-dashboard.json');
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(data, null, 2));

  const t = data.translation.latest;
  console.log(`translation: ${t ? `${t.run} n=${t.n} ≥4 ${t.ge4.est}% any-major ${t.any_major.est}%` : 'no measurement'}`);
  console.log(`ocr: ${data.ocr ? data.ocr.rows.filter((r) => r.median_cer != null).map((r) => `${r.script} ${r.median_cer} (n=${r.n})`).join(' · ') : 'no measurement'}`);
  for (const c of data.trends ?? []) console.log(`trend ${c.id}: ${c.newest ?? 'no measurement'} · ${c.statement ?? '–'}${c.stale ? ` · STALE: ${c.stale}` : ''}`);
  console.log(`reader reports: ${data.reader?.page_reports.total ?? 'not queried'}`);
  console.log(`wrote ${outFile}`);

  if (flag('--push')) {
    const { withMongo } = await import('../../lib/mongo.mjs');
    await withMongo(async (db) => {
      const res = await db.collection('ops_reports').updateOne(
        { _id: REPORT_ID },
        { $set: { schema_version: SCHEMA_VERSION, generated_at: new Date(), generated_by: `${os.userInfo().username}@${os.hostname()} scripts/eval/quality-dashboard/build.mjs`, data } },
        { upsert: true },
      );
      console.log(`pushed ops_reports/${REPORT_ID}: matched ${res.matchedCount} modified ${res.modifiedCount} upserted ${res.upsertedCount}`);
    });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
