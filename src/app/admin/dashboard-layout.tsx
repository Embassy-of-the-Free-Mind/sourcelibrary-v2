import type { ReactNode } from 'react';
import Link from 'next/link';

/**
 * Layout pieces shared by /admin and the public /about/progress (#5757): a titled
 * section, a strip of number tiles, and a two-up grid that collapses on a phone.
 * Server components; the charts that go inside them live in DashboardCharts.tsx.
 */
export function Section({ id, title, intro, link, children }: { id: string; title: string; intro?: ReactNode; link?: { href: string; label: string }; children: ReactNode }) {
  return (
    <section id={id} className="grid gap-3 content-start min-w-0 scroll-mt-16">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h2 className="text-xl font-semibold text-stone-900">{title}</h2>
        {link && <Link href={link.href} className="text-xs text-accent-rust hover:underline">{link.label} →</Link>}
      </div>
      {intro && <p className="text-sm text-stone-600 max-w-3xl leading-snug">{intro}</p>}
      {children}
    </section>
  );
}

export function Tiles({ tiles }: { tiles: { l: string; v: string; n?: string; up?: boolean }[] }) {
  return (
    <div className="grid gap-px rounded border border-stone-200 bg-stone-200 overflow-hidden" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
      {tiles.map(t => (
        <div key={t.l} className="bg-white px-4 py-3 grid gap-0.5 content-start min-w-0">
          <div className="text-xs text-stone-600">{t.l}</div>
          <div className="text-2xl font-semibold text-stone-900 leading-tight">{t.v}</div>
          {t.n && <div className={`text-[11px] font-mono ${t.up ? 'text-green-800' : 'text-stone-500'}`}>{t.n}</div>}
        </div>
      ))}
    </div>
  );
}

export function Grid2({ children }: { children: ReactNode }) {
  return <div className="grid gap-3 min-w-0" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 440px), 1fr))' }}>{children}</div>;
}
