#!/usr/bin/env node
/**
 * Build an OCR-difficulty taxonomy from the corpus, WITH concrete examples.
 *
 * Difficulty is defined behaviourally, not by opinion: a page is hard when the
 * SAME model running the SAME prompt over the SAME leaf twice produced different
 * text (#3473). That population is 63,572 pairs, already collected, free.
 *
 * Categories come from the model's own <warning> tag, written at OCR time. Each
 * category reports its rate in the unstable arm against a stable control arm
 * drawn the same way, so a category earns its place by LIFT, not by sounding
 * plausible — and every category carries real page examples with URLs.
 *
 * CAVEAT, load-bearing: the <warning> tag is written by the same model whose
 * instability defines the arms, so the two channels are not independent. A model
 * having trouble may be likelier to say so. Read the lifts as corroboration
 * across channels, not as external validation.
 *
 *   set -a; source .env.production.local; set +a
 *   node scripts/eval/ocr-difficulty-taxonomy.mjs <corpus.jsonl> [--per-arm=900] [--examples=3]
 */
import { MongoClient } from 'mongodb';
import fs from 'fs';
import path from 'path';
import readline from 'readline';

const argv = process.argv.slice(2);
const JSONL = argv.find(a => !a.startsWith('--'));
const args = Object.fromEntries(argv.filter(a => a.startsWith('--')).map(a => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true];
}));
const PER_ARM = parseInt(args['per-arm'] || '900');
const N_EX = parseInt(args.examples || '3');
const SITE = 'https://sourcelibrary.org';
const DATE = new Date().toISOString().slice(0, 10);

// Ordered most-general first; a page can match several.
const FEATURES = [
  ['handwriting / manuscript hand', /handwrit|manuscript|cursive|scribal|hand-?written/i,
    'A hand rather than type. Letterforms vary within a page, so two passes segment strokes differently.'],
  ['mixed script or language', /mixed (script|language)|greek|hebrew|arabic|multiple (script|language)|cyrillic|syriac/i,
    'More than one script on one page. Each switch is a decision point, and the passes need not switch at the same word.'],
  ['bleed-through from the verso', /bleed|show[- ]?through|verso|reverse side|ghost/i,
    'Ink from the other side reads as faint text. Whether a pass transcribes it is a judgement call, so it flips between runs.'],
  ['marginalia and annotation', /marginal|annotat|underlin|gloss in the margin|note in the margin/i,
    'Printed text plus later hands. What counts as the page is genuinely ambiguous.'],
  ['abbreviation and ligature', /abbreviat|ligature|long s|contraction|tilde|brevigraph/i,
    'Scribal and early-print contractions. Expanding or preserving them is a policy choice made per run.'],
  ['faded or faint ink', /fade|faint|light print|worn|weak impression/i,
    'Low contrast against the paper — the classic legibility case, and rarer than expected.'],
  ['stain, foxing, damage', /stain|fox|spot|damage|tear|torn|hole|worm|water/i,
    'Physical loss or obscuring of the substrate.'],
  ['complex layout', /column|table|tabular|brace|outline|diagram/i,
    'Columns, tables, braced outlines. Reading ORDER is underdetermined, so the same words come out in different sequences.'],
  ['illegible or obscured', /illegible|obscur|unreadable|cannot be read|indecipher/i,
    'The model says outright it could not read part of the page.'],
  ['symbols', /alchemic|astronom|symbol|sigil|zodiac|planetary sign/i,
    'Alchemical, astronomical and metrological signs with no stable transcription convention.'],
  ['dark, contrast, glare', /glare|shadow|dark|contrast|overexpos|underexpos/i, 'Capture-side exposure problems.'],
  ['cropped or cut off', /crop|cut[- ]off|cut off|clip|trimmed|missing edge|outside the (image|frame)/i,
    'Text runs past the edge of the image. Half a word invites two different guesses.'],
  ['skew, curvature, gutter', /skew|curv|gutter|warp|slant|tilt|binding/i, 'Geometry: the page is not flat or not square to the sensor.'],
  ['blur or focus', /blur|out of focus|unfocus|smudg/i, 'Capture-side focus problems.'],
  ['microfilm or bitonal', /microfilm|microfiche|bitonal|halftone|moir/i,
    'Digitised from film, or thresholded to 1-bit — strokes are lost before OCR ever runs.'],
];

const tag = (t, name) => {
  const m = (t || '').match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? m[1].trim() : null;
};

async function main() {
  const unstable = [], stable = [];
  const rl = readline.createInterface({ input: fs.createReadStream(JSONL) });
  for await (const line of rl) {
    const x = JSON.parse(line);
    if (x.eligibility !== 'eligible' || x.leaf_shift !== false) continue;
    if (!x.prior_model || x.prior_model !== x.current_model) continue;
    if (!x.prior_prompt || x.prior_prompt !== x.current_prompt) continue;
    if (x.prior_degenerate || x.current_degenerate || x.prior_refusal || x.current_refusal
      || x.prior_meta || x.current_meta || x.near_zero_overlap) continue;
    (x.agreement_primary < 0.85 ? unstable : x.agreement_primary >= 0.97 ? stable : []).push?.(x);
  }
  // Even stride rather than head — the JSONL is ordered by page_id, so the first
  // N rows are a handful of books rather than a cross-section.
  const stride = (a, n) => { const o = []; const s = Math.max(1, Math.floor(a.length / n)); for (let i = 0; i < a.length && o.length < n; i += s) o.push(a[i]); return o; };
  const U = stride(unstable, PER_ARM), S = stride(stable, PER_ARM);
  console.log(`true-repeat population: ${unstable.length.toLocaleString()} unstable, ${stable.length.toLocaleString()} stable`);

  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const db = c.db('bookstore');
  const hydrate = async rows => {
    const out = [];
    for (let i = 0; i < rows.length; i += 300) {
      const chunk = rows.slice(i, i + 300);
      const ps = await db.collection('pages').find({ id: { $in: chunk.map(r => r.page_id) } },
        { projection: { id: 1, 'ocr.data': 1, display_photo: 1, archived_photo: 1, photo: 1 } }).maxTimeMS(120000).toArray();
      const m = new Map(ps.map(p => [p.id, p]));
      for (const r of chunk) { const p = m.get(r.page_id); if (p) out.push({ ...r, text: p.ocr?.data || '', img: p.display_photo || p.archived_photo || p.photo }); }
    }
    return out;
  };
  const UH = await hydrate(U), SH = await hydrate(S);
  await c.close();

  // FIRST CUT WAS WRONG, and the correction is the finding. Running all 15
  // regexes over the same warning string counted "Handwritten Greek minuscule
  // script" as handwriting AND mixed-script AND abbreviation, manufacturing a
  // taxonomy out of one sentence. 95% of warning-bearing unstable pages mention
  // a hand, so the population splits on manuscript-vs-print before anything else
  // and the secondary features are only interpretable WITHIN print.
  const HAND = /handwrit|manuscript|cursive|scribal|hand-?written|minuscule|kurrent|textualis|chancery|secretary hand/i;
  const isHand = r => { const w = tag(r.text, 'warning'); return !!(w && HAND.test(w)); };
  const rate = (rows, re) => rows.filter(r => { const w = tag(r.text, 'warning'); return w && re.test(w); }).length;
  const cats = FEATURES.map(([name, re, why]) => {
    const u = rate(UH, re), s = rate(SH, re);
    const examples = UH.filter(r => { const w = tag(r.text, 'warning'); return w && re.test(w); })
      .slice(0, N_EX).map(r => ({
        book: r.book_slug, language: r.language, year: r.year, page_number: r.page_number,
        agreement: r.agreement_primary,
        reader_url: r.book_slug ? `${SITE}/book/${r.book_slug}/page/${r.page_id}` : null,
        image_url: r.img,
        scan_quality: tag(r.text, 'scan-quality'),
        warning: (tag(r.text, 'warning') || '').replace(/\s+/g, ' ').slice(0, 260),
      }));
    return { name, why, unstable_pct: +(100 * u / UH.length).toFixed(1), stable_pct: +(100 * s / SH.length).toFixed(1),
      lift: s ? +(u / s).toFixed(1) : (u ? null : 0), examples };
  }).sort((a, b) => b.unstable_pct - a.unstable_pct);

  // Secondary features computed on PRINTED pages only — on a manuscript page
  // every co-occurring flag is downstream of the hand.
  const UP = UH.filter(r => !isHand(r)), SP = SH.filter(r => !isHand(r));
  const printCats = FEATURES.filter(([n]) => !/handwriting/.test(n)).map(([name, re, why]) => {
    const u = rate(UP, re), s = rate(SP, re);
    return { name, why, unstable_pct: +(100 * u / UP.length).toFixed(2), stable_pct: +(100 * s / SP.length).toFixed(2),
      lift: s ? +(u / s).toFixed(1) : (u ? null : 0), n_unstable: u,
      examples: UP.filter(r => { const w = tag(r.text, 'warning'); return w && re.test(w); }).slice(0, N_EX).map(r => ({
        book: r.book_slug, page_number: r.page_number, agreement: r.agreement_primary,
        reader_url: r.book_slug ? `${SITE}/book/${r.book_slug}/page/${r.page_id}` : null, image_url: r.img,
        warning: (tag(r.text, 'warning') || '').replace(/\s+/g, ' ').slice(0, 260) })) };
  }).sort((a, b) => b.unstable_pct - a.unstable_pct);

  const warnU = UH.filter(r => tag(r.text, 'warning')).length, warnS = SH.filter(r => tag(r.text, 'warning')).length;
  const sq = rows => { const o = {}; for (const r of rows) { const q = tag(r.text, 'scan-quality'); if (q) o[q.toLowerCase()] = (o[q.toLowerCase()] || 0) + 1; } return o; };

  const out = { date: DATE, source: path.basename(JSONL),
    population: { unstable_total: unstable.length, stable_total: stable.length, sampled_per_arm: UH.length },
    warning_rate: { unstable: +(100 * warnU / UH.length).toFixed(1), stable: +(100 * warnS / SH.length).toFixed(1) },
    scan_quality: { unstable: sq(UH), stable: sq(SH) },
    caveat: 'The <warning> tag is written by the same model whose run-to-run instability defines the arms. The channels are not independent; read lifts as corroboration, not external validation.',
    manuscript_split: {
      note: '95% of warning-bearing unstable pages name a hand. Treat manuscript-vs-print as the primary axis; the flat category list double-counts one sentence across several regexes.',
      unstable_manuscript_pct: +(100 * UH.filter(isHand).length / UH.length).toFixed(1),
      stable_manuscript_pct: +(100 * SH.filter(isHand).length / SH.length).toFixed(1),
      printed_unstable_n: UP.length, printed_stable_n: SP.length,
    },
    categories_all: cats,
    categories_printed_only: printCats };
  const dir = path.join('scripts', 'eval', 'results');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `ocr-difficulty-taxonomy-${DATE}.json`), JSON.stringify(out, null, 1));
  console.log(`\n→ scripts/eval/results/ocr-difficulty-taxonomy-${DATE}.json`);
  console.log(`\nPRIMARY AXIS — manuscript hand: ${(100 * UH.filter(isHand).length / UH.length).toFixed(1)}% of unstable vs ${(100 * SH.filter(isHand).length / SH.length).toFixed(1)}% of stable`);
  console.log(`\nSECONDARY, on PRINTED pages only (unstable n=${UP.length}, stable n=${SP.length}):`);
  for (const c of printCats) console.log(`  ${String(c.unstable_pct).padStart(5)}%  vs ${String(c.stable_pct).padStart(5)}%  ${c.lift == null ? '  —  ' : (c.lift + 'x').padStart(6)}  ${c.name}  (n=${c.n_unstable})`);
}
main().catch(e => { console.error(e); process.exit(1); });
