import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/mongodb';
import { purgeCloudflareUrls } from '@/lib/cloudflare-cache';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/admin/revalidate
 *
 * On-demand revalidation for any path or batch of paths.
 * With revalidate=false on all content pages, this is the only way
 * to refresh cached pages after content changes.
 *
 * Body:
 *   { "paths": ["/collections/alchemy", "/encyclopedia"] }
 *   or { "collections": true }  — revalidate all collection pages
 *   or { "all": true }          — revalidate all content pages
 *
 * Auth: x-revalidate-secret header or admin session
 */
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('x-revalidate-secret');
  const secret = process.env.REVALIDATE_SECRET;
  if (secret && authHeader !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const revalidated: string[] = [];

  if (body.paths && Array.isArray(body.paths)) {
    for (const path of body.paths) {
      if (typeof path === 'string' && path.startsWith('/')) {
        revalidatePath(path);
        revalidated.push(path);
      }
    }
  }

  if (body.collections) {
    try {
      const db = await getDb();
      const collections = await db.collection('collections')
        .find({ visible: { $ne: false } }, { projection: { slug: 1 }, maxTimeMS: 5000 })
        .toArray();
      for (const col of collections) {
        const path = `/collections/${col.slug}`;
        revalidatePath(path);
        revalidated.push(path);
      }
      revalidatePath('/collections');
      revalidated.push('/collections');
    } catch (err) {
      console.error('Failed to fetch collection slugs for revalidation:', err);
    }
  }

  if (body.all) {
    const staticPaths = [
      '/', '/collections', '/browse', '/gallery', '/libraries',
      '/languages', '/about', '/embassy', '/blog', '/artwork',
      '/encyclopedia', '/explore', '/categories', '/catalog',
      '/taxonomy', '/search',
    ];
    for (const path of staticPaths) {
      revalidatePath(path);
      revalidated.push(path);
    }

    // Also revalidate all collections
    try {
      const db = await getDb();
      const collections = await db.collection('collections')
        .find({ visible: { $ne: false } }, { projection: { slug: 1 }, maxTimeMS: 5000 })
        .toArray();
      for (const col of collections) {
        const path = `/collections/${col.slug}`;
        revalidatePath(path);
        revalidated.push(path);
      }
    } catch { /* ignore */ }
  }

  // Purge Cloudflare edge cache for all revalidated paths
  if (revalidated.length > 0) {
    await purgeCloudflareUrls(revalidated);
  }

  return NextResponse.json({
    success: true,
    revalidated: revalidated.length,
    paths: revalidated,
    timestamp: new Date().toISOString(),
  });
}
