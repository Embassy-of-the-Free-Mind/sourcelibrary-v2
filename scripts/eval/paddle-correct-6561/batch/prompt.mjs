// PRIOR ART: scripts/eval/paddle-table-pilot-6388/mkreq-read.mjs (ADDENDUM, suffix) and
// scripts/eval/paddle-correct-6561/mkreq.mjs (draftBlock, the split at "**Reply format"). Both build their prompt
// inline in a script that also needs the pilot's scratch files, so the strings are copied here BYTE FOR BYTE and
// prep.mjs refuses to run unless they hash to results/prompt-ref.json (head_sha, redo_opus_sha).
import crypto from 'node:crypto';

export const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);

export const LANGUAGE_INSTRUCTION = '**Source language:** Detect the primary language from the text. Pages may contain multiple languages — transcribe all of them. Report the primary language in the <language> tag (e.g. <language>Latin</language>).';

// The pilot's ADDENDUM up to (not including) the reply format: prompt = `${base}\n${ADDENDUM}${suffix}`.
export const ADDENDUM_HEAD = `
**Classical Chinese tables, charts and diagrams (this page may be one):**
- COUNT, do not estimate. Write a repeated cell, character or row exactly as many times as the page prints it. Never write a row or block twice because the page is regular. If you cannot count a run, write the count you can see and add <unclear>count</unclear>.
- Counting-rod numerals (算籌: numbers drawn as vertical and horizontal strokes, e.g. 〡 〢 〣 〤 〥 〦 〧 〨 〩, crosses, T-shapes) are NOT the characters 一 二 三 … 九. Transcribe each rod numeral as printed with the Unicode counting-rod digits (U+1D360–U+1D371: 𝍠𝍡𝍢𝍣𝍤𝍥𝍦𝍧𝍨 units, 𝍩𝍪𝍫𝍬𝍭𝍮𝍯𝍰𝍱 tens) or the Suzhou numerals 〡〢〣〤〥〦〧〨〩 when that is the form printed, and 〇 for an empty place. If you cannot match a mark, write [rod:N] with N the value you read. Never convert a rod numeral to 一…九.
- If the page is a DRAWING (an illustration, a map, a diagram or chart whose text is labels placed inside the drawing, not rows and columns of text), do not transcribe it as body text. Output only an <image-desc> that describes the drawing and lists the labels you can read, each once.
- A table of rows and columns of text is NOT a drawing: transcribe it in reading order (columns right to left, top to bottom), one printed column or row per line.
`;

export const FMT = `
**Reply format (required).** Reply with exactly these three sentinel lines and nothing outside them:
===LAYOUT=== prose | table | diagram | illustration | mixed
===TRANSCRIPTION===
<the transcription in the format above; for a diagram or illustration, only the metadata tags and the <image-desc>>
===END===`;

export const OPUS_SUFFIX = '\n\nThe page image to transcribe is the file ./page.jpg in the current directory. Open it with the Read tool (that is the only tool you may use), then transcribe it. Output only the three sentinel lines and the transcription between them, with no preamble and no commentary.';

// mkreq.mjs draftBlock, unchanged (template hash e183e23964a67a12 for an empty draft).
export const draftBlock = (draft) => `
**Draft transcription from another OCR engine.** Below, between ===DRAFT=== and ===END DRAFT===, is a draft transcription of this same page made by a different OCR engine. It may contain misread characters, missing or extra characters, lines out of order or text repeated. The IMAGE is the authority: check the draft against the image column by column, keep what the image confirms, correct what it does not, add what the draft left out, and remove anything the page does not print. Do not change a character that the image supports, even where another character would be more usual. Return the complete corrected transcription in the format described above, not a list of changes.
===DRAFT===
${String(draft).trim()}
===END DRAFT===
`;

export const correctPrompt = ({ head, fmt, suffix }, draft) => head + draftBlock(draft) + fmt + suffix;
