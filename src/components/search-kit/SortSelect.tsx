'use client';

import { ChevronDown } from 'lucide-react';

/**
 * The sort menu, drawn to match the Advanced search button beside it. The real
 * select sits invisibly on top, so the phone's own picker still opens, and it
 * keeps 16px text so iOS does not zoom while the visible label stays small.
 */
export default function SortSelect({ value, options, onChange }: {
  value: string;
  options: readonly (readonly [string, string])[];
  onChange: (value: string) => void;
}) {
  const label = options.find(([v]) => v === value)?.[1] ?? options[0]?.[1];
  return (
    <div className="relative inline-flex items-center gap-2 h-9 sm:h-[38px] px-3 sm:px-3.5 border border-border-medium bg-white text-primary text-[13px] sm:text-sm focus-within:border-primary focus-within:ring-1 focus-within:ring-primary">
      <span aria-hidden>{label}</span>
      <ChevronDown className="w-3.5 h-3.5" aria-hidden />
      <select aria-label="Sort" value={value} onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer text-base">
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  );
}
