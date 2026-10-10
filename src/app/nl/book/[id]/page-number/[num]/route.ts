import { NextRequest } from 'next/server';
import { pageNumberRedirect } from '@/lib/page-number-redirect';

/**
 * Dutch twin of `/book/[id]/page-number/[num]` (#6254, #6382). Same resolver, and it
 * lands the reader on `/nl/book/…/page/…` so the locale survives the hop.
 */
interface RouteContext {
  params: Promise<{ id: string; num: string }>;
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  return pageNumberRedirect(request, await params, '/nl');
}
