---
stage: translation
measure: judged_vs_reference
languages: [fa, sa, lzh, grc, he]
scripts: [Arab, Deva, Hani, Grek, Hebr]
canons: []
n_books: 50
n_pages: 50
verdict: "On the 40 pages where Opus scored lowest in v2#6545, Fable 5.2 beats a fresh Opus 5.5 run by +0.38 [+0.18, +0.58] under a blind Opus judge (15 pages better, 2 worse). Opus at xhigh effort recovers about half of that gap; Fable against Opus-xhigh is +0.17 [-0.05, +0.40], not settled. One judge, same family as every fresh arm; the cross-family judge is still owed."
status: undecided
decision: "No route change. The preregistered rule sends this to a Gemini 3.1 Pro judge on the same items once that pool resets (2026-11-15); a Fable translation route is decided after that (#72)"
feeds: route
supersedes: []
superseded_by: null
issue: [72]
router_evidence: "none — rules.json has no translation cell for Persian, Sanskrit, Chinese, Greek or Hebrew; these are the v2#6545 panels, one page per work"
defect_rates: "none — the round reuses the v2#6545 rubric (fidelity 1-5 with typed error spans); spans, omissions and reversals per arm are in scripts/eval/results/pro-translate-6545/r1f72/scores.json, not as defects per 1,000 words"
---
## 2026-11-12 · Does Fable 5.2 translate the hardest pages better than Opus? (#72)

PRIOR ART: `2026-10-12-pro-opus-correction-hardest-languages-6545.md` (the pages, references, prompt, judge prompt and harness; Fable 5.1 was a judge there, never a translator), `2026-10-23-whish147-stability-recall.md` (Fable 5.1 as an OCR reader: level with Opus, far slower). Scripts: `scripts/eval/pro-translate-6545/` (`select-pages.py` is new; `build-packet.py`, `claude-arm.py` and `score.py` gained options). Numbers: `scripts/eval/results/pro-translate-6545/r1f72/scores.json`. Design posted before any judging: #72.

### Question

**Decision it changes:** is a Fable translation route worth registering for the hard tail, where Opus is the best route we have? Fable had never been run as a translator here, and every earlier Fable number was 5.1.

### Design

- **Pages (50).** From the 131 v2#6545 pages both judges scored. Per language, the 8 pages where the stored Opus translation scored lowest (**hard**, 40 pages), plus 2 random pages where both judges gave it a 5 (**ceiling**, 10 pages). Opus had scored 5 from both judges on 78 of the 131, so the whole set would mostly measure a ceiling.
- **Arms.** All got the identical one-page prompt v2#6545 sent, through `claude -p --sealed` on the subscription, tools off.

  | id | what |
  |---|---|
  | **FABLE** | `claude-fable-5-2`, effort high (its default) |
  | **OPUS2** | Opus 5.5, effort medium (its default), run fresh. The comparison arm |
  | **OPUSX** | Opus 5.5, effort xhigh. Separates a better model from the same model trying harder |
  | **OPUS** | the stored v2#6545 Opus run of 12 Oct, re-judged here |
  | **C38S** | the stored 3.8 Flash run, re-judged here |

- **Why a fresh Opus arm.** The hard pages were picked because the *stored* Opus draw scored low. Any fresh run scores higher on such pages by regression alone, so Fable is compared with OPUS2 and never with OPUS.
- **Judge.** Opus, blind, the v2#6545 prompt and rubric unchanged, 3 items a call, one round. No Gemini judge yet: all three Gemini pools stood at 90–100% of their week on 2026-11-12.
- **Controls.** 15 planted meaning errors (3 per language), 20 repeated items for test–retest, `OPUS2 − OPUS` as the run-to-run noise of an Opus arm, and `OPUS2 − C38S` as a positive control (v2#6545 measured about +0.5).
- **Rules fixed in #72 before judging.** Valid round: at least 12 of 15 plants located and `OPUS2 − C38S` clear of zero. *Fable better:* `FABLE − OPUS2` on the hard 40 at least +0.3, interval clear of zero, and larger than `|OPUS2 − OPUS|` on the ceiling pages; then a Gemini Pro judge confirms. *No clear gain:* upper end below +0.4; stop.

### Result

**The round is valid.** The judge located 14 of 15 plants (negation 8 of 8, number 3 of 3, dropped clause 3 of 4). `OPUS2 − C38S` on the hard pages is +0.75 [+0.45, +1.03]. Test–retest alpha 0.79 [0.62, 0.91]: of 100 repeated scores, 81 were identical, 19 moved by one point, none by two.

**Fidelity, Opus judge** (95% interval by page):

| stratum | n | C38S | OPUS (stored) | OPUS2 | OPUSX | FABLE |
|---|---|---|---|---|---|---|
| hard | 40 | 3.53 [3.23, 3.78] | 4.13 [3.90, 4.35] | 4.28 [4.05, 4.50] | 4.48 [4.25, 4.68] | **4.65 [4.45, 4.83]** |
| ceiling | 10 | 4.3 | 4.8 | 4.5 | 4.6 | 4.8 |

**Paired differences on the hard 40:**

| pair | mean [95%] | pages better / worse |
|---|---|---|
| **FABLE − OPUS2** | **+0.38 [+0.18, +0.58]** | 15 / 2 |
| OPUSX − OPUS2 (effort alone) | +0.20 [−0.05, +0.45] | 12 / 5 |
| FABLE − OPUSX | +0.17 [−0.05, +0.40] | 12 / 6 |
| OPUS2 − OPUS (fresh against stored) | +0.15 [0.00, +0.33] | 9 / 3 |
| OPUS2 − C38S (positive control) | +0.75 [+0.45, +1.03] | 23 / 2 |

- **The "Fable better" rule is met under this judge.** +0.38 is above +0.3, its interval excludes zero, and it is above the 0.30 that `OPUS2 − OPUS` moved on the ceiling pages (−0.30 [−0.7, +0.1], 10 pages). The margin over that last bar is thin.
- **About half the gap is effort.** Opus at xhigh gains +0.20 over Opus at medium. Fable over Opus-xhigh is +0.17 with an interval that includes zero. Per page, Fable's score minus the better of the two Opus scores is +0.02 [−0.14, +0.18]: Fable lands where the better of two Opus draws lands, and does it in one draw.
- **The gain is fewer slips, not a different kind of translation.** Over all 50 pages, `FABLE − OPUS2` is +2 on 2 pages, +1 on 18, 0 on 26 and −1 on 4.

**What the judge found, all 50 pages:**

| arm | pages scored 5 | pages scored ≤ 3 | pages with an omission | major accuracy spans | minor accuracy spans | fills over unreadable source | reversals |
|---|---|---|---|---|---|---|---|
| C38S | 9 | 20 | 11 | 49 | 97 | 30 | 10 |
| OPUS (stored) | 20 | 6 | 8 | 7 | 52 | 3 | 2 |
| OPUS2 | 22 | 4 | 10 | 4 | 52 | 0 | 0 |
| OPUSX | 29 | 3 | 2 | 2 | 32 | 1 | 1 |
| FABLE | **36** | 2 | 2 | **0** | **25** | **6** | 0 |

- Fable has half the minor errors of Opus at default effort, no major one, and omits on 2 pages where Opus omits on 10. Opus at xhigh closes the omission gap completely (2 pages).
- **Fable fills in more.** The judge typed 6 passages of Fable's as plausible content written over garbled source, against 0 for OPUS2 and 1 for OPUSX. See "Fable overrules the transcription" below.

**By language** (`FABLE − OPUS2`, 10 pages each, so read as a direction only): Hebrew +0.7 [+0.3, +1.1], Sanskrit +0.5 [+0.2, +0.8], Greek +0.4 [0.0, +0.8], Chinese +0.2 [−0.3, +0.8], Persian 0.0 [−0.3, +0.3].

**Is it recall of famous texts?** Not visibly. On the 22 pages whose reference is flagged canonical the gap is +0.27 [0.00, +0.55]; on the other 28 it is +0.43 [+0.18, +0.68].

**Speed and cost per page:**

| arm | seconds (median) | output tokens (mean) | list price (the CLI's figure, mean) | calls per page |
|---|---|---|---|---|
| OPUS2 | 24 | 3,033 | $0.13 | 1.18 |
| OPUSX | 52 | 7,001 | $0.20 | 1.08 |
| FABLE | 42 | 5,177 | $0.16 | 1.00 |

- No arm declined a page and no call hit a limit. Fable needed no second call on any page.
- For text translation Fable cost about 1.3 times Opus at default effort and less than Opus at xhigh. The 8× of the Whish 147 test was for reading images.
- On the subscription the run moved team@ from 29% to 32% of the week and its Fable bar from 0% to 4%. That reading was taken after the translation calls and includes the laptop session that ran the test (also on Fable), so it is an upper bound, not a per-page rate.

### Fable overrules the transcription

Counted by a pattern over the `<note>` text (notes that say the transcription, OCR or printed text reads one thing and the sense or the received text another):

| arm | such notes | pages with one |
|---|---|---|
| C38S | 0 | 0 |
| OPUS2 | 38 | 17 |
| OPUSX | 31 | 19 |
| FABLE | 48 | 24 |

Both Claude models do this and both flag it. Fable does it on more pages, and it cuts both ways:

- **Where the OCR is wrong, it is the gain.** On a badly garbled page of *Sha'arei Orah* (Hebrew) Fable recovered Isaiah 48:11, Psalm 118:27 and the contrast of "luminaries" and "lights of fire" where OPUS2 left the passages as untranslated Hebrew: FABLE 4, OPUS2 2. On a heavily garbled Gregory Nazianzen page (Greek) Fable and OPUSX both restored the known text to the end of the page, where OPUS2 stopped a sentence short: 5, 5 and 4.
- **Where the edition simply differs, it is an error.** On a Rumi ghazal (Nicholson's edition) the page reads خوبی, "fair", and Nicholson's own translation has "foul and fair". Fable changed it to خونی and wrote "from filth and from blood", with a note saying so. It replaced what this page says with a reading it expected. The judge took a point off.
- The fidelity score here is against the transcription and a published translation, never against the page image. So this test cannot say how often Fable's corrections match the leaf. That needs an image-grounded check before a route.

### Read against the source

*Evidence type: the source text and both translations read by the session, not the page image. The session that ran this test is itself Fable 5.2, so these checks are not independent of the arm.*

1. **Liaozhai, tale 曾友于 (Chinese): FABLE 5, OPUS2 3.** The source has 仁義各以杖出 and 仁義奔告友于. Fable keeps both brothers each time. OPUS2 writes "Xiao, Ren and Yi each came out with a staff" (Xiao has just been struck) and "Ren ran to tell Youyu" (Yi dropped). OPUS2 also adds a note calling the buried woman "Cheng's mother, a concubine"; the judge says she is the half-brothers' mother, and Fable's "their mother's burial" does not commit to the error. Confirmed for the two name readings; the kinship point rests on the judge.
2. **Rumi, Divan-i Shams (Persian): FABLE 4, OPUS2 5.** The emendation above. Confirmed against the source line and the reference.
3. **Zhuangzi 德充符 (Chinese): FABLE 4, OPUS2 5.** Fable renders 不見己 as "they no longer saw themselves in her". The judge says this edition's margin gloss and Legge take it as the mother no longer seeing them. The session recalls Fable's reading from a modern translation but did not check that, so it is recorded as the judge scored it: a reading that goes against the page's own commentary.

The 18 one-point gains are mostly single slips in OPUS2 that Fable does not make: sigla dropped from a Greek New Testament apparatus, the glossed verse misnumbered in the Mitākṣarā, a Pāṇinian term glossed wrongly in Sāyaṇa, "above all" for "before all these" in Socrates Scholasticus. These are the judge's findings, read but not re-derived by the session.

### Threats and limits

- **One judge, and it is Claude-family.** v2#6545's family rule gives a Claude-made arm to the Gemini Pro judge. An Opus judge might lean toward Opus text or toward a sibling model's text; neither is measured. The verdict above is "under the Opus judge" until the Pro round is in.
- **Every page has a published English translation**, because the method needs a reference. A model that knows the work can restore a garbled line from memory, and this judge rewards that: on a garbled Gītā leaf it credited the 3.8 Flash arm for rendering the verses "from the standard text". The canonical split shows no concentration, but nothing here measures works with no translation, which is where the library most needs a better translator.
- **n.** 40 hard pages detect a gap of about 0.4. Fable against Opus-xhigh (+0.17, paired SD about 0.7) would need about 70 hard pages, and the v2#6545 panels hold only 53 pages below a perfect score, so settling it needs new pages.
- **Effort names are not comparable across models.** "Fable at high" and "Opus at xhigh" are two settings, not one scale.
- `OPUS2` ran sealed with effort stated; the stored `OPUS` ran on 12 Oct on another box with that box's defaults. `OPUS2 − OPUS` therefore mixes run-to-run noise, regression on the selected pages, and settings.
- 10 pages per language: the language column is a direction, not a result.
- AI judge against one published translation: fidelity as the judge reads source and reference, not measured accuracy (eval-design §2).

### Routing

- **No change.** The rule fixed in #72 sends a "Fable better" result to a cross-family judge before anything is registered.
- **Next, already designed:** Gemini 3.1 Pro judges the same items (`$W/judge/r1f72/pro/req.jsonl`) on the dereklomas@ pool after it resets on 2026-11-15, inside the 40-a-day Pro cap: the 40 hard items first.
- **If the Pro judge agrees,** the open question is not Fable against Opus-medium but Fable against Opus-xhigh, and whether Fable's corrections of the transcription match the page image. Both need pages of our own with no published translation.
- **What this already suggests for the Opus lane:** raising Opus to xhigh removed the omissions (10 pages to 2) for 1.6 times the list price. That is a prompt-free change to the existing route and deserves its own paired test.

*Measure:* judged against a human reference, one Opus judge. *Grade:* moderate-to-weak: one judge, 40 pages, controls passed, positive control seen. *Replicated?* No. First run of Fable as a translator.

*Cost:* $0. `claude -p` on the subscription (l7a, team@): 150 translation calls and 29 judge calls. No Gemini call, no API key, no database write.

*Files:* `scripts/eval/results/pro-translate-6545/r1f72/` (`key.json`: labels → arms, plants, strata; `scores.json`). The arm outputs are kept on l7a in `/root/jobs/fable-translate/w/arms/{FABLE,OPUS2,OPUSX}.jsonl`; the judge packet quotes published translations and stays on the box.
