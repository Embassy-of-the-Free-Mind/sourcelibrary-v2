import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { API_TERMS_URL, API_TERMS_VERSION } from '@/lib/api-terms-version';

/**
 * POST /api/dataset/v1/request-key — Public endpoint to request an API key
 *
 * Body: { name, email, organization, use_case, tier? }
 *
 * Creates a pending request that an admin can approve.
 */
export async function POST(request: NextRequest) {
  const rl = checkRateLimit({ name: 'request-key', limit: 3, windowSeconds: 3600 }, getClientIp(request));
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } });
  }

  const body = await request.json();
  const { name, email, organization, use_case, tier, accept_terms } = body;

  if (!name || !email || !use_case) {
    return NextResponse.json(
      { error: 'name, email, and use_case are required' },
      { status: 400 },
    );
  }

  if (accept_terms !== API_TERMS_VERSION) {
    return NextResponse.json(
      { error: 'Agree to the terms of use to request a key.', terms_required: true, terms_version: API_TERMS_VERSION, terms_url: API_TERMS_URL },
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
    terms_version: accept_terms,
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
