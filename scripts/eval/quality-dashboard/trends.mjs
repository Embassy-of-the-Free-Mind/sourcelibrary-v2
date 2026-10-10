/**
 * Four daily trend lines for /admin/quality (#6429): served-text quality, reach, efficiency, bill coverage.
 *
 * PRIOR ART: scripts/audit/paid-vs-got.mjs — its daily `ops_reports` `paid-vs-got-<day>` docs already ARE the
 * efficiency and bill history; this reads them, it does not recompute them. scripts/lib/homepage-stats.mjs
 * `computeHomepageStats` — the `readable_in_english` count, but one overwritten document with no history and
 * no page figure; reach here uses the same filter and stamp-coverage rule. scripts/eval/ocr-prereg-6388/
 * panel-key.mjs — the #6388 key and scorer, reused unchanged. build.mjs (beside this) — the one-document
 * renderer feed; it had no time series, so this adds the history store it reads.
 *
 * HISTORY STORE. `bookstore.ops_reports`, one document per UTC day: `_id: quality-history-YYYY-MM-DD`,
 * `type: quality_history_daily`. Each series is one field, `$set` alone, so a re-run of the same day replaces
 * only that day's point for that series and never touches another day or another series. Every point carries
 * the date it MEASURES (efficiency for ledger day D lives in D's document, not in the day the build ran).
 *
 *   served_text_stored  #6388 panel, the text we serve today, scored against the key       daily, $0
 *   served_text_config  #6388 panel re-read with today's production prompt on flash-lite     monthly, ~$0.20 (rerun-config.mjs)
 *   reach               live books readable in English + their pages with English text       daily, $0
 *   efficiency          paid-vs-got headline: $/1,000 pages written (OCR, translation), waste daily, copied
 *   bill                paid-vs-got bill check: metered share of the invoice, per week          weekly, copied
 */
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';

export const HISTORY_TYPE = 'quality_history_daily';
export const historyId = (day) => `quality-history-${day}`;
const GH = 'https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2';
const PANEL_DIR = 'scripts/eval/ocr-prereg-6388';
const DAY_MS = 864e5;

export const STRATUM_LABEL = { 'latin-print': 'Latin print', 'zh-manuscript': 'Chinese manuscript', 'english-print': 'English print' };
const STRATUM_SHORT = { 'latin-print': 'Latin', 'zh-manuscript': 'Chinese MS', 'english-print': 'English' };
/**
 * Which key the panel is scored against. Switch here, once, when `adjudicate-6388` lands its key file:
 * { kind: 'model-adjudicated', label: 'model-adjudicated key (no human)' }.
 */
export const PANEL_KEY = { kind: 'ai-consensus', label: 'AI-consensus key', note: 'two or three AI readers agreeing; no human has checked it' };

const day = (d) => new Date(d).toISOString().slice(0, 10);
const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);
const r2 = (x) => (x == null ? null : Math.round(x * 100) / 100);
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const md = (iso) => { const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`); return `${MON[d.getUTCMonth()]} ${d.getUTCDate()}`; };
const int = (n) => Math.round(n).toLocaleString('en-US');
const usd = (n) => (n == null ? '–' : `$${n.toFixed(2)}`);
const usd0 = (n) => (n == null ? '–' : `$${int(n)}`);
const pct = (n) => (n == null ? '–' : `${n.toFixed(1)}%`);
const hash = (t) => crypto.createHash('sha1').update(t || '').digest('hex').slice(0, 12);

// ── 1. served-text quality on the #6388 panel ────────────────────────────────

/**
 * Score one set of texts (uid → read row {text, …}) on the panel against the key. Returns per-stratum mean
 * capped CER (0–1), per-page CER and a short hash of each page's text (so the next point can say how many
 * pages were re-read in between). `panel` = { sample, keyReads } from loadPanel().
 */
export function scorePanel(texts, panel, lib) {
  const { pageOf, makeKey, scoreArm, READERS, STRATA } = lib;
  const strata = {}, per_page = {}, hashes = {};
  for (const st of STRATA) {
    const cers = [];
    for (const s of panel.sample.filter((x) => x.stratum === st)) {
      const page = pageOf(s, { ...panel.keyReads, X: texts });
      const k = panel.keys.get(s.uid) ?? makeKey(page, READERS(st));
      panel.keys.set(s.uid, k);
      const c = scoreArm(page, k, 'X');
      per_page[s.uid] = c == null ? null : Math.round(c * 1e4) / 1e4;
      hashes[s.uid] = hash(texts.get(s.uid)?.text);
      if (c != null) cers.push(c);
    }
    strata[st] = { mean_cer: cers.length ? Math.round((cers.reduce((a, b) => a + b, 0) / cers.length) * 1e4) / 1e4 : null, n: panel.sample.filter((x) => x.stratum === st).length, n_scored: cers.length };
  }
  return { strata, per_page, hashes };
}

export async function loadPanel(root) {
  const lib = await import(path.join(root, PANEL_DIR, 'panel-key.mjs'));
  const keyArms = ['G', 'S', 'O'];
  return { lib, panel: { sample: lib.readSample(), keyReads: Object.fromEntries(keyArms.map((a) => [a, lib.readArm(a)])), keys: new Map() } };
}

// ── 3 & 4. efficiency and bill, copied from paid-vs-got ──────────────────────

export function efficiencyPoint(doc) {
  const lane = (l) => {
    const h = (doc.headline || []).find((x) => x.lane === l);
    return h ? { per_1k_usd: h.per_1k_usd ?? null, pages: h.pages_written ?? 0, paid_usd: h.paid_usd ?? 0, waste_usd: h.waste_usd ?? 0, waste_pct: h.waste_pct ?? null } : null;
  };
  const ocr = lane('ocr'), translation = lane('translation');
  const paid = (ocr?.paid_usd || 0) + (translation?.paid_usd || 0);
  const waste = (ocr?.waste_usd || 0) + (translation?.waste_usd || 0);
  return { date: doc.day, ocr, translation, waste_pct: paid > 0 ? r2((100 * waste) / paid) : null, source: `ops_reports/${doc._id}` };
}

/** Bill weeks from paid-vs-got docs that COMPUTED them (carried copies skipped); a later computation wins. */
export function billPoints(docs) {
  const byWeek = new Map();
  for (const d of [...docs].sort((a, b) => String(a.day).localeCompare(String(b.day)))) {
    if (!d.bill?.weeks || d.bill.carried) continue;
    for (const w of d.bill.weeks) {
      byWeek.set(w.to, { date: w.to, week_from: w.from, week_to: w.to, billed_usd: w.billed_usd, metered_usd: w.metered_usd, metered_pct: w.metered_pct ?? null, computed_in: `ops_reports/${d._id}` });
    }
  }
  return [...byWeek.values()];
}

// ── assembling the four charts (pure; the page renders exactly this) ─────────

const points = (docs, field) => docs.filter((d) => d[field]).map((d) => d[field]).sort((a, b) => a.date.localeCompare(b.date));
/** The newest point at least `days` before `ref`, else null. */
const before = (pts, ref, days) => [...pts].reverse().find((p) => Date.parse(ref) - Date.parse(p.date) >= days * DAY_MS) ?? null;
function staleNote(newest, now, maxAgeDays, cadence) {
  if (!newest) return null;
  const age = Math.floor((Date.parse(day(now)) - Date.parse(newest)) / DAY_MS);
  return age > maxAgeDays ? `No new point since ${md(newest)}; expected ${cadence}.` : null;
}

function qualityChart(docs, now) {
  const stored = points(docs, 'served_text_stored');
  const config = points(docs, 'served_text_config');
  const latest = stored.at(-1);
  const strata = Object.keys(STRATUM_LABEL);
  const series = strata.flatMap((st, i) => [
    {
      key: `stored:${st}`, label: STRATUM_LABEL[st], slot: i + 1, style: 'line', cadence_days: 1,
      points: stored.filter((p) => p.strata?.[st]?.mean_cer != null).map((p) => ({
        date: p.date, value: r1(100 * p.strata[st].mean_cer),
        tip: `${STRATUM_LABEL[st]}, stored text: ${pct(100 * p.strata[st].mean_cer)} (${p.strata[st].n_scored} pages)`,
      })),
    },
    {
      key: `config:${st}`, label: `${STRATUM_LABEL[st]}, re-run`, slot: i + 1, style: 'dots', cadence_days: 31, legend: false,
      points: config.filter((p) => p.strata?.[st]?.mean_cer != null).map((p) => ({
        date: p.date, value: r1(100 * p.strata[st].mean_cer),
        tip: `${STRATUM_LABEL[st]}, re-run with ${p.model}: ${pct(100 * p.strata[st].mean_cer)}`,
      })),
    },
  ]);
  let statement = null;
  if (latest) {
    const now_ = strata.map((st) => `${STRATUM_SHORT[st]} ${pct(latest.strata?.[st]?.mean_cer == null ? null : 100 * latest.strata[st].mean_cer)}`).join(', ');
    const prev = before(stored, latest.date, 7) ?? (stored.length > 1 ? stored[0] : null);
    let cmp = 'First point; nothing earlier to compare.';
    if (prev) {
      const changed = Object.keys(latest.hashes || {}).filter((u) => prev.hashes?.[u] && prev.hashes[u] !== latest.hashes[u]).length;
      const deltas = strata.map((st) => {
        const a = latest.strata?.[st]?.mean_cer, b = prev.strata?.[st]?.mean_cer;
        if (a == null || b == null) return null;
        const d = r1(100 * (a - b));
        return d === 0 ? null : `${STRATUM_SHORT[st]} ${d > 0 ? 'worse' : 'better'} by ${Math.abs(d).toFixed(1)} pts`;
      }).filter(Boolean);
      cmp = changed === 0 ? `No panel page re-read since ${md(prev.date)}; unchanged.`
        : `${changed} of ${Object.keys(latest.hashes).length} panel pages re-read since ${md(prev.date)}${deltas.length ? `: ${deltas.join(', ')}` : '; means unchanged'}.`;
    }
    statement = `Mean error of the text we serve: ${now_}. ${cmp}`;
  }
  const lastConfig = config.at(-1);
  return {
    id: 'quality', title: 'Served-text quality', unit: 'pct', y_label: 'mean character error, capped (lower is better)', lower_is_better: true,
    newest: latest?.date ?? null, statement, stale: staleNote(latest?.date, now, 2, 'daily'),
    key_type: PANEL_KEY.label, key_note: PANEL_KEY.note,
    panel_note: `Fixed panel of ${latest ? Object.keys(latest.hashes || {}).length : 'the #6388'} pages, one per book.`,
    extra_legend: lastConfig ? [{ style: 'dots', label: `Open dots: same pages re-read with ${lastConfig.model} and today's prompt, ${md(lastConfig.date)} (monthly)` }]
      : [{ style: 'dots', label: 'Re-run with today\'s production config: no measurement yet' }],
    series,
    source: `${GH}/tree/main/${PANEL_DIR}`,
  };
}

function reachChart(docs, now) {
  const pts = points(docs, 'reach').filter((p) => p.books != null);
  const latest = pts.at(-1);
  let statement = null;
  if (latest) {
    const prev = before(pts, latest.date, 7) ?? (pts.length > 1 ? pts[0] : null);
    const sign = (n) => (n > 0 ? `+${int(n)}` : n < 0 ? `−${int(-n)}` : 'no change');
    statement = `${int(latest.books)} books, ${int(latest.pages)} pages readable in English. `
      + (prev ? `Since ${md(prev.date)}: ${sign(latest.books - prev.books)} books, ${sign(latest.pages - prev.pages)} pages.` : 'First point; the counters keep no earlier history.');
  }
  return {
    id: 'reach', title: 'Reach', unit: 'count', y_label: 'live books readable in English (readable_in_english)', lower_is_better: false,
    newest: latest?.date ?? null, statement, stale: staleNote(latest?.date, now, 2, 'daily'),
    series: [{
      key: 'books', label: 'Books', slot: 1, style: 'line', cadence_days: 1,
      points: pts.map((p) => ({ date: p.date, value: p.books, tip: `${int(p.books)} books · ${int(p.pages)} pages with English text` })),
    }],
    source: `${GH}/blob/main/.claude/docs/translation-state.md`,
  };
}

function pooled(pts, from, to, lane) {
  const inWin = pts.filter((p) => p.date > from && p.date <= to && p[lane]);
  const paid = inWin.reduce((a, p) => a + p[lane].paid_usd, 0), pages = inWin.reduce((a, p) => a + p[lane].pages, 0);
  return { days: inWin.length, pages, per_1k: pages ? (1000 * paid) / pages : null };
}
function pooledWaste(pts, from, to) {
  const inWin = pts.filter((p) => p.date > from && p.date <= to);
  let paid = 0, waste = 0;
  for (const p of inWin) for (const l of ['ocr', 'translation']) if (p[l]) { paid += p[l].paid_usd; waste += p[l].waste_usd; }
  return paid > 0 ? (100 * waste) / paid : null;
}

function efficiencyChart(docs, now) {
  const pts = points(docs, 'efficiency');
  const latest = pts.at(-1);
  let statement = null;
  if (latest) {
    const end = latest.date, mid = day(Date.parse(end) - 7 * DAY_MS), start = day(Date.parse(end) - 14 * DAY_MS);
    const cur = { o: pooled(pts, mid, end, 'ocr'), t: pooled(pts, mid, end, 'translation'), w: pooledWaste(pts, mid, end) };
    const old = { o: pooled(pts, start, mid, 'ocr'), t: pooled(pts, start, mid, 'translation'), w: pooledWaste(pts, start, mid) };
    statement = `7 days to ${md(end)}: OCR ${usd(cur.o.per_1k)} per 1,000 pages (${int(cur.o.pages)} pages), translation ${usd(cur.t.per_1k)} (${int(cur.t.pages)}); ${pct(cur.w)} waste. `
      + (old.o.days || old.t.days ? `The 7 days before: ${usd(old.o.per_1k)}, ${usd(old.t.per_1k)}; ${pct(old.w)} waste${old.o.days < 7 ? ` (${old.o.days} days of ledger)` : ''}.` : 'No ledger for the week before.');
  }
  const lane = (l, label, slot) => ({
    key: l, label, slot, style: 'line', cadence_days: 1,
    points: pts.filter((p) => p[l]?.per_1k_usd != null).map((p) => ({
      date: p.date, value: p[l].per_1k_usd,
      tip: `${label}: ${usd(p[l].per_1k_usd)} per 1,000 pages · ${int(p[l].pages)} pages · ${pct(p[l].waste_pct)} waste`,
    })),
  });
  return {
    id: 'efficiency', title: 'Cost per page', unit: 'usd', y_label: 'dollars per 1,000 pages written, by ledger day (a low-volume day is noisy)', lower_is_better: true,
    newest: latest?.date ?? null, statement, stale: staleNote(latest?.date, now, 2, 'daily (paid-vs-got, 05:00 UTC)'),
    series: [lane('ocr', 'OCR', 1), lane('translation', 'Translation', 2)],
    source: `${GH}/blob/main/scripts/audit/paid-vs-got.mjs`,
  };
}

function billChart(docs, now) {
  const pts = points(docs, 'bill').filter((p) => p.metered_pct != null);
  const latest = pts.at(-1);
  let statement = null;
  if (latest) {
    const prev = pts.at(-2);
    statement = `Week ${md(latest.week_from)}–${md(latest.week_to)}: the meter saw ${pct(latest.metered_pct)} of the Gemini bill (${usd0(latest.metered_usd)} of ${usd0(latest.billed_usd)}). `
      + (prev ? `Week before: ${pct(prev.metered_pct)}.` : 'First week measured.');
  }
  return {
    id: 'bill', title: 'Bill coverage', unit: 'pct', y_label: 'metered spend as a share of billed, per week (below the line: spend the meter missed)', lower_is_better: false,
    newest: latest?.date ?? null, statement, stale: staleNote(latest?.date, now, 13, 'weekly (Mondays)'),
    ref: { value: 100, label: 'billed' },
    series: [{
      key: 'metered', label: 'Metered ÷ billed', slot: 1, style: 'line', cadence_days: 7,
      points: pts.map((p) => ({ date: p.date, value: p.metered_pct, tip: `Week ${md(p.week_from)}–${md(p.week_to)}: ${pct(p.metered_pct)} · ${usd0(p.metered_usd)} of ${usd0(p.billed_usd)}` })),
    }],
    source: `${GH}/blob/main/scripts/audit/paid-vs-got.mjs`,
  };
}

export function buildTrends(historyDocs, now = new Date()) {
  if (!historyDocs) return null;
  return [qualityChart(historyDocs, now), reachChart(historyDocs, now), efficiencyChart(historyDocs, now), billChart(historyDocs, now)];
}

// ── IO: write today's points, backfill, read the history ─────────────────────

export async function writePoint(db, date, field, value, { ifAbsent = false } = {}) {
  const col = db.collection('ops_reports');
  if (ifAbsent && (await col.findOne({ _id: historyId(date), [field]: { $exists: true } }, { projection: { _id: 1 } }))) return 'kept';
  await col.updateOne(
    { _id: historyId(date) },
    { $set: { type: HISTORY_TYPE, day: date, [field]: { ...value, date }, [`written_at.${field}`]: new Date() } },
    { upsert: true },
  );
  return 'written';
}

/** Reach: the live `readable_in_english` books and their pages with English text. Null when stamps are incomplete. */
export async function measureReach(db) {
  const { READABLE_IN_ENGLISH_FILTER, translationStateStampCoverage } = await import('../../lib/page-counts.mjs');
  const { LIVE_BOOK_FILTER } = await import('../../lib/homepage-stats.mjs');
  const books = db.collection('books');
  const cov = await translationStateStampCoverage(books, { ...LIVE_BOOK_FILTER });
  if (!cov.ok) return { skipped: `only ${cov.stamped}/${cov.total} live books carry translation_state` };
  const [agg] = await books.aggregate([
    { $match: { ...LIVE_BOOK_FILTER, ...READABLE_IN_ENGLISH_FILTER } },
    // An English original's text is English once OCR'd; any other book counts its translated pages.
    { $group: { _id: null, books: { $sum: 1 }, pages: { $sum: { $cond: [{ $eq: ['$translation_state.english_original', true] }, { $ifNull: ['$translation_state.ocr', 0] }, { $ifNull: ['$translation_state.translated', 0] }] } } } },
  ]).toArray();
  return { books: agg?.books ?? 0, pages: agg?.pages ?? 0, stamped_share: r2(cov.share), view: 'readable_in_english', filter: 'visible && pages_count > 0' };
}

/** The panel's stored text today, from `pages` (read-only). */
export async function measureStoredText(db, root) {
  const { lib, panel } = await loadPanel(root);
  const ids = panel.sample.map((s) => s.page_id);
  const rows = await db.collection('pages').find({ id: { $in: ids } }, { projection: { _id: 0, id: 1, 'ocr.data': 1, 'ocr.model': 1 } }).toArray();
  const byId = new Map(rows.map((p) => [p.id, p]));
  const texts = new Map(panel.sample.map((s) => [s.uid, { text: byId.get(s.page_id)?.ocr?.data || '' }]));
  const missing = panel.sample.filter((s) => !byId.has(s.page_id)).length;
  return { ...scorePanel(texts, panel, lib), key: PANEL_KEY.kind, missing_pages: missing };
}

/** The #6388 files as the panel's first points (2026-10-10): P = stored text, L1 = flash-lite with the live prompt. */
export async function panelFilePoints(root) {
  const { lib, panel } = await loadPanel(root);
  const P = lib.readArm('P'), L1 = lib.readArm('L1');
  const results = JSON.parse(fs.readFileSync(path.join(root, PANEL_DIR, 'results.json'), 'utf8'));
  const date = day(results.generated_at);
  const l1Model = [...L1.values()].find((r) => r.model)?.model ?? null;
  return {
    date,
    stored: { ...scorePanel(P, panel, lib), key: PANEL_KEY.kind, source: `${PANEL_DIR}/reads/P.jsonl.gz` },
    config: { ...scorePanel(L1, panel, lib), key: PANEL_KEY.kind, model: l1Model, source: `${PANEL_DIR}/reads/L1.jsonl.gz`, spend_usd: r2([...L1.values()].reduce((a, r) => a + (r.cost || 0), 0)) },
  };
}

/**
 * The daily step: copy every paid-vs-got day and bill week in, measure today's stored text and reach,
 * backfill the panel's first points if absent. Returns a log of what was written.
 */
export async function recordHistory(db, { root, now = new Date(), log = console.log } = {}) {
  const today = day(now);
  const pvg = await db.collection('ops_reports').find({ type: 'paid_vs_got_daily' }, { projection: { day: 1, headline: 1, bill: 1 } }).toArray();
  for (const d of pvg) if (d.day && d.headline) await writePoint(db, d.day, 'efficiency', efficiencyPoint(d));
  const weeks = billPoints(pvg);
  for (const w of weeks) await writePoint(db, w.date, 'bill', w);
  log(`history: efficiency ${pvg.length} ledger days, bill ${weeks.length} weeks`);

  const files = await panelFilePoints(root);
  log(`history: panel files ${files.date} stored ${await writePoint(db, files.date, 'served_text_stored', files.stored, { ifAbsent: true })}, config ${await writePoint(db, files.date, 'served_text_config', files.config, { ifAbsent: true })}`);

  const stored = await measureStoredText(db, root);
  await writePoint(db, today, 'served_text_stored', { ...stored, source: 'pages.ocr.data (live read)' });
  log(`history: stored text ${today} ${Object.entries(stored.strata).map(([k, v]) => `${k} ${v.mean_cer}`).join(' · ')}${stored.missing_pages ? ` (${stored.missing_pages} panel pages not found)` : ''}`);

  const reach = await measureReach(db);
  if (reach.skipped) log(`history: reach NOT written — ${reach.skipped}`);
  else { await writePoint(db, today, 'reach', reach); log(`history: reach ${today} ${reach.books} books ${reach.pages} pages`); }
}

export async function readHistory(db, { days = 120 } = {}) {
  return db.collection('ops_reports').find({ type: HISTORY_TYPE }).sort({ day: -1 }).limit(days).toArray().then((a) => a.reverse());
}
