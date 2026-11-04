import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import {
  agoText, ageMin, untilText, getPipelineNow, laneTable, linesByStage, weeklyPct,
  BOX_STALE_MIN, CORPUS_STALE_MIN, STAGE_LABEL,
  type BoxDoc, type CronLine, type DayRow, type PipelineNow,
} from '@/lib/pipeline-now';

/**
 * /admin/pipeline/now — what is OCRing, translating and enriching books right now (#7759). Generated, never
 * hand-written: every box pushes its live crontab lanes, agy pools and lane switches hourly, and main pushes the
 * per-day page counts by lane nightly (scripts/maintenance/pipeline-now-push.mjs). The intent behind it lives in
 * .claude/docs/book-process.md, which points here for every number.
 *
 * Top to bottom: pages written per lane (what actually happened), the quota that feeds the lanes (agy pools,
 * Claude accounts), the spend dial and quality gates, then each box's lanes by stage. Each source shows its age
 * and turns red when stale. Gate: the admin layout's requireAdmin(); refused on partner hosts (tenant-global-paths).
 */
export const metadata: Metadata = {
  title: 'Pipeline now',
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const fmt = (n: number) => n.toLocaleString('en-US');
const pct = (f: number | null) => (f === null ? '–' : `${Math.round(f * 100)}%`);

function Section({ title, meta, children }: { title: string; meta?: ReactNode; children: ReactNode }) {
  return (
    <section className="grid gap-2 content-start min-w-0">
      <h2 className="flex items-baseline gap-2 text-xs uppercase tracking-wider text-stone-500">
        <span>{title}</span>
        {meta ? <span className="ml-auto normal-case tracking-normal tabular-nums">{meta}</span> : null}
      </h2>
      {children}
    </section>
  );
}

function Age({ iso, staleMin, now }: { iso: string | null | undefined; staleMin: number; now: Date }) {
  const m = ageMin(iso, now);
  const stale = m === null || m > staleMin;
  return <span className={stale ? 'text-red-700 font-medium' : ''}>{m === null ? 'never pushed' : `pushed ${agoText(iso, now)} ago`}</span>;
}

function LaneTable({ title, rows, now, generated }: { title: string; rows: DayRow[] | null; now: Date; generated: string | null }) {
  const t = laneTable(rows);
  return (
    <Section title={title} meta={<Age iso={generated} staleMin={CORPUS_STALE_MIN} now={now} />}>
      {t.lanes.length === 0 ? <p className="text-sm text-stone-500">No rows.</p> : (
        <div className="overflow-x-auto rounded border border-stone-200 bg-white">
          <table className="w-full text-sm tabular-nums">
            <thead className="text-xs text-stone-500">
              <tr>
                <th className="text-left font-normal px-2 py-1">lane · model</th>
                {t.days.map(d => <th key={d} className="text-right font-normal px-2 py-1 whitespace-nowrap">{d.slice(5)}</th>)}
                <th className="text-right font-normal px-2 py-1">total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {t.lanes.slice(0, 15).map(l => (
                <tr key={`${l.lane}-${l.model}`}>
                  <td className="px-2 py-1 min-w-[12rem]"><span className="font-medium">{l.lane}</span> <span className="text-stone-500">{l.model}</span></td>
                  {l.perDay.map((n, i) => <td key={t.days[i]} className="text-right px-2 py-1 text-stone-700">{n ? fmt(n) : ''}</td>)}
                  <td className="text-right px-2 py-1 font-medium">{fmt(l.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-stone-500">Pages whose {title.startsWith('OCR') ? 'ocr' : 'translation'}.updated_at fell on that UTC day, by the lane (or source) and model stamped on the page. The last day is partial. A rewrite counts again.</p>
    </Section>
  );
}

function Quota({ data, now }: { data: PipelineNow; now: Date }) {
  // The pools are per Google account, so every box reports the same ones; show each pool once, freshest reading.
  const pools = new Map<string, { weekly: number | null; weekly_reset: string | null; five_hour: number | null; boxes: string[] }>();
  for (const { box, doc } of data.boxes) for (const p of doc?.agy_pools ?? []) {
    const e = pools.get(p.pool);
    if (!e) pools.set(p.pool, { weekly: p.weekly, weekly_reset: p.weekly_reset, five_hour: p.five_hour, boxes: [box] });
    else e.boxes.push(box);
  }
  return (
    <Section title="Quota that feeds the lanes">
      <ul className="grid rounded border border-stone-200 bg-white divide-y divide-stone-100 text-sm">
        {[...pools.entries()].map(([name, p]) => (
          <li key={name} className="px-3 py-2 flex flex-wrap items-baseline gap-x-3">
            <span className="font-medium">agy pool {name}</span>
            <span className={p.weekly !== null && p.weekly < 0.35 ? 'text-amber-700' : ''}>week {pct(p.weekly)} left</span>
            <span className="text-stone-500">5 h {pct(p.five_hour)}</span>
            <span className="text-stone-500 ml-auto text-xs">week resets {untilText(p.weekly_reset, now)} · on {p.boxes.join(', ')}</span>
          </li>
        ))}
        {(data.claude?.accounts ?? []).map(a => {
          const w = weeklyPct(a);
          return (
            <li key={a.email} className="px-3 py-2 flex flex-wrap items-baseline gap-x-3">
              <span className="font-medium">Claude {a.email}</span>
              <span className={w.pct !== null && w.pct >= 90 ? 'text-amber-700' : ''}>week {w.pct === null ? '–' : `${w.pct}% used`}</span>
              <span className="text-stone-500 ml-auto text-xs">{a.ok ? '' : 'meter error · '}checked {agoText(data.claude?.checked_at, now)} ago</span>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-stone-500">The Siku lane stops a pool at 35% of its week left (5% in the last 24 h before reset). Jobs refuse a Claude account at 90% of its week. Plan fees and cost per book: ops repo costs/subscription/plan-fees.json.</p>
    </Section>
  );
}

function Line({ l, now }: { l: CronLine; now: Date }) {
  const off = l.disabled || l.one_shot;
  const logAge = ageMin(l.log_at, now);
  return (
    <li className={`px-3 py-2 grid gap-0.5 min-w-0 ${off ? 'opacity-60' : ''}`}>
      <div className="flex flex-wrap items-baseline gap-x-2 text-sm min-w-0">
        <span className="font-medium break-all">{l.script?.split('/').pop() ?? '(inline command)'}{l.mode ? ` ${l.mode}` : ''}</span>
        {l.disabled ? <span className="text-xs text-amber-700">off{l.disabled_tag ? ` (${l.disabled_tag})` : ''}</span> : null}
        {l.one_shot ? <span className="text-xs text-stone-500">one-shot edit</span> : null}
        <span className="text-xs text-stone-500 ml-auto whitespace-nowrap font-mono">{l.schedule}</span>
      </div>
      {l.flags.length || l.env.length ? <p className="text-xs text-stone-600 font-mono break-all">{[...l.env, ...l.flags].join(' ')}</p> : null}
      {l.comment ? <p className="text-xs text-stone-500 break-words">{l.comment}</p> : null}
      {l.log && !off ? (
        <p className="text-xs text-stone-500 break-words">
          <span className={logAge !== null && logAge > 36 * 60 ? 'text-amber-700' : ''}>log {agoText(l.log_at, now)} ago</span>
          {l.log_last ? ` · ${l.log_last}` : ''}
        </p>
      ) : null}
    </li>
  );
}

function Box({ box, doc, now }: { box: string; doc: BoxDoc | null; now: Date }) {
  return (
    <Section title={box} meta={<Age iso={doc?.generated_at} staleMin={BOX_STALE_MIN} now={now} />}>
      {!doc ? <p className="text-sm text-red-700">No report from this box. Its hourly pipeline-now-push cron line is missing or failing.</p> : (
        <div className="grid gap-3">
          {doc.lanes?.map(s => (
            <p key={s.lane} className="text-sm">
              <span className="font-medium">{s.lane}</span>: {s.stopped ? <b className="text-amber-700">STOP file present</b> : 'running'}
              {s.written_total != null ? ` · ${fmt(s.written_total)} pages written` : ''}
              {s.spot_at != null && s.written_total != null ? ` · last spot check at ${fmt(s.spot_at)}` : ''}
              {s.last_wave ? ` · last wave ${s.last_wave.id} on ${s.last_wave.pool}: ${fmt(s.last_wave.written ?? 0)} pages${s.last_wave.stopped ? `, stopped: ${s.last_wave.stopped}` : ''}` : ''}
            </p>
          ))}
          {doc.gpu_queue ? (
            <p className="text-sm"><span className="font-medium">GPU queue</span>: {doc.gpu_queue.pending} pending{doc.gpu_queue.held ? `, ${doc.gpu_queue.held} held` : ''}{doc.gpu_queue.lock ? ` · lock: ${doc.gpu_queue.lock}` : ' · idle'}</p>
          ) : null}
          {linesByStage(doc.lines ?? []).map(g => (
            <div key={g.stage} className="grid gap-1">
              <h3 className="text-xs text-stone-500">{STAGE_LABEL[g.stage]}</h3>
              <ul className="grid rounded border border-stone-200 bg-white divide-y divide-stone-100">
                {g.lines.map((l, i) => <Line key={`${l.script}-${l.schedule}-${i}`} l={l} now={now} />)}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

export default async function PipelineNowPage() {
  const now = new Date();
  let data: PipelineNow | null = null;
  let error: string | null = null;
  try { data = await getPipelineNow(); } catch (e) { error = e instanceof Error ? e.message : String(e); }
  return (
    <main className="mx-auto max-w-5xl px-4 py-6 grid gap-6">
      <header className="grid gap-1">
        <h1 className="text-xl font-semibold">Pipeline now</h1>
        <p className="text-sm text-stone-600">
          Generated from live state, not written by hand. How a book moves and the standing rules: <code>.claude/docs/book-process.md</code>.
          Work left by step: <a className="text-accent-rust hover:underline" href="/admin/pipeline">/admin/pipeline</a>. Claude jobs: <a className="text-accent-rust hover:underline" href="/admin/work">/admin/work</a>.
        </p>
      </header>
      {error || !data ? <p className="text-sm text-red-700">Could not read ops_reports: {error}</p> : (
        <>
          <LaneTable title="Translated pages per day" rows={data.corpus?.translated_per_day ?? null} now={now} generated={data.corpus?.generated_at ?? null} />
          <LaneTable title="OCR pages per day" rows={data.corpus?.ocr_per_day ?? null} now={now} generated={data.corpus?.generated_at ?? null} />
          <Quota data={data} now={now} />
          <Section title="Brakes and gates">
            <ul className="grid rounded border border-stone-200 bg-white divide-y divide-stone-100 text-sm">
              <li className="px-3 py-2">Spend dial (paid Gemini API lanes): {data.corpus?.dial ? `${data.corpus.dial.paused ? 'PAUSED' : 'on'}, $${data.corpus.dial.daily_budget_usd ?? '–'}/day` : '–'}. The subscription lanes (agy, Claude CLI) do not read it; they stop on quota.</li>
              {(data.corpus?.quality_gates ?? []).map(g => (
                <li key={g.id} className="px-3 py-2">Quality gate {g.step} {g.window ?? ''}: <b className={g.verdict === 'GO' ? '' : 'text-amber-700'}>{g.verdict ?? '–'}</b> · {g.books ?? '–'} books · {g.at?.slice(0, 10) ?? '–'}</li>
              ))}
              {data.corpus?.errors?.length ? <li className="px-3 py-2 text-red-700">Corpus push errors: {data.corpus.errors.join('; ')}</li> : null}
            </ul>
          </Section>
          {data.boxes.map(b => <Box key={b.box} box={b.box} doc={b.doc} now={now} />)}
        </>
      )}
    </main>
  );
}
