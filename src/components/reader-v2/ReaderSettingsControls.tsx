'use client';

import { useLocale } from '@/lib/i18n';
import { getReaderStrings, type ReaderStrings } from '@/lib/reader-strings';
import type { ReaderSettings, ReaderTheme } from './useReaderV2';

// Shared reading-settings controls, rendered inside 2a's popover, 2c's drawer,
// and the mobile sheets. All type set in the site's existing faces (Inter UI,
// letterspaced caps for labels — the house style uses no monospace).

// Swatches are literal, never tokens: a token is re-declared by the very theme
// being previewed, so in dark mode the "Light" chip rendered dark. The name is
// a catalogue key, so only the swatch lives out here.
const THEMES: Array<{ key: ReaderTheme; label: keyof ReaderStrings['settings']; swatch: string }> = [
  { key: 'light', label: 'themeLight', swatch: '#fdfcf9' },
  { key: 'sepia', label: 'themeSepia', swatch: '#f6eeda' },
  { key: 'dark', label: 'themeDark', swatch: '#2a241d' },
];

const TEXT_SCALES = [0.7, 0.8, 0.9, 1, 1.15, 1.3, 1.5, 1.75, 2];
const LINE_WIDTHS: Array<ReaderSettings['lineWidth']> = ['narrow', 'comfortable', 'wide'];
const LINE_HEIGHTS = [1.5, 1.6, 1.7, 1.8, 1.9];

function RowLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-sans text-[12.5px] whitespace-nowrap text-[var(--text-secondary)]">{children}</span>
  );
}

/** The group a set of segmented choices sits in — one hairline box, no gaps. */
function SegGroup({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex overflow-hidden" style={{ border: '1px solid var(--border-medium)' }}>
      {children}
    </div>
  );
}

/**
 * One choice in a segmented control. Selection is a filled, inverted chip
 * rather than an underline: at a glance the chosen value is the dark one, in
 * every theme (the fill and its text both come from theme tokens, so night
 * mode inverts them together).
 */
function SegButton({
  selected, onClick, children, className = '', title,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      title={title}
      className={`px-2.5 py-1.5 font-sans text-[12px] leading-none transition-colors border-l first:border-l-0 ${className}`}
      style={{
        borderColor: 'var(--border-medium)',
        background: selected ? 'var(--text-primary)' : 'transparent',
        color: selected ? 'var(--bg-cream)' : 'var(--text-muted)',
        fontWeight: selected ? 500 : 400,
      }}
    >
      {children}
    </button>
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
  const t = getReaderStrings(useLocale()).settings;
  const scaleIdx = TEXT_SCALES.reduce(
    (best, v, i) => (Math.abs(v - settings.textScale) < Math.abs(TEXT_SCALES[best] - settings.textScale) ? i : best),
    0,
  );

  const rowH = compact ? 'min-h-[48px]' : 'min-h-[42px]';
  const row = `flex items-center justify-between gap-3 ${rowH}`;

  return (
    <div className="flex flex-col">
      {/* Theme */}
      <div className={row}>
        <RowLabel>{t.theme}</RowLabel>
        <SegGroup>
          {THEMES.map(theme => (
            <SegButton
              key={theme.key}
              selected={settings.theme === theme.key}
              onClick={() => onChange({ theme: theme.key })}
              className="flex items-center gap-1.5"
            >
              <span
                className="inline-block w-3 h-3 border"
                style={{ background: theme.swatch, borderColor: 'rgba(120,110,96,0.5)' }}
              />
              {t[theme.label]}
            </SegButton>
          ))}
        </SegGroup>
      </div>

      {/* Text size */}
      <div className={`${row} border-t border-[var(--border-light)]`}>
        <RowLabel>{t.textSize}</RowLabel>
        <div className="flex items-center">
          <SegGroup>
            <SegButton
              selected={false}
              onClick={() => onChange({ textScale: TEXT_SCALES[Math.max(0, scaleIdx - 1)] })}
              title={t.smallerText}
              className={`w-9 font-body ${scaleIdx === 0 ? 'opacity-30 pointer-events-none' : ''}`}
            >
              <span className="text-[12px]" aria-label={t.smallerText}>A</span>
            </SegButton>
            <span
              className="w-[52px] flex items-center justify-center font-sans text-[11.5px] tabular-nums border-l"
              style={{ borderColor: 'var(--border-medium)', color: 'var(--text-secondary)' }}
            >
              {Math.round(settings.textScale * 100)}%
            </span>
            <SegButton
              selected={false}
              onClick={() => onChange({ textScale: TEXT_SCALES[Math.min(TEXT_SCALES.length - 1, scaleIdx + 1)] })}
              title={t.largerText}
              className={`w-9 font-body ${scaleIdx === TEXT_SCALES.length - 1 ? 'opacity-30 pointer-events-none' : ''}`}
            >
              <span className="text-[17px]" aria-label={t.largerText}>A</span>
            </SegButton>
          </SegGroup>
        </div>
      </div>

      {/* Line width */}
      {!compact && (
        <div className={`${row} border-t border-[var(--border-light)]`}>
          <RowLabel>{t.lineWidth}</RowLabel>
          <SegGroup>
            {LINE_WIDTHS.map(w => (
              <SegButton
                key={w}
                selected={settings.lineWidth === w}
                onClick={() => onChange({ lineWidth: w })}
              >
                {w === 'narrow' ? t.lineWidthNarrow : w === 'wide' ? t.lineWidthWide : t.lineWidthNormal}
              </SegButton>
            ))}
          </SegGroup>
        </div>
      )}

      {/* Notes are not here: the toggle sits in each text pane's header,
          next to the text it changes. Two switches for one setting invites
          the reader to wonder whether they are the same switch. */}
      {/* Typeface */}
      <div className={`${row} border-t border-[var(--border-light)]`}>
        <RowLabel>{t.typeface}</RowLabel>
        <SegGroup>
          {(['serif', 'sans'] as const).map(face => (
            <SegButton
              key={face}
              selected={settings.typeface === face}
              onClick={() => onChange({ typeface: face })}
              className={face === 'serif' ? 'font-body' : 'font-sans'}
            >
              {face === 'serif' ? t.typefaceSerif : t.typefaceSans}
            </SegButton>
          ))}
        </SegGroup>
      </div>

      {/* Line height */}
      {!compact && (
        <div className={`${row} border-t border-[var(--border-light)]`}>
          <RowLabel>{t.lineHeight}</RowLabel>
          <SegGroup>
            {LINE_HEIGHTS.map(lh => (
              <SegButton
                key={lh}
                selected={settings.lineHeight === lh}
                onClick={() => onChange({ lineHeight: lh })}
                className="tabular-nums"
              >
                {lh}
              </SegButton>
            ))}
          </SegGroup>
        </div>
      )}

    </div>
  );
}

/**
 * The house switch. Off reads as an empty well, on as a filled track — the
 * knob is literal cream because the night theme rewrites .bg-white and turned
 * it dark against the track.
 */
export function SettingsSwitch({ on, onToggle, label }: {
  on: boolean; onToggle: () => void; label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onToggle}
      className="relative w-[42px] h-[24px] shrink-0 border transition-colors"
      style={{
        // Off used to be --border-medium on --bg-warm inside a --bg-warm
        // panel: a 1.37:1 border around a 1.00:1 fill, i.e. an off switch you
        // could only find by its knob. The boundary of a control has to clear
        // 3:1, and it is the only thing carrying the state.
        borderColor: on ? 'var(--text-primary)' : 'var(--text-muted)',
        background: on ? 'var(--text-primary)' : 'var(--bg-cream)',
      }}
    >
      <span
        className="absolute top-[2px] w-[18px] h-[18px] transition-all"
        style={{
          left: on ? 21 : 2,
          background: '#fdfcf9',
          border: `1px solid ${on ? 'var(--text-primary)' : 'var(--text-muted)'}`,
        }}
      />
    </button>
  );
}
