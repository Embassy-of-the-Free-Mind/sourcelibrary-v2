---
stage: ocr
measure: [judged]
languages: [zh]
scripts: [Hani]
canons: []
n_books: 60
n_pages: 60
verdict: "No cheaper corrector is non-inferior to Opus on the Gemini-read Chinese pages, on either stratum. Every arm fails the 0.08 margin: the best are Paddle > agy Flash-medium on print (21/30 against Opus 26/30, d -0.17, CI -0.37 to +0.03, wrong-text pages 6 against 2) and Paddle > Sonnet on Siku (22/30 against 26/30, d -0.13, CI -0.27 to -0.03, wrong-text pages 5 against 1). Paddle > agy Flash-low reaches 18/30 and 19/30, wrong-text pages 9 and 8. The draft matters as much as the model: from the stored text Sonnet reaches 12/30 and 17/30 and agy Flash-low 8/30 and 10/30. All Paddle-draft arms beat stored (lower bounds +0.17 or better). Opus judged again in the same queue: 26/30 and 28/30, accept verdicts agreeing on 58 of 60 pages; wrong-page controls 8 of 8 rejected."
status: rejected
decision: "No write and no routing change: current.json and rules.json are untouched. No DECISION to route a stratum through a cheaper arm, since none is non-inferior. #8008's open question stands: Opus correction for the frame at about $340-620. Paddle > Sonnet costs about 40% of that and leaves about 18% wrong-text pages against 4% (frame-weighted); that trade was not asked for and is not recommended here."
superseded_by: null
issue: [7263]
router_evidence: "none — the export is in router-table/evidence/zh-reocr-cheap-arms-7263.score.json (+ by-script), per stratum, and router-confirm/results/chinese-gemini-*-cheap-arms-2026-11-03.json. rules.json does not name it: the brief changes no table (same handling as 2026-11-03-zh-gemini-reocr-cell-7263.md)"
defect_rates: "scripts/eval/zh-gemini-reocr-7263/results/score-cheap-arms.json"
---
## 2026-11-03 · Can a cheaper corrector replace Opus on the Gemini-read Chinese? Paddle > agy Flash, Paddle > Sonnet, stored > each (#7263)

Derek, 2026-11-03: "test paddle plus agy flash .. also sonnet". Same 60 pages, Paddle reads, judge and controls as `2026-11-03-zh-gemini-reocr-cell-7263.md` (#8008).

PRIOR ART:
- `scripts/eval/zh-gemini-reocr-7263/` and `router-confirm/confirm.mjs judge`: extended, not rewritten. Verdicts are keyed by text hash, so #8008's rows stand and only new texts were judged.
- `scripts/batch/ocr-convergence/correct.mjs`: gains `--draft-dir`, `--cli=agy`, `--max-calls`. Without those flags it runs as before.
- `cli-ocr.mjs read --draft-file`: not used, because its prompt is the #5924 template. The brief asks for the prompt that scored 26/30.
- `2026-10-28-router-tests-agy-flash-low-gpu-draft-7263.md`: stored 3 Flash > agy Flash-low, 6/30 on another draw. Here 8/30 and 10/30.
- `2026-11-01-flash-tier-judge-7611.md`: how an agy call is priced.

### Design

Set before any new text was judged (`results/cheap-arms/prereg.md`).

- **Arms.** PFL paddle>agy-flash-low, PFM paddle>agy-flash-medium, SFL stored>agy-flash-low, PSN paddle>sonnet, SSN stored>sonnet.
- **Prompt and inputs.** `correct.mjs`'s prompt byte for byte (live OCR prompt, Standard OCR v19.1, plus `correctInstruction`), image and draft as files, one page a call, `CANDIDATE_READS=off`. The prompt's words "the Read tool" were left as they are for agy, whose tool is `read_file`. The gate log shows both files opened on every counted answer. #8008 did not record its prompt version, so v19.1 being the same prompt is assumed.
- **Paddle draft.** The read itself: Pu on print (guard off), P on Siku. On the one print page and one Siku page Paddle refused, the draft is the stored text.
- **What is served.** A correction; UNCHANGED serves the draft; contain or no answer serves stored.
- **Agy.** PFL and SFL on `.agy-milo` (Gemini weekly 95% at the start). That login is held to low, so PFM ran on root's pool (14% weekly) under the brief's cap: exactly 60 calls. Mean thinking tokens: low 0–1,300, medium about 23,000.
- **Sonnet.** `claude -p --model sonnet` on this box's login; transcripts name `claude-sonnet-5-5`.
- **Judge.** `judgeAbsolute`, Opus, image attached, one text a call, blind to arm. 334 calls, plus 2 re-runs. Opus's 60 texts and the 4 controls went into the shuffled queue again under `#retest`, so Opus has a row judged in the same sitting. The two calls had timed out; all parsed on the re-run.
- **Non-inferior to Opus.** Margin 0.08 (rules.json `within`). Strict: CI lower bound of d >= -0.08, and wrong-text rate within 0.04. The rule's point-estimate pass is reported beside it. Primary comparator: #8008's Opus verdicts; sensitivity: the retest.

### Results

Print (29,506 frame pages):

| arm | accepted | wrong-text pages | severe / 1,000 chars (95% CI) | fidelity | d vs stored (95% CI) | gained / lost |
|---|---|---|---|---|---|---|
| S stored | **3/30** | 22 | 19.65 (14.79–24.84) | 3.03 | — | — |
| P Paddle print lane (#8008) | 6/30 | 21 | 16.39 (10.43–22.40) | 3.23 | +0.10 (−0.03, +0.23) | 4 / 1 |
| Pu same, guard off (#8008) | 7/30 | 20 | 9.87 (6.27–14.08) | 3.43 | +0.13 (0, +0.30) | 5 / 1 |
| O stored > Opus (#8008) | **26/30** | 2 | 1.23 (0.28–2.50) | 4.50 | +0.77 (+0.60, +0.90) | 23 / 0 |
| PFM Paddle > Flash-medium | **21/30** | 6 | 3.79 (1.90–5.76) | 4.13 | +0.60 (+0.43, +0.77) | 18 / 0 |
| PFL Paddle > Flash-low | **18/30** | 9 | 5.64 (3.55–7.82) | 3.90 | +0.50 (+0.33, +0.67) | 15 / 0 |
| PSN Paddle > Sonnet | **18/30** | 7 | 3.61 (2.26–5.21) | 4.10 | +0.50 (+0.30, +0.70) | 16 / 1 |
| SSN stored > Sonnet | **12/30** | 14 | 8.55 (5.08–12.88) | 3.60 | +0.30 (+0.13, +0.47) | 9 / 0 |
| SFL stored > Flash-low | **8/30** | 19 | 12.34 (8.70–15.89) | 3.27 | +0.17 (+0.03, +0.30) | 5 / 0 |

Siku (93,277 frame pages):

| arm | accepted | wrong-text pages | severe / 1,000 chars (95% CI) | fidelity | d vs stored (95% CI) | gained / lost |
|---|---|---|---|---|---|---|
| S stored | **8/30** | 18 | 18.87 (13.58–25.64) | 3.17 | — | — |
| P Paddle whole-page lane (#8008) | 14/30 | 14 | 11.04 (5.70–15.69) | 3.57 | +0.20 (−0.03, +0.43) | 10 / 4 |
| O stored > Opus (#8008) | **26/30** | 1 | 0.90 (0.13–1.93) | 4.73 | +0.60 (+0.43, +0.77) | 18 / 0 |
| PSN Paddle > Sonnet | **22/30** | 5 | 6.68 (2.54–9.97) | 4.27 | +0.47 (+0.27, +0.67) | 15 / 1 |
| PFL Paddle > Flash-low | **19/30** | 8 | 6.68 (2.94–11.77) | 4.03 | +0.37 (+0.17, +0.57) | 12 / 1 |
| PFM Paddle > Flash-medium | **19/30** | 7 | 6.03 (2.52–10.93) | 4.13 | +0.37 (+0.17, +0.57) | 12 / 1 |
| SSN stored > Sonnet | **17/30** | 8 | 9.37 (5.12–15.21) | 4.03 | +0.30 (+0.13, +0.47) | 9 / 0 |
| SFL stored > Flash-low | **10/30** | 13 | 11.68 (7.78–17.04) | 3.67 | +0.07 (−0.10, +0.23) | 4 / 2 |

Paired against Opus on the same pages (d = arm − O; non-inferior needs a lower bound of −0.08 or above):

| stratum | arm | d (95% CI) | gained / lost | wrong-text pages, arm vs O | made / cleared | severe Δ per 1,000 | rule bar | strict | d vs O retest (95% CI) |
|---|---|---|---|---|---|---|---|---|---|
| print | PFM | −0.17 (−0.37, +0.03) | 2 / 7 | 6 vs 2 | 5 / 1 | +2.56 | FAIL | no | −0.17 (−0.37, +0.03) |
| print | PFL | −0.27 (−0.47, −0.07) | 2 / 10 | 9 vs 2 | 8 / 1 | +4.41 | FAIL | no | −0.27 (−0.47, −0.07) |
| print | PSN | −0.27 (−0.47, −0.07) | 2 / 10 | 7 vs 2 | 6 / 1 | +2.38 | FAIL | no | −0.27 (−0.47, −0.07) |
| print | SSN | −0.47 (−0.63, −0.30) | 0 / 14 | 14 vs 2 | 12 / 0 | +7.32 | FAIL | no | −0.47 (−0.63, −0.30) |
| print | SFL | −0.60 (−0.80, −0.40) | 1 / 19 | 19 vs 2 | 17 / 0 | +11.11 | FAIL | no | −0.60 (−0.80, −0.40) |
| Siku | PSN | −0.13 (−0.27, −0.03) | 0 / 4 | 5 vs 1 | 5 / 1 | +5.78 | FAIL | no | −0.20 (−0.37, −0.07) |
| Siku | PFL | −0.23 (−0.40, −0.10) | 0 / 7 | 8 vs 1 | 7 / 0 | +5.78 | FAIL | no | −0.30 (−0.47, −0.13) |
| Siku | PFM | −0.23 (−0.40, −0.10) | 0 / 7 | 7 vs 1 | 7 / 1 | +5.13 | FAIL | no | −0.30 (−0.47, −0.13) |
| Siku | SSN | −0.30 (−0.47, −0.13) | 0 / 9 | 8 vs 1 | 8 / 1 | +8.47 | FAIL | no | −0.37 (−0.53, −0.20) |
| Siku | SFL | −0.53 (−0.70, −0.37) | 0 / 16 | 13 vs 1 | 13 / 1 | +10.78 | FAIL | no | −0.60 (−0.77, −0.43) |

Print PFM is the only row whose interval reaches zero, and it still runs far past the margin. Thirty pages cannot call it equal to Opus, and they cannot exclude a gap of 0.37.

Frame-weighted with #8008's weights (accepted; wrong-text pages): O 87%, 4%. PSN 70%, 18%. PFM 65%, 23%. PFL 63%, 28%. SSN 53%, 32%. SFL 32%, 48%. Stored 23%, 63%.

**Judge stability.** Opus's texts judged a second time: print 26/30 both times (30 of 30 verdicts agree), Siku 26/30 then 28/30 (28 of 30 agree). Wrong-text pages 2 then 1, and 1 then 1. Wrong-page controls: 4 of 4 rejected, and 4 of 4 again.

**Medium over low.** On print, +3 pages and 3 fewer wrong-text pages. On Siku, no gain in acceptance and 1 fewer wrong-text page. At 5 to 6 times the price.

**Is it only Opus preferring Opus?** Not fully settled, as in #8008. The judge and O are the same model, and no other judge ran. For the stored-draft arms, `crosscheck.py` asks Paddle, which saw neither text, which side it takes on each character the arm changed. Paddle sides with the correction: SSN 83 to 21 (print), 31 to 11 (Siku); SFL 54 to 13, 25 to 4. So these arms' edits point the right way. On print there are fewer of them; on Siku, SSN makes as many as O and still loses 9 pages to it. Single-character changes Paddle could check: O 176 and 46, SSN 118 and 47, SFL 78 and 33. The Paddle-draft arms cannot be checked this way, because Paddle is their draft.

### By eye

**格致鏡原, 6992cbd7…p303 (print, image open).** The judge marks PSN wrong for 魏畧管靈. The leaf prints 管寍, a form of 寧 (Guan Ning), not 靈. The judge is right, and the error changes the person named. One page, chosen from the PSN pages Opus passed; no other was checked by eye.

### Prices per 1,000 pages and the whole frame

Subscription quota priced at the fee. Agy: $0.00055 × (arm's mean list cost a call ÷ the #7611 Flash-low judge call's $0.0084) × calls a page, one page a call; about $55 a pool-week at 100K Flash-low judge calls. Paddle arms add ~$0.09 for the read. Sonnet: Opus's #8008 bounds ($2.77 at 10 a call, $5.72 at 1 a call) × the measured list-cost ratio to Opus at one page a call ($6.23 / 60 = $0.104 a page): PSN 0.37, SSN 0.46. Sonnet's 10-a-call figure assumes the ratio holds in batches, which was not measured.

| arm | print $/1K | print frame (29,506) | Siku $/1K | Siku frame (93,277) | quota for the frame, print + Siku | $ per accepted page, print; Siku |
|---|---|---|---|---|---|---|
| O stored > Opus (#8008) | 2.77 | $82 | 2.77–5.72 | $258–534 | 1.8 + 5.6–11.6 Claude account-weeks | 3.20; 3.20–6.60 |
| PSN Paddle > Sonnet | 1.12 | $33 | 1.12–2.22 | $104–207 | 0.7 + 2.1–4.3 account-weeks | 1.87; 1.53–3.03 |
| SSN stored > Sonnet | 1.27 | $37 | 1.27–2.62 | $118–244 | 0.8 + 2.6–5.3 account-weeks | 3.18; 2.24–4.62 |
| PFL Paddle > Flash-low | 1.63 | $48 | 1.33 | $124 | 0.8 + 2.1 agy pool-weeks | 2.72; 2.10 |
| SFL stored > Flash-low | 1.72 | $51 | 1.18 | $110 | 0.9 + 2.0 agy pool-weeks | 6.45; 3.54 |
| PFM Paddle > Flash-medium | 7.75 | $229 | 8.00 | $746 | 4.1 + 13.4 agy pool-weeks | 11.07; 12.63 |

Paddle arms also take about 42 card-hours for the whole frame. $ per accepted page leaves out what the other pages cost: they are still served, and the wrong-text ones mislead.

**Quota read per arm.** The meters are too coarse and too shared to price an arm on their own, so the table uses token cost.
- Sonnet, 123 calls: Claude weekly 5% to 6% (integer meter, other jobs and this session on the same login). That is consistent with `capacity.json`'s sonnet@1 ($2.30 per 1K pages).
- Flash-low on `.agy-milo`, 122 calls: weekly 95% to 92%, 5-hour 82% to 70% over 90 minutes, with the cron lanes on the same pool.
- Flash-medium on root's pool, 60 calls: weekly 14% to 14%, 5-hour 97% to 96%.
- The judge's 334 Opus calls: Claude weekly 6% to 8%.

### Limits

- n = 30 a stratum, one page a book, the #8008 draw. Pages tagged handwritten or mixed were not drawn, and one-page Siku books are thinly sampled.
- One page a call. A real lane would batch, which is unmeasured for these arms.
- Print PSN and PFM keep the Paddle draft's bare layout on UNCHANGED answers, so 6 and 4 print pages have no `<page-type>`. A production route would have to deal with that; the judge reads the text and image only.
- A single judge. Acceptance for Chinese stays an upper bound until the name check runs, as #8008 says.

### Served text not contained

Read-only by the brief, so nothing was withheld. SSN also answered CONTAIN on 6a1d81af…p333, the leaf #8008 found off by one, independently naming the same mismatch; that hold is still owed by a session with write access. SSN also answered CONTAIN on 6a3c62e1…p25 (御定佩文韻府), calling the stored text a scrambled table with an invented header. Not checked by eye; a candidate only.
