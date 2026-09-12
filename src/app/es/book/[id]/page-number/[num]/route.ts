import { NextRequest } from 'next/server';
import { pageNumberRedirect } from '@/lib/page-number-redirect';

/**
 * Spanish twin of `/book/[id]/page-number/[num]` (#4082). Same resolver, and
 * it lands the reader on `/es/book/…/page/…` so the locale survives the hop —
 * chapter links and index page-references both come through here.
 */
interface RouteContext {
  params: Promise<{ id: string; num: string }>;
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  return pageNumberRedirect(request, await params, '/es');
}
