You are checking how a translation handles some spots in a transcription of a historical page. Work from the page image: it is the only authority.

Open the page image with the Read tool: {IMAGE}

Below are (1) the stored transcription of that page, (2) the English translation that was made from that transcription, and (3) a numbered list of SPOTS: short strings quoted from the transcription. Some spots may be misread on the transcription and some may be correct. You are not told which. Decide from the image.

For each spot:
1. Find it on the image and write what the page actually says there (`image_reading`, in the original script). Say whether the transcription matches the image at that spot (`transcription_matches_image`: true or false). Ignore conventions: spelling variants, variant characters, long s, u/v, abbreviation expansion, and punctuation.
2. Find the passage of the English that renders this spot. Quote it (`english_quote`, at most 25 words, or "" if there is none).
3. Choose one `outcome`:
   - `carried`: the English renders the transcription's reading where it differs from the image (a misread came through). Choose this even if a translator's note flags it, as long as the running English follows the misread.
   - `repaired`: the transcription differs from the image, but the English renders what the page actually says.
   - `dropped`: the English leaves the passage out.
   - `not_an_error`: the transcription matches the image at this spot, so there is nothing to carry or repair.
   - `other`: anything else, with a one-line `reason`.
4. Give `severity`: what a reader of the English loses at this spot. Use `none` (the English is right), `cosmetic` (wrong, but the meaning is intact), `misleads` (a reader takes away a different meaning, name, number or reference), or `wrong_text` (the English says something the page does not say at all, or a passage is missing).
5. Add `note` if a translator's <note> or gloss mentions the spot, and say what it says.

Reply with ONLY a JSON object, no prose before or after it:
{"spots":[{"n":1,"image_reading":"...","transcription_matches_image":false,"english_quote":"...","outcome":"carried","severity":"misleads","note":"","reason":""}]}

=== TRANSCRIPTION ===
{TRANSCRIPTION}

=== ENGLISH ===
{ENGLISH}

=== SPOTS ===
{SPOTS}
