# Subagent vs flash-lite on the same 20 books — 2026-08-17

Twenty independent Claude subagents, one book each, no shared context and no
knowledge of what anyone expected. Each read one book's OCR'd front matter and
returned an author, a role, and a quoted line. Scored against the hand
adjudication in `titlepage-hand-adjudication-2026-08-17.md`.

|                          | right | wrong | unscored (held) | score |
|---|---|---|---|---|
| **Claude subagents**     | 16    | 2     | 2               | **89%** |
| gemini-3.1-flash-lite    | 10    | 8     | 2               | 56% |

The gap is entirely in one place: **the eight books where the correct answer is
that NOBODY is named as author.** flash-lite proposed a person on all eight. The
subagents returned null on six of them, each with the right role attached:

| book | flash-lite proposed | subagent verdict |
|---|---|---|
| Gebet-Buechlein 1806 | Lydia Seidel (author) | null — **owner**, later hand, dated 1841 |
| Greek Symphonia 1546 | Sebastianus Castalio | null — **translator**, ablative after *interprete* |
| Der Signatstern 1803 | Stark | null — **subject**, the man whose system the book prints |
| Tractatus de alchimia | Isaac | null — a component tract inside a catalogue list |
| Theatrum Mundi 1588 | Petrus Albinus | null — **editor**, wrote the preface; the French original is explicitly anonymous |
| Catalogus librorum prohibitorum 1758 | Voltaire | null — **subject**, an entry in the banned-book list |

Every one of those is a relationship judgement, not a reading problem, which is
exactly where the flash-lite residue sat.

## The two misses are labelling disputes, not reading errors

- **Alphabetische naamlyst** — subagent returned "J. A. D." from the signed
  preface and noted the signer says he compiled the work. That reading is right;
  my verdict was that bare initials are not a usable byline. A disagreement about
  what to store, not about what the page says.
- **Bibliotheca ... Wittwero** — subagent returned null, calling it an anonymous
  auction catalogue OF the deceased Wittwer's library, preface signed only
  "Editor". I had accepted Wittwer on cataloguing convention. **The subagent's
  reading is arguably better than mine** and I am recording it as a miss only
  because my table said otherwise.

## What the subagents volunteered that nothing asked for

- Flagged *Die Lehren der Rosenkreuzer* as a **Sammelband** — Madathanus wrote
  the *Aureum Seculum Redivivum* bound inside it, not necessarily the collection
  the catalogue names.
- Flagged *Verae Alchemiae* as an edited anthology where **compiler is the truer
  role than author**, quoting Gratarolo's own "à me concinnatum".
- Identified *Duplex confessio Valdensium* (one of my two holds) as a composite
  volume whose opening item is itself anonymous — the exact distinction I had
  parked as needing a specialist.
- Noted book 18's window contains **bound-together title pages from different
  catalogues**, including a 1733 Jena auction catalogue — the bound-with problem,
  spotted unprompted.

## Cost shape

~55K subscription tokens per book, ~1.1M for the twenty. That is roughly two
orders of magnitude more expensive per book than flash-lite's ~1,700 tokens, and
it is not an API spend — it draws on the subscription, so it does not scale to
3,905 books the way a paid batch does.

The read: **flash-lite for coverage, subagents for adjudication.** Run the cheap
pass to find candidates, and spend subagents on the rows where a relationship
judgement is actually at stake — which is precisely the queue this whole pilot
was trying to produce.
