import { Pencil, History } from 'lucide-react';
import type { Role } from '@/lib/auth';
import { canEditCatalog } from '@/lib/catalog-role';

/**
 * Actions that belong to one catalogue record: its history, and editing it.
 *
 * Everything that is not record-specific (Browse, Inbox, My work, Team, Help,
 * New record) moved to the top bar, which the catalogue layout renders on
 * every page. This is what is left, and it stays next to the record because it
 * only means anything in the context of that record.
 *
 * Renders nothing below contributor.
 */

const ACTION =
  'inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border border-border-light ' +
  'text-secondary hover:bg-warm hover:text-primary transition-colors';

interface Props {
  role: Role;
  ubn: string;
  /** Where catalogue sub-pages live on this host (see catalogBasePath). */
  basePath: string;
  /** "Edit catalogue entry" for editors, "Propose a change" for contributors. */
  editLabel?: string;
  className?: string;
}

export default function CatalogRecordActions({
  role,
  ubn,
  basePath,
  editLabel,
  className,
}: Props) {
  if (!canEditCatalog(role)) return null;
  const base = basePath.replace(/\/$/, '');
  const id = encodeURIComponent(ubn);

  return (
    <div className={className ?? 'flex justify-end flex-wrap gap-2 mb-2'}>
      <a href={`${base}/${id}/history`} className={ACTION}>
        <History className="w-3.5 h-3.5" />
        History
      </a>
      <a href={`${base}/${id}/edit`} className={ACTION}>
        <Pencil className="w-3.5 h-3.5" />
        {editLabel ?? 'Edit catalogue entry'}
      </a>
    </div>
  );
}
