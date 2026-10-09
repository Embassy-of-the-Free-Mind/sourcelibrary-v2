# Runbook: judge the CLI arm C38 on the 365 xl pages (#6182)

PRIOR ART: `scripts/eval/experiments/2026-10-08-cli-arm-tengyur-113-6182.md` (the same job on the 113 Tengyur
sides; this runbook is its recipe with the xl packet), `build-xl-packet.py` (the 365-page packet, now with `--cli`),
`/root/cli38-6182/judge-driver.sh` (the bash judge driver). Nothing here is new instrument; it is the order of steps.

**Wait for:** `/root/cli38-6182/C38-full.jsonl` (rows `{uid, arm: "C38", model, text, date, secs}`), all 365 `xl`
uids of `/root/pareto-6182/units.jsonl` with non-empty text. The partial file of 2026-10-08 holds 202 of them.
Spend: $0. No Gemini API call of any kind (Derek, 2026-10-08); judges are Opus on the subscription.

1. **Check the arm.** Every row's `model` is `gemini-3.8-flash-low (agy -p)`; no row opens with CLI chatter
   ("I'll translate…", tool output). `build-xl-packet.py --cli` exits if any page is missing; never pass
   `--allow-holes` for the real packet.
2. **Prereg before any judge output exists.** Commit an experiment file with the gate, same shape as the Tengyur
   one: per stratum (Latin, Greek, T3 pool, T4 pool, T5 pool — `score-xl.py`'s `STRATA`), C38 − G38 mean fidelity
   by-book bootstrap 95% lower bound > −0.15 and C38 reversal pages ≤ G38's + 2 (scaled: + 2 per 70 pages is the
   Tengyur rate; write the number per stratum down before scoring). Judge gate: `score-xl.py`'s (plant caught =
   reversal listed or lower fidelity than its twin, ≥ 6 of 8; duplicates tie ≥ 3 of 4). Both judges read every
   item (3 candidates, so no J2 subset). Name the #6304 drops (`results/pareto-sample-audit-6304/drops.json`,
   21 translation pages) as the sensitivity cut: primary on all pages, again without them.
3. **Build:** `python3 scripts/eval/pareto-6182/build-xl-packet.py --cli` → `/root/cli38-6182/xljudge/in-J{1,2}-NN.jsonl`
   (24 parts; holds reference text: never commit) and `scripts/eval/results/cli-arm-6182/xljudge/key.json`.
   Items: C38, G38 and the page's production engine (L31 for Latin and T3, FP for the rest) shuffled; 8 PLANT,
   4 DUP. `cp /root/pareto-6182/xljudge/PROMPT.md /root/cli38-6182/xljudge/` (the #5695 judge prompt the 365 were
   judged with).
4. **Judge:** copy `/root/cli38-6182/judge-driver.sh`, change the two set globs to `xljudge/in-J1-*` and
   `xljudge/in-J2-*` and the log name; start it in tmux; wait with ONE foreground until-loop on `ALL DONE`.
5. **Score:** `score-xl.py` decodes this prompt's schema (`decode`, `norm`) and runs the gate; its `run()` is bound
   to the nine Gemini arms and the J2 subset. Add a `--round cli6182xl` to `score-ref.py` that loads
   `results/cli-arm-6182/xljudge/key.json` and the out files, reuses `score-xl.decode` and the gate block, maps each
   page's production arm (`key.items[i].prod`) to `PROD`, and reports per stratum C38, G38, PROD fidelity and
   reversal pages with by-book CIs on C38 − G38, C38 − PROD, G38 − PROD (`score-ref.py --round cli6182-113` is the
   template). Numbers only in `scores.json`.
6. **Chart:** a C38 point per language in the #6182 panel of `build-translation-pareto.mjs` would mix reads (the
   panel's other arms were judged in another packet). Give it its own panel per language ("Gemini 3.8 Flash
   through the CLI, beside the API run", C38, G38 and production), as the Tengyur one does; `--check` must pass.
7. **Report** on #6182 in the voice of `.claude/docs/quality-statements.md`; PR `tier:hold`.
