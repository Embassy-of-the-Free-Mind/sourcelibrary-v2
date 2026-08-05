'use client';

import type { ReaderSettings, ReaderTheme } from './useReaderV2';

// Shared reading-settings controls, rendered inside 2a's popover, 2c's drawer,
// and the mobile sheets. All type set in the site's existing faces (Inter UI,
// letterspaced caps for labels — the house style uses no monospace).

const THEMES: Array<{ key: ReaderTheme; label: string; swatch: string }> = [
  { key: 'light', label: 'Light', swatch: 'var(--bg-cream)' },
  { key: 'sepia', label: 'Sepia', swatch: '#f6eeda' },
  { key: 'dark', label: 'Dark', swatch: '#2a241d' },
];

const TEXT_SCALES = [0.85, 0.925, 1, 1.1, 1.22];
const LINE_WIDTHS: Array<ReaderSettings['lineWidth']> = ['narrow', 'comfortable', 'wide'];
const LINE_HEIGHTS = [1.5, 1.6, 1.7, 1.8, 1.9];

function RowLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-sans text-[12px] text-[var(--text-secondary)]">{children}</span>
  );
}

export default function ReaderSettingsControls({
  settings,
  onChange,
  compact = false,
}: {
  settings: ReaderSettings;
  onChange: (patch: Partial<ReaderSettings>) => void;
  /** Mobile sheets show the reduced control set (theme, size, typeface, glosses) */
  compact?: boolean;
}) {
  const scaleIdx = TEXT_SCALES.reduce(
    (best, v, i) => (Math.abs(v - settings.textScale) < Math.abs(TEXT_SCALES[best] - settings.textScale) ? i : best),
    0,
  );

  const rowH = compact ? 'min-h-[44px]' : 'min-h-[38px]';

  return (
    <div className="flex flex-col">
      {/* Theme */}
      <div className={`flex items-center justify-between gap-3 ${rowH}`}>
        <RowLabel>Theme</RowLabel>
        <div className="flex border border-[var(--border-medium)]">
          {THEMES.map(t => (
            <button
              key={t.key}
              type="button"
              onClick={() => onChange({ theme: t.key })}
              aria-pressed={settings.theme === t.key}
              className="px-3 py-1.5 font-sans text-[12px] flex items-center gap-1.5 border-l first:border-l-0 border-[var(--border-medium)]"
              style={settings.theme === t.key ? { boxShadow: 'inset 0 -2px 0 var(--accent-rust)' } : undefined}
            >
              <span
                className="inline-block w-3 h-3 border border-[var(--border-medium)]"
                style={{ background: t.swatch }}
              />
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Text size */}
      <div className={`flex items-center justify-between gap-3 ${rowH} border-t border-[var(--border-light)]`}>
        <RowLabel>Text size</RowLabel>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Smaller text"
            disabled={scaleIdx === 0}
            onClick={() => onChange({ textScale: TEXT_SCALES[Math.max(0, scaleIdx - 1)] })}
            className="w-9 h-9 flex items-center justify-center font-body text-[13px] hover:bg-black/5 disabled:opacity-30"
          >
            A
          </button>
          <span className="font-sans text-[11px] text-[var(--text-muted)] w-8 text-center">
            {Math.round(settings.textScale * 100)}%
          </span>
          <button
            type="button"
            aria-label="Larger text"
            disabled={scaleIdx === TEXT_SCALES.length - 1}
            onClick={() => onChange({ textScale: TEXT_SCALES[Math.min(TEXT_SCALES.length - 1, scaleIdx + 1)] })}
            className="w-9 h-9 flex items-center justify-center font-body text-[18px] hover:bg-black/5 disabled:opacity-30"
          >
            A
          </button>
        </div>
      </div>

      {/* Line width */}
      {!compact && (
        <div className={`flex items-center justify-between gap-3 ${rowH} border-t border-[var(--border-light)]`}>
          <RowLabel>Line width</RowLabel>
          <div className="flex">
            {LINE_WIDTHS.map(w => (
              <button
                key={w}
                type="button"
                onClick={() => onChange({ lineWidth: w })}
                aria-pressed={settings.lineWidth === w}
                className={`px-2.5 py-1 font-sans text-[12px] capitalize ${settings.lineWidth === w ? 'text-[var(--text-primary)] underline decoration-[var(--accent-rust)] underline-offset-4' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
              >
                {w === 'comfortable' ? 'Normal' : w}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Typeface */}
      <div className={`flex items-center justify-between gap-3 ${rowH} border-t border-[var(--border-light)]`}>
        <RowLabel>Typeface</RowLabel>
        <div className="flex">
          {(['serif', 'sans'] as const).map(t => (
            <button
              key={t}
              type="button"
              onClick={() => onChange({ typeface: t })}
              aria-pressed={settings.typeface === t}
              className={`px-2.5 py-1 text-[13px] ${t === 'serif' ? 'font-body' : 'font-sans'} ${settings.typeface === t ? 'text-[var(--text-primary)] underline decoration-[var(--accent-rust)] underline-offset-4' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
            >
              {t === 'serif' ? 'Serif' : 'Sans'}
            </button>
          ))}
        </div>
      </div>

      {/* Line height */}
      {!compact && (
        <div className={`flex items-center justify-between gap-3 ${rowH} border-t border-[var(--border-light)]`}>
          <RowLabel>Line height</RowLabel>
          <div className="flex items-center gap-1">
            {LINE_HEIGHTS.map(lh => (
              <button
                key={lh}
                type="button"
                onClick={() => onChange({ lineHeight: lh })}
                aria-pressed={settings.lineHeight === lh}
                className={`px-1.5 py-1 font-sans text-[12px] ${settings.lineHeight === lh ? 'text-[var(--text-primary)] underline decoration-[var(--accent-rust)] underline-offset-4' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
              >
                {lh}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Notes (inline editorial notes + glosses in the text) */}
      <div className={`flex items-center justify-between gap-3 ${rowH} border-t border-[var(--border-light)]`}>
        <RowLabel>Notes</RowLabel>
        <button
          type="button"
          role="switch"
          aria-checked={settings.glosses}
          onClick={() => onChange({ glosses: !settings.glosses })}
          className="relative w-10 h-[22px] border border-[var(--border-medium)] transition-colors"
          style={{ background: settings.glosses ? 'var(--accent-rust)' : 'var(--bg-warm)' }}
        >
          <span
            className="absolute top-[2px] w-4 h-4 bg-white border border-[var(--border-medium)] transition-all"
            style={{ left: settings.glosses ? 20 : 2 }}
          />
        </button>
      </div>
    </div>
  );
}
