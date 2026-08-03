import type { NextRequest } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { classifyTraffic, type TrafficClass } from '@/lib/traffic-classification';

/**
 * Server-side counter for non-human requests, written from the proxy.
 *
 * Why this exists, and why it is not `analytics_traffic_class`:
 *
 * `analytics_traffic_class` is fed by `/api/track`, which is a **client-side
 * beacon**. Bots do not execute JavaScript, so a server-rendered request from
 * OAI-SearchBot never fires it. The classifier there is correct; it is simply
 * positioned downstream of the traffic it is meant to classify. Measured
 * 2026-08-01: that counter read `ai_agent: 2` over 30 days, while curl proved
 * OAI-SearchBot and ChatGPT-User both receive full 330KB book pages (200), and
 * `analytics_pageviews` recorded 5 Googlebot hits in the same window on a
 * 36,000-book site. Those were not measurements of low bot traffic. They were
 * not measurements of bot traffic. See #3519.
 *
 * The proxy sees every request including bots, so this is the only point where
 * the evidence exists — the same "classify at WRITE time, at ingestion" rule
 * CLAUDE.md draws from #3405, applied one layer up.
 *
 * **Separate collection, deliberately.** Humans are ~99% of traffic and are
 * already counted by the beacon; incrementing the same counter here would
 * double-count them and silently corrupt an existing long-term series. So this
 * records non-human classes only, in its own collection, and the two are never
 * summed.
 *
 * Two things it records that the beacon never could:
 *   - **the operator**, not just the class — "how much does OpenAI use us" is
 *     unanswerable from a single `ai_agent` bucket;
 *   - **refusals**, because a blocked training crawler's attempt rate is
 *     evidence of demand for the licence published at /licensing.
 */

/** Operator behind a user-agent. Coarse on purpose — one row per operator per day. */
const OPERATORS: ReadonlyArray<readonly [string, RegExp]> = [
  ['openai', /gptbot|oai-searchbot|chatgpt-user/i],
  ['anthropic', /claudebot|claude-web|claude-user|anthropic-ai|claude-searchbot/i],
  ['google', /googlebot|googleother|google-extended|google-cloudvertexbot|gemini-user/i],
  ['perplexity', /perplexitybot|perplexity-user/i],
  ['meta', /meta-externalagent|facebookbot/i],
  ['bytedance', /bytespider/i],
  ['amazon', /amazonbot/i],
  ['apple', /applebot/i],
  ['microsoft', /bingbot|bingpreview/i],
  ['commoncrawl', /ccbot/i],
  ['cohere', /cohere-ai/i],
  ['duckduckgo', /duckduckbot|duckassistbot/i],
];

/** Which company's agent is this? `other` when no operator pattern matches. */
export function operatorFor(userAgent: string | null | undefined): string {
  const ua = userAgent || '';
  for (const [name, re] of OPERATORS) if (re.test(ua)) return name;
  return 'other';
}

export interface AgentRequestRecord {
  cls: TrafficClass;
  operator: string;
  /** 'served' when we returned content, 'refused' when the request was blocked. */
  outcome: 'served' | 'refused';
}

/**
 * Classify a request and, if it is non-human, return what should be counted.
 * Returns null for human traffic (already counted by the beacon — see above).
 */
export function classifyAgentRequest(
  request: NextRequest,
  outcome: 'served' | 'refused',
): AgentRequestRecord | null {
  const ua = request.headers.get('user-agent') || '';
  const cls = classifyTraffic(ua, {
    verifiedBot: request.headers.get('cf-verified-bot') === 'true',
  });
  if (cls === 'human') return null;
  return { cls, operator: operatorFor(ua), outcome };
}

/**
 * Increment the per-day/host/class/operator/outcome counter.
 *
 * Aggregate only: no per-request rows, no IP, no path, no TTL. One document per
 * (day, host, class, operator, outcome) combination — a few dozen a day at most.
 *
 * Never awaited by the proxy: a counter must not be able to delay or fail a
 * page. Errors are swallowed here and only here.
 */
export async function recordAgentRequest(
  host: string,
  rec: AgentRequestRecord,
): Promise<void> {
  try {
    const day = new Date().toISOString().slice(0, 10);
    const db = await getDb();
    await db.collection('analytics_agent_requests').updateOne(
      { _id: `${day}|${host}|${rec.cls}|${rec.operator}|${rec.outcome}` } as never,
      {
        $inc: { count: 1 },
        $setOnInsert: {
          day,
          host,
          class: rec.cls,
          operator: rec.operator,
          outcome: rec.outcome,
        },
      },
      { upsert: true },
    );
  } catch {
    // A measurement must never break a page. Silence is correct here and
    // nowhere else in this module.
  }
}
