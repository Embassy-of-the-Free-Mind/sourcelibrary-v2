/**
 * The router for paraphrased page citations (#6946): one gemini-3.1-flash-lite
 * call per batch of finished paragraphs. Given the claims that carry a page link and the
 * pages the Librarian read, it names, per claim, the page that states it — or
 * none. It only ROUTES links (src/lib/embassy/citation-pages.ts applies the
 * moves); it never writes a word of the answer. Claude stays the arbiter of
 * prose; lite is trusted with nothing it could put in a reader's mouth.
 *
 * Fails open: a timeout, an API error or an unparseable reply returns no
 * verdicts, and every paraphrased link stays as the model wrote it.
 *
 * Latency: one call takes 0.7–1.3 s from the server (floor ~600 ms; ~20 ms per
 * 1K prompt tokens), against a budget of +800 ms p90 after the last text
 * chunk. So it is called WHILE the answer streams, paragraph batch by batch
 * (citation-routing.ts); cited pages go whole, the other pages only as the
 * passage that best matches some claim, and the usage row is not awaited.
 *
 * Measured (#6946): with its evidence guard it still moved 3 of 10 links onto
 * a page that supports the claim less than the one it left, so it is OFF by
 * default (LIBRARIAN_CITATION_ROUTER=1 in librarian.ts turns it on).
 *
 * PRIOR ART: src/lib/verify-first-translation.ts and src/lib/word-alignment.ts
 * (lite + JSON schema through getGeminiClient — the metered boundary, thinking
 * off by default; this follows the same shape); src/lib/embassy/grounding.ts
 * bestPage (deterministic word-overlap attach — it chooses a page for an
 * UNCITED paragraph and cannot tell a page about a topic from a page that
 * states the claim, which is the whole failure here).
 */
import { SchemaType } from '@google/generative-ai';
import { getGeminiClient } from '@/lib/gemini-client';
import { logGeminiCall, outputTokensFrom } from '@/lib/gemini-logger';
import { stripEditorialWrappers } from '@/lib/strip-editorial-wrappers';
import type { CitationRouter, RouteVerdict, RoutingClaim } from '@/lib/embassy/citation-pages';
import type { GroundingPage } from '@/lib/embassy/grounding';

export const CITATION_ROUTER_MODEL = 'gemini-3.1-flash-lite';

/** A cited page goes whole up to here: a cut page reads as "does not say it", and that drops a good link. */
const CITED_CHARS = 8000;
/** Another page goes as its best-matching passage: it can only gain a link, and Opus checks every move. */
const WINDOW_CHARS = 1500;
/** Pages besides the cited ones, best overlap first. */
const MAX_OTHER_PAGES = 8;

const pageText = (p: GroundingPage) =>
  stripEditorialWrappers((p.parts?.[0] || p.parts?.[2] || p.parts?.[1] || p.text || '').trim()).replace(/\n{3,}/g, '\n\n');

const wordsOf = (s: string) => new Set(s.toLowerCase().match(/[\p{L}\p{N}]{5,}/gu) ?? []);

/** The window of `text` holding the most claim words. */
function bestWindow(text: string, words: Set<string>): { text: string; hits: number } {
  if (text.length <= WINDOW_CHARS) return { text, hits: [...wordsOf(text)].filter(w => words.has(w)).length };
  const step = Math.floor(WINDOW_CHARS / 3);
  let best = { start: 0, hits: -1 };
  for (let start = 0; start < text.length; start += step) {
    const hits = [...wordsOf(text.slice(start, start + WINDOW_CHARS))].filter(w => words.has(w)).length;
    if (hits > best.hits) best = { start, hits };
  }
  return { text: `${best.start > 0 ? '…' : ''}${text.slice(best.start, best.start + WINDOW_CHARS)}${best.start + WINDOW_CHARS < text.length ? '…' : ''}`, hits: best.hits };
}

/** The pages handed to the model, by index, with the text each is shown as. */
export function routerPages(claims: RoutingClaim[], pages: GroundingPage[]): Array<{ i: number; text: string }> {
  const cited = new Set(claims.map(c => c.cited));
  const words = new Set(claims.flatMap(c => [...wordsOf(c.claim)]));
  const others = pages.map((p, i) => ({ i, ...(cited.has(i) ? { text: '', hits: -1 } : bestWindow(pageText(p), words)) }))
    .filter(o => !cited.has(o.i) && o.hits >= 3)
    .sort((a, b) => b.hits - a.hits)
    .slice(0, MAX_OTHER_PAGES);
  return [
    ...[...cited].map(i => ({ i, text: pageText(pages[i]).slice(0, CITED_CHARS) })),
    ...others.map(o => ({ i: o.i, text: o.text })),
  ];
}

export function routerPrompt(claims: RoutingClaim[], pages: GroundingPage[], shown = routerPages(claims, pages)): string {
  return [
    'You check citations. Each CLAIM is a sentence from an answer, linked to the book page marked "cited".',
    'Below the claims are the PAGES the answer was written from (some shown only in part).',
    'For each claim, give the page whose text states what the claim says: its facts, names and quotations, not',
    'only its topic. If the cited page states it, give the cited page. If several pages state it, prefer the',
    'cited page, then a page of the same book. If no page below states it, give "none".',
    'With the page, copy the words from that page (8 to 25 words, exactly as written there) that state it.',
    'For "none", give an empty string. Do not rewrite the claims. Reply in JSON.',
    '',
    '## CLAIMS',
    ...claims.map((c, i) => `C${i}: (cited: P${c.cited}) ${c.claim}`),
    '',
    '## PAGES',
    ...shown.map(({ i, text }) => `### P${i} — ${pages[i].bookTitle}, page ${pages[i].page}\n${text}\n`),
  ].join('\n');
}

export interface RouterUsage { inputTokens: number; outputTokens: number; ms: number }

/** The production router. `timeoutMs` bounds the call; on timeout nothing moves. */
export function flashLiteCitationRouter(opts: { timeoutMs: number; onUsage?: (u: RouterUsage) => void }): CitationRouter {
  return async (claims, pages) => {
    if (claims.length === 0) return [];
    const shown = routerPages(claims, pages);
    const labels = shown.map(x => `P${x.i}`);
    // Self-metered so the usage row is written after the answer, not awaited before it.
    const model = getGeminiClient({ selfMetered: true, reason: 'latency: the row is logged without awaiting (#6946)' }).getGenerativeModel({
      model: CITATION_ROUTER_MODEL,
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 2048,
        responseMimeType: 'application/json',
        responseSchema: {
          type: SchemaType.OBJECT,
          properties: {
            routes: {
              type: SchemaType.ARRAY,
              items: {
                type: SchemaType.OBJECT,
                properties: {
                  c: { type: SchemaType.INTEGER },
                  // Only the pages shown, or none: a page number it was never handed is not an answer.
                  p: { type: SchemaType.STRING, format: 'enum', enum: [...labels, 'none'] },
                  evidence: { type: SchemaType.STRING },
                },
                required: ['c', 'p', 'evidence'],
              },
            },
          },
          required: ['routes'],
        },
      },
    });
    const t0 = Date.now();
    const log = (status: 'success' | 'failed', inTok: number, outTok: number, error?: string) =>
      void logGeminiCall({
        type: 'other', mode: 'realtime', model: CITATION_ROUTER_MODEL, endpoint: 'librarian-citation-router',
        input_tokens: inTok, output_tokens: outTok, status, error_message: error, duration_ms: Date.now() - t0,
      }).catch(() => {});
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), opts.timeoutMs); });
    // Usage is logged when the call returns, even after the timeout: spend is spend.
    const call = model.generateContent(routerPrompt(claims, pages, shown)).then(r => {
      log('success', r.response.usageMetadata?.promptTokenCount || 0, outputTokensFrom(r.response.usageMetadata));
      return r.response;
    }).catch(err => {
      log('failed', 0, 0, String(err?.message ?? err).slice(0, 500));
      return null;
    });
    const response = await Promise.race([call, timeout]);
    if (timer) clearTimeout(timer);
    if (!response) return [];
    const u = response.usageMetadata;
    opts.onUsage?.({ inputTokens: u?.promptTokenCount ?? 0, outputTokens: outputTokensFrom(u), ms: Date.now() - t0 });
    let reply = '';
    try { reply = response.text(); } catch { return []; }
    // A page that was never handed over is a guess: that claim stays as written.
    const handed = new Set(shown.map(x => x.i));
    return parseRoutes(reply, claims.length, pages.length).filter(v => v.page === null || handed.has(v.page));
  };
}

/** Verdicts from the reply; anything malformed is dropped (that claim stays as written). */
export function parseRoutes(reply: string, nClaims: number, nPages: number): RouteVerdict[] {
  let parsed: unknown;
  try { parsed = JSON.parse(reply); } catch { return []; }
  const routes = (parsed as { routes?: unknown })?.routes;
  if (!Array.isArray(routes)) return [];
  const seen = new Set<number>();
  const out: RouteVerdict[] = [];
  for (const r of routes) {
    const c = (r as { c?: unknown }).c;
    const p = (r as { p?: unknown }).p;
    const evidence = (r as { evidence?: unknown }).evidence;
    if (typeof c !== 'number' || !Number.isInteger(c) || c < 0 || c >= nClaims || seen.has(c)) continue;
    let page: number | null;
    if (p === 'none' || p === null) page = null;
    else {
      const m = typeof p === 'string' ? p.match(/^P(\d+)$/) : null;
      page = m ? Number(m[1]) : typeof p === 'number' ? p : NaN;
      if (!Number.isInteger(page) || page < 0 || page >= nPages) continue;
    }
    seen.add(c);
    out.push({ claim: c, page, evidence: typeof evidence === 'string' && evidence.trim() ? evidence.trim().slice(0, 400) : undefined });
  }
  return out;
}
