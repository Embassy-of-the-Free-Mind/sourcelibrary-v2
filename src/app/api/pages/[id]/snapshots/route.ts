import { NextRequest, NextResponse } from 'next/server';
import { getPageSnapshots, restoreSnapshot } from '@/lib/snapshots';

// GET /api/pages/[id]/snapshots - List all snapshots for a page
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const snapshots = await getPageSnapshots(id);

    return NextResponse.json({
      snapshots,
      count: snapshots.length,
    });
  } catch (error) {
    console.error('Error fetching snapshots:', error);
    return NextResponse.json({ error: 'Failed to fetch snapshots' }, { status: 500 });
  }
}

// POST /api/pages/[id]/snapshots - Restore a snapshot
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: pageId } = await params;
    const body = await request.json();
    const { snapshotId, restoredBy = 'Unknown' } = body;

    if (!snapshotId) {
      return NextResponse.json({ error: 'snapshotId required' }, { status: 400 });
    }

    const result = await restoreSnapshot(snapshotId, restoredBy);

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      message: `Snapshot restored for page ${pageId}`,
    });
  } catch (error) {
    console.error('Error restoring snapshot:', error);
    return NextResponse.json({ error: 'Failed to restore snapshot' }, { status: 500 });
  }
}
