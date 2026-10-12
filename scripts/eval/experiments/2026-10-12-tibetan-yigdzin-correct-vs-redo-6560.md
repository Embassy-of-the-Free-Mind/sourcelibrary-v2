---
stage: ocr
measure: [accuracy, judged]
languages: [bo]
scripts: [Tibt]
canons: [tibetan]
n_books: 30
n_pages: 30
verdict: "Correcting the Yigdzin read helps (Opus +0.015 [0.008, 0.022] syllable identity vs Derge, 0 of 30 folios worse; Pro +0.020 [0.011, 0.029], 5 worse); re-reading from the image is far worse (Opus 0.70, Pro 0.50 vs 0.945): both invent fluent text that is not on the leaf. Opus under-corrects (47% of planted errors survive); Pro writes the reference edition's spelling over the leaf (mi→myi on 2 folios)."
status: undecided
decision: null
superseded_by: null
issue: [6560, 6553]
---
## 2026-10-12 · Can Opus or Gemini 3.1 Pro correct the Yigdzin OCR of the BL Kangyurs, and is correct or redo better? (#6560)

PRIOR ART: `2026-10-04-tibetan-lite-vs-yigdzin-4523.md` (Yigdzin vs flash-lite on held pages; Yigdzin 0.962 vs Derge),
the 30-folio set and scorer of PR #5456 (`scripts/eval/tibetan-proofread/`), and the #6547 Greif replication (correction
and anchoring on German print: Opus 0/33, Pro 2/33 planted errors left). Code, prompts and raw outputs:
`scripts/eval/tibetan-correct-6560/`, `scripts/eval/results/tibetan-correct-6560/`.

**Design.** 30 Kangyur folios, one per book, from the #5456 manifest. Each folio is a two-leaf frame, 14 lines; the
served Yigdzin reads score 0.904–0.969 against Derge. There are five arms, all $0 and one page per call:
- the served Yigdzin read (baseline);
- Opus CORRECT and Pro CORRECT (image + draft; "correct only where the image differs; the draft may contain errors");
- Opus REDO and Pro REDO (image only).

Opus runs through `claude -p`. Gemini 3.1 Pro High runs through `agy -p` with the #6523 sentinels and tool gate. The
prompt wording is the same for both families, and asks for Uchen Unicode in the folio's line breaks.
- **Score:** syllable identity against a fixed Derge window per folio (`kanjur_align.py`'s tokeniser and NW; it
  reproduces the manifest's `derge_identity` on all 30). Intervals are 95% bootstrap over books. Recall is measured
  against the Derge text the served read covers.
- **Anchoring:** 3 syllables planted in the draft on 10 folios, never mentioned in any prompt.
- **Recitation:** every span where an arm moved from the draft toward Derge was read off the image by the OTHER
  family. The settler got both readings in random order, with no word of which is Derge, plus 2 known-answer controls
  per call.

**Result.** All 140 arm calls and all 59 read-off calls returned a read (did-not-read 0 everywhere).

| arm | identity vs Derge [95%] | Δ vs baseline [95%] | folios better / worse | recall | anchoring: planted errors left | moved toward Derge / not supported by image | s per page (median) |
|---|---|---|---|---|---|---|---|
| served Yigdzin | 0.945 [0.939, 0.951] | — | — | 0.930 | — | — | — |
| **Opus correct** | 0.960 [0.952, 0.967] | **+0.015 [+0.008, +0.022]** | 23 / 0 | 0.926 | **14 / 30 (47%)** | 197 / 25 (Pro settles) | 32 |
| **Pro correct** | 0.965 [0.957, 0.972] | **+0.020 [+0.011, +0.029]** | 25 / 5 | 0.936 | 3 / 30 (10%) | 431 / 26 (Opus settles) | 135 |
| Opus redo | 0.700 [0.635, 0.767] | −0.245 [−0.314, −0.175] | 3 / 27 | 0.626 | — | 375 / 73 | 61 |
| Pro redo | 0.496 [0.437, 0.559] | −0.449 [−0.510, −0.383] | 1 / 29 | 0.318 | — | 231 / 12 | 220 |

- **Pro correct minus Opus correct:** +0.005 [−0.004, +0.015], not separable on 30 folios.
- **Anchoring folios, scored separately:** Opus correct 0.952 (+0.004 [−0.002, +0.010]); Pro correct 0.966 (+0.018
  [+0.001, +0.037]).
- **Settlers.** Opus: 52/56 controls right, 0 wrong, 4 unclear; it read every folio twice by accident and gave the
  same answer on 487 of 560 items (87%). Pro: 47/56 right, 4 wrong, 5 other/unclear. The controls show that a
  settler sees a one-letter change. They cannot show that a settler does not itself recite.

**What the numbers are made of.**
- **Redo invents.** Both models get the layout right (14 lines) and the first syllables of each line. Then they
  continue with fluent Prajñāpāramitā-style text that is not on the leaf. 18 of 30 Opus folios and 27 of 30 Pro
  folios score below 0.80.
  - Example, seq 2 line 5, checked by eye: the leaf reads ཤཱ་ར་དྭ་ཏིའི་བུ་དཔེར་ན། ཤིང་ལྗོན་པ་ལ་ལ་ཞིག་སྡོང་པོ་མེད་པར་གྱུར་ལ, as Yigdzin and Derge have it.
  - Opus redo writes ཤཱ་རིའི་བུ་དེ་བཞིན་ནོ། །ཤེས་རབ་ཀྱི་ཕ་རོལ་ཏུ་ཕྱིན་པ་འདི་ནི་སྔོན་མེད་པར་འགྱུར་བ.
  - Pro redo writes དེའི་འདབ་མའང་མེད་མེ་ཏོག་དང་འབྲས་བུའང་མེད.
- **Opus correct is selective.** It returned 7 of 30 folios unchanged, and the planted errors survive on exactly
  those low-edit folios (all 3 on seq 6, 14 and 29). Where it edits, the edits are real repairs: dropped tshegs,
  non-words (སེངས→སེམས, རོབ→རབ), and one Yigdzin line-paste.
  - Seq 1 line 2, checked by eye: Yigdzin has བདེ་བ་ལུས་ཀྱི་མྱོང་ལ་འཕགས་པ, a phrase copied from the next line. The leaf and
    Opus have བདེ་བ་ཅན་བསམ་གཏན་གཉིས་པ.
  - Of its 25 unsupported spans, 11 are "draft" verdicts, mostly single particles (ཀྱི/ཀྱིས, a tsheg) where Pro, the
    settler with 4 wrong control answers, disagrees. The 14 "other" verdicts break down as follows:
    - about 6: Pro reports text from a different spot;
    - 4: the "seen" text actually contains the change (e.g. རྒྱལ་པོའི for ཚུལ→རྒྱལ);
    - 4: on seq 25, where Opus restored a passage Yigdzin dropped. Pro sees that passage, worded slightly differently
      (བྱ་བ་འམ where Opus has Derge's བྱེད་པ་འམ): mild recitation inside an insertion.

    **No systematic recitation.**
- **Pro correct edits every folio and catches 90% of planted errors.** 78 of its 431 toward-Derge spans are restored
  tshegs or Yigdzin's `:` for a tsheg. But **21 of its 26 unsupported spans are one pattern on two folios (seq 8,
  23):** the draft's མི/མེད changed to མྱི/མྱེད, the archaic spelling of the reference e-text. Opus sees མི/མེད on the
  leaf. By eye, seq 8's lower leaf reads ཕྱིར་མི་ལྡོག and ནང་དུ་མི་སྐྱེ. The manuscript mixes both spellings (the draft has
  དམྱལ་བར་མྱི་སྐྱེ on the same line), and Pro made the whole folio match the edition. **That is recitation of
  orthography.** It is small in syllables (about 0.1%), and it is exactly the failure that matters.
- **Identity against Derge rewards recitation.** A Bhutanese manuscript is not the Derge woodblock, so part of each
  arm's gain may be normalisation the image read-off did not catch. The read-off was done by models, not a reader.

**Decision (owed by Derek).** Run a CORRECTION pass on the Yigdzin-read Derge pages, never a redo. Opus correct is
the safer lane: it never made a folio worse, shows no systematic recitation, and runs at 32 s a page. But it improves
pages without certifying them, since it misses about half of the errors it is shown. Pro correct finds more but
writes the edition's spelling over the leaf. If Pro is used, Opus must settle its toward-Derge changes.
**Confidence:** high that redo is wrong for Tibetan with either model; moderate on Opus over Pro.

*Replicated?* No. One run, 30 folios, model settlers. Artifacts: `scripts/eval/results/tibetan-correct-6560/`.
