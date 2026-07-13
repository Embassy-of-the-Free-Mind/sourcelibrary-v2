'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';

const navLinks = [
  { href: '/platform/dashboard', label: 'Dashboard' },
  { href: '/platform/admin/metrics', label: 'Metrics' },
  { href: '/platform/admin/reading-register', label: 'Reading Register' },
  { href: '/platform/admin/translation-failures', label: 'Translation Failures' },
  { href: '/platform/tenants/new', label: 'New Library' },
];

export function PlatformNav() {
  const pathname = usePathname();
  const { data: session } = useSession();

  const linkStyle = (active: boolean) => ({
    padding: '5px 12px',
    borderRadius: 6,
    color: active ? '#f0f6fc' : '#8b949e',
    background: active ? '#30363d' : 'transparent',
    textDecoration: 'none' as const,
    whiteSpace: 'nowrap' as const,
    fontSize: 13,
    fontWeight: active ? 500 : 400,
  });

  return (
    <nav style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '0 20px',
        height: 52,
        background: '#161b22',
        borderBottom: '1px solid #30363d',
        overflowX: 'auto',
        flexShrink: 0,
      }}>
      {/* Logo */}
      <Link href="/" style={{ display: 'flex', alignItems: 'center', marginRight: 16, flexShrink: 0 }}>
        <Image
          src="/brand/png/logo-compact--white-on-transparent--64h.png"
          alt="Source Library"
          width={200}
          height={0}
          style={{ height: 65, width: 'auto', display: 'block' }}
        />
      </Link>

      {/* Platform badge */}
      <span style={{
        fontSize: 11, fontWeight: 600, color: '#8b949e',
        background: '#21262d', border: '1px solid #30363d',
        borderRadius: 4, padding: '2px 7px', letterSpacing: '0.05em',
        textTransform: 'uppercase', whiteSpace: 'nowrap', marginRight: 12,
      }}>
        Platform
      </span>

      <div style={{ width: 1, height: 16, background: '#30363d', marginRight: 8 }} />

      {navLinks.map((link) => {
        const active = pathname.startsWith(link.href);
        return (
          <Link key={link.href} href={link.href} style={linkStyle(active)}>
            {link.label}
          </Link>
        );
      })}

      {/* Right side */}
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12, paddingLeft: 16 }}>
        <span style={{ fontSize: 12, color: '#8b949e', whiteSpace: 'nowrap' }}>
          {session?.user?.email}
        </span>
        <button
          onClick={() => signOut({ callbackUrl: '/' })}
          style={{
            padding: '5px 12px', borderRadius: 6, background: 'transparent',
            color: '#8b949e', border: '1px solid #30363d', fontSize: 12,
            cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
          }}
        >
          Sign out
        </button>
      </div>
    </nav>
  );
}
