'use client';

import { useState } from 'react';
import type { Book } from '@/lib/types';
import { ADOPT_TIERS, ADOPT_MAX_CENTS, resolveAdoptTier, formatEuros } from '@/lib/adopt-tiers';

/**
 * Adopt-a-book amount selector + checkout launcher.
 *
 * Shows "Adopt this book →"; on open, the donor picks a suggested amount (or
 * types their own, ≥ the tier minimum), then we create a Stripe Checkout
 * Session (/api/adopt/checkout) for that amount and redirect.
 */
export default function AdoptBookPanel({
  book,
}: {
  book: Pick<Book, 'id' | 'slug' | 'adopt_tier' | 'resource_type'>;
}) {
  const tier = resolveAdoptTier(book);
  const cfg = ADOPT_TIERS[tier];

  const [open, setOpen] = useState(false);
  const [presetCents, setPresetCents] = useState(cfg.defaultCents);
  const [customEuros, setCustomEuros] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const customCents = customEuros.trim()
    ? Math.round(parseFloat(customEuros.replace(',', '.')) * 100)
    : null;
  const finalCents = customCents ?? presetCents;
  const valid = Number.isFinite(finalCents) && finalCents >= cfg.minCents && finalCents <= ADOPT_MAX_CENTS;

  async function start() {
    if (!valid) {
      setError(`Minimum ${formatEuros(cfg.minCents)}.`);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/adopt/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookId: book.slug || book.id, amount: finalCents }),
      });
      const data = await res.json();
      if (data?.url) {
        window.location.href = data.url;
        return;
      }
      setLoading(false);
      setError(data?.error || 'Could not start checkout. Please try again.');
    } catch {
      setLoading(false);
      setError('Could not start checkout. Please try again.');
    }
  }

  if (!open) {
    return (
      <div className="mt-4 pt-4 border-t border-stone-700">
        <button onClick={() => setOpen(true)} className="text-sm text-accent-gold hover:underline">
          Adopt this book →
        </button>
        <p className="text-xs text-stone-500 mt-1">
          Support its digitization and have your name credited here, forever — from {formatEuros(cfg.minCents)}.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4 pt-4 border-t border-stone-700">
      <p className="text-sm text-stone-300 mb-2">Choose your gift</p>
      <div className="flex flex-wrap items-center gap-2 mb-2">
        {cfg.suggestedCents.map((c) => {
          const selected = customCents === null && presetCents === c;
          return (
            <button
              key={c}
              onClick={() => {
                setPresetCents(c);
                setCustomEuros('');
                setError(null);
              }}
              className={`px-3 py-1.5 rounded text-sm border transition-colors ${
                selected
                  ? 'border-accent-gold text-accent-gold'
                  : 'border-stone-600 text-stone-300 hover:border-stone-400'
              }`}
            >
              {formatEuros(c)}
            </button>
          );
        })}
        <span className="inline-flex items-center gap-1">
          <span className="text-stone-500 text-sm">€</span>
          <input
            type="number"
            inputMode="numeric"
            min={cfg.minCents / 100}
            placeholder="Other"
            value={customEuros}
            onChange={(e) => {
              setCustomEuros(e.target.value);
              setError(null);
            }}
            className="w-20 px-2 py-1.5 rounded text-sm bg-stone-800 border border-stone-600 text-stone-200 placeholder:text-stone-500"
          />
        </span>
      </div>
      {error && <p className="text-xs text-red-400 mb-2">{error}</p>}
      <button
        onClick={start}
        disabled={loading || !valid}
        className="px-4 py-2 rounded text-sm border border-accent-gold text-accent-gold font-medium hover:bg-accent-gold/10 disabled:opacity-60"
      >
        {loading ? 'Starting…' : `Continue${valid ? ` — ${formatEuros(finalCents)}` : ''} →`}
      </button>
      <p className="text-xs text-stone-500 mt-2">
        You&apos;ll be credited on this book&apos;s page, forever. Minimum {formatEuros(cfg.minCents)}.
      </p>
    </div>
  );
}
