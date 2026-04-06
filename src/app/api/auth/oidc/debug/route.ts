import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { withAdminAuth } from '@/lib/auth-helpers';

export const dynamic = 'force-dynamic';

export const GET = withAdminAuth(async () => {
  const db = await getDb();
  const count = await db.collection('oidc_auth_codes').countDocuments();
  return NextResponse.json({
    version: 'mongodb-v3',
    codesInDb: count,
    timestamp: new Date().toISOString(),
  });
});
