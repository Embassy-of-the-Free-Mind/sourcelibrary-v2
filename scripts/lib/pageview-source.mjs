/**
 * Where did this pageview come from? One answer for every audience report.
 *
 * PRIOR ART: src/lib/email-utm.ts reads and writes the tags but names no source.
 * scripts/analytics/usage-deepdive.mjs, scripts/analytics/snapshot-metrics.mjs and
 * src/lib/analytics-traffic.ts each derived a source from `referrer` alone, inline,
 * and none read `utm`. Those three copies are what this replaces.
 *
 * Why: a link opened from ChatGPT arrives with `utm_source=chatgpt.com` and, in
 * most cases, no referrer, so a report that reads only `referrer` files the reader
 * under "direct". Measured 2026-11-11 to 11-12: 1,397 pageviews carried the tag,
 * 1,290 of them with `referrer: 'direct'`, while the referrer count for chatgpt.com
 * read 1 in seven days (v2#8161).
 *
 * The rule: the tag wins when there is one, otherwise the referrer, otherwise
 * direct. A row has exactly one source, so nothing is counted twice.
 *
 * Two things a reader of these numbers must know:
 *  - `analytics_pageviews.utm` exists only from UTM_SINCE (#8507). A window that
 *    starts earlier undercounts every tagged source for the days before it.
 *  - A pageview count is NOT a count of arrivals, for any source. The tag stays in
 *    the URL while a reader turns pages, and the referrer is sent again on in-app
 *    navigation, each at its own rate. Measured 2026-11-11 and 11-12: 1,399 rows
 *    tagged chatgpt.com came from 489 visitor-days (one visitor made 133 of them),
 *    and 3,706 rows with a Google referrer came from 580. So compare sources by
 *    VISITORS, and never set one source's rows beside another's as if both were
 *    arrivals. Every table built here is ordered by visitors and names its unit.
 *
 * Plain JavaScript on purpose: the daily snapshot runs this under the job box's
 * Node, and src/lib/analytics-traffic.ts imports it too.
 */

/** First day `analytics_pageviews` rows carry `utm` (#8507). */
export const UTM_SINCE = '2026-11-11';

/** The line every report prints beside a source table. */
export const UTM_NOTE =
  `A source is the utm tag when the link has one, otherwise the referrer. Tags are stored only from ${UTM_SINCE}, ` +
  'so a longer window undercounts tagged sources (ChatGPT, newsletter) before that day. ' +
  'Compare sources by visitors (address plus user agent, distinct over the window): ' +
  'a tag or a referrer repeats on several pages of one visit, so pageviews are not arrivals.';

/**
 * Assistants a reader can arrive from, with every spelling we accept for each:
 * referrer hosts and utm_source values, lower case. `kagi.com` is a search engine
 * and stays a plain referrer; only its assistant host is listed.
 */
export const ASSISTANT_SOURCES = [
  { label: 'ChatGPT', keys: ['chatgpt.com', 'chat.openai.com', 'chatgpt', 'openai'] },
  { label: 'Claude', keys: ['claude.ai', 'claude'] },
  { label: 'Perplexity', keys: ['perplexity.ai', 'www.perplexity.ai', 'perplexity'] },
  { label: 'Gemini', keys: ['gemini.google.com', 'bard.google.com', 'gemini'] },
  { label: 'Copilot', keys: ['copilot.microsoft.com', 'copilot.com', 'copilot'] },
  { label: 'Grok', keys: ['grok.com', 'x.ai', 'grok'] },
  { label: 'Kagi Assistant', keys: ['assistant.kagi.com'] },
  { label: 'Yuanbao', keys: ['yuanbao.tencent.com', 'yuanbao'] },
  { label: 'DeepSeek', keys: ['chat.deepseek.com', 'deepseek.com', 'deepseek'] },
  { label: 'Mistral', keys: ['chat.mistral.ai', 'mistral'] },
  { label: 'Meta AI', keys: ['meta.ai', 'www.meta.ai'] },
  { label: 'Duck.ai', keys: ['duck.ai'] },
  { label: 'NotebookLM', keys: ['notebooklm.google.com', 'notebooklm'] },
  { label: 'Poe', keys: ['poe.com'] },
  { label: 'You.com', keys: ['you.com'] },
  { label: 'Phind', keys: ['phind.com', 'www.phind.com'] },
  { label: 'Kimi', keys: ['kimi.com', 'www.kimi.com', 'kimi.moonshot.cn'] },
  { label: 'Doubao', keys: ['doubao.com', 'www.doubao.com'] },
  { label: 'Genspark', keys: ['genspark.ai', 'www.genspark.ai'] },
  { label: 'Felo', keys: ['felo.ai'] },
  { label: 'Metaso', keys: ['metaso.cn'] },
];

const LABEL_BY_KEY = new Map(ASSISTANT_SOURCES.flatMap((a) => a.keys.map((k) => [k, a.label])));
const ASSISTANT_LABELS = new Set(ASSISTANT_SOURCES.map((a) => a.label));

/** True when a source name (as returned below) is an assistant. */
export function isAssistantSource(source) {
  return ASSISTANT_LABELS.has(source);
}

/** A stored referrer as a bare host: no scheme, no path. Empty becomes 'direct'. */
function referrerHost(referrer) {
  if (typeof referrer !== 'string') return 'direct';
  return referrer.trim().replace(/^https?:\/\//i, '').split('/')[0] || 'direct';
}

/** Name one raw value, a utm_source or a referrer host. Unknown values pass through unchanged. */
export function sourceLabel(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return 'direct';
  const value = raw.trim();
  return LABEL_BY_KEY.get(value.toLowerCase()) || value;
}

/**
 * The source of one `analytics_pageviews` row.
 * @param {{ referrer?: string | null, utm?: { source?: string | null } | null }} row
 * @returns {{ source: string, via: 'utm' | 'referrer' | 'direct', assistant: boolean }}
 */
export function pageviewSource(row) {
  const tag = typeof row?.utm?.source === 'string' ? row.utm.source.trim() : '';
  if (tag) {
    const source = sourceLabel(tag);
    return { source, via: 'utm', assistant: ASSISTANT_LABELS.has(source) };
  }
  const host = referrerHost(row?.referrer);
  if (host === 'direct') return { source: 'direct', via: 'direct', assistant: false };
  const source = sourceLabel(host);
  return { source, via: 'referrer', assistant: ASSISTANT_LABELS.has(source) };
}

/**
 * Tally sources over rows, counting each row once: distinct visitors and pageviews
 * per source. The caller chooses what a visitor is (the reports use address + user
 * agent). Visitors are the unit to compare by; see the note at the top.
 */
export function createSourceTally() {
  const pageviews = new Map();
  const visitors = new Map();
  const assistantDays = new Map(); // 'YYYY-MM-DD' -> Set of visitors who arrived from any assistant
  return {
    /** @param {object} row  @param {string} [visitorKey]  @param {string} [day] 'YYYY-MM-DD', for the per-day assistant count */
    add(row, visitorKey, day) {
      const { source, assistant } = pageviewSource(row);
      pageviews.set(source, (pageviews.get(source) || 0) + 1);
      if (!visitors.has(source)) visitors.set(source, new Set());
      if (visitorKey) visitors.get(source).add(visitorKey);
      if (assistant && visitorKey && day) {
        if (!assistantDays.has(day)) assistantDays.set(day, new Set());
        assistantDays.get(day).add(visitorKey);
      }
    },
    /** Rows ordered by visitors, then pageviews: { source, visitors, pageviews, assistant }. */
    rows() {
      return [...pageviews.entries()]
        .map(([source, n]) => ({ source, pageviews: n, visitors: visitors.get(source).size, assistant: ASSISTANT_LABELS.has(source) }))
        .sort((a, b) => b.visitors - a.visitors || b.pageviews - a.pageviews);
    },
    /**
     * Every assistant together: one line for "readers arriving from assistants".
     * `visitors` is distinct over the whole window, and a visitor who used two
     * assistants counts once. `byDay` counts a visitor once on each day they came,
     * which is the per-day figure; dividing `visitors` by the days is not.
     */
    assistants() {
      const bySource = this.rows().filter((r) => r.assistant);
      const all = new Set();
      for (const r of bySource) for (const v of visitors.get(r.source)) all.add(v);
      const byDay = [...assistantDays.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, set]) => ({ date, visitors: set.size }));
      return { visitors: all.size, pageviews: bySource.reduce((s, r) => s + r.pageviews, 0), bySource, byDay };
    },
  };
}

// ── The same rule as MongoDB expressions, for reports that group in the database ──

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Aggregation expression that names a pageview's source exactly as pageviewSource()
 * does. Built from ASSISTANT_SOURCES, so the two cannot drift.
 */
export function sourceExpr() {
  const raw = {
    $let: {
      vars: { tag: { $trim: { input: { $ifNull: ['$utm.source', ''] } } }, ref: { $ifNull: ['$referrer', ''] } },
      in: { $cond: [{ $ne: ['$$tag', ''] }, '$$tag', { $cond: [{ $eq: ['$$ref', ''] }, 'direct', '$$ref'] }] },
    },
  };
  return {
    $let: {
      vars: { raw },
      in: {
        $switch: {
          branches: ASSISTANT_SOURCES.map((a) => ({ case: { $in: [{ $toLower: '$$raw' }, a.keys] }, then: a.label })),
          default: '$$raw',
        },
      },
    },
  };
}

/**
 * A `$match` condition selecting the rows whose source is `source`, as named above.
 * Plain field conditions, so it can sit beside the timestamp in the first stage.
 */
export function sourceFilter(source) {
  const assistant = ASSISTANT_SOURCES.find((a) => a.label === source);
  const untagged = { 'utm.source': { $in: [null, ''] } };
  if (source === 'direct') return { $and: [untagged, { referrer: { $in: [null, '', 'direct'] } }] };
  const values = assistant
    ? assistant.keys.map((k) => new RegExp(`^${escapeRegex(k)}$`, 'i'))
    : [source];
  return { $or: [{ 'utm.source': { $in: values } }, { ...untagged, referrer: { $in: values } }] };
}
