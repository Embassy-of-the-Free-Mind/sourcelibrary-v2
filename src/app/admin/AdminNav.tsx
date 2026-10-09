'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useRef, useEffect } from 'react';
import { adminSectionsFor, type AdminViewer } from '@/lib/admin-links';

interface NavItem {
  href: string;
  label: string;
  exact?: boolean;
  children?: { href: string; label: string }[];
}

/**
 * Built from src/lib/admin-links.ts, the one list the account menu also reads.
 * The first section (Today) is shown flat; the others are dropdowns, so the bar
 * fits a laptop screen without scrolling. A section of one link is a link.
 */
function navItems(viewer: AdminViewer): NavItem[] {
  const [first, ...rest] = adminSectionsFor(viewer);
  return [
    ...(first?.links ?? []),
    ...rest.map((s) => (s.links.length === 1
      ? s.links[0]
      : { href: s.links[0].href, label: s.label, children: s.links.map(({ href, label }) => ({ href, label })) })),
  ];
}

/**
 * `role` comes from the layout's session; `canSeeSpend` is the server's answer
 * for the allow-listed spend report (#5225), narrower than any role.
 */
export function AdminNav({ role, canSeeSpend }: { role: string | undefined; canSeeSpend: boolean }) {
  const pathname = usePathname();
  const links = navItems({ role, canSeeSpend });
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpenDropdown(null);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function isActive(href: string, children?: NavItem['children'], exact?: boolean) {
    if (children) {
      return children.some(c => pathname.startsWith(c.href));
    }
    if (exact) return pathname === href;
    return pathname.startsWith(href);
  }

  const linkStyle = (active: boolean) => ({
    padding: '4px 10px',
    borderRadius: 6,
    color: active ? '#f0f6fc' : '#8b949e',
    background: active ? '#30363d' : 'transparent',
    textDecoration: 'none' as const,
    whiteSpace: 'nowrap' as const,
    cursor: 'pointer' as const,
  });

  return (
    <nav style={{
      display: 'flex', gap: 4, padding: '8px 16px',
      background: '#161b22', borderBottom: '1px solid #30363d',
      // Wrap, not scroll: a scrolling bar clips its own dropdowns.
      flexWrap: 'wrap', fontSize: 13,
    }}>
      {links.map((link) => {
        if (link.children) {
          const active = isActive(link.href, link.children);
          const isOpen = openDropdown === link.label;
          return (
            <div
              key={link.label}
              ref={isOpen ? dropdownRef : undefined}
              style={{ position: 'relative' }}
            >
              <button
                onClick={() => setOpenDropdown(isOpen ? null : link.label)}
                style={{
                  ...linkStyle(active),
                  border: 'none',
                  font: 'inherit',
                  fontSize: 'inherit',
                }}
              >
                {link.label} ▾
              </button>
              {isOpen && (
                <div style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  marginTop: 4,
                  background: '#1c2128',
                  border: '1px solid #30363d',
                  borderRadius: 8,
                  padding: '4px 0',
                  minWidth: 140,
                  zIndex: 50,
                  boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                }}>
                  {link.children.map((child) => (
                    <Link
                      key={child.href}
                      href={child.href}
                      onClick={() => setOpenDropdown(null)}
                      style={{
                        display: 'block',
                        padding: '6px 14px',
                        color: pathname.startsWith(child.href) ? '#f0f6fc' : '#8b949e',
                        textDecoration: 'none',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {child.label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          );
        }

        const active = isActive(link.href, undefined, link.exact);
        return (
          <Link key={link.href} href={link.href} style={linkStyle(active)}>
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
