import { getDb } from '@/lib/mongodb';

/**
 * The priority queue on /admin/pipeline (v3#461): Derek's order as one ranked list, read from the report
 * scripts/workers/priority-queue.mjs writes to ops_reports (`priority-queue:latest`). Per tier: what is owed, what the
 * agy lanes did in the window, days to clear at that pace; then the next 10 with the reason for each rank, the share
 * of agy pages per priority, and the holds that keep books out, with who releases each. Server component; one findOne.
 */
interface Tier { tier: number; key: string; label: string; books: number | null; owed: number | null; unread: number | null; owed_note?: string; done: { translation: number; ocr: number }; days_to_clear: number | null; days_to_read: number | null }
interface HeadRow { rank: number; key: string; id: string; title: string | null; language: string | null; reason: string }
interface HeldRow { reason: string; books: number; owed: number; unread: number; owner: string; derek: boolean }
interface Bucket { ocr: number; translation: number; total: number; share: number }
export interface PriorityQueueReport {
  generated_at: string; window: { from: string; to: string; hours: number }; order: string; queued: number; tiers: Tier[]; head: HeadRow[];
  held: { books: number; derek_books: number; by_reason: HeldRow[] }; share: { total: number; buckets: Record<string, Bucket> };
}

export async function getPriorityQueueReport(): Promise<PriorityQueueReport | null> {
  const db = await getDb();
  return (await db.collection('ops_reports').findOne({ _id: 'priority-queue:latest' as never })) as unknown as PriorityQueueReport | null;
}

const n = (v: number | null | undefined) => (v == null ? '–' : Math.round(v).toLocaleString('en-US'));
const days = (v: number | null) => (v == null ? 'no pace' : v < 1 ? 'under a day' : v < 60 ? `${Math.round(v)} days` : v < 730 ? `${Math.round(v / 30)} months` : `${Math.round(v / 365)} years`);
const pct = (v: number) => `${(100 * v).toFixed(v < 0.1 ? 1 : 0)}%`;
const muted = { color: 'var(--text-muted)' };
const faint = { color: 'var(--text-faint)' };
const BUCKETS: [string, string][] = [['finish', '1 finish'], ['first', '2 first'], ['reread', '3 re-read'], ['held', 'held books'], ['other', 'other']];

export function PriorityQueue({ report, error }: { report: PriorityQueueReport | null; error?: string | null }) {
  return (
    <section id="priority-queue" className="rounded-xl border p-4" style={{ borderColor: 'var(--border-light)', background: 'white' }}>
      <h2 className="text-xs font-medium uppercase tracking-wider" style={muted}>Priority queue</h2>
      {!report ? (
        <p className="text-xs mt-2" style={faint}>{error ? `Could not read the queue: ${error}` : 'No queue report yet (scripts/workers/priority-queue.mjs).'}</p>
      ) : (
        <>
          <p className="text-xs mt-1 mb-3 max-w-4xl leading-snug" style={faint}>
            Order: {report.order}. {n(report.queued)} visible books queued; computed {report.generated_at.slice(0, 16).replace('T', ' ')} UTC;
            done = agy pages {report.window.from.slice(5, 16).replace('T', ' ')} to {report.window.to.slice(5, 16).replace('T', ' ')} UTC.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead style={muted}><tr>
                <th className="text-left py-1 px-2 font-medium">Priority</th><th className="text-right py-1 px-2 font-medium">Books</th>
                <th className="text-right py-1 px-2 font-medium">Pages owed English</th><th className="text-right py-1 px-2 font-medium">of which unread</th>
                <th className="text-right py-1 px-2 font-medium">Done: translated</th><th className="text-right py-1 px-2 font-medium">Done: read</th>
                <th className="text-right py-1 px-2 font-medium">Days to clear</th>
              </tr></thead>
              <tbody>
                {report.tiers.map((t) => (
                  <tr key={t.key} className="border-t" style={{ borderColor: 'var(--border-light)' }} title={t.owed_note}>
                    <td className="py-1.5 px-2">{t.tier}. {t.label}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums">{n(t.books)}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums">{n(t.owed)}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums">{n(t.unread)}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums">{n(t.done.translation)}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums">{n(t.done.ocr)}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums">{days(t.days_to_clear)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs mt-3" style={muted}>
            Share of {n(report.share.total)} agy pages:{' '}
            {BUCKETS.filter(([k]) => report.share.buckets[k]).map(([k, label]) => `${label} ${pct(report.share.buckets[k].share)}`).join(' · ')}
          </p>
          <h3 className="text-xs font-medium mt-4 mb-1" style={muted}>Next 10</h3>
          <ol className="text-xs space-y-0.5">
            {report.head.slice(0, 10).map((r) => (
              <li key={r.id}><span className="tabular-nums" style={faint}>{r.rank}.</span>{' '}
                <a href={`/book/${r.id}`} className="underline">{(r.title ?? r.id).slice(0, 80)}</a>
                <span style={faint}> ({r.language ?? '?'}): {r.reason}</span></li>
            ))}
          </ol>
          <details className="mt-4 text-xs">
            <summary style={muted}>Held out of the queue: {n(report.held.books)} visible books ({n(report.held.derek_books)} wait on a decision of Derek&apos;s)</summary>
            <table className="w-full mt-2">
              <thead style={muted}><tr><th className="text-left py-1 px-2 font-medium">Hold</th><th className="text-right py-1 px-2 font-medium">Books</th><th className="text-right py-1 px-2 font-medium">Pages owed</th><th className="text-left py-1 px-2 font-medium">Released by</th></tr></thead>
              <tbody>
                {report.held.by_reason.map((h) => (
                  <tr key={h.reason} className="border-t" style={{ borderColor: 'var(--border-light)' }}>
                    <td className="py-1 px-2">{h.reason}</td><td className="py-1 px-2 text-right tabular-nums">{n(h.books)}</td>
                    <td className="py-1 px-2 text-right tabular-nums">{n(h.owed)}</td><td className="py-1 px-2" style={h.derek ? undefined : faint}>{h.owner}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-1" style={faint}>Books held as &quot;published as scans&quot; are not here: the first-read lanes read them while the hold stays, so they are queued.</p>
          </details>
        </>
      )}
    </section>
  );
}
