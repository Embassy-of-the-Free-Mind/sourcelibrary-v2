import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

/**
 * POST /api/dataset/v1/request-key — Public endpoint to request an API key
 *
 * Body: { name, email, organization, use_case, tier? }
 *
 * Creates a pending request that an admin can approve.
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { name, email, organization, use_case, tier } = body;

  if (!name || !email || !use_case) {
    return NextResponse.json(
      { error: 'name, email, and use_case are required' },
      { status: 400 },
    );
  }

  // Basic email validation
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json(
      { error: 'Invalid email address' },
      { status: 400 },
    );
  }

  const db = await getDb();

  // Check for existing pending request from same email
  const existing = await db.collection('api_key_requests').findOne({
    email: email.toLowerCase(),
    status: 'pending',
  });
  if (existing) {
    return NextResponse.json(
      { error: 'You already have a pending request. We\'ll be in touch.' },
      { status: 409 },
    );
  }

  const doc = {
    name,
    email: email.toLowerCase(),
    organization: organization || null,
    use_case,
    requested_tier: tier || 'full',
    status: 'pending' as const,
    created_at: new Date(),
    reviewed_at: null,
    reviewed_by: null,
    notes: null,
  };

  await db.collection('api_key_requests').insertOne(doc);

  return NextResponse.json({
    message: 'Request received. We review requests within 24 hours.',
    status: 'pending',
  }, { status: 201 });
}
