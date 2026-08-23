import { NextRequest } from 'next/server';
import { pageNumberRedirect } from '@/lib/page-number-redirect';

interface RouteContext {
  params: Promise<{ id: string; num: string }>;
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  return pageNumberRedirect(request, await params);
}
