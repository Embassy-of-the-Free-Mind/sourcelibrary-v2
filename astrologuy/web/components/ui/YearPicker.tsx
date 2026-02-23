"use client";

import { useAppState } from "@/lib/store";

export function YearPicker() {
  const { year, setYear } = useAppState();

  return (
    <div className="flex items-center gap-2">
      <label className="text-muted text-xs uppercase tracking-wider">Year</label>
      <div className="flex items-center gap-1">
        <button
          onClick={() => setYear(year - 1)}
          className="w-8 h-8 rounded-md bg-bg-card border border-border text-cream hover:border-accent-gold hover:bg-bg-hover transition-colors flex items-center justify-center"
        >
          &larr;
        </button>
        <input
          type="number"
          value={year}
          onChange={(e) => setYear(parseInt(e.target.value) || new Date().getFullYear())}
          min={1900}
          max={2100}
          className="w-20 text-center"
        />
        <button
          onClick={() => setYear(year + 1)}
          className="w-8 h-8 rounded-md bg-bg-card border border-border text-cream hover:border-accent-gold hover:bg-bg-hover transition-colors flex items-center justify-center"
        >
          &rarr;
        </button>
      </div>
    </div>
  );
}
