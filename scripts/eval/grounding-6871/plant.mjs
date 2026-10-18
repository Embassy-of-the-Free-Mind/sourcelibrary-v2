#!/usr/bin/env node
/**
 * plant.mjs — 40 planted controls for #6871 row A: stored reads Opus judged clean, with fluent wrong text swapped in.
 *
 * PRIOR ART: scripts/eval/results/opus-ocr-calibration-6559/build-packet.mjs.txt (3 hand-planted errors in Opus reads,
 * for a judge) and the #6561 anchoring plants (look-alike Han substitutions where Paddle and the leaf agree). Neither
 * plants FLUENT wrong words — the detector's target — nor records character offsets for a span scorer.
 *
 *   node --env-file=.env.production.local scripts/eval/grounding-6871/plant.mjs <items-real.jsonl> <plants.jsonl>
 *
 * Draw (seed 6871): pages with n_errors = 0 and >= 500 cleaned characters; per language latin 18, german 8, greek 6,
 * chinese 5 (all the clean Chinese pool yields), arabic 2, hebrew 2; alternately
 *   word:     gemini-3.1-flash-lite (the one paid model; thinking off) proposes 3 replacements that are real words of
 *             the page's language, fit the sentence, and change its meaning; each is applied at its own occurrence;
 *   sentence: one sentence (40–260 chars) from another page of the same book (|Δpage| 2–12, read-only from `pages`)
 *             replaces a sentence of similar length in the middle of the page.
 * Each plant is an item with plant: 'word'|'sentence' and spans = the swapped-in text. Nothing is written to any store.
 */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
import { callGemini } from '../../lib/gemini-script-client.mjs';

const [src, dst] = process.argv.slice(2);
const QUOTA = { latin: 18, german: 8, greek: 6, chinese: 5, arabic: 2, hebrew: 2 };   // sums to 41: Chinese yields 4–5 of its 14 clean pages, so 40 land at least (41 did)
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rnd = mulberry32(6871);
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const clean = (t) => (t || '').normalize('NFC').replace(/<detected-images>[\s\S]*?(<\/detected-images>|$)/g, '').replace(/<vocab>[\s\S]*?(<\/vocab>|$)/g, '').trim().slice(0, 8000);
const sentences = (t, zh) => {
  const out = []; const re = zh ? /[^。；！？\n]{12,60}[。；！？]/g : /[^.;:!?\n]{40,260}[.;:!?]/g; let m;
  while ((m = re.exec(t))) out.push({ s: m.index, e: m.index + m[0].length, text: m[0] });
  return out.filter((x) => !/[<>]/.test(x.text));
};

const items = fs.readFileSync(src, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const pool = shuffle(items.filter((r) => r.n_errors === 0 && r.text.length >= 500).sort((a, b) => a.page_id.localeCompare(b.page_id)));
const cli = await MongoClient.connect(process.env.MONGODB_URI); const db = cli.db('bookstore');
const out = []; const cost = { in: 0, out: 0, calls: 0 }; const used = {};
let flip = 0;
for (const r of pool) {
  if ((used[r.group] || 0) >= (QUOTA[r.group] || 0)) continue;
  const zh = r.group === 'chinese'; const kind = flip % 2 === 0 ? 'word' : 'sentence';
  let text = r.text, spans = [];
  if (kind === 'word') {
    const prompt = `Below is a transcription of one printed page (language: ${r.language}). Pick exactly 3 ${zh ? 'two-character words' : 'words of at least 4 letters'} from the running body text, far apart from each other. For each, give a REPLACEMENT that is a real ${zh ? 'Classical Chinese word of the same length' : 'word of the same language and spelling conventions'}, fits the grammar and sense of its sentence so a reader would not notice, but is NOT what the page says (a different meaning, not a spelling variant). Reply with JSON only: [{"original": "...", "replacement": "...", "before": "<the 10 characters just before the original word, copied exactly>"}]\n\nPAGE:\n${text}`;
    const g = await callGemini({ model: 'gemini-3.1-flash-lite', prompt, endpoint: 'scripts/eval/grounding-6871/plant.mjs', type: 'eval', maxOutputTokens: 600, pageIds: [r.page_id], promptVersion: 'plant-6871-v1' });
    cost.in += g.inputTokens; cost.out += g.outputTokens; cost.calls++;
    let props = []; try { props = JSON.parse(g.text.replace(/^```(json)?|```$/gm, '').trim()); } catch { props = []; }
    for (const p of props) {
      if (!p?.original || !p?.replacement || p.original === p.replacement) continue;
      let at = p.before ? text.indexOf(p.before + p.original) : -1;
      at = at >= 0 ? at + p.before.length : text.indexOf(p.original);
      if (at < 0 || spans.some((s) => Math.abs(s.s - at) < 30)) continue;
      const d = p.replacement.length - p.original.length;
      text = text.slice(0, at) + p.replacement + text.slice(at + p.original.length);
      spans = spans.map((s) => (s.s > at ? { ...s, s: s.s + d, e: s.e + d } : s));
      spans.push({ s: at, e: at + p.replacement.length, kind: 'plant_word', quote: `${p.original}→${p.replacement}` });
    }
    if (spans.length < 2) continue;
  } else {
    const others = await db.collection('pages').find({ book_id: r.book_id, 'ocr.data': { $exists: true, $ne: '' } }, { projection: { page_number: 1, 'ocr.data': 1 } }).toArray();
    const me = items.find((x) => x.page_id === r.page_id);
    const mine = sentences(text, zh).filter((x) => x.s > text.length * 0.2 && x.e < text.length * 0.85);
    const donor = shuffle(others.filter((o) => o.id !== r.page_id && o._id.toString() !== r.page_id)).find((o) => sentences(clean(o.ocr.data), zh).length >= 3);
    if (!donor || !mine.length || !me) continue;
    const target = mine[Math.floor(rnd() * mine.length)];
    const cands = sentences(clean(donor.ocr.data), zh).filter((x) => Math.abs(x.text.length - target.text.length) <= target.text.length * 0.5 && !text.includes(x.text.trim()));
    if (!cands.length) continue;
    const ins = cands[Math.floor(rnd() * cands.length)].text;
    text = text.slice(0, target.s) + ins + text.slice(target.e);
    spans = [{ s: target.s, e: target.s + ins.length, kind: 'plant_sentence', quote: `donor p${donor.page_number}` }];
  }
  used[r.group] = (used[r.group] || 0) + 1; flip++;
  out.push({ ...r, item: `${r.page_id}__plant`, text, spans, masks: [], plant: kind, n_errors: 0 });
}
await cli.close();
fs.writeFileSync(dst, out.map((x) => JSON.stringify(x)).join('\n') + '\n');
// gemini-3.1-flash-lite: $0.25 / 1M input, $1.50 / 1M output (scripts/lib/model-pricing.mjs)
console.log(JSON.stringify({ plants: out.length, by: used, word: out.filter((x) => x.plant === 'word').length, ...cost, usd: +(cost.in * 0.25e-6 + cost.out * 1.5e-6).toFixed(4) }));
