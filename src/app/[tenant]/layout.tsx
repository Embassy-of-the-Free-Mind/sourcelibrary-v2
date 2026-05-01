import { notFound } from 'next/navigation';
import { getDb } from '@/lib/mongodb';
import { TenantSessionUpdater } from '@/components/auth/TenantSessionUpdater';
import { resolveTenantId } from '@/lib/tenant-context';
import { cache } from 'react';
import EmbedResizeReporter from '@/components/embed/EmbedResizeReporter';
import { TenantLayoutWrapper } from '@/components/tenant/TenantLayoutWrapper';

// Cached tenant lookup - avoid DB hit on every page under the tenant layout
const getCachedTenant = cache(async (slug: string) => {
  const db = await getDb();
  const tenantId = await resolveTenantId(slug);
  if (!tenantId) return null;
  return db.collection('tenants').findOne({ id: tenantId });
});

// Routes that exist at root level and should never match [tenant].
// Without this, Next.js routes /favorites to [tenant]=favorites,
// the DB lookup fails, and notFound() fires instead of the root page.
const ROOT_ONLY_ROUTES = new Set([
  'favorites', 'reading-history', 'languages', 'timeline',
  'topics', 'categories', 'about', 'blog', 'connect', 'contribute',
  'developers', 'libraries', 'privacy', 'terms', 'support',
  'roadmap', 'status', 'brand', 'press-release', 'founding-donors',
  'ficino-society', 'feedback', 'unauthorized', 'account',
  'auth', 'platform', 'admin', 'experiments', 'data',
]);

export default async function TenantLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ tenant: string }>;
}) {
  const { tenant: slug } = await params;

  // Skip tenant lookup for known root-only routes
  if (ROOT_ONLY_ROUTES.has(slug)) notFound();

  // Use cached lookup instead of headers() to preserve ISR for child pages
  const tenant = await getCachedTenant(slug);
  if (!tenant) notFound();

  if (tenant.status === 'suspended') {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center',
        justifyContent: 'center', background: '#0d1117', color: '#e6edf3',
        fontFamily: 'system-ui, sans-serif',
      }}>
        <div style={{
          maxWidth: 420, textAlign: 'center', padding: '48px 32px',
          background: '#161b22', border: '1px solid #30363d', borderRadius: 12,
          margin: '0 16px',
        }}>
          <div style={{ fontSize: 32, marginBottom: 16 }}>⚠️</div>
          <h1 style={{ fontSize: 20, fontWeight: 600, color: '#f0f6fc', margin: '0 0 8px' }}>
            Library Suspended
          </h1>
          <p style={{ fontSize: 14, color: '#8b949e', margin: 0, lineHeight: 1.6 }}>
            <strong style={{ color: '#e6edf3' }}>{tenant.name}</strong> is temporarily
            unavailable. Please contact your library administrator.
          </p>
        </div>
      </div>
    );
  }

  // Membership activation moved to TenantSessionUpdater (client component)
  // to avoid calling auth() which uses headers() and forces dynamic rendering.

  return (
    <>
      {/* Trigger JWT update with tenant context for role resolution + activate pending memberships */}
      <TenantSessionUpdater tenantSlug={slug} />
      <EmbedResizeReporter />
      <TenantLayoutWrapper>{children}</TenantLayoutWrapper>
    </>
  );
}
