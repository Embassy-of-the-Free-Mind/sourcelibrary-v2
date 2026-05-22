import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth-helpers';
import { supabaseAdmin } from '@/lib/supabase';

/**
 * POST /api/[tenant]/catalog/pending/[id]/reject
 *
 * Editor-only. Stamps a pending change as rejected. bph_works is untouched.
 *
 * Body: { reviewNote?: string }
 *
 * Rejected rows are retained — institutional memory of what was considered
 * and decided against. Do not delete them via this endpoint or elsewhere.
 */

interface RejectPayload {
  reviewNote?: string | null;
}

export const POST = withAuth(
  async (request: NextRequest, session, ctx) => {
    const params = await (ctx?.params as Promise<{ tenant: string; id: string }>);
    const { tenant, id } = params;
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

    let body: RejectPayload = {};
    try {
      body = (await request.json()) as RejectPayload;
    } catch {
      // Empty body is fine — note is optional.
    }
    const reviewNote =
      typeof body?.reviewNote === 'string' && body.reviewNote.trim() ? body.reviewNote.trim() : null;

    const { data, error } = await supabaseAdmin
      .from('bph_works_pending_changes')
      .update({
        status: 'rejected',
        reviewed_by: editorEmail,
        reviewed_at: new Date().toISOString(),
        review_note: reviewNote,
      })
      .eq('id', id)
      .eq('status', 'pending')
      .select('id, status')
      .maybeSingle();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: 'Pending change not found or already decided' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  },
  { minRole: 'editor' },
);
