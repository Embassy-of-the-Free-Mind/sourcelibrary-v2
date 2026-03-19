import { requireAdmin } from '@/lib/auth-helpers';
import Link from 'next/link';

const adminLinks = [
  { href: '/admin/pipeline', label: 'Pipeline' },
  { href: '/admin/processing', label: 'Processing' },
  { href: '/admin/realtime', label: 'Realtime' },
  { href: '/admin/collections', label: 'Collections' },
  { href: '/admin/duplicates', label: 'Duplicates' },
  { href: '/admin/social', label: 'Social' },
  { href: '/admin/email', label: 'Email' },
  { href: '/admin/kdp', label: 'KDP' },
  { href: '/admin/system-map', label: 'System Map' },
];

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAdmin();

  return (
    <>
      <nav style={{
        display: 'flex', gap: 4, padding: '8px 16px',
        background: '#161b22', borderBottom: '1px solid #30363d',
        overflowX: 'auto', fontSize: 13,
      }}>
        {adminLinks.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            style={{
              padding: '4px 10px', borderRadius: 6,
              color: '#c9d1d9', textDecoration: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            {link.label}
          </Link>
        ))}
      </nav>
      {children}
    </>
  );
}
