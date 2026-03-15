import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getMembership } from '@/lib/membership';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ active: false, plan: null });
  }

  const membership = await getMembership(session.user.id);
  return NextResponse.json(membership);
}
