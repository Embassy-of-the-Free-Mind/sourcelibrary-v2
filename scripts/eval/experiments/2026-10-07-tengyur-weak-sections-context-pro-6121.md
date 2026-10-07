## 2026-10-07 · Tengyur weak sections (Pramāṇa, Madhyamaka, Vinaya, Jātaka): does context or a stronger model fix the reversals? (#6121)

**Question.** Can we reduce translation errors (specifically "reversal/agent" findings) in weak Tengyur sections (Pramāṇa, Madhyamaka, Vinaya, Jātaka) by providing broader context or utilizing a more capable model (Gemini 3 Pro)?

**Decision.** We need to quantify the cost-benefit ratio of improving these sections before a potential re-translation.

**Design.**
1. **Sample:** 60 mid-text pages, seeded uniform draw (30 Pramāṇa, 10 each from Madhyamaka, Vinaya, Jātaka).
2. **Arms:**
   - **S:** Stored English (control).
   - **A:** Production re-run (baseline).
   - **C:** Production model + 2 pages of Tibetan context + Tohoku title (read-only).
   - **P:** Gemini 3 Pro, one page, no context.
   - **PC:** Pro + context (only if P and C beat the A-vs-A floor).
3. **Judging:** Reuse `scripts/eval/tengyur-characterize/` rubric. Two blind subagents, by-eye spot check of findings.
4. **External Reference:** 2-hour time-box to find and align ≥ 20 pages of published translation (e.g., Dharmakīrti's Nyāyabindu, etc.).
5. **Rule:** Arm adopted if it beats S/A floor (p < 0.10) without increasing span errors.

**Spend:** ~60 * 3 paid arms, Flash/Pro realtime, <$5.

**Verdict.** To be determined by experiment results.
