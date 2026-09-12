/**
 * Classify a request by user-agent (+ Cloudflare bot signals) into one of five
 * traffic classes. Used at ingestion (`/api/track`) to answer "how much of the
 * library is read by humans vs. crawlers vs. AI?" — a question GA can't, and
 * one that matters when your content is exactly what AI wants to ingest.
 *
 * Order matters: AI agents/trainers often contain the substring "bot", so they
 * must be matched before the generic search/other-bot patterns.
 */

export type TrafficClass =
  | 'human'
  | 'ai_trainer' // crawls to build/train AI models or AI search indexes
  | 'ai_agent' // fetches live on behalf of a user (assistant browsing)
  | 'search_crawler' // traditional search-engine indexers
  | 'other_bot'; // SEO tools, scrapers, monitoring, CF-flagged, rate-capped

export const TRAFFIC_CLASS_LABELS: Record<TrafficClass, string> = {
  human: 'Humans',
  ai_agent: 'AI agents (live)',
  ai_trainer: 'AI crawlers',
  search_crawler: 'Search engines',
  other_bot: 'Other bots',
};

// AI assistants fetching a page live for a user (not bulk training crawls).
const AI_AGENT = /chatgpt-user|oai-searchbot|perplexity-user|claude-user|claude-web|google-cloudvertexbot|duckassistbot|gemini-user/i;

// Bulk crawlers feeding AI training sets or AI search indexes.
const AI_TRAINER = /gptbot|ccbot|claudebot|anthropic-ai|google-extended|bytespider|amazonbot|applebot-extended|cohere-ai|diffbot|imagesiftbot|omgili|meta-externalagent|facebookbot|perplexitybot|youbot|webzio|timpibot|ai2bot|panscient/i;

// Traditional search-engine indexers.
const SEARCH_CRAWLER = /googlebot|googleother|bingbot|bingpreview|slurp|duckduckbot|baiduspider|yandexbot|applebot|seznambot|sogou|exabot/i;

// Everything else automated: SEO tools, scrapers, monitors, generic libraries.
const OTHER_BOT = /ahrefs|semrush|mj12bot|dotbot|petalbot|dataforseo|screaming frog|bot\b|crawler|spider|headlesschrome|lightpanda|python-requests|curl|wget|axios|go-http-client|java\/|okhttp|scrapy|httpclient/i;

export function classifyTraffic(
  userAgent: string | null | undefined,
  cf?: { verifiedBot?: boolean; threatScore?: number; rateCapped?: boolean }
): TrafficClass {
  const ua = userAgent || '';

  if (AI_AGENT.test(ua)) return 'ai_agent';
  if (AI_TRAINER.test(ua)) return 'ai_trainer';
  if (SEARCH_CRAWLER.test(ua)) return 'search_crawler';

  // Spoofed-UA scrapers caught by the per-IP rate cap, or anything Cloudflare
  // already classifies as a bot, falls here even if the UA looks human.
  if (cf?.rateCapped) return 'other_bot';
  if (OTHER_BOT.test(ua)) return 'other_bot';
  if (cf?.verifiedBot) return 'other_bot';
  if (typeof cf?.threatScore === 'number' && cf.threatScore >= 30) return 'other_bot';

  // Empty UA is treated as human (matches prior ingestion behavior — too noisy
  // to classify, and often legitimate privacy-tooling).
  return 'human';
}
