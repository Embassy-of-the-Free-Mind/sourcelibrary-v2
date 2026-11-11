# Librarian cite-by-ID A/B/C (#6946): registered rule

Committed before any main-run turn (eval-design §10.2, "Fixed before the run"). Two smoke turns (q01 B
and q01 C) ran before this commit to check the wiring; they are excluded from every count.

PRIOR ART: `scripts/eval/librarian-cite-prompt-6946/` (the last arm test on this issue: harness,
registered-rule shape, `score-links.mjs`); `scripts/eval/librarian-speed-6904/` (the 40 frozen
questions, the blind X/Y preference judge and its floor); `scripts/eval/librarian-citations-6946/` (the
per-link instrument `packet.ts` + `JUDGE-PROMPT.md`, shared with the weekly gauge; `load-support.ts`).

## Arms
- **A**: today's request (`citeIds` off, `gemini-3-flash-preview`, `fastToolRounds` on). Its system
  prompt is byte-identical to `origin/main` at c5d82c327 (checked for en/es, both thinking settings,
  `citePages` on and off, message 1 and 3).
- **B**: `citeIds` on (`src/lib/embassy/cite-ids.ts`, `LIBRARIAN_CITE_IDS`):
  - every page a tool shows (search and find_passages hits, neighbour pages, get_book_page,
    read_nearby_pages, an image's own page) carries an ID like `[P7]`; the prompt says to cite by ID
    only and never to write a page link or page number link;
  - the server rewrites each ID to `[Page N](…/book/<slug>?page=N)` while the text streams, with the
    short book title in front when the book is not already linked there. An unknown ID is dropped and
    its claim stays as plain text. The grounding, citation-page (quote re-point) and link checks then
    run on the rendered text exactly as today, so a quotation is checked against the ID's own page;
  - the top 6 hits of each search / find_passages call are shown whole (cleaned as question search
    cleans them, cap 8,000 characters), the rest keep the 1,200-character window; neighbour and
    nearby pages up to 3,000 characters (today 700 and 1,000).
- **C**: B on `gemini-3.8-flash`, thinking LOW on every tool round as #6909 (the forced no-tools
  synthesis keeps the default). Smoke check: `thoughtsTokenCount` 0 at LOW on both models.
- **A2**: A again on the 8 `aVsA` questions (noise floor).

Questions: `librarian-speed-6904/questions.json` (40, frozen 2026-10-18), in-process on this box,
interleaved per question with the arm order rotating ABC / BCA / CAB, concurrency 2.

## Judging
1. **Per-link (the gauge's instrument).** Each answer as the reader sees it → `packet.ts`; every page
   link labelled `cited / other / none / wrong_fact / missing` by two Opus judges (`claude -p`,
   subscription) on whole pages. Where J1 and J2 differ on any link of an answer, a third Opus judge
   reads that answer and decides each split link. Packets carry no arm.
2. **Preference (#6904's judge).** Blind X/Y, two Opus judges and a third on disagreements, whole pages:
   B vs A (40), C vs B (40), A2 vs A (8, the floor). C vs A (40) is judged only if C is a candidate
   against A (passes G1, G2, G4 vs A) and B is not.

## Decision rule
Counts over the 40 questions; *wrong-page* = `other` + `none`; `missing` is out of every count.
For an arm X against a reference R:
- **G1 wrong-page.** D = (R − X) / R in wrong-page links; noise N = |A − A2| / A on the 8 control
  questions. **Pass iff D ≥ 0.40 + N.**
- **G2 wrong fact.** X's `wrong_fact` rate per judged link ≤ R's + |A − A2| (that rate on the 8).
- **G3 preference.** X's net loss (X losses − X wins) / 40 ≤ the floor max(|A2 wins − A wins| / 8, 1/8).
  Grounding-failure counts (only-X vs only-R) are reported, not gated.
- **G4 time.** X's p50 time to done ≤ 1.15 × R's.
- **G5 cost.** $ per turn and prompt tokens per turn reported for every arm (no threshold).
- **G6 not by deleting links.** X keeps ≥ 80% as many `cited` links as R (a wrong-page count can fall
  just because an arm links less).

**B passes iff G1–G6 hold for X = B, R = A.** **C passes iff they hold for X = C, R = A.**
**C beats B iff G1, G2, G3 and G6 also hold for X = C, R = B**; then its extra latency and cost are
reported. Ship as the default: C if C passes and beats B (or passes while B does not); else B if B
passes; else nothing, and every change lands behind flags, off (`LIBRARIAN_CITE_IDS`, `LIBRARIAN_MODEL`).

Reported, not gated: wrong-page rate per link, answers with a wrong-page link, J1/J2 κ, first-text and
done p50/p90, IDs rendered / dropped and page links the model wrote by hand in B and C.

## Envelope
Approved by Derek in chat 2026-10-19: about 150 turns, **hard cap 170 turns and $6** by the turns' own
usage numbers (`run.ts --max-turns=170 --max-usd=6`; the 2 smoke turns, $0.057, count against both).
No other Gemini. Judges: Opus via `claude -p` on the subscription only.
Planned: 2 smoke + 40 A + 40 B + 40 C + 8 A2 = 130 turns.
