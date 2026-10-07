## 2026-10-02 — Can open Sefaria text be fitted to Hebrew pages whose OCR failed? For 43 of 808 pages, verified page by page. Licence, edition layout and edges refuse the rest (#5560)

**Question.** The #5513 OCR pass left 808 pages without text across six Hebrew books: Zohar on Genesis–Exodus MS, Luria's Zohar commentary MS, Zohar Chadash 1701/2, Tikkunei 1706, Pardes Rimmonim 1786, and Talmud Yerushalmi 1922. Sefaria holds these texts in typed form. Can an openly licensed version be cut to each page and verified against the image?
**Design.** `scripts/import/sefaria-fit-5560.mjs` and `scripts/lib/sefaria-fit.mjs`.
- **Licence gate.** Use a version only if its own licence field is PD / CC0 / CC-BY.
- **Book gate.** At least 20% of the stored-OCR pages must locate in order, and page letters ÷ Sefaria letters advanced must be within 0.6–1.6.
- **Neighbour anchors.**
- **Independent read.** Kraken 7.1 + BiblIA on CPU, non-generative.
- **Scoring.** Letter-4-gram F1, order-free, against the fitted span vs shifts ±1, ±2, ±3 page-lengths and a far span. Rules: shift 0 best, F1 ≥ control + 0.08 and ≥ 1.8× control.
- **Coverage.** Read ÷ span letters within 0.6–1.6.
- **Edges (v2).** Both outer edges must be fitted from the page's own first/last 90 read letters. Rules were fixed before the pilot's scores; v2 tightened them after a by-eye failure.

`measure: judged` for edges (3 pages by eye from the image; 6 more against the read and the neighbour OCR) and `agreement` for location (read vs version).
**Result.** 43 written, 765 refused with reasons.

| book | pages | written | main reason for refusal |
|---|---:|---:|---|
| Zohar Gen–Ex MS | 175 | 0 | every Sefaria Zohar version is licence `unknown` |
| Luria MS | 81 | 0 | does not follow *Sha'ar Ma'amarei Rashbi* (13% of pages locate in order) |
| Yerushalmi 1922 | 359 | 0 | Vilna layout: the page holds 3.01× the Yerushalmi text it advances (commentaries) |
| Zohar Chadash | 75 | 31 | neighbours' OCR does not locate (21), out of order (7) |
| Pardes Rimmonim | 58 | 12 | edge rests on an anchor alone (14), weak anchor (13) |
| Tikkunei 1706 | 60 | 0 | neighbours do not locate (38); located pages fail edges (page/text 1.40, commentary) |

On written pages, F1 is 0.21–0.35 against controls 0.07–0.13.

Three findings:
1. **The stored Gemini OCR of these Rashi-type prints is not a reading.** It confuses א/ל throughout, and it degenerates toward the end of the page, where end-boundary identity is at chance. On Zohar Chadash p13 it recited a Zohar passage that is not on the page.
2. **The pages were not refused for RECITATION.** fail_reasons: MAX_TOKENS 1,183, loop 69, RECITATION 33.
3. **Controls test location, not edges.** A 4-page run split by letter count was ~2,000 letters off at every boundary and still passed F1 vs control. An anchor-only edge lost a line on Pardes p143.

**Implication.** Text fitting works only where an open version, a print that holds just that text, and readable edges coincide. For the 765 refused pages, the remedy is a loop-guarded re-read (#3878: about two-thirds recover).
**Replicated?** Single pass. Kraken is deterministic. **Artifact:** plans and reads in `/root/claude-jobs/sefaria-5560-work/books/*/plan.json` (Hetzner, not committed). Per-book comments are on #5560. Cost: $0 in Kraken CPU, plus one ~$0.001 Gemini probe.
