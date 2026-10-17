// The keyword page lane over keyword.sqlite (#6852): the questions src/app/api/search/route.ts asks Atlas
// in its `page` lane, asked of FTS5 instead. Used by the server's worker threads and by the parity eval.
//
// One `lane()` call answers what the route's lane does with up to four Atlas round trips:
//   main      buildPageSearchStage(query, bookIds): ANY query word (or the quoted phrase) in translation
//             (weight 2) or OCR (weight 1), BM25, fuzzy (1 edit, 4-char prefix) for one word of 6+
//             characters, non-content pages dropped, top k.
//   variants  the same with { nameVariants, requireNameVariant, requireWords }: pages that print another
//             spelling of a person the query names (and one of the topic words, when given).
//   counts    page-rollup countMatchingPagesByBook: pages printing EVERY term (each as a phrase), per book,
//             top `buckets` books. Atlas counts hidden books too and the route drops them; here only live
//             books are counted, so the buckets are not spent on books the route would drop.
//   extra     page-rollup bestPagePerBook for the first `max_books` counted books the main/variant pages
//             did not reach: each book's best content page printing every term.
// Every list is confined to live books (visible, pages_count > 0, not hidden — the set the sync posts),
// intersected with `book_ids` when the caller passes an allow-list.
//
// PRIOR ART: src/lib/atlas-search.ts and src/lib/search/page-rollup.ts are the contract (read them, not this
// summary, when they change); sourcelibrary-atlas scripts/local-corpus/fuse-lib.mjs ftsCandidates is the
// FTS5 query shape (MATCH + bm25 ORDER BY + LIMIT).
import { DatabaseSync } from 'node:sqlite';
import {
  parseQuery, queryTerms, tokenize, anyOf, phraseOf, withinOneEdit,
  FUZZY_MIN_LEN, FUZZY_PREFIX, FUZZY_MAX_EXPANSIONS,
} from './lib.mjs';

/** bm25 column weights: translation 2, OCR 1 — the Atlas clauses' boosts. */
const RANK = 'bm25(fts, 2.0, 1.0)';

export class Engine {
  /** @param {string} dbPath @param {{ readonly?: boolean }} [o] */
  constructor(dbPath, { readonly = true } = {}) {
    this.db = new DatabaseSync(dbPath, { readOnly: readonly });
    this.db.exec('PRAGMA cache_size = -262144; PRAGMA mmap_size = 0; PRAGMA temp_store = MEMORY;');
    if (!readonly) this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
    this.books = []; this.bookIdx = new Map();
    for (const r of this.db.prepare('SELECT idx, id FROM books ORDER BY idx').all()) { this.books[r.idx] = r.id; this.bookIdx.set(r.id, r.idx); }
    const maxRow = Number(this.db.prepare('SELECT coalesce(max(rowid), 0) m FROM pages').get().m);
    this.cap = 0; this.book = new Int32Array(0); this.content = new Uint8Array(0);
    this.grow(maxRow + 1 + (1 << 20));
    for (const r of this.db.prepare('SELECT rowid AS r, book AS b, content AS c FROM pages').iterate()) {
      this.book[r.r] = r.b; this.content[r.r] = r.c;
    }
    this.maxRow = maxRow;
    /** Pages in the index, for the fuzzy path's IDF (FTS5's own N is the same count). */
    this.docCount = Number(this.db.prepare('SELECT count(*) n FROM pages').get().n);
    // live[bookIdx] = 1 for a live book. Until a live set is posted, every book counts as live.
    this.live = new Uint8Array(Math.max(1024, this.books.length * 2));
    const hasLive = this.db.prepare("SELECT count(*) n FROM sqlite_master WHERE name = 'live_books'").get().n > 0;
    const liveIds = hasLive ? this.db.prepare('SELECT id FROM live_books').all().map((r) => r.id) : null;
    if (liveIds && liveIds.length) this.setLive(liveIds); else { this.live.fill(1); this.liveCount = null; }
    // Per-request allow-list over book indexes (filled and cleared by each call).
    this.allow = new Uint8Array(this.live.length); this.allowOn = false; this.allowList = [];
    this.target = new Uint8Array(this.live.length);

    const self = this;
    this.db.function('keep', { deterministic: false, directOnly: true }, (r) => {
      if (!self.content[r]) return 0;
      const b = self.book[r];
      return self.live[b] && (!self.allowOn || self.allow[b]) ? 1 : 0;
    });
    this.db.function('livebook', { deterministic: false, directOnly: true }, (r) => {
      const b = self.book[r];
      return self.live[b] && (!self.allowOn || self.allow[b]) ? 1 : 0;
    });
    this.db.function('target', { deterministic: false, directOnly: true }, (r) => (self.content[r] && self.target[self.book[r]] ? 1 : 0));
    this.stmt = {
      top: this.db.prepare(`SELECT rowid AS r, ${RANK} AS s FROM fts WHERE fts MATCH ? AND keep(rowid) ORDER BY s LIMIT ?`),
      count: this.db.prepare('SELECT rowid AS r FROM fts WHERE fts MATCH ? AND livebook(rowid)'),
      best: this.db.prepare(`SELECT rowid AS r, ${RANK} AS s FROM fts WHERE fts MATCH ? AND target(rowid)`),
      vocab: null,
    };
    try {
      this.stmt.vocab = this.db.prepare('SELECT term, doc FROM vocab WHERE term >= ? AND term < ?');
    } catch { /* no vocab table: fuzzy expansion is skipped and the exact word is searched */ }
  }

  grow(cap) {
    if (cap <= this.cap) return;
    const b = new Int32Array(cap); b.set(this.book); this.book = b;
    const c = new Uint8Array(cap); c.set(this.content); this.content = c;
    this.cap = cap;
  }

  growBooks(n) {
    if (n <= this.live.length) return;
    const len = Math.max(n, this.live.length * 2);
    for (const k of ['live', 'allow', 'target']) { const a = new Uint8Array(len); a.set(this[k]); this[k] = a; }
  }

  /** Book ids → the live set. Unknown ids are ignored (a live book with no text has no pages here). */
  setLive(ids) {
    this.live.fill(0); let n = 0;
    for (const id of ids) { const i = this.bookIdx.get(id); if (i !== undefined) { this.live[i] = 1; n++; } }
    this.liveCount = n;
  }

  /** Writer-side bookkeeping mirrored into readers: a new book index. */
  addBook(idx, id) { this.books[idx] = id; this.bookIdx.set(id, idx); this.growBooks(idx + 1); }
  /** A page row (re)written or removed: rowid → book, content (content = 0 also when removed). */
  setRow(r, b, c) { if (r >= this.cap) this.grow(Math.max(r + 1, Math.ceil(this.cap * 1.25))); this.book[r] = b; this.content[r] = c; if (r > this.maxRow) this.maxRow = r; }

  withAllow(bookIds, fn) {
    if (!bookIds) return fn();
    this.allowOn = true; this.allowList = [];
    for (const id of bookIds) { const i = this.bookIdx.get(id); if (i !== undefined) { this.allow[i] = 1; this.allowList.push(i); } }
    try { return fn(); } finally { for (const i of this.allowList) this.allow[i] = 0; this.allowOn = false; this.allowList = []; }
  }

  /**
   * Index terms within one edit of `word` that share its first 4 characters: [{ term, doc }], the word
   * itself first (doc 0 when the index lacks it), then the others most frequent first, at most 50 in all.
   */
  fuzzyExpand(word) {
    if (!this.stmt.vocab) return [{ term: word, doc: 0 }];
    const cps = [...word];
    const prefix = cps.slice(0, FUZZY_PREFIX).join('');
    const rows = this.stmt.vocab.all(prefix, prefix + '\u{10FFFF}');
    const self = rows.find((r) => r.term === word);
    const near = rows.filter((r) => r.term !== word && Math.abs([...r.term].length - cps.length) <= 1 && withinOneEdit(r.term, word))
      .sort((a, b) => b.doc - a.doc).slice(0, FUZZY_MAX_EXPANSIONS - 1);
    return [{ term: word, doc: self ? Number(self.doc) : 0 }, ...near.map((r) => ({ term: r.term, doc: Number(r.doc) }))];
  }

  /**
   * Top k for a fuzzy word, scored the way Lucene's fuzzy rewrite does (TopTermsBlendedFreqScoringRewrite):
   * every expansion gets the IDF of the most frequent one, and a term `ed` edits away is boosted by
   * 1 − ed / min(len). A plain FTS5 OR would give a rare misspelling a far higher IDF than the word the
   * reader typed and rank it first. One FTS5 query per expansion (most are a handful of pages), rescored
   * and summed per page here.
   */
  fuzzyTop(exp, word, k) {
    const N = this.docCount;
    const idf = (n) => Math.max(1e-6, Math.log((N - n + 0.5) / (n + 0.5)));
    const blend = idf(Math.max(...exp.map((e) => e.doc)));
    const len = [...word].length;
    const acc = new Map();
    for (const e of exp) {
      if (e.doc === 0 && e.term !== word) continue;
      const boost = e.term === word ? 1 : 1 - 1 / Math.min(len, [...e.term].length);
      const f = (blend / idf(e.doc || 1)) * boost;
      for (const x of this.stmt.top.all(`"${e.term.replace(/"/g, '""')}"`, k)) {
        const r = Number(x.r);
        acc.set(r, (acc.get(r) || 0) + x.s * f); // bm25 is negative: lower is better
      }
    }
    return [...acc].sort((a, b) => a[1] - b[1] || a[0] - b[0]).slice(0, k).map(([r, s]) => ({ r, s }));
  }

  /** The main-clause MATCH string for a query, or null when it has no searchable token. */
  mainMatch(query) {
    const { isPhrase, text } = parseQuery(query);
    if (isPhrase) return { match: phraseOf(text), isPhrase, terms: tokenize(text) };
    const words = text.trim().split(/\s+/).filter(Boolean);
    const terms = queryTerms(text);
    if (words.length === 1 && [...words[0]].length >= FUZZY_MIN_LEN && terms.length === 1) {
      const exp = this.fuzzyExpand(terms[0]);
      if (exp.length > 1) return { match: anyOf(exp.map((e) => e.term)), isPhrase, terms, fuzzy: exp };
    }
    return { match: terms.length ? anyOf(terms) : null, isPhrase, terms, fuzzy: null };
  }

  top(match, k) {
    if (!match || k <= 0) return [];
    return this.stmt.top.all(match, k).map((x) => ({ r: Number(x.r), s: x.s }));
  }

  /** rowids → {page_id, book_id, page_number, score} (score: higher is better, = −bm25). */
  hydrate(rows, src) {
    if (!rows.length) return [];
    const ids = rows.map((x) => x.r);
    const meta = new Map(this.db.prepare(`SELECT rowid AS r, page_id, page_number FROM pages WHERE rowid IN (${ids.map(() => '?').join(',')})`).all(...ids).map((m) => [Number(m.r), m]));
    const out = [];
    for (const x of rows) {
      const m = meta.get(x.r);
      if (!m) continue;
      out.push({ page_id: m.page_id, book_id: this.books[this.book[x.r]], page_number: m.page_number, score: x.s == null ? null : Math.round(-x.s * 1e4) / 1e4, src });
    }
    return out;
  }

  /** The rollup's AND-of-phrases MATCH: every term printed, each term as a phrase of its own tokens. */
  static allTermsMatch(terms) {
    const ps = (terms || []).map((t) => phraseOf(t)).filter(Boolean);
    return ps.length ? ps.join(' AND ') : null;
  }

  counts(match, buckets) {
    const per = new Map();
    for (const x of this.stmt.count.iterate(match)) { const b = this.book[Number(x.r)]; per.set(b, (per.get(b) || 0) + 1); }
    return [...per].sort((a, b) => b[1] - a[1] || (this.books[a[0]] < this.books[b[0]] ? -1 : 1)).slice(0, buckets)
      .map(([b, n]) => ({ book_id: this.books[b], pages: n }));
  }

  bestPerBook(match, bookIds) {
    const idxs = bookIds.map((id) => this.bookIdx.get(id)).filter((i) => i !== undefined);
    if (!idxs.length) return [];
    for (const i of idxs) this.target[i] = 1;
    const best = new Map();
    try {
      for (const x of this.stmt.best.iterate(match)) {
        const r = Number(x.r), b = this.book[r];
        const cur = best.get(b);
        if (!cur || x.s < cur.s || (x.s === cur.s && r < cur.r)) best.set(b, { r, s: x.s });
      }
    } finally { for (const i of idxs) this.target[i] = 0; }
    return idxs.map((i) => best.get(i)).filter(Boolean);
  }

  /**
   * @param {{ query: string, k?: number, book_ids?: string[]|null, variants?: string[], topic_words?: string[],
   *   variant_k?: number, rollup?: { terms: string[], buckets?: number, max_books?: number } | null }} p
   */
  lane(p) {
    const t0 = performance.now();
    const ms = {};
    const k = Math.min(Math.max(1, p.k ?? 25), 1000);
    const out = this.withAllow(Array.isArray(p.book_ids) ? p.book_ids : null, () => {
      const m = this.mainMatch(p.query);
      let t = performance.now();
      const main = this.hydrate(m.fuzzy ? this.fuzzyTop(m.fuzzy, m.terms[0], k) : this.top(m.match, k), 'main');
      ms.main = +(performance.now() - t).toFixed(1);

      let variants = [];
      const vTokens = [...new Set((p.variants || []).flatMap((v) => tokenize(v)))];
      if (!m.isPhrase && vTokens.length) {
        t = performance.now();
        const tw = [...new Set((p.topic_words || []).flatMap((w) => tokenize(w)))];
        const match = `(${anyOf(vTokens)})` + (tw.length ? ` AND (${anyOf(tw)})` : '');
        const seen = new Set(main.map((x) => x.page_id));
        variants = this.hydrate(this.top(match, Math.min(p.variant_k ?? 10, 1000)), 'variant').filter((x) => !seen.has(x.page_id));
        ms.variants = +(performance.now() - t).toFixed(1);
      }

      let counts = null, extra = [];
      const rm = p.rollup ? Engine.allTermsMatch(p.rollup.terms) : null;
      if (rm) {
        t = performance.now();
        counts = this.counts(rm, p.rollup.buckets ?? 200);
        ms.counts = +(performance.now() - t).toFixed(1);
        const reached = new Set([...main, ...variants].map((x) => x.book_id));
        const toAdd = counts.filter((c) => !reached.has(c.book_id)).slice(0, p.rollup.max_books ?? 30).map((c) => c.book_id);
        if (toAdd.length) {
          t = performance.now();
          extra = this.hydrate(this.bestPerBook(rm, toAdd), 'rollup');
          ms.extra = +(performance.now() - t).toFixed(1);
        }
      }
      return { main, variants, counts, extra, match: m.match, fuzzy: !!m.fuzzy };
    });
    ms.total = +(performance.now() - t0).toFixed(1);
    return { ...out, ms };
  }
}
