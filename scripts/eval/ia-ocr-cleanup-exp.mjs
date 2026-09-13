// PRIOR ART: scripts/eval/ia-ocr-baseline.mjs (IA-vs-ours agreement by script × century; measures
// the Archive's reading, never tries to repair it); scripts/import/ia-ocr-ingest.mjs (the per-book
// gate this experiment sits behind). Nothing in the repo runs a TEXT-ONLY correction pass.
//
// ia-ocr-cleanup-exp — does flash-lite text-only cleanup of the Archive's (ABBYY) OCR move it
// closer to our Gemini image OCR, and what does it cost against re-reading the image?
//
// Result (2026-09-12, 60 pages, 10 books, $0.076): +0.02..+0.09 agreement in every band, no rejected
// band reaches the 0.85 gate; $0.00127/page vs $0.00148 lite-batch image OCR; on unreadable input the
// model INVENTS (an ink-blotted "Toparch" became "Lord of"; 7 of 8 index author names were fabricated).
// Verdict: no cleanup lane — re-read the image. Log entry in EXPERIMENTS.md; rows in results/.
//
// Runs on Hetzner (the laptop is geo-blocked from Gemini): needs the ingester's XML cache and a dry-run
// results file. Override with CACHE=, DRY=, OUT=, MODEL=, PER_BOOK=.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const { withMongo } = await import(path.join(path.dirname(fileURLToPath(import.meta.url)), '../lib/mongo.mjs'));
const CACHE = process.env.CACHE || '/root/sl-ia-cache'; const DRY = process.env.DRY || `${CACHE}/_runs/2026-09-11-en-dry.txt`; const OUT = process.env.OUT || `${CACHE}/_runs/cleanup-exp.jsonl`;
const MODEL = process.env.MODEL || 'gemini-3.1-flash-lite'; const PER_BOOK = +(process.env.PER_BOOK || 6);
const KEY = process.env.GEMINI_API_KEY || Object.entries(process.env).find(([k]) => k.startsWith('GEMINI_API_KEY'))?.[1];
const decode = (s) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
function leafTexts(xml) { const out = []; for (const o of xml.split(/<OBJECT\b/).slice(1)) { const paras = []; for (const p of o.split(/<PARAGRAPH\b/).slice(1)) { const lines = []; for (const l of p.split(/<LINE\b/).slice(1)) { const w = [...l.matchAll(/<WORD[^>]*>([\s\S]*?)<\/WORD>/g)].map((m) => decode(m[1]).trim()).filter(Boolean); if (w.length) lines.push(w.join(' ')); } if (lines.length) paras.push(lines.join('\n')); } out.push(paras.join('\n\n')); } return out; }
const tokens = (s) => (s || '').replace(/<[^>]+>/g, ' ').toLowerCase().match(/[a-z0-9']+/g) || [];
function ratio(a, b) { a = a.slice(0, 600); b = b.slice(0, 600); if (!a.length || !b.length) return 0; const prev = new Uint16Array(b.length + 1), cur = new Uint16Array(b.length + 1); for (let i = 1; i <= a.length; i++) { for (let j = 1; j <= b.length; j++) cur[j] = a[i-1] === b[j-1] ? prev[j-1] + 1 : Math.max(prev[j], cur[j-1]); prev.set(cur); } return (2 * prev[b.length]) / (a.length + b.length); }
const median = (xs) => { const s = [...xs].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const leafIndex = (p) => { const m = String(p.photo || p.archived_photo || '').match(/\/page\/n(\d+)\//); return m ? +m[1] : (p.page_number || 1) - 1; };

// ---- book selection: 2 per band by fillable pages, plus the two long-s probes ----
const lines = fs.readFileSync(DRY, 'utf8').split('\n').map((l) => l.match(/^\s+(ACCEPT|REJECT) (\w+) (\d{0,4}) (.*?) \| agreement median ([0-9.]+) over (\d+) pages.*fillable (\d+)/)).filter(Boolean)
  .map((m) => ({ bid: m[2], year: m[3], title: m[4], med: +m[5], fillable: +m[7] }));
const band = (m) => (m >= 0.9 ? 'A >=0.90' : m >= 0.85 ? 'B 0.85-0.90' : m >= 0.75 ? 'C 0.75-0.85' : m >= 0.6 ? 'D 0.60-0.75' : null);
const picks = []; for (const b of ['A >=0.90', 'B 0.85-0.90', 'C 0.75-0.85', 'D 0.60-0.75']) picks.push(...lines.filter((l) => band(l.med) === b).sort((x, y) => y.fillable - x.fillable).slice(0, 2).map((l) => ({ ...l, band: b })));
picks.push({ bid: '69d14a6c1c2a66dc094b41b2', band: 'E long-s (offset -1)' }, { bid: '69bd93752d11455793b3f2fb', band: 'E long-s (offset -1)' });

async function clean(text, year, title) {
  const prompt = `The text below is OCR output from a printed English book (${title}, ${year}) produced by a conventional OCR engine. Correct OCR errors only: long s read as f (e.g. "fome" -> "some"), broken or merged words, misrecognised letters and punctuation, line-end hyphenation. Keep the original wording, spelling conventions of the period, line breaks and paragraphing. Do not add, remove, modernise or paraphrase anything. Return only the corrected text.\n\n${text}`;
  const body = { contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0, maxOutputTokens: 4000, thinkingConfig: { thinkingBudget: 0 } } };
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`);
  const j = await r.json(); const u = j.usageMetadata || {};
  return { text: (j.candidates?.[0]?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text).join(''), inTok: u.promptTokenCount || 0, outTok: u.candidatesTokenCount || 0, thought: u.thoughtsTokenCount || 0 };
}

fs.writeFileSync(OUT, '');
let inTok = 0, outTok = 0, thought = 0; const agg = {};
await withMongo(async (db) => {
  for (const pk of picks) {
    const b = await db.collection('books').findOne({ id: pk.bid }, { projection: { title: 1, published: 1, ia_identifier: 1, image_source: 1, pages_count: 1 } });
    const ia = b?.ia_identifier || b?.image_source?.identifier; const f = `${CACHE}/${ia}_djvu.xml`; if (!fs.existsSync(f)) { console.log(pk.bid, 'no xml'); continue; }
    const leaves = leafTexts(fs.readFileSync(f, 'utf8')); const leafTok = leaves.map(tokens);
    const pages = await db.collection('pages').find({ book_id: pk.bid, 'ocr.data': { $nin: [null, ''] }, 'ocr.source': { $ne: 'ia_djvu' } }, { projection: { id: 1, page_number: 1, photo: 1, archived_photo: 1, display_photo: 1, 'ocr.data': 1 } }).sort({ page_number: 1 }).toArray();
    const votes = {}; const refs = [];
    for (const p of pages) { const tt = tokens(p.ocr.data); if (tt.length < 20) continue; const k = leafIndex(p); let best = null; for (let d = -3; d <= 3; d++) { const j = k + d; if (j < 0 || j >= leaves.length || leafTok[j].length < 20) continue; const r = ratio(tt, leafTok[j]); if (!best || r > best.r) best = { d, r }; } if (best) { votes[best.d] = (votes[best.d] || 0) + 1; refs.push({ p, k, tt }); } }
    if (!refs.length) { console.log(`${pk.band} | ${pk.bid} | no reference pages`); continue; }
    const offset = +Object.entries(votes).sort((x, y) => y[1] - x[1])[0][0];
    const interior = refs.filter(({ p, k }) => p.page_number > 3 &&k + offset >= 0 && k + offset < leaves.length && leafTok[k + offset].length >= 20);
    const step = Math.max(1, Math.floor(interior.length / PER_BOOK)); const sample = interior.filter((_, i) => i % step === 0).slice(0, PER_BOOK);
    const rows = [];
    for (const { p, k, tt } of sample) {
      const iaText = leaves[k + offset]; const before = ratio(tt, tokens(iaText));
      let c; try { c = await clean(iaText, String(b.published || '').slice(0, 4), b.title); } catch (e) { console.log('  gemini error', e.message); continue; }
      inTok += c.inTok; outTok += c.outTok; thought += c.thought;
      const after = ratio(tt, tokens(c.text)); const lenRatio = tokens(c.text).length / Math.max(1, tokens(iaText).length);
      const row = { band: pk.band, bid: pk.bid, year: String(b.published || '').slice(0, 4), title: (b.title || '').slice(0, 60), page_id: p.id, page_number: p.page_number, leaf: k + offset, offset, before: +before.toFixed(3), after: +after.toFixed(3), len_ratio: +lenRatio.toFixed(2), image: p.display_photo || p.photo, ia: iaText.slice(0, 1500), cleaned: c.text.slice(0, 1500), gemini: p.ocr.data.slice(0, 1500) };
      rows.push(row); fs.appendFileSync(OUT, JSON.stringify(row) + '\n');
    }
    if (!rows.length) { console.log(`${pk.band} | ${pk.bid} | no sample`); continue; }
    const mb = median(rows.map((r) => r.before)), ma = median(rows.map((r) => r.after));
    (agg[pk.band] ||= []).push(...rows);
    console.log(`${pk.band} | ${pk.bid} ${String(b.published || '').slice(0, 4)} ${(b.title || '').slice(0, 40)} | n=${rows.length} offset ${offset} | IA->Gemini ${mb.toFixed(3)} -> cleaned->Gemini ${ma.toFixed(3)} | len ${median(rows.map((r) => r.len_ratio)).toFixed(2)}`);
  }
});
console.log('\nBAND SUMMARY (median before -> after, n pages)');
for (const [k, rows] of Object.entries(agg)) console.log(`  ${k}: ${median(rows.map((r) => r.before)).toFixed(3)} -> ${median(rows.map((r) => r.after)).toFixed(3)}  (n=${rows.length}; improved ${rows.filter((r) => r.after > r.before + 0.01).length}, worse ${rows.filter((r) => r.after < r.before - 0.01).length})`);
const n = Object.values(agg).flat().length; const cost = (inTok * 0.25 + (outTok + thought) * 1.5) / 1e6;
console.log(`TOKENS in ${inTok} out ${outTok} thought ${thought} | cost $${cost.toFixed(4)} | per page $${(cost / Math.max(1, n)).toFixed(5)} | model ${MODEL}`);
