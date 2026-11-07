You are checking a transcription of a historical page against the page image. The image is the only authority.

Open the page image with the Read tool: {IMAGE}

Below are (1) a TRANSCRIPTION of that page, (2) a numbered list of SPOTS and (3) a numbered list of SPANS.

**SPOTS.** Each spot names a place on the page. You are told how the page reads there (as checked earlier against the image) and how another transcription once read it. For each spot:
1. Find that place in the TRANSCRIPTION below and copy what it says there, character for character, into `transcription_quote` (only the corresponding words, at most about 15 words; copy it exactly so it can be searched for). If the transcription leaves the passage out, write "".
2. Look at the image and say whether the transcription matches the page at that spot (`matches_page`: true or false). Ignore conventions: spelling variants, variant characters, long s, u/v and i/j, abbreviation expansion, punctuation and line breaks.
3. If it does not match, copy into `differing_text` the shortest part of your `transcription_quote` that is wrong (exactly as written in the transcription), and into `page_reading` what the page has there. If it matches, leave both "".

**SPANS.** Each span is a short piece of the transcription, shown with a little context; the span itself is between » and «. For each span, look at the image at that place and say whether the transcription matches the page **within the span** (`matches_page`, same conventions as above), and write what the page has there (`page_reading`).

Reply with ONLY a JSON object, no prose before or after it:
{"spots":[{"n":1,"transcription_quote":"...","matches_page":true,"differing_text":"","page_reading":""}],"spans":[{"n":1,"matches_page":true,"page_reading":"..."}]}

=== TRANSCRIPTION ===
{TRANSCRIPTION}

=== SPOTS ===
{SPOTS}

=== SPANS ===
{SPANS}
