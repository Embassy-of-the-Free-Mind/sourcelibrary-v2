# Non-Latin text — an empty result is UNJUDGEABLE, never a negative finding

**Read this when:** writing or changing anything that normalises, folds, compares,
matches, or validates text — name comparison, quote verification, dedup keys,
detectors, guards, prompts that teach a grammar.

*Added 2026-08-17 after one session shipped six instances of the same bug.*

---

The corpus is ~30% Latin. Every text helper in it gets written and tested against
Latin text, so the failure never shows up where the author is looking. The shape
is always identical: **an operation reduces non-Latin input to nothing, and the
nothing is then read as a negative answer rather than as "cannot judge".**

Six instances in a single session, each trivial in isolation:

| operation | what it did to non-Latin input | reported as |
|---|---|---|
| a prompt teaching attribution grammar | taught Latin formulas only | "front matter names no author" — for **93%** of non-Latin books |
| a quote-on-page verifier (`[a-z0-9]` strip) | quote → empty string | "unverifiable" — **87%** of proposals discarded |
| a name comparator (`foldOrtho`) | 薛己 → `""` | "different person" — precision under-reported by ~10 points |
| a token-overlap metric (3-char floor) | `Yi I` → empty token set | "disagreement" |
| an ayn/hamza fold (mark → space) | `Saʻdī` → `sa`+`di`, both sub-floor | "two people" |
| a Wikidata validator (errors uncaught) | HTTP 429 → same bucket as a miss | "184 of 200 not found" |

## The rule

**Test whether the operation CAN judge before asking what it says.** An empty
comparable set means unjudged. Give it its own bucket, report it, and never fold
it into either verdict — a missing flag must not read as a clean one.

## Concretely

- Normalisers keep letters and digits from **every** script: `\p{L}\p{N}` with
  NFKC, not `[a-z0-9]` or `\w`. ASCII `\w` once blanked 15% of books.
- Marks that sit **inside** a word — ayn, hamza, apostrophes — are **elided**, not
  turned into separators. `Saʻdī` must reach the length floors as `sadi`, not as
  two sub-floor fragments.
- Length floors (3-char tokens, 4-char stems) are load-bearing *against
  manufactured agreement* and fatal *for short transliterations*. CJK and Korean
  romanisations (`Yi I`, `O Sa-gi`) are all floor or below — abstain, don't judge.
- Errors are not absences. An HTTP 429, a parse failure, a timeout each get their
  own verdict. A validator that converts its own failures into negative findings
  is worse than no validator.
- A prompt that teaches one tradition's grammar reports every other tradition as
  silent. If it lists Latin genitives and `auctore`, it also needs 撰 / 著 / 纂集
  against 校正 / 註, Arabic تأليف and لـ against حققه and the scribe's كتبه, and
  the Sanskrit and Tibetan colophon forms.

## The unjudgeable input is not always empty — sometimes it is a sentinel

*Added 2026-08-31 after #4389.*

Every case above fails **loudly-ish**: the operation returns nothing, and the
bug is that nothing got read as a negative. There is a worse shape, because it
never returns nothing at all.

An ETCSL import built each book's slug from an English-title field that held
the literal string `"Unknown"` wherever the English title had not been
resolved. `slugify("Unknown")` is `"unknown"` — a well-formed, readable,
entirely legal slug. No fallback branch fired. Nothing was empty, nothing threw,
nothing looked wrong at any point downstream. The importer's own dedupe counter
finished the job, and **112 books went live at `/book/unknown-1` …
`/book/unknown-111`** with good titles sitting one field over, for six months,
until an MCP client noticed.

**The rule.** A catalogue sentinel — `Unknown`, `Untitled`, `n/a`, `?`,
`Onbekend`, `[no title]` — is the ABSENCE of a value written in the shape of
one. Test for it *before* the value reaches a normaliser, because after
normalisation it is indistinguishable from data. `isNonTitle()` in
`src/lib/slugify.ts` is the reference list; reuse it rather than growing a
second one.

**The tell**: an output that is perfectly well-formed and identical across many
records. Sameness at scale is the signature — 112 slugs sharing one stem is not
a coincidence, and no shape check can find it, because each one is individually
valid.

**The corollary for detectors.** A guard written against the empty case will not
fire here. `isPlaceholderSlug` had caught `-10` and `untitled-3` for months and
was blind to `unknown-7`, because that string has letters, no leading hyphen,
and reads like English. If a rule exists to catch "nothing usable got through",
enumerate the sentinels it must also catch.

## The test that would have caught all six

A unit fixture of the same assertion in Chinese, Arabic, Hebrew and Devanagari,
run against every text helper, asserting **unjudgeable — not negative**. An hour
of work against six shipped bugs. Related: `author-identity.md` (which already
stated the rule and did not stop it), and
`lesson_ascii_word_class_erases_nonlatin_corpus` in the private store.
