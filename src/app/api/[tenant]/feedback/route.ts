import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { withContributorAuth } from '@/lib/auth-helpers';
import { effectiveCatalogRole, canEditCatalog, normalizeCatalogRole } from '@/lib/catalog-role';
import { toLibrarianFeedback } from '@/lib/feedback-origin';

/**
 * GET /api/[tenant]/feedback — the feedback a partner's own librarians may read.
 *
 * Deliberately NOT the same route as the admin `/api/feedback`. Two reasons:
 *
 *  1. PII. Rows carry `ip`, `email` and `user_agent`. Those are stripped here,
 *     server-side, by `toLibrarianFeedback()`. Never "hide" them in the
 *     component — the JSON is what leaks.
 *  2. Scope. Every query is forced to this tenant. A platform-wide contributor
 *     is not automatically a BPH contributor, so the role is re-resolved
 *     against the tenant with `effectiveCatalogRole` before anything is read.
 *
 * `withContributorAuth` is the outer gate (signed in, contributor+ somewhere);
 * the per-tenant check below is the one that actually matters.
 */
export const GET = withContributorAuth(async (request: NextRequest, session, context) => {
  try {
    const params = await context?.params;
    const tenant = typeof params?.tenant === 'string' ? params.tenant : null;
    if (!tenant) {
      return NextResponse.json({ error: 'Unknown tenant' }, { status: 404 });
    }

    // Re-resolve the caller's role against THIS tenant. Platform role alone is
    // not enough: a contributor on the global site has no business reading a
    // partner's feedback queue.
    const role = await effectiveCatalogRole(
      session?.user?.email,
      normalizeCatalogRole((session?.user as { role?: unknown } | undefined)?.role),
      tenant
    );
    if (!canEditCatalog(role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200);
    const offset = Math.max(parseInt(searchParams.get('offset') || '0'), 0);
    const status = searchParams.get('status'); // 'unread' | 'read' | 'addressed'

    // Mandatory tenant filter. This is the query-level half of the separation;
    // do not make it conditional on a query param.
    const query: Record<string, unknown> = { tenant_slug: tenant };
    if (status === 'unread') {
      query.read = { $ne: true };
    } else if (status === 'read') {
      query.read = true;
      query.addressed = { $ne: true };
    } else if (status === 'addressed') {
      query.addressed = true;
    }

    const db = await getDb();
    const [rows, total, counts] = await Promise.all([
      db.collection('feedback')
        .find(query)
        .sort({ created_at: -1 })
        .skip(offset)
        .limit(limit)
        .toArray(),
      db.collection('feedback').countDocuments(query),
      Promise.all([
        db.collection('feedback').countDocuments({ tenant_slug: tenant, read: { $ne: true } }),
        db.collection('feedback').countDocuments({ tenant_slug: tenant, read: true, addressed: { $ne: true } }),
        db.collection('feedback').countDocuments({ tenant_slug: tenant, addressed: true }),
      ]).then(([unread, read, addressed]) => ({ unread, read, addressed })),
    ]);

    return NextResponse.json({
      feedback: rows.map(toLibrarianFeedback),
      total,
      counts,
    });
  } catch (error) {
    console.error('Tenant feedback list error:', error);
    return NextResponse.json({ error: 'Failed to load feedback' }, { status: 500 });
  }
});
