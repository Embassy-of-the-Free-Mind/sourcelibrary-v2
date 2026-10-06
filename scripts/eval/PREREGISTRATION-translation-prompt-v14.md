# Pre-registration: translation prompt v14 candidate vs live v13, plus a Tibetan multi-leaf stratum (#5305, #4523)

_Written 2026-10-02, **before the draw, before any paid call and before any arm output exists** (job v14-ab-2,
Hetzner). Harness: `scripts/eval/translation-prompt-v14-ab.mjs`. The decision rule below is fixed now so that it
cannot be picked after the numbers are seen. Any change after the paid submit goes under "Amendments" with its date
and reason; the rule is not rewritten._

PRIOR ART: `PREREGISTRATION-translation-restraint.md` (house format, A-vs-A arm, the audit rubric; its harness is
reused for the Batch submit/collect); the #5274 audit's judge rubric (`translation-corpus-audit/JUDGE-PROMPT.md`),
used verbatim with the addendum below; `.claude/docs/eval-design.md` §7–8; the #4523 QA comments of 2026-10-02
(10:41Z spot check and 11:11Z "second QA pass"), which are the answer key for the Tibetan stratum.

## The decision this informs

Whether the live translation prompt (v13, `prompts` type `translation`, `is_default`, hash `51651014…`) should be
replaced by the v14 candidate, and whether the Tibetan leaf lines and/or dropping the continuity seed on multi-leaf
Tibetan pages should ship. **Nothing is flipped by this study.** The flip is Derek's call.

Naming: a `prompts` row with `version: 14` already exists (2026-09-03, not default, hash `410de499…`). The
candidate here is **not** that row: it is built from the live v13 text by the exact edits below. Before any flip it
needs a new version number.

## Arms

| Arm | Text | Seed | Strata |
|---|---|---|---|
| **v13a** | live v13, byte for byte | production (stored translation of the page before the unit) | all |
| **v13b** | v13 again, an independent draw: the **A-vs-A noise floor** (sampler + judge) | production | all |
| **v14** | v13 + the edits below (+ Tibetan lines a–c on Tibetan books) | production | all |
| **v14ns** | as v14 | **none** | Tibetan only |

Prompt door, every arm: `translate-core` `buildTranslationPrompt` (single page) or `buildBlockTranslationPrompt`
(block), with the previous page's stored translation as continuity seed, the adjacent pages' OCR, and
`PAGE_BREAK_SCOPED` — the door `translate-batch-chained.mjs buildRoundRequest` uses, i.e. the chained Batch lane that
carries the Eternity volume and the live #4523 run. Generation (#4613, recorded in `batch.json`): `thinkingBudget: 0`,
`maxOutputTokens = maxOutputTokensFor(pages)`, default temperature, safety BLOCK_NONE. Batch API only.

Note on #5305 item 1's premise: `LEAF_BREAK_ONLY` (no rule line) is the door of the **seam** lane
(`translate-batch-seam.mjs blockPrompt`); the **chained** lane sends `PAGE_BREAK_SCOPED`, which adds
`PAGE_BREAK_RULE` when a catchword or split-word device fires. So on the chained lane the rule is present on device
pages and absent elsewhere; item 1 puts one page-end rule in the base text for every lane and every page.

## The v14 edits (verbatim in `translation-prompt-v14-ab.mjs` `V14_EDITS`; each anchor must match v13 exactly once)

1. **Item 1, page end (superset of `PAGE_BREAK_RULE`)**, a new section after the `<unclear>` section:
   > **This page only (CRITICAL):**
   > - Render only this page's words. If a sentence continues onto the next page, stop where this page stops, mid-sentence if need be. If a sentence began on the previous page, start with this page's first word.
   > - The previous page's translation is given for names and terms only: never repeat, complete or borrow its words, the next page's words, or what you know of the work.
   > - A catchword (the next page's first word printed again at the foot of this page) is a printer's device: do not translate it. A word split by a hyphen at the page break is translated once, on the page where it begins.
   
   **1b (#5363/#5376, the seam family the 11:23Z fold-in asked to test together):** the bracket-replacement line
   `<meta>continues from previous page: ...</meta>` becomes the bare marker, "the marker alone. Write nothing after it
   inside the tag: every word of this page belongs in the translation itself."
2. *(Item 2, the illegible trigger, is NOT in this arm: it belongs to job illegible-gate, PR #5638, whose A/B found
   the prompt clause has no detectable effect and shipped a code gate behind an OFF flag.)*
3. **Item 3:** instruction 11 (was the second "9.") ends: "…for indexing, describing only what this page's text says.
   A page with no readable text (blank, or nothing but <unclear>) gets no summary and no keywords."
4. **Item 4:** the `<image-desc>` example output becomes `<note>A woodcut of a pelican feeding her young.</note>`,
   followed by "Translate the description only: add no interpretation, symbolism or fact that it does not state."
5. **Item 5 (#5152, #5624):** instruction 7 adds "In a note, identify a person, place, work, date or Sanskrit
   equivalent only when the identification is the standard one and you are certain of it; never offer alternatives
   ("X or Y") or guess a relationship ("probably X's father"). If unsure, translate the name and leave it
   unidentified." (#5624's proposed wording, merged with the issue's.)
6. **Item 6 (#5154):** under "Translate ALL languages": "Text already in English (the English half of a bilingual
   edition, an editor's commentary) → keep it verbatim and in full, in its place. Never summarise it or move it into
   a note."
7. **Item 7:** the instruction numbering is repaired (two 8s and two 9s → 1–11); the bracket ban adds "no
   [Section labels]"; under "Translate ALL languages": "Rhyme tables, phonetic charts and sound-exemplar characters →
   keep the characters as characters (a romanised reading may follow); never translate them by meaning."
8. **#5137 (fold-in):** in the `<unclear>` section: "Where the source looks misread, translate what is written and
   flag it with <unclear>; do not silently correct it into a plausible reading."

**Tibetan lines (a–c)**, brief wording kept unchanged, added after the page-only section **on Tibetan books only**
(in production they would ride with `LEAF_BREAK_RULE`, which is code-side):
> **Tibetan leaves:**
> - Leaves are not in reading order across pages: a leaf may continue a leaf on another page, before or after this one. Translate each leaf as a fragment that begins at its first syllable and ends at its last. Never complete, repeat or borrow a clause from another leaf or page.
> - If a leaf begins or ends with an incomplete word, mark it with an ellipsis and transliterate the fragment in Wylie (…rdo / rje can…); do not guess its meaning.
> - Never supply a proper name that is not spelled in the source. Give an uncertain name in Wylie inside <unclear>.

Folded-in items recorded as **not prompt-fixable / not in this arm** (11:23Z comment): #5055 truncation (generation
caps; the empty/short-leaf rate is still reported per arm); #5606 (a model question); #4613 (provenance: generation
settings recorded per arm in `batch.json`); #4741 per-book glossary (**deferred**: no curated per-book glossary
exists for the #4523 books, so there is no optional arm); #2393 (descriptions leaking as untagged body text) is
covered by the existing tag vocabulary plus edit 4 and is not separately scored.

## Strata and models

#5305 strata, **Flash-Lite** (`gemini-3.1-flash-lite`, Batch), one page per book, drawn by the harness (`--draw`,
seed 5305):
- **flagged**: the #5274 audit pages (2026-09-30, one per book) that the Opus judge flagged for invention or garble
  passthrough, non-English, non-Tibetan, non-Sanskrit (cap 60). Single-page door; the source is the audit's pinned OCR.
- **sanskrit**: the audit's Sanskrit pages (12), whatever their verdict. The English share of each source is recorded
  (bilingual editions are the target of edit 6).
- **pagebreak**: pages the **chained** lane wrote (the 2026-10-01 chained audit), non-English, whose source ends
  mid-sentence (`sourceEndsOpen`), one per book, not in another stratum (cap 25). Sent as the lane sends a block:
  pages N and N+1 in one request, seeded with the stored translation of N−1. Page N is judged; the N→N+1 boundary
  is scored mechanically.
- **control**: audit pages with no invention/garble flag whose source does not end open, seeded draw (25).

**Tibetan stratum**, **gemini-3-flash-preview** (the model the live #4523 run uses), the 21 page groups listed in
the brief (32 pages in 16 groups read by eye on 2026-10-02, plus 5 dropped-leaf pages). A group of consecutive
pages is sent as one block, a single page as a single page; seed = the stored (production v13) translation of the
page before the group. Reported separately: `tibetan` (16 groups) and `tibetan-dropped` (5 pages).

Planned requests ≈ (60+12+25+25) × 3 + 21 × 4 ≈ 450. Budget **≤ $10** (the estimate is printed by `--draw` and
quoted in Amendment 1 before submit).

## Judging

**#5305 strata: blind judge.** Claude Opus subagents, one per packet of ≈15 items, `JUDGE-PROMPT.md` verbatim plus
this addendum. Packets carry opaque ids, arms shuffled across packets, no arm/model/prompt named. 16 (page, arm) items
are repeated under new ids in other packets (judge noise). Each page is rated on its own, so equal ratings (a TIE)
happen naturally.

> **ADDENDUM for this study.** Each item also carries `prev_source_tail` and `next_source_head`: the end of the
> previous page's SOURCE and the start of the next page's SOURCE. They are context so that you can recognise text
> imported from a neighbour; they are not part of this page and are not to be translated. Judge the translation of
> `source` only.
> - Words rendered from the previous or next page (completing a sentence this page leaves open, repeating the
>   previous page's end) are **invention**, kind `page-boundary`. A translation that stops mid-sentence where the
>   source stops is correct.
> - A `<summary>`, `<keywords>` or `<meta>` that asserts content the page does not show is **invention**, kind
>   `summary-meta` (a summary of what the page does say is fine).
> - Every `invention` or `garble_passthrough` defect carries `"kind"`: `page-boundary`, `unreadable-fill` (fluent
>   text where the source is illegible, garbled or `<unclear>`), `wrong-added-fact` (a note or gloss asserting a
>   wrong or unsupported identification, date or fact), `gloss` (an interpretive expansion in the body that the
>   source does not say), `summary-meta`, or `other`.
> - Every `omission` defect carries `"kind"`: `apparatus` (critical apparatus, footnotes, variant readings, sigla
>   dropped), `english-condensed` (text already in English in the source summarised, shortened or moved into a
>   note), or `other`.

**Tibetan stratum: read by me (the job), blind.** `--packets` writes one reading file per group with the source leaf
by leaf and the four arms' leaves beside it under shuffled letters W–Z (key in `tibetan-key.json`, not opened until
the reading is written down). Each group is scored against the #4523 answer key and re-read leaf by leaf, per arm:
1. seam duplication (a clause rendered on two leaves/pages; T5)
2. borrowed/displaced clause (a clause rendered one leaf early or late, once)
3. split-word mistranslation (T6; e.g. 69e786b3 p9→10 རྡོ་ | རྗེ་ཅན)
4. word dropped at a seam (e.g. 69e77ac8 p8→9 "dog")
5. invented proper noun (e.g. "Ananda-koshaya", "Vajrapani", "Upasanda")
6. empty or short leaf (< 35% of the source leaf's length; also counted mechanically)
7. **guard**: the meaning errors listed on #4523 (gSang ba sbas ston p7 equality→mirror-like wisdom; rGyud 'bum Pha
   p49 ལུས་མི་གདའ་བར; 'Dul ba Ga p68 speaker; mDo sde Ha p102 names; rNying rgyud Ya p16 reversed relation;
   rDzogs chen p8 names) plus any new meaning error found in the read. v14 must not make them worse.
Also mechanical, per arm: leaf-count agreement, empty/short leaves, shared runs ≥ 60 chars between any two leaves of
the unit or the seed's last leaf, and invented "continuing from the previous leaf" lead-ins.

My Tibetan is a reader's, not a specialist's: where I cannot decide a site from the answer key and the source, it is
scored "unclear" and reported as such.

## Outcomes

- **P (primary)**: judged invention-flag rate, the four #5305 strata pooled, **v14 vs v13a**, paired by page (exact
  McNemar on discordant pages).
- **N (noise floor, read FIRST)**: the same comparison, v13b vs v13a.
- **By kind (secondary)**: invention counts by kind per arm; P recomputed without `summary-meta` (the audit rubric's
  original scale).
- **Guards**: G1 omission rate, v14 vs v13a, pooled; G2 share at fidelity ≥ 4, pooled; G3 control stratum
  invention and omission; G4 apparatus omissions (#5155): v14 must not exceed v13a by more than the noise floor.
- **Sanskrit (S)**: `english-condensed` omissions and the mean translated length, v14 vs v13a.
- **Mechanical (M)**, no judge: unmarked open ends (`openEnd`), N→N+1 drift/duplication on the pagebreak stratum
  (`blockDriftBoundaries`), duplication with the seed (`duplicatedAcrossBoundary`), payload inside the continuity
  `<meta>`, square brackets in the body, and missing pages (a block that parsed short).
- **Tibetan (T)**: per-arm totals for classes 1–6 (seam defects = 1+2+3+4), class 7 as a guard.

## Decision rule (fixed now)

**v14 (the #5305 package) is recommended** if all hold:
1. **P**: v14's pooled invention rate is below v13a's by more than |v13b − v13a| **and** McNemar p < 0.10.
2. **G1**: v14's omission rate is not above v13a's by more than max(5 pp, |v13b − v13a| on omission).
3. **G2**: v14's share at fidelity ≥ 4 is not below v13a's by more than max(5 pp, |v13b − v13a|).
4. **G3**: on control pages, v14's invention and omission rates are each within max(8 pp, noise) of v13a's.
5. **G4**: v14's apparatus omissions do not exceed v13a's by more than max(2 pages, the v13b−v13a difference).

If 1 fails and 2–5 hold: **no measurable effect on judged invention**. Edits whose own mechanical secondary moves
(M or S, p < 0.05 paired, guards holding) are listed as separately supportable. If 1 holds and a guard fails:
**effect with a cost**, both numbers reported, left to Derek.

**Tibetan lines (v14 vs v13a, seeded)** are recommended if v14's seam-defect total (classes 1–4) is below v13a's
by more than |v13b − v13a| on the same total, and the class-7 guard count is not higher than v13a's + |v13b − v13a|,
and classes 5–6 do not rise by more than the same noise.

**No seed (v14ns vs v14)** is recommended for multi-leaf Tibetan pages if v14ns's seam-defect total is below v14's
by more than the noise floor, with the same guard. If both v14 and v14ns beat v13a, the smaller change wins ties.

Before any number is quoted, the five worst v14 #5305 pages by fidelity are read against their source.

## What this cannot say

- It measures a judge's flags, not accuracy. The repeats and the A-vs-A arm bound the noise; they do not validate it.
- ~120 pages can show a large effect, not a small one; the Tibetan stratum (21 units, ~37 pages) is a case series
  with an answer key, not a rate.
- v14 is a package: a null or a win cannot be assigned to one edit, except through the mechanical secondaries.
- The Tibetan units are page groups of 1–3 sent as blocks; production blocks are up to 8 pages, so a seam inside a
  longer production block may behave differently.

## Amendments

1. **2026-10-02, after the draw, before submit (no arm output exists).** The draw pinned 128 units:
   flagged **45** (the whole eligible pool; the cap of 60 was never reached), sanskrit 12, pagebreak 25 (19 Latin),
   control 25, tibetan 16 groups, tibetan-dropped 5. 405 requests (321 Flash-Lite, 84 Flash). **Estimate $1.05**
   (Batch, 50%). Two facts the rule has to live with, recorded now:
   - **7 of the 16 Tibetan groups and 1 dropped-leaf page have no seed** (the page before the group has no stored
     translation), so for them v14 and v14ns send the same prompt. The v14ns-vs-v14 comparison is read on the **9
     seeded groups** only; the all-group totals are reported beside it.
   - Only **3 of the 12 Sanskrit pages carry a substantial English share** (≥ 13 English function words); the
     other 9 are Sanskrit/Devanagari only. The S outcome is read on those 3 by eye, not as a rate.
2. **2026-10-02, after scoring (corrections of fact, the rule is unchanged).**
   - Amendment 1 miscounted the seedless Tibetan units: **6 of the 16 groups** (pp. 38, 49, 68, 25, Ya 16–17,
     Ja 9–10) and 1 of the 5 dropped-leaf pages have no seed, so the v14ns-vs-v14 contrast rests on **10 seeded groups
     + 4 seeded dropped-leaf pages**.
   - Packet 01's judge received the rubric + addendum inline; packets 02–24 read the identical text from
     `JUDGE-PROMPT-v14ab.md` (written to save prompt tokens). Same words, same order.
   - During the Tibetan read a terminal `cut -c` truncated Tibetan by bytes, so some source leaf ends looked
     shorter than they are. Three provisional "borrowed" calls made from those views were retracted after the exact
     leaf ends were printed; they are listed in `tibetan-reading.json` and none is counted. Every counted site was
     checked against the untruncated leaf.
   - The mechanical "empty leaf" for v14ns on the dropped-leaf pages is a lost `<leaf-break/>` (two leaves merged on
     69e7aac3 p.68), reported as such.

## Result (2026-10-02)

**#5305 strata — rule output: NO MEASURABLE EFFECT on judged invention, with a G3 breach.** Noise first: v13b vs
v13a invention 42.1 vs 47.7 % (|Δ| 5.6 pp, 16 vs 22 discordant). P: v14 38.3 % vs v13a 47.7 %, 13 vs 23 discordant,
**p 0.13** (needed < 0.10). G1, G2, G4 hold; **G3 fails**: control invention 24 → 36 % (+12 pp), six pages, all
minor. Separately supportable by its own secondary: the bare continuity marker (edit 1b) — meta payload 32 → 0 pages
(p < 1e-9) — and with it page-boundary invention 20 → 8 pages (16 vs 4 discordant, p 0.012; noise 10 vs 7).

**Tibetan — rule output: neither the Tibetan lines nor the no-seed arm is supported.** Seam defects (classes 1–4)
v13a 3 / v13b 7 / v14 3 / v14ns 3; the A-vs-A difference (4) exceeds every arm difference. Guard (class 7) 2 / 2 / 1 /
2: not worse. On the dropped-leaf pages both v13 draws reproduce the production dropped leaf on rNying rgyud Nga p.41
(seed already holds the leaf); v14 and v14ns do not.

Write-up: `results/translation-prompt-v14-ab-2026-10-02/README.md`; experiment
`experiments/2026-10-02-translation-prompt-v14-ab-5305.md`.
