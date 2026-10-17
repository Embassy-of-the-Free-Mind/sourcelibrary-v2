"""Shared pieces of the keyword page service (#6852): paths, the schema, the book map, and the analyzer that
the build, the delta and every query go through. One definition, in Rust (tantivy's regex tokenizer), so
index and query tokens cannot drift apart.

PRIOR ART: github.com/JDerekLomas/sourcelibrary-atlas scripts/local-corpus/index-fts.mjs (SQLite FTS5,
unicode61 + trigram). FTS5 was the first choice here and was measured out: it scores every page a term
matches, so a common word took 175-320 ms on 8.7% of the corpus (2-4 s projected for all of it, slower than
the Atlas lane it replaces), where tantivy's block-max WAND took 2-4 ms on the same pages. The numbers are
in README.md and scripts/eval/experiments/2026-10-17-keyword-service-parity-6852.md.
"""
import json
import os
import re

import tantivy

ROOT = os.environ.get("KEYWORD_SEARCH_ROOT", "/data/keyword-search")
SHARD_DIR = os.path.join(ROOT, "shards")
INDEX_DIR = os.path.join(ROOT, "index")
STATE_PATH = os.path.join(ROOT, "state.json")
LIVE_PATH = os.path.join(ROOT, "live_books.json")
BOOKS_PATH = os.path.join(ROOT, "books.json")

# The Atlas lane's `$match` after `$search` (src/lib/atlas-search.ts NON_CONTENT_PAGE_TYPES). A copy, because
# this directory is installed apart from the app; tests/unit/keyword-search.test.ts pins the two together.
NON_CONTENT_PAGE_TYPES = ["blank", "illustration", "title-page", "colophon", "frontispiece", "digitizer-insert"]

# ---------------------------------------------------------------------------------------------------------
# Analyzer: an approximation of Atlas `lucene.standard` (StandardTokenizer = UAX#29 words, then
# LowerCaseFilter; no stemming, no stop list, no diacritic folding — .claude/docs/search.md).
#  - A word is a run of letters, marks, digits and connector punctuation. As in UAX#29, an apostrophe,
#    period, colon or middle dot joins two LETTERS (MidLetter/MidNumLet: "Drebbel's", "U.S.A", "l'homme"),
#    and a period, comma, semicolon or apostrophe joins two DIGITS (MidNum/MidNumLet: "1,000", "2.967"),
#    never a letter to a digit: "c.1.a" is c / 1 / a, so the phrase "a Astronomia" matches after it, as in
#    Atlas (the first pattern here joined it and missed those pages). "Drebbel's" is one token, as in
#    Atlas, where "Drebbel" does not match it either.
#  - Han ideographs and Hiragana are one token per character, which StandardTokenizer emits for them.
#    Katakana, Hangul and Thai runs stay whole (StandardTokenizer splits Thai by dictionary; a known gap).
#  - Lowercased per character (a final capital sigma becomes σ, as in Lucene). Tokens over 256 characters
#    (OCR noise) are dropped; Lucene splits them at 255.
# A token is one Han/Hiragana character, or a run of units: a letter followed by any "joiner + letter"
# pairs, a digit followed by any "joiner + digit" pairs, or an underscore. Each unit ends in its own class,
# so a joiner is only ever consumed between two characters of the same class (no lookaround needed).
# ---------------------------------------------------------------------------------------------------------
ANALYZER = "lucene_std"
_L = r"[\p{L}\p{M}--\p{Han}--\p{Hiragana}]"
_JOIN_LETTERS = "['‘’.:·]"
_JOIN_DIGITS = "[.,;'‘’]"
TOKEN_PATTERN = (r"[\p{Han}\p{Hiragana}]|(?:" + _L + "(?:" + _JOIN_LETTERS + _L + ")*"
                 + r"|\p{N}(?:" + _JOIN_DIGITS + r"\p{N})*|\p{Pc})+")


def analyzer():
    return (tantivy.TextAnalyzerBuilder(tantivy.Tokenizer.regex(TOKEN_PATTERN))
            .filter(tantivy.Filter.lowercase())
            .filter(tantivy.Filter.remove_long(256))
            .build())


_ANALYZER = None


def tokenize(text):
    """Tokens of `text`, exactly as the index holds them."""
    global _ANALYZER
    if _ANALYZER is None:
        _ANALYZER = analyzer()
    return _ANALYZER.analyze(text or "")


def schema():
    """`tr`/`ocr`: the page text (not stored; the app hydrates it from Mongo by page id), with positions for
    phrases. A hit is filtered and identified from FAST fields only — `book_idx` (an index into books.json),
    `page_number`, and the page id's 96 bits as `pid_hi`/`pid_lo` — because reading the stored document for
    every hit was the slowest part of a query (random reads from a cold network volume: 60–580 ms a query,
    measured 2026-10-17). `page_id`/`book_id` stay as raw indexed text: delete-by-term, and the stored
    fallback for a page id that is not 24 hex digits (pid_hi = pid_lo = 0). `content`: 0 for a
    NON_CONTENT_PAGE_TYPES page."""
    sb = tantivy.SchemaBuilder()
    sb.add_text_field("page_id", stored=True, tokenizer_name="raw")
    sb.add_text_field("book_id", stored=True, tokenizer_name="raw")
    # i64, not u64: tantivy-py hands every Python int to tantivy as i64, and a u64 column refuses it.
    sb.add_integer_field("book_idx", stored=False, indexed=True, fast=True)
    sb.add_integer_field("page_number", stored=False, indexed=False, fast=True)
    sb.add_integer_field("pid_hi", stored=False, indexed=False, fast=True)
    sb.add_integer_field("pid_lo", stored=False, indexed=False, fast=True)
    sb.add_integer_field("content", stored=False, indexed=True)
    sb.add_text_field("tr", stored=False, tokenizer_name=ANALYZER, index_option="position")
    sb.add_text_field("ocr", stored=False, tokenizer_name=ANALYZER, index_option="position")
    return sb.build()


def open_index(path=INDEX_DIR, create=False):
    os.makedirs(path, exist_ok=True)
    if create:
        idx = tantivy.Index(schema(), path=path, reuse=False)
    else:
        idx = tantivy.Index.open(path)
    idx.register_tokenizer(ANALYZER, analyzer())
    return idx


_HEX24 = re.compile(r"^[0-9a-f]{24}$")


def split_page_id(pid):
    """A 24-hex-digit page id → (hi 64 bits as a signed i64, lo 32 bits); anything else → (0, 0), which the
    reader resolves from the stored doc."""
    if not _HEX24.match(pid):
        return (0, 0)
    hi = int(pid[:16], 16)
    return (hi - (1 << 64) if hi >= (1 << 63) else hi, int(pid[16:], 16))


def join_page_id(hi, lo):
    if not (hi or lo):
        return None
    return f"{hi & ((1 << 64) - 1):016x}{lo:08x}"


class Books:
    """book id ↔ the small integer the index stores. Append-only, saved as books.json beside the index (a
    rebuild writes a new map with its new index; an index never renumbers)."""

    def __init__(self, ids=None):
        self.ids = list(ids or [])
        self.idx = {b: i for i, b in enumerate(self.ids)}
        self.dirty = False

    def of(self, book_id):
        i = self.idx.get(book_id)
        if i is None:
            i = len(self.ids)
            self.ids.append(book_id)
            self.idx[book_id] = i
            self.dirty = True
        return i

    @classmethod
    def load(cls, path=BOOKS_PATH):
        return cls(read_json(path, []))

    def save(self, path=BOOKS_PATH):
        write_json_atomic(path, self.ids)
        self.dirty = False


def page_document(row, books):
    """A shard/delta row ({i, b, n, t, tr, o}: scripts/workers/keyword-search/lib.mjs pageRow) → a Document."""
    hi, lo = split_page_id(row["i"])
    return tantivy.Document(
        page_id=row["i"], book_id=row["b"], book_idx=books.of(row["b"]), page_number=max(0, int(row["n"])),
        pid_hi=hi, pid_lo=lo, content=0 if row.get("t") in NON_CONTENT_PAGE_TYPES else 1,
        tr=row.get("tr") or "", ocr=row.get("o") or "",
    )


def read_json(path, default=None):
    try:
        with open(path) as f:
            return json.load(f)
    except FileNotFoundError:
        return default


def write_json_atomic(path, obj):
    tmp = f"{path}.tmp-{os.getpid()}"
    with open(tmp, "w") as f:
        json.dump(obj, f)
    os.replace(tmp, path)
