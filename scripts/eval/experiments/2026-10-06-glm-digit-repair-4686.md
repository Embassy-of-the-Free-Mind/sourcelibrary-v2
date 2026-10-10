<!-- PRIOR ART: 2026-10-06-kraken-refused-english-4686.md (the same 20 pages, references, scorer and gate; it stopped on digits, 78.5 %); 2026-10-04 #5660 r3 (PR #5786: GLM-OCR the best open reader of English print) and #5830 (GLM drops page furniture). Nothing before this merged two engines' reads of one page. -->
## 2026-10-06 · Can GLM-OCR's numbers repair Kraken's read of the pages Gemini refuses? (#4686)

- **Question.** Kraken reads the 715 English pages Gemini refuses (RECITATION) at CER 0.009, but it reads 17th-century old-style figures as letters ("66 or 67" → "cé or éy", "10." → "io.", "5°" → "g°"), so only 78.5 % of printed digit strings survived and the preregistered gate stopped. Derek chose option (b) on #4686: keep Kraken's letters, take the numbers from GLM-OCR on a rented GPU, and re-gate on the same 20 pages before writing anything.
- **Answer.** **The repair works on the body text but misses the preregistered bar by one number, so the gate STOPS again and nothing was written.** Digit strings reproduced rose from **78.5 % to 89.2 % (73 → 83 of 93)**, and the bar is 90 % (84 of 93). In the body text, leaving out running heads and stacked split-years, they rose from **81 % to 95.6 % (55 → 65 of 68)**. CER did not get worse: the median went from 0.009 to 0.008, 4 pages better, 15 the same, 1 worse by 0.001. The ten misses left are ones GLM cannot help with, because GLM does not transcribe running heads: four stacked split-years ("166⁰₁"), three page numbers in running heads, one "8o." that both engines read as "80", and one figure that Kraken fused into the word before it ("aboutio.").
- **measure:** accuracy. CER is against the same blind by-eye references as the first run (adjudicated, 0.14 corrections per 1,000 characters), scored with `benchmark-score.mjs` unchanged. Digits are counted with `analyze.mjs` unchanged; Amendment 1 adds G5. The reference is a model's (Claude's) transcription, not a human key; see the first write-up.

### Design (Amendment 1 of `PREREGISTRATION-kraken-refused-4686.md`, pushed in 93c1f8a95 before any GLM output existed)

- **Rule** (`scripts/lib/glm-digit-repair.mjs`, pinned by `tests/unit/glm-digit-repair.test.ts`). The two reads are aligned token by token (longest common subsequence). Only the gaps between tokens both engines agree on are candidates. A Kraken token is replaced only by a GLM *number* token, and only when the Kraken token could be a misread number: it has a digit, or it is at most 4 characters long, and it is never a spelled number or a roman numeral. GLM's words never enter, and Kraken's lines, running heads and line breaks stay as they are. The rule was written after Kraken's 20 misses were known, but before GLM had read any page.
- **Engines,** both on one leased Scaleway L4 (pl-waw-2; fr-par had no L4 capacity), driven by `scripts/gpu/kraken-digits-4686-scw.sh` under `idle-poweroff.sh run --` with a 3-hour lease:
  - GLM-OCR (`zai-org/GLM-OCR` rev `2e85a628`), on vLLM 0.31.0 with MTP. The prompt was `Text Recognition:`, temperature 0, one attempt. The client was the #5816 one, unchanged. It took 2,430 s for 715 pages: 3.4 s/page with 12 clients, on a GPU it shared with Kraken.
  - Kraken 7.1 CATMuS-Print large on CUDA, the same model file (sha256 `1ed39e73…`). It was CPU-bound on the L4 box's 8 cores, at about 7 pages/min. **The GPU read equals the scored CPU read:** 15 of 20 pages are identical, and the other 5 differ by 1–2 characters. Both arms have median CER 0.009 and 73/93 digits.
- **Gate:** G1–G4 as before, plus G5, no CER regression against the plain Kraken read: the median may not rise, and no page may get more than 0.005 worse.

### Result (n = 20 pages, 6 books)

| arm | median CER [95 %] | digit strings | body digits (no running heads, no stacked years) | ſ read as f, per 100 | lines dropped |
|---|---|---:|---:|---:|---:|
| Kraken CATMuS (CPU, first run) | 0.009 [0.006, 0.018] | 78.5 % (73/93) | 80.9 % (55/68) | 1.7 | 0 % |
| Kraken CATMuS (GPU, this run) | 0.009 [0.006, 0.017] | 78.5 % (73/93) | 80.9 % (55/68) | 1.8 | 0 % |
| GLM-OCR alone | 0.006 [0.005, 0.011] | 66.7 % (62/93) | 91.2 % (62/68) | 1.5 | 0.1 % |
| **Kraken + GLM digits (gated)** | **0.008 [0.005, 0.017]** | **89.2 % (83/93)** | **95.6 % (65/68)** | 1.8 | 0 % |
| Kraken (CPU) + GLM digits | 0.008 [0.005, 0.018] | 89.2 % (83/93) | 95.6 % (65/68) | 1.7 | 0 % |

**Gate:** G1 pass, G2 pass (0 catastrophic), G3 pass, **G4 fail (0.892 < 0.90)**, G5 pass (median 0.009 → 0.008; worst page +0.001, Birch II p. 287). **→ STOP. No page was written.** `#5969` stays `blocked`.

**Read by eye (every change on the eval pages, every miss left):**
- **Fixed** (10 strings): "cé or éy" → "66 or 67", "éo" → "60", "rth," → "5th,", "g°." → "5°.", "r7,5," → "1755,", "28" → "25", "88-," → "882-,", "227;" → "22;", "Svo" → "8vo".
- **Not fixed** (10): running-head years "166⁰₁" and "166⁴₅" (×4, Kraken writes "1662"/"1664"; GLM reads no running heads); page numbers "( 931 )", "(895)" and "15" (GLM drops them, Kraken misses them); "8o." (both read "80"); "aboutio." (no token boundary to repair).
- **Changes that look wrong:** "22" → "21/2" for a printed "2½" (GLM writes the fraction as 21/2), and "4n" → "4ᵉᵉ" on Birch II p. 287 (GLM's superscript letters). Neither is a new error in a number the reference has, so neither moves the digit count.
- **A bug found after scoring:** Kraken writes some accents decomposed ("ce" + U+0301), and the rule left the accent behind, giving "66́". It is fixed in the lib, with a test. Re-scored after the fix, every gate number is the same (`gate-posthoc-accent-fix.json`). This is reported, not gated.

**All 715 pages** (the merge was built; nothing was written): 283 pages changed, 691 of 274,054 tokens (0.25 %). The median page changed 0 % of its tokens, the 95th percentile 1.2 %, the maximum 3.5 %. No page reached the 5 % by-eye threshold. The most common changes, punctuation aside, are figures read as letters: "s"→"5" (14), "ó"→"6" (12), "a"→"4" (10), "I"→"1" (9), "roth"→"10th" (8), "oth"→"9th" (7), "1o"→"10" (7). Some, like "12."→"13.", are cases where the two engines disagree on a digit, and the rule trusts GLM. That was not measured separately. Fourteen single-letter changes ("a", "I", "s") were read in context. Most are right: "till a the next morning" → "till 4", "a Hen, bringing forth s well-formed" → "5", "3 or a foot" → "3 or 4". At least one is a misalignment: "or a thousand Inhabitants" → "or 4 thousand", where GLM's "4" belongs to "the 4. of May" a line away. A single letter beside a gap is the rule's weak point, and any write would want that case tightened first.

### Implication

- On these pages, **the fix works where GLM can see the number**, which is the body text: 95.6 % of body digit strings. The bar is lost on page furniture. Neither engine reads 17th-century stacked split-years, and GLM does not transcribe running heads at all.
- By the rule set before the run, nothing is written. What happens next is Derek's call on #4686:
  - (a) write the repaired text, with the running-head numbers marked as unverified;
  - change the gate to body text only, before any new run;
  - leave the pages empty.
  The GLM and Kraken reads of all 715 pages are kept on Hetzner. Writing them later needs no GPU.
- **For the Quality Center** (#5918), this is the worked error → fix example (O7 sub-variant and O18 in `.claude/docs/page-error-taxonomy.md`): a measured error, a targeted fix, and the honest after-number, which here falls just short of the bar.

- **Replicated?** No. Each engine ran once and is deterministic; the GPU and CPU Kraken reads agree as above.
- **Artifacts:** `results/kraken-refused-4686/glm-digits/`:
  - `gate.json` (the gate);
  - `scored.json`;
  - `outputs/<arm>/` (the 20 pages);
  - `changes-715.jsonl.gz` (every change on every page);
  - `box.json`;
  - the driver logs.
  The full GLM and Kraken reads of the 715 pages are on Hetzner under `/root/kraken-digits-4686/{out,kr,merged}`. The driver scripts are `scripts/gpu/kraken-digits-4686-{scw,box}.sh` and `scripts/eval/kraken-refused-4686/glm-digits.mjs`.
- **Cost: $1.75** (one L4 for 1.90 h at $0.92/h, deleted and confirmed gone). The first box, in fr-par-2, was created but never started (no capacity) and was deleted. No Gemini was used. *run_id:* `kraken-digits-4686`.
