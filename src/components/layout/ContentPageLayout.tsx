import Link from 'next/link';
import { ReactNode } from 'react';
import SiteHeader from './SiteHeader';

/* ── Hero header: site header + dark gradient hero ── */

interface ContentHeaderProps {
  title: string;
  subtitle?: string;
  children?: ReactNode; // extra hero content (badges, etc.)
  /** Optional background image URL for the hero section */
  image?: string;
  imageAlt?: string;
  /** Match the page's ContentPageLayout maxWidth so the hero aligns with the body. */
  maxWidth?: 'narrow' | 'standard' | 'wide' | 'full';
}

export function ContentHeader({ title, subtitle, children, image, imageAlt, maxWidth = 'standard' }: ContentHeaderProps) {
  const headerWidthClass =
    maxWidth === 'full'
      ? ''
      : maxWidth === 'narrow'
        ? 'max-w-[var(--container-narrow)]'
        : maxWidth === 'wide'
          ? 'max-w-[var(--container-wide)]'
          : 'max-w-[var(--container-standard)]';
  return (
    <>
      <SiteHeader variant="light" />

      <div className={`relative overflow-hidden text-white ${image ? 'pt-16 pb-10 md:pt-24 md:pb-14 min-h-[260px] md:min-h-[340px] flex flex-col justify-end' : 'py-16 md:py-20'}`}>
        {image ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={image}
              alt={imageAlt || ''}
              className="absolute inset-0 w-full h-full object-cover"
            />
            <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, rgba(26,22,18,0.94) 0%, rgba(26,22,18,0.75) 35%, rgba(26,22,18,0.35) 65%, rgba(26,22,18,0.15) 100%)' }} />
          </>
        ) : (
          <div className="absolute inset-0 bg-gradient-to-b from-[#2a1f17] to-[#1a1612]" />
        )}
        <div className={`relative w-full ${headerWidthClass} mx-auto px-6 md:px-12`}>
          <h1 className={`font-serif text-4xl md:text-5xl tracking-tight ${subtitle ? 'mb-4' : ''} ${image ? 'drop-shadow-[0_2px_12px_rgba(0,0,0,0.4)]' : ''}`}>{title}</h1>
          {subtitle && (
            <p className={`text-lg md:text-xl text-stone-300 max-w-2xl font-body leading-relaxed ${image ? 'drop-shadow-[0_1px_6px_rgba(0,0,0,0.3)]' : ''}`}>{subtitle}</p>
          )}
          {!image && children}
        </div>
      </div>

      {/* Date/byline below hero when image is present */}
      {image && children && (
        <div className="bg-cream">
          <div className={`${headerWidthClass} mx-auto px-6 md:px-12 pt-6`}>
            {children}
          </div>
        </div>
      )}
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
  /** Max-width variant (see globals.css --container-* vars, issue #232)
   *  narrow: 672px — focused reading, forms
   *  standard: 1024px — most content pages (default)
   *  wide: 1280px — browse, multi-column
   *  full: no max-width, edge-to-edge
   */
  maxWidth?: 'narrow' | 'standard' | 'wide' | 'full';
  /** Background color — defaults to stone-50 */
  bg?: string;
  /** Remove padding from main content area (e.g. for full-bleed maps) */
  noPadding?: boolean;
}

export default function ContentPageLayout({
  header,
  children,
  className = '',
  maxWidth = 'standard',
  bg = 'bg-stone-50',
  noPadding = false,
}: ContentPageLayoutProps) {
  const widthClass =
    maxWidth === 'full'
      ? ''
      : maxWidth === 'narrow'
        ? 'max-w-[var(--container-narrow)]'
        : maxWidth === 'wide'
          ? 'max-w-[var(--container-wide)]'
          : 'max-w-[var(--container-standard)]';

  return (
    <div className={`min-h-screen ${bg}`}>
      {header}
      <main className={`${widthClass} ${widthClass ? 'mx-auto' : ''} ${noPadding ? '' : 'px-6 md:px-12 py-12'} ${className}`}>
        {children}
      </main>
    </div>
  );
}
