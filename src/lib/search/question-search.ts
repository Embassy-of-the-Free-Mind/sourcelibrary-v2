/**
 * Question search (#6875): find the pages that answer a reader's question,
 * not the pages that share its words.
 *
 * The candidates are what production search already finds: the Atlas keyword
 * page lane read to KEYWORD_CANDIDATES and the semantic page lane read to
 * SEMANTIC_CANDIDATES. Jev (`typesafe-ai/jev` on the Vercel AI Gateway) then
 * scores each translated page against the question with two wordings, and the
 * top RESULTS are returned, at most PER_BOOK a book. Pages with no English go in
 * a separate list from the original-text lane, because Jev reads English and
 * would drop them.
 *
 * Measured on 30 questions written in advance (scripts/eval/experiments/
 * 2026-10-17-question-search-jev-rerank-6875.md): a relevant page in 98% of
 * top-10 slots, against 54% for search_translations and 70% for
 * search_concept, at about $0.011 and 2 s a question.
 *
 * Failure is visible: with no token, an auth error, the daily cap reached, or
 * too many Jev calls failing, the caller gets the un-reranked candidates and a
 * note saying so. Never an empty list when the lanes found pages.
 *
 * PRIOR ART: scripts/eval/question-search-6875/{pool.ts,jev-rank.mjs} — the
 *   experiment's offline pool builder and ranker, file-based and run from a job
 *   box; this is the same lanes and the same Jev call inside a request.
 *   src/lib/search/librarian-search.ts (hybridSearch) — RRF over short lanes,
 *   no question-level re-rank; its passageWindow is reused here.
 */

import { getDb } from '@/lib/mongodb';
import { buildPageSearchStage, NON_CONTENT_PAGE_TYPES } from '@/lib/atlas-search';
import { semanticPageSearchGlobal, semanticPageSearchUntranslated } from '@/lib/semantic-search';
import { GLOBAL_SCOPE } from '@/lib/tenant-search-scope';
import { stripProvenanceMarks } from '@/lib/provenance';
import { stripEditorialWrappers } from '@/lib/strip-editorial-wrappers';
import { stripAiAnnotations } from '@/lib/notes-off';
import { isEnglishOriginalPage } from '@/lib/english-page-language';
import { serveEnglishOriginalPage } from '@/lib/english-original-text';
import { passageWindow } from '@/lib/search/librarian-search';
import { checkRateLimitShared } from '@/lib/rate-limit';
import { logAiUsage } from '@/lib/log-ai-usage';
import { authorSlug as toAuthorSlug } from '@/lib/slugify';

export const KEYWORD_CANDIDATES = 200;
export const SEMANTIC_CANDIDATES = 100;
export const RESULTS = 10;
export const UNTRANSLATED_RESULTS = 5;
export const PER_BOOK = 2;
/** Characters of each page Jev reads (the experiment's setting). */
const JEV_CHARS = 4000;
/** A page needs this much translation to be read as translated. */
const MIN_TRANSLATION_CHARS = 200;
const JEV_CONCURRENCY = 48;
const JEV_CALL_TIMEOUT_MS = 8000;
/** Wall clock for the whole re-rank; pages not scored by then are left out of the ranking. */
const JEV_BUDGET_MS = 15000;
/**
 * Once every page is sent and TAIL_SHARE of them have answered, the rest get
 * this long and are then dropped. Without it a few slow gateway calls held two
 * of ten local runs at ~9 s against a usual ~2 s (2026-10-19).
 */
const TAIL_SHARE = 0.9;
const TAIL_GRACE_MS = 1000;
const KEYWORD_TIMEOUT_MS = 8000;
/**
 * Re-ranked searches per UTC day, all callers together. ~$0.011 each, so the
 * default 300 holds the tool under ~$3.30 a day; the Librarian took 60–200
 * questions a day in October 2026. Past it the tool returns the un-reranked
 * list and says so.
 */
const DAILY_CAP = Number(process.env.LIBRARIAN_QUESTION_SEARCH_DAILY_CAP) || 300;
const JEV_URL = 'https://ai-gateway.vercel.sh/typesafe/v1/systemone';

export interface QuestionPassage {
  book_id: string;
  bookTitle: string;
  bookAuthor: string;
  /** Resolvable `/author/<authorSlug>` (books.author_id, else the slug of the stored name), as hybridSearch gives it. */
  authorSlug?: string;
  bookSlug?: string;
  year?: number;
  language?: string;
  page_number: number;
  /** The page's own words: a window of the translation (or English original), cleaned of AI notes. */
  text: string;
  /** Jev's score in [0, 1]; absent when the list was not re-ranked. */
  score?: number;
  lanes: string[];
}

export interface QuestionSearchResult {
  passages: QuestionPassage[];
  /** Pages with no English: the page's own language, from the original-text and keyword lanes. */
  untranslated: QuestionPassage[];
  reranked: boolean;
  /** Why the list was not (fully) re-ranked, in words for the model to pass on. */
  note?: string;
  candidates: number;
  scored: number;
  costUsd: number;
  ms: { lanes: number; jev: number; total: number };
}

interface Candidate {
  book_id: string;
  page_number: number;
  lanes: Set<string>;
  text?: string;
  english?: boolean;
  score?: number;
}

const key = (b: string, p: number) => `${b}:${p}`;

/** A page's own words, cleaned of AI notes and markup. Exported for the Librarian's whole-page view (#6946). */
export function cleanPassageText(s: string): string {
  return clean(s);
}

function clean(s: string): string {
  return stripAiAnnotations(stripEditorialWrappers(stripProvenanceMarks(s)))
    .replace(/<[^>]{1,80}>/g, ' ')
    .replace(/\[\[[^\]]{0,200}\]\]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

let routeOidcToken: string | undefined;

/**
 * The chat route hands over the `x-vercel-oidc-token` header of the request it
 * is serving. The token names the project and environment, not the reader, so
 * the latest one is good for any turn; this covers a tool call that runs after
 * the request context is gone (inside the response stream).
 */
export function noteOidcToken(token: string | null | undefined): void {
  if (token) routeOidcToken = token;
}

/**
 * The function's OIDC token, as `@vercel/oidc` reads it: the per-request
 * header Vercel injects (through the request context), else the one the route
 * noted, else the env var `vercel env pull` writes for local runs. Undefined
 * off Vercel with no pull.
 */
export function vercelOidcToken(): string | undefined {
  const ctx = (globalThis as Record<symbol, { get?: () => { headers?: Record<string, string> } } | undefined>)[
    Symbol.for('@vercel/request-context')
  ];
  return ctx?.get?.()?.headers?.['x-vercel-oidc-token'] ?? routeOidcToken ?? process.env.VERCEL_OIDC_TOKEN ?? undefined;
}

export const jevWordings = (q: string) => ({
  w1: { type: 'noul', instructions: `A reader searching a library of old books asked for: "${q}". This page contains such a passage: the page itself presents what the reader asked for, not merely the same words or a passing mention of the topic.` },
  w2: { type: 'noul', instructions: `This page contains nothing a reader asking for "${q}" wants: at most it shares some words with the request or touches the topic in passing.` },
});

class JevAuthError extends Error {}

async function jevScore(token: string, state: string, questions: ReturnType<typeof jevWordings>, deadline: number, tail: AbortSignal): Promise<{ score: number; cost: number } | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const left = deadline - Date.now();
    if (left < 500 || tail.aborted) return null;
    try {
      const r = await fetch(JEV_URL, {
        method: 'POST',
        signal: AbortSignal.any([AbortSignal.timeout(Math.min(JEV_CALL_TIMEOUT_MS, left)), tail]),
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'typesafe-ai/jev', state, questions }),
      });
      if (r.status === 401 || r.status === 403) throw new JevAuthError(`Jev auth ${r.status}`);
      if (!r.ok) continue;
      const j = await r.json();
      const w1 = j.answers?.w1?.noul;
      const w2 = j.answers?.w2?.noul;
      if (typeof w1 !== 'number' || typeof w2 !== 'number') continue;
      return { score: (w1 + 1 - w2) / 2, cost: Number(j.provider_metadata?.gateway?.marketCost || 0) };
    } catch (e) {
      if (e instanceof JevAuthError) throw e;
    }
  }
  return null;
}

/**
 * Function words dropped from the keyword lane's query. A question is mostly
 * these, and each one matches nearly every page: "instructions for preparing a
 * talisman at a particular hour of the planets" read its 200 pages in 4.7 s,
 * the same question without them in 0.7 s (2026-10-19).
 */
const KEYWORD_STOPWORDS = new Set(['a', 'an', 'the', 'of', 'in', 'on', 'at', 'to', 'for', 'from', 'by', 'with', 'about', 'and', 'or', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'that', 'this', 'which', 'who', 'whom', 'whose', 'what', 'where', 'when', 'how', 'any', 'some', 'their', 'his', 'her', 'its', 'it', 'they', 'he', 'she', 'one', 'do', 'does', 'did', 'has', 'have', 'had', 'can', 'there', 'into', 'than']);

export function keywordQuery(question: string): string {
  const q = question.trim();
  if (/^".*"$/.test(q)) return q;
  const words = q.split(/\s+/).filter(w => !KEYWORD_STOPWORDS.has(w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')));
  return words.length ? words.join(' ') : q;
}

async function keywordLane(question: string): Promise<{ rows: Array<{ book_id: string; page_number: number }>; failed: boolean }> {
  try {
    const db = await getDb();
    const stage = buildPageSearchStage(keywordQuery(question));
    // No snippets are needed, and highlighting 200 pages is most of the cost.
    delete stage.$search.highlight;
    const rows = await db.collection('pages').aggregate([
      stage,
      { $match: { page_number: { $gt: 0 }, page_type: { $nin: NON_CONTENT_PAGE_TYPES } } },
      { $limit: KEYWORD_CANDIDATES },
      { $project: { _id: 0, book_id: 1, page_number: 1 } },
    ], { maxTimeMS: KEYWORD_TIMEOUT_MS }).toArray();
    return { rows: rows as Array<{ book_id: string; page_number: number }>, failed: false };
  } catch {
    return { rows: [], failed: true };
  }
}

function capPerBook<T extends { book_id: string }>(rows: T[], n: number, perBook = PER_BOOK): T[] {
  const seen = new Map<string, number>();
  const out: T[] = [];
  for (const r of rows) {
    const c = (seen.get(r.book_id) || 0) + 1;
    if (c > perBook) continue;
    seen.set(r.book_id, c);
    out.push(r);
    if (out.length >= n) break;
  }
  return out;
}

/**
 * Main site only: a tenant's books are not in the semantic store's scope here,
 * and the book join below drops any tenant book the keyword lane returns.
 */
export async function questionSearch(question: string, opts: { feature?: string } = {}): Promise<QuestionSearchResult> {
  const t0 = Date.now();
  const notes: string[] = [];

  const [kw, sem, orig] = await Promise.all([
    keywordLane(question),
    semanticPageSearchGlobal(question, SEMANTIC_CANDIDATES, { scope: GLOBAL_SCOPE }).catch(() => null),
    semanticPageSearchUntranslated(question, 20, { scope: GLOBAL_SCOPE }).catch(() => ({ rows: [], state: 'failed' as const })),
  ]);
  if (kw.failed) notes.push('the keyword lane timed out, so only meaning-based candidates were read');
  if (sem === null) notes.push('the meaning-based lane failed, so only keyword candidates were read');

  // Lane order, interleaved the way the experiment built its pool: rank i of
  // the semantic lane, then rank i of the keyword lane. The semantic lane goes
  // first because it supplied 79% of the re-ranked hits.
  const byKey = new Map<string, Candidate>();
  const order: Candidate[] = [];
  const add = (b: string, p: number, lane: string) => {
    const k = key(b, p);
    let c = byKey.get(k);
    if (!c) { c = { book_id: b, page_number: p, lanes: new Set() }; byKey.set(k, c); order.push(c); }
    c.lanes.add(lane);
  };
  const semRows = sem ?? [];
  for (let i = 0; i < Math.max(semRows.length, kw.rows.length); i++) {
    if (semRows[i]) add(semRows[i].book_id, semRows[i].page_number, 'semantic');
    if (kw.rows[i]) add(kw.rows[i].book_id, kw.rows[i].page_number, 'keyword');
  }
  for (const r of orig.rows) add(r.book_id, r.page_number, 'original');

  const db = await getDb();
  const bookIds = [...new Set(order.map(c => c.book_id))];
  const books = new Map(
    (bookIds.length ? await db.collection('books').find(
      { id: { $in: bookIds }, visible: true, pages_count: { $gt: 0 }, hidden: { $ne: true }, tenantId: { $in: [null, undefined] } },
      { projection: { _id: 0, id: 1, slug: 1, title: 1, display_title: 1, author: 1, author_id: 1, published: 1, year: 1, language: 1, 'translation_state.english_original': 1 } },
    ).toArray() : []).map(b => [b.id as string, b]),
  );
  const kept = order.filter(c => books.has(c.book_id));

  for (let i = 0; i < kept.length; i += 100) {
    const chunk = kept.slice(i, i + 100);
    const rows = await db.collection('pages').find(
      { $or: chunk.map(c => ({ book_id: c.book_id, page_number: c.page_number })) },
      { projection: { _id: 0, book_id: 1, page_number: 1, 'translation.data': 1, 'ocr.data': 1 } },
    ).toArray();
    for (const row of rows) {
      const c = byKey.get(key(row.book_id, row.page_number));
      if (!c) continue;
      // An English edition's stored "translation" of an English leaf is a
      // rewording, never the author's words (#7100): read the OCR instead.
      const r = serveEnglishOriginalPage(row, books.get(c.book_id), { modernized: false });
      const tr = clean(r.translation?.data || '');
      const ocr = typeof r.ocr?.data === 'string' ? r.ocr.data : '';
      const englishBook = /^english$/i.test(String(books.get(c.book_id)?.language || ''));
      if (tr.length >= MIN_TRANSLATION_CHARS) { c.text = tr; c.english = true; }
      else if (ocr && (englishBook || isEnglishOriginalPage(ocr))) { c.text = clean(ocr); c.english = true; }
      else if (ocr.trim()) { c.text = clean(ocr); c.english = false; }
    }
  }
  const english = kept.filter(c => c.english && c.text);
  const untranslatedPool = kept.filter(c => c.english === false && c.text);
  const tLanes = Date.now();

  // ── Re-rank ──
  let reranked = false;
  let scored = 0;
  let costUsd = 0;
  const token = vercelOidcToken();
  let capped = false;
  if (english.length > 0 && token) {
    const rl = await checkRateLimitShared({ name: 'librarian-question-search', limit: DAILY_CAP, windowSeconds: 86400 }, 'all');
    capped = !rl.allowed;
  }
  if (english.length === 0) {
    // Nothing to rank.
  } else if (!token) {
    notes.push('the re-ranker is not configured here (no Vercel OIDC token), so these are in search order, not ranked against the question');
  } else if (capped) {
    notes.push(`today's re-rank allowance (${DAILY_CAP} searches) is used up, so these are in search order, not ranked against the question`);
  } else {
    const questions = jevWordings(question);
    const deadline = Date.now() + JEV_BUDGET_MS;
    let idx = 0;
    let answered = 0;
    let authFailed = false;
    const tail = new AbortController();
    let tailTimer: ReturnType<typeof setTimeout> | undefined;
    await Promise.all(Array.from({ length: Math.min(JEV_CONCURRENCY, english.length) }, async () => {
      while (idx < english.length && !authFailed && Date.now() < deadline) {
        const c = english[idx++];
        const b = books.get(c.book_id)!;
        const title = (b.display_title || b.title || '') as string;
        const year = b.published || b.year;
        try {
          const r = await jevScore(token, `${title}${year ? ` (${year})` : ''}\n\n${c.text!.slice(0, JEV_CHARS)}`, questions, deadline, tail.signal);
          if (r) { c.score = r.score; costUsd += r.cost; scored++; }
        } catch {
          authFailed = true;
        }
        answered++;
        if (!tailTimer && idx >= english.length && answered >= english.length * TAIL_SHARE) {
          tailTimer = setTimeout(() => tail.abort(), TAIL_GRACE_MS);
        }
      }
    }));
    clearTimeout(tailTimer);
    if (authFailed) {
      notes.push('the re-ranker refused its credentials, so these are in search order, not ranked against the question');
    } else if (scored < english.length / 2) {
      notes.push(`the re-ranker answered for only ${scored} of ${english.length} candidates, so these are in search order, not ranked against the question`);
    } else {
      reranked = true;
      if (scored < english.length * TAIL_SHARE) notes.push(`${english.length - scored} of ${english.length} candidates were not scored in time and were left out of the ranking`);
    }
  }
  const tJev = Date.now();

  const ranked = reranked
    ? english.filter(c => c.score !== undefined).sort((a, b) => b.score! - a.score!)
    : english;
  const toPassage = (c: Candidate): QuestionPassage => {
    const b = books.get(c.book_id)!;
    const year = typeof b.year === 'number' ? b.year : undefined;
    return {
      book_id: c.book_id,
      bookTitle: (b.display_title || b.title || 'Unknown') as string,
      bookAuthor: (b.author || 'Unknown') as string,
      ...(b.author ? { authorSlug: (b.author_id || toAuthorSlug(b.author as string)) as string } : {}),
      bookSlug: b.slug as string | undefined,
      year,
      language: typeof b.language === 'string' ? b.language : undefined,
      page_number: c.page_number,
      text: passageWindow(c.text!, question),
      ...(c.score !== undefined && reranked ? { score: +c.score.toFixed(3) } : {}),
      lanes: [...c.lanes],
    };
  };
  const passages = capPerBook(ranked, RESULTS).map(toPassage);
  // Original-text lane first (it ranks by meaning across languages), then keyword-lane pages with no English.
  const untranslated = capPerBook(
    [...untranslatedPool.filter(c => c.lanes.has('original')), ...untranslatedPool.filter(c => !c.lanes.has('original'))],
    UNTRANSLATED_RESULTS,
  ).map(toPassage);

  const total = Date.now() - t0;
  if (scored > 0 || notes.length > 0) {
    logAiUsage({
      feature: opts.feature || 'librarian_question_search', model: 'typesafe-ai/jev', costUsd, ms: total, ok: reranked,
      // Where the time went: one production turn took 20.5 s against a usual 3–5 s, and the row could not say which stage.
      detail: { lanesMs: tLanes - t0, jevMs: tJev - tLanes, candidates: english.length, scored, ...(notes.length ? { note: notes.join('; ') } : {}) },
    });
  }
  return {
    passages,
    untranslated,
    reranked,
    ...(notes.length ? { note: notes.join('; ') } : {}),
    candidates: english.length,
    scored,
    costUsd,
    ms: { lanes: tLanes - t0, jev: tJev - tLanes, total },
  };
}
