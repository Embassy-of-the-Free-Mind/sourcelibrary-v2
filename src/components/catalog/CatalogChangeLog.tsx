import { fieldLabel, editorName, type RevisionRow } from '@/lib/bph-catalogue-activity';

/**
 * The catalogue change log: every edit, by a person or by our software.
 *
 * Shared by the standalone Changes page and the "your own edits" list on My
 * work, so the two can never drift into describing the same revision
 * differently.
 */

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export default function CatalogChangeLog({
  revisions,
  basePath,
  emptyMessage = 'No changes recorded yet.',
}: {
  revisions: RevisionRow[];
  /** Where catalogue routes live on this host (see catalogBasePath). */
  basePath: string;
  emptyMessage?: string;
}) {
  return (
    <div className="border border-stone-200 bg-white divide-y divide-stone-100">
      {revisions.length === 0 && <p className="p-5 text-sm text-muted">{emptyMessage}</p>}
      {revisions.map((r) => {
        const fields = Object.keys(r.field_changes || {});
        return (
          <div key={r.id} className="p-4 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <a
                href={`${basePath}/${encodeURIComponent(r.ubn)}`}
                className="text-accent-rust hover:underline font-medium"
              >
                {r.ubn}
              </a>
              <span className="text-muted shrink-0">{formatDate(r.applied_at)}</span>
            </div>
            <div className="text-primary mt-0.5">
              {r.change_type === 'create'
                ? 'Record created'
                : `Changed ${fields.map(fieldLabel).join(', ')}`}
              <span className="text-muted"> · {editorName(r.editor_email)}</span>
            </div>
            {r.note && <p className="text-muted mt-1">{r.note}</p>}
          </div>
        );
      })}
    </div>
  );
}
