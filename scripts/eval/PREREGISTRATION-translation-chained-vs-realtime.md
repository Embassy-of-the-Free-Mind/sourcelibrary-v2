# Pre-registration — chained Batch API lane vs realtime translation, with the #5103 devices on both sides (speed test B, 2026-09-30)

_Written 2026-09-30, **before any paid run**. Issue: #4681. Handoff: ops
`handoffs/2026-09-30-speed-test-and-batch-vs-realtime.md` § Test B. The decision rule below is
fixed now so it cannot be chosen after seeing the numbers._

PRIOR ART: `PREREGISTRATION-translation-batch-continuity.md` (house format: paired arms, fixed
rule, amendments logged at the bottom — reused); `translation-batch-shadow-judge.mjs` (blinded
junction packet with the source, S1/S2 floor in the same packet — reused for the packet, extended
to read chained shadow runs); the fidelity judge prompt (PR #5104, ops
`handoffs/2026-09-25-fidelity-judge-prompt.md`) — reused verbatim; `lib/paired-stats.mjs`
(`binomTwoSided`). Not fitting as-is: `translation-page-break-fix-ab.mjs` draws its seams from a
fixed 2026-09-25 key and translates one block per seam; here every arm translates WHOLE books.

## The decision this changes

Whether the translation line's default moves from the realtime worker to the chained Batch API
lane (PR #5267, merged 2026-09-30). The chained lane is production's loop one block per round
(same `buildBlockTranslationPrompt` with `PAGE_BREAK_SCOPED`, same parse and health guards,
pinned byte-for-byte by `tests/unit/translate-batch-chained.test.ts`). Its pilot (2026-09-29)
measured cost and latency on 5 books but **never measured the text at page breaks against
production with the #5103 devices on both sides** — that is the open question. The flip itself
is a policy (hold tier): this run produces the evidence and a recommendation, not the flip.

## Arms (paired: same books, same OCR, same DB prompt, same model route)

- **R** — realtime `translate-worker.mjs` (page-break flip ON, #5170), dispatched by the
  orchestrator after the books are requeued to `ocr_complete`. Its text is SERVED (production).
- **C** — chained Batch lane, `--chained --enrol --shadow --tag=C`. Texts on the run document.
- **C2** — the same lane again, `--tag=C2`, enrolled at the same time. **The A/A noise floor**
  (designed arm, not post hoc — `lesson_run_the_noise_floor_arm_first`).

**Amendment to the handoff's design, stated before spending.** The handoff names the floor arm
R2 = "realtime again". No non-writing mode exists for the realtime worker (it writes through
`writePageTranslation` to `pages`, and a book's served text cannot be re-run without overwriting
it), and a hand-rolled realtime loop would put harness variance into the floor. The floor's job is
to show what "the same engine, the same prompt, twice" looks like to this judge on these texts;
C vs C2 is exactly that (same model, same generationConfig, batch pricing only). It is also the
cheaper floor. Read C−R against C2−C.

**Order.** C and C2 are enrolled first, on books at a terminal status (`needs_attention` /
`failed`: no lane dispatches on them, so the envelope funds only these arms —
`lesson_envelope_funds_every_scoped_worker`). Shadow runs seed every round from their OWN text
and ignore what another lane writes meanwhile, so R may be requeued as soon as the shadow enrols
have taken their queues; in practice R is requeued after C/C2 complete, so that R's operational
clock is not shared with a competing lane on the same key pool.

## Cohort (drawn 2026-09-30, `_tmp-draw-cohort-b.mjs` on Hetzner, read-only)

Pool: books at `needs_attention`/`failed`, not held, not Kloss, Latin-script non-English, 120–320
pages, OCR ≥ 90%, ≤ 2 translated pages, 120–300 translatable pages → 42 books. Device rate =
share of consecutive translatable page pairs where `resolvePageBreak` finds a split word or a
catchword. Picked 12 books / 2,202 translatable pages, weighted to device-heavy 16th-century
e-rara Latin and one book from each other stratum on offer:

| stratum | id | year | provider | translatable | device rate |
|---|---|---|---|---|---|
| latin16 (IA) | 6a06d4089a48d51399963bb2 | 1563 | internet_archive | 223 | 0.906 |
| latin16 | 69b643873adfa1a1bc00d695 | 1553 | e-rara | 155 | 0.588 |
| latin16 | 69b62fe31c1c21a3737fbb5b | 1578 | e-rara | 161 | 0.564 |
| latin16 | 69b62fa41c1c21a3737f8436 | 1588 | e-rara | 207 | 0.559 |
| latin16 | 69b6302e1c1c21a3737fe72c | 1585 | e-rara | 265 | 0.538 |
| latin16 | 69b630661c1c21a373801781 | 1583 | e-rara | 199 | 0.526 |
| latin16 | 69b630641c1c21a373801686 | 1596 | e-rara | 239 | 0.491 |
| latin16 | 69b62fc41c1c21a3737fa54a | 1579 | e-rara | 164 | 0.469 |
| 18c | 69b630911c1c21a373802bf9 | 1701 | e-rara | 136 | 0.239 |
| 17c | 69b6300b1c1c21a3737fd89e | 1647 | e-rara | 149 | 0.144 |
| incunable | 69b6318a1c1c21a373808558 | 1480 | e-rara | 183 | 0.045 |
| fraktur-german | 69e400d2e42a4d0e605eff5e | 1870 | internet_archive | 121 | 0.008 |

Left out: the 1768 MDZ catalogue (lists, not prose across breaks), the 1579 duplicate edition of
the 1583 Commentarii, *La Philosophie dans le boudoir* (safety refusals would dominate), and the
incunables with zero detected devices beyond the one taken (plain-break behaviour is covered by
the 17c/18c/incunable books). No Aldine Greek passed the pool filter (non-Latin script).

## Outcomes

**Primary — operational, per arm.** Wall-clock per book from enrol/dispatch to `complete`;
rounds, cancelled-and-recovered rounds, strikes, parked runs (C, C2); $/page by the meter
(Supabase `gemini_usage`, endpoints `eval/translate-batch-chained-shadow` and the realtime
worker's) and, when the BigQuery export lands (~1 day), by the bill; refusals by gate (`echo`,
collapse, runaway, leaf-seam, block-shift → single-page) per arm; pages left untranslated.

**Secondary — seams, pre-registered.** Units = page-break junctions where both arms hold text
for both pages. Per book: up to 6 device junctions (drawn by seeded PRNG from the device breaks)
and 2 plain mid-flow junctions (`assessSeam` on the OCR: ≥ 400 chars of prose both sides, no
terminator, no heading). Pairs: **C/R** (the test) and **C/C2** (the floor), the same junction
ids in both, interleaved and blinded in ONE packet, left/right from the seeded PRNG, key withheld.
Judges: 8 lean-worker Opus judges on the subscription ($0), the PR #5104 source-grounded fidelity
prompt verbatim (defect list before the vote; fidelity and fluency; TIE allowed). Expected
n ≈ 90 junctions per pair type (12 books × ≤ 8).

**Deterministic checks on every page** (both arms, no judge): `echoedSource`; body length ratio
vs source and vs the other arm (omission suspects at < 0.6); block-shift alignment (the opening
of each page's translation must match its own OCR's opening rather than the next page's, by
token overlap); duplicated run ≥ 200 chars across consecutive pages (forward duplicate).

**Whole-page similarity C vs R** on every shared page (`similarity` from
`translation-batch-continuity-ab.mjs`), reported as median with the C/C2 median beside it.

## Decision rule — fixed now

Let `share_R` = R's wins / (R's wins + C's wins) on decided C/R junctions (fidelity), and
`share_floor` = the larger side's wins / decided on C/C2.

1. **Seams inside the floor** ⇔ `share_R ≤ max(0.60, share_floor + 0.10)` AND C's device-junction
   defect count (OMISSION + DUPLICATION + UNTRANSLATED, judge-listed) is not more than R's + the
   C/C2 difference. Both, or it is not inside.
2. **Cheaper** ⇔ C's $/page by the meter ≤ ⅓ of R's; confirmed by the bill when it lands (the
   bill is the number; the meter under-reads 3–17× historically). If the bill breaks the ratio,
   the recommendation is re-issued.
3. **Latency acceptable** ⇔ median book wall-clock to `complete` for C ≤ 4 h at ≤ 12 books in
   flight, and no run parked for a reason the realtime lane would have recovered.

**Recommendation** = "flip" only when 1, 2 and 3 all hold → a DECISIONS-PENDING row, not an
action. Any other outcome → "keep", with the measured numbers. A tie on seams with 2 or 3 failing
is "keep"; seams outside the floor with 2 and 3 holding is "keep, and the seam defect is filed".

## Spend

2,202 pages × (C $0.00057 + C2 $0.00057 + R ≈ $0.0012) ≈ **$5.0**, plus a cancel/strike margin
→ ≈ $7, inside the $10 floor. Envelope `speedtest-B-2026-09-30` over the 12 book ids, $12 (an
envelope is a permission on a set of books, so one envelope covers all three arms; the arms are
told apart by meter endpoint). Logged in ops `costs/spend-ledger.md`. If the cohort grows past
3,000 pages, ask first.

## Do not

Re-propose the seam-repair lane; judge seams source-blind; count pages by job counters; read the
dial from a banner.
