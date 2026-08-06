import { getDb } from '@/lib/mongodb';
import { supabaseAdmin } from '@/lib/supabase';

/**
 * Counts behind the Inbox badge.
 *
 * The Inbox merges two genuinely different queues under one nav item, because
 * from a librarian's side both are "things waiting for me":
 *
 *   edits    — changes proposed by cataloguers, awaiting approval.
 *              Supabase, `bph_works_pending_changes`.
 *   feedback — messages from people using the site, unread.
 *              Mongo, `feedback`, scoped by `tenant_slug`.
 *
 * They stay separate in storage. Merging the *data* would be wrong: one is a
 * structured diff that gets applied to a record, the other is free text from a
 * stranger and is explicitly untrusted input.
 *
 * Both counts fail soft. This runs in the catalogue layout, so on every single
 * catalogue page — a badge is never worth 500ing a page over.
 */

export interface InboxCounts {
  edits: number;
  feedback: number;
  total: number;
}

/** A row of `bph_works_pending_changes` as the inbox renders it. */
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

export const EMPTY_INBOX_COUNTS: InboxCounts = { edits: 0, feedback: 0, total: 0 };

async function countPendingEdits(): Promise<number> {
  if (!supabaseAdmin) return 0;
  try {
    const { count, error } = await supabaseAdmin
      .from('bph_works_pending_changes')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending');
    if (error) return 0;
    return count ?? 0;
  } catch {
    return 0;
  }
}

async function countUnreadFeedback(tenant: string): Promise<number> {
  try {
    const db = await getDb();
    return await db.collection('feedback').countDocuments({
      tenant_slug: tenant,
      read: { $ne: true },
    });
  } catch {
    return 0;
  }
}

export async function getInboxCounts(tenant: string): Promise<InboxCounts> {
  const [edits, feedback] = await Promise.all([
    countPendingEdits(),
    countUnreadFeedback(tenant),
  ]);
  return { edits, feedback, total: edits + feedback };
}
