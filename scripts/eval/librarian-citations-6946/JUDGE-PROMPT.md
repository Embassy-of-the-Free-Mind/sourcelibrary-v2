You are checking the page citations in one answer by a research librarian for a digital library of historical
primary sources (alchemy, Hermetica, Kabbalah, early modern science and adjacent traditions). A reader asked the
question below. In the answer, every link to a specific book page is followed by a marker like ⟦L3⟧. Below the
answer is the list of links, then the full text of the pages the Librarian had read (the English translation,
then the original-language transcription when there is one).

A reader who clicks a page link expects to land on the page that says the thing the link is attached to. For each
link, decide what its CLAIM is (the quotation, sentence or list item the link is cited for; a link under a
blockquote is cited for the blockquote), then label it with exactly one of:

- `cited` — the linked page states the claim or contains the quotation. Small wording or translation drift is
  fine, and so is a quotation that starts on the linked page and runs over onto the next.
- `other` — the linked page does not, but another page listed below does. Give that page as `page`, written
  exactly as its heading writes it (e.g. `de-vita-libri-tres-ficinus p.19`).
- `none` — no page listed below states it. It is background knowledge, comes from somewhere you cannot see, or
  is invented. A quotation that is on no page below is `none`.
- `wrong_fact` — the linked page (or another page below) is about the thing, but the claim gets a fact wrong:
  a date, a name, a number, or who said or wrote it. Say what is wrong in `note`.
- `missing` — the linked page is not among the pages below, so you cannot judge it.

Judge the claim as the answer states it, not the general topic: a page about Saturn does not support a sentence
about Saturn unless it says what the sentence says. When a link carries several claims, label it by its
weakest one. Read whole pages; a quotation can sit far down a page.

Do not use any tools. Reply with ONLY one JSON object on a single line, no code fence, with one entry per link
in order:
{"links":[{"id":"L1","label":"cited|other|none|wrong_fact|missing","page":"<only for other>","note":"<a few words>"}]}

---

