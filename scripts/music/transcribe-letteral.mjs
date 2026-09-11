#!/usr/bin/env node
/**
 * Read Shaker letteral notation off a page image with a vision model and emit
 * ABC — a MEASUREMENT run, scored by eval-transcription.mjs against the
 * verified references in ground-truth/. Writes nothing to Mongo.
 *
 * PRIOR ART: scripts/music/seed-shaker-transcriptions.mjs — hand-written seed
 * rows, no model call. The July 2026 batch (issue #3161, 79 drafts) was a
 * scratch script that never entered the repo; its two engineering failures
 * (thinking-token starvation of maxOutputTokens, chain-of-thought leaking into
 * the answer) are what the explicit thinkingConfig + fenced-ABC extraction
 * below are for. Spec: .claude/docs/shaker-letteral-notation.md and the book's
 * own preface (pages iv–v of the 1852 Sacred Repository).
 *
 * For every `kind:"reference"` manifest entry with notation_system "letteral"
 * (or the ids given with --id), fetches the page image from R2, asks the model
 * for the span the manifest names, and appends one line to --out:
 *   {id, page_id, page_number, image, model, candidate_abc, reference_abc,
 *    medium_note, usage:{prompt,candidates,thoughts,total}, raw}
 * — exactly the batch shape eval-transcription.mjs --batch reads.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/music/transcribe-letteral.mjs \
 *     --out scripts/music/eval-results/<date>-letteral-<model>/runs.jsonl \
 *     [--model gemini-3-flash-preview] [--thinking 2048] [--id <manifest id> ...] [--dry-run]
 * Then:
 *   node scripts/music/eval-transcription.mjs --batch <runs.jsonl> > results.jsonl
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI } from '@google/genai';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GT = path.join(__dirname, 'ground-truth');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const flag = (k) => args.includes(k);
const MODEL = opt('--model', 'gemini-3-flash-preview');
const THINKING = Number(opt('--thinking', '2048'));
const OUT = opt('--out');
const IDS = args.flatMap((a, i) => (a === '--id' ? [args[i + 1]] : []));
const DRY = flag('--dry-run');
if (!OUT && !DRY) { console.error('--out <runs.jsonl> is required'); process.exit(1); }

const manifest = JSON.parse(fs.readFileSync(path.join(GT, 'manifest.json'), 'utf8'));
const refs = manifest.items.filter((x) => x.kind === 'reference' && x.file && x.notation_system === 'letteral' && (!IDS.length || IDS.includes(x.id)));
if (!refs.length) { console.error('no letteral references matched'); process.exit(1); }

const RULES = `You are reading Shaker "small letteral" music notation from an 1852 printed hymnal (the Sacred Repository of Anthems and Hymns, Canterbury, N.H.). Transcribe it to ABC notation. The book's own preface gives these rules:

PITCH is a printed letter a–g. There is no staff.
OCTAVE is the letter's ROW. The music of each line is set on up to three rows. "The intermediate or medium note occupies EXCLUSIVELY the middle row" — so the row that holds only one letter (repeated) is the medium row, and that letter is the medium note. Letters on the row above it are the nearest pitches ABOVE the medium; letters on the row below are the nearest pitches BELOW it. (Example from the preface: medium g, with "a c" printed on the row above = the a and c just above g; a second row above would be the next octave up.) When a line uses only two rows, decide which is the medium row by the one-letter rule, not by absolute position.
DURATION is the letter's typography:
  - CAPITAL letter = semibreve (whole note)
  - a short vertical bar printed against the letter (before it, "|c", or after it, "d|") = minim (half note). Do not confuse this short bar with the tall barlines that span all rows.
  - plain lowercase = crotchet (quarter note)
  - ONE underline dash = quaver (eighth). A single dash may run under a GROUP of adjacent letters — every letter above it is an eighth. When the group mixes rows, the dash is printed at the level of the lowest member and still covers all of them.
  - TWO underline dashes (=) = semiquaver (sixteenth)
  - a dot printed after a letter = dotted (×1.5)
A curved arc over two or more letters = slur (they share one syllable). Tall vertical lines through the rows are barlines; a column of dots at a barline is a repeat mark. The digit at the head of the tune (3, 4 …) is the "mode" (tempo/meter class) — ignore it. A short low dash printed AFTER a letter (e.g. "c·_") is an unexplained mark — ignore it and keep the letter's printed value.

OUTPUT: one ABC tune, in a \`\`\`abc fenced block, with headers X:1, T:, M:none, L:1/8, K:C. Write the medium note as the ABC pitch of that letter in the octave C–B (medium c → C, medium g → G, medium e → E); letters on the row above become the nearest higher pitches (e.g. medium g: a→A, c→c), letters on the row below the nearest lower ones (e.g. medium c: g→G, and b→B,). Half = 4, quarter = 2, eighth = 1, sixteenth = /, dotted quarter = 3. Use ( ) for slurs and | for every barline; write repeat marks as || (never :| or |:). Put the lyrics on a w: line, one syllable per note, - between syllables of a word and _ for a slurred continuation. Transcribe ONLY the span requested. Do not add notes that are not printed; do not skip any that are.`;

const prompt = (r) => `${RULES}

PAGE: page ${r.page_number} of the book. PIECE: "${r.title.replace(/ \((opening|first page)\)$/i, '')}". SPAN: ${r.span || 'everything of this piece printed on this page'}. Other pieces or verses printed on the same page are NOT wanted.

Reply with the fenced ABC only.`;

const KEY = process.env.GEMINI_API_KEY;
if (!KEY && !DRY) { console.error('GEMINI_API_KEY not set'); process.exit(1); }
const ai = KEY ? new GoogleGenAI({ apiKey: KEY }) : null;

const extractAbc = (text) => {
  const m = text.match(/```(?:abc)?\s*\n([\s\S]*?)```/);
  const body = (m ? m[1] : text).trim();
  // the eval plays repeats; keep the candidate on the same footing as the references
  return body.replace(/:\|/g, '|').replace(/\|:/g, '|');
};

for (const r of refs) {
  const image = `https://images.sourcelibrary.org/archived/${r.book_id}/${r.page_number}.jpg`;
  const reference_abc = fs.readFileSync(path.join(GT, r.file), 'utf8').trim();
  if (DRY) { console.log(`[dry-run] ${r.id} ← ${image}\n${prompt(r).slice(0, 400)}…\n`); continue; }
  const res = await fetch(image, { headers: { 'User-Agent': 'sourcelibrary-music-eval/1.0' } });
  if (!res.ok) { console.error(`${r.id}: image ${res.status}`); continue; }
  const data = Buffer.from(await res.arrayBuffer()).toString('base64');
  let raw = '', usage = {}, err = null;
  for (let a = 0; a < 3; a++) {
    try {
      const g = await ai.models.generateContent({
        model: MODEL,
        contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'image/jpeg', data } }, { text: prompt(r) }] }],
        config: { temperature: 0, maxOutputTokens: 4096 + THINKING, thinkingConfig: { thinkingBudget: THINKING } },
      });
      raw = g.text || '';
      const u = g.usageMetadata || {};
      usage = { prompt: u.promptTokenCount ?? null, candidates: u.candidatesTokenCount ?? null, thoughts: u.thoughtsTokenCount ?? null, total: u.totalTokenCount ?? null };
      err = null;
      break;
    } catch (e) {
      err = String(e.message || e).slice(0, 200);
      await new Promise((s) => setTimeout(s, 2000 * (a + 1)));
    }
  }
  const candidate_abc = err ? '' : extractAbc(raw);
  const row = { id: r.id, page_id: r.page_id, page_number: r.page_number, image, model: MODEL, thinking_budget: THINKING, date: new Date().toISOString(), candidate_abc, reference_abc, medium_note: r.medium_note, usage, error: err, raw };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.appendFileSync(OUT, JSON.stringify(row) + '\n');
  console.log(`${r.id}: ${err ? 'ERROR ' + err : `${candidate_abc.split('\n').length} lines, tokens prompt=${usage.prompt} out=${usage.candidates} thoughts=${usage.thoughts}`}`);
}
