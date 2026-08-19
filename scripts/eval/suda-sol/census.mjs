// Categorical census over all aligned Suda entries with flash-lite. Issue #3884.
// Per PAGE (not per entry): one call judges all entries starting on that page —
// three validated categorical checks only (translation_found, alignment_ok,
// recitation_signal). Verdicts to census-verdicts/page-<n>.json; resumable.
import { MongoClient } from 'mongodb';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

const D = (process.env.SOL_DATA_DIR ?? 'scripts/output/sol-harvest') + '/';
const BOOK = '69a99ce86c7545e2236e12de';
const MODEL = 'gemini-3.1-flash-lite';
const KEY = process.env.GEMINI_API_KEY;
const CONC = 8;
mkdirSync(D + 'census-verdicts', { recursive: true });

const aligned = readFileSync(D + 'aligned.jsonl', 'utf8').trim().split('\n').map(JSON.parse)
  .filter((r) => r.matched && r.bekker_text);
const sol = Object.fromEntries(readFileSync(D + 'sol.jsonl', 'utf8').trim().split('\n')
  .map(JSON.parse).map((r) => [r.adler_id, r]));

// group entries by starting scan page
const byPage = new Map();
for (const r of aligned) {
  const p = r.scan_pages[0];
  if (!byPage.has(p)) byPage.set(p, []);
  byPage.get(p).push(r);
}
console.log('entries:', aligned.length, '| pages:', byPage.size);

// page translations (cache once)
const cachePath = D + 'page-translations.json';
let tr;
if (existsSync(cachePath)) tr = JSON.parse(readFileSync(cachePath, 'utf8'));
else {
  const c = new MongoClient(process.env.MONGODB_URI);
  await c.connect();
  const pages = await c.db('bookstore').collection('pages')
    .find({ book_id: BOOK, page_number: { $in: [...byPage.keys()] } })
    .project({ page_number: 1, 'translation.data': 1 }).toArray();
  await c.close();
  tr = Object.fromEntries(pages.map((p) => [p.page_number, p.translation?.data ?? null]));
  writeFileSync(cachePath, JSON.stringify(tr));
}

const INSTR = `You are checking AI translation records for the Byzantine Suda lexicon. Below: OUR_PAGE_TRANSLATION (AI English translation of one scan page of Bekker's 1854 Greek edition) and a list of ENTRIES, each with: adler_id, bekker_greek (our OCR of that entry from this page), sol_translation (scholar reference translation of the entry the id points to).

For EACH entry answer exactly three categorical questions:
1. translation_found — does OUR_PAGE_TRANSLATION contain a translation of this bekker_greek entry? (It may start near the end of the page and continue beyond it — a clear start counts.)
2. alignment_ok — is bekker_greek the SAME Suda entry as sol_translation describes (same headword and subject)? Extra trailing text from the next entry is fine; a DIFFERENT entry is not.
3. recitation_signal — true ONLY if our English translation of this entry asserts a specific fact (name, number, word) that CONTRADICTS the bekker_greek while matching standard external knowledge. Default false; do not flag style or glosses.

Respond ONLY with a JSON array, one object per entry, same order: [{"adler_id": str, "translation_found": bool, "alignment_ok": bool, "recitation_signal": bool, "note": str|null}] — note only when a flag is raised or answer is uncertain, max 20 words.`;

function prompt(page, entries, trim) {
  const t = tr[page] ?? '(no translation available)';
  const list = entries.map((r) => ({
    adler_id: r.adler_id,
    bekker_greek: trim ? r.bekker_text.slice(0, 1200) : r.bekker_text,
    sol_translation: (sol[r.adler_id]?.translation ?? '').slice(0, trim ? 400 : 900),
  }));
  return `${INSTR}\n\nOUR_PAGE_TRANSLATION (scan page ${page}):\n${trim ? t.slice(0, 9000) : t}\n\nENTRIES:\n${JSON.stringify(list)}`;
}

async function callPage(page, entries, trim = false) {
  const body = {
    contents: [{ parts: [{ text: prompt(page, entries, trim) }] }],
    generationConfig: {
      temperature: 0.1, maxOutputTokens: 8192,
      thinkingConfig: { thinkingBudget: 512 }, responseMimeType: 'application/json',
    },
  };
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  const text = j.candidates?.[0]?.content?.parts?.map((x) => x.text).join('') ?? '';
  if (!text) throw new Error('empty candidate ' + j.candidates?.[0]?.finishReason);
  const arr = JSON.parse(text);
  if (!Array.isArray(arr) || arr.length !== entries.length)
    throw new Error(`shape: got ${Array.isArray(arr) ? arr.length : typeof arr}, want ${entries.length}`);
  return { arr, usage: j.usageMetadata };
}

const pages = [...byPage.keys()].sort((a, b) => a - b)
  .filter((p) => !existsSync(`${D}census-verdicts/page-${p}.json`));
console.log('pages to do:', pages.length);
let done = 0, failed = 0, tokens = { in: 0, out: 0 };
async function worker() {
  while (pages.length) {
    const p = pages.shift();
    const entries = byPage.get(p);
    try {
      let r;
      try { r = await callPage(p, entries); }
      catch (e) { r = await callPage(p, entries, true); }
      writeFileSync(`${D}census-verdicts/page-${p}.json`, JSON.stringify(r.arr));
      tokens.in += r.usage?.promptTokenCount ?? 0;
      tokens.out += r.usage?.candidatesTokenCount ?? 0;
      done++;
      if (done % 50 === 0) console.log(`done ${done}, failed ${failed}, ~$${((tokens.in * 0.1 + tokens.out * 0.4) / 1e6).toFixed(2)}`);
    } catch (e) { failed++; console.log(`FAIL page ${p}: ${e.message}`); }
  }
}
await Promise.all(Array.from({ length: CONC }, worker));
console.log(`DONE: ${done} pages, ${failed} failed, tokens ${JSON.stringify(tokens)} ≈ $${((tokens.in * 0.1 + tokens.out * 0.4) / 1e6).toFixed(2)}`);
