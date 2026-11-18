// PRIOR ART: scripts/maintenance/situation.mjs briefOf/formatBrief (the 07:23 phone brief: one FINE line, yesterday's
// pages per stage, no 7-day comparison, no split inside a lane), scripts/maintenance/pipeline-now-push.mjs collectCorpus
// (the per-day numbers this reads), src/lib/pipeline-line.ts (the whole line on /admin/pipeline: coverage and queues per
// stage, not yesterday's work). None says, per facet, what moved yesterday against the week and who moved it (v3#460).
/**
 * The daily pipeline mail by facet (v3#460), pure: every number comes from a document another job already writes
 * (the nightly corpus report pipeline-now:corpus, the 04:15 stage snapshot, pipeline_next_daily, book_checks, books
 * created) and the readers in scripts/workers/pipeline-health-alert.mjs pass them in. A facet whose source is missing
 * says "not measured"; none is invented.
 *
 * State, per facet, from yesterday (one UTC day) against the average of the days before it in the source (up to 7):
 *   moving        at least half the average
 *   slow          above zero, under half the average
 *   stopped       zero while the days before were not
 *   idle          zero, and zero all week: nothing ran, nothing is owed (never red)
 *   not measured  no source for yesterday
 */
import { GPU_DRAFT_LANE_RE } from './hand-off-stalls.mjs';

export const AVG_DAYS = 7;
export const SLOW_SHARE = 0.5;

// ───────────────────────────────────────────── classification

/** An OCR write: GPU draft, first read, re-read (re-reads and corrections of text already there), or other (hand, eval). */
export function ocrKind(lane, sub) {
  const l = String(lane || ''), s = String(sub || '');
  if (GPU_DRAFT_LANE_RE.test(l)) return 'gpu_draft';
  if (/^(volunteer-correction|manual|human)$/.test(l) || /eval|judge|by-eye|reader-report|calibrat/i.test(s)) return 'other';
  if (/re-?read|correct|ditto|repair|revert/i.test(s) || l === 'claude-opus-ocr') return 'reread';
  return 'first_read';
}

/** A translation write: seam repair, other (hand edits, by-eye fixes), or translation. */
export function translationKind(lane, sub) {
  const l = String(lane || ''), s = String(sub || '');
  if (/seam/i.test(s)) return 'seam';
  if (/^(volunteer-correction|manual|human)$/.test(l) || /apply-by-eye|apply-gloss|eval/i.test(s)) return 'other';
  return 'translate';
}

// ───────────────────────────────────────────── per-day series

const addDay = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

/**
 * Per-day series of one facet from the corpus report's work rows: { [day]: { pages, books, who: { name: pages } } }.
 * Books are summed over the facet's lanes and jobs: a book two jobs touched on one day counts twice (rare).
 */
export function workSeries(rows, field, kind) {
  const of = field === 'ocr' ? ocrKind : translationKind;
  const out = {};
  for (const r of rows ?? []) {
    if (of(r.lane, r.sub) !== kind) continue;
    const d = (out[r.day] ??= { pages: 0, books: 0, who: {} });
    d.pages += r.pages || 0;
    d.books = r.books == null || d.books == null ? null : d.books + r.books;
    const name = r.sub ? String(r.sub).replace(/^scripts\/(?:batch|lib|maintenance)\//, '') : r.lane;
    d.who[name] = (d.who[name] ?? 0) + (r.pages || 0);
  }
  return out;
}

/**
 * The corpus report's work rows, or (a report pushed before v3#460) its lane × model rows with no job and no books, so
 * the split falls back to the lane alone.
 */
export function corpusWork(corpus, field) {
  const work = corpus?.[field === 'ocr' ? 'ocr_work_per_day' : 'translated_work_per_day'];
  if (Array.isArray(work)) return { rows: work, exact: true };
  const rows = corpus?.[field === 'ocr' ? 'ocr_per_day' : 'translated_per_day'];
  return Array.isArray(rows) ? { rows: rows.map((r) => ({ ...r, sub: null, books: null })), exact: false } : null;
}

/**
 * A nightly snapshot's per-stage deltas as the work of the day before it (the 04:15 run on D counts D-1 04:15 to D
 * 04:15, which is mostly D-1): { [day]: { pages|books: delta } } for one stage. Snapshots newest first or any order.
 */
export function snapshotSeries(snaps, stage, unit) {
  const out = {};
  for (const s of snaps ?? []) {
    const st = (s.stages || []).find((x) => x.stage === stage);
    if (!st || st.delta == null || st.status && st.status !== 'ok') continue;
    out[addDay(String(s.timestamp instanceof Date ? s.timestamp.toISOString() : s.timestamp).slice(0, 10), -1)] = { [unit]: st.delta };
  }
  return out;
}

/** Books at step `done` (live), report to report, as the previous day's net change. */
export function doneSeries(nextDaily) {
  const xs = [...(nextDaily ?? [])].filter((d) => d?.day).sort((a, b) => a.day.localeCompare(b.day));
  const doneOf = (d) => d.steps?.find((x) => x.step === 'done')?.live?.books ?? null;
  const out = {};
  for (let i = 1; i < xs.length; i++) {
    const a = doneOf(xs[i - 1]), b = doneOf(xs[i]);
    if (a != null && b != null && addDay(xs[i - 1].day, 1) === xs[i].day) out[xs[i - 1].day] = { books: b - a };
  }
  return out;
}

/** The corpus report's hand-off counts (books) for one key, by day. */
export function handoffSeries(corpus, key) {
  const out = {};
  for (const r of corpus?.handoffs_per_day ?? []) if (r[key] != null) out[r.day] = { books: r[key] };
  return out;
}

// ───────────────────────────────────────────── facet rows

/** moving / slow / stopped / idle / not measured, from yesterday's value and the prior average. */
export function stateOf(y, avg) {
  if (y == null) return 'not measured';
  if (avg == null) return y > 0 ? 'moving' : 'idle';
  if (y <= 0) return avg > 0 ? 'stopped' : 'idle';
  return y < SLOW_SHARE * avg ? 'slow' : 'moving';
}

/**
 * One facet's row from its series: yesterday, the mean of up to AVG_DAYS days before it that the source has, who did it
 * (top names by pages yesterday) and the state. `unit` is the measure the state is judged on.
 */
export function facetRow({ key, label, unit, series, day, note = null, whoFixed = null, partialBefore = null, absentIsZero = true }) {
  if (!series) return { key, label, unit, y: null, avg: null, days: 0, who: [], state: 'not measured', note };
  const y = series[day] ?? null;
  const prior = [];
  for (let i = 1; i <= AVG_DAYS; i++) {
    const d = addDay(day, -i);
    if (partialBefore && d < partialBefore) break;
    if (series[d]) prior.push(series[d]);
  }
  const mean = (f) => (prior.length && prior.every((p) => p[f] != null) ? prior.reduce((a, p) => a + p[f], 0) / prior.length : null);
  const avg = prior.length ? { pages: mean('pages'), books: mean('books') } : null;
  const who = whoFixed ?? Object.entries(y?.who ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n, p]) => ({ name: n, pages: p }));
  // A day missing from a count of writes is a day with none; a day missing from a nightly snapshot is a snapshot that did not run.
  const yv = y ? (y[unit] ?? null) : (absentIsZero && Object.keys(series).length ? 0 : null);
  return {
    key, label, unit,
    y: y ? { pages: y.pages ?? null, books: y.books ?? null } : yv === 0 ? { pages: unit === 'pages' ? 0 : null, books: unit === 'books' ? 0 : null } : null,
    avg, days: prior.length, who, state: stateOf(yv, avg?.[unit] ?? null), note,
  };
}

/**
 * Every facet for `day` (YYYY-MM-DD, yesterday UTC). Inputs are the raw documents; any may be null.
 *   corpus      ops_reports pipeline-now:corpus
 *   snapshots   stage_coverage_snapshots, the last ~9
 *   nextDaily   pipeline_next_daily, the last ~9
 *   checks      [{ day, books, rows, methods: { id: books } }] from book_checks
 *   imports     [{ day, books, pages, providers: { name: books } }] from books.created_at
 */
export function facetsOf({ corpus = null, snapshots = null, nextDaily = null, checks = null, imports = null }, day) {
  const ocr = corpusWork(corpus, 'ocr'), tr = corpusWork(corpus, 'translation');
  const since = corpus?.since ? String(corpus.since).slice(0, 10) : null;
  const split = (w, f, kind) => (w ? workSeries(w.rows, f, kind) : null);
  const inexact = (w) => (w && !w.exact ? 'books and the job inside a lane need the corpus report pushed after v3#460' : null);
  const bySeries = (rows, f) => (rows ? Object.fromEntries(rows.map((r) => [r.day, { books: r.books, pages: r.pages ?? null, rows: r.rows ?? null, who: r[f] ?? {} }])) : null);
  const top = (obj) => Object.entries(obj ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name, n]) => ({ name, books: n }));
  const imp = bySeries(imports, 'providers'), chk = bySeries(checks, 'methods');
  return [
    facetRow({ key: 'import', label: 'Import (books created)', unit: 'books', series: imp, day, whoFixed: top(imp?.[day]?.who), note: 'pages = the new books\' page counts' }),
    facetRow({ key: 'archive', label: 'Archive (page images saved)', unit: 'pages', series: snapshots ? snapshotSeries(snapshots, 'archived', 'pages') : null, day, absentIsZero: false, whoFixed: [{ name: 'archivers (nightly count, net)' }] }),
    facetRow({ key: 'ocr_first', label: 'OCR: first reads', unit: 'pages', series: split(ocr, 'ocr', 'first_read'), day, partialBefore: since, note: inexact(ocr) }),
    facetRow({ key: 'ocr_gpu', label: 'OCR: GPU drafts', unit: 'pages', series: split(ocr, 'ocr', 'gpu_draft'), day, partialBefore: since }),
    facetRow({ key: 'ocr_reread', label: 'OCR: re-reads and corrections', unit: 'pages', series: split(ocr, 'ocr', 'reread'), day, partialBefore: since, note: inexact(ocr) }),
    facetRow({ key: 'translate', label: 'Translation', unit: 'pages', series: split(tr, 'translation', 'translate'), day, partialBefore: since, note: 'first translation, re-translation and finishing a book are not told apart: a page\'s translation does not record whether it replaced one' }),
    facetRow({ key: 'seam', label: 'Translation: seam repairs', unit: 'pages', series: split(tr, 'translation', 'seam'), day, partialBefore: since }),
    facetRow({ key: 'enrich', label: 'Enrichment (books summarised)', unit: 'books', series: snapshots ? snapshotSeries(snapshots, 'summaries', 'books') : null, day, absentIsZero: false, whoFixed: [{ name: 'enrich lanes (nightly count, net)' }] }),
    facetRow({ key: 'ft', label: 'First-translation search', unit: 'books', series: corpus ? handoffSeries(corpus, 'ft_search') : null, day, partialBefore: since, whoFixed: [{ name: 'ft nightly (first_translation_attempts)' }] }),
    facetRow({ key: 'pictures', label: 'Pictures (pages with pictures)', unit: 'pages', series: snapshots ? snapshotSeries(snapshots, 'images', 'pages') : null, day, absentIsZero: false, whoFixed: [{ name: 'picture extraction (nightly count, net)' }] }),
    facetRow({ key: 'qa', label: 'QA (books checked)', unit: 'books', series: chk, day, whoFixed: top(chk?.[day]?.who), note: 'book_checks rows: paired-fifths and reader reports' }),
    facetRow({ key: 'done', label: 'Books finished (net, live)', unit: 'books', series: nextDaily ? doneSeries(nextDaily) : null, day, absentIsZero: false, whoFixed: [{ name: 'pipeline_next_daily, step done' }] }),
  ];
}

/** Where live books wait, from the newest pipeline_next_daily, in line order. */
export function queueOf(nextDaily) {
  const d = [...(nextDaily ?? [])].filter((x) => x?.day).sort((a, b) => b.day.localeCompare(a.day))[0];
  if (!d) return null;
  const order = ['archive', 'ocr', 'translate', 'images', 'enrich', 'blocked'];
  const steps = order.map((s) => d.steps?.find((x) => x.step === s)).filter(Boolean)
    .map((s) => ({ step: s.step, books: s.live?.books ?? null, pages: s.live?.pages ?? null }));
  return { day: d.day, steps };
}

// ───────────────────────────────────────────── render

export const kilo = (n) => (n == null ? '?' : Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 1 : 2)}M` : Math.abs(n) >= 10_000 ? `${Math.round(n / 1000)}K` : Math.round(n).toLocaleString('en-US'));
const amount = (v, unit) => (v == null ? '?' : `${kilo(v[unit])} ${unit}`);

/** A facet's numbers in one phrase: "78K pages · 2,114 books (7-day avg 52K pages)". */
export function facetLine(f) {
  if (f.state === 'not measured') return 'not measured';
  const other = f.unit === 'pages' ? 'books' : 'pages';
  const y = f.y ? `${kilo(f.y[f.unit])} ${f.unit}${f.y[other] != null ? ` · ${kilo(f.y[other])} ${other}` : ''}` : `0 ${f.unit}`;
  const avg = f.avg?.[f.unit] != null ? ` (${f.days}-day avg ${amount(f.avg, f.unit)})` : ' (no earlier days in the source)';
  return `${y}${avg}`;
}

const whoText = (f) => (f.who || []).map((w) => (w.pages != null ? `${w.name} ${kilo(w.pages)}` : w.books != null ? `${w.name} ${kilo(w.books)}` : w.name)).join(', ');

/** The subject: the two big numbers, then what is not fine. */
export function subjectOf({ day, facets, stale, critical = [] }) {
  const get = (k) => facets.find((f) => f.key === k);
  const ocr = ['ocr_first', 'ocr_gpu', 'ocr_reread'].map(get).reduce((a, f) => a + (f?.y?.pages ?? 0), 0);
  const tr = get('translate')?.y?.pages;
  const stopped = facets.filter((f) => f.state === 'stopped').length;
  const parts = [`OCR ${kilo(ocr)} pages, translated ${kilo(tr)}`];
  if (stopped) parts.push(`${stopped} stopped`);
  if (stale?.length) parts.push(`${stale.length} stale route${stale.length === 1 ? '' : 's'}`);
  if (critical.length) parts.push(`${critical.length} critical: ${critical.map((a) => a.check).join(', ')}`);
  return `[PIPELINE] ${day.slice(5)}: ${parts.join(' · ')}`;
}

const STALE_SHOW = 5;

/** Plain text: the sample posted on the issue, and the mail's text part. */
export function formatText({ day, facets, queue, stale, staleLabel, boardAge = null, alerts = [], retired = [] }) {
  const L = [`Pipeline, ${day} (UTC day), by facet`, ''];
  for (const f of facets) {
    L.push(`${f.label}: ${f.state.toUpperCase()}`);
    L.push(`  ${facetLine(f)}`);
    const w = whoText(f);
    if (w) L.push(`  by ${w}`);
    if (f.note && f.state !== 'not measured') L.push(`  (${f.note})`);
  }
  L.push('');
  if (queue) {
    L.push(`Next in the queue (live books, ${queue.day}): ${queue.steps.map((s) => `${s.step} ${kilo(s.books)} books / ${kilo(s.pages)} pages`).join('; ')}`);
  } else L.push('Next in the queue: not measured (no pipeline_next_daily report)');
  L.push('');
  if (stale == null) L.push('Stale routes: not measured (the router board has no stale list; router-board-push.mjs has not run since v3#460)');
  else {
    L.push(`Stale routes: ${stale.length}${boardAge != null ? ` (router board ${boardAge} min old)` : ''}`);
    const by = {};
    for (const s of stale) (by[s.rule] ??= []).push(s);
    for (const [rule, xs] of Object.entries(by)) {
      L.push(`- ${staleLabel[rule] ?? rule} (${xs.length})`);
      for (const s of xs.slice(0, STALE_SHOW)) L.push(`    ${s.cell ? `${s.cell}: ` : ''}${s.why}`);
      if (xs.length > STALE_SHOW) L.push(`    and ${xs.length - STALE_SHOW} more on /admin/router`);
    }
  }
  L.push('');
  const shown = alerts.filter((a) => a.level !== 'info');
  L.push(shown.length ? `Checks (${shown.length}):` : 'Checks: nothing to report.');
  for (const a of shown) L.push(`- [${a.level}] ${a.check}: ${a.message}`);
  if (retired.length) L.push(`Retired checks (measured a lane that no longer runs): ${retired.join(', ')} (v3#460)`);
  L.push('', 'Pages: https://sourcelibrary.org/admin/pipeline · https://sourcelibrary.org/admin/router');
  return L.join('\n');
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const TONE = { moving: '#15803d', slow: '#b45309', stopped: '#b91c1c', idle: '#57534e', 'not measured': '#78716c' };

/** HTML for a phone: one block per facet, no wide tables. */
export function formatHtml({ day, facets, queue, stale, staleLabel, boardAge = null, alerts = [], retired = [] }) {
  const H = ['<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.4;color:#1c1917;max-width:640px">'];
  H.push(`<h2 style="font-size:18px;margin:0 0 12px">Pipeline, ${esc(day)} (UTC day)</h2>`);
  for (const f of facets) {
    const w = whoText(f);
    H.push(`<div style="margin:0 0 10px"><b>${esc(f.label)}</b> <span style="color:${TONE[f.state]};font-weight:600">${esc(f.state)}</span><br>`
      + `<span>${esc(facetLine(f))}</span>`
      + (w ? `<br><span style="color:#57534e;font-size:13px">by ${esc(w)}</span>` : '')
      + (f.note && f.state !== 'not measured' ? `<br><span style="color:#78716c;font-size:12px">${esc(f.note)}</span>` : '')
      + '</div>');
  }
  H.push('<h3 style="font-size:16px;margin:16px 0 6px">Next in the queue</h3>');
  H.push(queue
    ? `<p style="margin:0">Live books by next step (${esc(queue.day)}):<br>${queue.steps.map((s) => `${esc(s.step)}: ${kilo(s.books)} books, ${kilo(s.pages)} pages`).join('<br>')}</p>`
    : '<p style="margin:0">not measured (no pipeline_next_daily report)</p>');
  H.push(`<h3 style="font-size:16px;margin:16px 0 6px">Stale routes${stale ? ` (${stale.length})` : ''}</h3>`);
  if (stale == null) H.push('<p style="margin:0">not measured: the router board carries no stale list yet</p>');
  else if (!stale.length) H.push('<p style="margin:0">none</p>');
  else {
    if (boardAge != null) H.push(`<p style="margin:0 0 4px;color:#78716c;font-size:12px">router board ${boardAge} min old</p>`);
    const by = {};
    for (const s of stale) (by[s.rule] ??= []).push(s);
    for (const [rule, xs] of Object.entries(by)) {
      H.push(`<p style="margin:6px 0 2px"><b>${esc(staleLabel[rule] ?? rule)}</b> (${xs.length})</p><ul style="margin:0;padding-left:18px">`);
      for (const s of xs.slice(0, STALE_SHOW)) H.push(`<li>${s.cell ? `<code>${esc(s.cell)}</code>: ` : ''}${esc(s.why)}</li>`);
      if (xs.length > STALE_SHOW) H.push(`<li>and ${xs.length - STALE_SHOW} more on <a href="https://sourcelibrary.org/admin/router">/admin/router</a></li>`);
      H.push('</ul>');
    }
  }
  const shown = alerts.filter((a) => a.level !== 'info');
  H.push(`<h3 style="font-size:16px;margin:16px 0 6px">Checks${shown.length ? ` (${shown.length})` : ''}</h3>`);
  H.push(shown.length ? `<ul style="margin:0;padding-left:18px">${shown.map((a) => `<li><span style="color:${a.level === 'critical' ? '#b91c1c' : '#b45309'}">${esc(a.level)}</span> ${esc(a.check)}: ${esc(a.message)}</li>`).join('')}</ul>` : '<p style="margin:0">nothing to report</p>');
  if (retired.length) H.push(`<p style="color:#78716c;font-size:12px">Retired checks (they measured lanes that no longer run): ${esc(retired.join(', '))} (v3#460)</p>`);
  H.push('<p style="font-size:13px"><a href="https://sourcelibrary.org/admin/pipeline">/admin/pipeline</a> · <a href="https://sourcelibrary.org/admin/router">/admin/router</a></p></div>');
  return H.join('\n');
}
