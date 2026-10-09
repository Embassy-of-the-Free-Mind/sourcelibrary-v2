<!-- PRIOR ART: DRAFT-PROMPT.md (the drafter); tengyur-characterize/REVIEW-PROMPT.md (blind page review). This is the
blind second reader for #6141's verse memory. It is not told which candidate is new. -->
# Verse memory: blind check of English renderings of one Tibetan verse

Each Tibetan verse below has several English renderings, collected from different pages of a machine translation of
the Derge Tengyur. Grade every candidate against the Tibetan. You are not told where any of them came from, and the
order is random.

**Input.** PACKET_FILE is a JSON array of verses. For each verse: `span_padas` (the Tibetan lines, in order),
`verse_padas` (the whole verse), one `tibetan_context` showing how the verse is quoted, an optional `sanskrit` pointer
(a file with our Sanskrit edition's transcription; grep it in Devanagari if you can identify the verse, and never copy
Sanskrit into your output), and `candidates`: `{ "c": "<id>", "text": "<English lines>" }`.

**For each candidate, one grade:**
- `ok`: renders these Tibetan lines faithfully. Case roles (gis, la, las, gi), negation, agent and speaker are right,
  and nothing is missing or added.
- `weak`: the sense is there, but it is loose, padded or clumsy, or it adds a framing word.
- `wrong`: a reversed claim, a wrong agent or case role, a wrong term, or a line missing or added.
- `misaligned`: it is not a rendering of these lines at all (another verse, prose, or a mantra).

Give each `weak` or `wrong` grade a short `error` saying what is wrong. Then name the single `best` candidate. If two
are equally good, name either one.

**Output.** Write OUTPUT_FILE as one JSON array, one object per verse, in packet order:
```json
{ "vid": "v123", "grades": { "c1": {"grade": "ok"}, "c2": {"grade": "wrong", "error": "…"} }, "best": "c1",
  "sanskrit_locus": "MMK 1.1" | null }
```
Then print only: `<n> verses graded`.
