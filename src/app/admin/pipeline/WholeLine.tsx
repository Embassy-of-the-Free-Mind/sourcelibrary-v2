import type { ReactNode } from 'react';
import Link from 'next/link';
import { agoText, ageMin } from '@/lib/pipeline-now';
import { buildHeadline, type HeadlineItem, type HeadlineTone, type Line, type LineRow, type LineRunner } from '@/lib/pipeline-line';

/**
 * "The whole line" (v3#421): every stage a book passes through, in order, on one screen. Server component and
 * renderer only: src/lib/pipeline-line.ts joins the documents, nothing is measured on the request. A stage with no
 * instrument says so; a stage with work waiting and nothing scheduled says so.
 */

const exact = (v: number) => Math.round(v).toLocaleString('en-US');
/** 26,059,480 → 26.1M; 235,714 → 236K; small numbers in full. The exact figure goes in the title attribute. */
function short(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e4) return `${Math.round(v / 1e3)}K`;
  return exact(v);
}
const signed = (v: number) => `${v > 0 ? '+' : ''}${short(v)}`;
const pct = (a: number, b: number) => (b > 0 ? `${((100 * a) / b).toFixed(a / b < 0.1 ? 1 : 0)}%` : '–');

const muted = { color: 'var(--text-muted)' };
const faint = { color: 'var(--text-faint)' };
const primary = { color: 'var(--text-primary)' };
const secondary = { color: 'var(--text-secondary)' };

const FLAG_TONE: Record<string, string> = {
  'STALLED': 'text-red-700', 'NOTHING SCHEDULED': 'text-red-700', 'PROBE BROKEN': 'text-red-700', 'RED LINE': 'text-red-700',
  'RUNS, DOES NOTHING': 'text-amber-700', 'NOT MEASURED': 'text-amber-700',
};

/** A cell with its column name shown above it on a phone, where the header row is hidden. */
function Cell({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="min-w-0 text-sm" style={secondary}>
      <div className="md:hidden text-[11px] uppercase tracking-wider" style={faint}>{name}</div>
      {children}
    </div>
  );
}

function Done({ r }: { r: LineRow }) {
  if (!r.done) {
    // A flag under the stage name that already gives the reason is not repeated here.
    const said = r.flags.find(f => f.why === r.doneNote);
    return <span className="text-xs" style={faint}>{said ? said.flag.toLowerCase() : r.doneNote ?? 'not measured'}</span>;
  }
  const { covered, total, unit, of, also } = r.done;
  const alsoLine = also.length ? (
    <div className="text-[11px] break-words" style={faint}>{also.map(a => `${short(a.n)} ${a.label}`).join(' · ')}</div>
  ) : null;
  if (total == null) {
    // A count with no denominator (books held as copies): no share, no bar.
    return (
      <div className="grid gap-1">
        <div className="tabular-nums" title={`${exact(covered)} ${unit}`}><span className="font-medium" style={primary}>{short(covered)}</span> {unit}</div>
        <div className="text-[11px]" style={faint}>{of}</div>
        {alsoLine}
      </div>
    );
  }
  const share = total > 0 ? Math.min(1, covered / total) : 0;
  return (
    <div className="grid gap-1">
      <div className="tabular-nums" title={`${exact(covered)} of ${exact(total)} ${unit}`}>
        <span className="font-medium" style={primary}>{short(covered)}</span> of {short(total)} {unit} · {pct(covered, total)}
      </div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--border-light)' }} aria-hidden>
        <div className="h-full rounded-full" style={{ width: `${Math.max(share * 100, share > 0 ? 1 : 0)}%`, background: 'var(--text-muted)' }} />
      </div>
      <div className="text-[11px]" style={faint}>of {of}</div>
      {alsoLine}
    </div>
  );
}

function Waiting({ r }: { r: LineRow }) {
  if (!r.waiting) return <span style={faint}>–</span>;
  const { books, pages, allBooks } = r.waiting;
  return (
    <div className="tabular-nums">
      <div title={exact(books)}><span className="font-medium" style={primary}>{short(books)}</span> visible books</div>
      {pages != null ? <div className="text-xs" title={exact(pages)}>{short(pages)} pages owed</div> : null}
      {allBooks !== books ? <div className="text-[11px]" style={faint} title={exact(allBooks)}>{short(allBooks)} with hidden books</div> : null}
    </div>
  );
}

function Moved({ r }: { r: LineRow }) {
  if (!r.yesterday && !r.week) return <span style={faint}>–</span>;
  return (
    <div className="tabular-nums">
      {r.yesterday ? (
        <>
          <div title={exact(r.yesterday.n)}>
            <span className={`font-medium ${r.yesterday.n === 0 ? 'text-amber-700' : ''}`} style={r.yesterday.n === 0 ? undefined : primary}>{signed(r.yesterday.n)}</span> {r.yesterday.unit}
          </div>
          <div className="text-[11px]" style={faint}>{r.yesterday.when}</div>
          {r.yesterday.parts.length > 1 ? (
            <div className="text-[11px] break-words" style={faint}>{r.yesterday.parts.map(p => `${p.label} ${short(p.n)}`).join(' · ')}</div>
          ) : null}
        </>
      ) : null}
      {r.week ? <div className="text-xs" title={exact(r.week.n)}>{signed(r.week.n)} since {r.week.since.slice(5)}</div> : null}
    </div>
  );
}

/** "9 on gex45 · 3 on hetzner", live lines only. */
function byBox(runners: LineRunner[]): string {
  const m = new Map<string, number>();
  for (const r of runners) m.set(r.box, (m.get(r.box) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([box, n]) => `${n} on ${box}`).join(' · ');
}

function RunnerLine({ r, now }: { r: LineRunner; now: Date }) {
  const l = r.line;
  const off = l.disabled || l.one_shot;
  const stale = (ageMin(l.log_at, now) ?? 0) > 36 * 60;
  return (
    <li className={`py-1 min-w-0 border-t ${off ? 'opacity-60' : ''}`} style={{ borderColor: 'var(--border-light)' }}>
      <span style={faint}>{r.box}</span>{' '}
      <span className="font-medium break-all" style={primary}>{l.script?.split('/').pop() ?? '(inline command)'}{l.mode ? ` ${l.mode}` : ''}</span>{' '}
      {l.disabled ? <span className="text-amber-700">off</span> : null}
      {l.red?.length ? <span className="text-red-700 font-medium"> {[...new Set(l.red.map(x => x.flag))].join(' · ')}</span> : null}
      <span className="font-mono" style={faint}> {l.schedule}</span>
      {l.log && !off ? <span className={stale ? 'text-amber-700' : ''} style={stale ? undefined : faint}> · log {agoText(l.log_at, now)} ago</span> : null}
      {l.registry?.route ? <span style={faint}> · {l.registry.route}</span> : null}
      {l.flags.length ? <div className="font-mono break-all" style={faint}>{l.flags.join(' ')}</div> : null}
    </li>
  );
}

function Runs({ r, now, read }: { r: LineRow; now: Date; read: boolean }) {
  const live = r.runners.filter(x => !x.line.disabled && !x.line.one_shot);
  const off = r.runners.length - live.length;
  const none = live.length === 0 && r.runs.length === 0 && !r.inside;
  return (
    <div className="grid gap-0.5">
      {r.inside ? <div className="text-xs leading-snug">{r.inside}</div> : null}
      {live.length ? <div><span className="font-medium" style={primary}>{live.length}</span> cron {live.length === 1 ? 'line' : 'lines'}: {byBox(live)}</div> : null}
      {r.runs.map(x => (
        <div key={x.cron} className="text-xs tabular-nums">
          run log <span className="break-all">{x.cron}</span>: {exact(x.runs)} runs in 24 h{x.skipped ? `, ${exact(x.skipped)} skipped` : ''}{x.failed ? `, ${exact(x.failed)} failed` : ''}
        </div>
      ))}
      {r.idle.map(t => <div key={t} className="text-xs leading-snug" style={faint}>{t}</div>)}
      {none ? <span style={faint}>{r.key === 'done' ? '–' : read ? 'nothing scheduled' : 'not read: a box has not reported'}</span> : null}
      {r.runners.length ? (
        <details className="text-xs">
          <summary className="cursor-pointer" style={muted}>show {r.runners.length} {r.runners.length === 1 ? 'line' : 'lines'}{off ? ` (${off} off)` : ''}</summary>
          <ul className="mt-1">
            {r.runners.map((x, i) => <RunnerLine key={`${x.box}-${x.line.script}-${x.line.schedule}-${i}`} r={x} now={now} />)}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

const HEADLINE_TONE: Record<HeadlineTone, string> = { bad: 'text-red-700', warn: 'text-amber-700', ok: 'text-green-700', info: '' };

/** The five sentences above the table (v3#453): the state in words, before any number in a column. */
function Headline({ items }: { items: HeadlineItem[] }) {
  if (!items.length) return null;
  return (
    <dl className="grid md:grid-cols-[8rem_minmax(0,1fr)] gap-x-4 gap-y-1.5 mb-4 pb-4 border-b text-sm max-w-5xl" style={{ borderColor: 'var(--border-light)' }}>
      {items.map(h => (
        <div key={h.key} className="contents">
          <dt className={`font-medium ${HEADLINE_TONE[h.tone]}`} style={h.tone === 'info' ? primary : undefined}>{h.label}</dt>
          <dd className="leading-snug mb-1 md:mb-0" style={secondary}>
            {h.text}
            {h.key === 'held' ? <>{' '}<Link className="text-accent-rust hover:underline" href="/admin/pipeline/now">Each hold and its owner</Link>.</> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

const COLS ='md:grid-cols-[minmax(0,1.5fr)_minmax(0,1.3fr)_minmax(0,0.9fr)_minmax(0,1fr)_minmax(0,1.4fr)]';

export function WholeLine({ line, error }: { line: Line | null; error: string | null }) {
  const now = new Date();
  const steps = line?.rows.filter(r => !r.onRequest) ?? [];
  const onRequest = line?.rows.filter(r => r.onRequest) ?? [];
  return (
    <section className="rounded-xl border p-4 mb-6" style={{ borderColor: 'var(--border-light)', background: 'white' }}>
      <h2 className="text-xs font-medium uppercase tracking-wider" style={muted}>The whole line</h2>
      <p className="text-xs mt-1 mb-3 max-w-4xl leading-snug" style={faint}>
        Every stage a book passes through, in order. Each row is joined from reports that already exist; a stage nothing measures says so.
        {line ? <>{' '}Read: {line.sources.map((s, i) => {
          const m = ageMin(s.at, now);
          const stale = m === null || m > s.staleAfterMin;
          return <span key={s.label}>{i ? ' · ' : ''}{s.label} <span className={stale ? 'text-red-700 font-medium' : ''}>{m === null ? 'never' : `${agoText(s.at, now)} ago`}</span></span>;
        })}.</> : null}
      </p>
      {error || !line ? <p className="text-sm text-red-700">Could not read the reports: {error ?? 'no data'}</p> : (
        <>
          <Headline items={buildHeadline(line)} />
          <div className={`hidden md:grid ${COLS} gap-x-4 pb-1 text-[11px] uppercase tracking-wider border-b`} style={{ ...faint, borderColor: 'var(--border-light)' }}>
            <div>Stage</div><div>Done</div><div>Waiting for this step</div><div>Moved</div><div>What runs it</div>
          </div>
          <ol>
            {steps.map((r, i) => (
              <li key={r.key} className={`grid grid-cols-2 ${COLS} gap-x-4 gap-y-2 py-3 ${i ? 'border-t' : ''}`} style={{ borderColor: 'var(--border-light)' }}>
                <div className="min-w-0 col-span-2 md:col-span-1">
                  <div className="text-sm font-medium" style={primary}><span className="tabular-nums" style={faint}>{i + 1}</span> {r.label}</div>
                  <p className="text-xs leading-snug" style={muted}>{r.what}</p>
                  {r.flags.map(f => (
                    <p key={f.flag + f.why} className="text-xs leading-snug mt-1">
                      <span className={`font-medium ${FLAG_TONE[f.flag] ?? 'text-red-700'}`}>{f.flag}</span> <span style={muted}>{f.why}</span>
                    </p>
                  ))}
                  <p className="text-[11px] mt-1">
                    {r.more.map((m, j) => (
                      <span key={m.href}>
                        {j ? ' · ' : ''}
                        {m.href.startsWith('#')
                          ? <a className="text-accent-rust hover:underline" href={m.href}>{m.label}</a>
                          : <Link className="text-accent-rust hover:underline" href={m.href}>{m.label}</Link>}
                      </span>
                    ))}
                  </p>
                </div>
                <Cell name="Done"><Done r={r} /></Cell>
                <Cell name="Waiting for this step"><Waiting r={r} /></Cell>
                <Cell name="Moved"><Moved r={r} /></Cell>
                <Cell name="What runs it"><Runs r={r} now={now} read={line.runnersRead} /></Cell>
              </li>
            ))}
          </ol>
          {onRequest.length ? (
            <div className="mt-3 pt-3 border-t" style={{ borderColor: 'var(--border-light)' }}>
              <h3 className="text-xs font-medium uppercase tracking-wider" style={muted}>On request</h3>
              <p className="text-xs mt-1 mb-1 leading-snug" style={faint}>Made when a reader or a person asks, not for every book, so nothing here is owed and nothing waits.</p>
              <ul>
                {onRequest.map((r, i) => (
                  <li key={r.key} className={`grid md:grid-cols-[minmax(0,1.5fr)_minmax(0,3fr)] gap-x-4 gap-y-1 py-2 ${i ? 'border-t' : ''}`} style={{ borderColor: 'var(--border-light)' }}>
                    <div className="min-w-0">
                      <div className="text-sm font-medium" style={primary}>{r.label}</div>
                      <p className="text-xs leading-snug" style={muted}>{r.what}</p>
                    </div>
                    <Cell name="What makes it"><Runs r={r} now={now} read={line.runnersRead} /></Cell>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {line.other.length ? (
            <details className="text-xs mt-3">
              <summary className="cursor-pointer" style={muted}>{line.other.length} other scheduled lines serve no stage above (audits, snapshots, the scheduler)</summary>
              <ul className="mt-1">
                {line.other.map((x, i) => <RunnerLine key={`${x.box}-${x.line.script}-${x.line.schedule}-${i}`} r={x} now={now} />)}
              </ul>
            </details>
          ) : null}
          <p className="text-[11px] mt-3 max-w-4xl leading-snug" style={faint}>
            Done is counted from the data each night; waiting is the visible books whose next step is that stage, counted daily, so a book waits in one row only.
            A box reports a cron line only when its script name matches a stage rule (<code>scripts/maintenance/pipeline-now-push.mjs</code>), and the scheduler&apos;s workers are not cron lines: a stage can be served by something this table cannot see.
            A step that runs inside another job says which; the orchestrator&apos;s run log beside it shows the orchestrator ran, not that the phase had work.
            Stage list: <code>src/lib/pipeline-line.ts</code>.
          </p>
        </>
      )}
    </section>
  );
}
