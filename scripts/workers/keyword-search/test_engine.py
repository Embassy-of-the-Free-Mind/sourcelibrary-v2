"""Self-test of the keyword page service's engine (#6852) on a tiny index. Run before installing or after
changing kwindex.py / server.py:

    venv/bin/python test_engine.py        # exits non-zero on the first failure

Not in CI: the app's CI installs no Python. The app side (src/lib/keyword-search.ts) is covered by
tests/unit/keyword-search.test.ts, which also pins NON_CONTENT_PAGE_TYPES here to the app's list.

What must hold:
  - the analyzer splits and lowercases as StandardTokenizer does, folds nothing, keeps "Drebbel's" whole;
  - Han/Hiragana are one token per character, so a two-character Chinese word matches;
  - the lane: ANY word, the quoted phrase, fuzzy for one long word (the exact word still ranks first),
    non-content pages dropped, live books only, an EMPTY allow-list returns nothing (#2760);
  - variants are their own list minus main; the roll-up counts pages printing EVERY term;
  - a delta upsert replaces a page in place and a remove takes it out.
"""
import os
import sys
import tempfile

os.environ["KEYWORD_SEARCH_ROOT"] = tempfile.mkdtemp(prefix="kw-test-")
import kwindex  # noqa: E402
import server  # noqa: E402

failures = 0


def check(name, got, want):
    global failures
    if got != want:
        failures += 1
        print(f"FAIL {name}\n   got  {got!r}\n   want {want!r}")
    else:
        print(f"ok   {name}")


T = kwindex.tokenize
check("splits, lowercases, keeps diacritics", T("Mercurius, Philosophorum!  Ætna Müller"), ["mercurius", "philosophorum", "ætna", "müller"])
check("apostrophe/period between letters joins", T("Drebbel's e.g. U.S.A. philosophers' stone"), ["drebbel's", "e.g", "u.s.a", "philosophers", "stone"])
check("comma joins digits only", T("1,000 men,women"), ["1,000", "men", "women"])
check("Han and Hiragana per character", T("道德經 ひらがな カタカナ 한국어"), ["道", "德", "經", "ひ", "ら", "が", "な", "カタカナ", "한국어"])
check("marks stay in the word", T("योगः सूत्र བྱང་ཆུབ"), ["योगः", "सूत्र", "བྱང", "ཆུབ"])
check("a joiner never joins a letter to a digit (UAX#29)", T("c.1.a Astronomia 2.967.a"), ["c", "1", "a", "astronomia", "2.967", "a"])
check("chains of joined letters", T("a.b.c ab.cd.ef l'homme d'Arc"), ["a.b.c", "ab.cd.ef", "l'homme", "d'arc"])
check("final sigma lowercases to σ (Lucene)", T("ΛΟΓΟΣ"), ["λογοσ"])
check("within_one_edit", [server.within_one_edit(a, b) for a, b in [("alchemy", "alchymy"), ("alchemy", "alchmey"), ("alchemy", "alchemyx"), ("alchemy", "alkhemi"), ("masturbation", "masturbator")]], [True, True, True, False, False])

P = lambda i, b, n, tr, o="", t="": {"i": i, "b": b, "n": n, "tr": tr, "o": o, "t": t}
pages = [
    P("p1", "b1", 1, "The alchemy of the philosophers stone is a great work."),
    P("p2", "b1", 2, "Of the stone and the prima materia.", "De lapide et prima materia"),
    P("p3", "b2", 1, "Nothing about it here, only the alchymy of old."),
    P("p4", "b2", 2, "Cornelius Drebbel built a furnace.", "Drebbelius fornacem construxit"),
    P("p5", "b3", 1, "Alchemy alchemy alchemy, the stone."),                 # hidden book
    P("p6", "b4", 1, "A title page that says alchemy.", "", "title-page"),   # non-content
    P("p7", "b4", 2, "", "materia prima, sine forma"),
    P("p8", "b5", 1, "道德經 第一章"),
    P("p9", "b6", 1, "prima materia stone"), P("p10", "b6", 2, "prima materia again, stone"), P("p11", "b6", 3, "prima materia, stone, third"),
]
for _ in range(40):  # enough filler that IDF behaves like a corpus, not like eleven pages
    pages.append(P(f"f{_}", "b9", 100 + _, "an ordinary page of prose about other things entirely"))
idx = kwindex.open_index(create=True)
w = idx.writer(heap_size=50_000_000, num_threads=1)
books = kwindex.Books()
for p in pages:
    w.add_document(kwindex.page_document(p, books))
w.commit()
w.wait_merging_threads()
books.save()
del w, idx
e = server.Engine()
e.set_live(["b1", "b2", "b4", "b5", "b6", "b9"])
ids = lambda rows: [r["page_id"] for r in rows]

r = e.lane({"query": "alchemy stone", "k": 25})
check("ANY word: p1 and p2 found", {"p1", "p2"} <= set(ids(r["main"])), True)
check("hidden book and title page dropped", {"p5", "p6"} & set(ids(r["main"])), set())
r = e.lane({"query": '"prima materia"', "k": 25})
check("quoted query is a phrase (not 'materia prima')", sorted(ids(r["main"])), ["p10", "p11", "p2", "p9"])
r = e.lane({"query": "alchemy", "k": 25})
check("fuzzy expands (alchymy found)", "p3" in ids(r["main"]) and r["fuzzy_terms"] >= 2, True)
check("the exact word still ranks first", ids(r["main"])[0] != "p3", True)
check("one long hyphenated word is fuzzy per token", e.lane({"query": "Drebbel-alchymy", "k": 25})["fuzzy_terms"] >= 3, True)
check("a short token's fuzzy expansions are itself plus one character", sorted(t for t, _ in e.fuzzy_candidates("tr", "old")), ["old"])
check("two-character Chinese word", ids(e.lane({"query": "道德", "k": 5})["main"]), ["p8"])
check("allow-list confines", sorted(ids(e.lane({"query": "stone", "k": 25, "book_ids": ["b6"]})["main"])), ["p10", "p11", "p9"])
check("EMPTY allow-list returns nothing (#2760)", e.lane({"query": "stone", "k": 25, "book_ids": []})["main"], [])
r = e.lane({"query": "Drebbel", "k": 25, "variants": ["Drebbelius"], "topic_words": []})
check("variant page already in main is not repeated", (ids(r["main"]), r["variants"]), (["p4"], []))
r = e.lane({"query": "xyzzy", "k": 5, "variants": ["Drebbelius"], "topic_words": ["fornacem"]})
check("variants list: must print a variant and a topic word", ids(r["variants"]), ["p4"])
r = e.lane({"query": "prima materia", "k": 1, "rollup": {"terms": ["prima", "materia"], "buckets": 200, "max_books": 30}})
check("roll-up counts pages printing EVERY term, live books", r["counts"], [{"book_id": "b6", "pages": 3}, {"book_id": "b1", "pages": 1}, {"book_id": "b4", "pages": 1}])
reached = {x["book_id"] for x in r["main"]}
check("roll-up adds one page per unreached book", all(x["book_id"] not in reached for x in r["extra"]) and len(r["extra"]) == 2, True)
e.set_live(["b1", "b2", "b3", "b4", "b5", "b6", "b9"])
check("the live set changes results with no index change", "p5" in ids(e.lane({"query": "alchemy stone", "k": 25})["main"]), True)
e.set_live(["b1", "b2", "b4", "b5", "b6", "b9"])
e.apply({"upserts": [P("p3", "b2", 1, "Now this page is about the philosophers stone.")], "removes": ["p9"]})
r = e.lane({"query": "alchymy", "k": 25})
check("delta upsert replaced the page text", "p3" in ids(r["main"]), False)
check("delta remove took the page out", "p9" in ids(e.lane({"query": "stone", "k": 50})["main"]), False)
check("delta upsert is searchable", "p3" in ids(e.lane({"query": "philosophers", "k": 50})["main"]), True)
e.apply({"upserts": [P("q1", "bnew", 4, "a brand new book about the philosophers stone")]})
check("a delta page of a NEW book is in the map, and absent until the book is live", ("bnew" in e.books.idx, "q1" in ids(e.lane({"query": "brand", "k": 5})["main"])), (True, False))
e.set_live(["b1", "b2", "b4", "b5", "b6", "b9", "bnew"])
check("...and present once it is", ids(e.lane({"query": "brand", "k": 5})["main"]), ["q1"])
check("page ids come back from the fast fields intact", e.lane({"query": "brand", "k": 5})["main"][0]["page_id"], "q1")
check("a 24-hex page id round-trips through the i64 fast fields", [kwindex.join_page_id(*kwindex.split_page_id(x)) for x in ["ffffffffffffffffffffffff", "6a37c9c506d55b107dab8922", "000000000000000000000001"]], ["ffffffffffffffffffffffff", "6a37c9c506d55b107dab8922", "000000000000000000000001"])

print(f"\n{'FAILED: ' + str(failures) if failures else 'all passed'}")
sys.exit(1 if failures else 0)
