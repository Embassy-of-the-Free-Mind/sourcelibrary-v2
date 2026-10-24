#!/usr/bin/env node
/**
 * latin-repair-census-5924/controls.mjs — positive and negative controls for every detector (#5924).
 *
 * PRIOR ART: scripts/eval/latin-bakeoff-5924 (the 99 leaf-checked references and flash-lite's reads of them,
 *   reads/L.jsonl.gz — the natural positive control for long s); no planted-defect harness exists for stored OCR.
 *
 * Models: corpus.mjs pages, split by book (hash) into TRAIN (80%: lexicon + char LM) and HELD (20%: clean pages
 *   for negatives and the base text for planted defects). A detector may be counted in census.mjs only if it fires
 *   on ≥ 80% of its planted cases and on ≤ 5% of clean held-out pages. The interleave threshold is set here from the
 *   held-out clean pages (98th percentile) and written to $JOB_SCRATCH/thresholds.json.
 * Writes $JOB_SCRATCH/controls.json. Prints counts only.
 */
import fs from 'node:fs'; import zlib from 'node:zlib'; import path from 'node:path'; import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as D from './detectors.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.JOB_SCRATCH || '/data/scratch/sl/jobs/latin-repair-census';
const readJsonl = f => zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').split('\n').filter(Boolean).map(JSON.parse);

export function loadModels() {
  const rows = readJsonl(path.join(OUT, 'corpus.jsonl.gz'));
  const held = b => parseInt(crypto.createHash('sha1').update(b).digest('hex').slice(0, 8), 16) % 5 === 0;
  const train = rows.filter(r => !held(r.book_id)), test = rows.filter(r => held(r.book_id));
  return { lex: D.buildLexicon(train.map(r => r.text)), lm: D.buildCharLM(train.map(r => r.text)), train, test };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const t0 = Date.now();
  const { lex, lm, train, test } = loadModels();
  console.log(`train pages ${train.length}, held ${test.length}, lexicon types ${lex.V.size}, tokens ${lex.n}, built ${((Date.now() - t0) / 1000).toFixed(0)}s`);

  // held-out pages with their in-corpus neighbours (page_number ± 1)
  const byBook = new Map(); for (const r of test) (byBook.get(r.book_id) || byBook.set(r.book_id, []).get(r.book_id)).push(r);
  const items = [];
  for (const arr of byBook.values()) {
    arr.sort((a, b) => a.page_number - b.page_number);
    arr.forEach((r, i) => {
      const nb = [arr[i - 1], arr[i + 1]].filter(x => x && Math.abs(x.page_number - r.page_number) === 1);
      const lines = D.bodyLines(r.text); if (D.letters(lines.join(' ')) < 600) return;
      items.push({ r, lines, nb: nb.map(x => D.bodyLines(x.text)), nbLetters: arr.filter(x => x !== r && Math.abs(x.page_number - r.page_number) <= 4).map(x => D.letters(D.bodyLines(x.text).join(' '))) });
    });
  }
  const withNb = items.filter(x => x.nb.length);
  const lb = items.filter(x => D.lineBroken(x.lines)), lbNb = withNb.filter(x => D.lineBroken(x.lines));
  const res = {};
  const rate = (arr, f) => ({ n: arr.length, fired: arr.filter(f).length, rate: +(arr.filter(f).length / Math.max(1, arr.length)).toFixed(3) });

  // ---- long s
  const BENCH = path.join(HERE, '..', 'benchmark');
  const refs = JSON.parse(fs.readFileSync(path.join(BENCH, 'latin-refs-5924.json'), 'utf8')).pages
    .map(p => ({ slug: p.slug, text: fs.readFileSync(path.join(BENCH, 'refs', `${p.slug}.txt`), 'utf8') }));
  const lite = new Map(readJsonl(path.join(HERE, '..', 'latin-bakeoff-5924', 'reads', 'L.jsonl.gz')).map(r => [r.page_id, r.text]));
  const ls = t => D.longS(D.bodyLines(t), lex);
  const cnt = (t, ch) => (t.match(new RegExp(ch, 'g')) || []).length;
  const refsS = refs.filter(r => (r.text.match(/ſ/g) || []).length >= 20);
  res.long_s = {
    neg_ref_as_printed: rate(refs.map(r => ls(r.text)), D.longSFires),
    neg_ref_s_folded: rate(refs.map(r => ls(r.text.replace(/ſ/g, 's'))), D.longSFires),
    neg_heldout_flash_with_s: rate(items.map(x => D.longS(x.lines, lex)), D.longSFires),
    pos_planted_ref_s_to_f: rate(refsS.map(r => ls(r.text.replace(/ſ/g, 'f'))), D.longSFires),
    pos_planted_heldout_s_to_f: rate(items.map(x => D.longS(x.lines.map(l => l.replace(/ſ/g, 'f')), lex)), D.longSFires),
    // natural positive: flash-lite's read of a reference page where it really wrote f for ſ (≥ 10 more f than the
    // reference prints, < 5 ſ kept). Lite reads that rendered ſ as s are not long-s defects and are left out.
    pos_natural_lite_on_refs_f_for_s: rate(refsS.filter(r => lite.has(r.slug) && cnt(lite.get(r.slug), 'ſ') < 5 && cnt(lite.get(r.slug), 'f') - cnt(r.text, 'f') >= 10).map(r => ls(lite.get(r.slug))), D.longSFires),
  };
  // token recall on planted: hits / (tokens that held a non-final ſ)
  let sTok = 0, sHit = 0, fpTok = 0, allTok = 0;
  for (const x of items) {
    const ws = D.words(x.lines.join(' ')); sTok += ws.filter(w => /ſ/.test(w)).length; allTok += ws.length;
    sHit += D.longS(x.lines.map(l => l.replace(/ſ/g, 'f')), lex).hits; fpTok += D.longS(x.lines, lex).hits;
  }
  res.long_s.token_recall_planted = +(sHit / sTok).toFixed(3);
  res.long_s.false_hits_per_1000_tokens_clean = +(1000 * fpTok / allTok).toFixed(2);

  // ---- bleed
  const plantDup = x => [...x.lines, ...x.nb[0].slice(0, 6)];
  const plantEdge = x => x.lines.map((l, i) => { const src = x.nb[0][i % x.nb[0].length]; const w = D.words(src); const z = w[w.length - 1] || ''; return i % 3 !== 2 && z.length >= 4 ? `${z.slice(-Math.min(5, z.length - 1))} ${l}` : l; });
  const plantStrip = x => { const tails = x.nb[0].map(l => { const w = D.words(l); const z = w[w.length - 1] || ''; return z.slice(-Math.min(5, Math.max(2, z.length - 1))); }).filter(z => z.length >= 2).slice(0, 12); const h = Math.floor(x.lines.length / 2); return [...x.lines.slice(0, h), ...tails, ...x.lines.slice(h)]; };
  // margin strip: planted = a <margin> block of 12 fragments cut from the neighbour's line-starts (2–5 letters, every
  // other one with a hyphen) or line-ends; negative = clean held-out pages, and those with ≥ 3 real side-notes
  // what a cut strip shows: the first 2–5 letters of a line (half with a hyphen, as the eye found them), or the last
  // 2–5 characters of a line as printed — its hyphen included when the printed line has one
  const frags = (x, ends) => x.nb[0].map((l, i) => { const k = 2 + (i % 4);
    if (ends) { const t = l.trim(); const z = t.slice(-(k + (/[-¬=⸗]$/.test(t) ? 1 : 0))).replace(/^[^\p{L}ſ]+/u, ''); return D.letters(z) >= 2 ? z : null; }
    const w = D.words(l); const z = w[0]; if (!z || z.length < 3) return null; return z.slice(0, k) + (i % 2 ? '-' : ''); }).filter(Boolean).slice(0, 12);
  const lbNb2 = lbNb.filter(x => D.lineBroken(x.nb[0]) && frags(x, false).length >= 10 && frags(x, true).length >= 10);
  const withMargin = withNb.filter(x => (x.r.text.match(/<margin/g) || []).length >= 3);
  const B = (x, text, lines) => D.bleedFires(D.bleed(lines || x.lines, x.nb), D.marginStrip(text ?? x.r.text, lex));
  res.bleed = {
    neg_heldout_with_real_neighbours: rate(withNb, x => B(x)),
    neg_heldout_with_real_side_notes: rate(withMargin, x => B(x)),
    pos_planted_margin_strip_line_starts: rate(lbNb2, x => B(x, x.r.text + '\n<margin>' + frags(x, false).join('\n') + '</margin>')),
    // a known gap, not a gate: un-hyphenated line-END fragments (`tur`, `que`) are mostly real word endings that
    // are also words, so the strip of a facing VERSO is under-detected — the census bleed rate is a floor
    gap_planted_margin_strip_line_ends: rate(lbNb2, x => B(x, x.r.text + '\n' + frags(x, true).map(f => `<margin>${f}</margin>`).join('\n'))),
    pos_planted_edge_strip_block__line_broken_only: rate(lbNb, x => B(x, x.r.text, plantStrip(x))),
    diag_dup_edge_not_counted: { neg: rate(withNb.map(x => D.bleed(x.lines, x.nb)), D.bleedDupEdgeFires), pos_dup: rate(withNb.map(x => D.bleed(plantDup(x), x.nb)), D.bleedDupEdgeFires), pos_edge: rate(lbNb.map(x => D.bleed(plantEdge(x), x.nb)), D.bleedDupEdgeFires) },
  };
  // natural set: the round-1 by-eye pages (this is where the margin shape was FOUND, so it is a discovery set, not
  // an independent test — the independent check is the round-2 by-eye sample of the counted detector)
  const eyeDir = path.join(OUT, 'agents');
  if (fs.existsSync(path.join(eyeDir, 'eye-0.out.json'))) {
    const E = [0, 1, 2].flatMap(i => JSON.parse(fs.readFileSync(path.join(eyeDir, `eye-${i}.out.json`), 'utf8')));
    const T = e => fs.readFileSync(path.join(OUT, 'text', `${e.slug}.txt`), 'utf8');
    const f = e => D.marginStripFires(D.marginStrip(T(e), lex));
    res.bleed.discovery_eye_bleed = rate(E.filter(e => e.bleed), f); res.bleed.discovery_eye_no_bleed = rate(E.filter(e => !e.bleed), f);
  }
  // the planted fragments must not be ones that happen to be words: report how many were
  res.bleed.planted_fragment_word_share = +(lbNb2.flatMap(x => frags(x, false)).filter(f => (lex.V.get(D.fold(f.replace(/-$/, ''))) || 0) >= 3).length / Math.max(1, lbNb2.flatMap(x => frags(x, false)).length)).toFixed(3);

  // ---- loops
  const plantLoop = x => { const l = x.lines.find(y => y.length >= 40) || x.lines[0]; const h = Math.floor(x.lines.length / 2); return [...x.lines.slice(0, h), ...Array(14).fill(l)]; };
  res.loop = {
    neg_heldout: rate(items.map(x => D.loops(x.r.text, x.lines)), D.loopFires),
    pos_planted_line_x14: rate(items.map(x => { const L = plantLoop(x); return D.loops(L.join('\n'), L); }), D.loopFires),
  };

  // ---- truncation (neighbours = the real ±4 pages)
  const okT = items.filter(x => x.nbLetters.filter(n => n >= 600).length >= 3);
  const cut = x => { const t = x.lines.join('\n'); const k = Math.floor(t.length * 0.3); const s = t.slice(0, k).replace(/\s+\S*$/, '') + ' ' + (t.slice(k).match(/^\S+/) || [''])[0].slice(0, 2); return s.split('\n'); };
  res.truncation = {
    neg_heldout: rate(okT.map(x => D.truncation(x.lines, x.nbLetters)), D.truncFires),
    pos_planted_cut_30pct_midword: rate(okT.map(x => D.truncation(cut(x), x.nbLetters)), D.truncFires),
  };

  // ---- empty / refusal
  res.empty = {
    neg_heldout: rate(items.map(x => D.empty(x.r.text, x.lines, 'text', x.nbLetters)), D.emptyFires),
    pos_planted_blanked: rate(okT.map(x => D.empty('<page-type>text</page-type>', [], 'text', x.nbLetters)), D.emptyFires),
    pos_planted_refusal: rate(items.map(x => D.empty("I'm sorry, but I cannot transcribe this image.", ["I'm sorry, but I cannot transcribe this image."], 'text', x.nbLetters)), D.emptyFires),
  };

  // ---- interleave (line-broken pages only): LM threshold from clean held-out pages, recall on planted read-across
  const il = lb.map(x => D.interleave(x.lines, lm, lex));
  const shares = il.filter(r => r.path === 'lm').map(r => r.share).sort((a, b) => a - b);
  D.INTERLEAVE_T.share = +Math.max(0.35, shares[Math.floor(shares.length * 0.98)]).toFixed(3);
  const weave = x => { const h = Math.floor(x.lines.length / 2); const a = x.lines.slice(0, h), b = x.lines.slice(h); const o = []; for (let i = 0; i < Math.max(a.length, b.length); i++) { if (a[i]) o.push(a[i]); if (b[i]) o.push(b[i]); } return o; };
  const weaveNb = x => { const b = x.nb[0]; const o = []; for (let i = 0; i < Math.max(x.lines.length, b.length); i++) { if (x.lines[i]) o.push(x.lines[i]); if (b[i]) o.push(b[i]); } return o; };
  const median = a => a[Math.floor(a.length / 2)];
  const pw = lb.map(x => D.interleave(weave(x), lm, lex)), pn = lbNb.filter(x => D.lineBroken(x.nb[0])).map(x => D.interleave(weaveNb(x), lm, lex));
  res.interleave = {
    threshold_share: D.INTERLEAVE_T.share, clean_share_median: +median(shares).toFixed(3),
    line_broken_share_of_held: +(lb.length / items.length).toFixed(3),
    applicable_hyphen_share_of_line_broken: +(il.filter(r => r.path === 'hyphen').length / Math.max(1, il.length)).toFixed(3),
    neg_heldout_applicable: rate(il.filter(r => r.path === 'hyphen'), D.interleaveFires),
    pos_planted_halves_woven_applicable: rate(pw.filter(r => r.path === 'hyphen'), D.interleaveFires),
    pos_planted_neighbour_woven_applicable: rate(pn.filter(r => r.path === 'hyphen'), D.interleaveFires),
    lm_path_diagnostic_not_counted: { neg: rate(il.filter(r => r.path === 'lm'), D.interleaveLmFires), pos: rate(pw.filter(r => r.path === 'lm'), D.interleaveLmFires) },
  };
  // gate
  const gate = {};
  for (const [k, v] of Object.entries(res)) {
    const pos = Object.entries(v).filter(([n]) => n.startsWith('pos_')).map(([, x]) => x.rate);
    const neg = Object.entries(v).filter(([n]) => n.startsWith('neg_')).map(([, x]) => x.rate);
    gate[k] = { pos_min: Math.min(...pos), neg_max: Math.max(...neg), pass: Math.min(...pos) >= 0.8 && Math.max(...neg) <= 0.05 };
  }
  fs.writeFileSync(path.join(OUT, 'thresholds.json'), JSON.stringify({ interleave_share: D.INTERLEAVE_T.share }));
  fs.writeFileSync(path.join(OUT, 'controls.json'), JSON.stringify({ built_at: new Date().toISOString(), held_items: items.length, with_neighbours: withNb.length, res, gate }, null, 1));
  console.log(JSON.stringify(gate));
  for (const [k, v] of Object.entries(res)) console.log(k, JSON.stringify(v));
}
