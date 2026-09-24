import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import {
  getPodcastForThread,
  getAllPodcastsForThread,
  type PodcastFormat,
  PODCAST_FORMATS,
} from '@/lib/embassy/podcast';

export const dynamic = 'force-dynamic';

const VALID_FORMATS = Object.keys(PODCAST_FORMATS) as PodcastFormat[];

/**
 * GET /api/embassy/threads/[id]/podcast — Get podcasts for a thread.
 * ?format=deep-dive  → specific format
 * ?all=true          → all generated formats
 * No params          → first available
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const url = new URL(request.url);

  if (url.searchParams.get('all') === 'true') {
    const podcasts = await getAllPodcastsForThread(id);
    return NextResponse.json({ podcasts });
  }

  const format = url.searchParams.get('format') as PodcastFormat | null;
  const podcast = await getPodcastForThread(id, format || undefined);
  if (!podcast) {
    return NextResponse.json({ error: 'No podcast generated yet' }, { status: 404 });
  }

  return NextResponse.json({ podcast });
}

/**
 * POST /api/embassy/threads/[id]/podcast — formerly generated an episode.
 *
 * The podcast is retired and archived (#5007): existing episodes stay
 * readable through GET and /podcast, but no new ones are made. 410 rather than
 * 404 so a stale client learns the feature is gone, not that the thread is.
 */
export async function POST() {
  return NextResponse.json(
    { error: 'The podcast is retired; no new episodes are generated.' },
    { status: 410 },
  );
}

/**
 * PATCH /api/embassy/threads/[id]/podcast — Update podcast metadata.
 * Body: { format: "deep-dive", published: false }
 * Unpublishing still works; publishing is refused because the podcast is
 * retired and the archive is closed (#5007).
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  }

  const { id } = await params;
  const db = await getDb();

  const body = await request.json();
  if (body.published === true) {
    return NextResponse.json({ error: 'The podcast is retired; episodes can no longer be published.' }, { status: 410 });
  }
  const format = body.format as PodcastFormat;
  if (!format || !VALID_FORMATS.includes(format)) {
    return NextResponse.json({ error: 'Invalid format' }, { status: 400 });
  }

  // Verify thread ownership
  const thread = await db.collection('embassy_threads').findOne({
    _id: new ObjectId(id),
    creatorId: session.user.id,
  });
  if (!thread) {
    return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
  }

  // Update published status
  if (typeof body.published === 'boolean') {
    await db.collection('embassy_threads').updateOne(
      { _id: new ObjectId(id) },
      { $set: { [`podcasts.${format}.published`]: body.published } },
    );
  }

  return NextResponse.json({ ok: true });
}
