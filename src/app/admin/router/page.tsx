import type { Metadata } from 'next';
import { Fragment } from 'react';
import QualityLoopLinks from '../QualityLoopLinks';
import {
  ageMin, daysLeft, getRouterBoard, splitCells, ROUTER_BOARD_STALE_MIN,
  type CellStatus, type RouteRow, type RouterBoardDoc, type RouterCell,
} from '@/lib/router-board';

/**
 * /admin/router — do the router's decisions reach production? (#7913). Per cell: the route production runs, the
 * route the router decided, the evidence behind it (accepted k/n, defects per 1,000 words, judge validity), the cron
 * lane that runs it (box, schedule), pages waiting and waiver expiry. Decided cells first, worst first: a mismatch,
 * then a decision no lane runs, then a waiver, then served.
 *
 * Renderer only: scripts/maintenance/router-board-push.mjs (hourly, Hetzner main) writes one ops_reports document
 * from router-board-push.mjs's driftReport; src/lib/router-board.ts reads it. The document's age is shown and turns red past
 * ROUTER_BOARD_STALE_MIN. force-dynamic: a failed read renders an error for this request only.
 * Gate: the admin layout's requireAdmin(); refused on partner hosts (tenant-global-paths); X-Robots-Tag noindex.
 */
export const metadata: Metadata = {
  title: 'Router',
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const REPO = 'https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2';
const LINK = 'text-accent-rust hover:underline';
const STATUS_WORDS: Record<CellStatus, string> = {
  mismatch: 'another route, no waiver', unshipped: 'no lane runs it', waived: 'another route, waived',
  served: 'served', stored: 'keeps the stored text', undecided: 'undecided', idle: 'nothing waiting',
};
const STATUS_TONE: Record<CellStatus, string> = {
  mismatch: 'text-red-700 font-medium', unshipped: 'text-red-700 font-medium', waived: 'text-amber-700',
  served: 'text-emerald-700', stored: 'text-stone-600', undecided: 'text-stone-500', idle: 'text-stone-500',
};
const fmt = (n: number | null | undefined) => (n == null ? '–' : n.toLocaleString('en-US'));

function Evidence({ c }: { c: RouterCell }) {
  const e = c.evidence;
  if (!e) return <span className="text-stone-400">no route block</span>;
  const d = e.defects;
  return (
    <div className="grid gap-0.5">
      <span className="tabular-nums">{e.k_of_n ?? 'untested'}{e.n_eff != null && e.n != null && e.n_eff < e.n ? ` (≈${fmt(Math.round(e.n_eff))} books)` : ''}</span>
      {e.wrong_text_pages && <span className="text-stone-500 tabular-nums">wrong text {e.wrong_text_pages}</span>}
      <span className="text-stone-500 tabular-nums">
        {d ? `per 1k words: wrong text ${d.wrong_text_per_1k ?? '–'}, misleads ${d.misleads_per_1k ?? '–'} (${d.books} books)` : 'no defect verdicts'}
      </span>
      <span className="text-stone-500">
        judge: {c.judge ? `${c.judge.stratum} ${c.judge.valid === false ? 'self-preference FAIL' : c.judge.valid ? 'valid' : 'unmeasured'}` : 'not recorded'}
      </span>
    </div>
  );
}

function Lanes({ c, today }: { c: RouterCell; today: string }) {
  return (
    <div className="grid gap-1">
      {c.lanes.length === 0 && <span className="text-stone-400">no cron lane</span>}
      {c.lanes.map((l, i) => (
        <div key={i} className="grid">
          <span>
            <span className={l.status === 'ok' ? 'text-emerald-700' : l.status === 'mismatch' ? 'text-red-700' : 'text-stone-700'}>{l.runs}</span>
            {l.runs_kn ? <span className="text-stone-500 tabular-nums"> {l.runs_kn}</span> : null}
          </span>
          <span className="text-stone-500">{l.box.replace(/-crontab$/, '')} · {l.lane} · <code>{l.schedule}</code></span>
          {l.comment && <span className="text-stone-400 line-clamp-1">{l.comment}</span>}
        </div>
      ))}
      {c.waivers.map((w, i) => {
        const left = daysLeft(w.until, today);
        return (
          <span key={`w${i}`} className={left < 0 ? 'text-stone-400' : left <= 3 ? 'text-amber-700' : 'text-stone-600'}>
            waiver{w.lane ? ` (${w.lane})` : ''} until {w.until}{left < 0 ? ', expired' : `, ${left} d left`}
          </span>
        );
      })}
    </div>
  );
}

const f2 = (v: number | null | undefined) => (v == null ? '–' : v.toFixed(2));
const interval = (v: number[] | null | undefined) => (v && v.length >= 2 ? `[${f2(v[0])}, ${f2(v[v.length - 1])}]` : '');

/** Every route the table holds for one cell (#240): what each scored, not only the one chosen. */
function RoutesTable({ routes }: { routes: RouteRow[] }) {
  return (
    <table className="w-full text-xs">
      <thead className="text-left text-stone-500">
        <tr>
          <th className="py-1 pr-3 font-medium">route</th>
          <th className="py-1 pr-3 font-medium text-right">accepted</th>
          <th className="py-1 pr-3 font-medium">rate [90%]</th>
          <th className="py-1 pr-3 font-medium text-right">wrong text</th>
          <th className="py-1 pr-3 font-medium text-right">invented / wrong leaf</th>
          <th className="py-1 pr-3 font-medium">per 1k words: misleads / wrong text</th>
          <th className="py-1 font-medium">cost per accepted page</th>
        </tr>
      </thead>
      <tbody className="align-top">
        {routes.map((r) => (
          <tr key={r.id} className={r.decided || r.in_use ? 'bg-stone-50' : ''}>
            <td className="py-1 pr-3">
              <span className={r.decided ? 'font-medium text-stone-900' : 'text-stone-700'}>{r.id}</span>
              {r.in_use && <span className="ml-1.5 text-emerald-700">in use</span>}
              {r.decided && <span className="ml-1.5 text-accent-rust">router&apos;s pick</span>}
              {r.hard_floor_block && <span className="ml-1.5 text-red-700">hard floor</span>}
            </td>
            <td className="py-1 pr-3 text-right tabular-nums whitespace-nowrap">{r.tested ? `${fmt(r.k)} of ${fmt(r.n)}` : <span className="text-stone-400">untested</span>}</td>
            <td className="py-1 pr-3 tabular-nums whitespace-nowrap">
              {r.tested
                ? <>{f2(r.rate)} <span className="text-stone-500">{interval(r.ci90)}</span></>
                : <span className="text-stone-400 italic">prior {f2(r.rate)} {interval(r.ci90)}</span>}
              {r.written_of_drawn && <div className="text-stone-500">wrote {r.written_of_drawn} drawn</div>}
            </td>
            <td className="py-1 pr-3 text-right tabular-nums">{r.tested && r.wrong_text != null ? `${fmt(r.wrong_text)}/${fmt(r.n)}` : '–'}</td>
            <td className="py-1 pr-3 text-right tabular-nums">{r.invented_or_wrong_leaf ?? '–'}</td>
            <td className="py-1 pr-3 tabular-nums whitespace-nowrap">
              {r.defects
                ? <>{f2(r.defects.misleads_per_1k?.[1])} / {f2(r.defects.wrong_text_per_1k?.[1])} <span className="text-stone-500">({r.defects.books} books)</span></>
                : <span className="text-stone-400">no verdicts</span>}
            </td>
            <td className="py-1 tabular-nums whitespace-nowrap">
              {r.cost ? <>{r.cost.mid?.toPrecision(3) ?? '–'} {r.cost.unit} <span className="text-stone-500">{r.cost.low != null && r.cost.high != null ? `[${r.cost.low.toPrecision(3)}, ${r.cost.high.toPrecision(3)}]` : ''}</span></> : <span className="text-stone-500">no new call</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CellTable({ cells, today }: { cells: RouterCell[]; today: string }) {
  return (
    <div className="overflow-x-auto rounded border border-stone-200 bg-white">
      <table className="w-full text-xs">
        <thead className="text-left text-stone-500 bg-stone-50">
          <tr>
            <th className="px-2 py-1.5 font-medium">cell</th>
            <th className="px-2 py-1.5 font-medium">status</th>
            <th className="px-2 py-1.5 font-medium">router decision</th>
            <th className="px-2 py-1.5 font-medium">evidence (decided route)</th>
            <th className="px-2 py-1.5 font-medium">production (lane, box, cron)</th>
            <th className="px-2 py-1.5 font-medium text-right">pages waiting</th>
          </tr>
        </thead>
        <tbody className="align-top">
          {cells.map((c) => (
            <Fragment key={c.cell}>
            <tr id={`cell-${c.cell}`} className="border-t border-stone-200 scroll-mt-4 target:bg-amber-50">
              <td className="px-2 py-1.5">
                <div className="font-medium text-stone-900">{c.cell}</div>
                {c.title && <div className="text-stone-500">{c.title}</div>}
              </td>
              <td className={`px-2 py-1.5 whitespace-nowrap ${STATUS_TONE[c.status]}`}>{STATUS_WORDS[c.status]}</td>
              <td className="px-2 py-1.5">
                <div><span className="font-medium">{c.decision}</span> → {c.route}</div>
                <div className="text-stone-500">{c.table}{c.decided_set ? `, set ${c.decided_set}` : ''}</div>
                {c.decision_label !== c.decision && <div className="text-stone-400 line-clamp-2">{c.decision_label}</div>}
              </td>
              <td className="px-2 py-1.5"><Evidence c={c} /></td>
              <td className="px-2 py-1.5"><Lanes c={c} today={today} /></td>
              <td className="px-2 py-1.5 text-right tabular-nums">{fmt(c.pages_waiting)}</td>
            </tr>
            {c.routes && c.routes.length > 0 && (
              <tr>
                <td colSpan={6} className="px-2 pb-3 pt-0">
                  <div className="ml-3 border-l-2 border-stone-200 pl-3">
                    <div className="text-stone-500 mb-0.5">All {c.routes.length} routes tested or listed for this cell</div>
                    <RoutesTable routes={c.routes} />
                  </div>
                </td>
              </tr>
            )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Board({ doc, now }: { doc: RouterBoardDoc; now: Date }) {
  const { decided, undecided } = splitCells(doc.cells);
  const today = now.toISOString().slice(0, 10);
  const t = (s: CellStatus) => doc.tally[s] ?? { cells: 0, pages_waiting: 0 };
  const undecidedPages = undecided.reduce((a, c) => a + (c.pages_waiting || 0), 0);
  return (
    <>
      <p className="text-sm text-stone-700">
        {decided.length} decided cells in <code className="break-all">{doc.table}</code> (set {doc.pointer_set ?? '–'}).{' '}
        <span className="text-emerald-700">Served {t('served').cells}</span>;{' '}
        <span className="text-amber-700">waived {t('waived').cells}</span>;{' '}
        <span className="text-red-700">another route {t('mismatch').cells} ({fmt(t('mismatch').pages_waiting)} pages)</span>;{' '}
        <span className="text-red-700">no lane {t('unshipped').cells} ({fmt(t('unshipped').pages_waiting)} pages)</span>;{' '}
        keeps the stored text {t('stored').cells};{' '}
        nothing waiting {t('idle').cells}.
      </p>
      <section className="grid grid-cols-[minmax(0,1fr)] gap-2">
        <h2 className="text-xs uppercase tracking-wider text-stone-500">Decided cells ({decided.length})</h2>
        <CellTable cells={decided} today={today} />
      </section>
      <details className="grid grid-cols-[minmax(0,1fr)] gap-2 min-w-0">
        <summary className="text-xs uppercase tracking-wider text-stone-500 cursor-pointer">
          Undecided cells with a lane or pages waiting ({undecided.length}, {fmt(undecidedPages)} pages)
        </summary>
        <div className="mt-2"><CellTable cells={undecided} today={today} /></div>
      </details>
      <p className="text-xs text-stone-500">
        Routing tables: {doc.routing_tables.map((r) => `${r.file.split('/').pop()} changed ${r.changed ?? r.as_of ?? '–'}`).join('; ')}.
        Crontabs are the repo copies ({doc.crontabs.length}), not a live <code>crontab -l</code>.
        Decisions move by the pointer in <a className={LINK} href={`${REPO}/blob/main/scripts/eval/estimator/router-table/current.json`}>current.json</a>;
        the audit is <a className={LINK} href={`${REPO}/blob/main/scripts/maintenance/router-board-push.mjs`}>router-board-push.mjs</a> (<a className={LINK} href={`${REPO}/issues/7913`}>#7913</a>).
      </p>
    </>
  );
}

export default async function RouterPage() {
  const now = new Date();
  let doc: RouterBoardDoc | null = null;
  let error: string | null = null;
  try {
    doc = await getRouterBoard();
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  const age = ageMin(doc, now);
  const stale = age == null || age > ROUTER_BOARD_STALE_MIN;
  return (
    <main className="px-4 py-5 sm:px-6 max-w-6xl mx-auto grid grid-cols-[minmax(0,1fr)] gap-4">
      <header className="grid gap-1">
        <QualityLoopLinks current="/admin/router" />
        <h1 className="text-xl font-semibold text-stone-900">Router</h1>
        <p className={`text-xs ${stale ? 'text-red-700 font-medium' : 'text-stone-500'}`}>
          {doc ? `pushed ${age} min ago${doc.commit ? ` from ${doc.commit}` : ''}` : 'no push yet'}
          {stale ? `. Older than ${ROUTER_BOARD_STALE_MIN} min: the pusher (router-board-push.mjs) is down, so this is out of date` : ''}
        </p>
      </header>
      {error && <p className="text-sm text-red-700">Could not read the router board: {error}</p>}
      {doc && <Board doc={doc} now={now} />}
    </main>
  );
}
