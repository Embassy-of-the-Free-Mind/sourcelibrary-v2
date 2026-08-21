'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

// Every explore tool belongs here, including ones that live outside
// /explore/* (Ngrams is a top-level route). A tool missing from this list is
// reachable only from the /explore hub — landing on a sibling tool strands the
// reader, since these pages have no other cross-navigation.
const TABS = [
  { href: '/timeline', label: 'Timeline' },
  { href: '/explore/timeline', label: 'People' },
  { href: '/explore/map', label: 'Map' },
  { href: '/explore/constellation', label: 'Constellation' },
  { href: '/ngrams', label: 'Ngrams' },
] as const;

export default function ExploreTabBar() {
  const pathname = usePathname();

  return (
    <div className="flex gap-1 bg-stone-100/80 rounded-lg p-1 w-fit">
      {TABS.map(tab => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              active
                ? 'bg-white text-stone-900 shadow-sm'
                : 'text-stone-500 hover:text-stone-700'
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
