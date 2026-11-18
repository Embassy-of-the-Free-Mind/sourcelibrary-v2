# Preregistration: Paddle self-agreement flag (#6871) — committed before the GPU task ran

- **Truth.** A page is *wrong* when P's Han CER against its own Kanripo WYG leaf is > 5% (#6388: no page judged
  "material" by Opus had CER ≤ 5%). Kanripo edition differences add noise to the truth; this is shared by every signal.
- **Primary signal.** dMax = max(dis(P, L), dis(P, S)), dis = symmetric Han CER. Fixed now; dL, dS and dR are reported, not chosen after.
- **Usable as a flag** if, on R+L, AUROC(dMax → wrong) ≥ 0.75 **and** Spearman(dMax, truth CER) ≥ 0.5.
- **As good as Flash-low** if, on F, AUROC(dMax) ≥ AUROC(dFlash) − 0.05.
- **Operating point reported:** flag at dis ≥ 0.05 (the #6561 Flash-low rule), with precision and recall.
- **Expected failure mode, stated now:** same model, same mistakes. If dR ≈ 0 and dMax misses most wrong pages, the
  answer is no, and a second engine (Flash-low, or another open GPU reader) stays the flag for pages with no Kanripo text.
- Lane dice (negDice) is reported for reference only: on R and L it was used to draw the pages, so it is not a fair competitor there.
