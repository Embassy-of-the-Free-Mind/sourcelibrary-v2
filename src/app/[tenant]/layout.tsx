import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { auth } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { activatePendingMembership } from '@/lib/memberships';
import { TenantSessionUpdater } from '@/components/auth/TenantSessionUpdater';

export default async function TenantLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ tenant: string }>;
}) {
  const { tenant: slug } = await params;
  const h = await headers();
  const tenantId = h.get('x-tenant-id');

  // Middleware should always set x-tenant-id for [tenant] paths.
  // If missing, the request bypassed the proxy — treat as not found.
  if (!tenantId) notFound();

  const db = await getDb();
  const tenant = await db.collection('tenants').findOne({ id: tenantId });

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

  // Activate any pending membership for the signed-in user.
  // This is idempotent — updateOne with status:'pending' filter is a no-op if already active.
  const session = await auth();
  if (session?.user?.email) {
    const pending = await db.collection('memberships').findOne({
      email: session.user.email.toLowerCase(),
      tenantId,
      status: 'pending',
    });
    if (pending) {
      await activatePendingMembership({
        db,
        email: session.user.email,
        tenantId,
        userId: (session.user as any).id,
      });
    }
  }

  return (
    <>
      {/* Trigger JWT update with tenant context for role resolution */}
      <TenantSessionUpdater tenantSlug={slug} />
      {children}
    </>
  );
}
