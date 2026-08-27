'use client';

import { useState } from 'react';
import FacetMenu from './FacetMenu';

export interface YearBucket { year: number; count: number }

/** Upper edge of the window `getCatalogFacets` buckets into. Label, not filter. */
const HISTOGRAM_CEILING = 1950;

interface YearRangeMenuProps {
  min: number | null;
  max: number | null;
  onChange: (min: number | null, max: number | null) => void;
  /** Half-century buckets over the whole catalogue, for the histogram. */
  buckets: YearBucket[];
}

const PRESETS: { label: string; min: number | null; max: number | null }[] = [
  { label: 'Before 1500', min: null, max: 1499 },
  { label: '16th century', min: 1500, max: 1599 },
  { label: '17th century', min: 1600, max: 1699 },
  { label: '18th century', min: 1700, max: 1799 },
  { label: '1800 onwards', min: 1800, max: null },
];

function rangeLabel(min: number | null, max: number | null): string {
  if (min != null && max != null) return `${min}–${max}`;
  if (min != null) return `${min} onwards`;
  if (max != null) return `to ${max}`;
  return '';
}

/**
 * The two boxes. Split out and keyed on the committed range by the parent, so a
 * preset or a histogram click re-seeds them by remounting rather than by
 * writing state from an effect (which fires a second render for every commit).
 */
function YearInputs({ min, max, onCommit }: {
  min: number | null;
  max: number | null;
  onCommit: (min: number | null, max: number | null) => void;
}) {
  const [fromText, setFromText] = useState(min != null ? String(min) : '');
  const [toText, setToText] = useState(max != null ? String(max) : '');

  const commit = () => {
    const from = fromText.trim() ? parseInt(fromText, 10) : NaN;
    const to = toText.trim() ? parseInt(toText, 10) : NaN;
    const nextMin = Number.isFinite(from) ? from : null;
    const nextMax = Number.isFinite(to) ? to : null;
    if (nextMin === min && nextMax === max) return; // nothing typed, nothing to refetch
    onCommit(nextMin, nextMax);
  };

  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        inputMode="numeric"
        value={fromText}
        onChange={(e) => setFromText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
        placeholder="From"
        aria-label="Earliest year"
        className="w-full min-w-0 border border-border-light px-2.5 py-2 text-base text-primary placeholder:text-muted/70 focus:outline-none focus:border-border-medium"
      />
      <span className="text-muted text-sm">to</span>
      <input
        type="number"
        inputMode="numeric"
        value={toText}
        onChange={(e) => setToText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
        placeholder="To"
        aria-label="Latest year"
        className="w-full min-w-0 border border-border-light px-2.5 py-2 text-base text-primary placeholder:text-muted/70 focus:outline-none focus:border-border-medium"
      />
    </div>
  );
}

export default function YearRangeMenu({ min, max, onChange, buckets }: YearRangeMenuProps) {
  const peak = Math.max(1, ...buckets.map((b) => b.count));
  const inRange = (bucket: number) =>
    (min == null || bucket + 49 >= min) && (max == null || bucket <= max);

  return (
    <FacetMenu
      label="Years"
      value={rangeLabel(min, max)}
      options={[]}
      onChange={() => {}}
      width={320}
    >
      <div className="p-3">
        {buckets.length > 0 && (
          <>
            {/* Half-centuries, tallest bar to scale. Clicking one is the fastest
                way to say "the 1600s" without typing two numbers. */}
            <div className="flex items-end gap-[2px] h-16 mb-1" aria-hidden="true">
              {buckets.map((b) => (
                <button
                  key={b.year}
                  type="button"
                  title={`${b.year}–${b.year + 49}: ${b.count.toLocaleString('en-US')} books`}
                  onClick={() => onChange(b.year, b.year + 49)}
                  className="flex-1 min-w-[3px] cursor-pointer transition-colors"
                  style={{
                    height: `${Math.max(6, (b.count / peak) * 100)}%`,
                    background: inRange(b.year) ? 'var(--text-muted)' : 'var(--border-light)',
                  }}
                />
              ))}
            </div>
            <div className="flex justify-between text-[10px] text-muted mb-3">
              <span>{buckets[0].year}</span>
              <span>{Math.min(buckets[buckets.length - 1].year + 49, HISTOGRAM_CEILING)}</span>
            </div>
          </>
        )}

        <YearInputs
          key={`${min ?? ''}-${max ?? ''}`}
          min={min}
          max={max}
          onCommit={onChange}
        />

        <div className="flex flex-wrap gap-1.5 mt-3">
          {PRESETS.map((p) => {
            const on = p.min === min && p.max === max;
            return (
              <button
                key={p.label}
                type="button"
                onClick={() => onChange(p.min, p.max)}
                className={`px-2 py-1 text-[12px] border transition-colors cursor-pointer ${
                  on ? 'border-border-medium bg-warm text-primary' : 'border-border-light text-secondary hover:border-border-medium hover:text-primary'
                }`}
              >
                {p.label}
              </button>
            );
          })}
        </div>

        {(min != null || max != null) && (
          <button
            type="button"
            onClick={() => onChange(null, null)}
            className="mt-3 text-[12px] text-muted hover:text-primary transition-colors cursor-pointer"
          >
            Clear years
          </button>
        )}
      </div>
    </FacetMenu>
  );
}
