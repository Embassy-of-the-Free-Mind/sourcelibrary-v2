import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { withAuth } from '@/lib/auth-helpers';
import { matchBookToUstc } from '@/lib/ustc-matcher';

export const dynamic = 'force-dynamic';

export const POST = withAuth(async (request, session, context) => {
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  const force = body.force === true;

  const db = await getDb();
  const result = await matchBookToUstc(db, id, { force });

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  if (result.skipped) {
    return NextResponse.json({ skipped: result.skipped });
  }

  return NextResponse.json({
    match: result.match,
    ustc_url: result.match ? `https://www.ustc.ac.uk/editions/${result.match.ustc_sn}` : null,
  });
});
