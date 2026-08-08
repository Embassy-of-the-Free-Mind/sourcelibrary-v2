import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { auth } from '@/lib/auth';
import { ROLE_LEVEL } from '@/lib/auth';
import { effectiveCatalogRole, normalizeCatalogRole } from '@/lib/catalog-role';
import { getDb } from '@/lib/mongodb';
import { supabaseAdmin } from '@/lib/supabase';
import { memorixAliasesFor } from '@/lib/bph-cataloguer-identity';
import { fetchRevisionsByEditor, fieldLabel } from '@/lib/bph-catalogue-activity';
import { getTenantContext } from '@/lib/tenant-context';
import { catalogBasePath, catalogIndexPath } from '@/lib/catalog-nav';

/**
 * The librarian's workspace: your work, what needs attention, what changed.
 *
 * Built for the people who keep this catalogue rather than the people who read
 * it, and it answers the three questions they actually have:
 *
 *   1. IS MY WORK HELD AND ATTRIBUTED? Eight cataloguers have been describing
 *      this collection since 2017 and the site showed no sign any of them
 *      existed. Nothing else here matters if that stays true.
 *   2. WHAT NEEDS ME? A catalogue of 29,879 records has no natural surface for
 *      "the 86 manuscripts on your shelves that nobody has ever titled".
 *   3. WHAT HAS BEEN DONE TO IT? Automation edits this catalogue. A librarian
 *      should be able to read what it did, in plain words, without asking.
 *
 * Editor-only and fully dynamic (reads the session), so nothing here is cached
 * for anyone else.
 */

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Catalogue workspace — BPH',
  robots: { index: false, follow: false },
};

interface Props {
  params: Promise<{ tenant: string }>;
}

interface WorklistRow {
  category: string;
  label: string;
  detail: string;
  n: number;
  samples: Array<{ ubn: string | null; id: string; shelf_mark: string | null; hint: string | null }>;
}

interface RevisionRow {
  id: string;
  ubn: string;
  change_type: string;
  field_changes: Record<string, { from?: unknown; to?: unknown; source?: string }>;
  editor_email: string;
  applied_at: string;
  note: string | null;
}


function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** "19,942" reads better than 19942 to someone counting their own records. */
const n = (x: number | null | undefined) => (x ?? 0).toLocaleString('en-GB');

export default async function CatalogueWorkspacePage({ params }: Props) {
  const { tenant } = await params;
  if (tenant !== 'bph') notFound();

  const session = await auth();
  if (!session?.user) redirect(`/${tenant}/login?callbackUrl=${encodeURIComponent(`${catalogBasePath((await getTenantContext())?.source ?? null, tenant)}/workspace`)}`);

  const platformRole = normalizeCatalogRole((session.user as { role?: unknown }).role);
  const tenantRole = await effectiveCatalogRole(session.user.email, platformRole, tenant);
  const role = ROLE_LEVEL[platformRole] >= ROLE_LEVEL[tenantRole] ? platformRole : tenantRole;
  const tenantSource = (await getTenantContext())?.source ?? null;
  const catalogueIndexHref = catalogIndexPath(tenantSource, tenant);
  const navBasePath = catalogBasePath(tenantSource, tenant);
  if (ROLE_LEVEL[role] < ROLE_LEVEL['editor']) redirect(catalogueIndexHref);

  const email = (session.user.email || '').toLowerCase();
  const aliases = memorixAliasesFor(email);

  if (!supabaseAdmin) notFound();

  // bph_works_revisions is RLS-protected; read with the service-role client
  // (this page is already editor-gated above).
  const [myRevisions, integrityRes, memorixRes] = await Promise.all([
    fetchRevisionsByEditor(email, 40),
    supabaseAdmin
      .from('bph_works_integrity')
      .select('last_checked')
      .order('last_checked', { ascending: false })
      .limit(1),
    aliases.length
      ? supabaseAdmin
          .from('bph_works')
          .select('modified_time', { count: 'exact' })
          .in('modified_by_email', aliases)
          .order('modified_time', { ascending: true })
          .limit(1)
      : Promise.resolve({ data: null, count: 0, error: null }),
  ]);

  const lastChecked = (integrityRes.data as { last_checked: string }[] | null)?.[0]?.last_checked || null;

  const memorixCount = (memorixRes as { count?: number | null }).count || 0;
  const memorixFirst = (memorixRes as { data?: { modified_time: string }[] | null }).data?.[0]?.modified_time || null;
  let memorixLast: string | null = null;
  if (memorixCount > 0 && aliases.length) {
    const { data } = await supabaseAdmin
      .from('bph_works')
      .select('modified_time')
      .in('modified_by_email', aliases)
      .order('modified_time', { ascending: false })
      .limit(1);
    memorixLast = (data as { modified_time: string }[] | null)?.[0]?.modified_time || null;
  }

  return (
    <div className="bg-cream min-h-screen">
      <div className="max-w-[1500px] mx-auto px-6 py-8">
        <a href={catalogueIndexHref} className="inline-flex items-center text-sm text-muted hover:text-primary mb-4 transition-colors">
          ← Back to catalogue
        </a>

        <h1 className="text-2xl sm:text-3xl text-primary font-display leading-tight mb-1">
          Catalogue workspace
        </h1>
        <p className="text-sm text-muted mb-8">
          Signed in as {session.user.email}
          {lastChecked && (
            <>
              {' · '}
              <span title="Every record is fingerprinted nightly; changes that no revision or known automation explains raise an alert.">
                all changes accounted for as of {formatDate(lastChecked)}
              </span>
            </>
          )}
        </p>

        {/* 1. Your work — the reason this page exists. */}
        <section className="mb-10">
          <h2 className="text-lg text-primary font-display mb-3">Your work</h2>
          <div className="border border-stone-200 bg-white p-5">
            {memorixCount > 0 ? (
              <p className="text-primary mb-3">
                <strong>{n(memorixCount)} records</strong> in this catalogue were last catalogued by you
                {memorixFirst && memorixLast && (
                  <>, between {formatDate(memorixFirst)} and {formatDate(memorixLast)}</>
                )}
                .
              </p>
            ) : (
              <p className="text-muted mb-3">
                No earlier cataloguing is linked to this account. If you catalogued under a different
                address, tell us and we can connect it.
              </p>
            )}
            <p className="text-primary">
              <strong>{n(myRevisions.length)}{myRevisions.length === 40 ? '+' : ''} changes</strong> made
              here on Source Library, each kept with the source you cited. Nothing is ever overwritten:
              corrections are recorded as new entries, so the whole history stays readable.
            </p>

            {myRevisions.length > 0 && (
              <ul className="mt-4 divide-y divide-stone-100 border-t border-stone-100">
                {myRevisions.slice(0, 10).map((r) => {
                  const fields = Object.keys(r.field_changes || {});
                  const source = Object.values(r.field_changes || {}).find((c) => c?.source)?.source;
                  return (
                    <li key={r.id} className="py-2.5 text-sm">
                      <a href={`${navBasePath}/${encodeURIComponent(r.ubn)}`} className="text-accent-rust hover:underline font-medium">
                        {r.ubn}
                      </a>
                      <span className="text-muted"> · {formatDate(r.applied_at)}</span>
                      <div className="text-primary">
                        {r.change_type === 'create' ? 'Created this record' : fields.map(fieldLabel).join(', ')}
                        {source && <span className="text-muted"> — cited: {source}</span>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>

        {/* "Needs your attention" moved to Review (it is a queue of decisions,
            not a report about you) and "Recent changes" to its own Changes
            page (it records the whole catalogue, not your work). Both are
            linked from the top bar. */}
        <p className="text-sm text-muted">
          Records needing a librarian&rsquo;s decision are under{' '}
          <a href={`${navBasePath}/review?tab=attention`} className="text-accent-rust hover:underline">
            Review → Needs attention
          </a>
          . Every edit to the catalogue is under{' '}
          <a href={`${navBasePath}/changes`} className="text-accent-rust hover:underline">
            Changes
          </a>
          .
        </p>

      </div>
    </div>
  );
}
