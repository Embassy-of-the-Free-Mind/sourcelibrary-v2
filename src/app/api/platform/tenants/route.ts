import { NextRequest, NextResponse } from 'next/server';
import { withSuperadminAuth } from '@/lib/auth-helpers';
import { getDb } from '@/lib/mongodb';

export const GET = withSuperadminAuth(async (_req: NextRequest) => {
  const db = await getDb();
  const tenants = await db
    .collection('tenants')
    .find({})
    .sort({ createdAt: -1 })
    .toArray();
  return NextResponse.json({ tenants });
});

export const POST = withSuperadminAuth(async (req: NextRequest, session) => {
  const body = await req.json();
  const { name, slug, settings, geminiQuota } = body;

  if (!name || typeof name !== 'string' || !name.trim()) {
    return NextResponse.json({ error: 'Library name is required' }, { status: 400 });
  }
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
    return NextResponse.json({ error: 'Invalid slug format — lowercase letters, numbers, and hyphens only' }, { status: 400 });
  }

  const db = await getDb();

  const existing = await db.collection('tenants').findOne({ slug });
  if (existing) {
    return NextResponse.json({ error: 'Slug already taken' }, { status: 409 });
  }

  const tenant = {
    id: crypto.randomUUID(),
    slug,
    name: name.trim(),
    status: 'active',
    createdAt: new Date(),
    createdBy: (session.user as any).id || null,
    settings: {
      publicBrowsing: settings?.publicBrowsing ?? true,
      allowSignup: settings?.allowSignup ?? false,
    },
    pipeline: {
      pausedPhases: [],
      geminiQuota: typeof geminiQuota === 'number' && geminiQuota > 0 ? geminiQuota : 50,
    },
  };

  await db.collection('tenants').insertOne(tenant);
  return NextResponse.json({ tenant }, { status: 201 });
});
