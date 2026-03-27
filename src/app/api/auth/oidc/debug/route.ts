import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

export const dynamic = 'force-dynamic';

export async function GET() {
  const db = await getDb();
  const count = await db.collection('oidc_auth_codes').countDocuments();
  return NextResponse.json({ 
    version: 'mongodb-v3',
    codesInDb: count,
    timestamp: new Date().toISOString(),
  });
}
