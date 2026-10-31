---
stage: ocr
measure: [accuracy, judged]
languages: [de, la]
scripts: [Latn]
canons: []
n_books: 80
n_pages: 110
verdict: "No knob of the agy Flash first read switches. German (35 DTA books): no setting is non-inferior AND at least 10 % cheaper than live (4 a call, image as served, low); 8 a call loses its saving to filter cuts (0.49 vs 0.46 calls a page on one account). Latin (34 CAMENA books): the rule picked 8 a call, 1,600 px, low (0.17 vs 0.36 calls a page on the same account, CER +0.21 pp [-0.36, +0.84]); on 30 queue pages it FAILED confirmation (13/14 written accepted, one wrong-text page, paired 0 vs 1 of 10; live knobs 12/12). Next candidate: Latin 8 a call, 1,600 px, high thinking (CER -0.38 pp [-0.65, -0.15], 0.17 vs 0.25 calls a page on its account, 2x the wall time), not yet confirmed."
status: rejected
decision: "Keep the live first-read knobs (4 a call, image as served, thinking low) for German and Latin; Latin first reads stay arm c. Test next: Latin 8 a call at 1,600 px with HIGH thinking, confirmed on queue pages against read@4 and arm c."
superseded_by: null
issue: [6740, 7701]
router_evidence: [latin-blank]
defect_rates: "none — the design is scored by CER against typed references (DTA, CAMENA), not by judge defect tags; the confirmation is decided by k/n and the paired gate of confirm/RULE.md, committed before its reads"
---
PRIOR ART: `2026-10-30-german-cheaper-first-reads-7701.md` and `2026-10-29-cheap-routes-7701.md` (one knob at a time:
read@1 vs @4 vs @8, judged blind by Opus against the image; they own the ENGINE choice, this owns the knobs of the agy
read); `2026-10-06-typed-references-dta-camena-eebo-6012.md` (the typed references and the page alignment used as the
key here); `2026-10-28-euro-print-gpu-draft-flash-correct-7567.md` (CER against typed references, its `score.py`
conventions: wrappers out, letters only, infix alignment). None varies more than one setting of a read at a time.

## 2026-10-30 · Which combination of pages a call, image size and thinking gives the fewest agy calls a page without losing accuracy? Box-Behnken over the agy first read (#6740)

### Preregistration (committed before any agy call of this design)

**Question.** The agy first read (`cli-ocr.mjs read`, gemini-3.8-flash, live: 4 pages a call, the image as served,
thinking low) has three continuous or ordinal settings. Settings were compared one at a time (read@1 vs @4 vs @8).
Which combination gives the fewest agy calls per accepted page, per language, at no loss of accuracy?

**Factors (3 levels each, coded −1 / 0 / +1).**

| factor | −1 | 0 | +1 | note |
|---|---|---|---|---|
| x1 pages a call | 1 | 4 | 8 | ordinal coding (4 is the live setting) |
| x2 image long edge | 1024 px | 1600 px | 2400 px | `--long-edge`: never enlarged, so an image already within the edge is sent as served |
| x3 thinking | low | medium | high | the model id names the tier (`gemini-3.8-flash-{low,medium,high}`) |

- **Deviation from the brief, decided before any call:** the brief asked for thinking {minimal, low, medium}. agy offers
  no minimal tier (`agy models`, 2026-10-30: Flash low / medium / high only), so the levels are low / medium / high and
  the live setting (low) sits on the face of the design, not at its centre.
- **Design.** Box-Behnken, 12 edge-midpoint runs + 3 centre replicates = 15 runs per language, plus **2 live runs**
  (4 a call, image as served, low): the reference arm of the non-inferiority test and a second A-vs-A pair.

| run | x1 | x2 | x3 | | run | x1 | x2 | x3 |
|---|---|---|---|---|---|---|---|---|
| B01 | −1 | −1 | 0 | | B09 | 0 | −1 | −1 |
| B02 | +1 | −1 | 0 | | B10 | 0 | +1 | −1 |
| B03 | −1 | +1 | 0 | | B11 | 0 | −1 | +1 |
| B04 | +1 | +1 | 0 | | B12 | 0 | +1 | +1 |
| B05 | −1 | 0 | −1 | | C1–C3 | 0 | 0 | 0 |
| B06 | +1 | 0 | −1 | | L1, L2 | 0 (4) | served | −1 (low) |
| B07 | −1 | 0 | +1 | | | | | |
| B08 | +1 | 0 | +1 | | | | | |

- **Pools.** The `.agy-james` account is held to flash-low (`allowed-model`), and the default pool is spent until
  2026-10-30 22:00Z. So phase A (James, now) runs the low-thinking runs B05, B06, B09, B10 and L1; phase B (default,
  after the refill) runs the rest and L2. Within a phase the order is shuffled (seed 6740). L1 vs L2 is also the
  pool-vs-pool A-vs-A check; if they differ by more than the centre runs' spread, the thinking factor's low level is
  confounded with the pool and that is reported.

**Blocking: every run reads the same pages.** `scripts/eval/read-surface-6740/panel.mjs`, seed 6740.
- German: 40 books from the DTA (#6012 same-edition books), one target page each. Latin: 40 books from CAMENA.
  Century quotas: German 1500s 2 / 1600s 14 / 1700s 14 / 1800s 14 (drawn 1 / 12 / 14 / 13: only one 1500s book is
  eligible); Latin 1500s 16 / 1600s 18 / 1700s 6 / undated 2 (drawn 16 / 18 / 4 / 2).
- The target is a typed page whose page breaks fall on ours (`congruent`, one typed page, no typed notes, ≥ 400
  letters), interior for German (front 15 % and back 5 % skipped). CAMENA targets may sit from page 4 on: #6012 aligned
  most CAMENA books only on their first 25 OCR'd pages, and the front rule leaves 12 books.
- Each target has an 8-page window of its own book (t−3 … t+4). A 1-a-call run reads the target alone; a 4-a-call run
  reads t−1 … t+2 in one call; an 8-a-call run reads the window in one call. Only the target is scored; every page read
  counts in calls a page. The same image bytes go to every run (`--image-cache`).
- Faces (Fraktur / Antiqua) are labelled by eye from the target image before scoring, and reported as a split.
- **French is not in this design.** The one typed French set (#7567's 40 fr.wikisource proofread pages) is of
  Wikisource's own scans, not our library pages, and has no 8-page windows of our books. No library French page has a
  typed reference. Skipped, as the brief allows.

**Responses (per run, per language).**
1. **CER** (`measure: accuracy`): `scripts/eval/lib/metrics.mjs` `scoreAgainstReference(ref, read, 'latin')`, the
   windowed CER (1 − `charAccuracyWindowed`; the lower bound on accuracy, the one for comparing reads), after the read's
   header tags and their content are removed (`score.py`'s list). Capped at 1. The reference is the typed page body.
2. **Wrong text**: the identity guard (`aligned: false`, word guard > 0.35) on a target page where most runs pass it.
   A target where most runs fail the guard is a reference or leaf problem, not a read: it is excluded from every run
   before the fit, listed, and checked by eye. **Loop / cut**: letters > 2× or < 0.5× the page's median over runs.
3. **agy calls a page**, production-equivalent: (calls made in the run + c1 × pages left unread) ÷ pages in the run.
   `--no-alone` leaves a twice-refused block's pages unread instead of reading them one a call (the production
   fallback), to keep the design inside the budget; c1 is the language's measured calls a page over its 1-a-call runs.
   A target left unread takes, for CER, its read from the 1-a-call run at the same image size and thinking level
   where the design has one, else the mean of the 1-a-call runs (disclosed per run).
4. **Wall seconds a page**: the summed duration of the run's calls ÷ pages read. **Tokens**: agy's own usage per call
   (input, output, thinking), reported because the pool may meter tokens, not calls.

**Fit.** Per language and response, a full quadratic in the coded factors (10 terms) by least squares on the 15 BBD
run means (the live runs are not design points: "served" is not a level). Uncertainty: 2,000 by-book bootstrap
resamples (the same books resampled for every run, so runs stay paired), refit each time.

**Noise floor.** The A-vs-A spread: the range of the three centre runs' mean CER, and the 95 % paired bootstrap
interval of C1 − C2, C1 − C3, C2 − C3; the same for L1 − L2. Printed as a band on every chart.

**The optimum, and the rule (fixed now).**
- Candidates: the 27 settings of the 3 × 3 × 3 grid, plus "live".
- A setting is **non-inferior** when the 95 % bootstrap upper bound of δ = predicted CER(setting) − mean CER(L1, L2)
  is ≤ **1.0 percentage point** (eval-design §10.2 card 1, the registered CER margin for a cheaper route), and its
  wrong-text count, where it was run, is ≤ the live runs' mean + 1 per 40 books.
- **Optimum** = the non-inferior setting with the fewest predicted agy calls a page; ties (within 0.02 calls) go to
  fewer wall seconds a page, then to the setting nearest live.
- If the optimum is live, or saves under 10 % of live's calls a page, **nothing switches** and no confirmation runs.
- **Early stop, per language:** if after C1–C3 and L1 the A-vs-A range exceeds 2 pp CER, the design cannot resolve a
  1 pp margin; that language's remaining runs are not made.

**Confirmation (only if an optimum is found).** 30 real queue pages per language (the first-read frame,
`judge.mjs draw --cells=de-blank,la-blank`, new books, none in this panel or the #7701 draws), each read by live and by
the optimum, **paired**, judged blind by Opus against the page image (route-judge-6740 harness, its wrong-page and
planted controls), scored by the router rule (`scripts/eval/estimator/router-table/rules.json`, the paired gate). The
live setting changes only through a PR, only if the router picks the optimum. Latin first reads are now arm c
(PERO draft > agy, #7752), so a Latin optimum is confirmed against read@4 here and can replace arm c only after a paired
test against arm c on gex45 (a follow-up brief, not this job).

**Budget.** At most 2,000 agy calls in all; the design is capped at 1,500 (1,750 since Amendment 1) (a run in progress finishes; runs not
started are dropped, B runs before centre and live runs). Planned: about 45–70 calls a run × 34 runs.

**Amendment 1 (2026-10-30 21:20Z, after phase A's 10 runs, before phase B and before any fit).**
- *Unusable reads.* Phase A showed Gemini filter stubs ("This request was blocked by Gemini's filters …") and one
  restarted reply returned as 1-a-call reads. The rule above scored them as wrong text, and the identity-guard
  exclusion then dropped their pages as "reference problems". They are neither: `cli-ocr.mjs` flags every one
  (`meta.chatter`), and apply never writes such a read. So: a read with `meta.chatter` set or a write guard of
  truncated / loop / empty is **unusable**, and counts as a page the setting did not deliver (as an unread page: its
  calls stay in the cost; for CER the target takes the 1-a-call read, as above). A target with **no usable read in any
  of the four 1-a-call runs** cannot be read by this route at all (production leaves it scans-only): it leaves the CER
  analysis and is reported as *unreadable by the route*. The identity-guard exclusion applies to usable reads only.
  The scorer bug found on the way (centring marks `->Name.<-` ate the text between two centred lines; Faust read at
  CER 0.88, really 0.00) is fixed in `score.mjs` and changes no rule.
- *Budget.* Phase A used 509 calls for 10 runs (15 of them in two runs restarted after image-host 429s, with the image
  cache filled first). The plan line (45–70 calls × 34 runs) did not fit its own 1,500 cap, and the drop order would
  have cut Box-Behnken runs and broken the design. The design cap is now **1,750** and the confirmation's **250**; the
  2,000 total is unchanged.
- *Observed, not a rule:* German blocks here are refused (filter cut) far more often than on the queue: the DTA holds
  famous texts (Faust, Zarathustra, Grimm), which Gemini cuts as recitation. Absolute German calls a page from this
  panel overstate the queue's; the comparison between settings is paired and stands.

**Amendment 2 (STEER 1, Derek 20:52Z; written 21:45Z, before any phase-B run and before any fit): a Bayesian,
sequential surface.**
- *Prior data.* Every earlier agy first read (a plain read of the image, not a correction) with known settings on a
  #6012 congruent typed page, this design's own reads left out, stratified by prompt version
  (`prior-inventory.mjs`: 21,590 aligned pages in 246 books; the kept and stored Flash reads there are almost all
  corrections of lite drafts; the plain reads are a few dozen pages, all at 1 a call, image as served, thinking low).
  For the calls surface, also #7701's measured agy calls a page at read@4 and read@8 on queue pages
  (`routes-7701.json`). A prior point at "served" is coded x2 = +1 (the panel's median served long edge is 2,350 px);
  L1/L2 stay out of the surface, as preregistered.
- *Power prior.* Each prior point's variance is divided by a0 (0 < a0 ≤ 1), one a0 per response and language, chosen by
  empirical Bayes (`bayes.mjs estimateA0`: the marginal likelihood of this design's results at the settings where both
  exist). Calls: earlier read@4 against L1/L2. CER: no earlier read exists at the centre or the live setting, so the
  earlier (1, served, low) reads are compared with B05 (1, 1600, low) on the same books where they overlap, else
  pooled; the surface at a0 = 0 (no prior) is reported beside it. Coefficients get a vague N(0, τ²) prior besides
  (τ = 5 pp for CER, 1 call for calls).
- *Sequential runs.* C1–C3 and L2 are made first (noise floor, a0, pool check). Then the remaining Box-Behnken runs
  are made in batches of up to 3 per language, each batch the runs that most shrink the summed posterior variance of
  predicted CER over the cheap end (the 18 settings with 4 or 8 pages a call; `bayes.mjs rankNext`). A language stops
  when every cheap-end setting with predicted calls ≤ 0.9 × live is decided (its 95 % posterior interval for δ lies
  wholly ≤ 1 pp or wholly > 1 pp), or its Box-Behnken runs run out, or the 1,750 cap is reached. Runs the prior or the
  posterior already pins down are not made; the report counts the runs and calls saved against the full 17.
- *Decision.* The preregistered rule, with the posterior interval for δ in place of the bootstrap one; the
  least-squares bootstrap fit is reported beside it wherever 10 or more runs exist. The admin page draws the
  prior-only and the posterior surfaces.

**Amendment 3 (23:20Z, before any run it names and before any CER of phase B was looked at).**
- *What happened.* The first phase-B batch (C1–C3 and L2, both languages, 8 runs × 4 calls at once on the default
  pool) timed out: 257 of 339 calls ended at the CLI's 300 s limit (first at 22:05Z). The box was at load 180 on 16
  cores (52 agy processes, most of them other jobs started on the 22:00Z refill). Those 8 runs are discarded
  (`aborted/runs-overload-2310/`; their 339 calls count against the budget). A medium-thinking 4-page call that does
  finish takes 200–285 s, against 25–60 s at low.
- *Clean re-run.* C1 is re-run alone per language (2 runs × 3 calls at once). C2, C3 follow only if C1 finishes with
  under 10 % of its calls timed out; otherwise the noise floor is taken from L1 vs L2 (both low) and the medium and
  high planes are decided on cost alone: a setting whose calls a page (timeouts included, priced as refused blocks)
  is not below live's cannot be the optimum, whatever its CER.
- *Candidates.* The sequential pick (Amendment 2) may choose any of the 27 grid settings, not only Box-Behnken
  points: the steer asks for the runs where the posterior is least sure near the cheap end, and with thinking at low
  those are the two corners at 8 a call, X01 (8, 1,024 px, low) and X02 (8, 2,400 px, low), run on the James pool.
- *Wall seconds* now carry the box's load: they are reported per run with the time it ran, and do not break a tie.

**Amendment 4 (2026-10-31 00:05Z): two analysis changes made AFTER seeing the low-thinking runs. They are post hoc,
and are marked so wherever they decide anything.**
- *The Bayesian CER response is the paired difference from live*, not the run mean. Every run reads the same books;
  as independent means, the posterior intervals at settings that were run were ±1.1 pp, wider than the margin, while
  the paired by-book bootstrap of the same difference is ±0.3–0.6 pp (eval-design §7: paired by default). The
  preregistered least-squares fit with its paired bootstrap already had this; the change brings the posterior in line.
- *A setting that was run must also pass on its own paired difference* (conjunctive with the surface). The quadratic
  smoothed over Latin X01 (8 a call, 1,024 px: measured +1.77 pp [−0.18, +5.20], one wrong-text page; the surface said
  −0.06 pp). This change can only remove a setting from the candidates, never add one.
- The decision quoted is the one under both changes; the preregistered least-squares bootstrap is printed beside it.

**Amendment 5 (2026-10-31 00:40Z, post hoc, after C1): savings are judged against the live run on the same pool.**
The preregistered pool check fired: the two live runs, identical settings on two accounts, differ in calls a page
(German 0.46 on `.agy-james` vs 0.38 on the default pool; Latin 0.36 vs 0.25), because Gemini's filter cut more of the
James account's blocks. Phase A (all low-thinking runs) ran on James and phase B (C1, L2, B08) on the default pool, so
the pooled live mean flatters every default-pool run and penalises every James run. A run setting's saving is now
1 − its calls a page ÷ the same-pool live run's. This can only move a setting toward "nothing switches" relative to the
pooled comparison when it ran on the cheaper pool (German C1: 18 % against the pooled live mean, 9 % against L2).

**Amendment 6 (2026-10-31 09:40Z, job read-surface-2-6740; written AFTER seeing 10 runs a language and the Latin
confirmation, committed before any agy call it names).** Everything it decides is post hoc in the sense of
eval-design §10.2: the completed surface is **exploratory-completed**, and the confirmation it names (6.6) is the
clean test, with its own RULE file committed before its first read.
- *6.1 Complete the design.* Per language the nine runs not made: B01, B02, B03, B04, B07, B11, B12, C2, C3, on the
  SAME panel pages, the same image bytes (`--image-cache`, refilled and checked against each earlier read's
  `image_sha256`), the same scorer, and the **same exclusions, frozen**: German 35 books (5 out:
  `de-69e96196…-p55, de-698420e1…-p62, de-698fb792…-p22, de-69aebc3b…-p31, de-69ae8ee9…-p198`), Latin 34 (6 out:
  `la-6a4b1881…-p12, la-69bda005…-p521, la-6a906bf4…-p12, la-6a907846…-p19, la-6a437791…-p14, la-6a944280…-p25`). New
  one-a-call runs do not re-open the "unreadable by the route" list. Every earlier run is re-used unchanged. The nine run
  on the default pool (medium and high thinking; `.agy-james` is held to flash-low), in the preregistered phase-B
  shuffle (seed 6740) with those runs kept, the languages interleaved: de B02 C2 B07 B03 B12 C3 B01 B11 B04; la B12 B04
  B11 B03 B02 B07 C2 B01 C3. At most 3 runs at once, 3 calls at once a run (Amendment 3: the CLI's 300 s limit). A run
  with over 10 % of its calls timed out is re-run once at concurrency 2; a second failure is recorded, not retried.
- *6.2 The primary cost is quota, not calls.* The agy pool is charged by token cost (2026-10-27, #6740; #7503), so
  calls a page was the wrong cost: high thinking makes fewer calls of many more tokens. **Quota cost a page** = agy's own
  recorded usage on every call the page needed (block calls, refused and cut blocks, nudges, one-a-call fallbacks),
  priced at gemini-3.8-flash list rates (`scripts/lib/model-pricing.mjs`: $0.75 / M input, $3.75 / M output; cached
  input read at $0.075 / M, 10 % of input, Gemini's cache rate, an assumption), divided by the pages of the run. agy's
  `output` count INCLUDES thinking (checked on these runs: output − thinking ≈ 700–900 tokens a page at every thinking
  level, the text), so thinking is priced once, inside output. Pages left unread by `--no-alone` are priced at the
  measured cost a page of the one-a-call runs at the SAME thinking level (low B05; medium B01, B03; high B07), as calls a
  page used c1. A call with no recorded usage takes the run's mean cost for a call of its size, counted and disclosed.
  Reported in US $ a 1,000 pages read (list-price equivalent, not a bill: agy is a subscription). Recomputed for the
  existing 20 runs from their stored usage. Sensitivity: cached input at the full input rate.
- *6.3 Check the proxy once.* `agy -p "/quota" --output-format json` (no tokens) on the default pool before, between
  and after two runs made one at a time (de B02, then la B12: one medium, one high), only if no other process is using
  the default pool then (checked from `/proc/*/environ` of every agy process); repeated reads 60 s apart, until two
  agree. Reported: weekly quota fraction per $1 priced, for each run. If the two runs' measured quota ratio and their
  priced ratio differ by more than 2×, both are reported and the measured one prices the design (quota fraction a page
  = the run's quota fraction ÷ pages, fitted per thinking level). If the default pool cannot be had alone, the check is
  reported as not made and the priced proxy stands.
- *6.4 Responses kept.* CER (accuracy), calls a page, wall seconds a page (box load disclosed), filter cuts (refused or
  cut blocks), wrong-text and invented flags.
- *6.5 Fit.* Per language and response, the full quadratic (10 terms) by least squares on the 15 Box-Behnken run means,
  2,000 by-book bootstrap resamples (paired: the same books for every run). **Lack of fit**: F = (SS_LOF / 3) / (SS_PE /
  2), pure error from the three centre replicates. The Bayesian surface (Amendment 2, the same code) is refit on the 15
  as the cross-check; every setting where the two disagree on non-inferiority, or on cost by more than the bootstrap
  interval, is listed. **Pool confound, stated now**: the low-thinking plane (B05, B06, B09, B10) ran on `.agy-james`,
  the rest on the default pool, so the thinking effect on cost is partly the account's filter-cut rate. Sensitivity
  (only if the 18 runs leave ≥ 400 calls of the 1,500 and the pool is above 50 %): B05, B06, B09, B10 re-made on the
  default pool (`D05`, `D06`, `D09`, `D10`), and the surface refit with them in place of the James runs. The primary fit
  stays the one above.
- *6.6 Optimum and confirmation.* Optimum = the grid setting (27, plus live) with the lowest predicted quota cost a page
  whose least-squares bootstrap upper bound of δ CER against live is ≤ 1.0 pp (the preregistered margin), which also
  passes on its own measured paired difference if it was run (Amendment 4), with wrong text ≤ live + 1. Savings against
  the same-pool live run (Amendment 5: L2 for the default pool). Under 10 % cheaper than live: nothing switches, and
  live is the result. Otherwise a **German** confirmation first (the live lane): 30 fresh queue pages, one per book
  (de-blank frame, none in this panel, the #7701 draws or the Latin confirmation), live (4 a call, served, low) against
  the optimum, paired, blind Opus against the image, the rule of `confirm/RULE.md` adapted to German, plus the quota cost
  a page measured on the same pages; its RULE file (`confirm-de/RULE.md`) is committed before its first read. Latin only
  if the quota allows after German; its lane is arm c (#7752), so a Latin pass is paper evidence and a router row.
- *6.7* A pass is PROPOSED as a German knob change in a separate PR; this job applies nothing.
- *6.8 Sampling (Derek, inbox 09:53Z; written 10:05Z, after the first three runs of 6.1 started at 09:49Z and before
  any of their reads was scored or looked at; analysis rules only, no run changes).*
  (a) **Target population**: the pages the German first-read lane will read (visible German print books held as scans
  only, the `cli-ocr-lane.mjs` first-read frame). The panel is NOT a sample of it: it is the DTA books of #6012 with a
  same-edition typed reference, chosen because a reference exists. The gap is measured: panel vs queue frame tabulated
  on century, face (Fraktur / Antiqua, by eye on a seeded 60-page queue sample, seed 6740, one page per book), image
  long edge as served, and print density (letters a page: the panel from the typed references, the queue from the
  live-route reads of the confirmation pages). Latin is tabulated the same way on century and long edge.
  (b) **Post-stratification**: the surfaces are refit with each panel book weighted so the panel's century × face mix
  matches the queue sample's (cells with no panel book are merged into the nearest century; weights reported), and the
  optimum is reported both ways. If the two differ, the weighted one decides.
  *Cells, fixed 10:15Z after the frame was tabulated and before any read of 6.1 was scored:* the century × face cells
  above give the panel's one 1500s German book a weight of 16 (the frame is 37 % sixteenth-century pages by unread
  pages; the panel drew 1 of 40). So the cells are **era × face**: before 1700, the 1700s, 1800 and later; Fraktur
  (mixed counts as Fraktur) or Antiqua. Era shares are the whole frame's unread pages (`frame.mjs`, 3,131 German and
  15,356 Latin books); the face mix within an era is the by-eye sample's. Latin has one face (roman). Weights are
  computed over the books left after the frozen exclusions (35 / 34). Undated books take the panel's mean weight.
  (c) The German confirmation (6.6) is drawn from the queue frame **stratified to the same century × face mix**, one
  page per book, seeded (seed named in `confirm-de/RULE.md`).
  (d) **Power**: from the per-book differences between the centre replicates (C1–C3) and between L1 and L2, the smallest
  paired CER and quota-cost differences 35 / 34 books detect with 80 % power at two-sided α 0.05
  (MDE = (1.96 + 0.84) · SD of the per-book difference / √n), so a null reads as a bound.
  (e) **Limitations stated with the result**: DTA and CAMENA texts are on the open web, so the model may partly recall
  them (the memorisation subsidy, `.claude/docs/ocr-memorization-paper.md`), which flatters CER and can mask thinking
  and image-size effects; CAMENA targets start from page 4, not the interior; Latin is roman type only.
- *6.9 Dataset* `read-surface-6740 v1`, with a datasheet (Gebru et al.): one row per run × target page (settings, pool,
  the image's source URL and sha256, never a copy; the read text; CER; wrong-text / loop / cut flags; tokens by type;
  calls; wall seconds; refusal or cut reason), the panel draw, the confirmation draws and judge verdicts. Typed reference
  text is included only where its licence allows redistribution (DTA: CC BY-SA 4.0, checked on deutschestextarchiv.de;
  CAMENA: its terms checked, else offsets and hashes plus a fetch script). Schema, datasheet and export script in
  `scripts/eval/read-surface-6740/dataset/`; the files, licence-split, in R2
  `eval-artifacts/read-surface-6740/dataset-v1/`. No DOI is minted by this job.
- *Budget and stops (first form; superseded below).* ≤ 1,500 agy calls for 6.1 and the sensitivity, ≤ 300 for the confirmation; Gemini through the
  CLI only. Before each run `/root/agy-quota/pools.json`: stop if the default pool's weekly remaining is under 30 %.
  Before the Opus judge, `climits status`: stop above 85 % weekly on this box's account.

**Amendment 6, second form (Derek, inbox 09:57Z–10:04Z; written 10:27Z, committed before any agy call it names).
A staged, sequential response-surface study and a robust parameter design.** It supersedes 6.1 ("complete the nine
Box-Behnken runs") and the budget of the first form; 6.2–6.9 stand. Everything here is post hoc to the first 20 runs.
- *Disclosure.* I read these notes at 10:19Z. Three Box-Behnken runs of 6.1 (de B02, de C2, la B12) had started at
  09:49Z; at about 10:21Z the queue was stopped and those three were left to finish. They are kept as stage-2 points (below).
- *Scope decisions by Derek:* no gemini-4-argon (09:58Z): every read is gemini-3.8-flash-{low, medium, high}. "Effie"
  meant efficiency, not the EFM collection (10:04Z): no EFM stratum.
- **Stage 1, screening.** A Definitive Screening Design (Jones & Nachtsheim 2011; two-level categorical factors, Jones &
  Nachtsheim 2013) over five factors: pages a call {1, 4, 8}, image long edge {1,024, 1,600, 2,400 px} and thinking
  {low, medium, high} (three-level, coded −1/0/+1), and two two-level factors: **prompt** {live sentinels-6523; live +
  one script line, `read-surface-6740/prompt-lines/<lang>.txt`, sent through `cli-ocr.mjs --instruction-file`} and
  **image prep** {as served; grayscale + normalise + unsharp σ 2 (#5250's photometric arms), `cli-ocr.mjs
  --image-prep=gnu`, eval only, default off}. Construction: a conference matrix of order 6 (Paley, GF(5)), rows C and
  −C, columns 1–5, a categorical column's zero set to +1 in C and −1 in −C, plus two runs with the three continuous
  factors at their centre and the categorical pair at (+1, −1) and (−1, +1): **14 runs a language**
  (`read-surface-6740/dsd.mjs` → `design-dsd.json`, CᵀC = 5I checked; main-effect correlations 0 among the continuous
  factors, |r| = 0.17 continuous × categorical, 0.14 between the two categorical). Run order shuffled per language
  (seed 6740, in `design-dsd.json`). The scorer folds ſ → s and combining marks (checked), so the script line can move
  CER only through reading, not through a transcription convention.
- *Re-use:* a stage-1 point already made **on the default pool** with identical settings is not re-run: S02 (8 a call,
  1,600 px, high, live prompt, as served) = B08 in German and Latin. The 20 existing runs (and the 3 of 6.1) stay in the
  analysis as the slice at live prompt / as served.
- **Environment factors (robust parameter design).** The knobs are control factors; **language** and **date range**
  are environment factors the setting must hold across. Language: German (DTA, 35 books), Latin (CAMENA, 34), and
  **English** early print, a third panel drawn the same way from the EEBO-TCP same-edition typed pages of #6012
  (`panel.mjs --langs=en --merge`, a fresh seed-6740 stream; 204 eligible books, 40 targets, 1500s 12 / 1600s 26 /
  1700s 2; references CC0, EEBO-TCP phases I and II), its targets checked by eye (leaf and face) before any read is
  scored, exclusions by the same rules. Century (edition date) is a stratum of every panel and confirmation draw and a
  covariate in the models. Order of languages if the budget is short: German, Latin, English. All new runs on the
  default pool, at most 4 runs at once, 3 calls at once a run.
- **Stage 2, optimisation.** Active factors = those whose main effect (or second-order term, under effect heredity)
  on CER or on log quota cost has a 95 % book-bootstrap interval excluding 0 and, for CER, larger than the noise floor;
  at most four. If the active set is pages / edge / thinking with prompt and prep inactive, stage 2 is the Box-Behnken
  at live prompt / as served: the nine missing runs a language (three of them made), and English gets its own
  Box-Behnken only if budget remains after German and Latin. If prompt or prep is active, stage 2 is a face-centred
  central composite over the active continuous factors at the better categorical level, re-using every run that falls
  on its points. The stage-2 design is written into this file before its runs.
- **Stage 3, confirmation:** as 6.6 and 6.8(c) (German queue, era × face stratified, preregistered RULE).
- **Efficiency as a first-class response.** (a) quota cost a page and quota cost **per accepted page** = cost ÷ yield,
  where a target is accepted when its read is usable (not unread, not a filter stub or a cut / loop / empty reply)
  and not wrong text; (b) throughput: accepted pages a wall-clock hour for one lane reader (the lane's default
  concurrency is one book at a time: 3,600 ÷ wall seconds a page × yield), and accepted pages per account-week of
  quota (needs 6.3's measured quota fraction per priced dollar; if not measured, reported in list-price dollars only);
  (c) the **efficiency frontier**: per language and century, the settings no other beats on both CER and cost per
  accepted page, with live marked and its distance to the frontier in calls, quota and hours; (d) a **backlog
  projection**: weeks of quota to first-read each scans-only queue (German, Latin, English) at live and at the best
  confirmed setting, from queue page counts measured fresh and dated (German: 797,772 unread pages in 3,131 books,
  2026-10-31, `frame.mjs`).
- **Statistics plan** (Python 3.12, numpy 2.4.6, scipy 1.17.1, pandas 3.1.0, statsmodels 0.15.0; `analysis6.py`).
  The unit is the **page within run**. Linear mixed models with a random intercept for book (every run reads the same
  pages: book is a block), REML; fixed effects = second-order terms in the continuous factors, categorical main effects,
  two-factor interactions allowed by heredity, environment main effects (language, century) and knob × environment
  interactions. Responses: CER on the logit scale, logit((CER·n + 0.5)/(n + 1)) with n the reference's letters
  (residuals checked; if they fail, a beta regression with book-clustered bootstrap, and the record says which); log
  quota cost a page per book × run (a block's cost is its book's); filter cut and wrong text as binomial GLMMs
  (statsmodels BinomialBayesMixedGLM). DSD analysis by the two-stage method (Jones & Nachtsheim 2017): main effects from
  the fold-over pairs, then second-order on what remains; a half-normal plot of effects. Intervals: 2,000 book-level
  bootstrap resamples and REML standard errors. Lack of fit against the centre replicates (C1–C3 for the
  Box-Behnken; S13/S14 are centre runs in the continuous factors only). Noise floor from the A-vs-A pairs. Multi-response:
  Derringer desirability, CER as a constraint (δ upper 95 % ≤ 1 pp against live), cost a page minimised; and the Pareto
  front. **Multiplicity:** no p-value hunting on the screen; the screen only nominates, the held-out queue confirmation
  decides. **Power** by simulation from the observed book variance, for the 5-factor screen at 34–40 books, and 6.8(d).
  **Optima:** (a) pooled; (b) per stratum where a knob × environment interaction is real (interval excludes 0 and
  exceeds the noise floor); (c) **robust**: the cheapest setting whose predicted CER stays within the margin of live in
  every stratum with at least 10 books (strata with fewer are named).
- **Visuals added:** F4 as small multiples by language and by century; F7 the efficiency frontier; F8 the backlog
  projection (the public page leads with F7 and F8); a half-normal plot of the screen's effects.
- **Budget and stops (replacing the first form's).** At most **4,000 agy calls** for this job (stages 1–3, from 09:49Z
  on). Gemini through the CLI only. Before each run, `/root/agy-quota/pools.json`: stop if the default pool's weekly
  remaining is under 30 %; that stop decides how far down the language order the screen gets. `/quota` read before and
  after (6.3) where the default pool can be had alone. Before the Opus judge, `climits status`, stop above 85 %.

**Amendment 6, third form (Derek, inbox 10:33Z; written 10:36Z, committed before the first read of the screen it
describes).** It supersedes the second form's screen where they conflict; everything else of the second form stands.
- *Disclosure.* The second form's German screen started at about 10:30Z (S09, S12, S04, 3 runs at once) and was stopped
  at 10:34Z when this note was read: 2 one-page reads were made (moved to `aborted/runs-s1-second-form-1033/`, their
  calls counted). The Box-Behnken runs started under 6.1 are finished and kept: de C2 done, de B02 and la B12 finishing;
  they are stage 2 if the screen confirms the original three factors.
- **1. Factors (rationale: image prep's prior effect on Gemini is null or harmful, #5250, #5277, so a run on it spends
  quota to re-learn a null).** Screen = pages a call, image long edge, thinking (three-level, coded −1/0/+1) and the
  **prompt line** (two-level). DSD for 3 continuous + 1 categorical: a conference matrix of order 4, rows C and −C, the
  categorical column's zero set to +1 in C and −1 in −C, plus two runs at the continuous centre with the prompt line
  off and on: **10 settings, plus live** (`dsd.mjs --form=3` → `design-dsd3.json`).
- **2. Incomplete blocks (rationale: 35 books cannot speak for a queue of 3,131; more books at fewer settings each buys
  population coverage at the same calls).** New books from the typed-reference frame, each book's window read under
  **3 screen settings plus live**, in a balanced incomplete block allocation (every pair of screen settings shares
  about the same number of books; the allocation is published in `ib-allocation-<lang>.json` before any read). Book is a
  random effect, so comparisons stay within book; century is a covariate, not a per-stratum optimum. **The frame is
  smaller than ~140 books:** under the panel's rules (same-edition, a congruent single typed page, a full 8-page window
  with images, ≥ 400 letters, the interior rule) German has **61** eligible books, Latin **84**, English **204**. So
  German and Latin are a census of their frames (the 40 panel books included, read again under their 3 settings and
  live, which adds an A-vs-A pair with L2 on the same pool); English draws 140 of 204, stratified by era to the English
  queue frame (`frame.mjs`), the face (blackletter / roman) by eye and reported. Era × face stratification is therefore
  only possible for English; German and Latin are weighted to their queue frames as in 6.8(b). The existing
  35 / 34-book runs stay in the analysis.
- **3. One pool (rationale: Amendment 5's pool difference is the size of the effects sought).** Every new read on the
  default pool, including a **live repeat on every book**; the `.agy-james` low-thinking runs are reported as a pool
  contrast, not as part of the thinking effect.
- **4. Power gate, before the screen.** Simulated from the existing runs (the per-book variance of paired differences
  of L1/L2, C1/C2 and the run-to-run differences of the Box-Behnken; the per-book variance of log quota cost): the
  smallest CER and log-cost main effects the incomplete-block screen detects with 80 % power at two-sided α 0.05, per
  language, by the mixed model it will be analysed with (`power6.py`, 500 simulated screens). A factor whose plausible
  effect (from the existing runs or prior entries) is below that on both CER and cost is dropped before any read, and
  this file says so. Result written here before the first screen read.
- **5. Order.** German, then Latin, then English only if the pool allows. Latin and English are paper evidence; German
  decides.
- **6. Useful pages (rationale: confirmation pages are real queue pages that otherwise stay scans-only).** In the
  confirmation, each page's best judged accepted read is written through the normal first-read apply path
  (`cli-ocr.mjs apply --first-read-only`, guards on, provenance naming #6740 and this job). Rejected reads are not
  written. This is the job's only production write.
- **7. Budget.** Unchanged: 4,000 agy calls, the 30 % default-pool stop.
- **Power gate result (10:44Z, before any screen read; `power6.py`, 300 simulated screens a cell, `results/power.json`).**
  Variances from the existing runs (additive book + run fit, page level): German residual SD 0.77 pp CER, 0.59 log
  cost; Latin 3.07 pp, 0.49. Smallest high − low main effect the 10-setting incomplete-block screen detects (80 %,
  α 0.05): German 0.48–0.50 pp CER and 0.36–0.39 log cost for the knobs, 0.41 pp / 0.29 for the prompt line; Latin
  1.62–1.75 pp and 0.26–0.27; English (German variances, 140 books) 0.31–0.33 pp and 0.24–0.25. Plausible effects
  (least-squares main effects on the existing run means, high − low): pages a call CER −0.04 pp (de) / +0.47 (la), log
  cost −0.90 / −1.51; **image long edge CER −0.05 / −0.44 pp, log cost +0.13 / +0.05**; thinking CER −0.38 / −0.81, log
  cost +1.70 / +1.85; **prompt line**: none measured, prior prompt levers measured as noise (eval-design §10.2), cost
  +0.003 (≈ 40 input tokens on ≈ 15,000 a page). **Dropped: the image long edge** (below the detectable effect on both
  responses in both languages; held at the image as served, the live bytes, which also avoids the 8-a-call × 1,024-px
  break seen in Latin X01) **and the prompt line** (no plausible effect on either response). **The screen is the 3 × 3
  full factorial of pages a call {1, 4, 8} × thinking {low, medium, high}** at the served image and the live prompt
  (`design-ib.json`): the live cell (4, low) read on every book (`LI`), the other eight cells `G01`–`G08` three a book.
  Its detectable effects: German 0.42 / 0.48 pp CER and 0.32 / 0.35 log cost (pages a call / thinking), Latin 1.41 /
  1.59 pp and 0.23 / 0.25, English 0.28 / 0.31 pp and 0.21 / 0.24. CER effects of the size seen so far (≤ 0.4 pp in
  German) will mostly read as bounds; the cost effects are several times their detectable size.

### Result (2026-10-31 02:15Z)

**Runs made.** 10 a language (17 planned): L1, L2; B05, B06, B09, B10 (phase A, James pool); C1 (clean re-run), B08;
X01, X02 (Amendment 3's corner picks). Not made: B01–B04, B07, B11, B12, C2, C3. **Deviation:** Amendment 3 made C2/C3 conditional on C1
finishing with under 10 % of its calls timed out. C2/C3 were started early and then stopped at 00:20Z, when C1 stood
at 8 timeouts in 64 calls (12 %); C1 finished at 8 of 83 (9.6 %), just under the bar, and C2/C3 were not resumed (time
and budget). So the noise floor is the live pair L1/L2, not the centre runs. **agy calls: 1,635** of 2,000 (design 1,373, of them
339 in the discarded overload batch and 76 in the discarded load re-run of C1; confirmation 262). The preregistered
least-squares fit needs 10 design runs and was not computed (8 a language): every interval below is the paired by-book
bootstrap of a run against live, or the posterior of the Bayesian surface where marked.

**Panel after exclusions.** German 35 of 40 books (5 unreadable by the route: no usable one-a-call read, Gemini filter
cuts and one restarted reply; faces by eye 34 Fraktur, 6 Antiqua of the 40). Latin 34 of 40 (2 leaves not the typed
page, by eye; 4 unreadable by the route; all 40 roman type).

**Runs** (CER = mean windowed CER of the target pages, `measure: accuracy`; unread targets take the one-a-call read;
calls = production-equivalent agy calls a page; δ = paired difference from the mean of L1 and L2 with its 95 % by-book
bootstrap interval; pool = agy account; wall s = seconds of agy call time a page, at the box load of the time):

| lang | run | pages a call | long edge | thinking | pool | CER | δ CER (pp) | calls a page | same-pool live | wall s |
|---|---|---|---|---|---|---|---|---|---|---|
| de | L1 | 4 | served | low | James | 0.96 % | — | 0.461 | — | 12.4 |
| de | L2 | 4 | served | low | default | 0.92 % | — | 0.375 | — | 19.1 |
| de | B05 | 1 | 1,600 | low | James | 0.92 % | −0.02 [−0.11, +0.09] | 1.000 | 0.461 | 18.7 |
| de | B09 | 4 | 1,024 | low | James | 0.90 % | −0.04 [−0.13, +0.05] | 0.521 | 0.461 | 12.2 |
| de | B10 | 4 | 2,400 | low | James | 0.89 % | −0.05 [−0.13, +0.02] | 0.650 | 0.461 | 15.6 |
| de | X01 | 8 | 1,024 | low | James | 0.88 % | −0.06 [−0.15, +0.03] | 0.486 | 0.461 | 18.2 |
| de | B06 | 8 | 1,600 | low | James | 0.94 % | 0.00 [−0.07, +0.08] | 0.486 | 0.461 | 14.7 |
| de | X02 | 8 | 2,400 | low | James | 0.88 % | −0.06 [−0.14, 0.00] | 0.604 | 0.461 | 21.7 |
| de | C1 | 4 | 1,600 | medium | default | 0.86 % | −0.08 [−0.15, −0.01] | 0.343 | 0.375 | 42.3 |
| de | B08 | 8 | 1,600 | high | default | 0.50 % | −0.44 [−1.28, +0.01] | 0.446 | 0.375 | 37.4 |
| la | L1 | 4 | served | low | James | 2.15 % | — | 0.362 | — | 11.6 |
| la | L2 | 4 | served | low | default | 1.77 % | — | 0.250 | — | 16.7 |
| la | B05 | 1 | 1,600 | low | James | 2.35 % | +0.39 [−0.08, +0.92] | 1.059 | 0.362 | 18.8 |
| la | B09 | 4 | 1,024 | low | James | 1.91 % | −0.05 [−0.40, +0.31] | 0.388 | 0.362 | 10.0 |
| la | B10 | 4 | 2,400 | low | James | 2.33 % | +0.37 [−0.09, +0.88] | 0.422 | 0.362 | 12.5 |
| la | X01 | 8 | 1,024 | low | James | 3.73 % | +1.77 [−0.17, +5.16], 1 wrong text | 0.241 | 0.362 | 11.5 |
| la | **B06** | **8** | **1,600** | **low** | James | 2.17 % | **+0.21 [−0.36, +0.84]** | **0.174** | 0.362 | 7.7 |
| la | X02 | 8 | 2,400 | low | James | 2.42 % | +0.46 [−0.18, +1.12] | 0.275 | 0.362 | 12.1 |
| la | C1 | 4 | 1,600 | medium | default | 1.72 % | −0.24 [−0.63, +0.18] | 0.306 | 0.250 | 46.5 |
| la | B08 | 8 | 1,600 | high | default | 1.58 % | −0.38 [−0.65, −0.15] | 0.166 | 0.250 | 29.6 |

**Noise floor** (A-vs-A, L1 vs L2, same settings on two accounts, paired by book): German 0.12 pp, Latin 0.90 pp.
The two accounts also differ in calls a page (filter cuts): German 0.46 vs 0.38, Latin 0.36 vs 0.25.

**Prior (STEER 1).** 49 earlier plain agy first reads on typed pages (21 books), all at 1 a call, image as served, low;
by prompt version (job): German 5 books, Latin 18 books. a0 for CER = 1.0 in both languages (against B05; the earlier
reads agree with it); a0 for calls = 0.009 (German) and 0.017 (Latin): #7701's queue read@4 (0.55–1.03 calls a page)
disagrees with this panel's L1/L2, so it is all but ignored. **The prior saved no run**: it sits at one corner, away
from the cheap end. The runs not made were saved by the sequential rule and the C1 rule (9 Box-Behnken runs a
language, about 850 calls at this design's ~47 a run), less the 4 corner runs it added (about 200).

**Optimum by the rule** (Amendments 4–5; posterior and measured paired interval both ≤ 1 pp, saving against the same-pool
live run ≥ 10 %):
- German: **none**. The cheapest non-inferior setting is C1 (4 a call, 1,600 px, medium), 9 % under L2 on its pool,
  under the 10 % bar, at 3.4x the wall time. 8 a call is non-inferior on CER at every size but costs 0.49–0.60 calls a
  page against 0.46 on the same account: the content filter cuts more of the longer replies (DTA: Faust, Zarathustra,
  Grimm), and each cut block is read again page by page. **Nothing switches.**
- Latin: **8 a call, 1,600 px, low (B06)**: 52 % fewer calls than L1 on its account, CER +0.21 pp [−0.36, +0.84].
  At 1,024 px the same block size breaks (X01: +1.77 pp, one wrong-text page): eight small images in one call are too
  much shrinking for small roman type. The quadratic smoothed X01 to −0.06 pp, which is why Amendment 4 checks run
  settings on their own differences.
- Sequential state at the stop: 4 (German) and 8 (Latin) cheap-end settings, all at medium or high thinking, remain
  undecided by the surface (wide posteriors where no run was made). The job stopped there: the rule's pick had been
  read and its confirmation run; more high-thinking runs (80–95 min each at the box's load) could not change what has
  to happen next, a confirmation on queue pages.

**Confirmation on queue pages** (confirm/RULE.md, committed before any confirmation read; 30 new Latin books in the
first-read lane's frame, e-rara; both #7701 draws left out; each route run and written as the lane would; Opus blind
against the served image; 4/4 wrong-page controls refused, 2/2 planted errors caught):

| route | written accepted | wrong text | P(acc ≥ 0.8) | agy calls a page | not written (of 30) |
|---|---|---|---|---|---|
| read@4 (live knobs) | 12/12 | 0 | 0.947 | 0.832 | 18: 6 Greek/Hebrew letters, 6 reply cut, 5 call timed out, 1 tagged mixed |
| 8 a call, 1,600 px, low | 13/14 | **1** | 0.834 | 0.700 | 16: 9 Greek/Hebrew letters, 6 reply cut, 1 timed out |

Paired on the 10 pages both wrote: optimum only 0, live only 1; P(acc_O ≥ acc_A − 0.08) = 0.556. **Fails clauses 1
and 2** (wrong text 1/14 > 0.04; P 0.83 < 0.9; paired 0.56 < 0.9). The wrong text: the page prints *indiga* (lacking),
the read gave *indigna* (unworthy), changing the sense. Nothing switches. The queue's Latin pages are harder than the
panel's: over half of the drawn pages are not written by either route, and half of the live route's blocks were cut
by the filter (19 of 40, on the James account), so 8 a call saved 16 % here, not 52 %.

**Not decided, and next.**
- Latin 8 a call at 1,600 px with **high** thinking (B08): CER −0.38 pp [−0.65, −0.15] against live, 0.17 calls a
  page against 0.25 on its account (−34 %), 3 of 43 calls timed out, 2x the wall time. It is the candidate for the next
  confirmation (queue pages, against read@4 and arm c). Not run here: a second confirmation was not preregistered, and
  the budget left (365 calls) would not have covered it at the queue's cut rate.
- The account matters: identical live runs on the two agy accounts differ by 0.09–0.11 calls a page in filter cuts.
  Lanes that pick an account by quota (`--agy-home=auto`) see that difference as noise; it is worth its own A-vs-A.
- Medium and high thinking add 2–3.5x the wall time a page (and, at 8 pages a call, calls near the CLI's 300 s limit):
  a throughput cost the calls budget does not show.

**Router.** `latin-blank` gains `agy-flash-low@8-1600px-written` (13/14) and read@4-written gains this test's 12/12
(evidence `estimator/router-table/evidence/read-surface-6740.score.json`). Table `2026-10-31-read-surface-6740`: every
cell's decision is unchanged (latin-blank: arm c). It is not the live table: `current.json` stays on `2026-10-31-correction-pass-7818`, built in parallel with the #7818 German waiver; the next full build should include this evidence file (rebase, 2026-10-31).

**Admin page.** `/platform/admin/ocr-evidence/read-surface` (data `src/data/ocr-read-surface-6740.json`, from
`fit.mjs --data`): prior-only and posterior surfaces, the runs, the cost-against-accuracy chart, #7701's judged routes,
the confirmation.

**Files.** `scripts/eval/read-surface-6740/` (panel, runs plan, driver, scorer, prior inventory and scoring, Bayesian
fit, confirmation scorer and RULE.md); `results/` (surface.json, per-page scores without text, the prior's points, the eye verdicts) and `confirm/` (sample,
key, verdicts, score); the reads, the typed references and the discarded runs are in R2
`sl-corpus-snapshots/eval-artifacts/read-surface-6740/read-surface-6740-artifacts-2026-10-31.tar.gz` (sha256 checked on
read-back; typed text is CC BY-SA but stays out of the repo, as #6012).
Code changed for this design: `cli-ocr.mjs read --long-edge / --image-cache / --no-alone` (eval only; production passes
none), `scripts/lib/image-long-edge.mjs`, `judge.mjs` `la-surface` cell and `longEdge`.

**Not in scope.** The engine choice (#7701's german-cheaper owns it); the prompt; French; any write to a page. No page
or book is written by this design: `cli-ocr.mjs read` writes reads to disk, keeps them in R2 `candidate-reads/` (a
read of resized bytes is keyed by those bytes and never stands in for a production read), and records the job's book
list (`lane_job_books`).
