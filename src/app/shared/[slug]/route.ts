/**
 * /shared/<slug> — unlisted pages whose text lives in the PRIVATE ops repo.
 *
 * Some documents need a sourcelibrary.org link (partner letters, discussion
 * papers) but must never be committed here: this repo is public, and business
 * and legal material belongs in Embassy-of-the-Free-Mind/sourcelibrary-ops.
 * This handler fetches `shared/<slug>.html` from that repo at request time, so
 * the public repo carries only this route, never the text.
 *
 * Unlisted, not secret: anyone with the link can read it. Use an unguessable
 * slug (a random suffix) for anything sensitive. Everything is noindex +
 * no-store, /shared/ is disallowed in robots.txt, and tenant subdomains 404.
 *
 * To publish: add `shared/<slug>.html` (a full HTML document) to the ops repo
 * and push. To unpublish: delete it and push.
 */
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const OPS_REPO = 'Embassy-of-the-Free-Mind/sourcelibrary-ops';
const SLUG = /^[a-z0-9][a-z0-9-]{2,80}$/;

const PRIVATE_HEADERS: Record<string, string> = {
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
  'Cache-Control': 'private, no-store',
  'Referrer-Policy': 'same-origin',
};

function notFound(): NextResponse {
  return new NextResponse('Not found', { status: 404, headers: PRIVATE_HEADERS });
}

// Partner subdomains (bph.sourcelibrary.org, …) are closed reading rooms;
// these pages belong to the main site only.
function isTenantHost(host: string): boolean {
  const h = host.toLowerCase().split(':')[0];
  return h.endsWith('.sourcelibrary.org') && h !== 'www.sourcelibrary.org';
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  if (!SLUG.test(slug) || isTenantHost(req.headers.get('host') ?? '')) return notFound();

  const token = process.env.GITHUB_TOKEN;
  if (!token) return notFound();

  const res = await fetch(
    `https://api.github.com/repos/${OPS_REPO}/contents/shared/${slug}.html`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.raw',
        'User-Agent': 'sourcelibrary-shared-pages',
      },
      cache: 'no-store',
    },
  ).catch(() => null);

  if (!res?.ok) return notFound();
  const html = await res.text();
  return new NextResponse(html, {
    headers: { ...PRIVATE_HEADERS, 'Content-Type': 'text/html; charset=utf-8' },
  });
}
