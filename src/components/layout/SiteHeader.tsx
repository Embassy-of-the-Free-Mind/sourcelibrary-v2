'use client';

import Link from 'next/link';
import UserMenu from './UserMenu';

interface Breadcrumb {
  label: string;
  href: string;
}

interface SiteHeaderProps {
  /** 'transparent' for hero overlays, 'light' for cream pages, 'dark' for dark-bg pages (gallery) */
  variant?: 'transparent' | 'light' | 'dark';
  /** Optional breadcrumb trail after the logo (e.g. "Image Gallery") */
  breadcrumbs?: Breadcrumb[];
  /** Make header sticky */
  sticky?: boolean;
  /** Additional className for the header element */
  className?: string;
}

function Logo({ white, compact }: { white?: boolean; compact?: boolean }) {
  const strokeColor = white ? 'white' : 'currentColor';
  return (
    <Link
      href="/"
      className={`inline-flex items-center gap-3 ${
        white
          ? 'text-white hover:opacity-80'
          : 'text-primary hover:text-secondary'
      } transition-colors`}
      aria-label="Source Library home"
    >
      <svg
        className={compact ? 'w-8 h-8' : 'w-10 h-10 md:w-12 md:h-12'}
        viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" stroke={strokeColor} strokeWidth="1" />
        <circle cx="12" cy="12" r="7" stroke={strokeColor} strokeWidth="1" />
        <circle cx="12" cy="12" r="4" stroke={strokeColor} strokeWidth="1" />
      </svg>
      <span className={`${compact ? 'text-lg' : 'text-xl md:text-2xl'} uppercase tracking-wider`}>
        <span className="font-semibold">Source</span>
        <span className="font-light">Library</span>
        <sup className="text-[0.6em] font-light tracking-normal normal-case ml-1 opacity-80 relative -top-[0.5em]">Beta</sup>
      </span>
    </Link>
  );
}

export default function SiteHeader({ variant = 'light', breadcrumbs, sticky, className = '' }: SiteHeaderProps) {
  const isWhiteText = variant === 'transparent' || variant === 'dark';

  const variantClasses = {
    transparent: 'relative z-50 py-4',
    light: 'bg-cream border-b border-border-light py-3',
    dark: 'bg-stone-900 text-white py-3',
  }[variant];

  return (
    <header
      className={`${variantClasses} ${sticky ? 'sticky top-0 z-20' : ''} ${className}`}
    >
      <div className="flex items-center justify-between px-6 md:px-12 max-w-[var(--container-wide)] mx-auto">
        <div className="flex items-center gap-3">
          <Logo white={isWhiteText} compact={!!breadcrumbs} />
          {breadcrumbs?.map((crumb) => (
            <span key={crumb.href} className="flex items-center gap-3">
              <span className={isWhiteText ? 'text-white/40 hidden sm:inline' : 'text-stone-400 hidden sm:inline'}>/</span>
              <Link
                href={crumb.href}
                className={`text-base font-serif ${
                  isWhiteText ? 'text-white hover:opacity-80' : 'text-primary hover:text-secondary'
                } transition-colors`}
              >
                {crumb.label}
              </Link>
            </span>
          ))}
        </div>
        <div className="flex items-center gap-6">
          <Link
            href="/embassy"
            className={`text-sm font-sans tracking-wide ${
              isWhiteText
                ? 'text-white/70 hover:text-white'
                : 'text-[#6b6560] hover:text-[#1a1612]'
            } transition-colors hidden sm:block`}
          >
            The Embassy
          </Link>
          <UserMenu variant={isWhiteText ? 'hero' : 'default'} />
        </div>
      </div>
    </header>
  );
}
