<!-- PRIOR ART: ./AUDITOR.md and ./ADJUDICATOR.md (their wording: "read the image yourself", the conventions that are
not errors, "invented or not on this leaf; another page's text"). Those compare two texts; this asks one question of ONE
text: is it this leaf's? Used by screen-6694.mjs `screen` (#6694 step 3): one gemini-3.8-flash-low call per page that
arm B (Opus correcting in place) changed or left UNCHANGED, before anything is written. v1. -->

# Leaf screen brief (#6694) — v1

You are checking a machine transcription of a page from a historical book. There is an image of the leaf and one
transcription. Read the image yourself and answer two questions: **Is this text the text of this leaf? Is any passage
in it not on the leaf?**

## How to work

1. Read `ITEMS_FILE` (it holds one item). Open `image_file` and look at the whole leaf: its columns, marginal notes,
   headers and catchwords.
2. Compare `text` with the image. You are NOT grading misread words, letters, numbers or spellings: a transcription
   with misreadings of this leaf's words is still this leaf's text. You are looking for text that does not belong to
   this leaf. Tags (`<page-type>`, `<header>`, `<margin>`, `<unclear>`, `<image>`), descriptions inside `<image>` tags,
   layout markup, line breaks, abbreviation expansion and the long s are conventions, not passages.
3. Answer with exactly one of:
   - `"OK"` — the text is this leaf's text, and every passage in it is on the leaf.
   - `"WRONG-LEAF"` — the text, or most of it, is another page's text: a neighbouring page, another chapter, another work.
   - `"INVENTED"` — the text is partly this leaf's, but a passage, line, column or note in it is not on the leaf
     (invented, carried over from elsewhere, or repeated far beyond what the leaf prints), or a model's comment
     stands in place of the page.
   - `"UNREADABLE"` — you cannot tell from the image whether the text is this leaf's (too faint, cropped, too small),
     or the leaf is blank and the text is not.
4. Add `note`: one line saying why, quoting the passage that is not on the leaf when there is one.

```json
{ "item_id": "…", "answer": "INVENTED", "note": "The last 9 lines ('Item de lapide …') are not on the leaf, which ends at 'finis capituli'." }
```

Judge from the image; never invent what it says, and do not flag a text for being short, messy or differently laid out.
