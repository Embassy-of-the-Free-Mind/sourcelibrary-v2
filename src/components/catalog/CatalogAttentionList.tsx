import type { WorklistRow } from '@/lib/bph-catalogue-activity';

/**
 * "Needs your attention" — records where only a librarian can decide.
 *
 * Lifted out of the workspace page so it can live under Review, where the
 * other queues are. It is a queue of decisions, not a report about one
 * person's work, which is why it moved.
 */

const n = (x: number | null | undefined) => (x ?? 0).toLocaleString('en-GB');

export default function CatalogAttentionList({
  worklist,
  basePath,
}: {
  worklist: WorklistRow[];
  /** Where catalogue routes live on this host (see catalogBasePath). */
  basePath: string;
}) {
  if (worklist.length === 0) {
    return (
      <div className="p-6 border border-border-light bg-white text-center text-muted text-sm">
        Nothing outstanding. Every record has a title and a number.
      </div>
    );
  }

  const total = worklist.reduce((s, w) => s + Number(w.n), 0);

  return (
    <div>
      <p className="text-sm text-muted mb-3">
        {n(total)} records where only a librarian can decide what is right.
      </p>

      {worklist.map((w) => (
        <div key={w.category} className="border border-stone-200 bg-white p-5 mb-3">
          <div className="flex items-baseline justify-between gap-4">
            <h3 className="text-primary font-medium">{w.label}</h3>
            <span className="text-xl text-primary font-display shrink-0">{n(Number(w.n))}</span>
          </div>
          <p className="text-sm text-muted mt-1">{w.detail}</p>
          {w.samples?.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-sm">
              {w.samples.slice(0, 12).map((s, i) => (
                <a
                  key={`${w.category}-${s.id}-${i}`}
                  href={`${basePath}/${encodeURIComponent(s.ubn || s.id)}`}
                  className="text-accent-rust hover:underline"
                  title={s.hint || undefined}
                >
                  {s.ubn || s.shelf_mark || s.id.slice(0, 8)}
                </a>
              ))}
              {Number(w.n) > 12 && <span className="text-muted">+{n(Number(w.n) - 12)} more</span>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
