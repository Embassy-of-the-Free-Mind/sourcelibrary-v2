/**
 * Robots policy, served as a custom route (not the Next metadata convention)
 * because we emit Content-Signal directives and the CC0 Content Signals
 * Policy preamble, which MetadataRoute.Robots cannot express.
 *
 * Two intents, deliberately separated:
 *
 *  1. SEARCH-INDEX crawlers (Googlebot, Bingbot, Claude-SearchBot, OAI-SearchBot)
 *     are ALLOWED on content. They are how readers discover and are sent to us;
 *     surfacing our pages in search/answers serves the mission.
 *
 *  2. TRAINING / BULK crawlers (ClaudeBot, GPTBot, Google-Extended, CCBot,
 *     Applebot-Extended, Meta-ExternalAgent, anthropic-ai, …) are RESERVED.
 *     Our translations are CC-BY-SA 4.0 — whose ShareAlike term is incompatible
 *     with proprietary model training — so AI training / text-and-data-mining
 *     requires a SEPARATE license. See https://sourcelibrary.org/licensing and
 *     the machine-readable reservation at /.well-known/tdmrep.json (TDMRep) plus
 *     the TDM-Reservation HTTP header. A standing rate card is published at
 *     /licensing ($250/book floor, $200K/yr full corpus); bulk/training access
 *     is available through the API or MCP server under a license — not by scraping.
 *
 * The Content-Signal lines (contentsignals.org) express the same policy in the
 * emerging IETF aipref vocabulary: search=yes, ai-input=yes, ai-train=no.
 * ai-input=yes is deliberate — assistants reading/quoting on a user's behalf
 * (RAG, grounding) are welcome; that's the mission. Training is the reserved use.
 *
 * This is the honor-system + express-reservation layer; the server-side bot gate
 * (src/lib/bot-gate.ts) is the enforcement layer.
 */

const BASE_URL = 'https://sourcelibrary.org';

// Our content signals: discovery and assistant reading are welcome; training
// is reserved (license available — see /licensing).
const CONTENT_SIGNAL = 'search=yes, ai-input=yes, ai-train=no';

// Canonical Content Signals Policy preamble (CC0, contentsignals.org).
// Keep verbatim — the wording is the shared legal instrument.
const POLICY_PREAMBLE = `# As a condition of accessing this website, you agree to abide by the following content signals:
#
# (a) If a content-signal = yes, you may collect content for the corresponding use.
# (b) If a content-signal = no, you may not collect content for the corresponding use.
# (c) If the website operator does not include a content signal for a corresponding use, the website operator neither grants nor restricts permission via content signal with respect to the corresponding use.
#
# The content signals and their meanings are:
#
# search: building a search index and providing search results (e.g., returning hyperlinks and short excerpts from your website's contents). Search does not include providing AI-generated search summaries.
# ai-input: inputting content into one or more AI models (e.g., retrieval augmented generation, grounding, or other real-time taking of content for generative AI search answers).
# ai-train: training or fine-tuning AI models.
#
# ANY RESTRICTIONS EXPRESSED VIA CONTENT SIGNALS ARE EXPRESS RESERVATIONS OF RIGHTS UNDER ARTICLE 4 OF THE EUROPEAN UNION DIRECTIVE 2019/790 ON COPYRIGHT AND RELATED RIGHTS IN THE DIGITAL SINGLE MARKET.
#
# AI training is licensable: a standing rate card and standard terms are at ${BASE_URL}/licensing (see also ${BASE_URL}/llms.txt).`;

// Endpoints a reserved AI crawler MAY still reach: the structured API, the
// partnership/licensing docs, and the blog. Everything else (full text) is reserved.
const AI_ALLOW_LIST = [
  '/blog/',
  '/api/search',
  '/api/books/',
  '/api/verify',
  '/api/mcp',
  '/llms.txt',
  '/terms',
  '/licensing',
  '/developers',
];
// Reserved crawlers that aren't given API access still get the public docs + blog.
const DOCS_ONLY = ['/blog/', '/llms.txt', '/terms', '/licensing', '/developers'];

const DEFAULT_DISALLOW = [
  '/book/*/pipeline',
  '/book/*/capture',
  '/book/*/qa',
  '/book/*/split',
  // Redirect-only URL. Every hit 308s to /book/{slug}/page/{pageId};
  // letting Google crawl this burns budget on tens of thousands of
  // redirects (showed up as "Blocked 403" / "Page with redirect" in GSC).
  '/book/*/page-number/',
  // Auto-generated thin concept stubs. Google classifies these as
  // soft-404 (see 2026-05-31 GSC Coverage report) and crawling them burns
  // budget that should go to the ~15K /book/ landing pages.
  '/encyclopedia/',
  '/api/',
  '/admin/',
  '/analytics',
  '/experiments/',
  '/jobs',
  '/processing',
  '/qa',
  '/data?admin=true',
  '/upload',
  '/auth/',
  '/beta/',
  '/unauthorized',
  '/reading-history',
  '/highlights',
  '/favorites',
];

type Group = { userAgent: string; allow?: string[]; disallow?: string[] };

// ── SEARCH-INDEX crawlers: explicitly welcome on content ──
// (Googlebot/Bingbot are already allowed via '*'; these AI search crawlers are
// named so the intent is unambiguous and they're never swept up with the
// training crawlers below.)
// ── TRAINING / BULK crawlers: RESERVED — see /licensing ──
// GPTBot/Claude-Web keep structured-API access (use the API/MCP, not
// scraping); the rest get the public docs + blog only. None get the full text.
const GROUPS: Group[] = [
  { userAgent: '*', allow: ['/'], disallow: DEFAULT_DISALLOW },
  { userAgent: 'Claude-SearchBot', allow: ['/'] },
  { userAgent: 'OAI-SearchBot', allow: ['/'] },
  { userAgent: 'GPTBot', allow: AI_ALLOW_LIST, disallow: ['/'] },
  { userAgent: 'Claude-Web', allow: AI_ALLOW_LIST, disallow: ['/'] },
  { userAgent: 'ClaudeBot', allow: DOCS_ONLY, disallow: ['/'] },
  { userAgent: 'Anthropic-AI', allow: DOCS_ONLY, disallow: ['/'] },
  { userAgent: 'Google-Extended', allow: DOCS_ONLY, disallow: ['/'] },
  { userAgent: 'Applebot-Extended', allow: DOCS_ONLY, disallow: ['/'] },
  // Previously blog-only; upgraded to DOCS_ONLY so every reserved crawler can
  // read the licensing terms it is being asked to honor.
  { userAgent: 'Meta-ExternalAgent', allow: DOCS_ONLY, disallow: ['/'] },
  { userAgent: 'CCBot', allow: DOCS_ONLY, disallow: ['/'] },
  { userAgent: 'Bytespider', allow: DOCS_ONLY, disallow: ['/'] },
  { userAgent: 'Diffbot', allow: DOCS_ONLY, disallow: ['/'] },
  { userAgent: 'Omgilibot', allow: DOCS_ONLY, disallow: ['/'] },
  { userAgent: 'FacebookBot', allow: DOCS_ONLY, disallow: ['/'] },
  { userAgent: 'Applebot', allow: DOCS_ONLY, disallow: ['/'] },
  { userAgent: 'PerplexityBot', allow: DOCS_ONLY, disallow: ['/'] },
  { userAgent: 'Amazonbot', allow: DOCS_ONLY, disallow: ['/'] },
  { userAgent: 'cohere-ai', allow: DOCS_ONLY, disallow: ['/'] },
];

function renderGroup(g: Group): string {
  const lines = [`User-agent: ${g.userAgent}`, `Content-Signal: ${CONTENT_SIGNAL}`];
  for (const a of g.allow ?? []) lines.push(`Allow: ${a}`);
  for (const d of g.disallow ?? []) lines.push(`Disallow: ${d}`);
  return lines.join('\n');
}

export const dynamic = 'force-static';

export function GET(): Response {
  const body = [
    POLICY_PREAMBLE,
    ...GROUPS.map(renderGroup),
    // RSL (Really Simple Licensing, rslstandard.org): machine-readable license
    // terms for automated agents — same policy as the Content-Signal lines and
    // /licensing, in the vocabulary the licensing marketplaces read (#4366).
    `License: ${BASE_URL}/license.xml`,
    `Sitemap: ${BASE_URL}/sitemap.xml`,
  ].join('\n\n') + '\n';

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
