import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { classifyRequest } from '@/lib/analytics-ingest';
import { ALLOWED_EVENTS, ALLOWED_PROPS } from '@/lib/analytics-event-allowlist';

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

    // Unlike the book/page sink, non-human traffic is STORED here (tagged), not
    // dropped. These events are click-driven and low-volume, so crawlers can't
    // swamp them — and for the confirm_view/confirm_click pair the bot share IS
    // the finding: mail-security scanners fetch magic links, which is the whole
    // reason the interstitial exists (#3305). Dropping them would hide a
    // scanner-driven "drop-off" instead of explaining it. Read paths that want
    // humans only filter on traffic_class. (#3405)
    const { cls, userAgent, ip } = classifyRequest(request);

    const now = new Date();
    const doc = {
      event,
      ...sanitizeProps(body?.props),
      country: request.headers.get('x-vercel-ip-country') || request.headers.get('cf-ipcountry') || 'Unknown',
      ip,
      user_agent: userAgent,
      traffic_class: cls,
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
