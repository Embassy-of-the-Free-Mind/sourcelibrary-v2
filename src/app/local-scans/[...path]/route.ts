/**
 * Serves one mirrored page image off the local disk. Local mode only.
 *
 * The reader needs a same-origin URL for the scan: `page-image-url.ts` screens
 * every image host against `src/lib/csp-img-hosts.ts` and the CSP `img-src` in
 * next.config.ts, and `'self'` is the one entry that is already there — so a path
 * under this origin needs no next.config change, no `remotePatterns` entry, and
 * no exception to the allow-list that exists to stop an arbitrary host being
 * loaded into a reader page.
 *
 * Two gates, both cheap and both necessary:
 *  - SL_LOCAL, so this route does not exist on sourcelibrary.org;
 *  - the resolved real path must sit inside `scansDir()`, so a `..` segment, a
 *    URL-encoded one, or a symlink planted in the mirror cannot read the rest of
 *    the disk. `realpath` is what makes the symlink half true — a prefix test on
 *    the joined path alone would pass a symlink pointing at ~/.ssh.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { isLocalMode, scansDir } from '@/lib/local-mode/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.json': 'application/json',
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  if (!isLocalMode()) {
    return new Response('Not found', { status: 404 });
  }

  const { path: segments } = await params;
  if (!segments?.length || segments.length > 4) {
    return new Response('Not found', { status: 404 });
  }

  const root = scansDir();
  const requested = path.resolve(root, ...segments.map((s) => decodeURIComponent(s)));

  const ext = path.extname(requested).toLowerCase();
  const type = TYPES[ext];
  if (!type) {
    return new Response('Not found', { status: 404 });
  }

  let real: string;
  try {
    real = await fs.realpath(requested);
  } catch {
    return new Response('Not found', { status: 404 });
  }

  // Trailing separator so `/sl-scans-elsewhere` cannot pass as `/sl-scans`.
  const rootReal = await fs.realpath(root).catch(() => root);
  if (real !== rootReal && !real.startsWith(rootReal + path.sep)) {
    return new Response('Not found', { status: 404 });
  }

  try {
    const body = await fs.readFile(real);
    return new Response(new Uint8Array(body), {
      headers: {
        'Content-Type': type,
        'Content-Length': String(body.length),
        // The mirror rewrites a file in place when it re-encodes at a new tier,
        // so this is a short cache: long enough that paging back and forth is
        // instant, short enough that a re-mirror shows up without a hard reload.
        'Cache-Control': 'private, max-age=300',
      },
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}
