/**
 * Route page-linked claims WHILE the answer streams (#6946).
 *
 * The router (citation-router.ts, gemini-3.1-flash-lite) takes 0.7–1.3 s a
 * call from the server, measured over the #6904 replay, and the budget after
 * the last text chunk is +800 ms p90. One call fired when the text ends
 * returned in time in 8 of 38 answers. So claims are routed in batches as the
 * paragraphs that carry them are finished: one call in flight while the model
 * writes, the next batch fired when it lands, the remainder fired the moment
 * the text ends. By then most verdicts are already in; only the last
 * paragraph's claims race the wait.
 *
 * Pure: page loading, slug resolution and the router are injected, so the
 * same object runs in the chat loop and in the replay harness.
 *
 * PRIOR ART: src/lib/embassy/citation-pages.ts (the pass that applies the
 * verdicts; `routableClaims` there decides what is worth routing, so both
 * sides agree on the claim and its key); src/lib/embassy/notebook-claims.ts
 * (another check on the finished text — it needs no pages and no model).
 */
import { answerUnits, type GroundingPage } from '@/lib/embassy/grounding';
import {
  buildPageIndex, findPageLinks, routableClaims,
  type CitationRouter, type RoutedClaims, type RoutingClaim,
} from '@/lib/embassy/citation-pages';

export interface CitationRoutingIO {
  router: CitationRouter;
  /** Grounding pages for `${bookId}:${page}` keys (missing pages are simply absent). */
  loadPages(keys: string[]): Promise<GroundingPage[]>;
  /** Book id for each slug (slug, alias or id) it can resolve. */
  resolveSlugs(slugs: string[]): Promise<Map<string, string>>;
  /** `${bookId}:${page}` of every page read so far this turn. */
  retrievedKeys(): string[];
  /**
   * The unit as the grounding pass will leave it, against these pages. The
   * pass attaches a page link to an uncited factual paragraph (#5904); 39% of
   * the routable claims on the replay carried such a link, so they are routed
   * as the pass will write them. Omitted: the unit is routed as streamed.
   */
  ground?(unit: string, pages: GroundingPage[]): string;
}

export interface CitationRoutingStats {
  batches: number;
  claims: number;
  /** Per batch: ms from firing to landing. */
  batchMs: number[];
  errors: number;
}

export class CitationRoutingStream {
  private readonly verdictMap: RoutedClaims = new Map();
  private readonly pages = new Map<string, GroundingPage>();
  private readonly slugIds = new Map<string, string | null>();
  /** Keys asked for that have no page: not asked again. */
  private readonly absent = new Set<string>();
  /** Unit start offsets already queued. */
  private readonly seenUnits = new Set<number>();
  private queue: Array<{ unit: string; kind: 'prose' | 'list' | 'blockquote' }> = [];
  private inFlight: Promise<void>[] = [];
  private busy = false;
  private finished = false;
  readonly stats: CitationRoutingStats = { batches: 0, claims: 0, batchMs: [], errors: 0 };

  constructor(private readonly io: CitationRoutingIO) {}

  /** The text so far. Every unit followed by another is finished and queued. */
  feed(text: string): void {
    if (this.finished) return;
    this.take(text, false);
    if (!this.busy) this.fire();
  }

  /** The text has ended: queue the rest and fire now, even with a batch in flight. */
  finish(text: string): void {
    if (this.finished) return;
    this.take(text, true);
    this.finished = true;
    this.fire();
  }

  /** Verdicts landed so far. */
  get verdicts(): RoutedClaims {
    return this.verdictMap;
  }

  /** Resolves when every batch fired so far has landed or failed. */
  async settled(): Promise<RoutedClaims> {
    while (this.inFlight.length > 0) await Promise.all(this.inFlight);
    return this.verdictMap;
  }

  private take(text: string, all: boolean): void {
    const units = answerUnits(text);
    const done = all ? units : units.slice(0, -1);
    for (const u of done) {
      if (this.seenUnits.has(u.start) || u.kind === 'image') continue;
      this.seenUnits.add(u.start);
      const raw = text.slice(u.start, u.end);
      if (u.kind === 'blockquote' && findPageLinks(raw).length === 0) continue;
      this.queue.push({ unit: raw, kind: u.kind });
    }
  }

  private fire(): void {
    if (this.queue.length === 0) return;
    const batch = this.queue;
    this.queue = [];
    this.busy = true;
    const t0 = Date.now();
    const run = this.route(batch)
      .catch(() => { this.stats.errors++; })
      .finally(() => {
        this.stats.batchMs.push(Date.now() - t0);
        this.inFlight = this.inFlight.filter(p => p !== run);
        this.busy = this.inFlight.length > 0;
        // What finished while this batch was out goes next (finish() fires its own).
        if (!this.finished && !this.busy) this.fire();
      });
    this.inFlight.push(run);
  }

  private async load(keys: Set<string>): Promise<void> {
    const missing = [...keys].filter(k => !this.pages.has(k) && !this.absent.has(k));
    if (missing.length === 0) return;
    for (const p of await this.io.loadPages(missing)) this.pages.set(`${p.bookId}:${p.page}`, p);
    for (const k of missing) if (!this.pages.has(k)) this.absent.add(k);
  }

  private async route(batch: Array<{ unit: string; kind: 'prose' | 'list' | 'blockquote' }>): Promise<void> {
    // The linked pages and every page read: the claims' own pages and the candidates.
    const want = new Set(this.io.retrievedKeys());
    await this.load(want);
    // Ground each unit against the pages in hand: an uncited paragraph may gain a link here.
    const ground = this.io.ground;
    const units = ground ? batch.map(b => ({ ...b, unit: ground(b.unit, [...this.pages.values()]) })) : batch;
    const links = units.flatMap(b => findPageLinks(b.unit));
    if (links.length === 0) return;
    const unknown = [...new Set(links.map(l => l.slug))].filter(s => !this.slugIds.has(s));
    if (unknown.length > 0) {
      const ids = await this.io.resolveSlugs(unknown);
      for (const s of unknown) this.slugIds.set(s, ids.get(s) ?? null);
    }
    for (const l of links) {
      const id = this.slugIds.get(l.slug);
      if (id) want.add(`${id}:${l.page}`);
    }
    await this.load(want);
    const pages = [...this.pages.values()];
    const idx = buildPageIndex(pages);
    const claims: RoutingClaim[] = units.flatMap(b => routableClaims(b.unit, b.kind, idx));
    if (claims.length === 0) return;
    this.stats.batches++;
    this.stats.claims += claims.length;
    for (const v of await this.io.router(claims, pages)) {
      const c = claims[v.claim];
      if (!c || (v.page !== null && !pages[v.page])) continue;
      this.verdictMap.set(c.key, { to: v.page === null ? null : `${pages[v.page].bookId}:${pages[v.page].page}`, evidence: v.evidence });
    }
  }
}
