# Prompt for a fresh session — #4523 non-Latin OCR fidelity

*Paste the block below into a new Claude Code session in `~/sourcelibrary`. It
needs a fresh WebSearch budget; the investigating session exhausted its 200.*

---

Research issue #4523 in this repo: `gh issue view 4523 --comments`. The long
root-cause comment there has the full evidence. Then read
`scripts/audit/ocr-script-fidelity.mjs` on branch
`worktree-ft-round5-estimate` (PR #4524).

**Note the correction on that issue**: the comment claiming a one-line prompt
fix recovers 12,187 pages was written BEFORE the fidelity check below, and is
wrong. Read the whole thread.

**What we established, empirically, and what it cost us to learn:**

Our OCR was found transcribing Tibetan Buddhist manuscript folios as Devanagari
Hindu scripture — a page whose image is plainly Tibetan dbu-med came back as
"॥ श्रीरामचन्द्राय नमः ॥", and the published English says "Salutations to Shri
Ramachandra". The images are correct; the transcription layer invented a
different text in a different language, script and religion.

We first believed it was a prompt-wiring bug. The pipeline fills the OCR
prompt's `{language_instruction}` with "Detect the primary language from the
text (e.g. Latin)" even though `books.language` already says Tibetan for all
2,016 books. Telling the model the language instead flipped script
identification from **0/16 to 15/15**.

**Then we measured whether the output was actually a TRANSCRIPTION, and it is
not.** Cross-run agreement (3-gram Jaccard between independent runs on the same
image; two real reads of the same text agree closely, two confabulations do
not):

| page | agreement |
|---|---|
| printed Latin disputation (baseline for "reading") | **87–93%** |
| Tibetan manuscript, 1536px 3-up, told-Tibetan | 31–35% |
| Tibetan manuscript, 4352px master, told-Tibetan | 54–56% |
| Tibetan "Lamrim", 3000px, told-Tibetan | 26–35% |

So the language hint fixes *which script the invention is written in*, not
whether it is an invention. Higher resolution helps somewhat and is not
sufficient. **Tibetan OCR in our pipeline is unreliable across the corpus, not
just on the low-resolution Bhutanese EAP material.**

Resolution is largely exhausted as an avenue: the BL EAP master for the
confirmed case is only 1536×1024 for THREE folios; requests beyond that return
empty regions. 4,639 Tibetan pages are stored below their advertised master
(1200 vs 1536) and are cheaply recoverable via the tile-stitch path in
`scripts/workers/archive-eap.mjs`, but that is a 28% linear gain on an already
inadequate image.

Other non-Latin languages show an unexplained-substitution residue too (Syriac
19.5%, Persian 19.3%, Hebrew 13.2%), though there the substitute is `latin-only`
rather than a foreign script — a different and milder question. Korean's
apparently terrible 8.9% own-script rate is an ARTIFACT: classical Korean is
written in hanmun (Chinese characters). Do not repeat that mistake.

**What I need from you:**

1. **Literature and tooling review on manuscript OCR for these scripts** —
   Tibetan first, then Syriac, Persian, Hebrew, Armenian. Specifically:
   - What accuracy do purpose-built Tibetan OCR systems report (BDRC's work,
     Namsel, Transkribus, Google Books' Tibetan support, any 2024–2026 work)?
     What CER/WER, on what material — woodblock print vs dbu-can vs dbu-med
     cursive? Cursive dbu-med is the hard case and it is most of what we hold.
   - Is a general multimodal LLM the wrong instrument here? What do people who
     do this seriously actually use?
   - What minimum resolution / DPI do they require? Our worst material is
     ~40px line height.
   - Is there a specialist model or service we could route Tibetan to, and at
     what cost per page?
2. **A recommendation on the ~12,187 suspect pages and the 355 badged books**:
   re-OCR with a better instrument, or withdraw the text. Withdrawal is a real
   option and is probably right for material that cannot be read at the
   resolution that exists.
3. **A cross-check of my cross-run-agreement method.** It is a proxy. If
   there is a better standard measure of OCR reliability without ground truth,
   use it. Ideally find or build a small Tibetan ground-truth set (BDRC has
   etexts for some canonical works — if any of our books overlap, that is real
   ground truth, not a proxy).

**Do not** change any book, badge, or page text. This is research feeding a
decision that is Derek's. `scripts/audit/ocr-script-fidelity.mjs` writes
nothing; keep it that way.

**Also still open from the same session** (lower priority): #2880 round 5 left
~30 of its 60 pre-registered oracle books unrun because the WebSearch cap was
hit. The queue and method are in
`scripts/eval/results/ft-pilot-round-5.md` and `r5-oracle-brief.md` on the same
branch. PR #4524 carries the round.
