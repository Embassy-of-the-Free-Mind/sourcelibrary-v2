'use client';

export interface ToggleRow {
  key: string;
  label: string;
  count?: number;
  on: boolean;
  onChange: (on: boolean) => void;
  hint?: string;
}

interface ToggleFacetProps {
  label: string;
  rows: ToggleRow[];
  onClear?: () => void;
}

/** A small group of independent yes/no conditions, with their counts. */
export default function ToggleFacet({ label, rows, onClear }: ToggleFacetProps) {
  const anyOn = rows.some((r) => r.on);

  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <h3 className="text-[10px] uppercase tracking-[0.13em] text-muted">{label}</h3>
        {anyOn && onClear && (
          <button
            type="button"
            onClick={onClear}
            className="text-[11px] text-muted hover:text-primary transition-colors cursor-pointer focus-ink"
          >
            Clear
          </button>
        )}
      </div>
      {rows.map((row) => (
        <label
          key={row.key}
          title={row.hint}
          className={`flex items-center justify-between gap-2 h-7 text-[13px] leading-none cursor-pointer transition-colors ${
            row.on ? 'text-primary' : 'text-secondary hover:text-primary'
          }`}
        >
          <span className="flex items-center gap-2 min-w-0">
            <input
              type="checkbox"
              checked={row.on}
              onChange={(e) => row.onChange(e.target.checked)}
              className="shrink-0 w-3 h-3 accent-[#3b332a] cursor-pointer focus-ink"
            />
            <span className="truncate">{row.label}</span>
          </span>
          {typeof row.count === 'number' && (
            <span className="shrink-0 text-[11px] text-faint tabular-nums">
              {row.count.toLocaleString('en-US')}
            </span>
          )}
        </label>
      ))}
    </div>
  );
}
