---
stage: translation
measure: accuracy
languages: [la, lzh, fr, grc, nl, de]
scripts: []
canons: []
n_books: 11
n_pages: 11
verdict: "A keyed choice between equally faithful phrasings marks a translation strongly but only while it is verbatim, and one paraphrase removes it. Over 11 pages (one per book), the keyed choice changed 76 of 129 sentences. Pooled z went from 2.28 unmarked to 7.54 marked, and to 4.24 counting each distinct word once. After slice 9's paraphrase prompt, the marked pages pooled to z 0.65, against 0.20 for the same pages paraphrased unmarked. The green fraction was 0.507 against 0.502, so nothing survived. Detection after paraphrase: 2/11 pages at z >= 2, the same as 2/11 unmarked paraphrased twins. False positives on 118 unmarked texts: 8 at z >= 2, none at z >= 3. Of 2,000 random ten-text unmarked pools, 1 reached z 4.20 by token count and none passed z 2.51 by distinct words. The token count overstates evidence because repeated words are not independent draws. Fidelity was not judged: the pre-registered decision had already failed on detection."
status: rejected
decision: "Slice 6 of #8150, pre-registered in #8150 comment 6642775598. It FAILS criterion 1: pooled z after paraphrase was 0.65 where at least 4 was needed. Under the pre-registration we stop pursuing text-side marks against paraphrase, and nothing ships. On verbatim or ZWC-stripped copies the wording mark adds nothing over slice 9's passage matcher, which needs no mark and found 17/19 stripped pages with 0/21 false positives. Paraphrased copies stay traceable only by semantic match plus terms of use, which is slice 9's ceiling. The 31-call Opus quality packet (live vs marked, two wrong-page controls per arm, five repeats) passed paired-arm check and was not run, because criterion 3 cannot rescue a fail. Its design (recipe, key) is committed. The packet itself holds marked text, so it stays out of git: `run.mjs packet` rebuilds it after a rerun if a lighter threat model (light edits, not paraphrase) reopens the question."
feeds: [none]
superseded_by: null
issue: [8150]
router_evidence: "none — a provenance-mark test, not a routing cell"
---
## 2026-11-04 · Can a keyed choice of wording mark a translation so a paraphrased copy is still recognisably ours? (#8150 slice 6)

PRIOR ART: `scripts/eval/recovery-matrix-8150/text.mts` (slice 9: the draw window, the paraphrase prompt word for word,
and the Gutenberg not-ours paragraphs are reused so the two results compare); `scripts/eval/route-judge-6740/judge.mjs`
and `paired-arm.mjs` (the quality packet is in their format and passed `check`). New: `scripts/eval/textmark-8150/run.mjs`.

**Why this was the one to test.** Slice 9 found that paraphrase and translation defeat every layer we have. A mark
carried by the wording itself was the only proposed candidate for that gap.

**Mechanism (the scheme is public, the key is private).** For each prose sentence of a served translation, agy
(gemini-3.8-flash-low, on the subscription; no paid API) wrote three alternative renderings that keep the same claims,
names, numbers, negations and qualifiers. A rendering more than 40% shorter or longer than the original was not
eligible. The keyed choice took the eligible rendering with the most "green" content words. A word is green when
HMAC-SHA256(key, its lowercase form) has a first byte below 128. Content words are four letters or longer and not on a
function-word list. Detection counts green content words in any text and takes z against one half. It needs no
position, no alignment and no reference. Nothing was written to production. The marked text stayed in job scratch
and is not committed.

**Pre-registered (before any marking ran).** Pass needed all three: (1) pooled z ≥ 4 over about 10 paraphrased marked
pages; (2) at most 1 in 2,000 unmarked ten-text pools at z ≥ 4, and the unmarked twins pooled below z 3; (3) blind Opus
judges not reading the marked translation as worse against the page image.

### Result

| | pooled z (tokens) | pooled z (distinct words) | green fraction |
|---|---|---|---|
| unmarked, served | 2.28 | 0.23 | 0.530 |
| marked | **7.54** | 4.24 | 0.597 |
| unmarked, paraphrased | 0.20 | −1.51 | 0.502 |
| marked, paraphrased | **0.65** | −1.26 | 0.507 |

Per page (z by tokens; sentences changed by the keyed choice):

| source | changed | unmarked | marked | unmarked → paraphrase | marked → paraphrase |
|---|---|---|---|---|---|
| Chinese | 7/9 | −2.24 | −0.28 | −2.18 | −1.88 |
| Latin | 9/12 | 0.43 | 2.95 | −0.27 | −0.76 |
| Latin | 5/12 | 1.45 | 1.96 | 2.99 | 2.10 |
| French (Maya study) | 7/13 | 0.67 | 1.97 | −0.87 | −0.59 |
| Greek | 7/7 | 0.64 | 1.70 | 1.24 | −0.23 |
| Latin | 3/10 | 0.70 | 1.38 | 2.09 | 4.53 |
| Latin | 2/6 | 1.67 | 2.22 | 0.65 | 0.98 |
| French | 5/12 | 1.66 | 2.70 | −1.00 | −0.68 |
| Dutch | 14/16 | −0.07 | 2.65 | −1.13 | 0.32 |
| German | 8/16 | 0.82 | 2.55 | −0.64 | −0.83 |
| Latin | 9/16 | 1.87 | 4.59 | 1.10 | 0.14 |

The twelfth drawn page (Latin) was dropped: agy's alternatives did not parse.

False positives on 118 unmarked texts (40 other books' translations, 56 Gutenberg paragraphs, and the 11 unmarked and
11 paraphrased-unmarked twins): 8 at z ≥ 2, none at z ≥ 3, max 2.99, mean −0.08. Over 2,000 random ten-text pools,
13 reached z ≥ 3 and 1 reached z ≥ 4 (max 4.20) by token count. By distinct words, none passed 2.51.

### What it means

- **Criterion 1 fails, and not narrowly.** The paraphrase rewrites almost every content word, so the chosen words do
  not survive. The paraphrased marked pages are indistinguishable from the paraphrased unmarked ones. One page reads
  z 4.53 after paraphrase and 1.38 before it: paraphrase noise, not signal.
- **Criterion 2 sits on its limit by tokens and passes by distinct words.** The token z overstates evidence on any
  text. Its unmarked served pool reads 2.28 because frequent words repeat. A future text mark should count each word
  once per text.
- **Verbatim copies do not need it.** The mark reaches z 7.5 over 11 untouched pages. But slice 9's passage matcher
  already traces verbatim and ZWC-stripped copies without changing a word of the translation, so the wording mark buys
  nothing there and costs a model-rewritten sentence in 59% of cases.
- **Fidelity was not measured.** The packet (`scripts/eval/route-judge-6740/results/textmark-8150/`: recipe, key) passed
  R1–R5. The packet holds marked text, so it is not committed; `run.mjs packet` rebuilds it after a rerun.

### Reproduce

```
D=$JOB_SCRATCH/s6
node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/textmark-8150/run.mjs draw --out=$D --n=12
node scripts/eval/textmark-8150/run.mjs mark --out=$D
node scripts/eval/textmark-8150/run.mjs paraphrase --out=$D
node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/textmark-8150/run.mjs fpset --out=$D --m=40
node scripts/eval/textmark-8150/run.mjs detect --out=$D
```

The key is a local file (`TEXTMARK_KEY_FILE`) and is not in the repo. A rerun with another key draws a different
green list, and its z values will differ, but not their sizes.
