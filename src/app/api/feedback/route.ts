import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { withAdminAuth } from '@/lib/auth-helpers';
import { guardPublicSubmission } from '@/lib/public-submission-guard';
import { getClientIp } from '@/lib/rate-limit';

import { MAX_FEEDBACK_MESSAGE, MIN_FEEDBACK_MESSAGE } from '@/lib/feedback-limits';

/**
 * One constant, shared with the `submit_feedback` tool schema that advertises it.
 * Previously two literals kept in step by a comment — the same shape as the MCP
 * server version, which was written three times and drifted to three values on
 * the same day (#3715).
 */
const MAX_MESSAGE = MAX_FEEDBACK_MESSAGE;

// POST /api/feedback — save feedback
export async function POST(request: NextRequest) {
  try {
    const limited = await guardPublicSubmission(request, 'feedback');
    if (limited) return limited;

    const body = await request.json();
    const { message, page, name, email, wantsToHelp } = body;

    if (!message || typeof message !== 'string' || message.trim().length < MIN_FEEDBACK_MESSAGE) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 });
    }

    // Say WHAT the limit is and what arrived. A bare "Message too long" gives an
    // automated caller nothing to aim at, so it has to binary-search the ceiling
    // by trial — reported by an MCP client that lost two submissions to it
    // (#3653). The other public write routes (share-findings,
    // collection-proposals) already name their maxima; this one did not.
    if (message.length > MAX_MESSAGE) {
      return NextResponse.json({
        error: `Message too long: ${message.length} characters received, maximum ${MAX_MESSAGE}`,
        max_length: MAX_MESSAGE,
        received_length: message.length,
      }, { status: 400 });
    }

    const db = await getDb();
    // cf-connecting-ip first: behind the CDN, x-forwarded-for is a Cloudflare
    // edge node, so reading it first filed every submission under ~15 shared
    // addresses (#3491). Same helper the limiter above keys on.
    const ip = getClientIp(request);
    const trimmedEmail = email?.trim()?.toLowerCase() || null;
    const wantsHelp = wantsToHelp === true;

    // The MCP server proxies submit_feedback to this route server-side with its
    // own User-Agent, so the UA prefix is the one reliable origin signal we have.
    // Agent-written reports have a very different profile from human submissions
    // (long, high-volume, confidently wrong at a nontrivial rate), so the triage
    // surfaces split on this field. Backfill for pre-existing rows:
    // scripts/maintenance/backfill-feedback-channel.mjs
    const userAgent = request.headers.get('user-agent') || null;
    const channel = userAgent?.startsWith('SourceLibrary-MCP') ? 'mcp' : 'web';

    const doc = {
      message: message.trim(),
      page: page || null,
      name: name?.trim() || null,
      email: trimmedEmail,
      ip,
      user_agent: userAgent,
      channel,
      created_at: new Date(),
      read: false,
      wants_to_help: wantsHelp,
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
//   ?channel=mcp|web                filter by submission channel (mcp = agent via MCP tool)
//   ?unread=true                    legacy, equivalent to ?status=unread
export const GET = withAdminAuth(async (request: NextRequest) => {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200);
    const offset = parseInt(searchParams.get('offset') || '0');
    const unreadOnly = searchParams.get('unread') === 'true';
    const status = searchParams.get('status'); // 'unread' | 'read' | 'addressed'
    const channel = searchParams.get('channel'); // 'mcp' | 'web'

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
    // 'web' matches rows without the field so pre-backfill data still lists as human.
    const channelCond: Record<string, unknown> =
      channel === 'mcp' ? { channel: 'mcp' } :
      channel === 'web' ? { channel: { $ne: 'mcp' } } : {};
    Object.assign(query, channelCond);

    const [items, total, counts, channelCounts] = await Promise.all([
      db.collection('feedback')
        .find(query)
        .sort({ created_at: -1 })
        .skip(offset)
        .limit(limit)
        .toArray(),
      db.collection('feedback').countDocuments(query),
      // Lifecycle counts within the selected channel, so the tabs stay truthful.
      Promise.all([
        db.collection('feedback').countDocuments({ read: { $ne: true }, ...channelCond }),
        db.collection('feedback').countDocuments({ read: true, addressed: { $ne: true }, ...channelCond }),
        db.collection('feedback').countDocuments({ addressed: true, ...channelCond }),
      ]).then(([unread, read, addressed]) => ({ unread, read, addressed })),
      // Open (not-addressed) totals per channel, regardless of the active filter.
      Promise.all([
        db.collection('feedback').countDocuments({ addressed: { $ne: true }, channel: { $ne: 'mcp' } }),
        db.collection('feedback').countDocuments({ addressed: { $ne: true }, channel: 'mcp' }),
      ]).then(([web, mcp]) => ({ web, mcp })),
    ]);

    return NextResponse.json({ feedback: items, total, counts, channel_counts: channelCounts });
  } catch (error) {
    console.error('Feedback list error:', error);
    return NextResponse.json({ error: 'Failed to load feedback' }, { status: 500 });
  }
});
