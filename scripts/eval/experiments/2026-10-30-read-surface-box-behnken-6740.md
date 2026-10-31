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
