'use client';

import { useState } from 'react';
import { BookLoader } from '@/components/ui/BookLoader';

/*
 * Tetractys Loader Lab — test different animation variants.
 */

// ── Variant: Ripple (dots always visible, rings emanate outward) ──

const TETRACTYS: { row: number; col: number }[] = [
  { row: 0, col: 0 },
  { row: 1, col: 0 }, { row: 1, col: 1 },
  { row: 2, col: 0 }, { row: 2, col: 1 }, { row: 2, col: 2 },
  { row: 3, col: 0 }, { row: 3, col: 1 }, { row: 3, col: 2 }, { row: 3, col: 3 },
];

const GAP = 100;
const RINGS = 6;
const RING_SPACING = 16;
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

// Each ring expands from r=0 to r=maxR and fades out, staggered per ring index.
// All 10 dots ripple continuously. Dots stagger slightly so it's not perfectly sync.
const RIPPLE_DURATION = 3000; // ms for one ring to expand fully
const RING_STAGGER = RIPPLE_DURATION / RINGS; // ms between each ring launch

function RippleLoader({ size = 'lg', variant = 'light' }: { size?: string; variant?: 'light' | 'dark' }) {
  const svgClass = size === 'sm' ? 'w-32 h-32'
    : size === 'md' ? 'w-64 h-64'
    : 'w-[28rem] h-[28rem]';
  const strokeColor = variant === 'dark' ? '#c9a86c' : 'var(--accent-rust)';
  const dotColor = variant === 'dark' ? '#c9a86c' : 'var(--accent-rust)';

  return (
    <svg viewBox={`0 0 ${vbW} ${vbH}`} className={svgClass} aria-hidden="true">
      <defs>
        <style>{`
          @keyframes ripple-expand {
            0% { r: 0; opacity: 0.7; stroke-width: 2.5; }
            10% { opacity: 0.7; }
            100% { r: ${RINGS * RING_SPACING}; opacity: 0; stroke-width: 0.5; }
          }
        `}</style>
      </defs>

      {TETRACTYS.map(({ row, col }, i) => {
        const { x, y } = getPos(row, col);
        // All dots ripple in perfect unison
        const dotDelay = 0;

        return (
          <g key={i}>
            {/* Expanding rings */}
            {Array.from({ length: RINGS }).map((_, r) => (
              <circle
                key={r}
                cx={x}
                cy={y}
                r={0}
                fill="none"
                stroke={strokeColor}
                style={{
                  animation: `ripple-expand ${RIPPLE_DURATION}ms ease-out infinite`,
                  animationDelay: `${dotDelay + r * RING_STAGGER}ms`,
                }}
              />
            ))}
            {/* Persistent center dot */}
            <circle cx={x} cy={y} r={4} fill={dotColor} opacity="0.9" />
          </g>
        );
      })}
    </svg>
  );
}

// ── Variant: Heartbeat (dots pulse in size, no rings) ──

function HeartbeatLoader({ size = 'lg', variant = 'light' }: { size?: string; variant?: 'light' | 'dark' }) {
  const svgClass = size === 'sm' ? 'w-32 h-32'
    : size === 'md' ? 'w-64 h-64'
    : 'w-[28rem] h-[28rem]';
  const dotColor = variant === 'dark' ? '#c9a86c' : 'var(--accent-rust)';

  return (
    <svg viewBox={`0 0 ${vbW} ${vbH}`} className={svgClass} aria-hidden="true">
      <defs>
        <style>{`
          @keyframes heartbeat {
            0%, 100% { r: 4; opacity: 0.5; }
            50% { r: 12; opacity: 1; }
          }
        `}</style>
      </defs>

      {TETRACTYS.map(({ row, col }, i) => {
        const { x, y } = getPos(row, col);
        // Wave from monad outward
        const delay = (row * 300 + col * 100);

        return (
          <circle
            key={i}
            cx={x}
            cy={y}
            r={4}
            fill={dotColor}
            style={{
              animation: `heartbeat 2000ms ease-in-out infinite`,
              animationDelay: `${delay}ms`,
            }}
          />
        );
      })}
    </svg>
  );
}

// ── Variant: Synchronized ripple (all dots ripple in unison from monad outward) ──

function SyncRippleLoader({ size = 'lg', variant = 'light' }: { size?: string; variant?: 'light' | 'dark' }) {
  const svgClass = size === 'sm' ? 'w-32 h-32'
    : size === 'md' ? 'w-64 h-64'
    : 'w-[28rem] h-[28rem]';
  const strokeColor = variant === 'dark' ? '#c9a86c' : 'var(--accent-rust)';
  const dotColor = variant === 'dark' ? '#c9a86c' : 'var(--accent-rust)';

  return (
    <svg viewBox={`0 0 ${vbW} ${vbH}`} className={svgClass} aria-hidden="true">
      <defs>
        <style>{`
          @keyframes sync-ripple {
            0% { r: 0; opacity: 0.6; stroke-width: 2; }
            100% { r: ${RINGS * RING_SPACING}; opacity: 0; stroke-width: 0.3; }
          }
        `}</style>
      </defs>

      {TETRACTYS.map(({ row, col }, i) => {
        const { x, y } = getPos(row, col);
        // Wave delay: monad starts first, each row follows
        const waveDelay = row * 400 + col * 150;

        return (
          <g key={i}>
            {Array.from({ length: 4 }).map((_, r) => (
              <circle
                key={r}
                cx={x}
                cy={y}
                r={0}
                fill="none"
                stroke={strokeColor}
                style={{
                  animation: `sync-ripple 2500ms ease-out infinite`,
                  animationDelay: `${waveDelay + r * 600}ms`,
                }}
              />
            ))}
            <circle cx={x} cy={y} r={4} fill={dotColor} opacity="0.9" />
          </g>
        );
      })}
    </svg>
  );
}

// ── Variant: Glow (dots glow and dim with halos) ──

function GlowLoader({ size = 'lg', variant = 'light' }: { size?: string; variant?: 'light' | 'dark' }) {
  const svgClass = size === 'sm' ? 'w-32 h-32'
    : size === 'md' ? 'w-64 h-64'
    : 'w-[28rem] h-[28rem]';
  const dotColor = variant === 'dark' ? '#c9a86c' : '#9e4a3a';

  return (
    <svg viewBox={`0 0 ${vbW} ${vbH}`} className={svgClass} aria-hidden="true">
      <defs>
        <radialGradient id="glow-grad">
          <stop offset="0%" stopColor={dotColor} stopOpacity="0.6" />
          <stop offset="40%" stopColor={dotColor} stopOpacity="0.15" />
          <stop offset="100%" stopColor={dotColor} stopOpacity="0" />
        </radialGradient>
        <style>{`
          @keyframes glow-pulse {
            0%, 100% { opacity: 0.15; transform: scale(0.6); }
            50% { opacity: 0.8; transform: scale(1); }
          }
        `}</style>
      </defs>

      {TETRACTYS.map(({ row, col }, i) => {
        const { x, y } = getPos(row, col);
        const delay = i * 250;

        return (
          <g key={i}>
            <circle
              cx={x}
              cy={y}
              r={40}
              fill="url(#glow-grad)"
              style={{
                transformOrigin: `${x}px ${y}px`,
                animation: `glow-pulse 3000ms ease-in-out infinite`,
                animationDelay: `${delay}ms`,
              }}
            />
            <circle cx={x} cy={y} r={4} fill={dotColor} opacity="0.9" />
          </g>
        );
      })}
    </svg>
  );
}

// ── Page ──

type Variant = 'breathing' | 'ripple' | 'heartbeat' | 'sync-ripple' | 'glow';

const VARIANTS: { id: Variant; label: string; description: string }[] = [
  { id: 'breathing', label: 'Breathing', description: 'Current production loader — dots build up then dissolve' },
  { id: 'ripple', label: 'Ripple', description: 'Dots always visible, rings emanate outward like pebbles in a pond' },
  { id: 'sync-ripple', label: 'Wave Ripple', description: 'Ripples cascade from monad down through the rows' },
  { id: 'heartbeat', label: 'Heartbeat', description: 'Dots pulse in size, wave from monad outward' },
  { id: 'glow', label: 'Glow', description: 'Dots glow and dim with soft halos' },
];

export default function TestLoaderPage() {
  const [active, setActive] = useState<Variant>('ripple');
  const [colorVariant, setColorVariant] = useState<'light' | 'dark'>('light');

  return (
    <div className={`min-h-screen ${colorVariant === 'dark' ? 'bg-dark' : 'bg-cream'} transition-colors`}>
      <div className="max-w-4xl mx-auto px-6 py-12">
        <h1 className={`font-serif text-3xl mb-2 ${colorVariant === 'dark' ? 'text-accent-gold' : 'text-primary'}`}>
          Tetractys Loader Lab
        </h1>
        <p className={`mb-8 ${colorVariant === 'dark' ? 'text-stone-400' : 'text-muted'}`}>
          Test different animation variants for the Pythagorean Tetractys loader.
        </p>

        {/* Controls */}
        <div className="flex flex-wrap gap-2 mb-4">
          {VARIANTS.map((v) => (
            <button
              key={v.id}
              onClick={() => setActive(v.id)}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                active === v.id
                  ? colorVariant === 'dark'
                    ? 'bg-accent-gold text-dark'
                    : 'bg-accent-rust text-white'
                  : colorVariant === 'dark'
                    ? 'bg-stone-800 text-stone-300 hover:bg-stone-700'
                    : 'bg-warm text-secondary hover:bg-stone-200'
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>

        <div className="flex gap-2 mb-8">
          <button
            onClick={() => setColorVariant('light')}
            className={`px-3 py-1.5 rounded text-xs font-medium transition-all ${
              colorVariant === 'light'
                ? 'bg-accent-rust text-white'
                : 'bg-warm text-secondary hover:bg-stone-200'
            }`}
          >
            Light
          </button>
          <button
            onClick={() => setColorVariant('dark')}
            className={`px-3 py-1.5 rounded text-xs font-medium transition-all ${
              colorVariant === 'dark'
                ? 'bg-accent-gold text-dark'
                : 'bg-stone-800 text-stone-300 hover:bg-stone-700'
            }`}
          >
            Dark
          </button>
        </div>

        {/* Description */}
        <p className={`mb-6 text-sm ${colorVariant === 'dark' ? 'text-stone-400' : 'text-muted'}`}>
          {VARIANTS.find((v) => v.id === active)?.description}
        </p>

        {/* Loader display */}
        <div className="flex items-center justify-center min-h-[32rem]">
          {active === 'breathing' && <BookLoader size="lg" variant={colorVariant} />}
          {active === 'ripple' && <RippleLoader size="lg" variant={colorVariant} />}
          {active === 'heartbeat' && <HeartbeatLoader size="lg" variant={colorVariant} />}
          {active === 'sync-ripple' && <SyncRippleLoader size="lg" variant={colorVariant} />}
          {active === 'glow' && <GlowLoader size="lg" variant={colorVariant} />}
        </div>
      </div>
    </div>
  );
}
