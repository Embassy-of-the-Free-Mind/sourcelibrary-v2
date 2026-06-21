import { NextRequest, NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'crypto';
import { getDb } from '@/lib/mongodb';

/**
 * Resend webhook receiver — logs email delivery events (sent, delivered,
 * bounced, complained, opened, clicked, failed) into the `email_events`
 * collection so we can compute bounce/open/complaint/click rates for
 * broadcasts (e.g. the staged user broadcast in
 * scripts/send-user-broadcast.mjs). Aggregate with
 * scripts/email-broadcast-stats.mjs.
 *
 * Resend signs webhooks with Svix-style headers (svix-id / svix-timestamp /
 * svix-signature). We verify the HMAC so the public endpoint can't be spoofed.
 */

const RELEVANT = new Set([
  'email.sent',
  'email.delivered',
  'email.delivery_delayed',
  'email.bounced',
  'email.complained',
  'email.opened',
  'email.clicked',
  'email.failed',
]);

/** Verify the Svix signature Resend sends. Returns true if any v1 sig matches. */
function verifySignature(secret: string, headers: Headers, body: string): boolean {
  const id = headers.get('svix-id');
  const timestamp = headers.get('svix-timestamp');
  const sigHeader = headers.get('svix-signature');
  if (!id || !timestamp || !sigHeader) return false;

  // secret is "whsec_<base64>"; the HMAC key is the decoded base64.
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const signedContent = `${id}.${timestamp}.${body}`;
  const expected = createHmac('sha256', key).update(signedContent).digest('base64');

  // svix-signature is a space-separated list of "v1,<sig>" entries.
  return sigHeader.split(' ').some((part) => {
    const sig = part.split(',')[1];
    if (!sig) return false;
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  });
}

export async function POST(request: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 503 });
  }

  const body = await request.text();
  if (!verifySignature(secret, request.headers, body)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  let event: { type?: string; created_at?: string; data?: Record<string, unknown> };
  try {
    event = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const type = event.type || 'unknown';
  if (!RELEVANT.has(type)) {
    return NextResponse.json({ received: true, ignored: type });
  }

  const data = event.data || {};
  const to = Array.isArray(data.to) ? (data.to[0] as string) : (data.to as string | undefined);

  try {
    const db = await getDb();
    // Idempotent on (email_id, type) so Resend retries don't double-count.
    await db.collection('email_events').updateOne(
      { email_id: data.email_id ?? null, type },
      {
        $set: {
          email_id: data.email_id ?? null,
          type,
          to: to ?? null,
          broadcast_id: (data.broadcast_id as string) ?? null,
          subject: (data.subject as string) ?? null,
          bounce: data.bounce ?? null,
          click: data.click ?? null,
          event_at: event.created_at ? new Date(event.created_at) : null,
          received_at: new Date(),
          raw: data,
        },
      },
      { upsert: true }
    );
  } catch (error) {
    console.error('[resend-webhook] store failed:', error);
    return NextResponse.json({ error: 'Store failed' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
