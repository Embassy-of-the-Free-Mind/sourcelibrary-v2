"""Keyword page service (#6852): the questions the /api/search page lane asks Atlas `pages_search`, answered
from a tantivy index in one round trip.

    venv/bin/python server.py
    public  KEYWORD_SEARCH_HOST:KEYWORD_SEARCH_PORT (default 127.0.0.1:3460): Bearer KEYWORD_SEARCH_TOKEN on
            every route. POST /lane, GET /health. Stays on localhost until the TLS proxy (#6843) fronts it.
    local   127.0.0.1:KEYWORD_SEARCH_LOCAL_PORT (default 3461): no auth; also POST /admin/apply,
            /admin/live, /admin/checkpoint (sync-delta.mjs).

One `/lane` call does what the route's lane does with up to four Atlas calls (README.md has the contract):
  main      ANY query word (or the quoted phrase) in translation (boost 2) or OCR (boost 1), BM25; one word of
            6+ characters is fuzzy (1 edit, same first 4 characters, Lucene's blended scoring); an unquoted
            unspaced-script query also scores as a phrase, boosted (#6877); non-content pages dropped; top k.
  variants  pages printing another spelling of the person the query names (and a topic word, if any), the
            query's own words still scoring; the top variant_k, then minus pages already in main (as Atlas).
  counts    pages printing EVERY roll-up term (each a phrase), per book, top `buckets`.
  extra     the best content page per counted book the main/variant pages did not reach, up to max_books.
Every list is confined to live books (the set sync-delta.mjs posts) and to `book_ids` when given.

PRIOR ART: scripts/workers/vector-search/server.mjs — same two listeners, token check and admin routes.
That one is Node because usearch is; this is Python because tantivy-py is the maintained binding.
"""
import hmac
import json
import math
import os
import re
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from datetime import datetime, timezone

import tantivy

import kwindex

MAX_BODY = 1 << 20
FUZZY_MIN_LEN, FUZZY_PREFIX, FUZZY_MAX_EXPANSIONS = 6, 4, 50
# The characters tried after a short token (see fuzzy_candidates): Latin letters, the accented and archaic
# forms the corpus prints, digits.
SHORT_FUZZY_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789àáâãäåæçèéêëìíîïñòóôõöøœùúûüýÿßſ"
FIELDS = (("tr", 2.0), ("ocr", 1.0))
# src/lib/atlas-search.ts UNSPACED_SCRIPT / PHRASE_FIRST_BOOST (#6877): an unquoted query in these scripts
# also scores as a phrase, boosted so the pages printing it rank first.
UNSPACED_SCRIPT = re.compile(r"[฀-໿ༀ-࿿က-႟ក-៿぀-ヿ㐀-䶿一-鿿豈-﫿\U00020000-\U0003FFFF]")
PHRASE_FIRST_BOOST = 100.0
Occur = tantivy.Occur
Q = tantivy.Query


def log(*a):
    print(datetime.now(timezone.utc).isoformat(), *a, flush=True)


def within_one_edit(a, b):
    """Levenshtein ≤ 1 with an adjacent transposition as one edit (Lucene's default), on code points."""
    if a == b:
        return True
    la, lb = len(a), len(b)
    if abs(la - lb) > 1:
        return False
    i = 0
    while i < la and i < lb and a[i] == b[i]:
        i += 1
    if la == lb:
        return a[i + 1:] == b[i + 1:] or (i + 1 < la and a[i] == b[i + 1] and a[i + 1] == b[i] and a[i + 2:] == b[i + 2:])
    return a[i + 1:] == b[i:] if la > lb else a[i:] == b[i + 1:]


class Engine:
    def __init__(self, path=kwindex.INDEX_DIR, writer=True):
        self.index = kwindex.open_index(path)
        self.schema = self.index.schema
        self.writer = self.index.writer(heap_size=200_000_000, num_threads=1) if writer else None
        self.wlock = threading.Lock()
        self.books = kwindex.Books.load()
        self.built_at = (kwindex.read_json(kwindex.STATE_PATH, {}) or {}).get("built_at")
        self.live_ids = None   # book ids posted by the sync; None = not posted yet (every book counts)
        self.live_idx = None   # the same as book_idx integers
        ids = kwindex.read_json(kwindex.LIVE_PATH)
        if ids:
            self.set_live(ids, save=False)
        self.not_content = Q.term_query(self.schema, "content", 0)
        self.searcher = self.index.searcher()

    # ----- query pieces -------------------------------------------------------------------------------
    def term(self, field, t, boost=1.0):
        q = Q.term_query(self.schema, field, t)
        return Q.boost_query(q, boost) if boost != 1.0 else q

    def phrase(self, field, toks, boost=1.0):
        q = Q.term_query(self.schema, field, toks[0]) if len(toks) == 1 else Q.phrase_query(self.schema, field, toks)
        return Q.boost_query(q, boost) if boost != 1.0 else q

    def any_terms(self, toks, boosts=True):
        """Atlas `text` over both fields: ANY token, translation boosted 2."""
        return Q.boolean_query([(Occur.Should, self.term(f, t, b if boosts else 1.0)) for t in toks for f, b in FIELDS])

    def phrase_either(self, toks):
        return Q.boolean_query([(Occur.Should, self.phrase(f, toks, b)) for f, b in FIELDS])

    def fuzzy(self, words):
        """Lucene's fuzzy rewrite (TopTermsBlendedFreqScoringRewrite), per token and field: every expansion within
        one edit that shares the first 4 characters, scored with the IDF of the most frequent one and boosted
        1 - 1/min(len). Without the blend a rare misspelling outranks the word typed. Atlas applies the fuzzy
        option to every token its analyzer emits ("pseudo-Paracelsian" is two). Returns (query, n_terms)."""
        n_docs = self.searcher.num_docs
        idf = lambda n: math.log(1 + (n_docs - n + 0.5) / (n + 0.5))
        clauses, terms = [], set()
        for word, f, fb in ((w, f, fb) for w in words for f, fb in FIELDS):
            cands = self.fuzzy_candidates(f, word)
            cands.sort(key=lambda x: (x[0] != word, -x[1]))
            cands = cands[:FUZZY_MAX_EXPANSIONS]
            if not cands:
                continue
            blend = idf(max(c for _, c in cands))
            for t, c in cands:
                b = fb * (blend / idf(c)) * (1.0 if t == word else 1 - 1 / min(len(word), len(t)))
                clauses.append((Occur.Should, self.term(f, t, b)))
                terms.add(t)
        if not clauses:
            return self.any_terms(words), len(words)
        return Q.boolean_query(clauses), len(terms)

    def fuzzy_candidates(self, f, word):
        """[(term, doc_freq)] within one edit of `word` that keep its first 4 characters. A token of 4 characters
        or fewer IS its prefix, so its only expansions are itself plus one more character: those are looked up
        one by one instead of walking every term that starts with it. ("the" would list ~10^5 terms; a pasted
        slug of short tokens took 1.3 s that way, measured 2026-10-17 on cloudlayer.)"""
        if len(word) <= FUZZY_PREFIX and not any(ord(ch) > 0x24F for ch in word):
            out = [(word, self.searcher.doc_freq(f, word))]
            out += [(word + ch, self.searcher.doc_freq(f, word + ch)) for ch in SHORT_FUZZY_ALPHABET]
            return [(t, c) for t, c in out if c > 0]
        rows = self.searcher.terms_with_prefix(f, word[:FUZZY_PREFIX], limit=20000) if len(word) <= FUZZY_PREFIX else self.searcher.terms_with_prefix(f, word[:FUZZY_PREFIX])
        return [(t, c) for t, c in rows if t == word or (abs(len(t) - len(word)) <= 1 and within_one_edit(t, word))]

    def main_query(self, query):
        q = (query or "").strip()
        if len(q) >= 2 and q[0] == '"' and q[-1] == '"':
            toks = kwindex.tokenize(q[1:-1])
            return (self.phrase_either(toks) if toks else None), toks, True, 0
        toks = list(dict.fromkeys(kwindex.tokenize(q)))
        if UNSPACED_SCRIPT.search(q) and toks:
            # buildPageSearchStage's phrase-first (#6877): one token per character or syllable, so ANY token
            # matches nearly every page; the pages printing the run as typed come first, the rest follow.
            ptoks = kwindex.tokenize(q)
            return Q.boolean_query([(Occur.Should, self.phrase(f, ptoks, b * PHRASE_FIRST_BOOST)) for f, b in FIELDS]
                                   + [(Occur.Should, self.any_terms(toks))]), toks, False, 0
        words = q.split()
        if len(words) == 1 and len(words[0]) >= FUZZY_MIN_LEN and toks:
            fq, n = self.fuzzy(toks)
            return fq, toks, False, n
        return (self.any_terms(toks) if toks else None), toks, False, 0

    # ----- execution ----------------------------------------------------------------------------------
    def allow_query(self, allow):
        return Q.term_set_query(self.schema, "book_idx", sorted(allow))

    def filtered(self, q, allow):
        cl = [(Occur.Must, q), (Occur.MustNot, self.not_content)]
        if allow is not None:
            cl.append((Occur.Must, self.allow_query(allow)))
        return Q.boolean_query(cl)

    def ok_book(self, b, allow):
        return (self.live_idx is None or b in self.live_idx) and (allow is None or b in allow)

    def rows(self, s, picked):
        """[(score, addr, book_idx)] → result rows, from fast fields (the stored doc only for a non-hex id)."""
        if not picked:
            return []
        addrs = [a for _, a, _ in picked]
        pn = s.fast_field_values("page_number", addrs)
        hi = s.fast_field_values("pid_hi", addrs)
        lo = s.fast_field_values("pid_lo", addrs)
        out = []
        for (score, addr, b), n, h, l in zip(picked, pn, hi, lo):
            pid = kwindex.join_page_id(h or 0, l or 0) or s.doc(addr).get_first("page_id")
            out.append({"page_id": pid, "book_id": self.books.ids[b], "page_number": n, "score": round(score, 4)})
        return out

    def top(self, s, q, k, allow, exclude=()):
        """Top k content pages of live (and allowed) books: search, drop the rest by their fast book_idx,
        widen until k or exhausted."""
        if q is None or k <= 0 or (allow is not None and not allow):
            return []
        fq = self.filtered(q, allow)
        limit = k + 25 + len(exclude)
        while True:
            hits = s.search(fq, limit, count=False).hits
            bidx = s.fast_field_values("book_idx", [a for _, a in hits])
            picked = [(score, addr, b) for (score, addr), b in zip(hits, bidx) if b is not None and self.ok_book(b, allow)]
            out = [r for r in self.rows(s, picked[: k + len(exclude)]) if r["page_id"] not in exclude][:k]
            if len(out) >= k or len(hits) < limit or limit >= 20000:
                return out
            limit *= 4

    def all_terms(self, terms):
        """The roll-up's predicate: every term printed, each term a phrase of its own tokens."""
        ps = [kwindex.tokenize(t) for t in terms or []]
        ps = [p for p in ps if p]
        return Q.boolean_query([(Occur.Must, self.phrase_either(p)) for p in ps]) if ps else None

    def counts(self, s, q, allow, buckets):
        if allow is not None:
            if not allow:
                return []
            q = Q.boolean_query([(Occur.Must, q), (Occur.Must, self.allow_query(allow))])
        size = min(max(buckets * 4, 1000), 65000)
        res = s.aggregate(q, {"b": {"terms": {"field": "book_idx", "size": size}}})
        rows = [(int(x["key"]), x["doc_count"]) for x in res["b"]["buckets"]]
        rows = [(self.books.ids[b], n) for b, n in rows if self.ok_book(b, allow)]
        rows.sort(key=lambda x: (-x[1], x[0]))
        return [{"book_id": b, "pages": n} for b, n in rows[:buckets]]

    def best_per_book(self, s, q, books):
        """bestPagePerBook: each book's best content page printing every term, in `books` order. One search over
        all the books first (its top hits give most books their best page); one search per book left over."""
        want = [self.books.idx[b] for b in books if b in self.books.idx]
        if not want:
            return []
        best = {}
        hits = s.search(self.filtered(q, set(want)), 40 * len(want), count=False).hits
        for (score, addr), b in zip(hits, s.fast_field_values("book_idx", [a for _, a in hits])):
            if b not in best:
                best[b] = (score, addr, b)
        for bi in want:
            if bi not in best and len(hits) == 40 * len(want):  # the joint search was cut short: ask this book alone
                h = s.search(self.filtered(q, {bi}), 1, count=False).hits
                if h:
                    best[bi] = (h[0][0], h[0][1], bi)
        return self.rows(s, [best[bi] for bi in want if bi in best])

    def lane(self, p):
        t0 = time.perf_counter()
        ms = {}
        s = self.searcher
        k = min(max(1, int(p.get("k") or 25)), 1000)
        allow = None
        if isinstance(p.get("book_ids"), list):
            allow = {self.books.idx[b] for b in p["book_ids"] if b in self.books.idx}
        mq, toks, is_phrase, n_fuzzy = self.main_query(p["query"])
        t = time.perf_counter()
        main = [dict(r, src="main") for r in self.top(s, mq, k, allow)]
        ms["main"] = round((time.perf_counter() - t) * 1000, 1)

        variants = []
        vtoks = list(dict.fromkeys(x for v in p.get("variants") or [] for x in kwindex.tokenize(v)))
        if vtoks and not is_phrase:
            t = time.perf_counter()
            # buildPageSearchStage with requireNameVariant: must print a variant (translation boost 2),
            # must print a topic word when there are any, and the query's own words still score.
            cl = [(Occur.Must, Q.boolean_query([(Occur.Should, self.term(f, v, b)) for v in vtoks for f, b in FIELDS]))]
            tw = list(dict.fromkeys(x for w in p.get("topic_words") or [] for x in kwindex.tokenize(w)))
            if tw:
                cl.append((Occur.Must, self.any_terms(tw, boosts=False)))
            if toks:
                cl.append((Occur.Should, self.any_terms(toks)))
            # Atlas's contract: the variant query's top variant_k FIRST, then the route drops those already
            # in main (often leaving 0-6). Excluding main before the cut returned ~10 new pages on every
            # expanded query instead (290 vs 139 over the #2049 Check 5 panel, #6852).
            seen = {r["page_id"] for r in main}
            variants = [dict(r, src="variant") for r in self.top(s, Q.boolean_query(cl), min(int(p.get("variant_k") or 10), 1000), allow)
                        if r["page_id"] not in seen]
            ms["variants"] = round((time.perf_counter() - t) * 1000, 1)

        counts, extra = None, []
        roll = p.get("rollup")
        rq = self.all_terms(roll.get("terms")) if roll else None
        if rq is not None:
            t = time.perf_counter()
            counts = self.counts(s, rq, allow, int(roll.get("buckets") or 200))
            ms["counts"] = round((time.perf_counter() - t) * 1000, 1)
            reached = {r["book_id"] for r in main + variants}
            to_add = [c["book_id"] for c in counts if c["book_id"] not in reached][: int(roll.get("max_books") or 30)]
            if to_add:
                t = time.perf_counter()
                extra = [dict(r, src="rollup") for r in self.best_per_book(s, rq, to_add)]
                ms["extra"] = round((time.perf_counter() - t) * 1000, 1)
        ms["total"] = round((time.perf_counter() - t0) * 1000, 1)
        return {"main": main, "variants": variants, "counts": counts, "extra": extra,
                "tokens": toks, "phrase": is_phrase, "fuzzy_terms": n_fuzzy, "ms": ms}

    # ----- writes (delta) -----------------------------------------------------------------------------
    def same_build(self):
        """False once a rebuild has replaced state.json (and books.json) under this running process."""
        return (kwindex.read_json(kwindex.STATE_PATH, {}) or {}).get("built_at") == self.built_at

    def apply(self, body):
        res = {"upserted": 0, "removed": 0}
        with self.wlock:
            for pid in body.get("removes") or []:
                self.writer.delete_documents_by_term("page_id", pid)
                res["removed"] += 1
            for r in body.get("upserts") or []:
                self.writer.delete_documents_by_term("page_id", r["i"])
                self.writer.add_document(kwindex.page_document(r, self.books))
                res["upserted"] += 1
            if res["upserted"] or res["removed"]:
                self.writer.commit()
                self.index.reload()
                self.searcher = self.index.searcher()
            if self.books.dirty:
                if self.live_ids is not None:
                    self.live_idx = {self.books.idx[b] for b in self.live_ids if b in self.books.idx}
                if self.same_build():
                    self.books.save()
        return res

    def set_live(self, ids, save=True):
        self.live_ids = set(ids)
        self.live_idx = {self.books.idx[b] for b in self.live_ids if b in self.books.idx}
        if save:
            kwindex.write_json_atomic(kwindex.LIVE_PATH, sorted(self.live_ids))
        return {"live_books": len(self.live_ids), "live_books_indexed": len(self.live_idx)}


def main():
    port = int(os.environ.get("KEYWORD_SEARCH_PORT", 3460))
    host = os.environ.get("KEYWORD_SEARCH_HOST", "127.0.0.1")
    local_port = int(os.environ.get("KEYWORD_SEARCH_LOCAL_PORT", 3461))
    token = os.environ.get("KEYWORD_SEARCH_TOKEN", "").encode()
    if not token and host != "127.0.0.1":
        sys.exit("KEYWORD_SEARCH_TOKEN is required on a public listener")
    engine = Engine()
    stats = {"served": 0, "errors": 0, "started_at": datetime.now(timezone.utc).isoformat()}
    log(f"index {kwindex.INDEX_DIR}: {engine.searcher.num_docs:,} pages, {len(engine.books.ids):,} books, live set {len(engine.live_ids) if engine.live_ids else 'not posted yet'}")

    def health():
        st = kwindex.read_json(kwindex.STATE_PATH, {}) or {}
        return {"ok": True, "pages": engine.searcher.num_docs, "segments": engine.searcher.num_segments,
                "live_books": len(engine.live_ids) if engine.live_ids is not None else None,
                "live_books_indexed": len(engine.live_idx) if engine.live_idx is not None else None,
                "built_at": st.get("built_at"), "checkpoint": st.get("checkpoint"), "last_delta_at": st.get("last_delta_at"), **stats}

    def make(local):
        class H(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, *a):
                pass

            def send(self, code, obj):
                b = json.dumps(obj).encode()
                self.send_response(code)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(b)))
                self.end_headers()
                self.wfile.write(b)

            def authed(self):
                if local:
                    return True
                h = self.headers.get("authorization", "")
                got = h[7:].encode() if h.startswith("Bearer ") else b""
                return bool(token) and hmac.compare_digest(got, token)

            def do_GET(self):
                if not self.authed():
                    return self.send(401, {"error": "unauthorized"})
                if self.path == "/health":
                    return self.send(200, health())
                self.send(404, {"error": "not found"})

            def do_POST(self):
                if not self.authed():
                    return self.send(401, {"error": "unauthorized"})
                n = int(self.headers.get("content-length") or 0)
                if not local and n > MAX_BODY:
                    return self.send(413, {"error": "body too large"})
                try:
                    body = json.loads(self.rfile.read(n) or b"{}")
                except ValueError:
                    return self.send(400, {"error": "bad json"})
                try:
                    if self.path == "/lane":
                        q = body.get("query")
                        if not isinstance(q, str) or len(q.strip()) < 2:
                            return self.send(400, {"error": "query must be a string of 2+ characters"})
                        if body.get("book_ids") is not None and not isinstance(body["book_ids"], list):
                            return self.send(400, {"error": "book_ids must be an array"})
                        t = time.perf_counter()
                        r = engine.lane(body)
                        r["server_ms"] = round((time.perf_counter() - t) * 1000, 1)
                        stats["served"] += 1
                        return self.send(200, r)
                    if not local:
                        return self.send(404, {"error": "not found"})
                    if self.path == "/admin/apply":
                        return self.send(200, engine.apply(body))
                    if self.path == "/admin/live":
                        ids = body.get("book_ids")
                        if not isinstance(ids, list) or len(ids) < 1000:
                            return self.send(400, {"error": "refusing a live set under 1,000 books (a failed read must not empty the results)"})
                        return self.send(200, engine.set_live(ids))
                    if self.path == "/admin/checkpoint":
                        st = kwindex.read_json(kwindex.STATE_PATH, {}) or {}
                        # A rebuild wrote a new state.json (checkpoint = its pull's start) while this process
                        # still serves the old index: a delta must not move the NEW index's checkpoint past
                        # changes it has not applied. The restart after the rebuild clears this.
                        if st.get("built_at") != engine.built_at:
                            return self.send(409, {"error": "state.json belongs to another build; restart the service"})
                        st["checkpoint"] = body.get("checkpoint")
                        st["last_delta_at"] = datetime.now(timezone.utc).isoformat()
                        kwindex.write_json_atomic(kwindex.STATE_PATH, st)
                        return self.send(200, {"checkpoint": st["checkpoint"], "last_delta_at": st["last_delta_at"]})
                    return self.send(404, {"error": "not found"})
                except Exception as e:  # one bad request must not take the service down
                    stats["errors"] += 1
                    log(f"error on {self.path}: {e!r}")
                    return self.send(500, {"error": str(e)[:300]})
        return H

    servers = [ThreadingHTTPServer((host, port), make(False)), ThreadingHTTPServer(("127.0.0.1", local_port), make(True))]
    for s in servers:
        s.daemon_threads = True
        threading.Thread(target=s.serve_forever, daemon=True).start()
    log(f"keyword-search on {host}:{port} (token {'on' if token else 'OFF'}), admin on 127.0.0.1:{local_port}")
    threading.Event().wait()


if __name__ == "__main__":
    main()
