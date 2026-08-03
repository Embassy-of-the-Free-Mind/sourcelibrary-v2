import { NextRequest, NextResponse } from 'next/server';
import { restoreRevision } from '@/lib/page-revisions';
import { withAuth } from '@/lib/auth-helpers';

/**
 * POST /api/pages/[id]/revisions/[revisionId]/restore
 *
 * Restore a revision — writes the old content back to the page.
 * Creates a new revision of the current content first (nothing is lost).
 *
 * Gated at `editor` (#3511). Two reasons this one mattered most: the Restore
 * button renders in the reader's *read* mode, so it was the only page-write
 * affordance a non-editor could actually see; and `restoreRevision()` resolves
 * the page from the revision document, ignoring the `[id]` in the path and
 * applying no tenant filter — so any revision id rewrote its page, anywhere.
 */
export const POST = withAuth(async (
  request: NextRequest,
  session,
  context
) => {
  try {
    const { revisionId } = await (context as { params: Promise<{ id: string; revisionId: string }> }).params;
    const body = await request.json().catch(() => ({}));
    const restoredBy = body.restoredBy || session?.user?.name || 'Unknown';

    const result = await restoreRevision(revisionId, restoredBy);

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      message: 'Revision restored successfully',
    });
  } catch (error) {
    console.error('Error restoring revision:', error);
    return NextResponse.json({ error: 'Failed to restore revision' }, { status: 500 });
  }
}, { minRole: 'editor' });
