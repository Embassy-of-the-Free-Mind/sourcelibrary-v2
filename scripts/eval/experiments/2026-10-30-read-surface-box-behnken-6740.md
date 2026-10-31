---
stage: ocr
measure: [accuracy]
languages: [de, la]
scripts: [Latn]
canons: []
n_books: 80
n_pages: 80
verdict: "PREREGISTERED 2026-10-30 (job read-surface-6740): no result yet. Box-Behnken tuning of the agy Flash first read (pages a call × image long edge × thinking) on 40 DTA German and 40 CAMENA Latin books."
status: undecided
decision: null
superseded_by: null
issue: [6740, 7701]
router_evidence: []
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

**Not in scope.** The engine choice (#7701's german-cheaper owns it); the prompt; French; any write to a page. No page
or book is written by this design: `cli-ocr.mjs read` writes reads to disk, keeps them in R2 `candidate-reads/` (a
read of resized bytes is keyed by those bytes and never stands in for a production read), and records the job's book
list (`lane_job_books`).
