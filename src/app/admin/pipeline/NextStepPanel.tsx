import type { ReactNode } from 'react';
import { remainingWork, type PipelineNextReport, type WorkRow } from '@/lib/pipeline-next-report';
// Scripts-side, pure data — the registry the coverage test checks against the workers (#5480).
import { LANES, LANE_STEPS, DEAD_PAUSE_NAMES } from '../../../../scripts/lib/lanes.mjs';

/**
 * "What work is left, what would it cost, what is held and why" — read in a minute before approving a
 * spend row (#5480). Server component: every count comes from the newest `pipeline_next_daily` snapshot
 * (scripts/audit/pipeline-next-step-audit.mjs, daily 06:45 UTC), every rate from
 * scripts/lib/pipeline-unit-prices.mjs, every lane from scripts/lib/lanes.mjs. Nothing is computed over
 * `books` on the request. Replaces the account-bound claude.ai "Remaining Pipeline Work" artifact.
 */

type Lane = { name: string; serves: string; selects: string; trigger: string; budget: string; respectsHold: string | false; pause: string | null; reason?: string; gap?: boolean };

const REPO = 'https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2';
const n = (v: number) => Math.round(v).toLocaleString('en-US');
const money = (v: number, currency: string) =>
  v.toLocaleString('en-US', { style: 'currency', currency, maximumFractionDigits: v > 0 && v < 10 ? 2 : 0 });
const rate = (v: number, currency: string) => (v === 0 ? '—' : `${currency === 'EUR' ? '€' : '$'}${v.toFixed(5).replace(/0+$/, '')}`);
const utc = (d: Date | string | null | undefined) =>
  d ? `${new Date(d).toISOString().slice(0, 16).replace('T', ' ')} UTC` : '—';

const muted = { color: 'var(--text-muted)' };
const faint = { color: 'var(--text-faint)' };
const primary = { color: 'var(--text-primary)' };

function Card({ title, sub, children }: { title: string; sub?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border p-4" style={{ borderColor: 'var(--border-light)', background: 'white' }}>
      <h2 className="text-xs font-medium uppercase tracking-wider" style={muted}>{title}</h2>
      {sub && <p className="text-xs mt-1 mb-3 max-w-4xl leading-snug" style={faint}>{sub}</p>}
      <div className="overflow-x-auto">{children}</div>
    </section>
  );
}

function Th({ children, right }: { children: ReactNode; right?: boolean }) {
  return <th className={`${right ? 'text-right' : 'text-left'} py-1 px-2 font-medium whitespace-nowrap`}>{children}</th>;
}
function Td({ children, right, style }: { children: ReactNode; right?: boolean; style?: React.CSSProperties }) {
  return <td className={`py-1.5 px-2 align-top ${right ? 'text-right tabular-nums whitespace-nowrap' : ''}`} style={style ?? { color: 'var(--text-secondary)' }}>{children}</td>;
}

function Sources({ r }: { r: WorkRow }) {
  return (
    <>
      {r.price.sources.map((s) => (
        <div key={`${s.where}-${s.value}`} className="text-[11px] leading-snug" style={faint}>
          {rate(s.value, r.price.currency)} — {s.what}{s.measured ? `, measured ${s.measured}` : ''} · <code>{s.where}</code>
        </div>
      ))}
    </>
  );
}

export function NextStepPanel({ report, error }: { report: PipelineNextReport | null; error?: string | null }) {
  if (!report) {
    return (
      <Card title="Work left by next step">
        <p className="text-sm" style={muted}>
          {error ? `Could not read the snapshot: ${error}.` : 'No pipeline-next snapshot yet.'} It is written daily at 06:45 UTC by{' '}
          <code>scripts/audit/pipeline-next-step-audit.mjs --apply</code> (ops_reports, type <code>pipeline_next_daily</code>).
        </p>
      </Card>
    );
  }

  const { rows, held } = remainingWork(report);
  const ageH = (Date.now() - new Date(report.generated_at).getTime()) / 3600e3;
  // Images is left out of the total: its count is overstated until the collectors stamp images_done_at.
  const totalled = rows.filter((r) => r.key !== 'images');
  const usd = totalled.filter((r) => r.price.currency === 'USD');
  const eur = totalled.filter((r) => r.price.currency === 'EUR');
  const sum = (rs: WorkRow[], k: 'costLow' | 'costHigh') => rs.reduce((a, r) => a + r[k], 0);
  const lanes = LANES as Lane[];
  const stepCounts = new Map(report.steps.map((s) => [s.step, s]));
  const blocked = report.step_reasons.filter((r) => r.step === 'blocked' && r.reason !== 'held');

  return (
    <div className="space-y-4">
      <div className="text-xs leading-relaxed" style={muted}>
        <span className="font-medium" style={primary}>Snapshot {utc(report.generated_at)}</span>
        {' '}· ops_reports <code>{report._id}</code> · <code>{report.generated_by}</code>
        {' '}· denominator: {n(report.denominator.books)} {report.denominator.rule} ({n(report.denominator.live)} live, <code>{report.denominator.live_rule}</code>)
        {' '}· audit <span style={{ color: report.verdict.status === 'PASS' ? 'var(--accent-sage)' : 'var(--accent-rust)' }}>{report.verdict.status}</span>
        {ageH > 30 && <span style={{ color: 'var(--accent-rust)' }}> · {Math.round(ageH)} h old — the daily audit has not run since</span>}
      </div>

      <Card
        title="Remaining work — live books"
        sub={<>Pages left × a measured price per page, as a low–high range (cheapest lane to dearest). Each step reads the book&apos;s stored next step (<code>books.pipeline_next</code>), so a book counts once, at the step it is waiting on. Prices are observations with dates, not quotes: re-measure before a spend decision. Nothing here is approved spend; each cutover is its own decision row (#5481).</>}
      >
        <table className="w-full text-xs">
          <thead><tr style={muted}><Th>Step</Th><Th right>Live books</Th><Th right>Pages left</Th><Th right>Per page</Th><Th right>Cost low–high</Th><Th>Source</Th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-t" style={{ borderColor: 'var(--border-light)' }}>
                <Td style={primary}>
                  <div className="font-medium">{r.label}</div>
                  {r.note && <div className="text-[11px]" style={faint}>{r.note}</div>}
                </Td>
                <Td right>{n(r.books)}</Td>
                <Td right>{n(r.pages)}<div className="text-[10px]" style={faint}>{r.pageKind}</div></Td>
                <Td right>{r.price.low === r.price.high ? rate(r.price.low, r.price.currency) : `${rate(r.price.low, r.price.currency)}–${rate(r.price.high, r.price.currency)}`}</Td>
                <Td right style={primary}>{r.costHigh === 0 ? (r.price.low === 0 ? 'unmetered' : money(0, r.price.currency)) : `${money(r.costLow, r.price.currency)}–${money(r.costHigh, r.price.currency)}`}</Td>
                <Td><div className="text-[11px]" style={faint}>{r.price.basis}</div><Sources r={r} /></Td>
              </tr>
            ))}
            <tr className="border-t-2" style={{ borderColor: 'var(--border-light)' }}>
              <Td style={primary}><span className="font-medium">Total</span></Td>
              <Td right>{''}</Td><Td right>{''}</Td><Td right>{''}</Td>
              <Td right style={primary}>
                <div className="font-medium">{money(sum(usd, 'costLow'), 'USD')}–{money(sum(usd, 'costHigh'), 'USD')}</div>
                {eur.length > 0 && <div>+ {money(sum(eur, 'costLow'), 'EUR')}–{money(sum(eur, 'costHigh'), 'EUR')}</div>}
              </Td>
              <Td><span className="text-[11px]" style={faint}>Excludes Images (overstated, see its row). USD and EUR are kept apart: the Chinese OCR rate was measured in euros on a leased GPU.</span></Td>
            </tr>
          </tbody>
        </table>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card
          title="Held — listed, not priced"
          sub={<>Books with a hold marker (<code>pipeline_auto.hold</code>): out of every lane until the condition on the issue is met. Most wait on a specialist lane or a decision, so a Gemini rate would mislead. All books, not just live.</>}
        >
          <table className="w-full text-xs">
            <thead><tr style={muted}><Th>Hold reason</Th><Th right>Books</Th><Th right>Live</Th><Th right>Pages to OCR</Th><Th right>Pages to translate</Th></tr></thead>
            <tbody>
              {held.map((h) => (
                <tr key={`${h.reason}-${h.issue}`} className="border-t" style={{ borderColor: 'var(--border-light)' }}>
                  <Td style={primary}>
                    {h.reason}
                    {h.issue && <> · <a href={`${REPO}/issues/${h.issue}`} className="hover:underline" style={{ color: 'var(--accent-rust)' }}>#{h.issue}</a></>}
                  </Td>
                  <Td right>{n(h.books)}</Td><Td right>{n(h.live)}</Td><Td right>{n(h.ocr_pages)}</Td><Td right>{n(h.translate_pages)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
          {blocked.length > 0 && (
            <p className="text-[11px] mt-2" style={faint}>
              Also blocked (no hold): {blocked.map((b) => `${b.reason.replace(/_/g, ' ')} ${n(b.all.books)} (${n(b.live.books)} live)`).join(' · ')}.
            </p>
          )}
        </Card>

        <Card
          title="Audit shapes"
          sub={<>Stored step vs a fresh recompute, and the label (<code>pipeline_auto.status</code>) vs the step. Stamp pass {utc(report.agreement.last_stamp_run)}.</>}
        >
          <table className="w-full text-xs">
            <thead><tr style={muted}><Th>Shape</Th><Th right>All</Th><Th right>Live</Th></tr></thead>
            <tbody>
              <tr className="border-t" style={{ borderColor: 'var(--border-light)' }}>
                <Td style={primary}>stored step ≠ recompute (stale)</Td>
                <Td right>{n(report.agreement.stale)}</Td><Td right>{report.agreement.stale_pct}%</Td>
              </tr>
              {Object.entries(report.shapes).map(([k, v]) => (
                <tr key={k} className="border-t" style={{ borderColor: 'var(--border-light)' }}>
                  <Td style={primary}>{k.replace(/_/g, ' ')}{v.note && <div className="text-[11px]" style={faint}>{v.note}</div>}</Td>
                  <Td right>{v.all == null ? (k === 'needs_human' ? '—' : 'not measured') : n(v.all)}</Td>
                  <Td right>{v.live == null ? 'not measured' : n(v.live)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      <Card
        title="Lanes by step"
        sub={<>Generated from <code>scripts/lib/lanes.mjs</code>; <code>tests/unit/lanes-registry.test.ts</code> fails when a scheduled writer is missing from it or a declared check is not in its source. <span style={{ color: 'var(--accent-rust)' }}>Red</span> = a check skipped as a known gap, not by design. Pausing: the names <code>{DEAD_PAUSE_NAMES.map((d: string) => `'${d}'`).join(', ')}</code> in <code>paused_phases</code> stop nothing; use the key in the Pause column.</>}
      >
        <table className="w-full text-xs">
          <thead><tr style={muted}><Th>Step</Th><Th right>All</Th><Th right>Live</Th><Th>Lane</Th><Th>Trigger</Th><Th>Budget</Th><Th>Hold</Th><Th>Pause</Th></tr></thead>
          <tbody>
            {(LANE_STEPS as string[]).flatMap((step) => {
              const ls = lanes.filter((l) => l.serves === step);
              const c = stepCounts.get(step);
              return ls.map((l, i) => (
                <tr key={l.name} className={i === 0 ? 'border-t' : ''} style={{ borderColor: 'var(--border-light)' }}>
                  <Td style={primary}>{i === 0 ? step : ''}</Td>
                  <Td right>{i === 0 && c ? n(c.all.books) : ''}</Td>
                  <Td right>{i === 0 && c ? n(c.live.books) : ''}</Td>
                  <Td style={primary}>
                    <code>{l.name}</code>
                    <div className="text-[11px]" style={faint}>{l.selects}</div>
                    {l.reason && <div className="text-[11px] max-w-xl" style={l.gap ? { color: 'var(--accent-rust)' } : faint}>{l.reason}</div>}
                  </Td>
                  <Td>{l.trigger}</Td>
                  <Td style={l.budget === 'none' ? { color: 'var(--accent-rust)' } : undefined}>{l.budget}</Td>
                  <Td style={l.respectsHold === false ? { color: 'var(--accent-rust)' } : undefined}>{l.respectsHold === false ? 'no' : l.respectsHold}</Td>
                  <Td style={l.pause == null ? { color: 'var(--accent-rust)' } : undefined}>{l.pause ?? 'none'}</Td>
                </tr>
              ));
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
