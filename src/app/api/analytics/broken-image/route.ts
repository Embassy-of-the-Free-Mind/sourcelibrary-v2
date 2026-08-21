import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { clientIpFromHeaders } from '@/lib/analytics-ingest';

/**
 * Log broken-image reports from the client.
 *
 * Bot traffic is dropped at the door: link-preview crawlers (Meta, Slack,
 * etc.) request every page on the site and trigger image-load errors at
 * scale, drowning out the human signal. Bot reports get silently 200'd.
 *
 * POST /api/analytics/broken-image
 * Body: { urls: string[], page: string, timestamp: string }
 */
const DB_TIMEOUT_MS = 3000;

const BOT_RE = /bot|crawler|spider|preview|facebookexternalhit|meta-externalagent|slurp|slackbot|googlebot|bingbot|twitterbot|whatsapp|linkedinbot|telegrambot|discordbot|applebot|pingdom|uptime|monitor|headless/i;

export async function POST(request: NextRequest) {
  try {
    const { urls, page, timestamp } = await request.json();
    if (!Array.isArray(urls) || urls.length === 0) {
      return NextResponse.json({ ok: true });
    }

    const ua = request.headers.get('user-agent') || '';
    if (BOT_RE.test(ua)) {
      return NextResponse.json({ ok: true });
    }

    // Cap at 20 per report to prevent abuse
    const capped = urls.slice(0, 20);
    const ip = clientIpFromHeaders(request.headers);

    const dbWork = (async () => {
      const db = await getDb();
      await db.collection('broken_image_reports').insertOne({
        urls: capped,
        page,
        reported_at: timestamp ? new Date(timestamp) : new Date(),
        ip: ip.replace(/\.\d+$/, '.0'), // anonymize last octet
        ua: ua.slice(0, 200),
        created_at: new Date(),
      });
    })();

    const timeout = new Promise<'timeout'>((resolve) =>
      setTimeout(() => resolve('timeout'), DB_TIMEOUT_MS)
    );

    await Promise.race([dbWork, timeout]);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: true });
  }
}
