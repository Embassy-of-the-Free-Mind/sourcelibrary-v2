<!-- PRIOR ART: scripts/eval/results/translation-corpus-audit-2026-09-30/ (the verdicts this re-reads); eye-notes.md (the earlier by-eye pass, which checked confirmation of flags but did not type the invention flags) — neither separates boundary text from fabrication. -->
## 2026-10-02 — What the audit judge calls "invention" (#5274 follow-up, #5575, #5606)

- **Question.** The 2026-09-30 audit flags invention on 11.2% of served pages (weighted), and the paired arm (PR #5372) found Flash flagged more often than Lite (15.8% vs 8.2%). Is that fabrication?
- **Design.** Every `main` item whose Opus verdict flags invention or lists an invention defect: **45 of 311 pages** (14 with a major invention defect). Each defect was typed by reading it against the transcription. Every end-of-page or start-of-page continuation was checked against the OCR of the adjacent page (Mongo `pages.ocr.data`). Spot checks were made from the scan image (read from image) for Herculanensium 1871 p.328, Marcianus gr. 299 p.300, Nongzheng quanshu p.63, Ideal Suggestion p.136, Tweede scheeps-togt p.4, and Pelliot chinois 3413 p.1. Read-only. $0.
- **Result.**

| kind | pages | major | flash / lite |
|---|---:|---:|---|
| Text from the adjacent page (page-boundary) | 14 | 8 | 6 / 8 |
| Unreadable source filled with plausible content | 6 | 5 | 4 / 2 |
| Editorial additions in notes/headings/meta (names, dates, identifications, phantom illustration) | 21 | 1 | **17 / 4** |
| Bracketed glosses | 4 | 0 | 3 / 1 |

  - **Page-boundary: 13 of 14 confirmed on the adjacent page.** Ids: 1dfa95a297, 9242725390, 7c34ba73d6, ed9643dcf5, 52e056e34f, 630e34eb2f, bbad675645, 485571afa2, 8ad1bca178 (a correct completion of a hyphenated word: στα-|σιάσαντα), 018aef589b, 545f9fcf4b, 61d9ea9855, and 740bb56281 (the PREVIOUS page's meditation). Unconfirmed: 0b1479907c.
  - **Unreadable source:** 84ac5ad2ef, f4f7331295, 673eeb90f6, 9f3c4b81cf, 03e5f6510e, b555628e1b. All are manuscripts, damaged pages or garbled OCR.
  - **Editorial:** d6e06822f0, 05645dc5a2, 0ab88f055a, ee9968755a, b5743d8a92, 49666cd5c1, 640eeb7244, e163c51e42, cd25001770, a827fdf979, 6b893e00bd, 77e17c0733, 7cf97b9e44, e19901a027, 134c51dfa7, 4b76768eb2, 897246fdea, 4c9937a086, 38e3a0869b, 959dcf8ad2, 621637f802.
- **Consequences.**
  1. The audit's invention rate overstates fabrication. Text with no source was found on 6 of 311 pages; page-boundary text on 14.
  2. Page-boundary text is a citation defect: the English for page N carries page N±1. It needs a detector that compares a translation's tail with the next page's head, not a prompt change alone.
  3. Flash's excess invention is mostly annotation (17 vs 4), not mistranslation. Any Flash-vs-Lite translation comparison (#5606) must report invention by kind.
  4. Side finding: book `69af123a0092756351e4483e` is catalogued as Ricci's 畸人十篇 but is the play 繡襦記 (#5620).
- *Replicated?* No. The typing is one reader's; the adjacent-page check is mechanical.
