/**
 * Presence heartbeat — POST /api/presence
 *
 * A tiny anonymous ping the reader page (and the global footer chip) sends
 * every ~50s while open. Powers the "N people are reading right now" line
 * (issue #3059). One self-expiring doc per browser, keyed on an anonymous
 * localStorage UUID. No IP, no login, no PII is stored — the visitor_id is
 * random and is never returned to anyone.
 *
 * See src/lib/presence.ts for the aggregate read path and design invariants.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { classifyTraffic } from '@/lib/traffic-classification';
import {
  PRESENCE_COLLECTION,
  TTL_MS,
  VISITOR_ID_RE,
  BOOK_KEY_RE,
  ensurePresenceIndex,
} from '@/lib/presence';

// Presence is non-critical — never hold a serverless slot on a slow DB.
const DB_TIMEOUT_MS = 2000;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const visitorId = typeof body.visitor_id === 'string' ? body.visitor_id : '';
    // `book` is the slug-or-id from the reader URL; absent on non-book pages.
    const book = typeof body.book === 'string' && BOOK_KEY_RE.test(body.book) ? body.book : null;

    if (!VISITOR_ID_RE.test(visitorId)) {
      // Malformed/absent id — accept quietly, record nothing.
      return NextResponse.json({ ok: true });
    }

    // Bot filter — same Cloudflare signals as /api/views. Scrapers must not
    // inflate the live count.
    const ua = request.headers.get('user-agent') || '';
    const cfVerifiedBot = request.headers.get('cf-verified-bot') === 'true';
    const cfThreat = parseInt(request.headers.get('cf-threat-score') || '', 10);
    const cls = classifyTraffic(ua, {
      verifiedBot: cfVerifiedBot,
      threatScore: Number.isFinite(cfThreat) ? cfThreat : undefined,
    });
    if (cls !== 'human') {
      return NextResponse.json({ ok: true });
    }

    const now = new Date();
    const dbWrite = (async () => {
      const db = await getDb();
      await ensurePresenceIndex(db);
      await db.collection(PRESENCE_COLLECTION).updateOne(
        { visitor_id: visitorId }, // one doc per browser; unique index enforces it
        {
          $set: { book, updated_at: now, expireAt: new Date(now.getTime() + TTL_MS) },
          $setOnInsert: { created_at: now },
        },
        { upsert: true }
      );
    })();
    const timeout = new Promise<'timeout'>((resolve) =>
      setTimeout(() => resolve('timeout'), DB_TIMEOUT_MS)
    );
    await Promise.race([dbWrite, timeout]);

    return NextResponse.json({ ok: true });
  } catch {
    // Presence must never error to the client.
    return NextResponse.json({ ok: true });
  }
}
