import { notFound, redirect } from 'next/navigation';
import { headers } from 'next/headers';
import type { Metadata } from 'next';
import { supabase } from '@/lib/supabase';
import { auth } from '@/lib/auth';
import { ROLE_LEVEL, type Role } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { EDITABLE_BPH_FIELDS } from '@/lib/bph-catalog';
import BphWorkEditForm from '@/components/catalog/BphWorkEditForm';

/**
 * BPH catalog entry editor.
 *
 * Editor-only in PR-C: Save applies the change directly via
 * applyWorkRevision. PR-D extends this to contributors — same form, but
 * Save submits to bph_works_pending_changes for editor review.
 *
 * Routes from /embed/[tenant]/catalog/[ubn]/edit (mounted on tenant
 * subdomains via the proxy rewrite). Currently BPH-only — generic
 * unified-catalogue tenants will get their own editor in a follow-up.
 *
 * Issue #1877 — Phase 1.
 */

export const metadata: Metadata = {
  title: 'Edit catalogue entry — BPH',
  robots: { index: false, follow: false },
};

interface Props {
  params: Promise<{ tenant: string; ubn: string }>;
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

export default async function EditCatalogEntryPage({ params }: Props) {
  const { tenant, ubn } = await params;

  // BPH-only in Phase 1. Other tenants get a notFound until we extend.
  if (tenant !== 'bph') notFound();

  const session = await auth();
  if (!session?.user) {
    // Same proxy-rewritten path as the public catalog detail page, so the
    // post-login callback returns the user here.
    redirect(`/${tenant}/login?callbackUrl=/catalog/${encodeURIComponent(ubn)}/edit`);
  }

  // Resolve the user's tenant-scoped role (a platform-level reader can still
  // be a tenant editor). Platform role wins when higher.
  const platformRole = normalizeRole((session.user as { role?: unknown }).role);
  const tenantRole = await effectiveTenantRole(session.user.email, tenant);
  const effectiveRole = ROLE_LEVEL[platformRole] >= ROLE_LEVEL[tenantRole] ? platformRole : tenantRole;

  // Contributor and above can reach this page. The API routes Save through
  // applyWorkRevision for editor+ (direct apply) and into
  // bph_works_pending_changes for contributor (queued for editor review).
  // The form learns its mode from the `mode` prop below.
  if (ROLE_LEVEL[effectiveRole] < ROLE_LEVEL['contributor']) {
    const h = await headers();
    const referer = h.get('referer') || `/catalog/${encodeURIComponent(ubn)}`;
    redirect(referer);
  }
  const formMode: 'editor' | 'contributor' =
    ROLE_LEVEL[effectiveRole] >= ROLE_LEVEL['editor'] ? 'editor' : 'contributor';

  // Fetch the current row using exactly the whitelisted editable columns.
  // The detail page exists at /catalog/[ubn] — if we can't find the row,
  // surface the same notFound() rather than a partial form.
  //
  // If the author-authority columns haven't been added yet (migration
  // 20260522000000 not run on this environment), retry without them. The
  // form silently shows empty author-authority fields, and the picker still
  // works — the save would fail at write time with the same error, which
  // is the right behaviour (don't pretend to save what we can't write).
  const cols = ['ubn', ...EDITABLE_BPH_FIELDS, 'field_provenance', 'sl_book_id'].join(', ');
  const authorityCols = ['author_entity_id', 'author_canonical_name', 'author_wikidata_qid'];
  const fallbackCols = ['ubn', ...EDITABLE_BPH_FIELDS.filter((c) => !authorityCols.includes(c)), 'field_provenance', 'sl_book_id'].join(', ');
  let { data, error } = await supabase
    .from('bph_works')
    .select(cols)
    .eq('ubn', ubn)
    .maybeSingle();
  if (error) {
    const msg = (error.message || '').toLowerCase();
    if (msg.includes('does not exist') || msg.includes('could not find')) {
      const retry = await supabase.from('bph_works').select(fallbackCols).eq('ubn', ubn).maybeSingle();
      data = retry.data;
      error = retry.error;
    }
  }

  if (error || !data) notFound();

  const work = data as unknown as Record<string, unknown> & { ubn: string };

  return (
    <div className="bg-cream min-h-screen">
      <div className="max-w-2xl mx-auto px-6 py-8">
        <a
          href={`/catalog/${encodeURIComponent(ubn)}`}
          className="inline-flex items-center text-sm text-muted hover:text-primary mb-4 transition-colors"
        >
          ← Back to catalogue entry
        </a>
        <h1 className="text-2xl sm:text-3xl text-primary font-display leading-tight mb-1">
          Edit catalogue entry
        </h1>
        <p className="text-sm text-muted mb-6">
          UBN {work.ubn} · Signed in as {session.user.email}
        </p>

        <BphWorkEditForm
          ubn={work.ubn}
          tenant={tenant}
          initial={work}
          editorEmail={session.user.email || ''}
          mode={formMode}
        />
      </div>
    </div>
  );
}
