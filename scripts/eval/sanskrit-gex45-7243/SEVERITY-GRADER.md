<!-- PRIOR ART: #6740 (Derek, 2026-10-24) defines the 0–4 scale; this is its first grading brief, written for #7243 (PREREG Amendment 1). sevprep.mjs builds the packet this brief points at. -->
You grade OCR outputs of ONE page for the severity of their worst error (#7243, scale from #6740). You do not know which
engine wrote which output, and you must not guess or care. Work only from the files named below; do not search the web.

Packet: {PACKET}  (JSON: the reference path, the image tiles in reading order, and one entry per output with its text
file, line counts, inserted passages, and up to 40 word-level diff spans against the reference)

1. Open the tiles (the page image) and the reference. The reference was made by two careful readers and an adjudicator;
   treat it as correct unless the image clearly shows otherwise. Where the image itself is ambiguous, no output is
   penalised for either reading.
2. For each output (A, B, …), read its diff spans and, where needed, its text file and the image. Find its WORST error:
   - **0 cosmetic**: only spacing, line breaks, punctuation, dandas, digit form (१ vs 1), a visarga typed as a colon, an
     anusvāra written as the class nasal or the reverse, accents, or a footnote marker moved; no word reads differently.
   - **1 recoverable word**: a misread akṣara a Sanskrit/Hindi reader corrects from context (व/ब, a dropped or wrong
     mātrā, a garbled conjunct in an otherwise clear word); also a lost running head, page number, catchword, stamp or
     marginal gloss.
   - **2 meaning changed**: a misread that gives another real word or changes the sense; a wrong verse, sūtra, page or
     table number; a dropped or added word or short phrase (less than a line).
   - **3 structural**: a whole line or more lost or repeated; lines or columns out of order; a loop; a large part of the
     page (a column, the footnotes, the commentary block) missing.
   - **4 misleading**: text that is not on this page at all: a famous text recited or continued from memory, invented
     words, another page's text, a "correction" that silently replaces what the page prints with a standard reading
     over more than a word.
   - **DNR**: did not read (empty, a refusal, a filter notice, text in the wrong script entirely). Not graded.
3. Count the output's distinct errors of grade 2 or more (roughly; an error repeated by one cause counts once).
4. Write ONLY a JSON object to {OUT} with the Write tool:
   {"A": {"grade": 0-4 or "DNR", "worst": "<the worst error, quoted briefly: reference → output>", "n_ge2": <int>}, "B": {...}, ...}
Then reply with one line: the grades, e.g. "A2 B0 C3 D DNR".
