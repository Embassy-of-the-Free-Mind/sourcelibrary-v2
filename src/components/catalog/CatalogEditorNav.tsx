import { Pencil } from 'lucide-react';
import type { Role } from '@/lib/auth';
import { canEditCatalog, canReviewCatalog } from '@/lib/catalog-role';

/**
 * The catalogue editor's toolbar.
 *
 * These links used to exist only on an individual record page, which meant a
 * librarian had to already be looking at some book before she could reach her
 * own work, the review queue, or the team page. The catalogue index — the page
 * she actually lands on — offered no way in at all. Owning the whole toolbar
 * here means both surfaces show the same thing and neither can drift.
 *
 * Invisible to visitors: everything is gated on the caller's resolved role,
 * and the component renders nothing at all for readers.
 */

const LINK_CLASS =
  'inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border border-border-light ' +
  'text-secondary hover:bg-warm hover:text-primary transition-colors';

interface Props {
  role: Role;
  /**
   * Present when rendered on a single record: adds that record's History and
   * Edit links. Omitted on the catalogue index, where no record is in scope.
   */
  ubn?: string;
  /** "Edit catalogue entry" for editors, "Propose a change" for contributors. */
  editLabel?: string;
  /** Marks the current destination so it isn't offered as a link to itself. */
  current?: 'workspace' | 'review' | 'team' | 'new';
  className?: string;
}

export default function CatalogEditorNav({ role, ubn, editLabel, current, className }: Props) {
  if (!canEditCatalog(role)) return null;
  const canReview = canReviewCatalog(role);

  return (
    <div className={className ?? 'flex justify-end flex-wrap gap-2 mb-2'}>
      {ubn && (
        <a href={`/catalog/${encodeURIComponent(ubn)}/history`} className={LINK_CLASS}>
          History
        </a>
      )}
      {canReview && (
        <>
          {current !== 'workspace' && (
            <a href="/catalog/workspace" className={LINK_CLASS}>My work</a>
          )}
          {current !== 'new' && (
            <a href="/catalog/new" className={LINK_CLASS}>+ New record</a>
          )}
          {current !== 'review' && (
            <a href="/catalog/review" className={LINK_CLASS}>Review queue</a>
          )}
          {current !== 'team' && (
            <a href="/catalog/team" className={LINK_CLASS}>Team</a>
          )}
        </>
      )}
      <a href="/catalog/help" className={LINK_CLASS}>Help</a>
      {ubn && (
        <a href={`/catalog/${encodeURIComponent(ubn)}/edit`} className={LINK_CLASS}>
          <Pencil className="w-3.5 h-3.5" />
          {editLabel ?? 'Edit catalogue entry'}
        </a>
      )}
    </div>
  );
}
