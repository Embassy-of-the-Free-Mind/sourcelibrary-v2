import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

/**
 * Validates that an email may access the platform before the magic link is sent.
 *
 * Check order:
 * 1. PLATFORM_ADMIN_EMAILS env var — bootstrap / first-time setup, works on empty DB
 * 2. memberships collection (tenantId: null, role: superadmin, status: active|pending)
 *    — covers platform admins invited via the dashboard
 */
export async function POST(req: NextRequest) {
  const { email } = await req.json();

  if (!email || typeof email !== 'string') {
    return NextResponse.json({ error: 'Email is required' }, { status: 400 });
  }

  const normalizedEmail = email.toLowerCase().trim();

  // 1. Env var — always checked first, no DB needed
  const adminEmails = (process.env.PLATFORM_ADMIN_EMAILS || '')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);

  if (adminEmails.includes(normalizedEmail)) {
    return NextResponse.json({ ok: true });
  }

  // 2. DB — covers invited platform admins
  try {
    const db = await getDb();
    const record = await db.collection('memberships').findOne({
      email: normalizedEmail,
      tenantId: null,
      role: 'superadmin',
      status: { $in: ['active', 'pending'] },
    });
    if (record) {
      return NextResponse.json({ ok: true });
    }
  } catch {
    // DB unavailable — env-var path already returned above; unknown emails fall through
  }

  return NextResponse.json(
    { error: 'No platform account found for this email.' },
    { status: 403 }
  );
}
