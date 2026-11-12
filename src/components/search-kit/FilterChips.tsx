'use client';

import { X } from 'lucide-react';

export interface Chip {
  key: string;
  /** "Facet: value" is shown as a quiet facet name and the value; a plain label is shown as is. */
  label: string;
  /** An added term rather than a filter: dashed, prefixed "also". */
  other?: boolean;
}

/**
 * What is applied, as removable tags, with Clear all from two up. A tag is a
 * filled warm block with no border, so it never reads as another dropdown next
 * to the white bordered SortSelect menus. Its own row on a phone, inline from sm up.
 */
export default function FilterChips({ chips, onRemove, onClearAll }: { chips: Chip[]; onRemove: (key: string) => void; onClearAll: () => void }) {
  if (!chips.length) return null;
  return (
    <div className="order-3 basis-full sm:order-none sm:basis-auto flex flex-wrap items-center gap-1.5 sm:gap-2">
      {chips.map((c) => {
        const cut = c.label.indexOf(': ');
        const facet = cut > 0 ? c.label.slice(0, cut) : '';
        const value = cut > 0 ? c.label.slice(cut + 2) : c.label;
        return (
          <span key={c.key} className={`inline-flex items-stretch h-7 sm:h-8 text-[12.5px] sm:text-[13px] whitespace-nowrap text-primary ${c.other ? 'border border-dashed border-border-medium' : 'bg-warm'}`}>
            <span className="flex items-center gap-1.5 pl-2.5 sm:pl-3 pr-1.5">
              {c.other && <span className="text-muted">also</span>}
              {facet && <span className="text-muted">{facet}</span>}
              <span className="font-medium">{value}</span>
            </span>
            <button type="button" onClick={() => onRemove(c.key)} aria-label={`Remove ${c.label}`} className="w-7 sm:w-8 grid place-items-center text-muted hover:bg-primary hover:text-cream transition-colors">
              <X className="w-3.5 h-3.5" />
            </button>
          </span>
        );
      })}
      {chips.length > 1 && <button type="button" onClick={onClearAll} className="ml-1 text-[12.5px] sm:text-[13px] text-muted underline underline-offset-[3px] hover:text-primary">Clear all</button>}
    </div>
  );
}
