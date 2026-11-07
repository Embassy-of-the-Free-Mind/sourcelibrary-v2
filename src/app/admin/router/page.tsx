import type { Metadata } from 'next';
import {
  ageMin, daysLeft, getRouterBoard, splitCells, ROUTER_BOARD_STALE_MIN,
  type CellStatus, type RouterBoardDoc, type RouterCell,
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
        <tbody className="divide-y divide-stone-100 align-top">
          {cells.map((c) => (
            <tr key={c.cell}>
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
        {decided.length} decided cells in <code>{doc.table}</code> (set {doc.pointer_set ?? '–'}).{' '}
        <span className="text-emerald-700">Served {t('served').cells}</span>;{' '}
        <span className="text-amber-700">waived {t('waived').cells}</span>;{' '}
        <span className="text-red-700">another route {t('mismatch').cells} ({fmt(t('mismatch').pages_waiting)} pages)</span>;{' '}
        <span className="text-red-700">no lane {t('unshipped').cells} ({fmt(t('unshipped').pages_waiting)} pages)</span>;{' '}
        keeps the stored text {t('stored').cells};{' '}
        nothing waiting {t('idle').cells}.
      </p>
      <section className="grid gap-2">
        <h2 className="text-xs uppercase tracking-wider text-stone-500">Decided cells ({decided.length})</h2>
        <CellTable cells={decided} today={today} />
      </section>
      <details className="grid gap-2">
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
    <main className="px-4 py-5 sm:px-6 max-w-6xl mx-auto grid gap-4">
      <header className="grid gap-1">
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
