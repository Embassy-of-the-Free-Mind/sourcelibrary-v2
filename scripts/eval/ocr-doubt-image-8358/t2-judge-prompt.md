You are checking an English translation of a historical page against the page image. The image is the only authority.

Open the page image with the Read tool: {IMAGE}

Below are (1) the TRANSCRIPTION the translator was given, (2) the ENGLISH translation, and (3) a numbered list of SPOTS (possibly empty): places where the transcription is known to differ from the page.

First, `page_matches`: does the English render the text of THIS page at all? false only if it is plainly a translation of some other page.

**SPOTS.** For each spot (you are told what the page has and what the transcription has):
1. Find the passage of the English that renders it. Quote it (`english_quote`, at most 25 words, or "" if none).
2. Choose one `outcome`:
   - `carried`: the English follows the transcription's wrong reading (choose this even if a note flags it, as long as the running English follows the misreading).
   - `repaired`: the English renders what the page actually has.
   - `dropped`: the English leaves the passage out.
   - `other`: anything else, with a one-line `reason`.

**OTHER ERRORS.** Read the whole English against the image. List every other place where the English tells a reader something the page does not say: a wrong word, name, number, negation or reference; a sentence or phrase left out; content added that the page does not have. Do not list the spots above, style, word choice that keeps the meaning, or spelling of names when the person is still recognisable. For each: `english_quote` (at most 20 words, or "" for an omission), `page_says` (what the page has, in the original script, at most 15 words), `severity` (`cosmetic`, `misleads` or `wrong_text`), and `source`: `transcription` if the transcription has the same mistake, `translation` if the transcription is right there and the English is not.

**LEAF CLAIMS.** List every statement in the English, including notes and brackets, about what the page or the original physically shows or reads: e.g. "the original reads X", "illegible", "the scan shows", "[damaged]", "the printed text has a misprint", "corrected from the image". For each: `english_quote` and `true_of_page` (true or false, checked against the image) with a one-line `why`. If there are none, give an empty list.

Reply with ONLY a JSON object, no prose before or after it:
{"page_matches":true,"spots":[{"n":1,"english_quote":"...","outcome":"carried","reason":""}],"other_errors":[{"english_quote":"...","page_says":"...","severity":"misleads","source":"translation"}],"leaf_claims":[{"english_quote":"...","true_of_page":false,"why":"..."}]}

=== TRANSCRIPTION ===
{TRANSCRIPTION}

=== ENGLISH ===
{ENGLISH}

=== SPOTS ===
{SPOTS}
