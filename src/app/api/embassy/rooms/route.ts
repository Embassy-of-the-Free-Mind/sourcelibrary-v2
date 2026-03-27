import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';

/**
 * GET /api/embassy/rooms — List all rooms
 */
export async function GET() {
  const db = await getDb();

  const rooms = await db.collection('embassy_rooms')
    .find({})
    .sort({ pinned: -1, lastMessageAt: -1 })
    .toArray();

  // Seed defaults on first load
  if (rooms.length === 0) {
    const now = new Date();
    const defaults = [
      { slug: 'general', name: 'General', description: 'Welcome to the Embassy. Introduce yourself, ask questions, share discoveries.', pinned: true },
      { slug: 'alchemy', name: 'Alchemy', description: 'The Great Work — Paracelsus, Maier, Fludd, Ripley, and the alchemical tradition.' },
      { slug: 'hermetica', name: 'Hermetica', description: 'The Corpus Hermeticum, Asclepius, and the Hermetic tradition from antiquity to the Renaissance.' },
      { slug: 'kabbalah', name: 'Kabbalah', description: 'Jewish and Christian Kabbalah — Zohar, Reuchlin, Rosenroth, Knorr von Rosenroth.' },
      { slug: 'astrology', name: 'Astrology', description: 'Celestial arts — Ptolemy, Bonatti, Lilly, and the astrological tradition.' },
      { slug: 'translations', name: 'Translations', description: 'Discuss translation quality, suggest improvements, request new translations.' },
      { slug: 'reading-groups', name: 'Reading Groups', description: 'Organize and find reading groups. Post schedules, share notes.' },
    ];

    const docs = defaults.map(d => ({
      ...d,
      pinned: d.pinned || false,
      memberCount: 0,
      messageCount: 0,
      createdAt: now,
      lastMessageAt: now,
    }));

    await db.collection('embassy_rooms').insertMany(docs);
    const seeded = await db.collection('embassy_rooms').find({}).sort({ pinned: -1, lastMessageAt: -1 }).toArray();

    return NextResponse.json({
      rooms: seeded.map(r => ({
        id: r._id.toString(),
        slug: r.slug,
        name: r.name,
        description: r.description,
        pinned: r.pinned,
        memberCount: r.memberCount,
        messageCount: r.messageCount,
        lastMessageAt: r.lastMessageAt,
      })),
    });
  }

  return NextResponse.json({
    rooms: rooms.map(r => ({
      id: r._id.toString(),
      slug: r.slug,
      name: r.name,
      description: r.description,
      pinned: r.pinned,
      memberCount: r.memberCount,
      messageCount: r.messageCount,
      lastMessageAt: r.lastMessageAt,
    })),
  });
}

/**
 * POST /api/embassy/rooms — Create a new room (admin only)
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  }
  if ((session.user as any).role !== 'admin') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }

  const body = await request.json();
  const name = (body.name || '').trim().slice(0, 100);
  const slug = (body.slug || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 50);
  const description = (body.description || '').trim().slice(0, 500);

  if (!name || !slug) {
    return NextResponse.json({ error: 'Name and slug required' }, { status: 400 });
  }

  const db = await getDb();
  const existing = await db.collection('embassy_rooms').findOne({ slug });
  if (existing) {
    return NextResponse.json({ error: 'Room slug already exists' }, { status: 409 });
  }

  const now = new Date();
  const result = await db.collection('embassy_rooms').insertOne({
    slug, name, description,
    pinned: false,
    memberCount: 0,
    messageCount: 0,
    createdAt: now,
    lastMessageAt: now,
  });

  return NextResponse.json({ id: result.insertedId.toString(), slug }, { status: 201 });
}
