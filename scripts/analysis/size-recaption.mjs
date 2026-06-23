#!/usr/bin/env node
/**
 * size-recaption.mjs
 *
 * Sizing tool for a bulk re-caption run (#2707 / #2533-adjacent). Decides how
 * big — and how expensive — a paid re-caption would actually be, BEFORE spending.
 *
 * The free word-overlap detector (detect-caption-page-mismatch.mjs) is a noisy
 * proxy: it flags vocabulary mismatches that aren't real subject errors, and
 * misses some that are. So this tool layers a CHEAP LLM judge (flash-lite,
 * text-only — no image) on a SAMPLE to estimate the detector's true precision
 * (flagged that are really wrong) and miss rate (clean that are really wrong),
 * then extrapolates the corpus-wide true-error count and the cost of two
 * strategies:
 *   A) re-caption every flagged image (simple, over-captions)
 *   B) judge-gate the whole corpus, re-caption only confirmed-wrong (cheapest
 *      vision spend; adds a small judge pass over the corpus)
 *
 * Only the SAMPLE judge calls cost money here (~M+K flash-lite calls, ~cents).
 * The corpus-wide numbers are projections.
 *
 * Usage:
 *   node scripts/analysis/size-recaption.mjs [--sample 1500] [--judge-flagged 60]
 *        [--judge-clean 30] [--threshold 0.12] [--call-cost 0.0004] [--judge-cost 0.00003]
 */
import { MongoClient } from 'mongodb';
import { GoogleGenerativeAI } from '@google/generative-ai';

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const SAMPLE = parseInt(arg('--sample', '1500'), 10);
const JUDGE_FLAGGED = parseInt(arg('--judge-flagged', '60'), 10);
const JUDGE_CLEAN = parseInt(arg('--judge-clean', '30'), 10);
const THRESH = parseFloat(arg('--threshold', '0.12'));
const CALL_COST = parseFloat(arg('--call-cost', '0.0004'));   // $/re-caption vision call (gemini-3-flash-preview)
const JUDGE_COST = parseFloat(arg('--judge-cost', '0.00003')); // $/judge call (flash-lite, text-only)
const JUDGE_MODEL = 'gemini-3.1-flash-lite';

// --- detector tokenisation (same shape as detect-caption-page-mismatch.mjs) ---
const STOP = new Set(['the','this','these','those','that','with','from','into','among','around','toward','towards','and','or','but','for','its','his','her','their','they','are','was','were','has','have','had','been','being','depicts','depicting','shows','showing','shown','illustration','illustrates','illustrating','image','scene','figure','figures','large','small','vibrant','colorful','colourful','detailed','striking','manuscript','miniature','painting','woodcut','engraving','emblem','portrait','frontispiece','illumination','plate','print','left','right','center','centre','top','bottom','above','below','upper','lower','side','background','foreground','wearing','holding','seated','standing','sitting','dressed','adorned','featuring','appears','appear','identified','page','book','text','script','inscription','inscriptions','style','traditional','royal','men','man','woman','women','people','group','three','four','five','two','one','who','which','where','while','when','also','such','here','there','some','many','other','another','within']);
const toks = (s) => new Set((String(s || '').toLowerCase().match(/[a-zà-ÿ]+/g) || []).filter(w => w.length >= 4 && !STOP.has(w)));
const overlap = (a, b) => { a = toks(a); b = toks(b); if (!a.size || !b.size) return null; let i = 0; for (const w of a) if (b.has(w)) i++; return i / Math.min(a.size, b.size); };
const imgDescRx = /<image-desc[^>]*>([\s\S]*?)<\/image-desc>/i;

const judge = new GoogleGenerativeAI(process.env.GEMINI_API_KEY).getGenerativeModel({
  model: JUDGE_MODEL,
  generationConfig: { temperature: 0, maxOutputTokens: 256, responseMimeType: 'application/json' },
});

// Returns true if the gallery caption MISIDENTIFIES the subject vs the page text.
async function judgeWrong(imgDesc, museum) {
  const prompt = `You are auditing a museum caption for a historical book illustration.

PAGE DESCRIPTION (transcribed by an OCR pass that read the whole page, including any caption/label beside the picture — treat as the more reliable account of WHAT the picture shows):
"""${imgDesc.slice(0, 900)}"""

DISPLAYED CAPTION (written by a separate vision pass that did NOT read the page):
"""${(museum || '').slice(0, 900)}"""

Question: does the DISPLAYED CAPTION misidentify the SUBJECT — name a different person, figure, or scene than the page description supports (e.g. calls wrestlers "gymnosophists", or names "Alexander" where the page labels "Ptolemy")? Ignore differences in wording, richness, or added art-historical context; judge ONLY whether the named subject conflicts.
Return JSON: {"subject_wrong": true|false, "reason": "<=12 words"}`;
  try {
    const r = await judge.generateContent(prompt);
    const o = JSON.parse(r.response.text());
    return { wrong: !!o.subject_wrong, reason: o.reason || '' };
  } catch { return null; }
}

async function judgeSample(rows, n) {
  const pick = rows.slice(0, n);
  let wrong = 0, judged = 0; const egs = [];
  for (let i = 0; i < pick.length; i += 6) {
    const res = await Promise.all(pick.slice(i, i + 6).map(r => judgeWrong(r.idesc, r.museum)));
    res.forEach((v, k) => { if (!v) return; judged++; if (v.wrong) { wrong++; if (egs.length < 4) egs.push({ ...pick[i + k], reason: v.reason }); } });
  }
  return { wrong, judged, egs };
}

(async () => {
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const db = c.db('bookstore');

  const comparableTotal = await db.collection('gallery_images').countDocuments({ museum_description: { $type: 'string' } });

  // Sample → join page <image-desc> → split flagged / clean
  const imgs = await db.collection('gallery_images').aggregate([
    { $match: { museum_description: { $type: 'string' } } },
    { $sample: { size: SAMPLE } },
    { $project: { page_id: 1, book_title: 1, page_number: 1, book_id: 1, museum_description: 1 } },
  ]).toArray();
  const pageIds = [...new Set(imgs.map(i => i.page_id).filter(Boolean))];
  const pdesc = new Map();
  for (let i = 0; i < pageIds.length; i += 2000) {
    const ps = await db.collection('pages').find({ id: { $in: pageIds.slice(i, i + 2000) } }, { projection: { id: 1, 'ocr.data': 1, 'translation.data': 1 } }).toArray();
    for (const p of ps) { const m = (p.ocr?.data || '').match(imgDescRx) || (p.translation?.data || '').match(imgDescRx); pdesc.set(p.id, m ? m[1] : null); }
  }

  const flagged = [], clean = [];
  let comparable = 0;
  for (const im of imgs) {
    const d = pdesc.get(im.page_id); if (!d) continue;
    const ov = overlap(im.museum_description, d); if (ov == null) continue;
    comparable++;
    const row = { idesc: d, museum: im.museum_description, book: im.book_title, page: im.page_number, ov, url: `https://sourcelibrary.org/book/${im.book_id}/page/${im.page_id}` };
    (ov < THRESH ? flagged : clean).push(row);
  }
  const flaggedRate = flagged.length / (comparable || 1);

  console.log(`\n=== re-caption sizing ===`);
  console.log(`comparable gallery images (corpus): ${comparableTotal.toLocaleString()}`);
  console.log(`sample: ${comparable} comparable | flagged ${flagged.length} (${(100 * flaggedRate).toFixed(1)}%) | clean ${clean.length}`);

  // Shuffle-ish (sample is already random); judge precision on flagged + miss-rate on clean
  console.log(`\njudging ${Math.min(JUDGE_FLAGGED, flagged.length)} flagged + ${Math.min(JUDGE_CLEAN, clean.length)} clean with ${JUDGE_MODEL}…`);
  const jf = await judgeSample(flagged, JUDGE_FLAGGED);
  const jc = await judgeSample(clean, JUDGE_CLEAN);
  const precision = jf.judged ? jf.wrong / jf.judged : 0;   // P(really wrong | flagged)
  const missRate = jc.judged ? jc.wrong / jc.judged : 0;    // P(really wrong | clean)

  console.log(`  flagged judged ${jf.judged}: really-wrong ${jf.wrong}  → detector precision ${(100 * precision).toFixed(0)}%`);
  console.log(`  clean   judged ${jc.judged}: really-wrong ${jc.wrong}  → miss rate ${(100 * missRate).toFixed(0)}%`);

  const estFlaggedTotal = Math.round(comparableTotal * flaggedRate);
  const estTrueErrors = Math.round(comparableTotal * (flaggedRate * precision + (1 - flaggedRate) * missRate));

  console.log(`\n--- projection (corpus = ${comparableTotal.toLocaleString()} comparable images) ---`);
  console.log(`estimated flagged total      : ~${estFlaggedTotal.toLocaleString()}`);
  console.log(`estimated TRUE subject errors : ~${estTrueErrors.toLocaleString()}  (precision-adjusted, + clean misses)`);

  const judgeCorpusCost = comparableTotal * JUDGE_COST;
  const recaptFlaggedCost = estFlaggedTotal * CALL_COST;
  const recaptTrueCost = estTrueErrors * CALL_COST;

  console.log(`\n--- cost (call $${CALL_COST} re-caption vision, $${JUDGE_COST} judge) ---`);
  console.log(`A) re-caption ALL flagged        : ~$${recaptFlaggedCost.toFixed(2)}  (re-captions ~${(100*precision).toFixed(0)}% real, rest already-fine)`);
  console.log(`B) judge whole corpus, then`);
  console.log(`   re-caption confirmed-wrong    : ~$${(judgeCorpusCost + recaptTrueCost).toFixed(2)}  ($${judgeCorpusCost.toFixed(2)} judge + $${recaptTrueCost.toFixed(2)} re-caption)`);
  console.log(`   → B catches clean-but-wrong that A misses, and avoids re-captioning ${(100*(1-precision)).toFixed(0)}% false flags`);

  const sampleJudgeCost = (jf.judged + jc.judged) * JUDGE_COST;
  console.log(`\nthis sizing run spent ~$${sampleJudgeCost.toFixed(4)} (${jf.judged + jc.judged} judge calls).`);

  const egs = [...jf.egs];
  if (egs.length) {
    console.log(`\n--- judge-confirmed subject errors (examples) ---`);
    for (const e of egs) {
      console.log(`\n[${e.book}] p${e.page}  — ${e.reason}`);
      console.log(`  page : ${e.idesc.replace(/\s+/g, ' ').slice(0, 120)}`);
      console.log(`  caption: ${e.museum.replace(/\s+/g, ' ').slice(0, 120)}`);
      console.log(`  ${e.url}`);
    }
  }
  await c.close();
})().catch(e => { console.error(e); process.exit(1); });
