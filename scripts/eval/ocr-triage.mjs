#!/usr/bin/env node
/**
 * Rank pages for human spot-checking, and emit a worked example set. (#3473)
 *
 * Agreement alone is a poor queue: 67% of "instability" is mild glyph variance,
 * so ranking by it fills the top with pages whose two passes merely spelled
 * `nunc` differently. These signals separate far more sharply and cost nothing:
 *
 *   mean <unclear> spans     198x    the model's own per-span "I can't read this"
 *   length asymmetry          17x    one pass produced much more text
 *   column-count disagreement 8.4x   the passes disagreed about what the page IS
 *   page-type / language flip 4.5x / 3.8x
 *   illustration present      3.5x   "what counts as the text" is a judgement
 *
 * Each is emitted as its OWN bucket rather than blended into one score, because
 * a blended rank cannot tell you WHY a page surfaced, and the reason is the
 * whole point of a triage queue.
 *
 * Population is the clean true-repeat set: same leaf, same model, same prompt,
 * no degenerate/refusal/commentary side. Free — Mongo reads only.
 *
 *   set -a; source .env.production.local; set +a
 *   node scripts/eval/ocr-triage.mjs <corpus.jsonl> [--pool=2500] [--per-bucket=8]
 */
import { MongoClient } from 'mongodb';
import fs from 'fs';
import path from 'path';
import readline from 'readline';

const argv = process.argv.slice(2);
const JSONL = argv.find(a => !a.startsWith('--'));
const arg = (k, d) => { const a = argv.find(x => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const POOL = parseInt(arg('pool', '2500'));
const PER = parseInt(arg('per-bucket', '8'));
const DATE = new Date().toISOString().slice(0, 10);
const SITE = 'https://sourcelibrary.org';
const count = (t, tag) => (t.match(new RegExp(`<${tag}[ >]`, 'gi')) || []).length;

async function main() {
  const pool = [];
  const rl = readline.createInterface({ input: fs.createReadStream(JSONL) });
  for await (const line of rl) {
    const x = JSON.parse(line);
    if (x.eligibility !== 'eligible' || x.leaf_shift !== false) continue;
    if (!x.prior_model || x.prior_model !== x.current_model) continue;
    if (!x.prior_prompt || x.prior_prompt !== x.current_prompt) continue;
    if (x.prior_degenerate || x.current_degenerate || x.prior_refusal || x.current_refusal
      || x.prior_meta || x.current_meta || x.near_zero_overlap) continue;
    if (x.agreement_primary >= 0.85) continue;
    pool.push(x);
  }
  const stride = Math.max(1, Math.floor(pool.length / POOL));
  const sample = pool.filter((_, i) => i % stride === 0).slice(0, POOL);
  console.log(`clean unstable pool ${pool.length.toLocaleString()} → hydrating ${sample.length}`);

  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const db = c.db('bookstore');
  const rows = [];
  for (let i = 0; i < sample.length; i += 300) {
    const ch = sample.slice(i, i + 300);
    const ps = await db.collection('pages').find({ id: { $in: ch.map(r => r.page_id) } },
      { projection: { id: 1, 'ocr.data': 1, display_photo: 1, archived_photo: 1, photo: 1 } }).maxTimeMS(120000).toArray();
    const m = new Map(ps.map(p => [p.id, p]));
    for (const r of ch) {
      const p = m.get(r.page_id); if (!p) continue;
      const t = p.ocr?.data || '';
      rows.push({ ...r, unclear: count(t, 'unclear'), imagedesc: count(t, 'image-desc'), margin: count(t, 'margin'),
        warning: (t.match(/<warning>([\s\S]*?)<\/warning>/i) || [])[1]?.replace(/\s+/g, ' ').slice(0, 200) || null,
        img: p.display_photo || p.archived_photo || p.photo,
        lenAsym: Math.min(r.body_words_prior, r.body_words_current) / Math.max(r.body_words_prior, r.body_words_current) });
    }
  }
  await c.close();

  const mk = (r, why) => ({ why, book: r.book_slug, language: r.language, year: r.year, page_number: r.page_number,
    agreement: r.agreement_primary, unclear: r.unclear, len_words: [r.body_words_prior, r.body_words_current],
    columns: [r.prior_columns, r.current_columns], page_type: [r.prior_page_type, r.current_page_type],
    lang_tag: [r.prior_lang_tag, r.current_lang_tag], warning: r.warning,
    reader_url: r.book_slug ? `${SITE}/book/${r.book_slug}/page/${r.page_id}` : null, image_url: r.img });

  const BUCKETS = [
    ['model flagged spans it could not read', r => r.unclear > 0, (a, b) => b.unclear - a.unclear,
      'Highest precision signal available. Rank by count: a page with many <unclear> marks is one the model itself says it failed on.'],
    ['one pass produced far more text', r => r.lenAsym < 0.7, (a, b) => a.lenAsym - b.lenAsym,
      'Omission. One pass skipped a block the other transcribed — a column, a note, a whole half of a spread.'],
    ['passes disagreed on column count', r => r.prior_columns && r.current_columns && r.prior_columns !== r.current_columns, (a, b) => a.agreement_primary - b.agreement_primary,
      'The two passes disagreed about the page LAYOUT, so reading order is undetermined. Detectable from the envelope tags alone, no text diff.'],
    ['passes disagreed on page type', r => r.page_type_changed, (a, b) => a.agreement_primary - b.agreement_primary,
      'They disagreed about what KIND of page it is — plate vs text, title vs body.'],
    ['passes disagreed on language', r => r.lang_tag_changed, (a, b) => a.agreement_primary - b.agreement_primary,
      'They disagreed about the language. Often a multi-script page where each pass picked a different dominant script.'],
    ['illustration on the page', r => r.imagedesc > 0, (a, b) => a.agreement_primary - b.agreement_primary,
      'Where text meets image, "what counts as the text" is a judgement and the passes need not decide alike.'],
    ['marginalia gained or lost', r => r.marginalia_fate === 'gained' || r.marginalia_fate === 'lost', (a, b) => a.agreement_primary - b.agreement_primary,
      'One pass transcribed marginal notes the other dropped. An inclusion-policy difference, not a reading failure.'],
  ];

  const out = BUCKETS.map(([name, pred, cmp, why]) => {
    const hits = rows.filter(pred).sort(cmp);
    return { bucket: name, why, n_in_sample: hits.length,
      pct_of_sample: +(100 * hits.length / rows.length).toFixed(1),
      examples: hits.slice(0, PER).map(r => mk(r, name)) };
  });

  const dir = path.join('scripts', 'eval', 'results');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `ocr-triage-${DATE}.json`);
  fs.writeFileSync(file, JSON.stringify({ date: DATE, pool: pool.length, hydrated: rows.length, buckets: out }, null, 1));
  console.log(`\nhydrated ${rows.length} unstable pages\n`);
  for (const b of out) console.log(`  ${String(b.n_in_sample).padStart(4)} (${String(b.pct_of_sample).padStart(4)}%)  ${b.bucket}`);
  console.log(`\n→ ${file}`);
}
main().catch(e => { console.error(e); process.exit(1); });
