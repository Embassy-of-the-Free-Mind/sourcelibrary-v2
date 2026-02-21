'use client';

import { cn } from '@/lib/utils';

interface BookLoaderProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  label?: string;
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

export function BookLoader({ className, size = 'md' }: BookLoaderProps) {
  const svgClass = size === 'sm' ? 'w-32 h-32'
    : size === 'md' ? 'w-64 h-64'
    : 'w-[28rem] h-[28rem]';

  return (
    <div className={cn('flex items-center justify-center', className)}>
      <svg
        viewBox={`0 0 ${vbW} ${vbH}`}
        className={cn(svgClass, 'animate-[tetractys-fade-in_2s_ease-out_both]')}
        aria-hidden="true"
      >
        <defs>
          <style>{`
            @keyframes tetractys-fade-in {
              from { opacity: 0; }
              to   { opacity: 1; }
            }
            @keyframes t-expand {
              0%   { transform: scale(0); opacity: 0; }
              40%  { opacity: 1; }
              100% { transform: scale(1); opacity: 1; }
            }
          `}</style>
        </defs>

        {TETRACTYS.map(({ row, col }, i) => {
          const { x, y } = getPos(row, col);
          // Cascade: Monad appears first, each row ~500ms later
          const groupDelay = 800 + row * 500 + col * 150;

          return (
            <g
              key={i}
              style={{
                transformOrigin: `${x}px ${y}px`,
                animation: `t-expand 1.2s ease-out ${groupDelay}ms both`,
              }}
            >
              {/* Concentric rings emanating outward — many, thin, overlapping */}
              {Array.from({ length: RINGS }).map((_, r) => {
                const radius = (r + 1) * RING_SPACING;
                // Outer rings fade more
                const opacity = 0.55 - r * 0.04;
                return (
                  <circle
                    key={r}
                    cx={x}
                    cy={y}
                    r={radius}
                    fill="none"
                    stroke="var(--accent-rust)"
                    strokeWidth={r === 0 ? 1.2 : 0.8}
                    opacity={Math.max(opacity, 0.12)}
                  />
                );
              })}
              {/* Center dot */}
              <circle cx={x} cy={y} r={3} fill="var(--accent-rust)" opacity="0.8" />
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
