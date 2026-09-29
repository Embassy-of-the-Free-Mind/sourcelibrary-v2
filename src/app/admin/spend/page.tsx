import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import {
  getSpendReport, redactForViewer, requireSpendViewer,
  type SpendData, type SpendNarrative, type Grade,
} from '@/lib/spend-report';
import { DailyChart, MonthlyChart, SkuTable } from './SpendCharts';
import { daysBefore, gcpWindow, type GcpWindow } from '@/lib/spend-windows';

/**
 * /admin/spend — what Source Library costs, what it produced, what the backlog
 * will cost (#5225). Renderer only: every figure, note and name comes from the
 * private `ops_reports` document the ops repo pushes. Gate = named allow-list
 * (see src/lib/spend-report.ts), on top of the admin layout's requireAdmin().
 * Also refused outright on partner subdomains (tenant-global-paths) and sent
 * with X-Robots-Tag: noindex (next.config.ts).
 */
export const metadata: Metadata = {
  title: 'Spend',
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const fmt0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const fmt2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const int = (v: number) => Math.round(v).toLocaleString('en-US');
const monthName = (m: string) =>
  new Date(m + '-15T00:00:00').toLocaleString('en-US', { month: 'short', year: '2-digit' }).replace(' ', ' ’');
const dayName = (d: string) => new Date(d + 'T00:00:00').toLocaleString('en-US', { month: 'short', day: 'numeric' });
const rng2 = (a: number, b: number) => `${fmt2.format(a)} – ${fmt2.format(b)}`;
const rng0 = (a: number, b: number) => `${fmt0.format(a)} – ${fmt0.format(b)}`;

/** `**bold**` and `[text](url)` from the private narrative, rendered as nodes — never innerHTML. */
function rich(s: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+|\/[^\s)]*)\)/g;
  let last = 0, m: RegExpExecArray | null, k = 0;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    if (m[1] != null) out.push(<b key={k++}>{m[1]}</b>);
    else out.push(<a key={k++} href={m[3]} className="text-accent-rust hover:underline">{m[2]}</a>);
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

const GRADE_CLASS: Record<Grade, string> = {
  settled: '',
  est: 'text-amber-700',
  unknown: 'text-red-700',
  export: 'text-blue-700',
};

function Section({ title, intro, children }: { title: string; intro?: string; children: ReactNode }) {
  return (
    <section className="grid gap-3">
      <h2 className="text-base font-semibold text-stone-900">{title}</h2>
      {intro && <p className="text-sm text-stone-600 max-w-3xl leading-snug">{rich(intro)}</p>}
      {children}
    </section>
  );
}

function Tiles({ tiles }: { tiles: { v: string; l: string; n?: string }[] }) {
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
      {tiles.map(t => (
        <div key={t.l} className="rounded border border-stone-200 bg-white px-4 py-3 grid gap-0.5 content-start">
          <div className="text-2xl font-semibold text-stone-900 tabular-nums">{t.v}</div>
          <div className="text-sm text-stone-700">{t.l}</div>
          {t.n && <div className="text-xs text-stone-500">{t.n}</div>}
        </div>
      ))}
    </div>
  );
}

const TH = 'px-2 py-1 font-medium text-left';
const TD = 'px-2 py-1 border-b border-stone-100 whitespace-nowrap tabular-nums';
const TDW = 'px-2 py-1 border-b border-stone-100';

function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded border border-stone-200 bg-white">
      <table className="text-sm min-w-full">
        <thead><tr className="text-xs text-stone-500 bg-stone-50">{head.map(h => <th key={h} className={TH}>{h}</th>)}</tr></thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function Findings({ items }: { items?: string[] }) {
  if (!items?.length) return null;
  return (
    <ul className="grid gap-2 text-sm text-stone-700 max-w-3xl list-disc pl-5">
      {items.map((f, i) => <li key={i}>{rich(f)}</li>)}
    </ul>
  );
}

export default async function SpendPage() {
  const viewer = await requireSpendViewer();
  const doc = await getSpendReport();

  if (!doc) {
    return (
      <main className="px-6 py-8 max-w-5xl mx-auto grid gap-4">
        <h1 className="text-2xl font-semibold text-stone-900">Spend</h1>
        <p className="text-sm text-stone-600 max-w-2xl">
          No report has been pushed yet. In the private ops repo, run <code className="font-mono text-xs bg-stone-100 px-1 rounded">costs/spend-dashboard/build-data.py --push</code>;
          the page reads the document it writes and needs no deploy.
        </p>
      </main>
    );
  }

  const D: SpendData = redactForViewer(doc.data, viewer);
  const T: SpendNarrative = D.text ?? {};
  const VEND = D.monthly.vendors;
  const months = D.monthly.months;
  const mval = (m: (typeof months)[number], v: string) => m.vendors[v]?.v ?? 0;
  const mtot = (m: (typeof months)[number]) => VEND.reduce((a, v) => a + mval(m, v), 0);
  const cur = months[months.length - 1];
  const lastSettled = [...months].reverse().find(m => m.vendors['Google Cloud']?.grade === 'settled') ?? cur;
  const grand = months.reduce((a, m) => a + mtot(m), 0);
  const gcpAll = months.reduce((a, m) => a + mval(m, 'Google Cloud'), 0);
  const curGcp = D.daily.filter(d => d.day >= cur.month + '-01').reduce((a, d) => a + d.byDriver.reduce((x, y) => x + y, 0), 0);
  const dayOfMonth = Math.max(1, Number(D.gcpTo.slice(8)));
  const gcp90 = gcpWindow(months, D.daily, D.gcpFrom, D.gcpTo, daysBefore(D.gcpTo, 89));
  const gcpYtd = gcpWindow(months, D.daily, D.gcpFrom, D.gcpTo, D.gcpTo.slice(0, 4) + '-01-01');
  const windowNote = (w: GcpWindow) =>
    [w.ledger > 0.5 ? `${fmt0.format(w.daily)} daily export + ${fmt0.format(w.ledger)} from monthly invoices` : 'All from the daily export',
     w.estimatedMonths.length ? `includes estimates for ${w.estimatedMonths.map(monthName).join(', ')}` : '']
      .filter(Boolean).join(' · ');
  const generated = typeof doc.generated_at === 'string' ? doc.generated_at : doc.generated_at?.toISOString?.() ?? D.generated;

  const P = D.projection;
  const O = D.output;
  const phaseCols = T.phase_columns ?? (D.phases ? Object.keys(D.phases).map(k => ({ key: k, label: k })) : []);
  const paceBudgets: { usd_per_day: number; note?: string }[] =
    T.pace_budgets ?? [5, 50, 150, 300].map(usd_per_day => ({ usd_per_day }));
  const fmtT = (m: number) => (m >= 24 ? (m / 12).toFixed(1) + ' years' : m.toFixed(1) + ' months');
  const gcpBill = (m: string) => months.find(x => x.month === m)?.vendors['Google Cloud']?.v ?? 0;

  return (
    <main className="px-6 py-8 max-w-6xl mx-auto grid gap-8 bg-stone-50">
      <header className="grid gap-1">
        <div className="text-xs uppercase tracking-wider text-stone-500">
          Billed spend, all vendors · data to {dayName(D.gcpTo)} {D.gcpTo.slice(0, 4)} · generated {String(generated).slice(0, 10)} by {doc.generated_by}
        </div>
        <h1 className="text-2xl font-semibold text-stone-900">Source Library spend</h1>
        <p className="text-sm text-stone-600 max-w-3xl">
          Monthly figures from settled invoices, attributed to the service month. Daily Google Cloud detail comes from the
          BigQuery billing export, which reaches back to {dayName(D.gcpFrom)} {D.gcpFrom.slice(0, 4)}. Private: shown only to named accounts.
        </p>
      </header>

      <Tiles tiles={[
        { v: fmt0.format(grand), l: 'Identified to date', n: 'Settled invoices plus estimates where marked' },
        { v: fmt0.format(gcpAll), l: 'Google Cloud (Gemini) to date', n: grand ? Math.round(gcpAll / grand * 100) + '% of everything' : undefined },
        { v: fmt0.format(mtot(lastSettled)), l: `${monthName(lastSettled.month)} total, last invoiced month`,
          n: `Google ${fmt0.format(mval(lastSettled, 'Google Cloud'))} · Vercel ${fmt0.format(mval(lastSettled, 'Vercel'))}` },
        { v: fmt0.format(curGcp), l: `Google Cloud ${monthName(cur.month)} to ${dayName(D.gcpTo)}`,
          n: `Run rate ${fmt0.format(curGcp / dayOfMonth)}/day → ~${fmt0.format(curGcp / dayOfMonth * 30)} for the month` },
        { v: fmt0.format(gcp90.total), l: `Google Cloud, last 90 days (${dayName(gcp90.from)} – ${dayName(gcp90.to)})`,
          n: `${fmt0.format(gcp90.total / 90)}/day · ${windowNote(gcp90)}` },
        { v: fmt0.format(gcpYtd.total), l: `Google Cloud, ${D.gcpTo.slice(0, 4)} to date`, n: windowNote(gcpYtd) },
      ]} />

      {(T.findings?.length || T.still_unknown) && (
        <Section title={`What the numbers say${T.findings_as_of ? ` (${T.findings_as_of})` : ''}`}>
          <Findings items={T.findings} />
          {T.per_book_denominator ? (
            <p className="text-sm text-stone-700 max-w-3xl">
              Spread over everything spent so far, each of the {int(T.per_book_denominator)} books that are at least 90% translated
              has cost about <b>{fmt2.format(grand / T.per_book_denominator)}</b> all-in.
            </p>
          ) : null}
          {T.still_unknown && <p className="text-sm text-stone-600 max-w-3xl">{rich(T.still_unknown)}</p>}
        </Section>
      )}

      {O && (
        <Section title="What the money produced" intro={T.output_intro}>
          <Tiles tiles={[
            { v: int(O.books_90pct_translated), l: 'Books at least 90% translated', n: `of ${int(O.books_any_translation)} with any translation` },
            { v: int(O.pages_translated_total), l: 'Pages translated', n: "all books, from each book's counter" },
            { v: int(O.pages_ocr_total), l: 'Pages transcribed (OCR)', n: "Gemini, GPU readers and the Archive's own OCR" },
          ]} />
          <Table head={['Month', "Pages OCR'd", 'Pages translated', 'Google bill', 'Per 1,000 pages']}>
            {O.months.filter(r => r.ocr_pages || r.translated_pages).map(r => {
              const bill = gcpBill(r.month); const tot = r.ocr_pages + r.translated_pages;
              return (
                <tr key={r.month}>
                  <td className={TD}>{monthName(r.month)}</td>
                  <td className={`${TD} text-right`}>{int(r.ocr_pages)}</td>
                  <td className={`${TD} text-right`}>{int(r.translated_pages)}</td>
                  <td className={`${TD} text-right`}>{bill ? fmt0.format(bill) : '·'}</td>
                  <td className={`${TD} text-right`}>{bill && tot ? fmt2.format(bill / tot * 1000) : '·'}</td>
                </tr>
              );
            })}
          </Table>
        </Section>
      )}

      <Section title="Monthly, by vendor">
        <div className="rounded border border-stone-200 bg-white p-3">
          <MonthlyChart months={months} vendors={VEND} />
        </div>
        <Table head={['Vendor', ...months.map(m => monthName(m.month)), 'Total']}>
          {VEND.map(v => {
            let sum = 0;
            return (
              <tr key={v}>
                <td className={TD}>{v}</td>
                {months.map(m => {
                  const c = m.vendors[v];
                  if (!c) return <td key={m.month} className={`${TD} text-right text-stone-300`}>·</td>;
                  sum += c.v;
                  return <td key={m.month} className={`${TD} text-right ${GRADE_CLASS[c.grade] ?? ''}`} title={c.note}>{fmt0.format(c.v)}</td>;
                })}
                <td className={`${TD} text-right font-medium`}>{fmt0.format(sum)}</td>
              </tr>
            );
          })}
          <tr className="font-semibold">
            <td className={TD}>All vendors</td>
            {months.map(m => <td key={m.month} className={`${TD} text-right`}>{fmt0.format(mtot(m))}</td>)}
            <td className={`${TD} text-right`}>{fmt0.format(grand)}</td>
          </tr>
        </Table>
        <p className="text-xs text-stone-500 flex flex-wrap gap-x-4">
          <span>Plain figures are settled invoices.</span>
          <span className="text-amber-700">Amber: estimate, invoice not pulled.</span>
          <span className="text-red-700">Red: lower bound, no invoice found.</span>
          <span className="text-blue-700">Blue: billing export, not yet invoiced.</span>
          <span>Hover a figure for its note.</span>
        </p>
      </Section>

      <Section title="Google Cloud, daily">
        <div className="rounded border border-stone-200 bg-white p-3">
          <DailyChart daily={D.daily} drivers={D.drivers} projects={D.projects} />
        </div>
      </Section>

      <Section title="Google Cloud, by SKU">
        <div className="rounded border border-stone-200 bg-white p-3">
          <SkuTable skus={D.skus} />
        </div>
      </Section>

      {P && (
        <>
          <Section title="What a book costs now, by kind of book" intro={T.per_book_intro}>
            <Table head={['Kind of book', 'How it is processed', 'AI cost per book']}>
              {P.per_book.map(r => (
                <tr key={r.category}>
                  <td className={TDW}>{r.category}</td>
                  <td className={`${TDW} text-stone-600`}>{r.what}</td>
                  <td className={`${TD} text-right`}>{rng2(r.low, r.high)}</td>
                </tr>
              ))}
            </Table>
          </Section>

          {(P.checks?.examples?.length || T.checks_findings?.length) ? (
            <Section title="Checked against real books and the bill" intro={T.checks_intro}>
              {P.checks?.examples?.length ? (
                <Table head={['Book', 'Pages', 'OCR', 'Translation', 'Images', 'Index, summary, other', 'Total', 'Per page']}>
                  {P.checks.examples.map(x => (
                    <tr key={x.url}>
                      <td className={TDW}>
                        <a href={x.url} className="text-accent-rust hover:underline">{x.title}</a>
                        <br /><span className="text-xs text-stone-500">{x.lang} · {x.source}{x.note ? ' · ' + x.note : ''}</span>
                      </td>
                      <td className={`${TD} text-right`}>{x.pages}</td>
                      <td className={`${TD} text-right`}>{fmt2.format(x.ocr)}</td>
                      <td className={`${TD} text-right`}>{fmt2.format(x.translation)}</td>
                      <td className={`${TD} text-right`}>{fmt2.format(x.images)}</td>
                      <td className={`${TD} text-right`}>{fmt2.format(x.other)}</td>
                      <td className={`${TD} text-right font-medium`}>{fmt2.format(x.total)}</td>
                      <td className={`${TD} text-right`}>${(x.total / x.pages).toFixed(4)}</td>
                    </tr>
                  ))}
                </Table>
              ) : null}
              <Findings items={T.checks_findings} />
            </Section>
          ) : null}

          <Section title="Roadmap: what the unprocessed backlog will cost" intro={T.backlog_intro}>
            <Table head={['Status', 'Kind of book', 'Books', 'Pages to OCR', 'Pages to translate', 'Projected cost']}>
              {[...P.backlog]
                .sort((a, b) => (a.lane > b.lane ? 1 : a.lane < b.lane ? -1 : 0) || b.high_usd - a.high_usd)
                .filter(r => r.books > 1)
                .map(r => (
                  <tr key={r.lane + r.category}>
                    <td className={TD}>{r.lane === 'hidden' ? 'Not yet available' : 'Live, unfinished'}</td>
                    <td className={TDW}>{r.category}</td>
                    <td className={`${TD} text-right`}>{int(r.books)}</td>
                    <td className={`${TD} text-right`}>{int(r.ocr_pages_needed)}</td>
                    <td className={`${TD} text-right`}>{int(r.translation_pages_needed)}</td>
                    <td className={`${TD} text-right`}>{rng0(r.low_usd, r.high_usd)}</td>
                  </tr>
                ))}
              {(['hidden', 'live'] as const).map(lane => {
                const s = P.summary[lane];
                return s ? (
                  <tr key={lane} className="font-semibold">
                    <td className={TD}>{lane === 'hidden' ? 'Not yet available' : 'Live, unfinished'}</td>
                    <td className={TDW}>Subtotal</td>
                    <td className={`${TD} text-right`}>{int(s.books)}</td>
                    <td className={`${TD} text-right`}>{int(s.ocr_pages)}</td>
                    <td className={`${TD} text-right`}>{int(s.tr_pages)}</td>
                    <td className={`${TD} text-right`}>{rng0(s.low_usd, s.high_usd)}</td>
                  </tr>
                ) : null;
              })}
            </Table>
            {(() => {
              const lo = (P.summary.hidden?.low_usd ?? 0) + (P.summary.live?.low_usd ?? 0);
              const hi = (P.summary.hidden?.high_usd ?? 0) + (P.summary.live?.high_usd ?? 0);
              return (
                <Table head={['Daily AI budget (the spend dial)', 'Per month', 'Time to clear the whole backlog']}>
                  {paceBudgets.map(b => {
                    const pm = b.usd_per_day * 30.4;
                    return (
                      <tr key={b.usd_per_day}>
                        <td className={TD}>${b.usd_per_day}/day{b.note ? ` (${b.note})` : ''}</td>
                        <td className={`${TD} text-right`}>{fmt0.format(pm)}</td>
                        <td className={TD}>{fmtT(lo / pm)} – {fmtT(hi / pm)}</td>
                      </tr>
                    );
                  })}
                </Table>
              );
            })()}
          </Section>
        </>
      )}

      {D.phases && phaseCols.length > 0 && (
        <Section title="Google Cloud by pipeline stage" intro={T.phase_intro}>
          {(() => {
            const ph = D.phases;
            const stages = [...new Set(phaseCols.flatMap(c => Object.keys(ph[c.key] ?? {})))]
              .sort((x, y) => phaseCols.reduce((a, c) => a + (ph[c.key]?.[y] ?? 0) - (ph[c.key]?.[x] ?? 0), 0));
            const totals = phaseCols.map(c => Object.values(ph[c.key] ?? {}).reduce((a, b) => a + b, 0) || 1);
            return (
              <Table head={['Stage', ...phaseCols.flatMap(c => [c.label, 'Share'])]}>
                {stages.map(s => (
                  <tr key={s}>
                    <td className={TDW}>{s}</td>
                    {phaseCols.map((c, i) => (
                      <PhaseCells key={c.key} v={ph[c.key]?.[s] ?? 0} total={totals[i]} />
                    ))}
                  </tr>
                ))}
                <tr className="font-semibold">
                  <td className={TDW}>Total</td>
                  {phaseCols.map((c, i) => <PhaseCells key={c.key} v={totals[i]} total={totals[i]} />)}
                </tr>
              </Table>
            );
          })()}
        </Section>
      )}

      {viewer.canSeePeople && D.hours && (
        <Section title="Hands-on time" intro={T.hours_intro}>
          <Table head={['Month', 'Hours', 'Active days', 'Prompts typed']}>
            {Object.keys(D.hours.months).sort().map(k => {
              const v = D.hours!.months[k];
              return (
                <tr key={k}>
                  <td className={TD}>{monthName(k)}</td>
                  <td className={`${TD} text-right`}>{v.hours.toFixed(0)}</td>
                  <td className={`${TD} text-right`}>{v.active_days}</td>
                  <td className={`${TD} text-right`}>{int(v.prompts)}</td>
                </tr>
              );
            })}
            <tr className="font-semibold">
              <td className={TD}>Total</td>
              <td className={`${TD} text-right`}>{Object.values(D.hours.months).reduce((a, v) => a + v.hours, 0).toFixed(0)}</td>
              <td className={TD} /><td className={TD} />
            </tr>
          </Table>
        </Section>
      )}

      {viewer.canSeePeople && D.monthly.people && (
        <Section title="People" intro={T.people_intro}>
          <Table head={['Person', 'Role', 'Monthly cost', 'Note']}>
            {D.monthly.people.map(p => (
              <tr key={p.name}>
                <td className={TD}>{p.name}</td>
                <td className={`${TDW} text-stone-600`}>{p.role}</td>
                <td className={`${TD} text-right ${p.monthly_usd == null ? 'text-stone-400 italic' : ''}`}>
                  {p.monthly_usd == null ? 'not recorded' : fmt0.format(p.monthly_usd)}
                </td>
                <td className={`${TDW} text-stone-600`}>{p.note}</td>
              </tr>
            ))}
          </Table>
        </Section>
      )}

      <Section title="What this does and does not include">
        <ul className="grid gap-1.5 text-sm text-stone-600 max-w-3xl list-disc pl-5">
          {(T.notes ?? []).map((n, i) => <li key={i}>{rich(n)}</li>)}
          {D.monthly.excluded.map((x, i) => <li key={'x' + i}>Excluded: {x}</li>)}
        </ul>
        <p className="text-xs text-stone-500">
          Refresh: in the private ops repo run <code className="font-mono bg-stone-100 px-1 rounded">costs/spend-dashboard/build-data.py --push</code> (see its README).
          Data generated {D.generated}.
        </p>
      </Section>
    </main>
  );
}

function PhaseCells({ v, total }: { v: number; total: number }) {
  return (
    <>
      <td className={`${TD} text-right`}>{fmt0.format(v)}</td>
      <td className={`${TD} text-right text-stone-500`}>{(v / total * 100).toFixed(0)}%</td>
    </>
  );
}
