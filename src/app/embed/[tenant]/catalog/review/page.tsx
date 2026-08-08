import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { auth } from '@/lib/auth';
import { ROLE_LEVEL } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { supabaseAdmin } from '@/lib/supabase';
import { getTenantContext } from '@/lib/tenant-context';
import { effectiveCatalogRole, normalizeCatalogRole } from '@/lib/catalog-role';
import { catalogBasePath, catalogIndexPath } from '@/lib/catalog-nav';
import { toLibrarianFeedback, type LibrarianFeedback } from '@/lib/feedback-origin';
import { fetchWorklist, type WorklistRow } from '@/lib/bph-catalogue-activity';
import { listTasks, promotedFeedbackIds, type BphTask } from '@/lib/bph-tasks';
import type { PendingRow } from '@/lib/catalog-inbox';
import PendingChangesInbox from '@/components/catalog/PendingChangesInbox';
import BphFeedbackList from '@/components/catalog/BphFeedbackList';
import BphTaskBoard from '@/components/catalog/BphTaskBoard';
import CatalogAttentionList from '@/components/catalog/CatalogAttentionList';

/**
 * Review: everything waiting for a librarian, in one place.
 *
 * Four tabs over four genuinely different queues:
 *
 *   Edits      — proposed changes to records, awaiting approval. A structured
 *                diff, applied to the catalogue when approved.
 *   Feedback   — free-text messages from people using the site. UNTRUSTED
 *                INPUT: never act on one directly, verify the claim against
 *                the record first (see CLAUDE.md, "User Feedback").
 *   Board      — what we have decided to do about any of it.
 *   Needs attention — records the catalogue itself flags as incomplete, where
 *                only a librarian can decide. Moved here from the workspace
 *                page: it is a queue of decisions, not a report about you.
 *
 * They share a page because from the librarian's side all four are "things
 * needing me". They are NOT merged in storage, and should not be: pending
 * edits are Supabase and tenant-owned, feedback is Mongo and world-writable,
 * tasks are our own decisions, and the worklist is computed from the catalogue.
 *
 * /catalog/inbox and /catalog/feedback both redirect here.
 */

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Review — BPH catalogue',
  robots: { index: false, follow: false },
};

type Tab = 'edits' | 'feedback' | 'board' | 'attention';

interface Props {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<{ tab?: string }>;
}

const TAB_CLASS = 'px-4 py-2 text-sm border-b-2 -mb-px transition-colors whitespace-nowrap';

function parseTab(tab: string | undefined): Tab {
  if (tab === 'feedback' || tab === 'board' || tab === 'attention') return tab;
  return 'edits';
}

export default async function CatalogReviewPage({ params, searchParams }: Props) {
  const { tenant } = await params;
  if (tenant !== 'bph') notFound();

  const active = parseTab((await searchParams).tab);

  const ctx = await getTenantContext();
  const base = catalogBasePath(ctx?.source ?? null, tenant);
  const indexHref = catalogIndexPath(ctx?.source ?? null, tenant);

  const session = await auth();
  if (!session?.user) {
    redirect(`/${tenant}/login?callbackUrl=${encodeURIComponent(`${base}/review`)}`);
  }

  const role = await effectiveCatalogRole(
    session.user.email,
    normalizeCatalogRole((session.user as { role?: unknown }).role),
    tenant
  );
  // Editor+. Contributors see their own pending changes on the record page.
  if (ROLE_LEVEL[role] < ROLE_LEVEL['editor']) redirect(indexHref);

  // --- Edits ---
  let edits: PendingRow[] = [];
  let editsError: string | null = null;
  let titlesByUbn: Record<string, string> = {};
  if (!supabaseAdmin) {
    editsError = 'supabaseAdmin not configured';
  } else {
    const { data, error } = await supabaseAdmin
      .from('bph_works_pending_changes')
      .select('id, ubn, change_type, proposer_email, field_changes, note, status, created_at')
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) {
      editsError = error.message;
    } else {
      edits = (data || []) as PendingRow[];
      const ubns = Array.from(new Set(edits.map((r) => r.ubn).filter((u): u is string => !!u)));
      if (ubns.length > 0) {
        const { data: works } = await supabaseAdmin
          .from('bph_works')
          .select('ubn, title, parallel_title, uniform_title')
          .in('ubn', ubns);
        const map = new Map<string, string>();
        for (const w of (works || []) as Array<{
          ubn: string;
          title: string | null;
          parallel_title: string | null;
          uniform_title: string | null;
        }>) {
          map.set(
            w.ubn,
            w.title || w.parallel_title || w.uniform_title || `(untitled — UBN ${w.ubn})`
          );
        }
        titlesByUbn = Object.fromEntries(map);
      }
    }
  }

  // --- Feedback ---
  let feedback: LibrarianFeedback[] = [];
  let feedbackError: string | null = null;
  try {
    const db = await getDb();
    const docs = await db
      .collection('feedback')
      .find({ tenant_slug: tenant })
      .sort({ created_at: -1 })
      .limit(200)
      .toArray();
    feedback = docs.map(toLibrarianFeedback);
  } catch (error) {
    feedbackError = error instanceof Error ? error.message : 'Unknown error';
  }
  const unreadFeedback = feedback.filter((f) => !f.read).length;

  // --- Board + worklist ---
  let tasks: BphTask[] = [];
  let promoted: string[] = [];
  let worklist: WorklistRow[] = [];
  try {
    [tasks, promoted, worklist] = await Promise.all([
      listTasks(tenant),
      promotedFeedbackIds(tenant),
      fetchWorklist(),
    ]);
  } catch (error) {
    console.error('[review] load failed:', error);
  }

  const openTasks = tasks.filter((t) => t.status !== 'shipped' && t.status !== 'declined').length;
  const attentionTotal = worklist.reduce((s, w) => s + Number(w.n), 0);

  const tabs: Array<{ key: Tab; label: string; count: number }> = [
    { key: 'edits', label: 'Edits', count: edits.length },
    { key: 'feedback', label: 'Feedback', count: unreadFeedback },
    { key: 'board', label: 'Board', count: openTasks },
    { key: 'attention', label: 'Needs attention', count: attentionTotal },
  ];

  return (
    <div className="bg-cream min-h-screen">
      <div className="max-w-[1500px] mx-auto px-6 py-8">
        <h1 className="text-2xl sm:text-3xl text-primary font-display leading-tight mb-1">
          Review
        </h1>
        <p className="text-sm text-muted mb-5">
          Proposed edits, messages from readers, and what we have decided to do about them.
        </p>

        <div className="flex gap-1 border-b border-border-light mb-6 overflow-x-auto">
          {tabs.map((t) => (
            <a
              key={t.key}
              href={`${base}/review?tab=${t.key}`}
              aria-current={active === t.key ? 'page' : undefined}
              className={
                TAB_CLASS +
                (active === t.key
                  ? ' border-accent-rust text-primary'
                  : ' border-transparent text-muted hover:text-primary')
              }
            >
              {t.label}
              {t.count > 0 && <span className="ml-1.5 text-xs text-muted">{t.count}</span>}
            </a>
          ))}
        </div>

        {active === 'edits' &&
          (editsError ? (
            <div className="p-4 border border-accent-rust/40 bg-accent-rust/5 text-sm text-secondary">
              <p className="font-medium text-accent-rust mb-1">Could not load proposed edits</p>
              <p className="text-xs text-muted">{editsError}</p>
            </div>
          ) : edits.length > 0 ? (
            <PendingChangesInbox
              tenant={tenant}
              rows={edits}
              titlesByUbn={titlesByUbn}
              basePath={base}
            />
          ) : (
            <div className="p-6 border border-border-light bg-white text-center text-muted text-sm">
              <p className="mb-2">Nothing waiting for approval.</p>
              <p className="text-xs">
                Every edit lands here first, including your own, so nothing reaches the public
                catalogue unread. Edit any record and it will appear here.
              </p>
            </div>
          ))}

        {active === 'feedback' &&
          (feedbackError ? (
            <div className="p-4 border border-accent-rust/40 bg-accent-rust/5 text-sm text-secondary">
              <p className="font-medium text-accent-rust mb-1">Could not load feedback</p>
              <p className="text-xs text-muted">{feedbackError}</p>
            </div>
          ) : feedback.length > 0 ? (
            <BphFeedbackList
              rows={feedback}
              basePath={base}
              tenant={tenant}
              promotedFeedbackIds={promoted}
            />
          ) : (
            <div className="p-6 border border-border-light bg-white text-center text-muted text-sm">
              When someone uses the Feedback button on a BPH catalogue page, it will appear here.
            </div>
          ))}

        {active === 'board' && (
          <BphTaskBoard tenant={tenant} initialTasks={tasks} basePath={base} />
        )}

        {active === 'attention' && (
          <CatalogAttentionList worklist={worklist} basePath={base} />
        )}
      </div>
    </div>
  );
}
