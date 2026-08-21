import { notFound, redirect } from 'next/navigation';
import { headers } from 'next/headers';
import type { Metadata } from 'next';
import { supabase } from '@/lib/supabase';
import { auth } from '@/lib/auth';
import { ROLE_LEVEL } from '@/lib/auth';
import { effectiveCatalogRole, normalizeCatalogRole } from '@/lib/catalog-role';
import { getDb } from '@/lib/mongodb';
import { EDITABLE_BPH_FIELDS } from '@/lib/bph-catalog';
import { catalogKeyColumn } from '@/lib/bph-catalog-key';
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
  const platformRole = normalizeCatalogRole((session.user as { role?: unknown }).role);
  const tenantRole = await effectiveCatalogRole(session.user.email, platformRole, tenant);
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
  // If columns from a migration that hasn't run yet are requested (e.g.
  // author-authority from 20260522000000, or collection/impressum_original
  // from 20260624000000), retry without them. The form silently shows those
  // fields empty, and a save would fail at write time with the same error —
  // the right behaviour (don't pretend to save what we can't write).
  // `record_type` and `full_title` are newer whitelist entries; drop them too
  // if their migration hasn't run on this environment.
  const maybeMissingCols = ['author_entity_id', 'author_canonical_name', 'author_wikidata_qid', 'collection', 'impressum_original', 'contributors', 'exhibition_history', 'record_type', 'full_title'];
  const cols = ['ubn', 'uuid', ...EDITABLE_BPH_FIELDS, 'field_provenance', 'sl_book_id'].join(', ');
  const fallbackCols = ['ubn', 'uuid', ...EDITABLE_BPH_FIELDS.filter((c) => !maybeMissingCols.includes(c)), 'field_provenance', 'sl_book_id'].join(', ');
  // Address by UBN or, for the 2,012 records that have none, by uuid — the same
  // shape rule the detail route uses. This page queried `ubn` unconditionally
  // until 2026-08-13, so every manuscript and photograph 404'd here even after
  // #3654 made them viewable: "It is not possible to click on titles with a
  // shelf mark M (+number) […] to edit them" (José Bouman, 2026-07-31).
  const keyCol = catalogKeyColumn(ubn);
  let { data, error } = await supabase
    .from('bph_works')
    .select(cols)
    .eq(keyCol, ubn)
    .maybeSingle();
  if (error) {
    const msg = (error.message || '').toLowerCase();
    if (msg.includes('does not exist') || msg.includes('could not find')) {
      const retry = await supabase.from('bph_works').select(fallbackCols).eq(keyCol, ubn).maybeSingle();
      data = retry.data;
      error = retry.error;
    }
  }

  if (error || !data) notFound();

  const work = data as unknown as Record<string, unknown> & { ubn: string | null; uuid: string | null; shelf_mark?: string | null };
  // The key the form saves back through: UBN when the record has one, else the
  // uuid. Never null — a row with neither key is unaddressable, and production
  // has zero of those (verified across all 29,881 rows, 2026-08-13).
  const workKey = work.ubn || work.uuid || ubn;

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
          {/* Manuscripts and photographs have no UBN — naming one would be a
              lie, and the shelf mark is what a librarian actually uses to find
              the object on the shelf. */}
          {work.ubn ? `UBN ${work.ubn}` : `Shelf mark ${work.shelf_mark || '—'} · no UBN`} · Signed in as {session.user.email}
        </p>

        <BphWorkEditForm
          ubn={workKey}
          tenant={tenant}
          initial={work}
          editorEmail={session.user.email || ''}
          mode={formMode}
        />
      </div>
    </div>
  );
}
