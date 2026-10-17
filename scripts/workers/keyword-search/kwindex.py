"""Shared pieces of the keyword page service (#6852): paths, the schema, and the analyzer that the build,
the delta and every query go through. One definition, in Rust (tantivy's regex tokenizer), so index and
query tokens cannot drift apart.

PRIOR ART: github.com/JDerekLomas/sourcelibrary-atlas scripts/local-corpus/index-fts.mjs (SQLite FTS5,
unicode61 + trigram). FTS5 was the first choice here and was measured out: it scores every page a term
matches, so a common word took 175-320 ms on 8.7% of the corpus (2-4 s projected for all of it, slower than
the Atlas lane it replaces), where tantivy's block-max WAND took 2-4 ms on the same pages. The numbers are
in scripts/eval/experiments/2026-10-17-keyword-service-parity-6852.md.
"""
import json
import os

import tantivy

ROOT = os.environ.get("KEYWORD_SEARCH_ROOT", "/data/keyword-search")
SHARD_DIR = os.path.join(ROOT, "shards")
INDEX_DIR = os.path.join(ROOT, "index")
STATE_PATH = os.path.join(ROOT, "state.json")
LIVE_PATH = os.path.join(ROOT, "live_books.json")

# The Atlas lane's `$match` after `$search` (src/lib/atlas-search.ts NON_CONTENT_PAGE_TYPES). A copy, because
# this directory is installed apart from the app; tests/unit/keyword-search.test.ts pins the two together.
NON_CONTENT_PAGE_TYPES = ["blank", "illustration", "title-page", "colophon", "frontispiece", "digitizer-insert"]

# ---------------------------------------------------------------------------------------------------------
# Analyzer: an approximation of Atlas `lucene.standard` (StandardTokenizer = UAX#29 words, then
# LowerCaseFilter; no stemming, no stop list, no diacritic folding — .claude/docs/search.md).
#  - A word is a run of letters, marks, digits and connector punctuation. An apostrophe, period, colon or
#    middle dot BETWEEN word characters joins them (UAX#29 MidLetter/MidNumLet): "Drebbel's" is one token,
#    as in Atlas, where "Drebbel" does not match it either. A comma joins only before a digit ("1,000").
#  - Han ideographs and Hiragana are one token per character, which StandardTokenizer emits for them.
#    Katakana, Hangul and Thai runs stay whole (StandardTokenizer splits Thai by dictionary; a known gap).
#  - Lowercased per character (a final capital sigma becomes σ, as in Lucene). Tokens over 256 characters
#    (OCR noise) are dropped; Lucene splits them at 255.
# ---------------------------------------------------------------------------------------------------------
ANALYZER = "lucene_std"
_W = r"[\p{L}\p{M}\p{N}\p{Pc}--\p{Han}--\p{Hiragana}]"
TOKEN_PATTERN = r"[\p{Han}\p{Hiragana}]|" + _W + r"+(?:['’.:·]" + _W + r"+|,\p{N}" + _W + r"*)*"


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
    phrases. `page_id`/`book_id`: raw, for delete-by-term, the book filter and the roll-up's terms
    aggregation (book_id is a fast field). `content`: 0 for a NON_CONTENT_PAGE_TYPES page."""
    sb = tantivy.SchemaBuilder()
    sb.add_text_field("page_id", stored=True, tokenizer_name="raw")
    sb.add_text_field("book_id", stored=True, tokenizer_name="raw", fast=True)
    sb.add_integer_field("page_number", stored=True, indexed=False)
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


def page_document(row):
    """A shard/delta row ({i, b, n, t, tr, o}: scripts/workers/keyword-search/lib.mjs pageRow) → a Document."""
    return tantivy.Document(
        page_id=row["i"], book_id=row["b"], page_number=int(row["n"]),
        content=0 if row.get("t") in NON_CONTENT_PAGE_TYPES else 1,
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
        json.dump(obj, f, indent=2)
    os.replace(tmp, path)
