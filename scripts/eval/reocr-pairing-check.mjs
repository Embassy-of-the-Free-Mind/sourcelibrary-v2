#!/usr/bin/env node
/**
 * Is a page's stored OCR text actually a reading of the image now sitting under
 * it? (#3473)
 *
 * Every instrument tried so far answers this indirectly and badly:
 *   - the printed `<page-num>` is transcribed by the model under test (circular),
 *     absent on 39% of ocr rows and 98% of translation rows, and blind to a
 *     UNIFORM shift, which is the exact failure it was built for;
 *   - `page_revisions.source` says how a row was PRODUCED, not whether the text
 *     and the image correspond;
 *   - `archive_metadata.archived_at > ocr.updated_at` fires on 29.5% of pages,
 *     but a re-archive that re-fetches an IDENTICAL image moves that timestamp
 *     too, so it cannot separate a real change from a no-op refetch.
 *
 * THE DIRECT TEST: read the current image again and compare to the stored text.
 * It works because the two populations are two orders of magnitude apart —
 * measured 2026-08-02 over the whole corpus, pairs that read the same leaf agree
 * at mean 0.82 (median 0.973), while pairs holding two different pages' text
 * agree at mean 0.032 (median 0.025). There is no ambiguous middle to argue
 * about: ~0.9 means correctly paired, ~0.05 means the text belongs to another
 * leaf.
 *
 * DESIGN — two arms, because a rate with no control means nothing:
 *   SUSPECT  archive_metadata.archived_at  >  ocr.updated_at   (image re-archived
 *            after the text was written — the population under suspicion)
 *   CONTROL  archive_metadata.archived_at <=  ocr.updated_at
 * Both arms get an IDENTICAL prompt, model and temperature, AND are
 * frequency-matched on language, so any difference between them is attributable
 * to the image and not to the harness or the material. The absolute
 * agreement level may sit below the 0.973 corpus median if the stored text used
 * an older prompt; that shifts both arms equally and is recorded per page
 * (`prompt_matched`, `model_matched`) so it can be checked rather than assumed.
 *
 * Temperature is 0.1 — PRODUCTION. At 0 the model is a deterministic fixed point
 * and a repeat measures nothing, which is how an earlier eval produced a
 * spurious perfect result (handoff 2026-07-30).
 *
 * *** THIS SCRIPT WRITES NOTHING. *** No `pages` update, no `page_revisions`
 * row, no job record. It reads Mongo, calls Gemini, and writes ONE local JSON
 * file. A re-OCR that saved would overwrite live reader-facing text and mint
 * revisions that future corpus runs would mistake for real re-readings — the
 * exact contamination this whole investigation exists to unpick.
 *
 * COST: ~$0.00079/page. 500 pages ≈ $0.40. Prints the estimate and requires
 * --apply to spend anything.
 *
 *   set -a; source .env.production.local; set +a
 *   node scripts/eval/reocr-pairing-check.mjs --n=500            # dry run, no spend
 *   node scripts/eval/reocr-pairing-check.mjs --n=500 --apply
 */
import { MongoClient } from 'mongodb';
import fs from 'fs';
import path from 'path';
import { agreementPrimary, scriptClassOf } from './lib/metrics.mjs';
import { getPageSource } from '../lib/page-image-url.mjs';

const args = Object.fromEntries(process.argv.slice(2).filter(a => a.startsWith('--')).map(a => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true];
}));
const N = parseInt(args.n || '500');              // total across BOTH arms
const APPLY = !!args.apply;
const CONC = parseInt(args.concurrency || '4');
const MODEL = args.model || 'gemini-3.1-flash-lite';
const COST_PER_PAGE = 0.00079;
const OUT = args.out || `scripts/eval/results/reocr-pairing-${new Date().toISOString().slice(0, 10)}.json`;

const GEMINI_KEY = process.env.GEMINI_API_KEY_TIER3 || process.env.GEMINI_API_KEY_2 || process.env.GEMINI_API_KEY;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36';

async function ocrOnce(imageUrl, prompt) {
  const img = await fetch(imageUrl, { headers: { 'user-agent': UA } });
  if (!img.ok) return { error: `image HTTP ${img.status}` };
  const b64 = Buffer.from(await img.arrayBuffer()).toString('base64');
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_KEY}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: 'image/jpeg', data: b64 } }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 8192 },
      }),
    },
  );
  if (!res.ok) return { error: `gemini HTTP ${res.status}` };
  const j = await res.json();
  const text = j?.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
  // A 200 with an empty candidate is a known deterministic failure on long
  // prompts — record it as an error, never as a disagreement.
  if (!text.trim()) return { error: 'empty candidate' };
  return { text, usage: j?.usageMetadata || null };
}

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI missing');
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  const prompt = await db.collection('prompts').findOne(
    { type: 'ocr', is_default: true }, { sort: { version: -1 } },
  );
  if (!prompt?.content) throw new Error('no default OCR prompt in the prompts collection');
  console.log(`prompt: ${prompt.name} v${prompt.version}`);

  // Plain $sample — a $match before $sample on `pages` is a full collection scan
  // and does not finish. Filter in JS instead.
  const pool = await db.collection('pages').aggregate([
    { $sample: { size: Math.max(6000, N * 12) } },
    { $project: { id: 1, book_id: 1, page_number: 1, archive_metadata: 1, ocr: 1, archived_photo: 1, photo_original: 1, display_photo: 1, photo: 1, crop: 1 } },
  ], { allowDiskUse: true }).toArray();

  // Candidate pool, unmatched.
  const cand = { suspect: [], control: [] };
  for (const p of pool) {
    const stored = p.ocr?.data;
    const at = p.archive_metadata?.archived_at, up = p.ocr?.updated_at;
    if (typeof stored !== 'string' || stored.trim().length < 200) continue;
    if (!at || !up) continue;
    if (!getPageSource(p)) continue;
    cand[new Date(at) > new Date(up) ? 'suspect' : 'control'].push(p);
  }

  // FREQUENCY-MATCH THE ARMS ON LANGUAGE. Without this the comparison is void:
  // the first run of this script drew a suspect arm that was 76% Tibetan against
  // a 7% control, because the May-2026 re-archiving campaign targeted the
  // Tibetan collections. "Re-archived after OCR" was then very nearly a proxy
  // for "is a Tibetan manuscript", and the arm gap measured script difficulty
  // rather than image churn.
  const bookIds = [...new Set([...cand.suspect, ...cand.control].map(p => p.book_id).filter(Boolean))];
  const books = await db.collection('books').find(
    { $or: [{ id: { $in: bookIds } }, { _id: { $in: bookIds } }] },
    { projection: { id: 1, language: 1 } },
  ).toArray();
  const langOf = new Map();
  for (const b of books) for (const k of [b.id, String(b._id)]) if (k) langOf.set(k, b.language || 'unknown');
  for (const p of [...cand.suspect, ...cand.control]) p.__language = langOf.get(p.book_id) || 'unknown';

  const byLang = arm => {
    const m = new Map();
    for (const p of cand[arm]) { const k = p.__language; if (!m.has(k)) m.set(k, []); m.get(k).push(p); }
    return m;
  };
  const sMap = byLang('suspect'), cMap = byLang('control');
  const perArm = Math.floor(N / 2);
  const arms = { suspect: [], control: [] };
  // Take equal counts per language, largest shared languages first.
  const shared = [...sMap.keys()].filter(k => cMap.has(k))
    .sort((a, b) => Math.min(cMap.get(b).length, sMap.get(b).length) - Math.min(cMap.get(a).length, sMap.get(a).length));
  for (const lang of shared) {
    if (arms.suspect.length >= perArm) break;
    const take = Math.min(sMap.get(lang).length, cMap.get(lang).length, perArm - arms.suspect.length);
    arms.suspect.push(...sMap.get(lang).slice(0, take));
    arms.control.push(...cMap.get(lang).slice(0, take));
  }
  const dist = a => [...a.reduce((m, p) => m.set(p.__language, (m.get(p.__language) || 0) + 1), new Map())]
    .sort((x, y) => y[1] - x[1]).slice(0, 5).map(([k, v]) => `${k}:${v}`).join(' ');
  console.log(`  suspect languages: ${dist(arms.suspect)}`);
  console.log(`  control languages: ${dist(arms.control)}`);
  const targets = [...arms.suspect, ...arms.control];
  console.log(`arms: suspect=${arms.suspect.length}  control=${arms.control.length}  total=${targets.length}`);
  console.log(`ESTIMATED COST: ${targets.length} pages x $${COST_PER_PAGE} = $${(targets.length * COST_PER_PAGE).toFixed(2)}`);
  if (!APPLY) {
    console.log('\nDRY RUN — nothing spent, nothing called. Re-run with --apply to execute.');
    await client.close();
    return;
  }
  if (!GEMINI_KEY) throw new Error('no GEMINI key in env');

  const results = [];
  let done = 0, spentPages = 0;
  const queue = targets.map((p, i) => ({ p, arm: i < arms.suspect.length ? 'suspect' : 'control' }));
  async function worker() {
    for (;;) {
      const item = queue.shift();
      if (!item) return;
      const { p, arm } = item;
      const url = getPageSource(p);
      const r = await ocrOnce(url, prompt.content);
      done++;
      if (r.error) { results.push({ page_id: p.id, arm, error: r.error }); }
      else {
        spentPages++;
        results.push({
          page_id: p.id, book_id: p.book_id, page_number: p.page_number, arm,
          agreement: agreementPrimary(p.ocr.data, r.text),
          script_class: scriptClassOf(p.ocr.data),
          language: p.__language || null,
          stored_model: p.ocr.model || null, stored_prompt: p.ocr.prompt_version ?? null,
          model_matched: (p.ocr.model || null) === MODEL,
          prompt_matched: String(p.ocr.prompt_version ?? '') === String(prompt.version),
          archived_at: p.archive_metadata?.archived_at || null, ocr_updated_at: p.ocr?.updated_at || null,
        });
      }
      if (done % 25 === 0) console.log(`  ${done}/${targets.length} · $${(spentPages * COST_PER_PAGE).toFixed(2)}`);
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));

  const ok = results.filter(r => typeof r.agreement === 'number');
  const stat = a => {
    if (!a.length) return { n: 0 };
    const v = a.map(x => x.agreement).sort((x, y) => x - y);
    return {
      n: v.length,
      median: +v[Math.floor(v.length / 2)].toFixed(4),
      mean: +(v.reduce((s, z) => s + z, 0) / v.length).toFixed(4),
      // The decisive bucket: agreement below 0.30 is nowhere near the same-leaf
      // distribution and sits in the different-page one.
      mispaired_pct: +(100 * v.filter(z => z < 0.30).length / v.length).toFixed(1),
    };
  };
  const sus = stat(ok.filter(r => r.arm === 'suspect'));
  const con = stat(ok.filter(r => r.arm === 'control'));
  console.log(`\nSUSPECT (re-archived after the text was written): ${JSON.stringify(sus)}`);
  console.log(`CONTROL (not re-archived since)                 : ${JSON.stringify(con)}`);
  console.log(`errors: ${results.length - ok.length}`);
  console.log(`ACTUAL SPEND: ~$${(spentPages * COST_PER_PAGE).toFixed(2)} over ${spentPages} pages`);

  const verdict = (sus.n && con.n)
    ? (sus.mispaired_pct > con.mispaired_pct * 3 && sus.mispaired_pct > 5
      ? 'SUSPECT ARM IS ELEVATED — re-archiving after OCR does leave text describing an older image.'
      : 'NO ELEVATION — archived_at > ocr.updated_at does NOT indicate a mispairing. The 29.5% is refetch noise.')
    : 'INCONCLUSIVE — an arm is empty.';
  console.log(`\n${verdict}`);

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({
    date: new Date().toISOString(), model: MODEL, prompt: `${prompt.name} v${prompt.version}`,
    temperature: 0.1, n_requested: N, suspect: sus, control: con,
    errors: results.length - ok.length, spend_usd: +(spentPages * COST_PER_PAGE).toFixed(2),
    verdict,
    baseline_note: 'Corpus baselines 2026-08-02: same-leaf pairs mean 0.82 / median 0.973; different-page (shift-repair) pairs mean 0.032 / median 0.025.',
    wrote_to_database: false,
    rows: results,
  }, null, 2));
  console.log(`wrote ${OUT}`);
  await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
