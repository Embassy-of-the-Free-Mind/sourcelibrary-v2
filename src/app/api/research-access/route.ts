import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';

/**
 * POST /api/research-access — Public endpoint for academic access applications
 *
 * Body: { name, email, institution, role, research_area, intended_use, access_needs }
 */
export async function POST(request: NextRequest) {
  const rl = checkRateLimit({ name: 'research-access', limit: 3, windowSeconds: 3600 }, getClientIp(request));
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } });
  }

  const body = await request.json();
  const { name, email, institution, role, research_area, intended_use, access_needs } = body;

  if (!name || !email || !research_area || !intended_use) {
    return NextResponse.json(
      { error: 'name, email, research_area, and intended_use are required' },
      { status: 400 },
    );
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json(
      { error: 'Invalid email address' },
      { status: 400 },
    );
  }

  const db = await getDb();

  // Check for existing pending application from same email
  const existing = await db.collection('research_access_requests').findOne({
    email: email.toLowerCase(),
    status: 'pending',
  });
  if (existing) {
    return NextResponse.json(
      { error: 'You already have a pending application. We\'ll be in touch.' },
      { status: 409 },
    );
  }

  const doc = {
    name,
    email: email.toLowerCase(),
    institution: institution || null,
    role: role || null,
    research_area,
    intended_use,
    access_needs: Array.isArray(access_needs) ? access_needs : [],
    status: 'pending' as const,
    created_at: new Date(),
    reviewed_at: null,
    reviewed_by: null,
    notes: null,
  };

  await db.collection('research_access_requests').insertOne(doc);

  return NextResponse.json({
    message: 'Application received. We\'ll review it and get back to you within a few days.',
    status: 'pending',
  }, { status: 201 });
}
