# A test that greps source is not a guard

**Read this when:** Writing a test that pins behaviour, or writing a fixture for one.

*Split out of `CLAUDE.md` on 2026-08-04. The text is unchanged apart from cross-references repointed to their new files. See `.claude/docs/knowledge-layer.md` for why this tier exists.*

---

A unit test whose every assertion is "this string appears in this file" can only catch **deletion**, never **wrongness**. `tests/unit/tenant-account-menu.test.ts` (#3383) asserted seven such facts — including one pinning the exact `pathname.startsWith('/embed/')` check that was the bug — and passed green the entire time the feature was broken in production. It was reverted along with the code it "guarded".

Source-shape assertions are legitimate for **absence** invariants, where deletion *is* the failure mode: `tests/unit/soft-404-loading-guard.test.ts` pins that certain `loading.tsx` files do not exist, and re-adding one genuinely reintroduces the soft-404. That test earns its keep; a shape test for *behaviour* does not.

For behaviour, the assertion has to exercise the thing: render the component under the condition (a simulated tenant host), call the function (`proxy()` directly, per the tenant section above), or hit a deployed URL and check the response. **Before writing a guard, ask what code change would make it fail — if the answer is only "deleting this line", it is documentation with a green checkmark, not a test.**

**Don't reason about that question — run it.** Delete the guarded line, watch the test go red, restore it. Two source-shape guards written in one session (#3484/#3488) both passed *with the code they guarded deleted*, and neither failure was visible by reading the test: one asserted `toContain('hasSearchTerm')` + `toContain('offset === 0')`, where both tokens occur elsewhere in the same file; the other asserted `/tenantId/` against a call body and was satisfied by the **explanatory comment sitting directly above `tenantId,`**. A source assertion matches the whole file, comments included — so scope it to a slice, strip comments before matching, or assert a composite string whose position relative to the call is checked. The negative control is the only thing that distinguishes a guard from a decoration.

**A fixture you INVENTED is evidence about you, not about the system.** The rule above assumes the test's *input* is real and only its assertion is in doubt. A third guard failed the same way in #3584 with a real assertion and fabricated input: the control for a diacritic-folding fix hand-wrote a title page as `"… IKHWÁNU-S SAFÁ. Translated from the Hindustani."`, and "Translated" matched the title's own `translation` token through the matcher's six-character prefix rule (`transl`). It passed **with the fold deliberately removed** — a real code path, exercised, asserting nothing. The database's actual page holds only `# IKHWÁNU-S SAFÁ.` and no such phrase. Two details made it invisible: the stopword list screened `translated` but not `translation`, and the fixture was written *after* the wanted verdict was known, which is how invented evidence acquires exactly the properties it needs. **Capture fixture text from the real source before writing the assertion, never after** — a fixture drafted toward a known answer will reach that answer by whichever path is available, and you will not know which. This is the paired-artifact rule applied to test data: the fixture *claims* to stand for the real artifact, and nothing checks that it does.

**"Did anything come back?" cannot see a WRONG ORDER.** The three failures above all
have a real defect somewhere in the test — a source-shape assertion, a missing negative
control, an invented fixture. This fourth one has none: the assertion is real, it
exercises the deployed code, and its input is genuine. It is still worthless against a
whole class of bug, because it only asks whether the result set is non-empty.

`tests/smoke/mcp-search.test.ts` asserts non-emptiness and total-stability for every
search tool. **Every one of its assertions passed throughout the period an MCP client
was reporting that `search_within_book` was unusable** (#3653, fixed in #3680): a
natural-language query returned 48 pages of front matter, in strict page order, with the
page containing the searched sentence ranked ~50th or absent. The results were never
empty. They were plausible and wrong. A search tool that returned pages 1–48 of every
book would have passed that suite completely.

This matters here more than in most codebases, because **for a corpus of historical text
a wrong answer is indistinguishable from a right one at a glance** — a real page of real
Aristotle, correctly cited, that simply is not the passage asked for. That is the same
family as the wrapper-block misquote in `quote-and-snippet-integrity.md`: valid
apparatus wrapped around the wrong words.

So for anything ranked, ordered, or scored, the assertion must name the expected answer:
*for THIS query on THIS book, THIS page must be in the top N* — sourced from a human who
read the page and confirmed it carries the sentence. `tests/smoke/mcp-golden-passages.test.ts`
(#3702) does this, and pairs each case with the two controls that keep it honest: a rare
term must still return only its exact pages, and a query the book cannot answer must
score below one it answers verbatim. Without those, a "fix" that loosens matching until
everything ranks everywhere satisfies every golden-passage case.

Record what the API actually returned *before* the fix alongside each case (the fixture
uses a `$was` field). A year later that is the only thing distinguishing a regression
from a never-worked, and the difference decides whether you revert or investigate.

Corollary, learned the same session: **when a known bug has no owner yet, pin it with
`it.fails`, not `it.skip`.** A skipped test rots silently and its comment goes stale;
`it.fails` asserts the failure, so *fixing* the bug turns the suite red and forces
someone to remove the marker. #3699 is pinned that way.
