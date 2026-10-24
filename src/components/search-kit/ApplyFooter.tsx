'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * The foot of an Advanced search panel. Changes wait for the submit button —
 * a deliberate step — and the footer makes that impossible to miss: the button
 * turns rust and breathes, says how many results the change would show, and a
 * bar with the same button rides along the bottom of the screen whenever the
 * footer itself is out of view. Render inside the panel's <form>: both
 * buttons are submit buttons.
 */
export default function ApplyFooter({ dirty, count, noun = 'results', onClear }: {
  dirty: boolean;
  /** Results the pending change would show, when known. */
  count: number | null;
  noun?: string;
  onClear: () => void;
}) {
  const [footSeen, setFootSeen] = useState(true);
  const footRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = footRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setFootSeen(e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const singular = noun.endsWith('s') ? noun.slice(0, -1) : noun;
  const text = dirty && count != null ? `Show ${count.toLocaleString('en-GB')} ${count === 1 ? singular : noun}` : `Show ${noun}`;
  const showBar = dirty && !footSeen;
  const applyClass = dirty
    ? 'h-[42px] px-[22px] bg-accent-rust text-white text-sm animate-[catalog-breathe_1.6s_ease-out_infinite] motion-reduce:animate-none'
    : 'h-[42px] px-[22px] bg-primary text-cream text-sm';

  return (
    <>
      <div ref={footRef} className="flex justify-between items-center mt-5 gap-3">
        <button type="button" onClick={onClear} className="text-[13.5px] text-muted underline underline-offset-[3px]">Clear everything</button>
        <div className="flex items-center gap-3.5">
          {dirty && <span className="text-[13.5px] text-accent-rust">Not applied yet</span>}
          <button type="submit" className={applyClass}>{text}</button>
        </div>
      </div>
      <div aria-hidden={!showBar} className={`fixed inset-x-0 bottom-0 z-40 bg-primary text-cream transition-transform duration-200 ${showBar ? 'translate-y-0' : 'translate-y-full'}`}>
        <div className="max-w-[1500px] mx-auto px-4 md:px-12 h-16 flex items-center justify-between gap-4">
          <span className="text-sm">You changed the search</span>
          <button type="submit" tabIndex={showBar ? 0 : -1} className="h-[42px] px-[22px] bg-accent-rust text-white text-sm">{text}</button>
        </div>
      </div>
    </>
  );
}
