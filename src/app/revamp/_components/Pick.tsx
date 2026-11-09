'use client';

import { ChevronDown } from 'lucide-react';

/**
 * A dropdown drawn like /library's sort and Advanced search buttons: a label and a chevron
 * in a bordered box, with the real select invisible on top so phones get their own picker.
 * The select keeps 16px text so iOS does not zoom. (Same as search-kit/SortSelect, with a label.)
 */
export default function Pick({ label, value, options, onChange }: {
  label: string;
  value: string;
  options: readonly (readonly [string, string])[];
  onChange: (value: string) => void;
}) {
  const shown = options.find(([v]) => v === value)?.[1] ?? options[0]?.[1];
  return (
    <div className="relative inline-flex items-center gap-2 h-9 sm:h-[38px] px-3 sm:px-3.5 border border-border-medium bg-white text-primary text-[13px] sm:text-sm focus-within:border-primary focus-within:ring-1 focus-within:ring-primary">
      <span aria-hidden className="truncate max-w-[16rem]">{shown}</span>
      <ChevronDown className="w-3.5 h-3.5 shrink-0" aria-hidden />
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer text-base">
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  );
}
