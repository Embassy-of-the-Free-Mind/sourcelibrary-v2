---
stage: ocr
measure: judged
languages: [la]
scripts: [Latn]
canons: []
n_books: 11
n_pages: 11
verdict: "No: flash-preview beats lite on 11/11 items; lite loops on 5 of 7 manuscripts and a 1472 incunable and renders long s as f on roman print."
status: adopted
decision: "18 books held and re-run on gemini-3-flash-preview; global OCR_LITE_ONLY left alone (#4541)"
superseded_by: null
issue: 4541
---
## 2026-09-15 — Does `gemini-3.1-flash-lite` read early-modern manuscripts and incunables? (#4541) — RESULT

**Headline: no. Flash-preview is better on 11/11 items read. Lite fails catastrophically
on 5 of 7 microfilm manuscripts and on the 1472 Lauer incunable — runaway repetition and
invented words — and degrades QUIETLY on the rest: on 16th–17th-c. roman type it renders
long s as `f` ("quifque… nifi fit doctor vel affeffor" for "quisque… nisi sit doctor vel
assessor"), which is fluent, wrong, and would corrupt every quote, search hit and citation
over those books. This is a pre-spend pilot, not a scored benchmark — see the caveat.**

- **Question.** 18 books had just been acquired for the Forum of Conscience (#4541):
  7 BSB microfilm manuscripts (Gothic cursive, 12th–15th c.) and 11 printed books
  (1472 incunable → 1613 roman type). Production would have sent all of them to
  flash-lite, because `OCR_LITE_ONLY` (`scripts/lib/ocr-routing.mjs`) defaults ON and is
  not overridden on Hetzner — Derek's 2026-09-11 cost measure, "OCR should only be
  flash-lite batch, in the meantime", tied to the $5/day dial. It returns lite *before*
  consulting the carve-out for hard visual decoding, so the #1726 evidence that built that
  carve-out never applies while the flag is on. Question: is lite fit for THIS material?
- **Design.** One **interior** page per book (45 % of the way in, past the microfilm target
  card and front matter). One page per book because pages within a book are one
  observation. Identical image to both arms; production OCR prompt v16 (from the DB, not a
  copy); `temperature: 0`, `thinkingBudget: 0`; arms `gemini-3.1-flash-lite` vs
  `gemini-3-flash-preview`. Judgement is a human reading the Latin, not a metric.
- **Result — manuscripts (7).** Flash better on all 7. Lite: Clm 2756 produced 9,427
  characters of fluent nonsense; Clm 14268 drifted for 22,453; Clm 3773 emitted the word
  "nota" 120+ times (19,230 chars). Where lite looked *fine* it was still wrong — Clm 28673
  silently dropped one column of a two-column list, and Clm 4616 gave "Quae dilecta
  tabernacula tua" where the page reads "Quam dilecta tabernacula tua domine" (Ps. 83:2).
  Flash returned coherent canon law on the same images: the five causes of a cleric's
  transitus ("Necessitas. Utilitas. Humilitas. Cupiditas et Levitas") and 1 Tim. 3:2
  ("sobrius prudens ornatus hospes… non percussor non litigiosus non cupidus").
- **Result — prints (4).** Gothic type is fine on both (Koberger 1498: 7,094 vs 7,735
  chars, both coherent) — consistent with the #4541 B2 pilot, which used flash. But the
  1472 Lauer incunable broke lite completely (17,615 chars of noise vs 1,778), and **both**
  16th–17th-c. roman-type books (Plantin 1569, Cardon 1613) came back from lite with long s
  transcribed as `f` throughout, while flash normalised it correctly. Gothic print being
  safe does not generalise to roman print.
- **A cheap detector falls out of this.** Lite's failures are 2.4–9.9× longer than flash on
  the same page (22,453 and 19,230 vs a 3,778–5,612 flash range), while its successes sit
  at 0.8–1.0×. An output-length or arm-ratio guard separates the two populations with no
  human in the loop. Noted as a candidate; **not built** — and note it catches the runaway
  class only, not the long-s class, which is the more dangerous of the two precisely
  because the output length looks normal.
- **Cost.** At the measured output sizes, batch: flash-preview ≈ $0.00197/page vs lite
  ≈ $0.00098/page — about **$3.70 more across the 3,766 manuscript pages**. The quality
  difference here is close to free.
- **Caveat, stated plainly.** n = 1 page per book, 11 books, no reference transcription,
  and the verdict is a human read rather than a scored metric. It is decisive for THIS
  material class (early-modern manuscript and incunable, Latin) and is **not** a general
  claim about flash-lite, which the 2026-09-14 Chinese A/B above found perfectly
  competitive on a different corpus.
- **Action taken.** The 18 books were held (`scripts/lib/pipeline-hold.mjs`, reason
  `lite-ocr-unfit-4541`), 16 in-flight lite jobs cancelled before any page was written, and
  the set re-submitted with an explicit `model: gemini-3-flash-preview` override. The
  global `OCR_LITE_ONLY` policy was left alone — that is a corpus-wide cost decision, not
  this run's to make.
- *Replicated?* **No.** Single run, both arms one call each. The extreme failures (runaway
  repetition) are the kind that vary between calls; re-running would sharpen the rate but
  not the direction.
- **Artifact.** `scripts/eval/_tmp-forum-microfilm-pilot.mjs` (throwaway, uncommitted);
  raw arms in `scratchpad/pilot.json` and `scratchpad/pilot-prints.json`; the full read
  transcripts and the per-item table are in the #4541 issue comment of 2026-09-15.
