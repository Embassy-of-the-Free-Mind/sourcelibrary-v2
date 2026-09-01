#!/usr/bin/env node
/**
 * Score per-page disagreement signals on the double-OCR corpus, and emit a
 * ranked review queue.
 *
 * Offline — reads only the CSVs from `build-corpus-dataset.mjs`. No Mongo, no
 * network, no cost.
 *
 *   node scripts/eval/corpus-signal-audit.mjs [--dir=scripts/output/corpus-dataset]
 *
 * ── WHAT THIS FOUND, AND WHY THE OUTPUT IS HEDGED ──────────────────
 *
 * 1. SCORE AGAINST A TARGET YOU DID NOT HELP DEFINE.
 *    `degenerate` IS a low type/token ratio, so a "TTR dropped" signal predicts
 *    its own definition; repetition loops inflate word counts, so length-based
 *    signals inherit the same circularity. Measured, the ranking reorders
 *    completely between the two targets:
 *
 *      signal                 vs degenerate-or-commentary   vs commentary only
 *      TTR dropped >0.25              14.7x                       3.0x
 *      word count grew >3x             9.7x                       1.3x
 *      |delta words| > 100             5.1x                       1.1x   <- nothing
 *      body emptied                    3.3x                       7.4x
 *      script class flipped           11.3x                       4.6x
 *
 *    So this script reports BOTH columns. A signal that collapses between them
 *    was measuring its own label.
 *
 * 2. STACKING IS DISCONTINUOUS. Precision is flat from 1 signal to 2 (1.0% ->
 *    1.7%) and jumps at 3 (8.1%) and 4+ (22.2%). A >=2 cut is 1,861 pages at
 *    97% false positives; a >=3 cut is 220 pages across 76 books. Only the
 *    latter is worth a person's time.
 *
 * 3. THE QUEUE IS ENRICHED FOR REPAIRS, NOT DAMAGE — the important caveat.
 *    Opening the top of it: Micrographia p289's PRIOR text was
 *    `CAP. 9. HARMONICORUM LIB. III` (Mersenne's music theory — a different
 *    book entirely, the archived/undefined/ contamination) and its LIVE text
 *    correctly describes Micrographia plate XXVIII. The re-OCR REPAIRED that
 *    page; `body_emptied` fired on the fix. 61 of 72 body_emptied pages in the
 *    queue have a clean live page.
 *
 *    And the selection is structural. The printed-page-number shift test
 *    abstains on 49.9% of all clean pairs but 97.3% of this queue — because a
 *    page that becomes a plate has no printed number to compare. The signals
 *    concentrate exactly where the instrument that could adjudicate them cannot
 *    run.
 *
 *    Therefore: these signals detect that the two passes DISAGREE ABOUT WHAT THE
 *    PAGE IS. They do not say which side is right. Use the queue to build a
 *    labelled set, not to drive an automated fix — and never quote a precision
 *    number from here as if it measured damage.
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true];
}));
const DIR = args.dir || 'scripts/output/corpus-dataset';
const MIN_SIGNALS = parseInt(args['min-signals'] || '2');   // rows written to the queue

const QUOTE = '"';
const parseLine = (l) => {
  const o = []; let c = '', q = false;
  for (let i = 0; i < l.length; i++) {
    const ch = l[i];
    if (q) { if (ch === QUOTE) { if (l[i + 1] === QUOTE) { c += QUOTE; i++; } else q = false; } else c += ch; }
    else if (ch === QUOTE) q = true;
    else if (ch === ',') { o.push(c); c = ''; }
    else c += ch;
  }
  o.push(c); return o;
};
const csvEsc = v => {
  const s = String(v == null ? '' : v);
  return /[",\n]/.test(s) ? QUOTE + s.replace(/"/g, '""') + QUOTE : s;
};
const B = v => v === '1';
const N = v => { const x = parseFloat(v); return Number.isFinite(x) ? x : null; };
const pct = (a, b) => b ? (100 * a / b).toFixed(1) + '%' : '—';

async function streamCsv(file, fn) {
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  let header = null, ix = null;
  for await (const line of rl) {
    if (!header) { header = parseLine(line); ix = n => header.indexOf(n); continue; }
    if (!line.trim()) continue;
    const r = parseLine(line);
    if (r.length !== header.length) continue;
    fn(r, ix);
  }
}

async function main() {
  for (const f of ['pages.csv', 'revisions.csv', 'books.csv']) {
    if (!fs.existsSync(path.join(DIR, f))) {
      console.error(`missing ${f} under ${DIR} — run build-corpus-dataset.mjs first`);
      process.exit(1);
    }
  }

  const meta = new Map();
  await streamCsv(path.join(DIR, 'books.csv'), (r, ix) => {
    meta.set(r[ix('book_id')], { slug: r[ix('slug')], title: r[ix('title')], lang: r[ix('language')] });
  });

  // Live side — only pages that were actually re-OCR'd.
  const live = new Map();
  await streamCsv(path.join(DIR, 'pages.csv'), (r, ix) => {
    if (r[ix('has_ocr')] !== '1' || r[ix('is_double_ocr')] !== '1') return;
    live.set(r[ix('page_id')], {
      w: N(r[ix('words')]) || 0, bw: N(r[ix('body_words')]) || 0, ttr: N(r[ix('type_token_ratio')]),
      deg: B(r[ix('degenerate')]), meta: B(r[ix('meta_prose')]), ref: B(r[ix('refusal')]),
      marg: N(r[ix('marginalia')]) || 0, img: B(r[ix('image_desc')]),
      pt: r[ix('page_type_tag')] || '', col: r[ix('columns_tag')] || '',
      lang: r[ix('lang_tag')] || '', sc: r[ix('script_class')] || '',
      book: r[ix('book_id')], pn: r[ix('abs_page_number')], model: r[ix('ocr_model')] || '',
    });
  });

  // Prior side — the NEWEST revision per page, clean provenance only.
  const prior = new Map();
  const shiftTest = { both: 0, prior: 0, live: 0, none: 0 };
  await streamCsv(path.join(DIR, 'revisions.csv'), (r, ix) => {
    if (r[ix('provenance_class')] !== 'reocr') return;
    const hasP = r[ix('printed_page_num')] !== '', hasL = r[ix('live_printed_page_num')] !== '';
    shiftTest[hasP && hasL ? 'both' : hasP ? 'prior' : hasL ? 'live' : 'none']++;
    if (r[ix('printed_page_shift')] === '1') return;   // confirmed different leaf
    const pid = r[ix('page_id')], idx = parseInt(r[ix('rev_index_on_page')]) || 0;
    const cur = prior.get(pid);
    if (cur && idx <= cur.idx) return;
    prior.set(pid, {
      idx, w: N(r[ix('words')]) || 0, bw: N(r[ix('body_words')]) || 0, ttr: N(r[ix('type_token_ratio')]),
      marg: N(r[ix('marginalia')]) || 0, img: B(r[ix('image_desc')]),
      pt: r[ix('page_type_tag')] || '', col: r[ix('columns_tag')] || '',
      lang: r[ix('lang_tag')] || '', sc: r[ix('script_class')] || '',
      hasPn: r[ix('printed_page_num')] !== '', hasLivePn: r[ix('live_printed_page_num')] !== '',
    });
  });

  const SIGNALS = [
    ['body_emptied', x => x.p.bw >= 40 && x.l.bw === 0],
    ['script_flip', x => x.p.sc && x.l.sc && x.p.sc !== x.l.sc && x.p.sc !== 'unknown' && x.l.sc !== 'unknown'],
    ['ttr_drop', x => x.p.ttr !== null && x.l.ttr !== null && (x.p.ttr - x.l.ttr) > 0.25],
    ['pagetype_flip', x => x.p.pt && x.l.pt && x.p.pt !== x.l.pt],
    ['columns_flip', x => x.p.col && x.l.col && x.p.col !== x.l.col],
    ['lang_flip', x => x.p.lang && x.l.lang && x.p.lang !== x.l.lang],
    ['marginalia_lost', x => x.p.marg > 0 && x.l.marg === 0],
    ['shrank_3x', x => x.l.w >= 40 && x.p.w > 3 * x.l.w],
    ['grew_3x', x => x.p.w >= 40 && x.l.w > 3 * x.p.w],
    ['delta_100', x => Math.abs(x.l.w - x.p.w) > 100],
  ];
  const QUEUE_SIGNALS = new Set(['body_emptied', 'script_flip', 'ttr_drop', 'pagetype_flip',
    'columns_flip', 'marginalia_lost', 'shrank_3x', 'grew_3x']);

  const rows = [];
  for (const [pid, p] of prior) {
    const l = live.get(pid); if (!l) continue;
    const x = { pid, p, l };
    const hit = SIGNALS.filter(s => s[1](x)).map(s => s[0]);
    rows.push({ pid, p, l, hit, k: hit.filter(h => QUEUE_SIGNALS.has(h)).length });
  }
  const n = rows.length;

  // Two targets. The second shares no definition with any length/TTR signal.
  const tgtWide = r => r.l.deg || r.l.meta || r.l.ref;
  const tgtIndep = r => r.l.meta || r.l.ref;
  const baseW = rows.filter(tgtWide).length / n, baseI = rows.filter(tgtIndep).length / n;

  console.log(`\nclean re-OCR pairs: ${n.toLocaleString()}`);
  console.log(`  base rate — degenerate or commentary : ${pct(rows.filter(tgtWide).length, n)}`);
  console.log(`  base rate — commentary only (indep.) : ${pct(rows.filter(tgtIndep).length, n)}\n`);

  console.log('=== SIGNAL LIFT UNDER TWO TARGETS ===');
  console.log(`  ${'signal'.padEnd(18)} ${'flagged'.padStart(8)} ${'circular'.padStart(9)} ${'independent'.padStart(12)}`);
  console.log('  ' + '-'.repeat(52));
  const scored = SIGNALS.map(([name, f]) => {
    const hit = rows.filter(f);
    const lw = hit.length && baseW ? (hit.filter(tgtWide).length / hit.length) / baseW : 0;
    const li = hit.length && baseI ? (hit.filter(tgtIndep).length / hit.length) / baseI : 0;
    return { name, n: hit.length, lw, li };
  }).sort((a, b) => b.li - a.li);
  for (const s of scored) {
    console.log(`  ${s.name.padEnd(18)} ${String(s.n).padStart(8)} ${(s.lw.toFixed(1) + 'x').padStart(9)} ${(s.li.toFixed(1) + 'x').padStart(12)}`);
  }
  console.log('\n  A signal that collapses from circular -> independent was measuring its own label.');

  console.log('\n=== PRECISION BY NUMBER OF SIGNALS (independent target) ===');
  console.log(`  ${'signals'.padStart(8)} ${'pages'.padStart(8)} ${'precision'.padStart(10)} ${'lift'.padStart(6)}`);
  for (let k = 0; k <= 4; k++) {
    const g = rows.filter(r => (k < 4 ? r.k === k : r.k >= 4));
    if (!g.length) continue;
    const b = g.filter(tgtIndep).length;
    console.log(`  ${(k < 4 ? String(k) : '4+').padStart(8)} ${String(g.length).padStart(8)} ${pct(b, g.length).padStart(10)} ${((b / g.length) / baseI).toFixed(1).padStart(5)}x`);
  }

  // The caveat that matters more than any lift number above.
  const queue = rows.filter(r => r.k >= MIN_SIGNALS);
  const tier3 = rows.filter(r => r.k >= 3);
  const abstainAll = shiftTest.prior + shiftTest.live + shiftTest.none;
  const totAll = abstainAll + shiftTest.both;
  const t3Abstain = tier3.filter(r => !(r.p.hasPn && r.p.hasLivePn)).length;
  console.log('\n=== CAN THE SHIFT TEST EVEN ADJUDICATE THESE? ===');
  console.log(`  printed page number readable on both sides:`);
  console.log(`    all clean pairs : ${pct(shiftTest.both, totAll)}   (abstains on ${pct(abstainAll, totAll)})`);
  console.log(`    tier >=3 queue  : ${pct(tier3.length - t3Abstain, tier3.length)}   (abstains on ${pct(t3Abstain, tier3.length)})`);
  console.log(`  The queue concentrates where the adjudicating instrument cannot run.`);
  const bodyEmptied = tier3.filter(r => r.hit.includes('body_emptied'));
  console.log(`\n  tier>=3 body_emptied pages: ${bodyEmptied.length}, of which the LIVE page is clean: ` +
    `${bodyEmptied.filter(r => !tgtWide(r)).length}`);
  console.log(`  A clean live page after "body emptied" is usually a REPAIR (contaminated prior`);
  console.log(`  replaced by a correct plate description), not a loss. Verify before acting.`);

  // ── queue ────────────────────────────────────────────────────────
  const sev = r => r.k * 1000 + Math.min(999, Math.abs(r.l.bw - r.p.bw));
  queue.sort((a, b) => sev(b) - sev(a));
  const out = ['page_id,book_id,book_slug,title,language,page_number,live_model,n_signals,signals,' +
    'prior_words,live_words,prior_body,live_body,live_degenerate,live_commentary,shift_test_ran,url'];
  for (const r of queue) {
    const m = meta.get(r.l.book) || {};
    out.push([r.pid, r.l.book, m.slug || '', m.title || '', m.lang || '', r.l.pn || '', r.l.model,
      r.k, r.hit.join('|'), r.p.w, r.l.w, r.p.bw, r.l.bw,
      r.l.deg ? 1 : 0, (r.l.meta || r.l.ref) ? 1 : 0,
      (r.p.hasPn && r.p.hasLivePn) ? 1 : 0,
      m.slug ? `https://sourcelibrary.org/book/${m.slug}/page/${r.pid}` : ''].map(csvEsc).join(','));
  }
  const qf = path.join(DIR, 'review-queue.csv');
  fs.writeFileSync(qf, out.join('\n') + '\n');
  const books = new Set(tier3.map(r => r.l.book)).size;
  console.log(`\n  -> ${qf}`);
  console.log(`     ${queue.length.toLocaleString()} rows (>=${MIN_SIGNALS} signals), ranked so the ` +
    `tier>=3 tranche is the top ${tier3.length}, spanning ${books} books.`);
  console.log(`     Review it to BUILD a labelled set. Precision here is measured against proxies\n` +
    `     that have already been shown to point the wrong way.\n`);
}

main().catch(e => { console.error(e); process.exit(1); });
