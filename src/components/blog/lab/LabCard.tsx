'use client';

import { ReactNode } from 'react';
import Link from 'next/link';

/** Shared card chrome for Sound Laboratory stations — matches DissonanceDemo. */
export function LabCard({
  title,
  headerRight,
  children,
  caption,
  sourceHref,
  sourceLabel,
}: {
  title: string;
  headerRight?: ReactNode;
  children: ReactNode;
  caption?: string;
  sourceHref: string;
  sourceLabel: string;
}) {
  return (
    <figure className="my-10 not-prose">
      <div className="rounded-lg border border-border-light bg-white/70 p-5 md:p-6">
        <div className="flex items-center justify-between gap-4 mb-5">
          <p className="font-serif text-lg text-primary">{title}</p>
          {headerRight}
        </div>
        {children}
      </div>
      <figcaption className="text-sm text-muted mt-2 not-italic">
        {caption}{caption ? ' ' : ''}
        <Link href={sourceHref} className="text-accent-rust hover:text-accent-rust underline">
          {sourceLabel}
        </Link>
      </figcaption>
    </figure>
  );
}

export function PlayToggle({ playing, onClick, label = 'Play' }: { playing: boolean; onClick: () => void; label?: string }) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-colors ${
        playing ? 'bg-stone-900 text-white hover:bg-stone-700' : 'bg-accent-rust text-white hover:opacity-90'
      }`}
      aria-pressed={playing}
    >
      {playing ? (
        <><svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor"><rect x="3" y="2" width="3.5" height="12" rx="1" /><rect x="9.5" y="2" width="3.5" height="12" rx="1" /></svg> Pause</>
      ) : (
        <><svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor"><path d="M4 2.5v11a.5.5 0 0 0 .77.42l8.5-5.5a.5.5 0 0 0 0-.84l-8.5-5.5A.5.5 0 0 0 4 2.5z" /></svg> {label}</>
      )}
    </button>
  );
}

export function Readout({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded border border-border-light bg-cream px-2 py-2 text-center">
      <p className="text-[11px] uppercase tracking-wider text-muted">{label}</p>
      <p className="font-mono text-sm text-primary mt-0.5">{value}</p>
      <p className="text-xs text-muted h-4">{note || ' '}</p>
    </div>
  );
}

export function Chip({ active, onClick, children }: { active?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
        active
          ? 'border-accent-rust text-accent-rust bg-accent-rust/5'
          : 'border-border-light text-muted hover:text-secondary hover:border-stone-300'
      }`}
    >
      {children}
    </button>
  );
}
