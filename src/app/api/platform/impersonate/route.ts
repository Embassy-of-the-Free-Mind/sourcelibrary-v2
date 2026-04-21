import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { withAdminAuth } from '@/lib/auth-helpers';
import jwt from 'jsonwebtoken';

interface ImpersonateBody {
  userId: string;
  tenantId: string;
  durationMinutes?: number;
}

export const POST = withAdminAuth(async (req: NextRequest) => {
  try {
    const body = (await req.json()) as ImpersonateBody;
    const { userId, tenantId, durationMinutes = 60 } = body;

    if (!userId || !tenantId) {
      return NextResponse.json(
        { error: 'userId and tenantId are required' },
        { status: 400 }
      );
    }

    if (durationMinutes < 1 || durationMinutes > 480) {
      return NextResponse.json(
        { error: 'durationMinutes must be between 1 and 480' },
        { status: 400 }
      );
    }

    const db = await getDb();

    // Verify user exists
    const user = await db.collection('users').findOne({ id: userId });
    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    // Verify tenant exists
    const tenant = await db.collection('tenants').findOne({ id: tenantId });
    if (!tenant) {
      return NextResponse.json(
        { error: 'Tenant not found' },
        { status: 404 }
      );
    }

    // Create impersonation token
    const expiresIn = durationMinutes * 60; // seconds
    const token = jwt.sign(
      {
        sub: userId,
        email: user.email,
        name: user.name,
        image: user.image,
        impersonating: true,
        impersonated_tenant_id: tenantId,
        impersonated_by: req.headers.get('x-user-id') || 'unknown',
        impersonated_at: new Date().toISOString(),
      },
      process.env.NEXTAUTH_SECRET || 'dev-secret',
      { expiresIn }
    );

    // Log impersonation for audit trail
    await db.collection('audit_log').insertOne({
      action: 'impersonate',
      actor: {
        id: req.headers.get('x-user-id'),
        email: req.headers.get('x-user-email'),
      },
      subject: {
        id: userId,
        email: user.email,
        name: user.name,
      },
      tenant_id: tenantId,
      duration_minutes: durationMinutes,
      timestamp: new Date(),
      expires_at: new Date(Date.now() + expiresIn * 1000),
    });

    return NextResponse.json(
      {
        token,
        user,
        tenant,
        expiresIn,
        expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
      },
      {
        headers: {
          'Set-Cookie': `impersonation-token=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${expiresIn}`,
        },
      }
    );
  } catch (error) {
    console.error('[impersonate]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to impersonate' },
      { status: 500 }
    );
  }
});
