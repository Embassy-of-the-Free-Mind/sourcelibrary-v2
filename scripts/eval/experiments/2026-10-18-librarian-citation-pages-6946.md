---
stage: pipeline
measure: judged
languages: []
scripts: []
canons: []
n_books: null
n_pages: null
verdict: "Gate not met. Re-pointing quoted links by the quotation fixes 2 of 25 wrong-page links with no new error; a flash-lite router cuts wrong-page links 25 → 18 / 24 → 21 (two Opus judges) but moves 3 of its 10 links onto a page that supports the claim less."
status: adopted
decision: "Deterministic quote re-pointing and caption-number check ON in groundTurn (src/lib/embassy/librarian.ts); the flash-lite router ships OFF (LIBRARIAN_CITATION_ROUTER=1 turns it on) (#6946)"
superseded_by: null
issue: [6946]
---
PRIOR ART: `scripts/eval/librarian-speed-6904/` (the 88 recorded answers replayed here, and its whole-page judge packets); `src/lib/embassy/grounding.ts` (#5904: is a quote on SOME page read — not on the page linked). Code: `src/lib/embassy/citation-pages.ts`, `citation-router.ts`, `citation-routing.ts`; harness `scripts/eval/librarian-citations-6946/`.

## 2026-10-18 · Does each Librarian page link land on the page that says it? (#6946)

**Who it is for.** A reader who clicks "p.323" under a Librarian answer and expects the page that says the quoted thing.

**Design.** No new answer-model turns: the 40 B-arm answers of #6904 (the shipped arm), their raw streamed text and the grounding edits production sent, replayed through the new pass. The 40 A-arm answers were the dev set for tuning; every number below is on B unless marked.
- **Instrument.** One Opus judge (`claude -p`, subscription) per answer labels every page link: `cited` (the linked page says it), `other` (another page read says it), `none` (no page read says it), `wrong_fact` (the page is about it but the claim gets a date, name or attribution wrong), `missing` (page not loaded). Whole pages, translation and original, editorial wrappers stripped. Packets are blind to before/after. `JUDGE-PROMPT.md`, `build-packets.ts`, `score.mjs`.
- **Wrong-page** = `other` + `none`: the link lands on a page that does not say it. `wrong_fact` is counted apart: the page is the right one, the claim is wrong, and no link move can fix that (the pass never rewrites a claim).
- **Re-point check.** Every moved link gets its own Opus packet: the claim and both whole pages, order blind (`verify-moves.ts`, `VERIFY-PROMPT.md`). A move is a new error when the new page does not say it, or the old one did and the new one only partly does.
- **Noise floor.** Every answer judged twice (J1, J2). The before answers judged twice; and the 38 answers the deterministic pass left unchanged were judged again in a later session.

**Baseline** (B, 196 judgeable page links; 8 more link pages that were not loaded):

| | cited | other | none | wrong_fact | wrong-page | answers with one |
|---|---:|---:|---:|---:|---:|---:|
| J1 | 161 | 12 | 13 | 10 | 25 (12.8%) | 19 / 40 |
| J2 | 160 | 12 | 12 | 12 | 24 (12.2%) | 19 / 40 |

- J1 vs J2 on identical packets: label agreement 0.96, wrong-page κ 0.93. Re-judged in a later session, unchanged answers flip a net 2 wrong-page links (≈1 point): that is the floor.
- Of J1's 25: 4 are image captions linking the image's own page (`…/119.jpg` → p.119), judged on the page text; 4 are a short quotation that IS on the linked page inside a sentence whose rest is not. Neither kind can be fixed by moving a link.
- 32 of 204 links (16%) were attached by groundAnswer's own `attach_citation` (#5904), not written by the model; 4 of them are wrong-page (J1).

**What was built.**
1. **Quotations, deterministically.** A quotation not on its linked page moves to the one page that holds it: same book, nearest page (3+ words, or 5+ when several pages of the book hold it); another book only for 6+ words that one book alone holds. A quoted Title-Case phrase is a name, not a quotation, and moves nothing. Uncheckable (page not loaded, non-Latin) is left alone. Found only in pieces across books: reported, not removed (both hits on the replay were one text in two books).
2. **Paraphrases, by a router** (`gemini-3.1-flash-lite`): per claim, the page that states it plus the words there that do, or none. Applied only with evidence: a move needs the quoted words on the new page and not on the old one; a drop needs the linked page to share ≤ 70% of the claim's words, and only for an English claim (overlap means nothing across languages: a Dutch claim scored 0 against a page that says it). Tuned on A.
3. **Captions.** An emblem, figure or plate number the image's record never carries is dropped. None fired on B.
- All three fold into the existing `grounding_edits` (one edit per unit); no new SSE type.

**Results.**

| config (B) | wrong-page J1 | wrong-page J2 | moves | new errors (Opus re-point check) | links dropped (were `cited`) |
|---|---|---|---:|---:|---:|
| before | 25 | 24 | — | — | — |
| **quotations only (ships)** | **22** (−12%) | **24** (0%) | 2 | **0** | 0 |
| quotations + router (off) | 18 (−28%) | 21 (−12.5%) | 13 | 3 of 10 router moves | 10 (4) |

- **Gate (≥ 50% fewer wrong-page links, zero new errors, +800 ms p90): not met** by either config.
- The two quotation moves (1 Enoch p.39 → Dillmann p.46; Schneider p.3 → p.23) went `other` → `cited` under both judges. A third, Steganographia p.342 → Schwenter p.205 on the quoted name "Secret Alphabet of Honorius of Thebes", made a correct link wrong; the Title-Case rule now blocks it, and the "ships" row is measured with the rule.
- The router's good moves were real (vol-206 → vol-103 ×2 partly → yes; Babylonia p.357 → Shulgi p.12 no → yes; on A, the ilan → Vital p.47 and Denudata p.2229 exactly where the judges pointed). Its 3 bad moves (q18, q19, q36) left a page Opus rates `yes` for one it rates `partly`. Its 10 drops removed 6 wrong-page links and 4 correct ones.
- The router's ceiling is low: after it, J1 still finds 18 wrong-page links, 8 of them captions or partial-quote claims, and 5 where lite judged the linked page fine.

**Latency** (after the last text chunk; this box, production Atlas):
- Quotations only: the pass adds p50 10 ms, p90 107 ms, max 287 ms (n = 88). **Within budget.**
- Router, one call when the text ends: the call alone is 0.7–1.3 s (floor ~600 ms for a 4-token prompt). Waiting 700 ms → added p90 810 ms with 18 of 38 answers' verdicts in time; waiting 600 ms → p90 768 ms, 8 of 38 in time.
- Router, batches fired as paragraphs finish (the answer fed at 900 chars/s, the recorded p75 rate), 600 ms wait: added p50 121 ms, p90 568 ms, max 786 ms; 79 of 86 verdicts in time. This is what `citation-routing.ts` does, so the router could ship in budget. It ships off for its errors, not its speed.

**Cost.** `gemini-3.1-flash-lite`, metered from `gemini_usage`: **$0.29** over 466 calls (cap $1). Judges: Opus on the subscription, about 300 calls.

**Replicated?** No. n = 40 answers; the judges' wrong-page labels agree at κ 0.93, but a re-judged session moves ≈ 2 links. The quotation moves are few enough to read one by one (above).

**Artifacts.** `scripts/eval/librarian-citations-6946/`:
- `load-support.ts` (support pages and image records from Mongo), `replay.ts` (`--direct` quality ceiling, streaming latency, `--reapply` for guard changes with no model calls), `build-packets.ts`, `JUDGE-PROMPT.md`, `judge-driver.sh`, `score.mjs`, `verify-moves.ts`, `VERIFY-PROMPT.md`, `routes.ts` and `confusion.ts` (tuning);
- `results/`: judge labels (`judge/out`, `before`/`det`/`after` × J1/J2), the dev labels (`dev/`), the re-point checks (`moves/`), and the replays (`after-s2` with every router verdict and its evidence, `after-s2c` the router config, `after-det` the shipped one).

Re-run: `node scripts/eval/librarian-citations-6946/score.mjs scripts/eval/librarian-citations-6946/results/judge before:J1 before:J2 det:J1 det:J2 after:J1 after:J2`.
