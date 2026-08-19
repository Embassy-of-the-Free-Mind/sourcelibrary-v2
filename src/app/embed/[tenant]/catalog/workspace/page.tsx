import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { auth } from '@/lib/auth';
import { ROLE_LEVEL } from '@/lib/auth';
import { effectiveCatalogRole, normalizeCatalogRole } from '@/lib/catalog-role';
import { getDb } from '@/lib/mongodb';
import { supabaseAdmin } from '@/lib/supabase';
import { memorixAliasesFor } from '@/lib/bph-cataloguer-identity';

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
  // `uuid` is the linkable key when `ubn` is null; `id` is a different uuid and
  // is carried for debugging only. Optional because the pending_contributions
  // category comes from bph_works_pending_changes, which has no uuid column —
  // its rows always carry a ubn, so they never need the fallback.
  samples: Array<{ ubn: string | null; uuid?: string | null; id: string; shelf_mark: string | null; hint: string | null }>;
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

const FIELD_LABELS: Record<string, string> = {
  state_shelf_mark: 'State Collection shelf mark',
  shelf_mark: 'Shelf mark',
  present_location: 'Present location',
  internal_remarks: 'Internal remarks',
  exhibition_history: 'Exhibition history',
  impressum_original: 'Original impressum',
  bibliographic_format: 'Format',
  number_of_copies: 'Copies held',
  ustc_sn: 'USTC number',
  ia_identifier: 'Internet Archive id',
};
const fieldLabel = (f: string) =>
  FIELD_LABELS[f] || f.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

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
  if (!session?.user) redirect(`/${tenant}/login?callbackUrl=/catalog/workspace`);

  const platformRole = normalizeCatalogRole((session.user as { role?: unknown }).role);
  const tenantRole = await effectiveCatalogRole(session.user.email, platformRole, tenant);
  const role = ROLE_LEVEL[platformRole] >= ROLE_LEVEL[tenantRole] ? platformRole : tenantRole;
  if (ROLE_LEVEL[role] < ROLE_LEVEL['editor']) redirect('/catalog');

  const email = (session.user.email || '').toLowerCase();
  const aliases = memorixAliasesFor(email);

  if (!supabaseAdmin) notFound();

  // bph_works_revisions is RLS-protected; read with the service-role client
  // (this page is already editor-gated above).
  const [worklistRes, myRevisionsRes, recentRes, integrityRes, memorixRes] = await Promise.all([
    supabaseAdmin.rpc('bph_catalogue_worklist'),
    supabaseAdmin
      .from('bph_works_revisions')
      .select('id, ubn, change_type, field_changes, editor_email, applied_at, note')
      .eq('editor_email', email)
      .order('applied_at', { ascending: false })
      .limit(40),
    supabaseAdmin
      .from('bph_works_revisions')
      .select('id, ubn, change_type, field_changes, editor_email, applied_at, note')
      .order('applied_at', { ascending: false })
      .limit(25),
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

  const worklist = ((worklistRes.data as WorklistRow[] | null) || []).filter((w) => w.n > 0);
  const myRevisions = (myRevisionsRes.data as RevisionRow[] | null) || [];
  const recent = (recentRes.data as RevisionRow[] | null) || [];
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

  const totalAttention = worklist.reduce((s, w) => s + Number(w.n), 0);

  return (
    <div className="bg-cream min-h-screen">
      <div className="max-w-3xl mx-auto px-6 py-8">
        <a href="/catalog" className="inline-flex items-center text-sm text-muted hover:text-primary mb-4 transition-colors">
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
                      <a href={`/catalog/${encodeURIComponent(r.ubn)}`} className="text-accent-rust hover:underline font-medium">
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

        {/* 2. What needs a librarian. Every number links to the actual records. */}
        <section className="mb-10">
          <h2 className="text-lg text-primary font-display mb-1">Needs your attention</h2>
          <p className="text-sm text-muted mb-3">
            {totalAttention > 0
              ? `${n(totalAttention)} records where only a librarian can decide what is right.`
              : 'Nothing outstanding.'}
          </p>

          {worklist.map((w) => (
            <div key={w.category} className="border border-stone-200 bg-white p-5 mb-3">
              <div className="flex items-baseline justify-between gap-4">
                <h3 className="text-primary font-medium">{w.label}</h3>
                <span className="text-xl text-primary font-display shrink-0">{n(Number(w.n))}</span>
              </div>
              <p className="text-sm text-muted mt-1">{w.detail}</p>
              {w.samples?.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-sm">
                  {w.samples.slice(0, 12).map((s, i) => (
                    <a
                      key={`${w.category}-${s.id}-${i}`}
                      // ubn → uuid, never `id`. Three of these categories select
                      // exactly the rows where ubn IS NULL, so the fallback is
                      // the link for all 2,012 of them; `bph_works.id` is a
                      // DIFFERENT uuid from `bph_works.uuid` and resolves to
                      // nothing (José Bouman, 2026-08-12). See the RPC header.
                      href={`/catalog/${encodeURIComponent(s.ubn || s.uuid || s.id)}`}
                      className="text-accent-rust hover:underline"
                      title={s.hint || undefined}
                    >
                      {s.ubn || s.shelf_mark || (s.uuid || s.id).slice(0, 8)}
                    </a>
                  ))}
                  {Number(w.n) > 12 && <span className="text-muted">+{n(Number(w.n) - 12)} more</span>}
                </div>
              )}
            </div>
          ))}
        </section>

        {/* 3. What has been done to the catalogue, in plain words. */}
        <section className="mb-10">
          <h2 className="text-lg text-primary font-display mb-1">Recent changes</h2>
          <p className="text-sm text-muted mb-3">
            Every edit to this catalogue, by a person or by our software, with what changed and why.
          </p>
          <div className="border border-stone-200 bg-white divide-y divide-stone-100">
            {recent.length === 0 && <p className="p-5 text-sm text-muted">No changes recorded yet.</p>}
            {recent.map((r) => {
              const fields = Object.keys(r.field_changes || {});
              const isSystem = r.editor_email.startsWith('system:');
              const who = isSystem ? 'Source Library (automatic)' : r.editor_email;
              return (
                <div key={r.id} className="p-4 text-sm">
                  <div className="flex items-baseline justify-between gap-3">
                    <a href={`/catalog/${encodeURIComponent(r.ubn)}`} className="text-accent-rust hover:underline font-medium">
                      {r.ubn}
                    </a>
                    <span className="text-muted shrink-0">{formatDate(r.applied_at)}</span>
                  </div>
                  <div className="text-primary mt-0.5">
                    {r.change_type === 'create' ? 'Record created' : `Changed ${fields.map(fieldLabel).join(', ')}`}
                    <span className="text-muted"> · {who}</span>
                  </div>
                  {r.note && <p className="text-muted mt-1">{r.note}</p>}
                </div>
              );
            })}
          </div>
          <p className="text-xs text-muted mt-2">
            Showing the {recent.length} most recent. Every record also has its own full history, linked
            from the record itself.
          </p>
        </section>
      </div>
    </div>
  );
}
