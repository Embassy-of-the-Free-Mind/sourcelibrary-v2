import CatalogFeedbackButton from '@/components/catalog/CatalogFeedbackButton';
import CatalogTopBar from '@/components/catalog/CatalogTopBar';
import { auth } from '@/lib/auth';
import { getTenantContext } from '@/lib/tenant-context';
import { catalogBasePath, catalogIndexPath } from '@/lib/catalog-nav';
import {
  effectiveCatalogRole,
  normalizeCatalogRole,
  canEditCatalog,
  canReviewCatalog,
} from '@/lib/catalog-role';
import { getInboxCounts, EMPTY_INBOX_COUNTS } from '@/lib/catalog-inbox';

/**
 * Layout for the BPH catalogue pages (/embed/[tenant]/catalog/*).
 *
 * Owns two pieces of chrome so no individual page has to remember them:
 *
 *  - the top bar, which previously lived on only two of the seven pages, so a
 *    librarian inside Review queue or Team had no way back but the browser
 *    button.
 *  - the floating Feedback button, across every catalogue page so cataloguers
 *    can report from wherever they are. Self-hides for signed-out visitors.
 *
 * The bar renders nothing for readers, so this stays invisible to the public
 * embed even though the layout wraps it.
 */
export default async function CatalogLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ tenant: string }>;
}) {
  const { tenant } = await params;
  const session = await auth();

  let role = normalizeCatalogRole(null);
  if (session?.user) {
    role = await effectiveCatalogRole(
      session.user.email,
      normalizeCatalogRole((session.user as { role?: unknown }).role),
      tenant
    );
  }

  const showBar = canEditCatalog(role);
  const source = (await getTenantContext())?.source ?? null;

  // Only pay for the counts when there is a bar to put them on.
  const counts = showBar ? await getInboxCounts(tenant) : EMPTY_INBOX_COUNTS;

  return (
    <>
      {showBar && (
        <CatalogTopBar
          canReview={canReviewCatalog(role)}
          basePath={catalogBasePath(source, tenant)}
          indexPath={catalogIndexPath(source, tenant)}
          counts={counts}
          containerClass="max-w-[1500px]"
        />
      )}
      {children}
      <CatalogFeedbackButton />
    </>
  );
}
