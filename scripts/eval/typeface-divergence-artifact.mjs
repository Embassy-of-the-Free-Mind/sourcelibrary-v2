#!/usr/bin/env node
/**
 * A reproducible artifact for the typeface-divergence failure: three model tiers
 * transcribing the same historical page and producing three different texts.
 *
 * WHAT IT IS EVIDENCE FOR. `/blog/rashi-ocr` reported that Gemini hallucinates on
 * Rashi script — the printed semi-cursive Hebrew typeface of the Zohar and Talmud
 * — while reading Arabic and Sanskrit fine. The mechanism it proposes is an
 * uncanny valley: Rashi maps to the SAME Unicode as square Hebrew, so the model
 * knows the language but not the letterforms, and generates instead of reading.
 *
 * This script measures that without ground truth, by cross-model containment.
 * Two models do not share a fabrication, so tokens they agree on are tokens the
 * image put there. The design answers the three objections a reader will raise:
 *
 *   "use a bigger model"   → gemini-3.1-pro-preview is included. It fails too.
 *   "non-Latin is just hard" → Arabic and Sanskrit are included as contrast.
 *   "it's the language"    → square-script Hebrew is included as the control,
 *                            so the split is WITHIN Hebrew.
 *
 * THIN OUTPUT IS SCORED AS FAILURE, NOT DROPPED. An earlier version discarded
 * pages where a model emitted almost nothing, which made the worst books — the
 * Zohar among them — appear as absent rows rather than zeros, flattering exactly
 * the cases the artifact exists to document.
 *
 * Emits per-page rows with image URLs so anyone can re-run the same images.
 *
 *   set -a; source .env.production.local; set +a
 *   export GEMINI_API_KEY="$GEMINI_API_KEY_3"     # the default key is dead locally
 *   node scripts/eval/typeface-divergence-artifact.mjs [--pages=4] [--books=6]
 *
 * Cost: 3 model calls per page, one of them pro-class. ~$3-5 for a full run.
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true];
}));
const PAGES_PER_BOOK = parseInt(args.pages || '4');
const BOOKS_PER_GROUP = parseInt(args.books || '6');
const TEMP = 0.1;                       // production setting
const OUT = args.out || 'scripts/output/typeface-divergence';
const KEY = process.env.GEMINI_API_KEY;
const API = 'https://generativelanguage.googleapis.com/v1beta/models';
const MODELS = [
  ['lite', 'gemini-3.1-flash-lite-preview'],
  ['flash', 'gemini-3-flash-preview'],
  ['pro', 'gemini-3.1-pro-preview'],
];
// A model emitting under this many tokens has not transcribed the page. Counted
// as a failure with score 0, never dropped.
const THIN = 12;

// Groups. Hebrew is split by GENRE, which is the available proxy for typeface:
// Kabbalistic and rabbinic works are the corpus printed in Rashi script, Bibles
// and grammars in square script. It is a heuristic — per-book rows are emitted
// so a Hebrew reader can correct the labelling without re-running anything.
const GROUPS = [
  { key: 'hebrew_rabbinic', lang: 'Hebrew', note: 'Kabbalistic / rabbinic — expected Rashi script',
    match: /zohar|rimonim|bahir|midbar|talmud|midrash|kabbal|shelomo|sefer/i },
  { key: 'hebrew_square', lang: 'Hebrew', note: 'Bibles / grammars — expected square script',
    match: /biblia|bible|grammar|lexicon|dictionar|psalm|torah|pentateuch/i },
  { key: 'arabic', lang: 'Arabic', note: 'contrast — distinct script, scored ~100% previously' },
  { key: 'sanskrit', lang: 'Sanskrit', note: 'contrast — distinct script, scored ~98% previously' },
  { key: 'tibetan', lang: 'Tibetan', note: 'second suspected case' },
];

async function gemini(model, parts) {
  for (let a = 1; a <= 4; a++) {
    const res = await fetch(`${API}/${model}:generateContent?key=${KEY}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts }], generationConfig: { temperature: TEMP, maxOutputTokens: 8192 } }),
    });
    if (res.status === 429 || res.status >= 500) { await new Promise(r => setTimeout(r, 3000 * a)); continue; }
    const j = await res.json();
    if (j.error) throw new Error(j.error.message?.slice(0, 80));
    const c = j.candidates?.[0];
    return { text: c?.content?.parts?.map(p => p.text).join('') || '', finish: c?.finishReason || 'NONE' };
  }
  throw new Error('retries exhausted');
}

const strip = t => (t || '')
  .replace(/<(meta|summary|keywords|vocab|language|scan-quality|script|page-type|columns|warning|image-desc)[^>]*>[\s\S]*?<\/\1>/gi, '')
  .replace(/<[^>]+>/g, '').trim();
// Fold conventions that differ between models but denote the same glyph, so a
// spelling preference is never mistaken for a different reading.
const fold = s => s.replace(/ſ/g, 's').replace(/&/g, 'et')
  .replace(/æ/g, 'ae').replace(/œ/g, 'oe').replace(/־/g, ' ')
  .normalize('NFD').replace(/\p{M}+/gu, '');
const SPACELESS = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Khmer}\p{Script=Lao}\p{Script=Myanmar}]/u;
const isSpaceless = t => {
  const L = (t || '').replace(/[^\p{L}]/gu, '').slice(0, 1500);
  if (!L) return false;
  let n = 0; for (const ch of L) if (SPACELESS.test(ch)) n++;
  return n / L.length > 0.3;
};
const toks = (t) => {
  const clean = fold(strip(t).toLowerCase());
  if (isSpaceless(t)) {                       // no word delimiters — character trigrams
    const ch = [...clean.replace(/[^\p{L}]/gu, '')];
    const out = new Set();
    for (let i = 0; i + 3 <= ch.length; i++) out.add(ch.slice(i, i + 3).join(''));
    return out;
  }
  return new Set(clean.split(/[\s་།༎༏,.;:!?()\[\]"'\-—–]+/).filter(x => x.length > 1 && /\p{L}/u.test(x)));
};
// Containment, not Jaccard: Jaccard divides by the union and so collapses merely
// because one model transcribed further down the page than another.
const overlap = (a, b) => {
  const m = Math.min(a.size, b.size);
  return m ? [...a].filter(x => b.has(x)).length / m : null;
};
const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  if (!KEY) { console.error('GEMINI_API_KEY not set'); process.exit(1); }
  fs.mkdirSync(OUT, { recursive: true });
  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 90000, socketTimeoutMS: 600000 });
  await client.connect();
  const db = client.db('bookstore');
  const pd = await db.collection('prompts').findOne({ type: 'ocr', is_default: true }, { sort: { version: -1 } });
  if (!pd?.content) throw new Error('no default OCR prompt in DB');

  const rows = [];
  console.log(`three-tier divergence · temp ${TEMP} · prompt v${pd.version}`);
  console.log(`models: ${MODELS.map(m => m[1]).join(', ')}\n`);

  for (const g of GROUPS) {
    const all = await db.collection('books').find(
      { language: g.lang, pages_ocr: { $gt: 10 }, visible: true },
      { projection: { id: 1, title: 1 } },
    ).limit(120).toArray();
    const books = (g.match ? all.filter(b => g.match.test(b.title || '')) : all).slice(0, BOOKS_PER_GROUP);
    console.log(`── ${g.key}  (${g.note})  ${books.length} books`);
    for (const b of books) {
      const pgs = await db.collection('pages').find(
        { book_id: b.id, 'ocr.data': { $type: 'string' } },
        { projection: { id: 1, page_number: 1, archived_photo: 1, display_photo: 1, photo: 1 } },
      ).skip(4).limit(PAGES_PER_BOOK).toArray();
      const pairScores = [];
      for (const p of pgs) {
        const url = p.archived_photo || p.display_photo || p.photo;
        if (!url) continue;
        let im;
        try { im = Buffer.from(await (await fetch(url)).arrayBuffer()).toString('base64'); }
        catch { continue; }
        const parts = [{ text: pd.content.replace('{language_instruction}', `**Source language:** ${g.lang}.`) },
          { inline_data: { mime_type: 'image/jpeg', data: im } }];
        const out = {};
        for (const [tag, model] of MODELS) {
          try { const r = await gemini(model, parts); out[tag] = { toks: toks(r.text), n: toks(r.text).size, finish: r.finish }; }
          catch (e) { out[tag] = { toks: new Set(), n: 0, finish: 'ERROR:' + e.message.slice(0, 40) }; }
          await sleep(500);
        }
        // Thin output is a FAILURE (0), not an omission.
        const score = (x, y) => {
          if (out[x].n < THIN || out[y].n < THIN) return 0;
          return overlap(out[x].toks, out[y].toks);
        };
        const lf = score('lite', 'flash'), lp = score('lite', 'pro'), fp = score('flash', 'pro');
        const pageMedian = median([lf, lp, fp]);
        pairScores.push(pageMedian);
        rows.push({
          group: g.key, language: g.lang, book: b.title, book_id: b.id,
          page_id: p.id, page_number: p.page_number, image_url: url,
          tokens: { lite: out.lite.n, flash: out.flash.n, pro: out.pro.n },
          finish: { lite: out.lite.finish, flash: out.flash.finish, pro: out.pro.finish },
          thin: [out.lite.n, out.flash.n, out.pro.n].filter(n => n < THIN).length,
          agreement: { lite_flash: lf, lite_pro: lp, flash_pro: fp, median: pageMedian },
        });
      }
      const m = median(pairScores.filter(x => x != null));
      console.log(`   ${(b.title || '?').slice(0, 44).padEnd(46)} n=${String(pairScores.length).padStart(2)}  median agreement ${m == null ? ' n/a' : (100 * m).toFixed(0).padStart(3) + '%'}`);
    }
  }
  await client.close();

  console.log('\n=== GROUP SUMMARY (median of per-page median pairwise agreement) ===');
  const summary = [];
  for (const g of GROUPS) {
    const rs = rows.filter(r => r.group === g.key);
    const m = median(rs.map(r => r.agreement.median).filter(x => x != null));
    const thinPages = rs.filter(r => r.thin > 0).length;
    summary.push({ group: g.key, note: g.note, pages: rs.length, books: new Set(rs.map(r => r.book_id)).size, median_agreement: m, pages_with_thin_model: thinPages });
    console.log(`  ${g.key.padEnd(18)} pages=${String(rs.length).padStart(3)} books=${String(new Set(rs.map(r => r.book_id)).size).padStart(2)}  ` +
      `agreement ${m == null ? ' n/a' : (100 * m).toFixed(0).padStart(3) + '%'}   pages where a model emitted ~nothing: ${thinPages}`);
  }
  const f = path.join(OUT, `divergence-${new Date().toISOString().slice(0, 10)}.json`);
  fs.writeFileSync(f, JSON.stringify({
    date: new Date().toISOString(), temperature: TEMP, prompt_version: pd.version,
    models: Object.fromEntries(MODELS), thin_threshold: THIN,
    metric: 'containment (overlap coefficient) over folded tokens; character trigrams for space-less scripts; thin output scored 0',
    summary, rows,
  }, null, 2));
  console.log(`\n  → ${f}  (${rows.length} per-page rows, each with its image URL)`);
}
main().catch(e => { console.error(e); process.exit(1); });
