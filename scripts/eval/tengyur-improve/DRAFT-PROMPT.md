<!-- PRIOR ART: tengyur-characterize/REVIEW-PROMPT.md (a blind page reviewer; it scores, it does not write English).
This is the drafter brief for #6141's verse memory: one reference English rendering per recurring Tibetan verse. -->
# Verse memory: draft one reference rendering per verse

You are drafting the reference English for Tibetan verses that are quoted again and again across the Derge Tengyur.
Each quotation was machine-translated on its own page, so the same verse now reads differently, and sometimes wrongly,
from page to page. Your rendering may replace the verse lines on those pages. The prose around them stays unchanged.

**Input.** PACKET_FILE is a JSON array of verses. For each verse you get:
- `span_padas`: the Tibetan lines (pādas) to render, in order. `verse_padas` is the whole verse they belong to.
- `renderings`: the stored English of this span on up to 24 pages. Each has the page's Tibetan around it
  (`tibetan_context`), the English around it, and the `rendering` itself. The line-matching that found these is
  automatic and sometimes WRONG: the `rendering` may be the English of a different verse on the same page.
- `sanskrit` (some verses): the work this verse belongs to and a file holding our Sanskrit edition's transcription,
  with page markers. Grep it (Devanagari) to find the verse when you can identify it.

**For each verse:**
1. Read the Tibetan span and the whole verse. Use `tibetan_context` to see how the verse is quoted.
2. If `sanskrit` is given, try to find the verse in the file. Record the page URL from the nearest `=== … ===` marker
   and the locus (e.g. "MMK 1.1"). Do NOT copy any Sanskrit into your output. Use it only to check the sense of the
   Tibetan. Where the Sanskrit and the Tibetan differ, render the TIBETAN, because the page translates the Tibetan.
3. Mark every rendering that is NOT an English rendering of this span (`misaligned`: its `r` numbers). A
   rendering is aligned if it renders these Tibetan lines, however badly.
4. Write the reference rendering:
   - **Exactly one English line per Tibetan pāda in `span_padas`, in the same order.** Move words between lines
     only where English syntax forces it. Keep the line count exact.
   - It must be faithful to the Tibetan: case roles (gis, la, las, gi), negation and the speaker must be right.
   - Use the register of the stored renderings: plain modern English, no brackets, no notes, no markup, no Sanskrit
     in parentheses. Use the deity, person and technical names the aligned renderings already use, where they are
     right.
   - Make it fit every quotation, since it will stand on all of these pages. Leave out any framing word that belongs
     to one page's prose (like "thus" or "it is said").
   - If the aligned renderings contradict each other, decide from the Tibetan, and say why in `why` (one sentence).
5. Grade each aligned rendering against the Tibetan: `ok` (faithful), `weak` (loose or clumsy, but not wrong), or
   `wrong` (a reversed claim, a wrong agent or case role, a wrong term, or a line missing or added).

**Output.** Write OUTPUT_FILE as one JSON array, one object per verse, in packet order:
```json
{ "vid": "v123", "reference": ["line for pāda 1", "line for pāda 2"], "sanskrit_locus": "MMK 1.1" | null,
  "sanskrit_page_url": "…" | null, "misaligned": [3, 7], "grades": {"1": "ok", "2": "wrong", …},
  "why": "one sentence on the hard choice, if any", "confidence": "high" | "medium" | "low" }
```
If you cannot render a verse with confidence (a corrupt line, a mantra), still write the object with
`"confidence": "low"`. Then print only: `<n> verses, <k> low confidence`.
