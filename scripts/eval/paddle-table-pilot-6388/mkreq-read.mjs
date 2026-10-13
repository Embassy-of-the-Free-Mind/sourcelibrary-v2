// PRIOR ART: scripts/eval/paddle-table-6388/prompt-ref.json + the bake-off's Opus requests (live default OCR prompt,
// language instruction filled, then the ./page.jpg suffix). Same base here, fetched live; added, per the #6388 ladder:
// a counting-rod line (the bake-off's Opus wrote rods as 一…九), a diagram rule (a drawing returns <image-desc> only),
// and sentinels so the reply parses without guessing.
//
// Usage (cwd = scratch): node --env-file=… mkreq-read.mjs <sample.json> <out.jsonl>   (writes prompt-ref.json too)
import fs from 'node:fs';
import crypto from 'node:crypto';
import { MongoClient } from 'mongodb';

const [, , SAMPLE, OUT] = process.argv;
const c = await MongoClient.connect(process.env.MONGODB_URI);
const p = await c.db('bookstore').collection('prompts').findOne({ type: 'ocr', is_default: true }, { sort: { version: -1 } });
await c.close();
const LANGUAGE_INSTRUCTION = '**Source language:** Detect the primary language from the text. Pages may contain multiple languages — transcribe all of them. Report the primary language in the <language> tag (e.g. <language>Latin</language>).';
const base = p.content.replace('{language_instruction}', LANGUAGE_INSTRUCTION).replace('{language}', '');

export const ADDENDUM = `
**Classical Chinese tables, charts and diagrams (this page may be one):**
- COUNT, do not estimate. Write a repeated cell, character or row exactly as many times as the page prints it. Never write a row or block twice because the page is regular. If you cannot count a run, write the count you can see and add <unclear>count</unclear>.
- Counting-rod numerals (算籌: numbers drawn as vertical and horizontal strokes, e.g. 〡 〢 〣 〤 〥 〦 〧 〨 〩, crosses, T-shapes) are NOT the characters 一 二 三 … 九. Transcribe each rod numeral as printed with the Unicode counting-rod digits (U+1D360–U+1D371: 𝍠𝍡𝍢𝍣𝍤𝍥𝍦𝍧𝍨 units, 𝍩𝍪𝍫𝍬𝍭𝍮𝍯𝍰𝍱 tens) or the Suzhou numerals 〡〢〣〤〥〦〧〨〩 when that is the form printed, and 〇 for an empty place. If you cannot match a mark, write [rod:N] with N the value you read. Never convert a rod numeral to 一…九.
- If the page is a DRAWING (an illustration, a map, a diagram or chart whose text is labels placed inside the drawing, not rows and columns of text), do not transcribe it as body text. Output only an <image-desc> that describes the drawing and lists the labels you can read, each once.
- A table of rows and columns of text is NOT a drawing: transcribe it in reading order (columns right to left, top to bottom), one printed column or row per line.

**Reply format (required).** Reply with exactly these three sentinel lines and nothing outside them:
===LAYOUT=== prose | table | diagram | illustration | mixed
===TRANSCRIPTION===
<the transcription in the format above; for a diagram or illustration, only the metadata tags and the <image-desc>>
===END===`;
const suffix = '\n\nThe page image to transcribe is the file ./page.jpg in the current directory. Open it with the Read tool (that is the only tool you may use), then transcribe it. Output only the three sentinel lines and the transcription between them, with no preamble and no commentary.';
const prompt = `${base}\n${ADDENDUM}${suffix}`;
fs.writeFileSync('prompt-ref.json', JSON.stringify({ id: String(p._id), name: p.name, version: String(p.version ?? ''), hash: p.content_hash ?? null, base_chars: base.length, base_sha256: crypto.createHash('sha256').update(base).digest('hex').slice(0, 16), addendum_sha256: crypto.createHash('sha256').update(ADDENDUM).digest('hex').slice(0, 16), fetched_at: new Date().toISOString() }, null, 1));
const S = JSON.parse(fs.readFileSync(SAMPLE, 'utf8'));
fs.writeFileSync(OUT, S.map((s) => JSON.stringify({ uid: s.uid, image: s.image, prompt })).join('\n') + '\n');
console.log(OUT, S.length, p.name, p.version, prompt.length);
