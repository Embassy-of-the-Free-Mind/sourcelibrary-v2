#!/usr/bin/env node
/**
 * Acceptance run for OCR prompt v17 (#4195 checklist + #4584).
 *
 * Runs v15 (current default) and v17 side by side over the exemplars the issues
 * name, so each claim is checked against the page that produced it rather than
 * a page chosen to flatter the change. Two of the cases are counter-examples
 * that must NOT change — a prompt that only ever declines is not an improvement.
 *
 * Usage: node --env-file=.env.production.local scripts/eval/ocr-prompt-v17-acceptance.mjs
 */
import { MongoClient } from 'mongodb';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const KEY = process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY_2;
if (!KEY) throw new Error('no GEMINI_API_KEY');
const MODEL = 'gemini-3.1-flash-lite';
const LANG_INSTR = `**Source language:** Detect the primary language from the text. Pages may contain multiple languages — transcribe all of them. Report the primary language in the <language> tag (e.g. <language>Latin</language>).`;

const BULHAN = '6953b56577f38f6761bd979d';   // Kitab al-Bulhan — #3591 exemplars
const ZUNI = '69a565b95a8a09c1b325e47f';     // Zuni Fetiches — #4149 blank leaves
const URK4 = '69e013c593b116d24238b3d7';     // Urkunden IV — #4584 fabrication

const CASES = [
  { label: '#3591 torn mansion grid',   book: BULHAN, page: 60,  expect: 'lacuna, and NOT 14 complete mansion names' },
  { label: '#3591 legible basmala',     book: BULHAN, page: 266, expect: 'NOT blank — real text transcribed' },
  { label: '#3591 cataloguer note',     book: BULHAN, page: 197, expect: 'NOT blank' },
  { label: '#3591 li-l-muallif',        book: BULHAN, page: 4,   expect: 'NOT blank' },
  { label: '#3591 cipher counter-ex',   book: BULHAN, page: 198, expect: 'must STILL decline (counter-example)' },
  { label: '#4149 blank leaf',          book: ZUNI,   page: 45,  expect: 'page-type blank, no body/header/sig/page-num' },
  { label: '#4149 blank leaf',          book: ZUNI,   page: 72,  expect: 'page-type blank, no body' },
  { label: '#4149 ordinary prose',      book: ZUNI,   page: 30,  expect: 'normal transcription (counter-example)' },
  { label: '#4584 hieroglyph block',    book: URK4,   page: 24,  expect: 'lacuna, no invented x+N lines' },
  { label: '#4584 ordinary apparatus',  book: URK4,   page: 118, expect: 'German apparatus kept; no Ra-loop' },
];

const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db('bookstore');
const col = db.collection('prompts');
const prep = (s) => s.replace('{language_instruction}', LANG_INSTR).replace('{language}', '');
const v15 = prep((await col.findOne({ type: 'ocr', version: 15 })).content);
const v17 = prep((await col.findOne({ type: 'ocr', version: 17 })).content);

async function gemini(promptText, b64) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(`${BASE}/models/${MODEL}:generateContent?key=${KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: promptText }, { inlineData: { mimeType: 'image/jpeg', data: b64 } }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 8192, thinkingConfig: { thinkingBudget: 0 } },
      }),
      signal: AbortSignal.timeout(180000),
    });
    const j = await r.json();
    if (r.ok) return j.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '(empty)';
    if (r.status === 429 || r.status >= 500) { await new Promise((s) => setTimeout(s, 4000 * (attempt + 1))); continue; }
    return `ERROR ${r.status} ${JSON.stringify(j).slice(0, 160)}`;
  }
  return 'ERROR exhausted retries';
}

const tag = (t, name) => (t.match(new RegExp(`<${name}>`, 'gi')) || []).length;
const pageType = (t) => (t.match(/<page-type>([^<]*)<\/page-type>/i) || [, '—'])[1];
// body = what survives once metadata/apparatus tags are gone; the thing a reader would read
const bodyLen = (t) => t
  .replace(/<(meta|summary|keywords|vocab|language|lang|scan-quality|script|page-type|columns|warning|image-desc|lacuna|header|sig|page-num)>[\s\S]*?<\/\1>/gi, ' ')
  .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().length;

const ONLY = process.env.ONLY ? process.env.ONLY.split(',').map(Number) : null;
const RUN = ONLY ? CASES.filter((t) => ONLY.includes(t.page)) : CASES;
console.log(`model=${MODEL}  cases=${RUN.length}\n`);
for (const t of RUN) {
  const p = await db.collection('pages').findOne({ book_id: t.book, page_number: t.page });
  if (!p) { console.log(`!! ${t.label} p.${t.page}: page not found`); continue; }
  const url = p.display_photo || p.photo;
  let b64;
  try {
    const res = await fetch(url);
    if (!res.ok) { console.log(`!! ${t.label} p.${t.page}: image HTTP ${res.status}`); continue; }
    b64 = Buffer.from(await res.arrayBuffer()).toString('base64');
  } catch (e) { console.log(`!! ${t.label} p.${t.page}: image fetch failed ${e.message}`); continue; }

  const a = await gemini(v15, b64);
  const b = await gemini(v17, b64);
  console.log(`── ${t.label} (p.${t.page}) — expect: ${t.expect}`);
  console.log(`   v15  type=${pageType(a).padEnd(12)} body=${String(bodyLen(a)).padStart(5)}  unclear=${tag(a, 'unclear')} lacuna=${tag(a, 'lacuna')} warning=${tag(a, 'warning')}`);
  console.log(`   v17  type=${pageType(b).padEnd(12)} body=${String(bodyLen(b)).padStart(5)}  unclear=${tag(b, 'unclear')} lacuna=${tag(b, 'lacuna')} warning=${tag(b, 'warning')}`);
  const snippet = b.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 150);
  console.log(`   v17 text: ${snippet || '(none)'}\n`);
}
await c.close();
