## 2026-09-03 — Bench 2 first arms (superseded by the entry above)

- **Design.** As above, Kraken + Gemini only.
- **Result (interim — CHURRO/Surya GPU arms pending L4 stock).** Diplomatic tier:
  - **Latin:** Kraken ≈ Gemini. Agricola 1556 99.2/99.5, Copernicus 1543
    98.7/98.7, Linnaeus 1735 98.2/99.4. Both arms fail the same two hard pages
    (Malleus ~1490 incunable; Praetorius 1615) — Kraken loudly (guard-fail,
    59–73%), Gemini by alignment failure. Kraken cost ≈ €0 (Hetzner CPU,
    ~20–50s/page niced).
  - **Greek:** Kraken **matches or beats** Gemini on every aligned page —
    Marinus 99.9/99.9, Bekker 99.9/99.4, Orphica 99.2/99.2, Parthey apparatus
    94.3/91.9; 99.7–100.0 on Teubner canonical (Philo/Simplicius/Hero). Caveat:
    all diplomatic Greek pages are 19th-c editions; on the one 16th-c Greek
    print page (Dioscorides 1549 Ruel) Kraken guard-fails at 88.4%.
  - **German Fraktur:** Kraken **loses badly** (72.8–89.1%, all guard-fails) —
    CATMuS-Print is not a Fraktur model. Gemini 99.6%. Needs a Fraktur-specific
    arm (GT4HistOCR/austriannewspapers lineage) before any German decision.
  - Failure asymmetry confirmed on print, matching Bench 1: every Kraken failure
    is guard-visible (loud); Gemini's weak pages align plausibly.
- **Replicated?** Not yet — Kraken k=1 (determinism check pending), Gemini k=3
  best-of. No reroute decision until GPU arms + paired stats run.
- **Artifacts.** `results/scorecard-outputs-2026-09-03.jsonl` (both arms),
  `results/scorecard--latin-la--greek-el--german-de---2026-09-03.json`,
  Kraken raw + models on `hetzner:/root/bench2-kraken/`.
