import Image from 'next/image';
import Link from 'next/link';
import { ReactNode } from 'react';

/* ── Hero header: logo bar + dark gradient hero ── */

interface ContentHeaderProps {
  title: string;
  subtitle?: string;
  children?: ReactNode; // extra hero content (badges, etc.)
}

export function ContentHeader({ title, subtitle, children }: ContentHeaderProps) {
  return (
    <>
      <header className="bg-white border-b border-border-light">
        <div className="max-w-5xl mx-auto px-6 py-4">
          <Link
            href="/"
            className="inline-flex items-center text-secondary hover:text-primary transition-colors"
          >
            <Image
              src="/brand/png/logo-compact--black-on-transparent--96h.png"
              alt="Source Library"
              width={200}
              height={40}
              className="h-8 w-auto"
              unoptimized
            />
          </Link>
        </div>
      </header>

      <div className="bg-gradient-to-b from-[#2a1f17] to-[#1a1612] text-white py-20 md:py-24">
        <div className="max-w-5xl mx-auto px-6">
          <h1 className="font-serif text-4xl md:text-5xl lg:text-6xl tracking-tight mb-5">{title}</h1>
          {subtitle && (
            <p className="text-lg md:text-xl text-stone-300 max-w-2xl font-body leading-relaxed">{subtitle}</p>
          )}
          {children}
        </div>
      </div>
    </>
  );
}

/* ── Sub-page header: back-link + gradient bg ── */

interface SubPageHeaderProps {
  title: string;
  subtitle?: string;
  backHref?: string;
  backLabel?: string;
}

export function SubPageHeader({
  title,
  subtitle,
  backHref = '/',
  backLabel = 'Back to Library',
}: SubPageHeaderProps) {
  return (
    <div className="mb-8">
      <Link
        href={backHref}
        className="inline-flex items-center gap-2 text-muted hover:text-secondary mb-4"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
        </svg>
        {backLabel}
      </Link>
      <h1 className="text-3xl font-bold text-primary">{title}</h1>
      {subtitle && <p className="text-secondary mt-2">{subtitle}</p>}
    </div>
  );
}

/* ── Page wrapper ── */

interface ContentPageLayoutProps {
  /** Full-width header (ContentHeader). Omit for sub-pages that use SubPageHeader inside children. */
  header?: ReactNode;
  children: ReactNode;
  /** Additional classes on <main> */
  className?: string;
  /** Max-width variant — defaults to 5xl for hero pages */
  maxWidth?: 'narrow' | 'medium' | 'wide';
  /** Background color — defaults to stone-50 */
  bg?: string;
}

export default function ContentPageLayout({
  header,
  children,
  className = '',
  maxWidth = 'medium',
  bg = 'bg-stone-50',
}: ContentPageLayoutProps) {
  const widthClass =
    maxWidth === 'narrow'
      ? 'max-w-[var(--container-narrow)]'
      : maxWidth === 'wide'
        ? 'max-w-[var(--container-wide)]'
        : 'max-w-5xl'; // medium ≈ 900-1024

  return (
    <div className={`min-h-screen ${bg}`}>
      {header}
      <main className={`${widthClass} mx-auto px-6 py-12 ${className}`}>
        {children}
      </main>
    </div>
  );
}
