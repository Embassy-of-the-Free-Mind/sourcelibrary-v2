'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useRef, useEffect } from 'react';

interface NavItem {
  href: string;
  label: string;
  exact?: boolean;
  children?: { href: string; label: string }[];
}

const adminLinks: NavItem[] = [
  { href: '/admin', label: 'Dashboard', exact: true },
  { href: '/admin/canon', label: 'Canon' },
  { href: '/admin/pipeline', label: 'Pipeline' },
  { href: '/admin/processing', label: 'Processing' },
  { href: '/admin/realtime', label: 'Realtime' },
  { href: '/admin/collections', label: 'Collections' },
  { href: '/admin/collection-proposals', label: 'Proposals' },
  { href: '/admin/duplicates', label: 'Duplicates' },
  { href: '/admin/catalog-coverage', label: 'Catalogue' },
  { href: '/admin/r2-coverage', label: 'R2 Storage' },
  {
    href: '/admin/outreach',
    label: 'Outreach',
    children: [
      { href: '/admin/social', label: 'Social' },
      { href: '/admin/marketing', label: 'Marketing' },
      { href: '/admin/email', label: 'Email' },
    ],
  },
  { href: '/admin/kdp', label: 'Publishing' },
  { href: '/admin/users', label: 'Users' },
  { href: '/admin/introductions', label: 'Introductions' },
  { href: '/admin/members', label: 'Members' },
  { href: '/admin/api-keys', label: 'API Keys' },
  { href: '/analytics', label: 'Analytics' },
  { href: '/admin/bots', label: 'Bots' },
  { href: '/admin/errors', label: 'Errors' },
  { href: '/admin/system-map', label: 'System Map' },
];

export function AdminNav() {
  const pathname = usePathname();
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
      overflowX: 'auto', fontSize: 13,
    }}>
      {adminLinks.map((link) => {
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
