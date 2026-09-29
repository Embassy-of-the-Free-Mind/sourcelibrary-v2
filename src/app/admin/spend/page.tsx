import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import {
  getSpendReport, redactForViewer, requireSpendViewer,
  type SpendData, type SpendNarrative, type Grade, type LanguageRow,
} from '@/lib/spend-report';
import { CompletionHistogram, DailyChart, MonthlyChart, SkuTable } from './SpendCharts';
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

function Section({ title, intro, id, children }: { title: string; intro?: string; id?: string; children: ReactNode }) {
  return (
    <section id={id} className="grid gap-3 content-start min-w-0 scroll-mt-4">
      <h2 className="text-base font-semibold text-stone-900">{title}</h2>
      {intro && <p className="text-xs text-stone-500 max-w-3xl leading-snug">{rich(intro)}</p>}
      {children}
    </section>
  );
}

function Tiles({ tiles }: { tiles: { v: string; l: string; n?: string }[] }) {
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
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

function KpiGroup({ title, tiles }: { title: string; tiles: { v: string; l: string; n?: string }[] }) {
  return (
    <div className="grid gap-2 content-start min-w-0">
      <div className="text-xs uppercase tracking-wider text-stone-500">{title}</div>
      <Tiles tiles={tiles} />
    </div>
  );
}

const NAV = [
  ['charts', 'Charts'], ['output', 'Output'], ['languages', 'By language'], ['vendors', 'By vendor'], ['sku', 'By SKU'],
  ['unit-costs', 'Unit costs'], ['roadmap', 'Roadmap'], ['notes', 'Notes'],
] as const;

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
    <main className="px-6 py-6 max-w-7xl mx-auto grid gap-8 bg-stone-50">
      <header className="grid gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <h1 className="text-2xl font-semibold text-stone-900">Source Library spend</h1>
          <div className="text-xs text-stone-500">
            Data to {dayName(D.gcpTo)} {D.gcpTo.slice(0, 4)} · generated {String(generated).slice(0, 10)} by {doc.generated_by} · private
          </div>
        </div>
        <nav className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {NAV.map(([id, label]) => <a key={id} href={`#${id}`} className="text-accent-rust hover:underline">{label}</a>)}
        </nav>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <KpiGroup title="Google Cloud (Gemini)" tiles={[
          { v: fmt0.format(curGcp), l: `${monthName(cur.month)} to ${dayName(D.gcpTo)}`,
            n: `Run rate ${fmt0.format(curGcp / dayOfMonth)}/day → ~${fmt0.format(curGcp / dayOfMonth * 30)} for the month` },
          { v: fmt0.format(gcp90.total), l: `Last 90 days (${dayName(gcp90.from)} – ${dayName(gcp90.to)})`,
            n: `${fmt0.format(gcp90.total / 90)}/day · ${windowNote(gcp90)}` },
          { v: fmt0.format(gcpYtd.total), l: `${D.gcpTo.slice(0, 4)} to date`, n: windowNote(gcpYtd) },
        ]} />
        <KpiGroup title="All vendors" tiles={[
          { v: fmt0.format(grand), l: 'Identified to date', n: 'Settled invoices plus estimates where marked' },
          { v: fmt0.format(mtot(lastSettled)), l: `${monthName(lastSettled.month)}, last invoiced month`,
            n: `Google ${fmt0.format(mval(lastSettled, 'Google Cloud'))} · Vercel ${fmt0.format(mval(lastSettled, 'Vercel'))}` },
          { v: grand ? Math.round(gcpAll / grand * 100) + '%' : '·', l: 'Google Cloud share', n: `${fmt0.format(gcpAll)} of ${fmt0.format(grand)} to date` },
        ]} />
      </div>

      <div id="charts" className="grid gap-6 lg:grid-cols-2 scroll-mt-4">
        <Section title="Monthly, all vendors">
          <div className="rounded border border-stone-200 bg-white p-3">
            <MonthlyChart months={months} vendors={VEND} />
          </div>
        </Section>
        <Section title={`Google Cloud, daily since ${dayName(D.gcpFrom)}`}>
          <div className="rounded border border-stone-200 bg-white p-3">
            <DailyChart daily={D.daily} drivers={D.drivers} projects={D.projects} />
          </div>
        </Section>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
      {O && (
        <Section id="output" title="What the money produced" intro={T.output_intro}>
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

      </div>

      {D.languages?.length ? <LanguageSection rows={D.languages} intro={T.languages_intro} /> : null}

      {D.completion ? (
        <Section id="completion" title="How far along each book is"
          intro="Books with at least one transcribed page. Each bar is one percentage point of a book's pages; the line is the same data smoothed. The 0% and 100% bars run off the top — their true counts are printed.">
          <div className="rounded border border-stone-200 bg-white p-3">
            <CompletionHistogram ocr={D.completion.ocr} translation={D.completion.translation}
              booksWithOcr={D.completion.books_with_ocr} nonEnglishWithOcr={D.completion.non_english_with_ocr} />
          </div>
        </Section>
      ) : null}

      <Section id="vendors" title="Monthly, by vendor">
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

      <Section id="sku" title="Google Cloud, by SKU">
        <div className="rounded border border-stone-200 bg-white p-3">
          <SkuTable skus={D.skus} />
        </div>
      </Section>

      {P && (
        <>
          <Section id="unit-costs" title="What a book costs now, by kind of book" intro={T.per_book_intro}>
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

          {P.checks?.examples?.length ? (
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
            </Section>
          ) : null}

          <Section id="roadmap" title="Roadmap: what the unprocessed backlog will cost" intro={T.backlog_intro}>
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

      <div className="grid gap-8 border-t border-stone-200 pt-6">
        {T.checks_findings?.length ? (
          <Section title="How the unit costs were checked">
            <Findings items={T.checks_findings} />
          </Section>
        ) : null}
      {(T.findings?.length || T.still_unknown) && (
        <Section id="notes" title={`What the numbers say${T.findings_as_of ? ` (${T.findings_as_of})` : ''}`}>
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

      <Section id={T.findings?.length || T.still_unknown ? undefined : 'notes'} title="What this does and does not include">
        <ul className="grid gap-1.5 text-sm text-stone-600 max-w-3xl list-disc pl-5">
          {(T.notes ?? []).map((n, i) => <li key={i}>{rich(n)}</li>)}
          {D.monthly.excluded.map((x, i) => <li key={'x' + i}>Excluded: {x}</li>)}
        </ul>
        <p className="text-xs text-stone-500">
          Refresh: in the private ops repo run <code className="font-mono bg-stone-100 px-1 rounded">costs/spend-dashboard/build-data.py --push</code> (see its README).
          Data generated {D.generated}.
        </p>
      </Section>
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

      </div>
    </main>
  );
}

const LANG_TOP = 15;
const langNum = ['books', 'live_books', 'books_done', 'ocr_pages_needed', 'translation_pages_needed',
  'low_usd', 'high_usd', 'live_low_usd', 'live_high_usd'] as const;
type LangSum = { language: string } & Record<(typeof langNum)[number], number>;

function sumLanguages(language: string, rows: LanguageRow[]): LangSum {
  const out = { language } as LangSum;
  for (const k of langNum) out[k] = rows.reduce((a, r) => a + (r[k] ?? 0), 0);
  return out;
}

/** Books readable in English, and what finishing the rest costs, by edition language. */
function LanguageSection({ rows, intro }: { rows: LanguageRow[]; intro?: string }) {
  const sorted = [...rows].sort((a, b) => b.books - a.books);
  const rest = sorted.slice(LANG_TOP);
  const shown: LangSum[] = [
    ...sorted.slice(0, LANG_TOP).map(r => sumLanguages(r.language, [r])),
    ...(rest.length ? [sumLanguages(`${rest.length} other languages`, rest)] : []),
  ];
  const total = sumLanguages('Total', sorted);
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const row = (r: LangSum, bold = false) => (
    <tr key={r.language} className={bold ? 'font-semibold' : undefined}>
      <td className={TD}>{cap(r.language)}</td>
      <td className={`${TD} text-right`}>{int(r.books)}</td>
      <td className={`${TD} text-right`}>{int(r.live_books)}</td>
      <td className={`${TD} text-right`}>{int(r.books_done)}</td>
      <td className={`${TD} text-right`}>{r.books ? Math.round(r.books_done / r.books * 100) + '%' : '·'}</td>
      <td className={`${TD} text-right`}>{int(r.ocr_pages_needed)}</td>
      <td className={`${TD} text-right`}>{int(r.translation_pages_needed)}</td>
      <td className={`${TD} text-right`}>{rng0(r.low_usd, r.high_usd)}</td>
      <td className={`${TD} text-right`}>{rng0(r.live_low_usd, r.live_high_usd)}</td>
    </tr>
  );
  return (
    <Section id="languages" title="By language: what is done, what remains"
      intro={intro ?? 'Done = readable in English: at least 90% of pages translated (English books: transcribed). Cost to finish uses the same per-page rates as the roadmap; "live" is books readers can already open.'}>
      <Tiles tiles={[
        { v: `${int(total.books_done)} of ${int(total.books)}`, l: 'Books readable in English', n: `${Math.round(total.books_done / (total.books || 1) * 100)}% of books with pages` },
        { v: rng0(total.low_usd, total.high_usd), l: 'AI cost to finish everything', n: `${int(total.ocr_pages_needed)} pages to transcribe, ${int(total.translation_pages_needed)} to translate` },
        { v: rng0(total.live_low_usd, total.live_high_usd), l: 'AI cost to finish live books only', n: `${int(total.live_books)} books readers can open today` },
      ]} />
      <Table head={['Language', 'Books', 'Live', 'Done', '% done', 'Pages to transcribe', 'Pages to translate', 'Cost to finish, all', 'Live books only']}>
        {shown.map(r => row(r))}
        {row(total, true)}
      </Table>
    </Section>
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
