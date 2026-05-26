'use client';

interface PullQuoteProps {
  children: React.ReactNode;
  attribution?: string;
}

/**
 * A typographic pull-quote — large serif text breaking out of the
 * body column, used to spotlight a single insight per section.
 * Pudding/NYT-style emphasis.
 */
export function PullQuote({ children, attribution }: PullQuoteProps) {
  return (
    <blockquote className="my-14 -mx-2 sm:-mx-6 md:-mx-12 px-5 sm:px-7 md:px-12 py-8 border-l-[6px] border-amber-600 dark:border-amber-500 bg-amber-50/70 dark:bg-amber-950/30 rounded-r-sm">
      <p className="font-serif text-2xl sm:text-[28px] md:text-[32px] leading-[1.25] text-stone-900 dark:text-stone-50 tracking-[-0.01em]">
        {children}
      </p>
      {attribution && (
        <footer className="mt-4 text-[10px] uppercase tracking-[0.2em] text-stone-500 dark:text-stone-400 font-mono">
          — {attribution}
        </footer>
      )}
    </blockquote>
  );
}
