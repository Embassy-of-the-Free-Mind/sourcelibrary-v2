
# Non-generative baseline — difference-in-differences (2026-07-20)

Tesseract 5.5.2, local, $0. It cannot recite, so it absorbs page difficulty and
nothing else. The subsidy is the DIFFERENCE of two differences:

    subsidy = (VLM − tesseract)|canonical − (VLM − tesseract)|non-canonical

A VLM that merely reads well beats the baseline equally on both. A VLM that recites
beats it by MORE on canonical pages — that excess is the memorization subsidy, and it
does not require the reference text to be uncontaminated.

## Baseline accuracy (n=23 pages)

Mean char accuracy **58.8%**, aligned on 4/23.
Low is expected and not a defect — the required property is inability to recite, not accuracy.

| page | lang | canonical | source | acc | aligned |
|---|---|---|---|---:|---|
| chinese-daodejing-1 | chi_tra | canonical | woodblock | 0.0% | no |
| chinese-zhuangzi-xiaoyaoyou | chi_tra | canonical | woodblock | 2.0% | no |
| chinese-hanfeizi-nan-yan | chi_tra | canonical | print | 3.3% | no |
| chinese-xunzi-quan-xue | chi_tra | canonical | print | 6.0% | no |
| chinese-shijing-guan-ju | chi_tra | canonical | print | 12.5% | no |
| chinese-analects-xue-er | chi_tra | canonical | print | 13.3% | no |
| hebrew-psalms-1 | heb | canonical | print | 19.8% | no |
| armenian-xorenatsi-patmutiwn-2-60 | hye | non-canon | print | 50.0% | no |
| hebrew-sefer-hayirah-blessings | heb | non-canon | print | 59.9% | no |
| greek-iliad-1 | grc | canonical | manuscript | 60.2% | no |
| armenian-eznik-elc-alandoc-70 | hye | non-canon | print | 62.0% | no |
| armenian-zohrab-john-1 | hye | canonical | print | 68.2% | no |
| greek-dioscorides-ruel-106 | grc | non-canon | print | 75.4% | no |
| latin-aeneid-1 | lat | canonical | print | 87.5% | no |
| hebrew-genesis-1 | heb | canonical | print | 88.3% | no |
| latin-vita-vergilii-donatus-auctus | lat | non-canon | print | 89.2% | no |
| latin-hieronymus-prologus-galeatus | lat | non-canon | print | 89.9% | no |
| hebrew-shaarei-orah-gate2-yovel | heb | non-canon | print | 91.2% | yes |
| latin-hieronymus-epistola-ad-paulinum | lat | non-canon | print | 92.4% | no |
| greek-simplicius-in-phys-150 | grc | non-canon | print | 94.3% | yes |
| latin-vulgate-genesis-1 | lat | canonical | print | 94.3% | no |
| greek-philo-opificio-45 | grc | non-canon | print | 95.2% | yes |
| greek-hero-pneumatica-60 | grc | non-canon | print | 97.3% | yes |

## Difference-in-differences by model

Computed WITHIN script and averaged across scripts, giving each script equal weight.
Scripts carrying a canonical/non-canonical contrast: **armenian, greek, hebrew, latin**.
Chinese is EXCLUDED — all six CJK pages here are canonical, so it offers no contrast
and pooling it in reports the baseline's CJK collapse as memorization.

| model | armenian subsidy | greek subsidy | hebrew subsidy | latin subsidy | **mean (equal-weight)** |
|---|---:|---:|---:|---:|---:|
| claude-sonnet-5 | -39.6pp | 32.5pp | 41.1pp | 0.6pp | **8.7pp** |
| gemini-3-flash-preview | -94.8pp | 31.5pp | 31.5pp | 8.2pp | **-5.9pp** |
| gemini-3.1-flash-lite | -17.4pp | 33.8pp | 28.9pp | 1.6pp | **11.8pp** |
| gemini-3.1-pro-preview | -71.6pp | 36.9pp | 0.8pp | -3.0pp | **-9.2pp** |

Positive subsidy = the VLM outruns the non-reciting baseline by more on canonical
pages. Negative = the canonical pages are simply harder, and the pooled canonical-gap
numbers were measuring page difficulty rather than memorization.

**The pooled version of this table is invalid** and is not shown: canonical/non-canonical
is confounded with script in this page set, so an across-script difference-in-differences
reports composition. Within-script is the only valid form, which costs most of the sample.

**Caveats.** Tesseract language packs vary in quality by script; a weak pack handicaps
the baseline, but the handicap applies equally to canonical and non-canonical pages of
the SAME script, so the difference-in-differences survives while per-cell accuracy does
not. Cells are TINY once restricted to within-script contrasts — often one canonical page
against two or three non-canonical ones. Read the SIGN, treat magnitudes as provisional,
and note that Greek's only canonical page is a manuscript while its non-canonical pages
are print, so within-Greek still confounds source class with canonicity.
