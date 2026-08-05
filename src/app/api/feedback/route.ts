import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { withAdminAuth } from '@/lib/auth-helpers';
import { guardPublicSubmission } from '@/lib/public-submission-guard';
import { getClientIp } from '@/lib/rate-limit';
import { getTenantContextFromRequest, resolveTenantId } from '@/lib/tenant-context';
import {
  deriveSurface,
  isEmbeddedOrigin,
  parseEmbedTenantSlug,
  refererPathname,
  UNTAGGED_ORIGIN,
  type FeedbackOrigin,
} from '@/lib/feedback-origin';

/**
 * Work out which tenant (if any) a submission came from, server-side.
 *
 * Order matters: the proxy's `x-tenant-*` headers are authoritative and cover
 * every request on a tenant subdomain. The Referer is only consulted when they
 * are absent, which in practice means a partner iframe served from
 * `/embed/<slug>/…` on the apex domain — `src/proxy.ts` reads the Referer's
 * first path segment for its own fallback, and for those URLs that segment is
 * `embed` rather than the tenant.
 *
 * NEVER trust a client-sent tenant from the JSON body; that would let anyone
 * file feedback into a partner's queue.
 *
 * This whole function is best-effort. `/api/feedback` is the write path for the
 * widget rendered inside the Webflow iframe, so a throw in here would break
 * feedback for embed readers. Callers degrade to UNTAGGED_ORIGIN.
 */
async function resolveFeedbackOrigin(
  request: NextRequest,
  page: string | null
): Promise<FeedbackOrigin> {
  const refPath = refererPathname(request.headers.get('referer'));
  const ctx = getTenantContextFromRequest(request);

  let tenantSlug = ctx.slug;
  let tenantId = ctx.id;
  let tenantSource: string | null = ctx.slug ? ctx.source ?? 'header' : null;

  if (!tenantSlug) {
    const embedSlug = parseEmbedTenantSlug(refPath);
    if (embedSlug) {
      // Resolve through the tenants collection so an arbitrary Referer can't
      // invent a tenant. Unknown slug → stays untagged.
      const resolvedId = await resolveTenantId(embedSlug);
      if (resolvedId) {
        tenantSlug = embedSlug;
        tenantId = resolvedId;
        tenantSource = 'embed-referer';
      }
    }
  }

  return {
    tenant_slug: tenantSlug,
    tenant_id: tenantId,
    tenant_source: tenantSource,
    surface: deriveSurface(refPath, page),
    embedded: isEmbeddedOrigin(ctx.isEmbedded, refPath),
  };
}

// POST /api/feedback — save feedback
export async function POST(request: NextRequest) {
  try {
    const limited = await guardPublicSubmission(request, 'feedback');
    if (limited) return limited;

    const body = await request.json();
    const { message, page, name, email, wantsToHelp } = body;

    if (!message || typeof message !== 'string' || message.trim().length < 2) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 });
    }

    if (message.length > 5000) {
      return NextResponse.json({ error: 'Message too long' }, { status: 400 });
    }

    const db = await getDb();
    // cf-connecting-ip first: behind the CDN, x-forwarded-for is a Cloudflare
    // edge node, so reading it first filed every submission under ~15 shared
    // addresses (#3491). Same helper the limiter above keys on.
    const ip = getClientIp(request);
    const trimmedEmail = email?.trim()?.toLowerCase() || null;
    const wantsHelp = wantsToHelp === true;

    // Best-effort: never let origin tagging fail the write. The feedback widget
    // inside the partner iframe posts here too, and it only checks res.ok.
    let origin = UNTAGGED_ORIGIN;
    try {
      origin = await resolveFeedbackOrigin(request, page || null);
    } catch (originError) {
      console.error('Feedback origin tagging failed (saving untagged):', originError);
    }

    const doc = {
      message: message.trim(),
      page: page || null,
      name: name?.trim() || null,
      email: trimmedEmail,
      ip,
      user_agent: request.headers.get('user-agent') || null,
      created_at: new Date(),
      read: false,
      wants_to_help: wantsHelp,
      ...origin,
    };

    await db.collection('feedback').insertOne(doc);

    // Upsert a lightweight volunteer record when the user checks "I'd like to help".
    // Full survey (languages, interests) is captured in /welcome or follow-up.
    if (wantsHelp && trimmedEmail && trimmedEmail.includes('@')) {
      await db.collection('volunteers').updateOne(
        { email: trimmedEmail },
        {
          $setOnInsert: {
            email: trimmedEmail,
            name: name?.trim() || null,
            languages: [],
            interests: [],
            source: 'feedback_widget',
            ip,
            created_at: new Date(),
            contacted: false,
          },
          $push: {
            signals: {
              type: 'feedback',
              message: message.trim(),
              page: page || null,
              at: new Date(),
            },
          },
        } as Record<string, unknown>,
        { upsert: true }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Feedback error:', error);
    return NextResponse.json({ error: 'Failed to save feedback' }, { status: 500 });
  }
}

// GET /api/feedback — list feedback (admin only — contains PII: IPs, emails)
// Query params:
//   ?status=unread|read|addressed   filter by lifecycle state
//   ?unread=true                    legacy, equivalent to ?status=unread
//   ?tenant=<slug>|none             filter by originating tenant ('none' = global site)
//
// The tenant filter is admin-only and additive. The librarian-facing read path
// is a separate, tenant-locked route (Phase 2); do NOT loosen this one to serve
// it, because these rows carry PII.
export const GET = withAdminAuth(async (request: NextRequest) => {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200);
    const offset = parseInt(searchParams.get('offset') || '0');
    const unreadOnly = searchParams.get('unread') === 'true';
    const status = searchParams.get('status'); // 'unread' | 'read' | 'addressed'
    const tenant = searchParams.get('tenant'); // '<slug>' | 'none'

    const db = await getDb();

    const query: Record<string, unknown> = {};
    if (unreadOnly || status === 'unread') {
      query.read = { $ne: true };
    } else if (status === 'read') {
      query.read = true;
      query.addressed = { $ne: true };
    } else if (status === 'addressed') {
      query.addressed = true;
    }
    if (tenant === 'none') {
      // Rows written before the backfill have no tenant_slug field at all,
      // so this must match missing as well as explicit null.
      query.tenant_slug = null;
    } else if (tenant) {
      query.tenant_slug = tenant;
    }

    const [items, total, counts] = await Promise.all([
      db.collection('feedback')
        .find(query)
        .sort({ created_at: -1 })
        .skip(offset)
        .limit(limit)
        .toArray(),
      db.collection('feedback').countDocuments(query),
      Promise.all([
        db.collection('feedback').countDocuments({ read: { $ne: true } }),
        db.collection('feedback').countDocuments({ read: true, addressed: { $ne: true } }),
        db.collection('feedback').countDocuments({ addressed: true }),
      ]).then(([unread, read, addressed]) => ({ unread, read, addressed })),
    ]);

    return NextResponse.json({ feedback: items, total, counts });
  } catch (error) {
    console.error('Feedback list error:', error);
    return NextResponse.json({ error: 'Failed to load feedback' }, { status: 500 });
  }
});
