'use client';

import { usePathname } from 'next/navigation';
import type { InboxCounts } from '@/lib/catalog-inbox';

/**
 * The catalogue's top bar.
 *
 * Replaces the row of outlined buttons that used to float above each page.
 * That row had three problems: it existed on only two of the seven catalogue
 * pages, it read as page content rather than as chrome, and it offered
 * "Review queue" and "Feedback" as two separate queues, which looks redundant
 * even though they are not.
 *
 * Now: one dark bar, always present, with both queues folded into a single
 * Inbox carrying a count. See `getInboxCounts()` for why they merge in the UI
 * but stay separate in storage.
 *
 * Client component purely so the active item can come from `usePathname()` —
 * the bar is rendered by the catalogue layout, which cannot know which child
 * page is showing. Role checks stay on the server and arrive as plain
 * booleans; importing `catalog-role` here would pull the Mongo client into the
 * browser bundle.
 */

const ITEM =
  'px-3 py-1.5 text-sm rounded-md text-cream/70 hover:text-cream hover:bg-cream/10 ' +
  'transition-colors whitespace-nowrap';

const ITEM_CURRENT =
  'px-3 py-1.5 text-sm rounded-md bg-cream/15 text-cream whitespace-nowrap';

interface Props {
  /** Editor+ — gates the queues, the team page and record creation. */
  canReview: boolean;
  /** Where catalogue sub-pages live on this host (see catalogBasePath). */
  basePath: string;
  /** Where the catalogue index lives on this host (see catalogIndexPath). */
  indexPath: string;
  counts?: InboxCounts;
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
  const known = ['inbox', 'team', 'help', 'new', 'workspace'];
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

export default function CatalogTopBar({ canReview, basePath, indexPath, counts }: Props) {
  const current = activeItem(usePathname());
  const base = basePath.replace(/\/$/, '');

  const item = (key: string) => (current === key ? ITEM_CURRENT : ITEM);
  const mark = (key: string) => (current === key ? ('page' as const) : undefined);

  return (
    <header className="sticky top-0 z-40 bg-primary text-cream">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="flex items-center gap-2 h-12 overflow-x-auto">
          <a
            href={indexPath}
            className="font-display text-sm tracking-[0.18em] uppercase text-cream whitespace-nowrap mr-2 hover:opacity-80 transition-opacity"
          >
            BPH Catalogue
          </a>

          <nav aria-label="Catalogue" className="flex items-center gap-1">
            <a href={indexPath} className={item('browse')} aria-current={mark('browse')}>
              Browse
            </a>

            {canReview && (
              <>
                <a href={`${base}/inbox`} className={item('inbox')} aria-current={mark('inbox')}>
                  Inbox
                  <Badge n={counts?.total ?? 0} />
                </a>
                <a
                  href={`${base}/workspace`}
                  className={item('workspace')}
                  aria-current={mark('workspace')}
                >
                  My work
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
                'ml-auto px-3 py-1.5 text-sm rounded-md border border-cream/30 text-cream ' +
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
