'use client';

import { X } from 'lucide-react';

export interface Chip {
  key: string;
  label: string;
  /** An added term rather than a filter: dashed, warm, prefixed "also". */
  other?: boolean;
}

/**
 * What is applied, as removable chips, with Clear all from two up. Its own row
 * on a phone (under Advanced search and the sort), inline from sm up.
 */
export default function FilterChips({ chips, onRemove, onClearAll }: { chips: Chip[]; onRemove: (key: string) => void; onClearAll: () => void }) {
  if (!chips.length) return null;
  return (
    <div className="order-3 basis-full sm:order-none sm:basis-auto flex flex-wrap items-center gap-2 sm:gap-2.5">
      {chips.map((c) => (
        <span key={c.key} className={`inline-flex items-center gap-1.5 h-7 sm:h-[30px] pl-2.5 sm:pl-3 pr-1 sm:pr-1.5 border text-[12.5px] sm:text-[13.5px] whitespace-nowrap ${c.other ? 'bg-warm border-dashed border-border-medium' : 'bg-white border-border-medium'}`}>
          {c.other && <span className="text-muted">also</span>}
          {c.label}
          <button type="button" onClick={() => onRemove(c.key)} aria-label={`Remove ${c.label}`} className="w-5 h-5 rounded-full grid place-items-center text-muted hover:bg-warm hover:text-primary">
            <X className="w-3.5 h-3.5" />
          </button>
        </span>
      ))}
      {chips.length > 1 && <button type="button" onClick={onClearAll} className="text-[12.5px] sm:text-[13.5px] text-muted underline underline-offset-[3px]">Clear all</button>}
    </div>
  );
}
