---
stage: translation
measure: judged
languages: [la, grc, de, fr, it, nl, es, he, arc, ar, fa, sa, pi, zh]
scripts: [Latn, Grek, Hebr, Arab, Deva, Hani]
canons: []
n_books: 200
n_pages: 200
verdict: "notes-step/v1 FAILS the pre-registered gate on both engines: anchor resolution 80.7% (3.8 Flash) and 70.9% (flash-lite) against 98%, mostly because a term repeats on the page. On truthfulness it is within the margin on both: false or unsupported claims per 100 notes, step minus inline v21, Flash +0.8 [-3.0, +4.2] (margin 6.2), lite +6.0 [+2.8, +9.2] (margin 14.5). It writes 1.6x as many notes, so lite readers would see about twice as many wrong notes per page."
status: rejected
supersedes: [2026-10-15-plain-vs-notes-translation-6728.md]
decision: "Do not switch new pages to PLAIN + notes step yet (#7965 step 4). Fix the anchor rule and lite's context notes in notes-step/v2, then re-measure on the same pages."
superseded_by: null
issue: [7965, 7499, 5942, 5647]
router_evidence: "none — a notes-writer test; each engine's notes step is compared only with the same engine's inline notes, not one route against another"
defect_rates: "none — not judged as misleads/wrong_text per 1,000 words; false-claim, restate and misattached rates per 100 notes are in results/notes-step-7965/scores.json"
---
<!-- PRIOR ART: 2026-10-24-notes-as-anchored-layer-5942.md (arm S: text and notes from ONE call as JSON, Opus only) and 2026-10-27-prompt-bench-7499.md (the PLAIN reads and panel reused here). This is the first test of a SEPARATE notes call over a fixed PLAIN translation, on the two Gemini lanes. -->

## 2026-11-03 · Can a separate notes step replace the notes v21 writes inline? (#7965, step 3)

**Question.** #7499 found that a translation-only prompt (PLAIN) is more faithful on every engine and halves omissions.
It can only ship if new pages still get notes. Are notes from a second call over the PLAIN text as truthful as the notes
v21 writes inline today, and do they attach to the PLAIN text's words?

**Design.** The rule was pre-registered in `scripts/eval/PREREGISTRATION-notes-step-7965.md` (commit c8bdeb35b,
before any judge call). The harness is `scripts/eval/notes-step-7965/`.
- **(a) v21 inline.** This is the #7499 request with v21's block stacked (`buildV21`). Its notes are taken out with
  annotation-layer/3, as the backfill does.
- **(a2)** is v21 sent again on the 50 floor pages. This is the A-vs-A floor.
- **(b) notes-step/v1** (`lib.mjs NOTES_STEP_V1`) is v21's note, term, gloss and "original:" instructions, examples,
  life-words block and note style, moved into a prompt of their own.
  - Its input is the transcription, the clean text of #7499's kept PLAIN read, and the notes of the stored previous
    page.
  - Its output is JSON `{type, anchor, body}`, stored with `source: "notes-step/v1"`.
- **Engines.** 3.8 Flash low ran through `agy -p` on the #6545 132 pages. flash-lite (`gemini-3.1-flash-lite`) ran
  through Batch on all 365 pages and was judged on 200 of them (the 132 plus 68 drawn with seed 7965).
- **Judge.** Blind Opus through `claude -p`, one call per page, with the page image attached.
  - Each call shows every arm's notes under shuffled letters. Each note gets a #5647 claim class (with "unsupported"
    added), plus restates, attached and kind.
  - Control: 20 planted notes per engine. 18/20 were caught on Flash and 18/20 on lite (gate ≥ 16). 38 of the 40 plants
    were another book's note; only 2 were a shifted number, because few lists had a number to shift.

### Results

| per 100 notes (image notes excluded) | Flash (a) v21 | Flash (b) step | lite (a) v21 | lite (b) step |
|---|---|---|---|---|
| **false or unsupported claims** | 8.2 (43/525) | 9.0 (81/903) | 13.0 (96/740) | 19.0 (208/1094) |
| step − v21 [95%] | | **+0.8 [−3.0, +4.2]** | | **+6.0 [+2.8, +9.2]** |
| A-vs-A (a2 − a, floor 50) → margin | +1.0 [−4.0, +6.2] → 6.2 | | +7.1 [−0.8, +14.5] → 14.5 | |
| wrong notes per page (reader exposure) | 0.33 | 0.61 | 0.48 | 1.04 |
| notes that only restate the text | 2.1 | 0.2 | 2.4 | 3.7 |
| attached to the wrong words (judge) | 1.7 | 0.0 | 3.4 | 0.4 |
| repeats a note of the previous page (k = 1) | 6.8 | 0.2 | 11.9 | 2.6 |

| on every page each arm ran on | Flash (a) | Flash (b) | lite (a) | lite (b) |
|---|---|---|---|---|
| pages | 132 | 132 | 365 | 365 |
| notes per page | 4.1 | 6.8 | 3.4 | 5.4 |
| pages with zero notes | 25 | 0 | 74 | 4 |
| **anchor resolves once in the PLAIN text** (gate ≥ 98%) | — | **80.7%** | — | **70.9%** |
| anchor found at all (repeated phrases included) | — | 98.9% | — | 96.2% |
| replies that did not parse | 0 | 0 | 0 | 4 |
| output tokens per page | 914 | 1,168 (PLAIN 706 + step 461) | 717 | 831 (604 + 227) |
| $ per page, Batch | — | agy, $0 | $0.00097 | $0.00125 (PLAIN $0.00077 + step $0.00048) |

**Rule as registered:** both engines **fail** on anchor resolution. On truthfulness both are within the margin.
- On Flash the step is level with v21.
- On lite the margin is wide only because lite's own v21 rerun moved by 7 per 100. The step's excess (+6.0) has an
  interval that excludes 0. Since it also writes 1.6× the notes, a lite reader would meet about twice as many wrong notes
  per page.

**What the numbers are made of** (by eye and from the judge's reasons):
- **Anchors.** Of the anchors that miss, 497 of 572 (lite) and 164 of 174 (Flash) occur more than once.
  - Most are a one-word term ("Ousia" ×6, "screw" ×5, "Hiranyagarbha" ×5) or a phrase the page itself repeats.
  - The rest quote the source's Latin, or a nearby phrase, instead of the English.
  - Placing a repeated term at its first occurrence would raise resolution to 98.9% (Flash) and 96.2% (lite). That is
    not enough on lite.
- **Kinds of error.** The step's wrong notes are mostly *context*: a speculation stated as fact ("Gregory alludes to
  1 Peter 3:7"), or a scholarly misattribution (Yao for Shun appointing Kui). v21's are mostly *original* quotes that do
  not match the page.
  - On lite the step is worse in five of eight language groups, most in Hebrew-Aramaic (11.5 → 21.4) and Persian
    (13.6 → 24.8). It is better in Arabic, Chinese and Greek (small n per group).
- **OCR passed through.** Two "wrong original" verdicts I checked against the image were faithful quotes of a bad
  transcription:
  - Xiphilinus p.214: the OCR has τῷ πλήθει προσποιούμενος where the leaf prints θωπεύων τὸ πλῆθος.
  - Gaster Hebrew MS Add 11 p.67: the OCR is Pirkei Avot plus Psalms 24–25, while the leaf is prose on sacrifices.
    That page is invented: it was **contained in #8003** (book held, p.67 English withheld).

  Any notes writer that quotes the transcription inherits these errors.
- **Limits.**
  - The previous-page notes the step saw are the stored page's inline notes, a proxy for the step's own.
  - The panel has one page per book, so the repeat rate is k = 1 only. Pages N−2 … N−k cannot be measured here.
  - Summary and keywords were not asked for. Three pipeline consumers read them: the continuity seed, the book and
    concept index, and the image captioner (#7499 row 4).
  - The Flash judge ran on two Claude logins (63 calls on main's, the rest and all of lite on gex45's after its weekly
    reset). Both used the same Opus model and prompt.

### Decision

Not yet: **do not go to step 4.** notes-step/v2 should fix the following, then re-run on the same pages (judge cached
for (a), same rule):
1. **Anchors.**
   - Ask for the shortest phrase that occurs once, or an occurrence number when a term repeats.
   - Anchor a definition at the term's first occurrence.
   - Re-ask once when an anchor is not in the text.
2. **Lite's context notes.** Either run the notes step on 3.8 Flash for every lane (Flash's notes are level with
   inline), or add "state only what the page or a standard reference supports; no conjecture as fact" and re-judge
   lite.
3. **Volume.** The step writes 1.6× the notes. A wrong note costs a reader more than a missing one, so ask for notes
   only where a reader needs one.
4. **Summary and keywords.** The step must also write them, or step 4 must move their three consumers to another
   source.

**Kept for v2.** The step never leaves a page without notes (0 and 4 empty pages, against 25 and 74). It barely
repeats the previous page (0.2 and 2.6 per 100, against 6.8 and 11.9). It almost never misattaches a note.

**Artifacts:** `scripts/eval/results/notes-step-7965/scores.json` holds numbers only. Reads, items, keys and verdicts
are in scratch: main `/mnt/HC_Volume_105839809/jobs/notes-step-7965/w` and gex45 `/root/jobs/notes-step-7965/w`.
Spend was $0.579 Batch (lite: v21 $0.354, v21 again $0.049, step $0.177); agy and Opus ran on the subscriptions.
