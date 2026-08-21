# Note provenance & render fix — 2026-07-21/22

## Purpose (the thread — Derek flagged drift mid-session; keep this frame)
Readers, scholars, and licensing buyers must be able to tell **what the original
source says vs what we (AI) added**. Everything below is instrumental to that.
NOT the goal: scoring note accuracy for its own sake, or content-marketing posts.

## Shipped
- **PR #3298 (merged + deployed to prod)**: `src/lib/normalize-annotation-spans.ts` —
  reader preprocessing that rewrites note-family spans into balanced, non-nested,
  one-pair-per-paragraph form. Fixes the "can't tell what's a note" reader complaints:
  multi-paragraph `<note>` highlights died at the first blank line (CommonMark HTML-block
  boundary) and nested notes broke every lazy pairing regex. Verified live on the
  de Caus page (book 69a5b99dd76b98f272fcec6d, p.9). 13 unit tests
  (`tests/unit/normalize-annotation-spans.test.ts`). Display-only; frozen data untouched.
- **PR #3313 (open)**: `scripts/eval/ocr-purity-probe.mjs` — detector for UNTAGGED AI
  text serving as "original" (the class tag-provenance work can't see). Witness =
  `page_revisions` re-OCR pairs (Derek's idea) + English-register detector on
  non-English books. Lanes: mistag-suspect books / single-run leaks / shared-visual
  (systematic, agreement-proof) / shared-quotation-like (needs vision check).
  Also carries the CLAUDE.md doctrine caveat (note content ≠ uniformly source).

## Measured (evidence trail lives in issue #3308 comments)
- `<note>` prevalence: 61% of translated pages; `<margin>` 25%.
- Note content: ~39% `original: "…"` verbatim source phrases; rest AI-authored.
  **Margin discipline is GOOD** (~1% AI-pattern hits) — Derek challenged the
  "notes conflate with marginalia" phrasing and the data proved him right; retracted.
- Original-phrase fidelity: 82.4% mechanically verified verbatim on-page; the 17.6%
  residue decomposes to transliteration mismatch / contraction expansion (tempestaté) /
  line-break hyphens (operarum in-curia) / English-in-original-slot; near-zero true
  fabrication found. Newest model+prompt (3.1-flash-lite|11) verifies best: 93.8%.
- Untagged-leak rate (witness pairs, upper bound): ~1.6% of residue segments;
  38 language-mistag-suspect books surfaced (feed to metadata repair).
- Casual accuracy spot-check (16 notes): 0 factual fabrications; defect classes =
  image-desc misattribution (binding tooling read as "printed border" — only a vision
  judge catches it), Tibetan narration-instead-of-translation, malformed glosses.

## Open issues
- **#3308** — note-quality eval plan + all evidence comments. Phase 2 (two-judge,
  ~$5–15 Gemini vision) NOT approved yet; spend needs Derek's go.
- **#3310** — blog-post-about-quality idea. Derek rejected the drift; I said I'd
  close it — **still open, close it or let Derek decide**.
- **#2709** — reader labeling of AI vs source annotation (the purpose-critical UI work;
  #3298 was its prerequisite). #2393 — write-time prompt contract. #2236 — search index.

## Next (purpose-ordered, agreed direction before gnite)
1. Machine-readable provenance split of `<note>` (the `original:` prefix reclassifies
   ~40% of spans as source-derived today) → quote/embed/licensing surfaces act on
   provenance, not tag name. This is the licensing-critical piece.
2. Merge #3313, then `--random-pages --sample 5000` for the unbiased corpus leak rate;
   feed 38 mistag books to language repair.
3. #2709 reader labeling; #2393 prompt contract.

## Gotchas hit this session
- `$sample`+regex `$match` on `pages` takes 5–10 min per query — background everything.
- chrome-devtools MCP profile was locked by another session; claude-in-chrome extension
  disconnected → repo Playwright (node_modules) is the reliable screenshot path
  (~3.5s hydration wait).
- gh pr merge --delete-branch fails harmlessly in worktrees ("main already checked out").
- Auto-memory updated: lesson_note_highlight_markdown_block_boundary (includes the
  measured retraction — don't resurrect the margin-conflation claim).
