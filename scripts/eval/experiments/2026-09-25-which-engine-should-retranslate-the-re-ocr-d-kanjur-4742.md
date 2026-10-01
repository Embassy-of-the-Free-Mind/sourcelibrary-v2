## 2026-09-25 — Which engine should retranslate the re-OCR'd Kanjur pages: Gemini flash, flash-lite, or the Dharmamitra specialist (MITRA-MT)? Blind A/B against 84000 (#4742, gates the #4523 $430 retranslation)

**Question.** Nobody has published a specialist-vs-Gemini Tibetan translation comparison, and nothing
on OCR-derived manuscript input. Before ~150K Yigdzin-read Kanjur pages are retranslated on
`gemini-3-flash-preview` batch (approved, ~$430), does buddhist-nlp/gemma-2-mitra-it (9B, the
paper's "Gemma 2 MITRA-MT") translate them more faithfully?

**Design.** 22 manuscript pages, one per book (Thadrak / Neyphug Kanjur, EAP), drawn from
`concordance-eap.jsonl` where a Derge locus with an 84000 English translation exists (identity
0.66–0.99; six of the 09-12 draw were replaced because their reference could not be located — Toh 8
volumes 22–25 are not in the cached TEI, Toh 557's TEI ends before folio 63, one page had no Yigdzin
text). Source = the Yigdzin read (#4722), the text the retranslation would consume. Reference = the
84000 English for the matched folio ± one side, sliced from the cached TEI by volume + folio
(`tibetan-mt-ab/extract-84000-refs.py`; CC BY-NC-ND, judge input only, not committed). Arms:
flash and lite on the production Tibetan prompt (v13) through `gemini-script-client`, thinking
off, BLOCK_NONE; MITRA-MT self-hosted with vLLM 0.29 on a Scaleway L4 (bf16, eager, its own
template `Please translate into English: … 🔽 Translation::`, page re-segmented at the shad into
≤500-char chunks). Two blind judges (Opus, Sonnet; `lean-worker` subagents, image + source +
reference + shuffled candidates, seed 4742), the June rubric: fidelity 1–5, omission, invention,
doctrinal inversion, ranking with ties. Pre-registered rules: (i) issue — MITRA wins fidelity on
≥ 15/20 pages → hold the $430; (ii) handoff — cheapest engine whose median fidelity is within 0.5
of the best AND invention ≤ best + 5pp. Peer finding folded in mid-run: Yigdzin drops one
manuscript line on some two-leaf pages; the judges were told a one-line omission is the source's
and ties all arms on that span.

**Controls first.**
- Same-arm pairs (one engine's output shown twice under two labels, 4 pages): Opus 4/4 ties,
  Sonnet 4/4 ties. Byte-identical texts, so this is the easy floor, not the seam-judging one.
- Positive control (the 84000 English as a 4th candidate) took THREE attempts, and both judges
  were right each time it failed. Attempt 1 (Toh 552 title leaf, identity 0.82): both judges
  scored the "reference" 1/5 with invention — the concordance had matched the leaf to the wrong
  text (a praise of Prajñāpāramitā, not the Eight Maidens), i.e. the reference was wrong, not the
  judge. Attempt 2 (Toh 9 F.392.b): my span search caught an earlier copy of a repeated refrain
  and imported a whole extra paragraph; Opus 2/5, Sonnet 3/5, both naming the imported paragraph.
  Attempt 3 (exact page span): **Opus 5/5, Sonnet 5/5, no invention, tied with flash and lite.**
  Net: the instrument detects a mismatched or over-wide reference, and passes a true one.
- One more page (Toh 543, identity 0.79) had a reference that did not cover the page; both judges
  said so and scored against the source. Two of 22 references were wrong; the 0.85 identity floor
  the draw was supposed to hold would have excluded both.

**Result (21 test pages, 2 judges; fidelity median / mean, rates pooled over judge-pages).**

| engine | fidelity median | mean | invention | omission | inversion | 1st place (Opus / Sonnet) | $/page realtime | $/page batch |
|---|---|---|---|---|---|---|---|---|
| gemini-3-flash-preview | 5 | 4.79 | 2.4% | 0% | 0% | 20 / 20 | $0.0024 | $0.0012 |
| gemini-3.1-flash-lite | 5 (Opus 4, Sonnet 5) | 4.43 | 4.8% | 4.8% | 2.4% | 14 / 16 | $0.0011 | $0.0005 |
| MITRA-MT (gemma-2-mitra-it) | 3 | 2.64 | **50%** | 33% | 7% | 0 / 1 | self-hosted | see below |

- **Issue rule: NOT met.** MITRA beat flash on fidelity on **0 of 21** pages for Opus and 0 of 21
  for Sonnet (one tie). Specialist "wins by ≥ 1.0"? The opposite: it trails by 2.
- **Handoff rule:** eligible = flash and lite (lite's pooled median 5 is within 0.5 of flash's 5;
  invention 4.8% ≤ 2.4% + 5pp). Cheapest eligible = **lite**. Read with care: Opus alone puts
  lite's median at 4 and gave it 2 of the 3 non-flash inversion/omission flags (Toh 8 F.393.b:
  lite 2/5 with an omission; Toh 94: lite's "does not approach" inverted). n = 21.
- **Judge agreement:** exact fidelity agreement 68%, within one point 97%, mean |Δ| 0.35; the
  judges shared a first-place engine on 21/21 pages.
- **What MITRA did wrong** (judges' reasons, checked by eye on four pages): invents lines with no
  counterpart ("one should not stand in the notion that form is empty"), misnames Subhūti as
  Subhadra, and on 4 of 22 pages fell into a repetition loop until the 1,024-token cap
  (Nirvikalpa-jñāna-prabhāsa-svabhāva-… for 1,000 tokens on a title leaf). Its clean pages read
  like 84000 prose, which is the training-data echo the issue warned about; the errors are on the
  manuscript readings.
- **Throughput / cost, MITRA:** 37.6 s per page sequential in eager mode (12 tok/s), 47 tok/s
  with four concurrent requests; at that rate 150K pages ≈ 400 L4-hours (order €300 at list price,
  before CUDA graphs or quantisation), for a translation two points worse.
- **Spend this run:** Gemini $0.0764 (44 calls, all `STOP`); Scaleway L4 powered on 22:28Z, API
  poweroff confirmed `stopped` 22:53Z (~25 min; the 80 GB volume is kept, Derek's call); judges on
  subscription (10 lean-worker dispatches, ~0.9M tokens).

**Verdict.** Do not hold the $430 for the specialist; MITRA-MT is out for manuscript-OCR Tibetan.
Between the two Gemini arms the pre-registered handoff rule picks lite at roughly half the price;
flash is the safer engine on Opus's reading (median 5 vs 4, no inversions). Which of the two runs
the retranslation is Derek's call, not this experiment's; nothing was flipped.

*Replicated?* No (single run, n = 21 pages, 2 judges). The reference set is now reusable
(`refs-final.json` in the run data dir, ops repo) for a larger draw.
*Artifacts:* `results/tibetan-mt-ab-2026-09-25.json` (controls, per-engine, per-judge, both rules,
per-page table with reasons); `results/tibetan-mt-ab-2026-09-25/` (arm outputs, blinding key,
judge verdicts, the three control attempts); scripts `scripts/eval/tibetan-mt-ab/`; judge
prompt `tibetan-mt-ab/JUDGE-PROMPT.md`; sample + references + packet (with the 84000 text) in
the ops repo `handoffs/data/2026-09-25-mtab/`.
