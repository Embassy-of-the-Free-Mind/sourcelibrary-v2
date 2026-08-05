import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { auth } from '@/lib/auth';
import { ROLE_LEVEL } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { getTenantContext } from '@/lib/tenant-context';
import { effectiveCatalogRole, normalizeCatalogRole, canEditCatalog } from '@/lib/catalog-role';
import { toLibrarianFeedback, type LibrarianFeedback } from '@/lib/feedback-origin';
import { catalogBasePath, catalogIndexPath } from '@/lib/catalog-nav';
import CatalogEditorNav from '@/components/catalog/CatalogEditorNav';
import BphFeedbackList from '@/components/catalog/BphFeedbackList';

/**
 * Feedback submitted from this partner's catalogue, readable by its librarians.
 *
 * Until now feedback landed in an admin-only inbox, so the people best placed
 * to answer a question about a catalogue record never saw it. This is the
 * librarian-facing half.
 *
 * Two things it is deliberately NOT:
 *
 *  - not `/feedback` (src/app/feedback/page.tsx). That is a public route
 *    calling the admin API, so it errors for everyone but admins.
 *  - not a view of all Source Library feedback. Every read is filtered to this
 *    tenant, using the `tenant_slug` written at capture time.
 *
 * PII (ip, email, user_agent) is stripped by `toLibrarianFeedback` before it
 * reaches the client component.
 */

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Feedback — BPH catalogue',
  robots: { index: false, follow: false },
};

interface Props {
  params: Promise<{ tenant: string }>;
}

export default async function CatalogFeedbackPage({ params }: Props) {
  const { tenant } = await params;
  if (tenant !== 'bph') notFound();

  const ctx = await getTenantContext();
  const base = catalogBasePath(ctx?.source ?? null, tenant);
  const catalogueIndexHref = catalogIndexPath(ctx?.source ?? null, tenant);

  const session = await auth();
  if (!session?.user) {
    redirect(`/${tenant}/login?callbackUrl=${encodeURIComponent(`${base}/feedback`)}`);
  }

  const platformRole = normalizeCatalogRole((session.user as { role?: unknown }).role);
  const role = await effectiveCatalogRole(session.user.email, platformRole, tenant);
  if (!canEditCatalog(role)) {
    redirect(catalogueIndexHref);
  }

  // Read Mongo directly rather than fetching our own API: a server component
  // calling its own route handler doubles the latency and needs the session
  // cookie forwarded by hand. The tenant filter and the PII projection are the
  // same ones the API uses.
  let rows: LibrarianFeedback[] = [];
  let loadError: string | null = null;
  try {
    const db = await getDb();
    const docs = await db
      .collection('feedback')
      .find({ tenant_slug: tenant })
      .sort({ created_at: -1 })
      .limit(200)
      .toArray();
    rows = docs.map(toLibrarianFeedback);
  } catch (error) {
    loadError = error instanceof Error ? error.message : 'Unknown error';
  }

  const unread = rows.filter((r) => !r.read).length;
  const canSeeUntagged = ROLE_LEVEL[role] >= ROLE_LEVEL['editor'];

  return (
    <div className="bg-cream min-h-screen">
      <div className="max-w-3xl mx-auto px-6 py-8">
        <a
          href={catalogueIndexHref}
          className="inline-flex items-center text-sm text-muted hover:text-primary mb-4 transition-colors"
        >
          ← Catalogue
        </a>

        <CatalogEditorNav role={role} current="feedback" basePath={base} />

        <h1 className="text-2xl sm:text-3xl text-primary font-display leading-tight mb-1">
          Feedback
        </h1>
        <p className="text-sm text-muted mb-6">
          {rows.length === 0
            ? 'Nothing yet.'
            : `${rows.length} message${rows.length === 1 ? '' : 's'} from the BPH catalogue` +
              (unread ? `, ${unread} unread` : '') +
              '. Newest first.'}
        </p>

        {loadError ? (
          <div className="p-4 rounded-lg border border-accent-rust/40 bg-accent-rust/5 text-sm text-secondary">
            <p className="font-medium text-accent-rust mb-1">Could not load feedback</p>
            <p className="text-xs text-muted font-mono">{loadError}</p>
          </div>
        ) : rows.length > 0 ? (
          <BphFeedbackList rows={rows} basePath={base} />
        ) : (
          <div className="p-6 rounded-lg border border-border-light bg-white text-center text-muted text-sm">
            <p className="mb-2">
              When someone uses the Feedback button on a BPH catalogue page, it will appear here.
            </p>
            {canSeeUntagged && (
              <p className="text-xs">
                Older messages sent before feedback was tagged by tenant are not shown yet.
                They need the backfill in{' '}
                <code className="text-xs">scripts/maintenance/backfill-feedback-tenant.mjs</code>.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
