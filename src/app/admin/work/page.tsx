import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import {
  ago, buildBoard, getWorkBoardDocs, DEAD_WINDOW_H, FINISHED_WINDOW_H, STALE_MIN,
  type Board, type PrRef,
} from '@/lib/work-board';

/**
 * /admin/work — work in flight (#5705). Opened for ~30 seconds, often on a phone, to answer one
 * question: is anything waiting on me, and is anything dead? So, top to bottom: decisions waiting on
 * Derek, dead or stuck jobs, running jobs, finished recently. Nothing else.
 *
 * Renderer only: the boxes push one ops_reports document each (scripts/maintenance/work-board-push.mjs,
 * cron every 10 min) and src/lib/work-board.ts sorts them into the four sections. Each source shows
 * its age and turns red past STALE_MIN — a dead pusher must not look like a quiet board.
 * force-dynamic: a failed read renders an error for this request only, never a cached page.
 * Gate: the admin layout's requireAdmin(); refused on partner hosts (tenant-global-paths);
 * X-Robots-Tag noindex (next.config.ts).
 */
export const metadata: Metadata = {
  title: 'Work in flight',
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const LINK = 'text-accent-rust hover:underline';
const FINISHED_SHOWN = 20;

function Section({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <section className="grid gap-2 content-start min-w-0">
      <h2 className="text-xs uppercase tracking-wider text-stone-500">
        {title} <span className="tabular-nums">({count})</span>
      </h2>
      {children}
    </section>
  );
}

function List({ children }: { children: ReactNode }) {
  return <ul className="grid rounded border border-stone-200 bg-white divide-y divide-stone-100">{children}</ul>;
}

/** One item: a meta line (name, box, times) and one linked line of text. */
function Item({ head, meta, text, href, tone }: { head: string; meta: ReactNode; text: string; href: string | null; tone?: 'red' | 'amber' }) {
  const headTone = tone === 'red' ? 'text-red-700' : tone === 'amber' ? 'text-amber-700' : 'text-stone-900';
  return (
    <li className="px-3 py-2 grid gap-0.5 min-w-0">
      <div className="flex items-baseline gap-2 min-w-0 text-sm">
        <span className={`font-medium truncate ${headTone}`}>{head}</span>
        <span className="text-xs text-stone-500 whitespace-nowrap ml-auto shrink-0 tabular-nums">{meta}</span>
      </div>
      {href
        ? <a href={href} className={`text-sm leading-snug line-clamp-2 break-words ${LINK}`}>{text || '—'}</a>
        : <p className="text-sm leading-snug line-clamp-2 break-words text-stone-700">{text || '—'}</p>}
    </li>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-stone-500">{children}</p>;
}

function prWords(p: PrRef): string {
  const state = p.state === 'MERGED' ? 'merged' : p.state === 'CLOSED' ? 'closed' : p.checks ?? 'open';
  return [`PR #${p.number}`, state, p.state === 'OPEN' && p.tier ? p.tier.replace('tier:', '') : null, p.blocked ? 'BLOCKED' : null]
    .filter(Boolean).join(' · ');
}

function Sections({ b, now }: { b: Board; now: Date }) {
  const hiddenDead = [
    b.hidden.superseded ? `${b.hidden.superseded} replaced by a later job on the same issue` : null,
    b.hidden.closed ? `${b.hidden.closed} on closed issues` : null,
    b.hidden.older ? `${b.hidden.older} older than ${DEAD_WINDOW_H} h` : null,
  ].filter(Boolean);
  const finished = b.finished.slice(0, FINISHED_SHOWN);
  return (
    <>
      <Section title="Waiting on you" count={b.waiting.length}>
        {b.waiting.length === 0 ? <Empty>Nothing. No open issue’s last comment asks for a decision.</Empty> : (
          <List>
            {b.waiting.map((w, i) => (
              <Item key={i} head={`#${w.issue.number} ${w.issue.title ?? ''}`}
                meta={<>{w.default ? <b className="text-stone-700">default: {w.default}</b> : null} {ago(w.at, now)}</>}
                text={w.line} href={w.url} />
            ))}
          </List>
        )}
      </Section>

      <Section title="Dead or stuck" count={b.dead.length}>
        {b.dead.length === 0 ? <Empty>Nothing dead.</Empty> : (
          <List>
            {b.dead.map(d => (
              <Item key={`${d.box}:${d.name}`} head={d.name} tone={d.state === 'stuck' ? 'amber' : 'red'}
                meta={<>{d.box} · {ago(d.at, now)}</>}
                text={`${d.why}${d.issue ? ` — #${d.issue.number} ${d.issue.title ?? ''}` : ''}`}
                href={d.issue?.url ?? null} />
            ))}
          </List>
        )}
        {hiddenDead.length > 0 && <p className="text-xs text-stone-500">Not listed: {hiddenDead.join(', ')}.</p>}
      </Section>

      <Section title="Running" count={b.running.length}>
        {b.running.length === 0 ? <Empty>No job or chain is running.</Empty> : (
          <List>
            {b.running.map(r => (
              <Item key={`${r.box}:${r.kind}:${r.name}`} head={r.name}
                meta={<>{r.box} · up {ago(r.started, now)} · seen {ago(r.last_activity, now)} ago</>}
                text={r.issue ? `#${r.issue.number} ${r.what}` : r.what} href={r.issue?.url ?? null} />
            ))}
          </List>
        )}
      </Section>

      <Section title={`Finished, last ${FINISHED_WINDOW_H} h`} count={b.finished.length}>
        {b.finished.length === 0 ? <Empty>Nothing finished.</Empty> : (
          <List>
            {finished.map(f => (
              <li key={`${f.box}:${f.name}`} className="px-3 py-2 grid gap-0.5 min-w-0">
                <div className="flex items-baseline gap-2 min-w-0 text-sm">
                  <span className="font-medium truncate text-stone-900">{f.name}</span>
                  <span className="text-xs text-stone-500 whitespace-nowrap ml-auto tabular-nums">{ago(f.at, now)}</span>
                </div>
                {f.verdict_url || f.issue
                  ? <a href={f.verdict_url ?? f.issue!.url} className={`text-sm leading-snug line-clamp-2 break-words ${LINK}`}>{f.verdict || `#${f.issue!.number}`}</a>
                  : <p className="text-sm leading-snug line-clamp-2 break-words text-stone-700">{f.verdict || '—'}</p>}
                {f.pr && (
                  <a href={f.pr.url} className={`text-xs ${f.pr.checks === 'red' && f.pr.state === 'OPEN' ? 'text-red-700 hover:underline' : 'text-stone-500 hover:underline'}`}>
                    {prWords(f.pr)}
                  </a>
                )}
              </li>
            ))}
          </List>
        )}
        {b.finished.length > FINISHED_SHOWN && <p className="text-xs text-stone-500">…and {b.finished.length - FINISHED_SHOWN} earlier.</p>}
      </Section>
    </>
  );
}

export default async function WorkPage() {
  const now = new Date();
  let board: Board | null = null;
  let error: string | null = null;
  try {
    board = buildBoard(await getWorkBoardDocs(), now);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  return (
    <main className="px-4 py-5 sm:px-6 max-w-3xl mx-auto grid gap-6">
      <header className="grid gap-1">
        <h1 className="text-xl font-semibold text-stone-900">Work in flight</h1>
        {board && (
          <p className="text-xs text-stone-500 flex flex-wrap gap-x-3 gap-y-0.5">
            {board.freshness.map(f => (
              <span key={f.source} className={f.stale ? 'text-red-700 font-medium' : undefined}>
                {f.source}: {f.age_min == null ? 'no data' : `${ago(f.generated_at, now)} ago`}
              </span>
            ))}
          </p>
        )}
        {board?.freshness.some(f => f.stale) && (
          <p className="text-xs text-red-700">
            Red = no push in {STALE_MIN} min: that box’s pusher is down, so its jobs are missing or out of date below.
          </p>
        )}
      </header>
      {error && <p className="text-sm text-red-700">Could not read the work board: {error}</p>}
      {board && <Sections b={board} now={now} />}
      {board && board.errors.length > 0 && (
        <p className="text-xs text-stone-500">GitHub read errors: {board.errors.join('; ')}</p>
      )}
    </main>
  );
}
