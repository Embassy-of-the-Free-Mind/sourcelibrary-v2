import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { clientIpFromHeaders } from '@/lib/analytics-ingest';

/**
 * Auto-log 404 page hits.
 * Fire-and-forget — never fails to the client.
 *
 * POST /api/analytics/not-found
 * Body: { url: string, referrer?: string }
 */
const DB_TIMEOUT_MS = 3000;

export async function POST(request: NextRequest) {
  try {
    const { url, referrer } = await request.json();
    if (!url || typeof url !== 'string') {
      return NextResponse.json({ ok: true });
    }

    const ip = clientIpFromHeaders(request.headers);
    const ua = request.headers.get('user-agent') || '';

    const dbWork = (async () => {
      const db = await getDb();

      // Don't log 404s for books that are deliberately hidden from the public
      // reader. Hidden/in-copyright books correctly 404 via the reader gate
      // (isBookReadable, PR #2522), but bots and stale links keep re-crawling
      // their /book/<slug>[/page/<id>] URLs — ~27k/week of noise that buries the
      // real broken links. If the URL points at a known-hidden book, skip it.
      // Artworks are books-collection records too, and hidden ones (dedup
      // twins, curation removals) draw the same bot re-crawl noise on their
      // /artwork/<slug> URLs — they were the largest cluster in the log by
      // 2026-08. The art-<slug> twin is included because /artwork resolves it
      // (see src/lib/artwork-slug.ts).
      const contentMatch = url.match(/^\/(book|artwork)\/([^/?#]+)/);
      if (contentMatch) {
        const slug = decodeURIComponent(contentMatch[2]);
        const or: Record<string, string>[] = [{ slug }, { id: slug }];
        // The art-<slug> twin only resolves on /artwork URLs.
        if (contentMatch[1] === 'artwork') or.push({ slug: `art-${slug}` });
        const book = await db.collection('books').findOne(
          { $or: or },
          { projection: { visible: 1, hidden: 1 } },
        );
        if (book && (book.hidden === true || book.visible === false)) {
          return; // deliberately hidden — expected 404, not worth recording
        }
      }

      // Deduplicate: same URL + IP within 1 hour
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const anonIp = ip.replace(/\.\d+$/, '.0');

      await db.collection('not_found_reports').findOneAndUpdate(
        { url, ip: anonIp, created_at: { $gte: oneHourAgo } },
        {
          $setOnInsert: {
            url,
            referrer: referrer || null,
            ip: anonIp,
            ua: ua.slice(0, 200),
            created_at: new Date(),
          },
          $inc: { hit_count: 1 },
        },
        { upsert: true },
      );
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
