'use client';

import { cn } from '@/lib/utils';

interface BookLoaderProps {
  className?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  label?: string;
  variant?: 'light' | 'dark';
}

/*
 * Pythagorean Tetractys as overlapping concentric circles.
 * 10 points in the 1-2-3-4 triangle. Each point emanates
 * many concentric rings outward — large enough to overlap
 * with neighbors, creating interference patterns like
 * stones dropped in still water.
 */

const TETRACTYS: { row: number; col: number }[] = [
  { row: 0, col: 0 },
  { row: 1, col: 0 }, { row: 1, col: 1 },
  { row: 2, col: 0 }, { row: 2, col: 1 }, { row: 2, col: 2 },
  { row: 3, col: 0 }, { row: 3, col: 1 }, { row: 3, col: 2 }, { row: 3, col: 3 },
];

const GAP = 100;          // distance between centers
const RINGS = 8;          // concentric rings per point
const RING_SPACING = 14;  // distance between rings
const ROWS = 4;

const pad = RINGS * RING_SPACING + 10;
const vbW = (ROWS - 1) * GAP + pad * 2;
const vbH = (ROWS - 1) * GAP + pad * 2;
const cx0 = vbW / 2;
const cy0 = pad;

function getPos(row: number, col: number) {
  return {
    x: cx0 - (row * GAP) / 2 + col * GAP,
    y: cy0 + row * GAP,
  };
}

/*
 * Breathing cycle timing:
 *   Build up:  rows cascade in ~2.8s (monad first, bottom row last)
 *   Hold:      1.2s fully visible
 *   Dissolve:  rows cascade out ~2.4s (bottom row first, monad last)
 *   Pause:     0.8s empty
 *   Total:     ~8s
 */
const CYCLE_MS = 8000;
const DISSOLVE_START = 4000; // ms into cycle when dissolve begins

// Precompute per-point keyframes at module level
const KEYFRAMES_CSS = TETRACTYS.map(({ row, col }, i) => {
  // Build: monad first, bottom row last
  const expandStart = 600 + row * 500 + col * 150;
  const expandEnd = expandStart + 1000;
  // Dissolve: bottom row first, monad last (reverse order)
  const maxRow = ROWS - 1;
  const reverseRow = maxRow - row;
  const dissolveStart = DISSOLVE_START + reverseRow * 400 + (reverseRow > 0 ? col : 0) * 100;
  const dissolveEnd = dissolveStart + 700;

  const p = (ms: number) => (ms / CYCLE_MS * 100).toFixed(1);

  return `@keyframes t-cycle-${i} {
  0% { transform: scale(0); opacity: 0; }
  ${p(expandStart)}% { transform: scale(0); opacity: 0; }
  ${p(expandEnd)}% { transform: scale(1); opacity: 1; }
  ${p(dissolveStart)}% { transform: scale(1); opacity: 1; }
  ${p(dissolveEnd)}% { transform: scale(0); opacity: 0; }
  100% { transform: scale(0); opacity: 0; }
}`;
}).join('\n');

export function BookLoader({ className, size = 'md', variant = 'light' }: BookLoaderProps) {
  const svgClass = size === 'xs' ? 'w-16 h-16'
    : size === 'sm' ? 'w-32 h-32'
    : size === 'md' ? 'w-64 h-64'
    : 'w-[28rem] h-[28rem]';
  const strokeColor = variant === 'dark' ? '#c9a86c' : 'var(--accent-rust)';
  const dotColor = variant === 'dark' ? '#c9a86c' : 'var(--accent-rust)';

  return (
    <div className={cn('flex items-center justify-center', className)}>
      <svg
        viewBox={`0 0 ${vbW} ${vbH}`}
        className={svgClass}
        aria-hidden="true"
      >
        <defs>
          <style>{KEYFRAMES_CSS}</style>
        </defs>

        {TETRACTYS.map(({ row, col }, i) => {
          const { x, y } = getPos(row, col);

          return (
            <g
              key={i}
              style={{
                transformOrigin: `${x}px ${y}px`,
                animation: `t-cycle-${i} ${CYCLE_MS}ms ease-in-out infinite`,
              }}
            >
              {/* Concentric rings emanating outward */}
              {Array.from({ length: RINGS }).map((_, r) => {
                const radius = (r + 1) * RING_SPACING;
                const opacity = 0.75 - r * 0.06;
                return (
                  <circle
                    key={r}
                    cx={x}
                    cy={y}
                    r={radius}
                    fill="none"
                    stroke={strokeColor}
                    strokeWidth={r === 0 ? 2 : 1.2}
                    opacity={Math.max(opacity, 0.18)}
                  />
                );
              })}
              {/* Center dot */}
              <circle cx={x} cy={y} r={4} fill={dotColor} opacity="0.9" />
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function PageTurnLoader({ label = 'Loading page...', className }: BookLoaderProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-4', className)}>
      <div className="relative w-16 h-20">
        <div className="absolute inset-0 bg-stone-200 rounded shadow-sm" />
        <div className="absolute inset-0 bg-stone-100 rounded shadow-sm -translate-x-0.5 -translate-y-0.5" />
        <div className="absolute inset-0 bg-white rounded shadow-md -translate-x-1 -translate-y-1 animate-page-turn origin-left">
          <div className="p-2 space-y-1.5">
            <div className="h-1 bg-stone-200 rounded animate-shimmer bg-gradient-to-r from-stone-200 via-stone-100 to-stone-200 bg-[length:200%_100%]" />
            <div className="h-1 bg-stone-200 rounded animate-shimmer bg-gradient-to-r from-stone-200 via-stone-100 to-stone-200 bg-[length:200%_100%]" style={{ animationDelay: '100ms' }} />
            <div className="h-1 w-3/4 bg-stone-200 rounded animate-shimmer bg-gradient-to-r from-stone-200 via-stone-100 to-stone-200 bg-[length:200%_100%]" style={{ animationDelay: '200ms' }} />
            <div className="h-1 bg-stone-200 rounded animate-shimmer bg-gradient-to-r from-stone-200 via-stone-100 to-stone-200 bg-[length:200%_100%]" style={{ animationDelay: '300ms' }} />
            <div className="h-1 w-1/2 bg-stone-200 rounded animate-shimmer bg-gradient-to-r from-stone-200 via-stone-100 to-stone-200 bg-[length:200%_100%]" style={{ animationDelay: '400ms' }} />
          </div>
        </div>
      </div>
      <p className="text-stone-600 text-sm">{label}</p>
    </div>
  );
}
