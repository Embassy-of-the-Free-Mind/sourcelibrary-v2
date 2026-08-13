import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth-helpers';
import { supabaseAdmin } from '@/lib/supabase';
import {
  applyWorkRevision,
  EDITABLE_BPH_FIELDS,
  BphCatalogError,
  type FieldChangeMap,
} from '@/lib/bph-catalog';

/**
 * POST /api/[tenant]/catalog/pending/[id]/approve
 *
 * Editor-only. Approves a pending change:
 *   1. Calls applyWorkRevision with the pending row's field_changes, the
 *      current user as editor_email, and the original proposer recorded
 *      as proposed_by. The applyWorkRevision helper writes the revisions
 *      row first and links source_pending_id back to this pending row.
 *   2. Stamps the pending row as status='approved' with reviewed_by /
 *      reviewed_at / applied_revision_id.
 *
 * The whitelist is re-applied at approval time — if the catalog has
 * shrunk an editable field since submission, the approve fails with a
 * 400 rather than dropping the user's work silently.
 */

const EDITABLE_SET = new Set<string>(EDITABLE_BPH_FIELDS);

export const POST = withAuth(
  async (request: NextRequest, session, ctx) => {
    const params = await (ctx?.params as Promise<{ tenant: string; id: string }>);
    const { tenant, id } = params;
    void request;
    if (tenant !== 'bph') {
      return NextResponse.json({ error: 'Unsupported tenant' }, { status: 404 });
    }
    if (!supabaseAdmin) {
      return NextResponse.json({ error: 'supabaseAdmin not configured' }, { status: 500 });
    }
    const editorEmail = session.user?.email;
    if (!editorEmail) {
      return NextResponse.json({ error: 'Session missing email' }, { status: 400 });
    }

    // 1. Fetch the pending row and lock-check that it's still pending.
    const { data: pendingRow, error: fetchErr } = await supabaseAdmin
      .from('bph_works_pending_changes')
      .select('id, ubn, change_type, proposer_email, field_changes, note, status')
      .eq('id', id)
      .maybeSingle();
    if (fetchErr) {
      return NextResponse.json({ error: fetchErr.message }, { status: 500 });
    }
    if (!pendingRow) {
      return NextResponse.json({ error: 'Pending change not found' }, { status: 404 });
    }
    const row = pendingRow as {
      id: string;
      ubn: string | null;
      change_type: string;
      proposer_email: string;
      field_changes: Record<string, { to: unknown; source?: string; evidence?: string; from?: unknown }>;
      note: string | null;
      status: string;
    };
    if (row.status !== 'pending') {
      return NextResponse.json(
        { error: `Already ${row.status}` },
        { status: 409 },
      );
    }
    if (row.change_type !== 'edit') {
      // PR-D ships edit approvals only. Create / delete approvals come with
      // PR-D2 once the UBN assignment flow is wired up.
      return NextResponse.json(
        { error: `change_type "${row.change_type}" approvals are not implemented yet` },
        { status: 400 },
      );
    }
    // A proposal is keyed by UBN, or by uuid for the 2,012 records that have
    // no UBN (manuscripts, photographs). Requiring a UBN here rejected every
    // contributor correction to a manuscript. work_uuid is read separately so
    // an environment without add-bph-uuid-keyed-revisions.sql still approves
    // ubn-keyed proposals normally.
    let workUuidFromRow: string | null = null;
    if (!row.ubn) {
      const { data: extra } = await supabaseAdmin
        .from('bph_works_pending_changes')
        .select('work_uuid')
        .eq('id', id)
        .maybeSingle();
      workUuidFromRow = (extra as { work_uuid?: string | null } | null)?.work_uuid ?? null;
    }
    const workKey = row.ubn || workUuidFromRow;
    if (!workKey) {
      return NextResponse.json({ error: 'Pending edit targets no work (neither UBN nor uuid)' }, { status: 400 });
    }

    // 2. Re-validate field names against the current whitelist.
    const fieldChanges: FieldChangeMap = {};
    for (const [key, change] of Object.entries(row.field_changes || {})) {
      if (!EDITABLE_SET.has(key)) {
        return NextResponse.json(
          { error: `Field "${key}" is no longer editable — cannot apply` },
          { status: 400 },
        );
      }
      (fieldChanges as Record<string, unknown>)[key] = {
        from: null,
        to: change.to,
        ...(typeof change.source === 'string' ? { source: change.source } : {}),
        ...(typeof change.evidence === 'string' ? { evidence: change.evidence } : {}),
      };
    }

    // 3. Apply the change.
    let appliedAt: string;
    let revisionId: string;
    try {
      const result = await applyWorkRevision({
        ubn: workKey,
        changeType: 'edit',
        fieldChanges,
        editorEmail,
        proposedBy: row.proposer_email,
        sourcePendingId: row.id,
        note: row.note,
      });
      appliedAt = result.appliedAt;
      revisionId = result.revisionId;
    } catch (err) {
      if (err instanceof BphCatalogError) {
        return NextResponse.json({ error: err.message }, { status: 500 });
      }
      console.error('[catalog/pending/approve] applyWorkRevision failed:', err);
      return NextResponse.json({ error: 'Internal error applying revision' }, { status: 500 });
    }

    // 4. Stamp the pending row as approved.
    const { error: updErr } = await supabaseAdmin
      .from('bph_works_pending_changes')
      .update({
        status: 'approved',
        reviewed_by: editorEmail,
        reviewed_at: appliedAt,
        applied_revision_id: revisionId,
      })
      .eq('id', row.id)
      .eq('status', 'pending'); // Idempotent: a second approver gets no-op.
    if (updErr) {
      // Revision is already applied. Log + return the revision so the editor
      // knows the data is live; the pending row will be reconciled by a
      // cleanup script if it ever diverges.
      console.error('[catalog/pending/approve] pending update failed (revision is already applied):', updErr);
    }

    return NextResponse.json({ ok: true, revisionId, appliedAt });
  },
  { minRole: 'editor' },
);
