import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { auth } from '@/lib/auth';
import { ROLE_LEVEL, type Role } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { suggestNewUbn } from '@/lib/bph-catalog';
import BphWorkEditForm from '@/components/catalog/BphWorkEditForm';

/**
 * Create a new BPH catalogue record.
 *
 * Editor-only. Renders the same form as the editor, in 'create' mode: it
 * shows a UBN field (pre-filled with the next free id from the reserved
 * 33,000+ range — see suggestNewUbn), starts every field blank, and POSTs to
 * /api/[tenant]/catalog/create. BPH-only in Phase 1.
 *
 * Issue #1877.
 */

export const metadata: Metadata = {
  title: 'New catalogue entry — BPH',
  robots: { index: false, follow: false },
};

interface Props {
  params: Promise<{ tenant: string }>;
}

function normalizeRole(role: unknown): Role {
  if (
    role === 'superadmin' ||
    role === 'admin' ||
    role === 'editor' ||
    role === 'contributor' ||
    role === 'reader'
  ) {
    return role;
  }
  if (role === 'inner_circle' || role === 'curator') return 'editor';
  return 'reader';
}

async function effectiveTenantRole(email: string | null | undefined, tenantSlug: string): Promise<Role> {
  if (!email) return 'reader';
  try {
    const db = await getDb();
    const tenant = await db.collection('tenants').findOne({ slug: tenantSlug, status: { $ne: 'deleted' } });
    if (!tenant) return 'reader';
    const membership = await db.collection('memberships').findOne({
      email: email.toLowerCase(),
      tenantId: tenant.id,
      status: 'active',
    });
    return normalizeRole(membership?.role);
  } catch {
    return 'reader';
  }
}

export default async function NewCatalogEntryPage({ params }: Props) {
  const { tenant } = await params;
  if (tenant !== 'bph') notFound();

  const session = await auth();
  if (!session?.user) {
    redirect(`/${tenant}/login?callbackUrl=/catalog/new`);
  }

  const platformRole = normalizeRole((session.user as { role?: unknown }).role);
  const tenantRole = await effectiveTenantRole(session.user.email, tenant);
  const effectiveRole = ROLE_LEVEL[platformRole] >= ROLE_LEVEL[tenantRole] ? platformRole : tenantRole;

  // Creating new records is editor+ only (see the create API route).
  if (ROLE_LEVEL[effectiveRole] < ROLE_LEVEL['editor']) {
    redirect('/catalog');
  }

  const suggestedUbn = await suggestNewUbn();

  return (
    <div className="bg-cream min-h-screen">
      <div className="max-w-2xl mx-auto px-6 py-8">
        <a
          href="/catalog"
          className="inline-flex items-center text-sm text-muted hover:text-primary mb-4 transition-colors"
        >
          ← Back to catalogue
        </a>
        <h1 className="text-2xl sm:text-3xl text-primary font-display leading-tight mb-1">
          New catalogue entry
        </h1>
        <p className="text-sm text-muted mb-6">
          Adding a record · Signed in as {session.user.email} ·{' '}
          <a href="/catalog/help" className="text-accent-rust hover:underline">
            How does this work?
          </a>
        </p>

        <BphWorkEditForm
          ubn={suggestedUbn}
          tenant={tenant}
          initial={{}}
          editorEmail={session.user.email || ''}
          mode="create"
          suggestedUbn={suggestedUbn}
        />
      </div>
    </div>
  );
}
