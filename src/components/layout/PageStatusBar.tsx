'use client';

import { usePathname } from 'next/navigation';
import { pageStatusFor, type PageState } from '@/lib/page-status';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Formatted by hand, not toLocaleDateString, so server and client render the
// same string.
function formatSince(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

const LABEL: Record<PageState, string> = {
  internal: 'Internal',
  draft: 'Draft',
  archived: 'Archived',
};

/**
 * Bar shown on a page listed in src/lib/page-status.ts. The proxy only lets
 * admins reach such a page, so whoever sees this bar is an admin; it tells
 * them the page is not public, since when, and why.
 */
export default function PageStatusBar() {
  const pathname = usePathname();
  const entry = pathname ? pageStatusFor(pathname) : null;
  if (!entry) return null;

  const who =
    entry.state === 'archived'
      ? `Visitors are sent to ${entry.sendTo || '/'}.`
      : 'Only admins can see this page.';

  return (
    <div
      role="status"
      className="fixed top-3 left-1/2 -translate-x-1/2 z-[100] max-w-[calc(100vw-32px)] px-4 py-2 rounded-full text-xs shadow-lg bg-stone-800 text-stone-100"
    >
      <span className="font-semibold">{LABEL[entry.state]}</span>
      <span className="opacity-80"> since {formatSince(entry.since)}. {who}</span>
      {entry.note && <span className="opacity-60"> {entry.note}</span>}
    </div>
  );
}
