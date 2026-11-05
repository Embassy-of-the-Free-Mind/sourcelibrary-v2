---
stage: image
measure: accuracy
languages: [de]
scripts: [Latn]
canons: []
n_books: 1
n_pages: 40
verdict: "To check proposed split cuts, Opus reading one 20-frame contact sheet per call caught 9/9 planted bad cuts with 0/28 false flags in both runs. Zoomed gutter strips did worse for every Claude model (Opus 5–8/9), two sheets per call missed a 45/1000 shift, Sonnet missed 45/1000 shifts (7–8/9), Haiku was unreliable, and Clef could not separate bad from good cuts (AUC 0.76). Gemini Flash finds shifts only one strip per call, and over-flags about a quarter of real cuts."
status: adopted
decision: "BPH spread splits (#7605) are checked by Opus reading split-spreads-agy's 20-frame contact sheets, one sheet per call; the agy strip screen is not needed in front of it"
superseded_by: null
issue: [7605]
---
## 2026-10-29 · Which model, and what sheet size, should check proposed split cuts? (#7605)

PRIOR ART: `scripts/eval/experiments/2026-10-28-split-cuts-agy-flash-low-5771.md` asks whether Flash can PLACE a
cut. This asks who can CHECK one, and in what layout. `scripts/eval/experiments/2026-10-04-clef-vs-jev-instruction-page-screen.md`
is the Clef/Jev price and quality baseline.

**Decision it changes:** how the 73 BPH spread books (9,861 proposed cuts, 543 contact sheets) are checked before
`split-spreads-agy.mjs apply` writes. The plan before this test was a Gemini strip screen, then Claude on what it
flagged.

**Set.** Book 6a1a5df783fe2fc6d969c0ea, a German manuscript (*Beschreibung einiger Wissenschafften*). Its fold of
506/1000 was checked by eye before the book was split. Frames 61–100: two sets of 20.
- **Planted bad cuts (9):** shifts of ±45, ±60, ±80 and ±100 per mille, and one spread marked WHOLE in each set.
- **Borderline (3):** shifts of ±30. These sit inside the 3% overlap each leaf keeps, so they are scored apart.
- **Clean (28).**

Rendered by `_tmp-sheetfmt.mjs` (scratch, gex45) in four layouts:
- T20: 20 whole-frame thumbnails, 300 px, in a 5-wide grid. This is the production `sheet-NN.jpg`.
- S10, S20 and S40: 10, 20 or 40 strips cut from the full-resolution frame at fold ± 15% of its width.

Each layout went to each model twice through `claude -p --model <m>` (one call per sheet; the Read tool only). Every
model got the same rule: OK when the gutter is inside the overlap band and the line crosses no writing.

| model · layout | bad caught (2 runs) | clean flagged | borderline flagged | API-equivalent $/frame |
|---|---|---|---|---|
| **Opus · T20** | **18/18** | **0/56** | 4/6 | 0.0047 |
| Opus · S10 | 16/18 | 1/56 | 4/6 | 0.0096 |
| Opus · S20 | 12/18 | 1/56 | 2/6 | 0.0052 |
| Opus · S40 | 10/18 | 2/56 | 2/6 | 0.0025 |
| Opus · 2 × T20 in one call | 16/18 (missed p.89, a 45/1000 shift, both runs) | 0/56 | 2/2 | 0.0031 |
| Sonnet · T20 | 15/18 (missed 45/1000 shifts) | 0/56 | 3/6 | 0.0019 |
| Sonnet · S10 | 16/18 | 2/56 | 6/6 | 0.0035 |
| Sonnet · S20 | 15/18 | 4/56 | 3/6 | 0.0018 |
| Haiku · S10 | 16/18 | 6/56 | 5/6 | 0.0003 |
| Haiku · T20 | 10/18 | 2/56 | 1/6 | 0.0002 |
| Haiku · S20 / S40 | 4/18 | 0–1/56 | 0–1/6 | 0.0001 |

Opus · T20 gave the same answer in both runs. Its borderline flags (63 and 92, 30/1000 off) are cuts close to a
written line, a defensible call.

**Other instruments on the same frames:**
- **Clef and Clef-flash** (Cloudflare System One, image input; Jev itself reads only text). One strip per call, a
  `noul` "is the gutter inside the band" question, 38 strips. AUC 0.765 and 0.760: the scores for bad cuts (0.32–0.83)
  overlap the clean median (0.78 / 0.73). About $0.00001 a strip.
- **agy Gemini 3.8 Flash low** (2026-10-29, frames 61–80, 5 planted). Whole sheet per call: 1–2/5. Strips on one
  sheet: 2–3/5. Flash medium: 1–4/5, erratic. One strip per call, yes/no: all 4 shifts, 1–2 false flags in 19.
  On the 73 BPH books that screen flagged 2,464 of 9,861 real cuts (25%). By eye, on the 131-cut gate book, all 25
  of its flags were cuts inside the overlap.

**Reading.**
- A whole-frame thumbnail shows where the fold is, both page edges and the binding. A strip shows only the line's
  neighbourhood, and Claude models judged the fold worse from it at every strip count.
- Most of a `claude -p` call's cost is fixed context, so batching looks cheap. But two sheets in one call lost a
  real error in both runs: one sheet per call.
- The cheap screens (Flash strips, Clef) save nothing here. Flash over-flags so much that Opus must still read
  about half the sheets, and Clef cannot rank.

**Limits.** One book, one hand, one scan style. The planted errors are horizontal shifts and wrong WHOLE frames.
Untested: a cut frame that is really a single leaf, a plate or fold-out, and a skewed gutter. The production run
reads the real sheets, where those cases occur. Its results land on #7605.

**Cost of the production run.** 543 sheets × one Opus call, about $55 at API prices. It runs on the Max
subscription (team@), so no money is spent.
