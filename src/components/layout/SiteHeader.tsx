'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Logo from './Logo';
import UserMenu from './UserMenu';

const NAV_LINKS = [
  { label: 'Collections', href: '/collections' },
  { label: 'Gallery', href: '/gallery' },
  { label: 'Browse', href: '/browse' },
  { label: 'Timeline', href: '/timeline' },
  { label: 'Libraries', href: '/libraries' },
  { label: 'Reading Room', href: '/reading-room' },
];

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
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  // Close menu on route change
  useEffect(() => { setMenuOpen(false); }, [pathname]);

  // Close menu on click outside
  useEffect(() => {
    if (!menuOpen) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [menuOpen]);

  const variantClasses = {
    transparent: 'relative z-50 py-4',
    light: 'bg-cream border-b border-border-light py-3',
    dark: 'bg-stone-900 text-white py-3',
  }[variant];

  const linkClass = isWhiteText
    ? 'text-white/70 hover:text-white'
    : 'text-secondary hover:text-primary';

  const activeLinkClass = isWhiteText
    ? 'text-white'
    : 'text-primary font-medium';

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
        <div className="flex items-center gap-6">
          {/* Desktop nav links */}
          <nav className="hidden lg:flex items-center gap-5">
            {NAV_LINKS.map((link) => {
              const isActive = pathname === link.href || pathname?.startsWith(link.href + '/');
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`text-sm font-sans tracking-wide transition-colors ${
                    isActive ? activeLinkClass : linkClass
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>

          {/* Mobile hamburger */}
          <div className="relative lg:hidden" ref={menuRef}>
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className={`p-1.5 rounded transition-colors ${
                isWhiteText ? 'text-white/70 hover:text-white' : 'text-secondary hover:text-primary'
              }`}
              aria-label="Navigation menu"
              aria-expanded={menuOpen}
            >
              {menuOpen ? (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              )}
            </button>

            {menuOpen && (
              <div className="absolute right-0 top-full mt-2 w-52 bg-white rounded-lg shadow-lg border border-border-light py-2 z-50">
                {NAV_LINKS.map((link) => {
                  const isActive = pathname === link.href || pathname?.startsWith(link.href + '/');
                  return (
                    <Link
                      key={link.href}
                      href={link.href}
                      className={`block px-4 py-2.5 text-sm transition-colors ${
                        isActive
                          ? 'text-primary font-medium bg-warm'
                          : 'text-secondary hover:text-primary hover:bg-warm/50'
                      }`}
                    >
                      {link.label}
                    </Link>
                  );
                })}
                <div className="border-t border-border-light my-1.5" />
                <Link
                  href="/search"
                  className="block px-4 py-2.5 text-sm text-secondary hover:text-primary hover:bg-warm/50 transition-colors"
                >
                  Search
                </Link>
              </div>
            )}
          </div>

          <UserMenu variant={isWhiteText ? 'hero' : 'default'} />
        </div>
      </div>
    </header>
  );
}
