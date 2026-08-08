'use client';

import { usePathname } from 'next/navigation';
import type { InboxCounts } from '@/lib/catalog-inbox';

/**
 * The catalogue's top bar.
 *
 * Replaces the row of outlined buttons that used to float above each page.
 * That row had three problems: it existed on only two of the seven catalogue
 * pages, it read as page content rather than as chrome, and it offered
 * "Review queue" and "Feedback" as two separate destinations, which looks
 * redundant even though they are not.
 *
 * Now: one dark bar, always present, with the queues folded into a single
 * Review carrying a count. See `getInboxCounts()` for why they merge in the UI
 * but stay separate in storage.
 *
 * Client component purely so the active item can come from `usePathname()` —
 * the bar is rendered by the catalogue layout, which cannot know which child
 * page is showing. Role checks stay on the server and arrive as plain
 * booleans; importing `catalog-role` here would pull the Mongo client into the
 * browser bundle.
 */

const ITEM =
  'px-3 py-2 text-sm rounded-md text-cream/65 hover:text-cream hover:bg-cream/10 ' +
  'transition-colors whitespace-nowrap';

const ITEM_CURRENT =
  'px-3 py-2 text-sm rounded-md bg-cream/15 text-cream whitespace-nowrap';

interface Props {
  /** Editor+ — gates the queues, the team page and record creation. */
  canReview: boolean;
  /** Where catalogue sub-pages live on this host (see catalogBasePath). */
  basePath: string;
  /** Where the catalogue index lives on this host (see catalogIndexPath). */
  indexPath: string;
  counts?: InboxCounts;
  /**
   * Tailwind max-width of the page's own content container, so the bar's
   * contents line up with the page rather than floating on their own grid.
   * The catalogue index is the widest page and the one this most matters on.
   */
  containerClass?: string;
}

/**
 * Which nav item the current URL corresponds to.
 *
 * Matches on the last path segment so it works for both URL shapes the
 * catalogue answers on (`/catalog/team` and `/embed/bph/catalog/team`).
 * A record page (`/catalog/27637`) matches nothing, which is correct: it is
 * not one of the destinations in the bar.
 */
function activeItem(pathname: string | null): string | null {
  if (!pathname) return null;
  const segments = pathname.split('/').filter(Boolean);
  const last = segments[segments.length - 1] ?? '';
  const known = ['review', 'changes', 'team', 'help', 'new', 'workspace'];
  if (known.includes(last)) return last;
  // The index is `/catalog`, `/catalogue`, or the tenant root with ?view=catalog.
  if (last === 'catalog' || last === 'catalogue') return 'browse';
  return null;
}

function Badge({ n }: { n: number }) {
  if (!n) return null;
  return (
    <span className="ml-1.5 inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded-full bg-accent-rust text-cream text-[0.6875rem] leading-none">
      {n > 99 ? '99+' : n}
    </span>
  );
}

export default function CatalogTopBar({
  canReview,
  basePath,
  indexPath,
  counts,
  containerClass = 'max-w-[1500px]',
}: Props) {
  const current = activeItem(usePathname());
  const base = basePath.replace(/\/$/, '');

  const item = (key: string) => (current === key ? ITEM_CURRENT : ITEM);
  const mark = (key: string) => (current === key ? ('page' as const) : undefined);

  return (
    <header className="sticky top-0 z-40 bg-primary text-cream">
      <div className={`${containerClass} mx-auto px-6`}>
        <div className="flex items-center gap-5 h-14 overflow-x-auto">
          <a
            href={indexPath}
            className="flex items-baseline gap-2.5 whitespace-nowrap hover:opacity-80 transition-opacity"
          >
            <span className="font-display text-sm tracking-[0.2em] uppercase text-cream">
              BPH Catalogue
            </span>
            {/* Says plainly that this is the staff view of a public catalogue,
                which the bar alone does not communicate. */}
            <span className="font-display text-[0.6875rem] tracking-[0.18em] uppercase text-cream/50">
              Editor
            </span>
          </a>

          <nav aria-label="Catalogue" className="flex items-center gap-0.5">
            <a href={indexPath} className={item('browse')} aria-current={mark('browse')}>
              Browse
            </a>

            {canReview && (
              <>
                <a href={`${base}/review`} className={item('review')} aria-current={mark('review')}>
                  Review
                  <Badge n={counts?.total ?? 0} />
                </a>
                <a
                  href={`${base}/workspace`}
                  className={item('workspace')}
                  aria-current={mark('workspace')}
                >
                  My work
                </a>
                <a href={`${base}/changes`} className={item('changes')} aria-current={mark('changes')}>
                  Changes
                </a>
                <a href={`${base}/team`} className={item('team')} aria-current={mark('team')}>
                  Team
                </a>
              </>
            )}

            <a href={`${base}/help`} className={item('help')} aria-current={mark('help')}>
              Help
            </a>
          </nav>

          {canReview && (
            <a
              href={`${base}/new`}
              className={
                'ml-auto px-3.5 py-2 text-sm rounded-md border border-cream/30 text-cream ' +
                'hover:bg-cream hover:text-primary transition-colors whitespace-nowrap'
              }
            >
              + New record
            </a>
          )}
        </div>
      </div>
    </header>
  );
}
