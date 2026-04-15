import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { generatePodcast, getPodcastForThread } from '@/lib/embassy/podcast';

export const dynamic = 'force-dynamic';
export const maxDuration = 120; // TTS can take a while

/**
 * GET /api/embassy/threads/[id]/podcast — Get existing podcast for a thread.
 * Returns { audioUrl, generatedAt, topic, findingCount } or 404.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const podcast = await getPodcastForThread(id);
  if (!podcast) {
    return NextResponse.json({ error: 'No podcast generated yet' }, { status: 404 });
  }

  return NextResponse.json({ podcast });
}

/**
 * POST /api/embassy/threads/[id]/podcast — Generate a podcast from research findings.
 * Auth required (must be thread creator).
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  }

  const { id } = await params;
  const db = await getDb();

  // Verify thread ownership
  const thread = await db.collection('embassy_threads').findOne({
    _id: new ObjectId(id),
    creatorId: session.user.id,
  });
  if (!thread) {
    return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
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

  // Check if podcast already exists (don't regenerate without explicit intent)
  const existing = await getPodcastForThread(id);
  if (existing) {
    return NextResponse.json({ podcast: existing, cached: true });
  }

  try {
    const topic = notebook.topic || thread.title || 'Research Discussion';
    const result = await generatePodcast(id, topic, notebook.findings);

    return NextResponse.json({
      podcast: {
        audioUrl: result.audioUrl,
        script: result.script,
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
