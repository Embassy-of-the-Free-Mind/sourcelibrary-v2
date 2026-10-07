import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { getQualityReport, type QualityData, type Rate, type Interval } from '@/lib/quality-report';
import { LaneWindows, TranslationTrend } from './QualityCharts';

/**
 * /admin/quality — is the text we serve good, and is it getting better? (#5474)
 *
 * Renderer only. Every figure, label, date and link comes from `ops_reports/quality-dashboard`,
 * written by scripts/eval/quality-dashboard/build.mjs --push from the instruments' result files.
 * The page computes nothing; a missing instrument reads "no measurement", never zero.
 * tests/unit/quality-page-literals.test.ts fails if a figure is typed into this directory.
 * Gate: the admin layout's requireAdmin(); refused on partner hosts (tenant-global-paths);
 * X-Robots-Tag noindex (next.config.ts).
 */
export const metadata: Metadata = {
  title: 'Quality',
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const pct = (v: number | null | undefined) => (v == null ? '—' : `${v.toFixed(1)}%`);
const ci = (c: Interval) => (c ? `${c[0].toFixed(1)}–${c[1].toFixed(1)}` : 'no interval');
const day = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '—';

/** Palette: dataviz reference slots 1–2 (blue, orange) and neutrals, stepped separately for dark. */
const THEME = `
.q-root{color-scheme:light;--q-bg:#f7f6f3;--q-surface:#fcfcfb;--q-text:#1c1b19;--q-muted:#6b6a65;--q-border:#e4e2dc;--q-grid:#ecebe6;--q-link:#a4472a;--q-s1:#2a78d6;--q-s2:#eb6834;--q-warn:#9a6700;--q-bad:#b42318;--q-good:#1a7f37}
@media (prefers-color-scheme:dark){:root:where(:not([data-theme="light"])) .q-root{color-scheme:dark;--q-bg:#141413;--q-surface:#1a1a19;--q-text:#f2f1ec;--q-muted:#a9a89f;--q-border:#34332f;--q-grid:#2a2926;--q-link:#f0a07f;--q-s1:#3987e5;--q-s2:#d95926;--q-warn:#e3b341;--q-bad:#f47067;--q-good:#57ab5a}}
:root[data-theme="dark"] .q-root{color-scheme:dark;--q-bg:#141413;--q-surface:#1a1a19;--q-text:#f2f1ec;--q-muted:#a9a89f;--q-border:#34332f;--q-grid:#2a2926;--q-link:#f0a07f;--q-s1:#3987e5;--q-s2:#d95926;--q-warn:#e3b341;--q-bad:#f47067;--q-good:#57ab5a}
.q-root a{color:var(--q-link)} .q-root a:hover{text-decoration:underline}
.q-card{background:var(--q-surface);border:1px solid var(--q-border);border-radius:6px}
.q-muted{color:var(--q-muted)}
.q-table{font-size:13px;min-width:100%} .q-table th{font-weight:500;text-align:left;padding:4px 8px;color:var(--q-muted);font-size:12px;border-bottom:1px solid var(--q-border);white-space:nowrap}
.q-table td{padding:4px 8px;border-bottom:1px solid var(--q-grid);font-variant-numeric:tabular-nums;vertical-align:top}
`;

function Section({ n, title, sub, children }: { n: number; title: string; sub?: ReactNode; children: ReactNode }) {
  return (
    <section className="grid gap-3 content-start min-w-0">
      <div className="grid gap-0.5">
        <h2 className="text-base font-semibold">{n}. {title}</h2>
        {sub && <p className="text-xs q-muted max-w-3xl leading-snug">{sub}</p>}
      </div>
      {children}
    </section>
  );
}

function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto q-card">
      <table className="q-table">
        <thead><tr>{head.map(h => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function NoMeasurement({ what, last }: { what: string; last?: ReactNode }) {
  return (
    <div className="q-card px-4 py-3 text-sm">
      <b>No measurement</b> <span className="q-muted">— {what}{last ? <> · {last}</> : null}</span>
    </div>
  );
}

/** One headline figure: value, interval, n, instrument, date, source — and the run before it. */
function Headline({ label, rate, prev, n, instrument, date, href, prevLabel, lowerIsBetter }: {
  label: string; rate: Rate; prev: Rate | null; n: number; instrument: string; date: string; href: string;
  prevLabel: string | null; lowerIsBetter?: boolean;
}) {
  const delta = prev ? rate.est - prev.est : null;
  const worse = delta != null && (lowerIsBetter ? delta > 0 : delta < 0);
  return (
    <div className="q-card px-4 py-3 grid gap-1 content-start">
      <div className="text-sm">{label}</div>
      <div className="flex items-baseline gap-3 flex-wrap">
        <span className="text-3xl font-semibold tabular-nums">{pct(rate.est)}</span>
        <span className="text-xs q-muted tabular-nums">{rate.ci_kind} {ci(rate.ci)}</span>
      </div>
      <div className="text-xs q-muted">
        n = {n} pages, one per book · {instrument} · drawn {date} · <a href={href}>source</a>
      </div>
      <div className="text-xs">
        {prev && prevLabel ? (
          <>Previous ({prevLabel}): <span className="tabular-nums">{pct(prev.est)}</span>{' '}
            <span className="q-muted tabular-nums">({ci(prev.ci)})</span>{' '}
            <span style={{ color: worse ? 'var(--q-warn)' : 'var(--q-muted)' }}>
              {delta! > 0 ? '▲' : delta! < 0 ? '▼' : '='} {Math.abs(delta!).toFixed(1)} pp — intervals {
                rate.ci && prev.ci && (rate.ci[0] > prev.ci[1] || prev.ci[0] > rate.ci[1]) ? 'do not overlap' : 'overlap: not a measured change'}
            </span></>
        ) : <span className="q-muted">No earlier run to compare.</span>}
      </div>
    </div>
  );
}

const VERDICT_COLOR: Record<string, string> = { OK: 'var(--q-good)', WARN: 'var(--q-warn)', ABORT: 'var(--q-bad)' };

export default async function QualityPage() {
  const doc = await getQualityReport();
  if (!doc) {
    return (
      <main className="q-root px-6 py-8 max-w-5xl mx-auto grid gap-4 min-h-screen" style={{ background: 'var(--q-bg)', color: 'var(--q-text)' }}>
        <style>{THEME}</style>
        <h1 className="text-2xl font-semibold">Quality</h1>
        <p className="text-sm q-muted max-w-2xl">
          No report has been pushed yet. Run <code>scripts/eval/quality-dashboard/build.mjs --push</code>; the page reads the
          document it writes and needs no deploy.
        </p>
      </main>
    );
  }

  const D: QualityData = doc.data;
  const T = D.translation;
  const generated = typeof doc.generated_at === 'string' ? doc.generated_at : doc.generated_at?.toISOString?.() ?? D.generated;
  const latestRun = T.latest ? T.runs.find(r => r.id === T.latest!.run) : null;

  return (
    <main className="q-root px-4 sm:px-6 py-6 grid gap-8 min-h-screen" style={{ background: 'var(--q-bg)', color: 'var(--q-text)' }}>
      <style>{THEME}</style>
      <div className="max-w-6xl w-full mx-auto grid gap-8">
        <header className="grid gap-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
            <h1 className="text-2xl font-semibold">Is the text we serve good, and is it getting better?</h1>
            <div className="text-xs q-muted">generated {day(generated)} by {doc.generated_by} · read only</div>
          </div>
          <p className="text-xs q-muted max-w-3xl">
            {D.sampling} A judge rating is not accuracy: only a ground-truth reference measures accuracy, and only the OCR rows below have one.
          </p>
        </header>

        {/* 1 — Headline */}
        <Section n={1} title="Headline">
          {T.latest ? (
            <div className="grid gap-3 md:grid-cols-2">
              <Headline label="Served translated pages judged ≥ 4 of 5" rate={T.latest.ge4} prev={T.previous?.ge4 ?? null}
                n={T.latest.n} instrument={`${T.latest.label}, ${T.latest.judge} judge`} date={day(T.latest.drawn_at)} href={T.latest.source}
                prevLabel={T.previous ? `${T.previous.label}, n = ${T.previous.n}, drawn ${day(T.previous.drawn_at)}` : null} />
              <Headline label="Served translated pages with any major defect" rate={T.latest.any_major} prev={T.previous?.any_major ?? null}
                n={T.latest.n} instrument={`${T.latest.label}, ${T.latest.judge} judge`} date={day(T.latest.drawn_at)} href={T.latest.source}
                prevLabel={T.previous ? `${T.previous.label}, n = ${T.previous.n}, drawn ${day(T.previous.drawn_at)}` : null} lowerIsBetter />
            </div>
          ) : <NoMeasurement what="no translation corpus audit with passing controls is on main" />}
          {T.pending.length > 0 && (
            <p className="text-xs q-muted">
              Drawn, not yet judged: {T.pending.map(p => <code key={p.branch} className="mr-2">{p.branch}</code>)} — the judge routine lands it on main.
            </p>
          )}
          {D.ocr ? (
            <div className="grid gap-1">
              <div className="text-sm">
                OCR by script — {D.ocr.measure}, production engine <code>{D.ocr.production_engine}</code>
              </div>
              <Table head={['Script', 'Median CER', '95% CI', 'Pages with reference', 'Pages run', 'Grade']}>
                {D.ocr.rows.map(r => (
                  <tr key={r.script} className={r.median_cer == null ? 'q-muted' : ''}>
                    <td>{r.script}</td>
                    <td>{r.median_cer == null ? 'no measurement' : r.median_cer.toFixed(3)}</td>
                    <td>{r.ci ? `${r.ci[0].toFixed(3)}–${r.ci[1].toFixed(3)}` : '—'}</td>
                    <td>{r.n}</td>
                    <td>{r.n_run}</td>
                    <td>{r.grade}</td>
                  </tr>
                ))}
              </Table>
              <div className="text-xs q-muted">
                {D.ocr.n_files} benchmark files, newest {day(D.ocr.latest_file_date)} · grade: directional from {D.ocr.thresholds.directional_n} referenced books,
                decision-grade from {D.ocr.thresholds.decision_n} · <a href={D.ocr.page}>OCR evidence page</a> · <a href={D.ocr.source}>source</a>
              </div>
            </div>
          ) : <NoMeasurement what="OCR evidence file not found" />}
          {D.other_instruments.length > 0 && (
            <Table head={['Script-specific check', 'Value', 'Measure', 'n', 'Chance floor', 'Date', '']}>
              {D.other_instruments.map(o => (
                <tr key={o.label}>
                  <td>{o.label}</td>
                  <td>{o.value.toFixed(2)}</td>
                  <td className="q-muted">{o.value_kind}</td>
                  <td>{o.n_note ?? o.n}</td>
                  <td>{o.chance == null ? '—' : o.chance.toFixed(2)}</td>
                  <td>{day(o.date)}</td>
                  <td><a href={o.source}>source</a></td>
                </tr>
              ))}
            </Table>
          )}
        </Section>

        {/* 2 — Translation over time */}
        <Section n={2} title="Translation over time" sub={<>{T.instrument}. Served-corpus runs are post-stratified by language with a bootstrap interval;
          script groups are unweighted with a Wilson interval. The chained-lane sample is a different population (pages the new lane wrote), shown beside the line, not on it.
          {' '}<a href={T.instrument_source}>How the monthly audit runs</a>.</>}>
          {T.runs.length ? (
            <div className="q-card p-3 grid gap-3">
              <TranslationTrend runs={T.runs} groupLabels={T.group_labels} />
              <Table head={['Run', 'Population', 'Drawn', 'n', '≥ 4 of 5', 'Any major', 'Controls', '']}>
                {T.runs.map(r => (
                  <tr key={r.id}>
                    <td>{r.label}</td>
                    <td>{r.population}</td>
                    <td>{day(r.drawn_at)}</td>
                    <td>{r.n}</td>
                    <td>{pct(r.groups.all?.ge4.est)} <span className="q-muted">({ci(r.groups.all?.ge4.ci ?? null)})</span></td>
                    <td>{pct(r.groups.all?.any_major.est)} <span className="q-muted">({ci(r.groups.all?.any_major.ci ?? null)})</span></td>
                    <td style={{ color: r.controls_pass ? 'var(--q-good)' : 'var(--q-bad)' }}>{r.controls_pass ? 'pass' : 'FAIL — not reported'}</td>
                    <td><a href={r.report}>report</a></td>
                  </tr>
                ))}
              </Table>
            </div>
          ) : <NoMeasurement what="no corpus audit runs found" />}
        </Section>

        {/* 3 — Lanes under test */}
        <Section n={3} title="Lanes under test" sub={<>Speed-test gate windows from the {D.lanes.ledger}. Each window judges a fresh one-page-per-book
          draw of what the lane wrote, with swap/drop/repeat controls.{D.lanes.trend_rule && <> Trend warning when two windows in a row exceed the
          chained-lane baseline plus the judge&apos;s {D.lanes.trend_rule.floor_pp} pp noise floor ({pct(D.lanes.trend_rule.bound_pct)}); a warning is not an abort.</>}
          {' '}<a href={D.lanes.issue}>Issue</a>.</>}>
          {D.lanes.windows.length ? (
            <div className="q-card p-3 grid gap-3">
              <LaneWindows lanes={D.lanes} />
              <Table head={['Window (UTC)', 'Verdict', 'Major', 'Wilson 95%', 'Seeded / seam', 'Controls', 'Trend', 'Scope warnings']}>
                {[...D.lanes.windows].reverse().map(w => (
                  <tr key={w.window}>
                    <td className="whitespace-nowrap">{w.window.replace('T', ' ').replace(/:00(\.000)?Z/g, '').replace('/', ' → ')}</td>
                    <td style={{ color: VERDICT_COLOR[w.verdict] ?? 'inherit', fontWeight: 600 }}>{w.verdict}</td>
                    <td>{pct(w.major_pct)} <span className="q-muted">({w.defective}/{w.n})</span></td>
                    <td className="q-muted">{ci(w.ci)}</td>
                    <td>{w.seeded ? `${w.seeded.major}/${w.seeded.n}` : '—'} · {w.seam ? `${w.seam.major}/${w.seam.n}` : '—'}</td>
                    <td className="q-muted">{w.controls ? Object.entries(w.controls).map(([k, v]) => `${k} ${v}`).join(' · ') : '—'}</td>
                    <td style={{ color: w.trend_warn ? 'var(--q-warn)' : 'var(--q-muted)' }}>{w.trend_warn ? 'WARN' : '—'}</td>
                    <td>{w.warn_count || '—'}</td>
                  </tr>
                ))}
              </Table>
              {D.lanes.baseline && (
                <p className="text-xs q-muted">
                  Reference line: {D.lanes.baseline.label}, {pct(D.lanes.baseline.any_major.est)} any major defect
                  ({D.lanes.baseline.any_major.ci_kind} {ci(D.lanes.baseline.any_major.ci)}), n = {D.lanes.baseline.n}, drawn {day(D.lanes.baseline.drawn_at)} · <a href={D.lanes.baseline.source}>report</a>.
                  Window rates are unweighted and include seam pages; the baseline is post-stratified.
                </p>
              )}
            </div>
          ) : <NoMeasurement what={D.lanes.missing ? `ledger not found when the report was built (${D.lanes.ledger})` : 'no judged windows in the ledger'} />}
        </Section>

        {/* 4 — Quality round 1 */}
        <Section n={4} title="Quality round 1" sub={<>Per-stratum cost, time and quality of the full pipeline on freshly drawn books. <a href={D.round1.issue}>Issue</a> · <a href={D.round1.preregistration}>preregistration</a>.</>}>
          {D.round1.status === 'done' && D.round1.rows.length ? (
            <Table head={['Stratum', 'n', 'Cost / book', 'Days', 'OCR score', 'Translation major', 'Verdict']}>
              {D.round1.rows.map(r => (
                <tr key={r.stratum}>
                  <td>{r.stratum}</td><td>{r.n ?? '—'}</td>
                  <td>{r.cost_per_book_usd == null ? '—' : `$${r.cost_per_book_usd.toFixed(2)}`}</td>
                  <td>{r.days ?? '—'}</td><td>{r.ocr_score ?? '—'}</td><td>{pct(r.translation_major_pct)}</td><td>{r.verdict ?? '—'}</td>
                </tr>
              ))}
            </Table>
          ) : <NoMeasurement what="not yet run — no results file on main" last={D.round1.drawn ? <>books drawn {day(D.round1.drawn)}</> : undefined} />}
        </Section>

        {/* 5 — Defect classes */}
        <Section n={5} title="Defect classes" sub={D.defects ? <>From the latest served-corpus audit ({latestRun?.label ?? D.defects.run}, n = {D.defects.n}, drawn {day(D.defects.drawn_at)}).
          Each judge flag is mapped to its nearest <a href={D.defects.taxonomy}>page-error taxonomy</a> class; the link is that class&apos;s issue. <a href={D.defects.source}>Report</a>.</> : undefined}>
          {D.defects ? (
            <Table head={['Judge flag', 'Corpus estimate', '95% CI', 'Pages flagged', 'Taxonomy class · issue']}>
              {D.defects.rows.map(r => (
                <tr key={r.flag}>
                  <td>{r.label}</td>
                  <td>{pct(r.est)}</td>
                  <td className="q-muted">{ci(r.ci)}</td>
                  <td>{r.count == null ? '—' : `${r.count}/${D.defects!.n}`}</td>
                  <td>
                    {r.classes.map(c => (
                      <div key={c.code}>
                        <b>{c.code}</b> {c.title ?? ''}{' '}
                        {c.url ? <a href={c.url}>#{c.issue}</a> : <span className="q-muted">no fix issue in the taxonomy</span>}
                        {c.issue_state && <span className="q-muted"> ({c.issue_state.toLowerCase()})</span>}
                      </div>
                    ))}
                  </td>
                </tr>
              ))}
            </Table>
          ) : <NoMeasurement what="no served-corpus audit with passing controls" />}
        </Section>

        {/* 6 — Reader signals */}
        <Section n={6} title="Reader signals" sub={D.reader ? <>Last {D.reader.window_days} days ({day(D.reader.from)} – {day(D.reader.to)}). Untrusted input: a count of reports, not a defect rate.</> : undefined}>
          {D.reader ? (
            <div className="grid gap-3 md:grid-cols-3">
              <div className="q-card px-4 py-3 grid gap-1 content-start">
                <div className="text-sm">Page problem reports</div>
                <div className="text-3xl font-semibold tabular-nums">{D.reader.page_reports.total}</div>
                <div className="text-xs q-muted">{D.reader.page_reports.instrument}; control live since {day(D.reader.page_reports.instrument_since)}</div>
                {D.reader.page_reports.by_kind.length > 0 && (
                  <div className="text-xs">{D.reader.page_reports.by_kind.map(k => `${k.kind.replace(/_/g, ' ')} ${k.count}`).join(' · ')}</div>
                )}
              </div>
              <div className="q-card px-4 py-3 grid gap-1 content-start">
                <div className="text-sm">Most-reported books</div>
                {D.reader.page_reports.top_books.length ? D.reader.page_reports.top_books.map(b => (
                  <div key={b.book_id} className="text-sm"><a href={b.url}>{b.title ?? b.book_id}</a> <span className="q-muted">· {b.count}</span></div>
                )) : <div className="text-sm q-muted">None reported in the window.</div>}
              </div>
              <div className="q-card px-4 py-3 grid gap-1 content-start">
                <div className="text-sm">&ldquo;Poorly read&rdquo; notes shown</div>
                <div className="text-sm"><b>{D.reader.poorly_read ?? 'No measurement'}</b></div>
                <div className="text-xs q-muted">{D.reader.poorly_read_note}</div>
                <div className="text-xs q-muted">All feedback rows in the window (any topic): {D.reader.feedback_total}</div>
              </div>
            </div>
          ) : <NoMeasurement what="reader signals were not queried when the report was built" />}
        </Section>

        <footer className="text-xs q-muted">
          Refresh: <code>node --env-file=.env.production.local scripts/eval/quality-dashboard/build.mjs --push</code> (no deploy). See the README beside it.
        </footer>
      </div>
    </main>
  );
}
