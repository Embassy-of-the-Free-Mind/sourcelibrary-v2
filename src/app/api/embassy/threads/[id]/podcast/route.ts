import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import {
  generatePodcast,
  getPodcastForThread,
  getAllPodcastsForThread,
  type PodcastFormat,
  PODCAST_FORMATS,
} from '@/lib/embassy/podcast';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

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
 * POST /api/embassy/threads/[id]/podcast — Generate a podcast.
 * Body: { format?: "deep-dive" | "brief" | "critique" | "guided-reading" }
 * Auth required (must be thread creator).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  }

  const { id } = await params;
  const db = await getDb();

  // Parse format from body
  let format: PodcastFormat = 'deep-dive';
  try {
    const body = await request.json().catch(() => ({}));
    if (body.format && VALID_FORMATS.includes(body.format)) {
      format = body.format;
    }
  } catch { /* default format */ }

  // Verify thread exists and user owns it
  const thread = await db.collection('embassy_threads').findOne({
    _id: new ObjectId(id),
  });
  if (!thread) {
    return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
  }
  if (thread.creatorId !== session.user.id) {
    return NextResponse.json({ error: 'Only the thread creator can generate podcasts' }, { status: 403 });
  }

  // Load notebook
  const notebook = await db.collection('research_notebooks').findOne({
    threadId: new ObjectId(id),
  });
  if (!notebook || !notebook.findings?.length) {
    return NextResponse.json(
      { error: 'No research findings yet — ask the Librarian to research a topic first' },
      { status: 400 },
    );
  }

  // Check if this format already exists
  const existing = await getPodcastForThread(id, format);
  if (existing) {
    return NextResponse.json({ podcast: existing, cached: true });
  }

  try {
    const topic = notebook.topic || thread.title || 'Research Discussion';
    const result = await generatePodcast(id, topic, notebook.findings, format);

    return NextResponse.json({
      podcast: {
        audioUrl: result.audioUrl,
        script: result.script,
        format: result.format,
        generatedAt: new Date(),
        topic,
        findingCount: notebook.findings.length,
      },
    });
  } catch (err) {
    console.error('[podcast] Generation failed:', err);
    return NextResponse.json(
      { error: 'Podcast generation failed — please try again' },
      { status: 500 },
    );
  }
}

/**
 * PATCH /api/embassy/threads/[id]/podcast — Update podcast metadata (e.g., publish).
 * Body: { format: "deep-dive", published: true }
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
  const format = body.format as PodcastFormat;
  if (!format || !VALID_FORMATS.includes(format)) {
    return NextResponse.json({ error: 'Invalid format' }, { status: 400 });
  }

  // Verify thread exists and user owns it
  const thread = await db.collection('embassy_threads').findOne({
    _id: new ObjectId(id),
  });
  if (!thread) {
    return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
  }
  if (thread.creatorId !== session.user.id) {
    return NextResponse.json({ error: 'Only the thread creator can publish podcasts' }, { status: 403 });
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
