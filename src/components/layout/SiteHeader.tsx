'use client';

import Link from 'next/link';
import Logo from './Logo';
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
      <div className={`flex items-center justify-between px-6 md:px-12 ${variant !== 'transparent' ? 'max-w-[var(--container-wide)] mx-auto' : ''}`}>
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
        <UserMenu variant={isWhiteText ? 'hero' : 'default'} />
      </div>
    </header>
  );
}
