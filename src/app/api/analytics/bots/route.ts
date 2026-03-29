import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { withAuth } from '@/lib/auth-helpers';
import { anonymizeIp } from '@/lib/anonymize-ip';

const COLLECTION = 'analytics_bot_access';
const DB_TIMEOUT_MS = 3000;
let indexEnsured = false;

/**
 * POST /api/analytics/bots — fire-and-forget bot access logging
 * Called internally from middleware when a bot is detected.
 * Upserts a daily counter per user-agent category + path prefix.
 */
export async function POST(request: NextRequest) {
  try {
    // Only accept internal calls (no auth header needed, but check origin)
    const body = await request.json();
    const { userAgent, path, action, ip: rawIp } = body;

    if (!userAgent || !path) {
      return NextResponse.json({ success: true });
    }

    const ip = anonymizeIp(rawIp || 'unknown');
    const botName = classifyBot(userAgent);
    const pathPrefix = extractPathPrefix(path);
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

    const dbWrite = (async () => {
      const db = await getDb();
      const col = db.collection(COLLECTION);

      // Ensure compound index once per instance
      if (!indexEnsured) {
        col.createIndex(
          { bot: 1, path_prefix: 1, date: 1 },
          { name: 'bot_daily_idx', background: true }
        ).catch(() => {});
        indexEnsured = true;
      }

      // Upsert daily counter: one doc per bot+path_prefix+day
      await col.updateOne(
        { bot: botName, path_prefix: pathPrefix, date: today },
        {
          $inc: { hits: 1 },
          $set: { last_ua: userAgent.substring(0, 200), last_ip: ip },
          $addToSet: { actions: action || 'request', ips: ip },
          $setOnInsert: { created_at: new Date() },
        },
        { upsert: true }
      );
    })();

    const timeout = new Promise<'timeout'>((resolve) =>
      setTimeout(() => resolve('timeout'), DB_TIMEOUT_MS)
    );

    await Promise.race([dbWrite, timeout]);
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ success: true });
  }
}

/**
 * GET /api/analytics/bots — admin dashboard for bot access stats
 * Query params: days=N (default 30)
 */
export const GET = withAuth(async (request: NextRequest) => {
  try {
    const days = parseInt(request.nextUrl.searchParams.get('days') || '30', 10);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
      .toISOString().slice(0, 10);

    const db = await getDb();
    const col = db.collection(COLLECTION);

    const [result] = await col.aggregate([
      { $match: { date: { $gte: since } } },
      {
        $facet: {
          byBot: [
            {
              $group: {
                _id: '$bot',
                hits: { $sum: '$hits' },
                unique_ips: { $addToSet: '$ips' },
                paths: { $addToSet: '$path_prefix' },
                last_seen: { $max: '$date' },
              },
            },
            { $sort: { hits: -1 } },
          ],
          byDay: [
            {
              $group: {
                _id: '$date',
                hits: { $sum: '$hits' },
                bots: { $addToSet: '$bot' },
              },
            },
            { $sort: { _id: -1 } },
            { $limit: 30 },
          ],
          byPath: [
            {
              $group: {
                _id: '$path_prefix',
                hits: { $sum: '$hits' },
                bots: { $addToSet: '$bot' },
              },
            },
            { $sort: { hits: -1 } },
            { $limit: 20 },
          ],
          byAction: [
            { $unwind: '$actions' },
            {
              $group: {
                _id: '$actions',
                hits: { $sum: '$hits' },
              },
            },
            { $sort: { hits: -1 } },
          ],
          total: [
            {
              $group: {
                _id: null,
                hits: { $sum: '$hits' },
                unique_ips: { $addToSet: '$ips' },
              },
            },
          ],
        },
      },
    ]).toArray();

    // Flatten unique_ips (they come as arrays of arrays from $addToSet)
    const byBot = (result?.byBot || []).map((b: Record<string, unknown>) => ({
      bot: b._id,
      hits: b.hits,
      unique_ips: new Set((b.unique_ips as string[][]).flat()).size,
      paths: b.paths,
      last_seen: b.last_seen,
    }));

    const total = result?.total?.[0] || { hits: 0, unique_ips: [[]] };

    return NextResponse.json({
      period: { since, days },
      total_hits: total.hits || 0,
      total_unique_ips: new Set((total.unique_ips as string[][] || []).flat()).size,
      by_bot: byBot,
      by_day: result?.byDay || [],
      by_path: result?.byPath || [],
      by_action: result?.byAction || [],
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch bot analytics' },
      { status: 500 }
    );
  }
});

// --- Helpers ---

/** Classify a User-Agent string into a named bot category */
function classifyBot(ua: string): string {
  const lower = ua.toLowerCase();

  // MCP server (ours)
  if (lower.startsWith('sourcelibrary-mcp')) return 'sourcelibrary-mcp';

  // Major AI companies
  if (lower.includes('gptbot') || lower.includes('chatgpt') || lower.includes('oai-searchbot')) return 'openai';
  if (lower.includes('claudebot') || lower.includes('claude-web') || lower.includes('anthropic')) return 'anthropic';
  if (lower.includes('google-extended') || lower.includes('googlebot')) return 'google';
  if (lower.includes('bingbot') || lower.includes('msnbot')) return 'bing';
  if (lower.includes('perplexitybot')) return 'perplexity';
  if (lower.includes('bytespider') || lower.includes('bytedance')) return 'bytedance';
  if (lower.includes('cohere-ai')) return 'cohere';
  if (lower.includes('meta-externalagent')) return 'meta';
  if (lower.includes('youbot')) return 'you.com';

  // SEO crawlers
  if (lower.includes('semrush')) return 'semrush';
  if (lower.includes('ahrefsbot')) return 'ahrefs';
  if (lower.includes('mj12bot')) return 'majestic';
  if (lower.includes('ccbot')) return 'commoncrawl';

  // Generic bot patterns
  if (/bot|crawl|spider|scrape/i.test(lower)) return 'other-bot';
  if (/curl|wget|python|java\/|php\//i.test(lower)) return 'script';

  return 'unknown-bot';
}

/** Extract a meaningful path prefix for aggregation */
function extractPathPrefix(path: string): string {
  // API routes: keep first two segments
  if (path.startsWith('/api/')) {
    const parts = path.split('/').slice(0, 4); // /api/books/[id] → /api/books/*
    // Replace ObjectId-like segments with *
    return parts.map(p => /^[0-9a-f]{24}$/.test(p) ? '*' : p).join('/');
  }

  // Book pages
  if (path.startsWith('/book/')) return '/book/*';

  // Collection pages
  if (path.startsWith('/collection/')) return '/collection/*';

  // Keep other paths as-is (they're usually static routes)
  return path.split('?')[0];
}
