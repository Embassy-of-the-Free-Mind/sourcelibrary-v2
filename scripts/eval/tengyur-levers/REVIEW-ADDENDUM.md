# Addendum to the #5829 review prompt, for #6121

PRIOR ART: `scripts/eval/tengyur-characterize/REVIEW-PROMPT.md` is used VERBATIM (the part after its
`---`); this text is appended after it, unchanged for every subagent. It adds one field, `span`, because
the context arm's known cost is a wrong page span (#5704: 15 of 113 wrong-span pages with neighbouring
pages in the request). Nothing else in the rubric changes.

---

**One more field per item: `span`.** Besides the errors, say whether the English covers exactly this side:
- `ok`: it translates this side, from its first words to its last (finishing or leaving open a sentence
  that crosses a side boundary is still `ok`, as above).
- `extra`: it also translates Tibetan that is NOT on this side, for example a sentence or passage from the
  previous side (compare `previous_side_last_line`) or from further back, or from the next side, beyond
  merely finishing the sentence that crosses the boundary.
- `short`: it stops clearly before the side ends, or skips the side's opening, so that a passage of
  several lines at either end is not translated.

Add `"span": "ok" | "extra" | "short"` to each item's object, and when it is not `ok`, a
`"span_why"` of one sentence naming the passage. Report the extra or missing passage under `span` only,
not also as an `addition` or `omission` error.
