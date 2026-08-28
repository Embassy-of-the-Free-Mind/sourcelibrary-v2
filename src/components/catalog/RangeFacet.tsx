'use client';

import { useState } from 'react';

export interface RangePreset {
  label: string;
  min: number | null;
  max: number | null;
}

export interface HistogramBucket { key: number; count: number; min: number; max: number }

interface RangeFacetProps {
  label: string;
  min: number | null;
  max: number | null;
  onChange: (min: number | null, max: number | null) => void;
  presets: RangePreset[];
  /** Optional distribution behind the range, drawn as clickable bars. */
  buckets?: HistogramBucket[];
  fromPlaceholder?: string;
  toPlaceholder?: string;
}

/**
 * The two boxes, split out and keyed on the committed range by the parent, so a
 * preset or a histogram click re-seeds them by remounting rather than by
 * writing state from an effect (which fires a second render for every commit).
 */
function RangeInputs({ min, max, onCommit, fromPlaceholder, toPlaceholder }: {
  min: number | null;
  max: number | null;
  onCommit: (min: number | null, max: number | null) => void;
  fromPlaceholder: string;
  toPlaceholder: string;
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

  const box = 'w-full min-w-0 bg-white border-b border-border-light px-1 py-1.5 text-base sm:text-[13px] text-primary placeholder:text-muted/70 focus:border-text-primary transition-colors focus-ink [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none';

  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        inputMode="numeric"
        value={fromText}
        onChange={(e) => setFromText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
        placeholder={fromPlaceholder}
        aria-label={`${fromPlaceholder} value`}
        className={box}
      />
      <span className="text-muted text-[12px] shrink-0">to</span>
      <input
        type="number"
        inputMode="numeric"
        value={toText}
        onChange={(e) => setToText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
        placeholder={toPlaceholder}
        aria-label={`${toPlaceholder} value`}
        className={box}
      />
    </div>
  );
}

/** A numeric range with presets, and optionally the distribution behind it. */
export default function RangeFacet({
  label, min, max, onChange, presets, buckets,
  fromPlaceholder = 'From', toPlaceholder = 'To',
}: RangeFacetProps) {
  const peak = Math.max(1, ...(buckets || []).map((b) => b.count));
  const inRange = (b: HistogramBucket) =>
    (min == null || b.max >= min) && (max == null || b.min <= max);
  const touched = min != null || max != null;

  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <h3 className="text-[10px] uppercase tracking-[0.13em] text-muted">{label}</h3>
        {touched && (
          <button
            type="button"
            onClick={() => onChange(null, null)}
            className="text-[11px] text-muted hover:text-primary transition-colors cursor-pointer focus-ink"
          >
            Clear
          </button>
        )}
      </div>

      {buckets && buckets.length > 0 && (
        <div className="flex items-end gap-px h-10 mb-2" aria-hidden="true">
          {buckets.map((b) => (
            <button
              key={b.key}
              type="button"
              title={`${b.min}–${b.max}: ${b.count.toLocaleString('en-US')} books`}
              onClick={() => onChange(b.min, b.max)}
              className="flex-1 min-w-[2px] cursor-pointer transition-colors focus-ink"
              style={{
                height: `${Math.max(8, (b.count / peak) * 100)}%`,
                background: inRange(b) ? 'var(--border-medium)' : 'var(--border-light)',
              }}
            />
          ))}
        </div>
      )}

      <RangeInputs
        key={`${min ?? ''}-${max ?? ''}`}
        min={min}
        max={max}
        onCommit={onChange}
        fromPlaceholder={fromPlaceholder}
        toPlaceholder={toPlaceholder}
      />

      <div className="flex flex-wrap gap-1 mt-2">
        {presets.map((p) => {
          const on = p.min === min && p.max === max;
          return (
            <button
              key={p.label}
              type="button"
              onClick={() => onChange(on ? null : p.min, on ? null : p.max)}
              className={`px-1.5 py-[3px] text-[11px] border transition-colors cursor-pointer focus-ink ${
                on
                  ? 'border-border-medium bg-warm text-primary'
                  : 'border-border-light text-secondary hover:border-border-medium hover:text-primary'
              }`}
            >
              {p.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
