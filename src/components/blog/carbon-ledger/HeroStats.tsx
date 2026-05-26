'use client';
import { BookIcon, BurgerIcon, PlaneIcon } from '@/components/blog/carbon-ledger/icons';
import { fmtCount, toEquivalents } from '@/components/blog/carbon-ledger/format';

interface HeroStatsProps {
  kg: number;
}

/**
 * Three-up summary tile at the top of the post.
 * Pages processed · CO2 emitted · in burgers / flights.
 */
export function HeroStats({ kg }: HeroStatsProps) {
  const eq = toEquivalents(kg);

  return (
    <div className="grid grid-cols-3 gap-3 sm:gap-6 my-10 border-y-2 border-amber-900/15 dark:border-amber-200/15 py-8">
      <div className="text-center">
        <div className="flex justify-center mb-2 h-10 items-end gap-1 text-stone-700 dark:text-stone-300">
          <BookIcon size={36} className="text-amber-900/70 dark:text-amber-300/70" />
          <BookIcon size={32} className="text-amber-900/55 dark:text-amber-300/55" />
          <BookIcon size={28} className="text-amber-900/40 dark:text-amber-300/40" />
        </div>
        <div className="font-serif text-3xl sm:text-5xl font-bold tabular-nums leading-none">
          4.1M
        </div>
        <div className="text-[10px] uppercase tracking-[0.2em] text-stone-500 font-mono mt-2">
          pages OCR&apos;d
        </div>
      </div>

      <div className="text-center border-x border-amber-900/15 dark:border-amber-200/15 px-2">
        <div className="flex justify-center mb-3 h-10 items-end">
          <span className="font-serif text-4xl text-amber-900/30 dark:text-amber-300/30 leading-none">
            ⁂
          </span>
        </div>
        <div className="font-serif text-3xl sm:text-5xl font-bold tabular-nums leading-none" style={{ color: 'var(--color-rust)' }}>
          ~{kg < 1000 ? `${Math.round(kg)} kg` : `${(kg / 1000).toFixed(1)} t`}
        </div>
        <div className="text-[10px] uppercase tracking-[0.2em] text-stone-500 font-mono mt-2">
          CO₂ (central)
        </div>
      </div>

      <div className="text-center">
        <div className="flex justify-center mb-3 h-10 items-end gap-1.5">
          <PlaneIcon size={28} className="" style={{ color: 'var(--color-indigo)' }} />
          <PlaneIcon size={28} className="" style={{ color: 'var(--color-indigo)' }} />
          <PlaneIcon size={28} className="" style={{ color: 'var(--color-indigo)' }} />
        </div>
        <div className="font-serif text-3xl sm:text-5xl font-bold tabular-nums leading-none">
          ~{fmtCount(eq.amsLhr)}
        </div>
        <div className="text-[10px] uppercase tracking-[0.2em] text-stone-500 font-mono mt-2">
          flights AMS↔LHR
        </div>
      </div>
    </div>
  );
}
