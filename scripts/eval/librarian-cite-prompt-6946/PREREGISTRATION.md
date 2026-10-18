# Librarian citation prompt A/B (#6946): registered rule

Committed before any main-run turn (eval-design §10.2, "Fixed before the run").

PRIOR ART: `scripts/eval/librarian-speed-6904/` (the in-process harness, the 40 frozen questions, the
blind X/Y preference judge and its rule); `scripts/eval/librarian-citations-6946/` (the per-link
instrument `packet.ts` + `JUDGE-PROMPT.md`, shared with the weekly gauge; `load-support.ts` rebuilds
the pages each answer cited and read, whole, from Mongo).

## Arms
- **A**: today's request, the #6909/#6956 shipped state (`fastToolRounds` on, `citePages` off). Its
  system prompt is byte-identical to `main` at 5327f847f (checked for en/es, both thinking settings).
- **B**: `citePages` on: the four closing Formatting lines replaced by `CITE_PAGES_LINES`
  (`src/lib/embassy/librarian.ts`): link a sentence only to the page whose text states it, the page
  where the words are; background plainly with no link; quote only tool-result words, one blockquote
  from one page with that page's link; captions only what the image record says.
- **A2**: A again on the 8 `aVsA` questions (noise floor).
- Same model (`gemini-3-flash-preview`), thinking, search, grounding passes; the router stays off.

Questions: `librarian-speed-6904/questions.json` (40, frozen 2026-10-18). Interleaved per question.

## Judging
1. **Per-link (the gauge's instrument).** Every answer (the text the reader sees, after the grounding
   pass) → `packet.ts`; every page link labelled `cited / other / none / wrong_fact / missing` by two
   Opus judges (`claude -p`, subscription) on whole pages. Where J1 and J2 differ on any link of an
   answer, a third Opus judge reads that answer; its label decides each split link. Packets carry no arm.
2. **Preference (#6904's judge).** Blind X/Y, B vs A on 40 and A2 vs A on 8, two Opus judges and a
   third on disagreements, whole pages; scored by `librarian-speed-6904/score.mjs`.

## Decision rule
Counts are over the 40 questions; *wrong-page* = `other` + `none`; `missing` is out of every count.
- **G1 wrong-page.** Relative drop D = (A − B) / A in wrong-page links. Noise N = |A − A2| / A on the
  8 control questions. **Pass iff D ≥ 0.30 + N.**
- **G2 wrong fact.** B's `wrong_fact` rate per judged link ≤ A's + |A − A2| (the same rate on the 8).
- **G3 preference.** #6904's rule: B's net loss (B losses − B wins)/40 ≤ the A-vs-A2 floor (≥ 1/8),
  and questions where only B has a grounding failure ≤ those where only A has one.
- **G4 time.** B's p50 time to done ≤ 1.10 × A's.
- **G5 not by deleting links.** B keeps ≥ 80% as many `cited` links as A. (A prompt that links less
  lowers the wrong-page count without helping a reader find the page that says it.)
- **Ship B as the default iff G1–G5 all pass.** Otherwise B lands behind `LIBRARIAN_CITE_PAGES=1`, off.
- Reported, not gated: wrong-page rate per link, answers with a wrong-page link, J1/J2 κ, p90s.

## Envelope
Approved by Derek in chat 2026-10-18: about 80 turns, **hard cap 100 turns and $4** by the turns' own
usage numbers (`run.ts --max-turns=100 --max-usd=4`). No other Gemini. Judges: Opus, subscription only.
Planned: ≤ 2 smoke turns (B, excluded from analysis) + 40 A + 40 B + 8 A2 = 90.
