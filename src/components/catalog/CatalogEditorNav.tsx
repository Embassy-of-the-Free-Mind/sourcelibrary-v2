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
 *
 * Links are built from `basePath` rather than hardcoded to `/catalog`, because
 * these routes answer on two URLs (the tenant subdomain and the `/embed/…`
 * path) and a hardcoded prefix 404s on every host that is not the subdomain.
 * See `catalogBasePath()` in `src/lib/catalog-nav.ts`.
 */

const LINK_CLASS =
  'inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border border-border-light ' +
  'text-secondary hover:bg-warm hover:text-primary transition-colors';

const CURRENT_CLASS =
  'inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border border-border-light ' +
  'bg-warm text-primary cursor-default';

export type CatalogNavCurrent = 'workspace' | 'review' | 'team' | 'new' | 'feedback' | 'help';

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
  current?: CatalogNavCurrent;
  /**
   * URL prefix for catalogue routes on the host currently being served.
   * Defaults to the subdomain form for callers that have not been updated.
   */
  basePath?: string;
  className?: string;
}

export default function CatalogEditorNav({
  role,
  ubn,
  editLabel,
  current,
  basePath = '/catalog',
  className,
}: Props) {
  if (!canEditCatalog(role)) return null;
  const canReview = canReviewCatalog(role);
  const base = basePath.replace(/\/$/, '');

  return (
    <nav
      aria-label="Catalogue tools"
      className={className ?? 'flex justify-end flex-wrap gap-2 mb-2'}
    >
      {ubn && (
        <a href={`${base}/${encodeURIComponent(ubn)}/history`} className={LINK_CLASS}>
          History
        </a>
      )}
      {canReview && (
        <>
          {current === 'workspace' ? (
            <span className={CURRENT_CLASS} aria-current="page">My work</span>
          ) : (
            <a href={`${base}/workspace`} className={LINK_CLASS}>My work</a>
          )}
          {current === 'new' ? (
            <span className={CURRENT_CLASS} aria-current="page">+ New record</span>
          ) : (
            <a href={`${base}/new`} className={LINK_CLASS}>+ New record</a>
          )}
          {current === 'review' ? (
            <span className={CURRENT_CLASS} aria-current="page">Review queue</span>
          ) : (
            <a href={`${base}/review`} className={LINK_CLASS}>Review queue</a>
          )}
          {current === 'team' ? (
            <span className={CURRENT_CLASS} aria-current="page">Team</span>
          ) : (
            <a href={`${base}/team`} className={LINK_CLASS}>Team</a>
          )}
        </>
      )}
      {current === 'feedback' ? (
        <span className={CURRENT_CLASS} aria-current="page">Feedback</span>
      ) : (
        <a href={`${base}/feedback`} className={LINK_CLASS}>Feedback</a>
      )}
      {current === 'help' ? (
        <span className={CURRENT_CLASS} aria-current="page">Help</span>
      ) : (
        <a href={`${base}/help`} className={LINK_CLASS}>Help</a>
      )}
      {ubn && (
        <a href={`${base}/${encodeURIComponent(ubn)}/edit`} className={LINK_CLASS}>
          <Pencil className="w-3.5 h-3.5" />
          {editLabel ?? 'Edit catalogue entry'}
        </a>
      )}
    </nav>
  );
}
