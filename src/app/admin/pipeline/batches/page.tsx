import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { agoText, ageMin } from '@/lib/pipeline-now';
import { getBatches, type BatchRow, type BatchesDoc } from '@/lib/batches';
import { blockersOf, issueLabel, issueUrl, stagesOf, STALE_HOURS } from '../../../../../scripts/lib/batches.mjs';

/**
 * /admin/pipeline/batches — where each batch of books is in the pipeline, and what blocks its next stage (v3#269).
 * Opened a few times a day, often on a phone, for under a minute: which batch is stuck, on what, and is it waiting on
 * Derek? One row per batch (a hold with its books, or a campaign whose hold is released), largest first: the stages
 * as a strip with the count under each, the blocker in words, the last 24 h, the issue and the book list.
 *
 * Renderer only: scripts/maintenance/batches-push.mjs writes one ops_reports document hourly on main; this page reads
 * it by _id and nothing else. Server-rendered, no client JavaScript. The snapshot's age is at the top, red past
 * STALE_HOURS. Gate: the admin layout's requireAdmin(); refused on partner hosts (tenant-global-paths).
 */
export const metadata: Metadata = {
  title: 'Batches',
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const LINK = 'text-accent-rust hover:underline';
const fmt = (n: number | null | undefined) => (n == null ? '–' : n.toLocaleString('en-US'));
const iso = (d: string | Date | null | undefined) => (d ? (d instanceof Date ? d.toISOString() : String(d)) : null);
const TONE: Record<string, string> = { red: 'text-red-700 font-medium', amber: 'text-amber-700 font-medium' };

type Stage = ReturnType<typeof stagesOf>[number];
type Blocker = { tone: string | null; text: string; href?: string | null };

function Strip({ row }: { row: BatchRow }) {
  const stages = stagesOf(row) as Stage[];
  return (
    <ol className="grid grid-cols-5 gap-1 text-xs">
      {stages.map(s => (
        <li key={s.key} className="grid gap-0.5 min-w-0" title={s.note ?? undefined}>
          <span className="text-stone-500 truncate">{s.label}</span>
          <span className="block h-2 rounded-sm bg-stone-100 overflow-hidden" aria-hidden="true">
            {s.fraction ? <span className={`block h-full ${s.fill === 'full' ? 'bg-stone-700' : 'bg-accent-rust'}`} style={{ width: `${Math.max(2, Math.round(s.fraction * 100))}%` }} /> : null}
          </span>
          <span className={`tabular-nums truncate ${s.fill === 'unknown' ? 'text-stone-500' : 'text-stone-800'}`}>
            {s.count == null ? 'not measured' : fmt(s.count)}
            {s.key === 'public' ? <span className="text-stone-500"> bk</span> : null}
          </span>
          {s.key === 'imported' ? <span className="text-stone-500 truncate">{s.note}</span> : null}
          {s.key !== 'imported' && s.fraction != null && s.of ? <span className="text-stone-500 tabular-nums" title={s.count! > s.of ? `${fmt(s.count)} counted against ${fmt(s.of)}: more records than pages_count` : undefined}>{Math.floor(s.fraction * 100)}%{s.count! > s.of ? '+' : ''}</span> : null}
        </li>
      ))}
    </ol>
  );
}

function Row({ row, now }: { row: BatchRow; now: Date }) {
  const blockers = blockersOf(row, { now }) as Blocker[];
  const issue = row.issue ? { repo: row.issue.repo, number: row.issue.number } : null;
  const img = row.images;
  const imgAge = img?.as_of ? agoText(img.as_of, now) : null;
  return (
    <li id={row.key} className="px-3 py-3 grid gap-2 min-w-0">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 min-w-0 text-sm">
        <span className="font-medium break-all">{row.kind === 'contained' ? 'Contained (small containment holds)' : row.name}</span>
        <span className="text-xs text-stone-500">{row.kind === 'campaign' ? 'campaign, released' : row.kind === 'contained' ? `${row.members?.length ?? 0} holds` : row.not_acquired ? 'hold, not acquired' : 'hold'}</span>
        <span className="ml-auto flex gap-3 text-xs whitespace-nowrap">
          {issue ? <a className={LINK} href={issueUrl(issue) ?? undefined}>{issueLabel(issue)}{row.issue?.state === 'CLOSED' ? ' (closed)' : ''}</a> : null}
          <a className={LINK} href={`?batch=${encodeURIComponent(row.key)}#books`}>books</a>
        </span>
      </div>
      <Strip row={row} />
      <p className="text-xs text-stone-600 tabular-nums">
        Last 24 h: {fmt(row.moved_24h.read)} pages read · {fmt(row.moved_24h.translated)} translated
        {imgAge ? <span className="text-stone-500"> · images counted {imgAge} ago</span> : null}
      </p>
      {row.frames?.map(f => (
        <p key={f.route} className="text-xs text-stone-600">Frame of {f.route}: <b className="tabular-nums">{fmt(f.books)}</b> books, <b className="tabular-nums">{fmt(f.pages_owed)}</b> pages with no text <span className="text-stone-500">({f.rule})</span></p>
      ))}
      <ul className="grid gap-0.5 text-sm leading-snug">
        {blockers.map((b, i) => (
          <li key={i} className={`break-words ${b.tone ? TONE[b.tone] : 'text-stone-700'}`}>
            {b.href ? <a className="hover:underline" href={b.href}>{b.text}</a> : b.text}
          </li>
        ))}
      </ul>
      {row.members?.length ? (
        <p className="text-xs text-stone-500 break-words">
          {row.members.map((m, i) => (
            <span key={m.reason}>{i ? ' · ' : ''}{m.reason} ({m.books}){m.issue && m.issue_repo ? <> <a className={LINK} href={issueUrl({ repo: m.issue_repo, number: m.issue }) ?? undefined}>{issueLabel({ repo: m.issue_repo, number: m.issue })}</a></> : null}</span>
          ))}
        </p>
      ) : null}
      {row.recent?.length ? (
        <ul className="grid gap-0.5 text-xs text-stone-500">
          {row.recent.map(c => (
            <li key={c.url} className="break-words">On {issueLabel(issue)}, {agoText(c.at, now)} ago: <a className={LINK} href={c.url}>{c.first_line || '(no text)'}</a></li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function BookList({ row }: { row: BatchRow }) {
  return (
    <section id="books" className="grid gap-2 min-w-0">
      <h2 className="text-xs uppercase tracking-wider text-stone-500">Books in {row.name} <span className="normal-case tracking-normal">(largest {row.books_list.length} of {fmt(row.books)})</span></h2>
      <div className="overflow-x-auto rounded border border-stone-200 bg-white">
        <table className="w-full text-sm tabular-nums">
          <thead className="text-xs text-stone-500"><tr>
            <th className="text-left font-normal px-2 py-1">book</th><th className="text-right font-normal px-2 py-1">pages</th>
            <th className="text-right font-normal px-2 py-1">read</th><th className="text-right font-normal px-2 py-1">translated</th><th className="text-right font-normal px-2 py-1">public</th>
          </tr></thead>
          <tbody className="divide-y divide-stone-100">
            {row.books_list.map(b => (
              <tr key={b.id}>
                <td className="px-2 py-1 min-w-[12rem]"><a className={LINK} href={`/book/${encodeURIComponent(b.id)}${b.live ? '' : '/preview'}`}>{b.title || b.id}</a></td>
                <td className="text-right px-2 py-1">{fmt(b.pages)}</td><td className="text-right px-2 py-1">{fmt(b.read)}</td>
                <td className="text-right px-2 py-1">{fmt(b.translated)}</td><td className="text-right px-2 py-1">{b.live ? 'yes' : 'no'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-stone-500">From the snapshot. <a className={LINK} href="/admin/pipeline/batches">Close</a></p>
    </section>
  );
}

function List({ rows, now }: { rows: BatchRow[]; now: Date }) {
  return <ul className="grid rounded border border-stone-200 bg-white divide-y divide-stone-100">{rows.map(r => <Row key={r.key} row={r} now={now} />)}</ul>;
}

function Body({ doc, now, batch }: { doc: BatchesDoc; now: Date; batch: string | undefined }) {
  const held = doc.batches.filter(r => r.kind !== 'campaign');
  const camps = doc.batches.filter(r => r.kind === 'campaign');
  const picked = batch ? doc.batches.find(r => r.key === batch) : undefined;
  const waiting = held.filter(r => r.decisions?.length).length;
  return (
    <>
      {picked ? <BookList row={picked} /> : null}
      <Section title="Held batches" meta={`${held.length} rows · ${fmt(doc.sources.held_books)} held books · ${waiting} waiting on you`}>
        <List rows={held} now={now} />
      </Section>
      {camps.length ? (
        <details className="grid gap-2">
          <summary className="cursor-pointer text-xs uppercase tracking-wider text-stone-500">Released campaigns ({camps.length}): books with no hold left</summary>
          <div className="mt-2"><List rows={camps} now={now} /></div>
        </details>
      ) : null}
      <footer className="grid gap-1 text-xs text-stone-500">
        <p>Imported = <code>pages_count</code> (a manifest-only book has no page records). Image archived = pages whose <code>archived_photo</code> is an R2 URL: the RECORD tier of <code>archive-coverage.md</code>, not FILE or MASTER; measured page by page in turns, so each row says how old its count is. Read and translated = the <code>pages_ocr</code> / <code>pages_translated</code> counters. Public = books visible with pages. Last 24 h = pages whose OCR or translation was written in the last 24 h (a rewrite counts).</p>
        <p>A batch is a hold with its books, or a campaign whose books carry no hold. Holds of under 20 books placed on books already in the pipeline share the Contained row. Lanes: <code>scripts/gpu/ocr-filler-routes.tsv</code> ({doc.sources.routes}) and <code>scripts/lib/lanes.mjs</code>. Decisions: the hold&apos;s release condition and the last comments on its issue.</p>
        <p>Pushed by <code>scripts/maintenance/batches-push.mjs</code> on {doc.host} in {doc.run_seconds} s; images measured for {doc.sources.images_measured_this_run} batches this run.{doc.errors?.length ? <span className="text-red-700"> Errors: {doc.errors.join('; ')}</span> : null}</p>
      </footer>
    </>
  );
}

function Section({ title, meta, children }: { title: string; meta?: ReactNode; children: ReactNode }) {
  return (
    <section className="grid gap-2 content-start min-w-0">
      <h2 className="flex flex-wrap items-baseline gap-x-2 text-xs uppercase tracking-wider text-stone-500">
        <span>{title}</span>
        {meta ? <span className="ml-auto normal-case tracking-normal tabular-nums">{meta}</span> : null}
      </h2>
      {children}
    </section>
  );
}

export default async function BatchesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const now = new Date();
  const { batch } = await searchParams;
  let doc: BatchesDoc | null = null;
  let error: string | null = null;
  try { doc = await getBatches(); } catch (e) { error = e instanceof Error ? e.message : String(e); }
  const at = iso(doc?.generated_at);
  const m = ageMin(at, now);
  const stale = m === null || m > STALE_HOURS * 60;
  return (
    <main className="px-4 py-5 sm:px-6 max-w-3xl mx-auto grid gap-6">
      <header className="grid gap-1">
        <h1 className="text-xl font-semibold text-stone-900">Batches</h1>
        <p className={`text-xs ${stale ? 'text-red-700 font-medium' : 'text-stone-500'}`}>
          {at ? `Snapshot ${agoText(at, now)} old (${at.slice(0, 16).replace('T', ' ')}Z)` : 'No snapshot yet'}
          {stale ? `: older than ${STALE_HOURS} h, the hourly push on main is down or failing.` : '.'}
        </p>
        <p className="text-xs text-stone-500">
          Lanes and stops: <a className={LINK} href="/admin/pipeline/now">/admin/pipeline/now</a>. Jobs and decisions: <a className={LINK} href="/admin/work">/admin/work</a>. Plan: <a className={LINK} href="https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v3/issues/269">#269</a>.
        </p>
      </header>
      {error ? <p className="text-sm text-red-700">Could not read ops_reports: {error}</p> : null}
      {doc ? <Body doc={doc} now={now} batch={batch} /> : null}
    </main>
  );
}
