import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { anonymizeIp } from '@/lib/anonymize-ip';

/**
 * General-purpose analytics event sink for value-moment interactions that the
 * book-centric /api/analytics/track route doesn't cover — citing, sharing,
 * copying a quote, viewing a DOI, etc. These are the moments that show the
 * mission ("read and quote the original") is actually happening.
 *
 * POST /api/analytics/event  Body: { event: string, props?: object }
 * Fire-and-forget; writes one row to analytics_events. Public (consistent with
 * /api/track) but locked down by an event-name allowlist + prop whitelist so it
 * can't be used to write arbitrary documents.
 */

const ALLOWED_EVENTS = new Set([
  'cite', 'share', 'quote_copy', 'doi_view', 'download', 'signin_view',
  // signup_start: fired when a visitor initiates sign-up from a surface, so we
  // can attribute signups by `source` (hero / signin_page / …) and `method`.
  'signup_start',
  // confirm_view / confirm_click: the two halves of the magic-link interstitial
  // at /auth/confirm. views-minus-clicks is the drop-off introduced by the
  // prefetch-safe second click; without them an unconsumed verification token
  // is indistinguishable from mail that was never opened at all.
  'confirm_view', 'confirm_click',
]);

// Only these prop keys are persisted; everything else is dropped.
const ALLOWED_PROPS = new Set([
  'bookId', 'format', 'channel', 'page', 'title', 'url', 'hasDoi', 'edition', 'source', 'reason', 'method',
  // surface: which UI emitted a share (book page / gallery_image /
  // collection_anchor_bar). Share controls exist on several surfaces and until
  // #3399 two of them emitted nothing at all, so an undifferentiated `share`
  // count could not tell "nobody shares" from "that surface isn't wired up".
  'surface',
  // safe: on confirm_view/confirm_click, whether the `next` callback parameter
  // survived transit — separates "changed their mind" from "the link broke".
  'safe',
]);

const DB_TIMEOUT_MS = 3000;

function sanitizeProps(props: unknown): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!props || typeof props !== 'object') return out;
  for (const [k, v] of Object.entries(props as Record<string, unknown>)) {
    if (!ALLOWED_PROPS.has(k)) continue;
    if (typeof v === 'string') out[k] = v.slice(0, 300);
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'boolean') out[k] = v;
  }
  return out;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const event = typeof body?.event === 'string' ? body.event : '';
    if (!ALLOWED_EVENTS.has(event)) {
      return NextResponse.json({ error: 'Invalid event type' }, { status: 400 });
    }

    const rawIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || request.headers.get('x-real-ip')
      || 'unknown';

    const now = new Date();
    const doc = {
      event,
      ...sanitizeProps(body?.props),
      country: request.headers.get('x-vercel-ip-country') || request.headers.get('cf-ipcountry') || 'Unknown',
      ip: anonymizeIp(rawIp),
      timestamp: now,
      created_at: now,
    };

    // Race the write against a short timeout — never hold a slot on DB stress.
    await Promise.race([
      (async () => {
        const db = await getDb();
        await db.collection('analytics_events').insertOne(doc);
      })(),
      new Promise((resolve) => setTimeout(resolve, DB_TIMEOUT_MS)),
    ]);

    return NextResponse.json({ ok: true });
  } catch {
    // Analytics must never surface an error to the user.
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
