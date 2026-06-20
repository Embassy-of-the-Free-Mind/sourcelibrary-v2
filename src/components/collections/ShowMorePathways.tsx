'use client';

import { useState, type ReactNode, Children } from 'react';
import { ChevronDown } from 'lucide-react';

interface Props {
  children: ReactNode;
  initialCount: number;
  totalCount: number;
}

export default function ShowMorePathways({ children, initialCount, totalCount }: Props) {
  const [expanded, setExpanded] = useState(false);
  const items = Children.toArray(children);
  const visible = expanded ? items : items.slice(0, initialCount);
  const remaining = totalCount - initialCount;

  return (
    <>
      <div className="grid gap-3 sm:gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        {visible}
      </div>
      {!expanded && remaining > 0 && (
        <div className="mt-6 text-center">
          <button
            onClick={() => setExpanded(true)}
            className="inline-flex items-center gap-1.5 px-5 py-2.5 text-sm font-medium text-stone-600 hover:text-stone-900 bg-white border border-stone-200 rounded-full hover:border-stone-300 hover:shadow-sm transition-all"
          >
            Show {remaining} more
            <ChevronDown className="w-4 h-4" />
          </button>
        </div>
      )}
    </>
  );
}
