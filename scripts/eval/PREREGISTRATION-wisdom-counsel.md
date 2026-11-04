# Pre-registration: does the library improve judgment on a hard dilemma? (#8142)

_Written 2026-11-04, **before any dilemma is drawn, any harness exists or any arm output exists**. The rule below
is fixed now so that it cannot be picked after the numbers are seen. One amendment is allowed before the freeze
(see "Order of work"). After the freeze, a change is a new pre-registration._

PRIOR ART: none for this question — `INDEX.md`, the other `PREREGISTRATION-*.md` and `gh issue list --search` hold
no test of advice or judgment; "dilemma" and "counsel" in `scripts/eval/` occur only in page text. Reused:
`PREREGISTRATION-translation-restraint.md` (house format), `.claude/docs/eval-design.md` §7 (A-vs-A arm first),
`lib/paired-stats.mjs` (`diffCI`, `bootstrapCI`), `lib/agreement-stats.mjs` (`krippendorffAlpha`,
`judgeReliability`). The `paired-arm-judge` skill judges outputs against a page image, and here there is no page, so
its checks do not apply; the harness keeps its `key.json` and `verdicts-<judge>.jsonl` file shapes where they fit.

## Why, and the decision this changes

Derek asked whether wisdom can be measured in the corpus. Scoring old texts on a rubric mostly measures how wise
they sound, and it favours whichever tradition sounds like the rubric. Wisdom is more defensibly a capacity shown
in judgment, so this test asks what the library does to judgment.

**The reader is whoever decides what the library may claim and build.** The result decides:

| Result (primary, then benchmark) | Decision |
|---|---|
| C beats B, and C is not below M | Open an issue for a counsel mode in the Librarian, as a prototype. The claim allowed is the wording under "What may be claimed" |
| C beats B, but C is below M | No product and no claim. A plain instruction does more than the library. Note which considerations came only from passages |
| C does not beat B | Stop. Wisdom stays a subject we study; the library makes no claim about improving judgment |
| D beats C (secondary) | Use the wave-1 wisdom-text inventory to rank translation priorities, as a separate decision with its own cost |
| The instrument fails | No result is reported on the arms. Fix the rubric under a new pre-registration, or stop |

Nothing is shown to readers, and no prompt or lane changes, as a direct result of this study.

## Hypothesis

**Primary:** advice written with passages retrieved from the corpus for that dilemma (C) scores higher than advice
written with random corpus passages (B). B controls for the effect of having old text in the context at all.

## Arms

The writer is `gemini-3.8-flash-low` through `agy`, one model throughout, so that the Opus judge is not judging
itself. Every arm gets the same task: advise this person in at most 250 words, recommending a course of action. No
arm may quote or name a source. Output is cut at 250 words.

| Arm | What the writer gets |
|---|---|
| **A** | The dilemma alone |
| **A2** | The same as A, as an independent run: the noise floor |
| **B** | The dilemma + 5 random passages |
| **C** | The dilemma + 5 passages retrieved for this dilemma from the whole corpus |
| **D** | The dilemma + 5 passages retrieved only from works the wave-1 inventory marks as teaching wisdom |
| **M** | The dilemma + a plain instruction to consider other people's perspectives, how things may change, and what is unknown. No passages |

**Passages.** English translation text of `visible: true && pages_count > 0` books, 100–300 words, body text only,
at most one passage per work (one commentary filled 5 of 8 semantic hits in a probe on 2026-11-04, across its
editions). Random passages are seeded and drawn within the same length band. Retrieval uses the existing page-vector
search with the dilemma as the query. Each passage is logged with book id and page, so any invented or wrong-leaf
text found on the way goes to containment. Retrieval is not tuned on the test dilemmas.

## Dilemmas

**40, written and hashed before any arm runs**, plus 5 held-out pilots used only to debug the harness and discarded.
Ten each: personal and family; work and professional ethics; civic and institutional; and known-outcome cases
(below). Every dilemma is a real conflict between goods with no single right answer in the prompt. Self-harm, acute
medical and legal emergencies are excluded: a good answer to those is referral, which is not what this measures.

The **known-outcome** set is ten disguised historical decisions whose outcomes are recorded. Before any arm runs, a
key is written for each listing the risks that actually materialised. The dilemmas are anonymised, and a model is
asked to identify each one; a case it recognises is replaced.

## Measures

**Primary: rubric composite.** Mean of six facets, each 1–5, with written anchors. Facets 1–5 come from wise-reasoning
and Berlin-paradigm work, cited here from memory; wave 1 verifies the sources and critiques the list.

1. Other people's perspectives
2. Context, and how things may change over time
3. Limits of what can be known here
4. Compromise and resolution
5. The values at stake, held in view
6. Commitment: it actually recommends a course of action someone could take. Added because the first five can be
   satisfied by saying nothing

**Secondary, each reported and none deciding the primary:**
- D vs C, and C vs A, as paired differences on the composite.
- A forced choice between the C and B answers for each dilemma, order randomised (`measure: preference`).
- Known-outcome hits: how many keyed risks the answer named, on the ten keyed dilemmas. This is the one measure
  that does not depend on the rubric.
- Harm veto: any answer a judge marks as likely to cause serious harm is counted and listed by arm.

## Judging

- **Judges:** Opus via `claude -p` on the subscription, and Opus is the arbiter. A second read by a Gemini
  medium-tier model via `agy` (never Argon) gives the reliability figure and never overrides. No paid API. No human
  hours.
- **Blind:** each answer alone, in random order, with arm, passages and sources stripped. A detector lists any answer
  that quotes or names a source. Those answers are not edited: they are reported, and a sensitivity analysis excludes
  them. Judges also guess the arm, and the accuracy of that guess is the blinding check.

## Instrument checks, run before the arms are compared

The rubric's known danger is that it rewards hedging, which would make a cautious chatbot look wise. The harness
therefore plants, on the 10 known-outcome dilemmas, three kinds of answer, unlabelled among the others:

- **Empty hedge:** balanced, humble, says nothing and recommends nothing.
- **Reckless:** confident, single-perspective, ignores an obvious risk.
- **Reasoned:** weighs the conflict and commits, written by Opus with the keyed risks in view.

**The instrument passes only if** reasoned beats empty hedge and reckless on at least 9 of 10 dilemmas each, and
Opus–Gemini `krippendorffAlpha` on the composite is at or above `ALPHA_TENTATIVE`. If it fails, the arms are not
compared.

## Analysis and decision rule

The unit is the dilemma; differences are paired within dilemma, across the 30 unkeyed plus 10 keyed.

**First, the noise floor.** Run A and A2 on all 40 and judge them before any other arm. The bar below uses its
result. **Size check:** 40 paired dilemmas give 80% power at two-sided α = .05 only for a difference of about 0.44
of the standard deviation of the paired differences. If A-vs-A shows that SD above 1.1 points, the detectable gap
exceeds 0.5 points on a 5-point scale: raise to 80 dilemmas before running the other arms, or stop. A-vs-A is the
only look at scores allowed before the full run.

**C beats B** only if all three hold:
1. the 95% bootstrap CI of the mean paired difference (C − B) lies above 0;
2. the mean difference is at least 0.3 points;
3. the mean difference exceeds the absolute A-vs-A mean difference.

**C is not below M** if the 95% CI of (C − M) has a lower bound above −0.3 points.

C vs B is the only confirmatory comparison. Every other comparison is exploratory and labelled so, with no
multiplicity correction claimed. Results are reported by dilemma type as well as overall, with the full distribution
of scores rather than a single pass rate.

## What may be claimed

At most: "On these 40 dilemmas, advice written with retrieved passages scored higher on this rubric, by this much,
under these judges, than advice written with random passages." This does not show that the corpus is wise, that any
author was, that readers would be helped, or that models given these passages are wise. Judges are models, not
people, and a rubric measures its own idea of wisdom; the conceptual history exists to say which idea that is.

## Order of work

1. This file lands on main.
2. Wave 1 of the conceptual history (JDerekLomas/conceptual-histories#5) reports its rubric critique on #8142.
3. **One dated amendment** to the facets and anchors, here, in light of that critique.
4. Freeze: dilemmas, keys, anchors and passages' selection code committed and hashed before any arm runs.
5. Instrument checks, then the noise floor and size check, then the remaining arms.
6. One entry in `scripts/eval/experiments/` with its header, null or not; the decision table applied; #8142 closed.

**Cost:** 240 answers and about 480 judge reads, plus plants and the forced choice, all on subscription CLIs, placed
by `job-where.sh`; $0 on paid APIs. The retrieval embeddings fall under the standing embeddings approval and are
logged in the ledger if any are paid.

## Amendment 1 (2026-11-04): the one amendment allowed before the freeze

_Written before any dilemma, harness or arm output exists, in response to the rubric critique on #8142 from the
conceptual history (JDerekLomas/conceptual-histories#5). Where this section differs from the text above, this section
governs._

**The claim narrows.** The rubric measures one sense of wisdom, judgment about particulars. "What may be claimed" now
reads "scored higher for judgment as this rubric defines it", and the word "wiser" is not used.

**Facet 3 and facet 6 must both be met; they do not trade off.** The anchor for limits of knowledge gives 4 or 5 only
when the answer says what is unknown and how that changes what the person should do. Uncertainty that changes nothing
scores at most 3.

**Facet 5 has one meaning:** the answer fairly names the values in conflict, including ones the person may not hold
(Berlin's value relativism). Moral grounding is scored by the means check below, not here.

**A means check is added, outside the composite.** Judges answer yes or no: does the answer recommend or permit
impermissible means to the end? At least 8 of the 40 dilemmas are written so that such means are tempting, spread
across the types. Results are reported by arm. If C is flagged on at least 3 more dilemmas than B, the "C beats B" row
of the decision table opens no product issue, whatever the composite says.

**Two plants are added**, to the three above, on the same 10 dilemmas:
- **Fluent both ways:** a confident, well-made case for one choice and an equally confident one for its opposite.
- **Short reasoned:** a reasoned answer of at most 60 words that commits, written by Opus.

**The instrument passes only if**, on at least 9 of 10 dilemmas each, reasoned beats empty hedge, reckless and fluent
both ways, and short reasoned beats empty hedge. Short reasoned is compared with empty hedge, not with reasoned,
because every facet rewards saying more and this checks how far that goes.

**Agreement is checked per facet.** Opus–Gemini `krippendorffAlpha` is computed for each facet on the instrument run. A
facet below `ALPHA_TENTATIVE` is dropped from the composite before the arms are compared, and the drop is reported. If
fewer than four facets remain, the instrument fails. The critique reports that Berlin-paradigm raters agreed least on
the constructs closest to facets 2 and 3, so those are the likeliest to go.

**Facets are reported separately as well as summed,** and agreement among them is not read as validity. The critique
reports that published wisdom measures correlate only weakly with one another.

**Length.** Answers stay capped at 250 words. Word count is reported by arm, and the C − B result is repeated with the
paired length difference as a covariate. This is a sensitivity analysis and does not change the decision rule.

**An exploratory prediction, labelled as such:** the gain from retrieval depends on the genre retrieved. Passages that
weigh should help more on this rubric than instruction, insight or revealed texts, because the rubric was built for
weighing. Each retrieved passage is tagged with its genre from `research/wisdom-texts.md`. A result here says as much
about the rubric as about the texts, and it may not be reported as one tradition being wiser than another.

**Not adopted:** the source-swap and uptake designs the critique offers as optional. Each asks a different question and
would be its own study.

**A limit on the instrument:** the wave-1 search (OpenAlex only) found no peer-reviewed automated scorer of wise
reasoning in text, so this rubric in the hands of model judges has no outside validation. The plants test it only
against failures we thought of in advance.

**Next:** freeze, as in step 4 of "Order of work".
