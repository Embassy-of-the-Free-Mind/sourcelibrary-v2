# Cross-family reliability of the page review (#6203)

PRIOR ART: `scripts/eval/second-reader/` (#6338: does a second reader find more; Opus vs Gemini 3.1 Pro agreed at chance, α −0.13) and `scripts/audit/convergent-audit-weekly.mjs` (#6420 lane D: two readers each week, agreement on "serious" only, no planted pages). This run asks the reliability question on its own, per KIND of error, with planted pages.

**The question.** #6420 calls a finding "convergent" when an Opus reader and a Gemini reader both make it, and waives a by-eye stop when two AI readers agree. That is a reliability claim. Do the two families agree, kind by kind, above chance, and does each catch a known error?

## Design (fixed before any reader ran)

- **Pages.** 33, one per book. 15 from sets earlier reviews read (the #5826 gate's sample, the #5914 fortnightly spot check), 15 random live non-English books whose page serves English, 3 planted controls. Seed 6203. `run.mjs draw`.
- **Controls.** Three more served pages, doctored: the next leaf's text under this leaf's image (expect `wrong_leaf`); one middle sentence cut from the English (`omission`); one negation reversed in the English (`mistranslation`). The last two use the #6338 planters unchanged.
- **Readers.** Opus (`claude -p`, sealed folder: Read and Write only, the packet and its images) and Gemini (the `agy` CLI, plan mode, one page per call, the best Pro or 3.8 model `agy models` offers). Both read the frozen #6338 brief (`REVIEWER.md` + `CALIBRATION-ADDENDUM.md`) plus `KIND-ADDENDUM.md`, which asks for one of the twelve kinds of `scripts/lib/review-vocabulary.mjs` on every error. Packets carry no model name and no URL; the key (`draw.json`) never enters a reader's folder.
- **Measures.** On the 30 natural pages both read: Cohen's kappa for "a serious error on this page", for "text not on the leaf" (the six inventing kinds), and for each kind either reader used; a bootstrap 95% interval (by page) on the first. On the 3 controls: detected, called serious, right kind named, per reader.
- **How it will be read.** Kappa for "any serious error" below 0.2 is agreement at chance: "convergent" is then not a validated reliability claim. 0.2 to 0.6 is weak to moderate and does not support waiving a by-eye stop. At n = 30 the interval is wide; a point estimate above 0.6 whose interval reaches below 0.2 is not a pass. A reader that misses a control has not shown it can find that kind (`.claude/docs/measurement-validity.md`, pattern 5). A kind neither reader used has no kappa: that is "not estimable", not agreement.

## Run

```
R=<run dir>
node --env-file=.env.production.local scripts/eval/cross-family-6203/run.mjs draw --run $R
EXTRA_BRIEFS="$PWD/scripts/eval/cross-family-6203/KIND-ADDENDUM.md" scripts/eval/second-reader/run-readers.sh $R opus claude opus read 4
node scripts/eval/second-reader/second-reader.mjs cli-requests --run $R --reader gemini --addendum scripts/eval/cross-family-6203/KIND-ADDENDUM.md
python3 scripts/eval/run-cli-arm.py --requests $R/readers/gemini/requests.jsonl --out $R/readers/gemini/cli-out.jsonl \
  --arm xfam6203-gemini --model <model> --job cross-family-6203 --kind review --parallel 2 --attempts 4 --no-tool-gate
node scripts/eval/second-reader/second-reader.mjs cli-assemble --run $R --reader gemini
node scripts/eval/cross-family-6203/run.mjs score --run $R --readers opus,gemini
```

The Gemini steps need the `agy` CLI, which is installed on the main box only. Run the Opus reader with no `ANTHROPIC_API_KEY` in the environment (#6589: `claude -p` prefers the key to the subscription login).

## Limits

- Thirty pages, one draw. Rare kinds (recitation, show-through) will mostly have no kappa.
- Half the pages come from sets a model already reviewed, so they are not a rate of anything: this run measures agreement, not prevalence.
- Both readers are models. Agreement between them is not accuracy; only the three controls have a known answer.
