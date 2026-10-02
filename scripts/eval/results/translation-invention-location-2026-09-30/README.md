# Where does translation invention live? Notes, the continuity `<meta>`, and the body (2026-09-30)

PRIOR ART: `../translation-corpus-audit-2026-09-30/` (the served-page audit whose verdicts this re-reads) and
`../translation-restraint-ab-2026-09-30/` on PR #5349 (the A/B whose verdicts this re-reads). Neither says
WHERE on the page an invention sits, or whether a reader can see it. Issue #5305 (tq9 follow-up). No spend.

## Who this is for

Whoever decides the next translation-prompt change (v16, #4767) and whoever owns the reader. The question
behind it is a reader's: when the English says something the page does not, can I tell?

## 1. Where the judged inventions sit

Every invention defect the Opus judge listed, located in the translation it judged (the judge's quoted
phrase, found in the text, then read in context).

| Location | Served pages (audit, 311 pages, 48 defects) | Current prompt door (A/B, 95 pages × 3 arms, 57 defects) |
|---|---:|---:|
| Body text | 26 (54%), **14 of the 15 majors** | 21 (37%) |
| Continuity `<meta>` | 7 (15%) | **21 (37%)**, 1 major |
| `<note>` / `<gloss>` | 10 (21%), 1 major | 10 (18%) |
| Heading / running head | 3 | 2 |
| `<summary>` / `<keywords>` | 2 | 2 |
| `<unclear>` | 0 | 1 |

What they are, served pages (48):

| Kind | Count | Majors | Where |
|---|---:|---:|---|
| Imported neighbour text — the page edge completed with the NEXT page's opening (12) or the previous page's close (1); checked against the neighbour's OCR in the local mirror | 13 | 7 | body (12), meta (1) |
| Fluent prose over garbled or missing source | 7 | 7 | body |
| Invented context — a sentence about the previous page, a title, a heading | 10 | 0 | meta, summary, headings |
| Fabricated identification in a note — a name, date, office, attribution the page does not carry | 8 | 1 | note |
| Gloss or expansion presented as text (`[of the public benefit]`, "Samuel" Fenton) | 7 | 0 | body, gloss |
| Invented image description | 2 | 0 | note |
| Other (minor) | 1 | 0 | body |

**Reading.** On served pages (mostly prompt v2–v11), almost every major invention is in the BODY and is one of
two things: the next page's opening pulled back across the page break (the #5103 page-break fix targets this),
or confident prose over broken OCR (the proposed garble gate, #5274). Notes invent names and dates, all
minor bar one. Under the current prompt door the body share falls and the **continuity `<meta>` becomes the
largest single location**: the translator writes "previous-page" text that is in neither the previous
translation nor on this page (21 of 57).

## 2. What a reader sees

Traced in code (`src/components/reader/NotesRenderer.tsx`, `src/lib/strip-editorial-wrappers.ts`,
`src/components/reader-v2/Reader2C.tsx` `extractPageSummary`, the download route's `generateTxtDownload`):

- **`<meta>` is hidden everywhere** — reader, quote API, `/text`, search, embeddings, EPUB, PDF — by
  `stripEditorialWrappers`, content and all. Two leaks: the reader-v2 Info panel falls back to the first
  `<meta>` when a page has no `<summary>` and shows it under "This page"; the plain-text download writes raw
  tags, `<meta>` included.
- **`<note>` is shown** as a gold chip. Its only label is a hover tooltip, "Editorial note", and the ⓘ key
  says "Added here by an editor, not on the original." Nothing says a model wrote it. A fabricated
  identification therefore reaches the reader as an editor's statement. The KDP EPUB prints notes as plain
  text with no marking; the quote API and `/text` keep them inline.

So a meta invention is mostly harmless to a reader — they never see it. The notes are where a reader can be
misled, and they cannot tell a supported note from an invented one.

## 3. The finding the judge could not see: page text hidden in the meta

Because every surface drops `<meta>`, whatever the translator writes after "continues from previous page:"
is text no reader sees. The judge read the meta as part of the translation, so it never counted this as an
omission. The new check `metaPayload()` (`scripts/lib/page-integrity.mjs`, run by
`scripts/audit/page-integrity.mjs`) measures it on the local mirror.

Seeded sample of 3,000 mirror books (seed `20260930-tq9`), 930 of them translated, 228,405 translated pages
(`mirror-3000-page-integrity-summary.json`):

| Continuity meta | Pages |
|---|---:|
| Carrying the marker | 12,347 |
| Bare marker, or a sentence *about* the previous page | 2,862 |
| Payload under 8 words | 4,650 |
| **Copied** — the previous page's translation handed back (a hidden duplicate) | 2,162 |
| **Hidden text** — ≥ 8 words that are not the previous page's translation | **1,919** (0.84% of translated pages, **240 of 930 translated books**) |
| …of which the meta holds ≥ 80% of the page (the reader sees a blank or near-blank page) | 113 pages, 66 books |

Hand-read of 25 hidden-text flags, one per book, against the OCR (read from the mirror's OCR text, not the
image): **18 are the page's own opening lines** (up to the whole page) translated into the meta, so the
reader meets the page with its start missing; **6 are invented lead-ins**; 1 is harmless (it restates the
title the body also carries). 24 of 25 are real defects.

Limits: the mirror is 2026-09 vintage and carries no prompt version, so this rate cannot be split by prompt
era; the served audit had 10 of 311 pages with a text-bearing continuity meta. It is a rate over a book
sample, not the live corpus (the mirror's `visible` is stale — `reference_local_corpus_mirror`).

## 4. Recommendation — smallest fix first

1. **Detector (this PR, ships as a normal PR).** `metaPayload()` plus a `hidden-meta-text` repair list from
   `page-integrity.mjs --report`. Flags only; repairs nothing.
2. **Prompt (Derek's call, propose for v16).** The prompt asks for "Context from previous page →
   `<meta>continues from previous page: ...</meta>`". That `...` is the door: it invites text into a tag no
   reader sees. Change it to the bare marker only — "`<meta>continues from previous page</meta>`, nothing
   after it; begin the page's own text immediately after the tag". This removes the largest invention location
   under the current door and the hidden-omission class together. Test it in the v16 A/B, not alone.
3. **Write guard (small follow-up, no copy change).** Refuse a translation whose continuity meta holds ≥ 80%
   of its content (the 113-page blank-page case) the same way `assessTranslationHealth` refuses a collapse,
   and fix `isCollapsed`'s regex, which tests "continued from" while the prompt produces "continues from".
4. **Reader (Derek's call, reader-visible).** Label model notes as model notes ("Translator's note (AI)" in
   the key and tooltip, not "editor"); stop the Info panel falling back to `<meta>`.
