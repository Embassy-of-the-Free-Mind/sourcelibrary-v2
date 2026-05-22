import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { supabase } from '@/lib/supabase';
import { auth } from '@/lib/auth';
import { ROLE_LEVEL, type Role } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import PendingChangesInbox from '@/components/catalog/PendingChangesInbox';

/**
 * BPH catalog pending-changes review inbox.
 *
 * Editor-only — lists every pending submission across the tenant's
 * catalog, newest first, with the diff inline. Approve calls
 * applyWorkRevision; reject just stamps status='rejected' and a note.
 *
 * Issue #1877 — Phase 1, PR-D.
 */

export const metadata: Metadata = {
  title: 'Catalogue review — BPH',
  robots: { index: false, follow: false },
};

interface Props {
  params: Promise<{ tenant: string }>;
}

function normalizeRoleLocal(role: unknown): Role {
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

async function tenantRole(email: string | null | undefined, tenantSlug: string): Promise<Role> {
  if (!email) return 'reader';
  try {
    const db = await getDb();
    const tenant = await db.collection('tenants').findOne({ slug: tenantSlug, status: { $ne: 'deleted' } });
    if (!tenant) return 'reader';
    const m = await db.collection('memberships').findOne({
      email: email.toLowerCase(),
      tenantId: tenant.id,
      status: 'active',
    });
    return normalizeRoleLocal(m?.role);
  } catch {
    return 'reader';
  }
}

export interface PendingRow {
  id: string;
  ubn: string | null;
  change_type: string;
  proposer_email: string;
  field_changes: Record<string, { from?: unknown; to: unknown; source?: string; evidence?: string }>;
  note: string | null;
  status: string;
  created_at: string;
}

export default async function CatalogReviewPage({ params }: Props) {
  const { tenant } = await params;
  if (tenant !== 'bph') notFound();

  const session = await auth();
  if (!session?.user) {
    redirect(`/${tenant}/login?callbackUrl=/catalog/review`);
  }

  const platformRole = normalizeRoleLocal((session.user as { role?: unknown }).role);
  const role = ROLE_LEVEL[platformRole] >= ROLE_LEVEL['editor']
    ? platformRole
    : await tenantRole(session.user.email, tenant);

  if (ROLE_LEVEL[role] < ROLE_LEVEL['editor']) {
    // Contributors don't have an inbox in v1; they see status on the
    // catalog detail page via their own pending list (deferred follow-up).
    // Bounce them back rather than render an empty page that looks like
    // they're authorised.
    redirect(`/catalog`);
  }

  // Fetch pending rows + titles for each UBN in one go. The bph_works
  // join via Supabase's PostgREST `select` keeps this to a single round trip
  // even though pending rows can include creates with no UBN yet.
  const { data, error } = await supabase
    .from('bph_works_pending_changes')
    .select('id, ubn, change_type, proposer_email, field_changes, note, status, created_at')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) {
    // The table doesn't exist yet (migrations not applied) — render a
    // helpful empty state instead of crashing.
    return (
      <div className="bg-cream min-h-screen">
        <div className="max-w-3xl mx-auto px-6 py-8">
          <h1 className="text-2xl text-primary font-display mb-3">Catalogue review</h1>
          <div className="p-4 rounded-lg border border-accent-rust/40 bg-accent-rust/5 text-sm text-secondary">
            <p className="font-medium text-accent-rust mb-1">Pending-changes table not initialised</p>
            <p>
              The <code className="text-xs">bph_works_pending_changes</code> table doesn&rsquo;t exist on this environment yet. Apply{' '}
              <code className="text-xs">scripts/migration/add-bph-works-pending-changes.sql</code> and reload.
            </p>
            <p className="text-xs text-muted mt-2 font-mono">{error.message}</p>
          </div>
        </div>
      </div>
    );
  }

  const rows = (data || []) as PendingRow[];

  // Fetch the current title for each UBN so the inbox row reads as a real
  // catalog entry, not a UUID. Skip the lookup for creates with no UBN.
  const ubns = Array.from(new Set(rows.map(r => r.ubn).filter((u): u is string => !!u)));
  const titlesByUbn = new Map<string, string>();
  if (ubns.length > 0) {
    const { data: works } = await supabase
      .from('bph_works')
      .select('ubn, title, parallel_title, uniform_title')
      .in('ubn', ubns);
    for (const w of (works || []) as Array<{ ubn: string; title: string | null; parallel_title: string | null; uniform_title: string | null }>) {
      titlesByUbn.set(w.ubn, w.title || w.parallel_title || w.uniform_title || `(untitled — UBN ${w.ubn})`);
    }
  }

  return (
    <div className="bg-cream min-h-screen">
      <div className="max-w-3xl mx-auto px-6 py-8">
        <a
          href="/catalog"
          className="inline-flex items-center text-sm text-muted hover:text-primary mb-4 transition-colors"
        >
          ← Catalogue
        </a>
        <h1 className="text-2xl sm:text-3xl text-primary font-display leading-tight mb-1">
          Catalogue review
        </h1>
        <p className="text-sm text-muted mb-6">
          {rows.length === 0
            ? 'No pending submissions.'
            : `${rows.length} pending submission${rows.length === 1 ? '' : 's'}, oldest at the bottom.`}
        </p>

        {rows.length > 0 ? (
          <PendingChangesInbox tenant={tenant} rows={rows} titlesByUbn={Object.fromEntries(titlesByUbn)} />
        ) : (
          <div className="p-6 rounded-lg border border-border-light bg-white text-center text-muted text-sm">
            When a contributor submits an edit, it will appear here for approval.
          </div>
        )}
      </div>
    </div>
  );
}
