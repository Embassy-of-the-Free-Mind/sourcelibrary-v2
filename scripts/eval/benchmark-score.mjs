#!/usr/bin/env node
// PRIOR ART: score-transcripts.mjs (scores <slug>.txt against the PINNED ground-truth
// files — passage-level references, free-skip aligner; it has no reading-order or invention
// measure and no reference-free mode), stats-cross-model.mjs (paired stats over the
// observations dataset, not over an image-directory run), ia-ocr-delivered-quality.mjs
// (owns the bag-of-words-minus-sequence "gap" that isolated column splicing on #4790 — the
// token/ratio/bagDice code is copied from there, not imported, because that script is a
// Hetzner-only runner with Mongo side effects), lib/metrics.mjs (levenshtein, normalizeCJK,
// binomTwoSided in lib/paired-stats.mjs). None scores several engines over a stratum
// directory with a page-level reference window and reports the three numbers side by side.
/**
 * benchmark-score.mjs — score every engine's output for one or all strata (#4735 method):
 *
 *   node scripts/eval/benchmark-score.mjs --root=/path/bench-images [--stratum=chinese] \
 *        [--ref=gemini-3.1-flash-lite] [--out=scripts/eval/results/benchmark]
 *
 * Per page and engine it reports THREE things (#4800):
 *   1. accuracy — CER against the page reference where one exists
 *      (scripts/eval/benchmark/refs/<slug>.txt, built by benchmark-refs.mjs); else agreement
 *      with the reference engine (--ref, default flash-lite) as a proxy, labelled as such;
 *   2. reading order — gap = bag-of-words Dice − LCS sequence ratio, against the same text.
 *      Column splicing keeps the words and destroys the order (large gap); a misread shrinks
 *      both together (small gap);
 *   3. invention — share of the engine's content tokens (words ≥ 4 letters; CJK 3-grams)
 *      that occur in NEITHER the reference NOR any other engine's output for that page.
 *      Without a reference this is an "unsupported-token rate": a lone correct reader also
 *      scores high on it, so the by-eye reads arbitrate.
 * Plus: catastrophic-page rate (CER > 0.5, or agreement < 0.5), paired sign test vs --ref on
 * the pages both engines produced text for, and the five worst pages per engine with a
 * 300-char excerpt against the reference (or the reference engine) for reading by eye.
 * A page is TEXTLESS when every engine returns < 30 content characters; it is excluded and
 * listed, never averaged in.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { levenshtein, normalizeCJK, scoreAgainstReference } from './lib/metrics.mjs';
import { binomTwoSided } from './lib/paired-stats.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const argOf = (n, d) => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const ROOT = argOf('root');
const REF_ENGINE = argOf('ref', 'gemini-3.1-flash-lite');
const OUT_DIR = argOf('out', path.join(__dirname, 'results', 'benchmark'));
const ONLY = argOf('stratum') ? argOf('stratum').split(',') : null;
const REFS_DIR = path.join(__dirname, 'benchmark', 'refs');
if (!ROOT) { console.error('--root required'); process.exit(1); }

// ── normalisation ──────────────────────────────────────────────────
const CJK_STRATA = new Set(['chinese', 'japanese']);
function normAlpha(s) {
  return String(s || '')
    .replace(/<(warning|meta|image-desc|figure|note|scan-quality|language|page-type|columns|detected-images|vocab)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/```[a-z]*/g, ' ')
    .normalize('NFC').toLowerCase().replace(/ſ/g, 's').replace(/[’‘ʼ`´]/g, "'").replace(/[“”„]/g, '"')
    .replace(/[‐‑‒–—―¬]/g, '-').replace(/(\p{L})-\s*\n\s*/gu, '$1')   // rejoin hyphenated line breaks
    .replace(/\s+/g, ' ').trim();
}
const tokensAlpha = s => (s.match(/[\p{L}\p{N}']+/gu) || []);
const lettersOnly = s => s.replace(/[^\p{L}\p{N}]+/gu, '');
function normCJK(s) {
  // Han + kana + Hangul kept; Latin digits dropped; punctuation and layout dropped (normalizeCJK
  // keeps only Han/ideographic — extend for kana so Japanese pages are scored on their kana too).
  const t = String(s || '').replace(/<[^>]+>/g, ' ').normalize('NFC');
  return [...t].filter(c => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}〇]/u.test(c)).join('');
}
const cjkTokens = s => [...s];
const cjkGrams = (s, n = 3) => { const g = []; for (let i = 0; i + n <= s.length; i++) g.push(s.slice(i, i + n)); return g; };

// ── sequence vs bag (copied from ia-ocr-delivered-quality.mjs, #4790) ──
function lcsRatio(a, b) {
  a = a.slice(0, 600); b = b.slice(0, 600);
  if (!a.length || !b.length) return 0;
  const prev = new Uint16Array(b.length + 1), cur = new Uint16Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) { for (let j = 1; j <= b.length; j++) cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]); prev.set(cur); }
  return (2 * prev[b.length]) / (a.length + b.length);
}
function bagDice(a, b) {
  a = a.slice(0, 600); b = b.slice(0, 600);
  if (!a.length || !b.length) return 0;
  const c = new Map(); for (const t of a) c.set(t, (c.get(t) || 0) + 1);
  let m = 0; for (const t of b) { const n = c.get(t); if (n) { m++; c.set(t, n - 1); } }
  return (2 * m) / (a.length + b.length);
}
const r3 = x => (x == null ? null : Math.round(x * 1000) / 1000);
const median = xs => { const s = xs.filter(x => x != null).sort((a, b) => a - b); if (!s.length) return null; const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mean = xs => { const s = xs.filter(x => x != null); return s.length ? s.reduce((a, b) => a + b, 0) / s.length : null; };
const CAP = 6000;

function prep(text, cjk) {
  if (cjk) { const n = normCJK(text).slice(0, CAP); return { chars: n, tokens: cjkTokens(n), content: cjkGrams(n, 3), nContent: n.length }; }
  const n = normAlpha(text).slice(0, CAP); const toks = tokensAlpha(n);
  return { chars: lettersOnly(n), tokens: toks, content: toks.filter(t => lettersOnly(t).length >= 4), nContent: lettersOnly(n).length };
}
function compare(h, r) {
  // h, r prepared. CER on letters/chars (symmetric Levenshtein over the reference length).
  if (!r.chars.length) return null;
  const cer = levenshtein([...h.chars], [...r.chars]) / r.chars.length;
  const seq = lcsRatio(h.tokens, r.tokens), bow = bagDice(h.tokens, r.tokens);
  return { cer: r3(cer), acc: r3(Math.max(0, 1 - cer)), seq: r3(seq), bow: r3(bow), gap: r3(bow - seq), len_ratio: r3(h.chars.length / r.chars.length) };
}

// ── Reference tiers (ref-pinned = scripts/eval/ground-truth, ref-ws = ground-truth-ws) ──
// These carry PASSAGE-level references (a curated passage or a proofread page), so they are
// scored with the house two-stage aligner (`scoreAgainstReference`: identity guard, then
// free-skip UPPER and windowed LOWER accuracy) exactly as score-transcripts.mjs does — never
// with the whole-page CER above, which would charge every engine for the page text the
// passage does not cover. Grouped by language; paired sign test vs --ref on pages both align.
function scoreRefTier(stratum) {
  const gtDir = path.join(__dirname, stratum === 'ref-pinned' ? 'ground-truth' : 'ground-truth-ws');
  const outRoot = path.join(ROOT, stratum, 'out');
  const engines = fs.readdirSync(outRoot).filter(e => fs.statSync(path.join(outRoot, e)).isDirectory()).sort();
  const gts = fs.readdirSync(gtDir).filter(f => f.endsWith('.json') && !f.startsWith('_')).map(f => ({ slug: f.slice(0, -5), ...JSON.parse(fs.readFileSync(path.join(gtDir, f), 'utf8')) })).filter(g => g.ocr_ground_truth);
  const pages = [];
  for (const g of gts) {
    const script = g.script === 'cjk' || g.script === 'chinese' ? 'cjk' : (g.script || 'latin');
    const row = { slug: g.slug, language: g.language, script, year: g.year || null, tier: g.tier || 'pinned', non_canonical: !!g.non_canonical, engines: {} };
    for (const e of engines) {
      const f = path.join(outRoot, e, `${g.slug}.txt`);
      if (!fs.existsSync(f)) { row.engines[e] = { missing: true }; continue; }
      const hyp = fs.readFileSync(f, 'utf8');
      let r; try { r = scoreAgainstReference(g.ocr_ground_truth, hyp, script); } catch (err) { row.engines[e] = { error: err.message.slice(0, 80) }; continue; }
      row.engines[e] = { aligned: r.aligned, guard: r3(r.guard?.value), acc_upper: r3(r.charAccuracy), acc_windowed: r3(r.charAccuracyWindowed), cer: r3(r.charAccuracyWindowed == null ? null : 1 - r.charAccuracyWindowed), span_dispersion: r.spanDispersion ?? null, chars: hyp.length };
    }
    pages.push(row);
  }
  const langs = [...new Set(pages.map(p => p.language))].sort();
  const summary = { stratum, date, n_pages: pages.length, ref_engine: REF_ENGINE, languages: {} };
  for (const lang of langs) {
    const lp = pages.filter(p => p.language === lang);
    summary.languages[lang] = { n: lp.length, engines: {} };
    for (const e of engines) {
      const rows = lp.map(p => ({ p, m: p.engines[e] })).filter(x => x.m && !x.m.missing && !x.m.error);
      const al = rows.filter(x => x.m.aligned);
      const s = { pages_run: rows.length, aligned: al.length, median_cer_windowed: r3(median(al.map(x => x.m.cer))), mean_acc_windowed: r3(mean(al.map(x => x.m.acc_windowed))), mean_acc_upper: r3(mean(al.map(x => x.m.acc_upper))), catastrophic: rows.filter(x => !x.m.aligned || x.m.cer > 0.5).length };
      if (e !== REF_ENGINE) {
        const paired = lp.filter(p => p.engines[e]?.aligned && p.engines[REF_ENGINE]?.aligned);
        const wins = paired.filter(p => p.engines[e].cer < p.engines[REF_ENGINE].cer - 1e-9).length, losses = paired.filter(p => p.engines[e].cer > p.engines[REF_ENGINE].cer + 1e-9).length;
        s.paired_vs_ref = { n: paired.length, wins, losses, ties: paired.length - wins - losses, median_delta_cer: r3(median(paired.map(p => p.engines[REF_ENGINE].cer - p.engines[e].cer))), p_sign: paired.length ? r3(binomTwoSided(Math.max(wins, losses), wins + losses)) : null,
          ref_engine_aligned: lp.filter(p => p.engines[REF_ENGINE]?.aligned).length, both_unaligned: lp.filter(p => p.engines[e] && !p.engines[e].missing && !p.engines[e].aligned && p.engines[REF_ENGINE] && !p.engines[REF_ENGINE].aligned).length };
      }
      summary.languages[lang].engines[e] = s;
    }
  }
  fs.writeFileSync(path.join(OUT_DIR, `${stratum}-${date}.json`), JSON.stringify({ summary, pages }, null, 2));
  console.log(`\n## ${stratum} — ${pages.length} reference pages, ${engines.length} engines (passage-level aligner; CER = windowed lower bound on ALIGNED pages)`);
  for (const lang of langs) {
    const L = summary.languages[lang];
    console.log(`\n### ${lang} (n=${L.n})\n| engine | run | aligned | median CER | mean acc (windowed / upper) | catastrophic | paired CER vs ${REF_ENGINE} W/L/T (p) on both-aligned |\n|---|---|---|---|---|---|---|`);
    for (const e of engines) { const s = L.engines[e]; const pv = s.paired_vs_ref ? `${s.paired_vs_ref.wins}/${s.paired_vs_ref.losses}/${s.paired_vs_ref.ties} (p=${s.paired_vs_ref.p_sign}) n=${s.paired_vs_ref.n}` : '—'; console.log(`| ${e} | ${s.pages_run} | ${s.aligned} | ${s.median_cer_windowed ?? '—'} | ${s.mean_acc_windowed ?? '—'} / ${s.mean_acc_upper ?? '—'} | ${s.catastrophic} | ${pv} |`); }
  }
  return summary;
}

// ── main ───────────────────────────────────────────────────────────
const strata = fs.readdirSync(ROOT).filter(d => fs.existsSync(path.join(ROOT, d, 'out')) && (!ONLY || ONLY.includes(d)));
fs.mkdirSync(OUT_DIR, { recursive: true });
const date = new Date().toISOString().slice(0, 10);
const summaryAll = {};
for (const stratum of strata) {
  if (stratum.startsWith('ref-')) { summaryAll[stratum] = scoreRefTier(stratum); continue; }
  const cjk = CJK_STRATA.has(stratum);
  const regPath = path.join(__dirname, 'benchmark', `${stratum}.json`);
  const reg = fs.existsSync(regPath) ? JSON.parse(fs.readFileSync(regPath, 'utf8')) : null;
  const meta = new Map((reg?.pages || []).map(p => [p.slug, p]));
  const outRoot = path.join(ROOT, stratum, 'out');
  const engines = fs.readdirSync(outRoot).filter(e => fs.statSync(path.join(outRoot, e)).isDirectory()).sort();
  // Only the SEALED pages are scored: registry entries that are not spares, plus spares
  // promoted in place of a textless page. Stray images in the directory are ignored.
  const slugs = fs.readdirSync(path.join(ROOT, stratum)).filter(f => f.endsWith('.jpg')).map(f => f.replace(/\.jpg$/, '')).sort()
    .filter(s => meta.has(s) && !meta.get(s).retired && (!meta.get(s).spare || meta.get(s).promoted));
  const texts = {};   // slug -> engine -> raw text | null
  for (const s of slugs) { texts[s] = {}; for (const e of engines) { const f = path.join(outRoot, e, `${s}.txt`); texts[s][e] = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null; } }
  const refText = {};
  for (const s of slugs) { const f = path.join(REFS_DIR, `${s}.txt`); if (fs.existsSync(f)) refText[s] = fs.readFileSync(f, 'utf8'); }

  const pages = [];
  const textless = [];
  for (const s of slugs) {
    const prepped = {}; for (const e of engines) prepped[e] = texts[s][e] == null ? null : prep(texts[s][e], cjk);
    const maxContent = Math.max(0, ...engines.map(e => prepped[e]?.nContent || 0));
    if (maxContent < 30) { textless.push(s); continue; }
    const hasRef = !!refText[s];
    const ref = hasRef ? prep(refText[s], cjk) : prepped[REF_ENGINE];
    const row = { slug: s, substratum: meta.get(s)?.substratum || null, title: meta.get(s)?.title || null, year: meta.get(s)?.year || null, has_ref: hasRef, engines: {} };
    for (const e of engines) {
      const h = prepped[e];
      if (!h) { row.engines[e] = { missing: true }; continue; }
      // invention: content tokens absent from reference AND from every other engine
      const others = new Set(); if (hasRef) for (const t of ref.content) others.add(t);
      for (const o of engines) if (o !== e && prepped[o]) for (const t of prepped[o].content) others.add(t);
      const uniq = [...new Set(h.content)];
      const unsupported = uniq.filter(t => !others.has(t));
      const inv = uniq.length ? unsupported.length / uniq.length : null;
      // invention_ref: absent from the REFERENCE alone (the clean measure; needs a reference)
      let invRef = null, invRefSample = [];
      if (hasRef) { const R = new Set(ref.content); const miss = uniq.filter(t => !R.has(t)); invRef = uniq.length ? miss.length / uniq.length : null; invRefSample = miss.slice(0, 8); }
      const base = (e === REF_ENGINE && !hasRef) ? null : (ref ? compare(h, ref) : null);
      row.engines[e] = { n_content: h.nContent, empty: h.nContent < 30, ...(base || {}), invention: r3(inv), invention_ref: r3(invRef), unsupported_sample: unsupported.slice(0, 8), invention_ref_sample: invRefSample };
      // agreement with every other engine, order-free, for the reference-free strata
      row.engines[e].agree = {}; for (const o of engines) if (o !== e && prepped[o]) row.engines[e].agree[o] = r3(bagDice(h.tokens, prepped[o].tokens));
    }
    // REFERENCE MISMATCH guard: a window from the wrong edition (a commentary edition where the
    // page prints the bare sutra, say) makes EVERY engine look catastrophic. If no engine gets
    // within 0.5 CER of the reference, the reference is judged unreliable for this page and the
    // page falls back to the proxy comparison — recorded, never averaged in as an engine fault.
    if (hasRef) {
      const best = Math.min(...engines.map(e => row.engines[e]?.cer ?? Infinity));
      if (!(best <= 0.5)) {
        row.ref_mismatch = true; row.has_ref = false;
        const proxy = prepped[REF_ENGINE];
        for (const e of engines) { const h = prepped[e]; if (!h) continue; const base = (e === REF_ENGINE) ? null : (proxy ? compare(h, proxy) : null); const keep = row.engines[e]; row.engines[e] = { n_content: keep.n_content, empty: keep.empty, ...(base || {}), invention: keep.invention, invention_ref: null, unsupported_sample: keep.unsupported_sample, invention_ref_sample: [], agree: keep.agree }; }
      }
    }
    pages.push(row);
  }

  // ── roll-up per engine ──
  const summary = { stratum, issue: reg?.issue || null, date, n_pages: pages.length, n_with_ref: pages.filter(p => p.has_ref).length, ref_mismatch: pages.filter(p => p.ref_mismatch).map(p => p.slug), textless, ref_engine: REF_ENGINE, engines: {} };
  for (const e of engines) {
    const rows = pages.map(p => ({ p, m: p.engines[e] })).filter(x => x.m && !x.m.missing);
    const withRef = rows.filter(x => x.p.has_ref && x.m.cer != null);
    const proxy = rows.filter(x => !x.p.has_ref && x.m.cer != null);
    const s = {
      pages_run: rows.length, empty: rows.filter(x => x.m.empty).length,
      ref: { n: withRef.length, median_cer: r3(median(withRef.map(x => x.m.cer))), mean_cer: r3(mean(withRef.map(x => x.m.cer))), catastrophic: withRef.filter(x => x.m.cer > 0.5).length, median_gap: r3(median(withRef.map(x => x.m.gap))), median_seq: r3(median(withRef.map(x => x.m.seq))) },
      proxy_vs_ref_engine: { n: proxy.length, median_cer: r3(median(proxy.map(x => x.m.cer))), catastrophic: proxy.filter(x => x.m.cer > 0.5).length, median_gap: r3(median(proxy.map(x => x.m.gap))), median_bow: r3(median(proxy.map(x => x.m.bow))) },
      invention: { median: r3(median(rows.map(x => x.m.invention))), mean: r3(mean(rows.map(x => x.m.invention))), n_engines: engines.length,
        ref_median: r3(median(withRef.map(x => x.m.invention_ref))), ref_mean: r3(mean(withRef.map(x => x.m.invention_ref))) },
    };
    // paired vs REF_ENGINE on pages with a reference (both present)
    if (e !== REF_ENGINE) {
      const paired = pages.filter(p => p.has_ref && p.engines[e]?.cer != null && p.engines[REF_ENGINE]?.cer != null);
      const wins = paired.filter(p => p.engines[e].cer < p.engines[REF_ENGINE].cer - 1e-9).length;
      const losses = paired.filter(p => p.engines[e].cer > p.engines[REF_ENGINE].cer + 1e-9).length;
      const deltas = paired.map(p => p.engines[REF_ENGINE].cer - p.engines[e].cer);
      s.paired_vs_ref = { n: paired.length, wins, losses, ties: paired.length - wins - losses, median_delta_cer: r3(median(deltas)), p_sign: paired.length ? r3(binomTwoSided(Math.max(wins, losses), wins + losses)) : null,
        invention_wins: paired.filter(p => p.engines[e].invention_ref < p.engines[REF_ENGINE].invention_ref).length, invention_losses: paired.filter(p => p.engines[e].invention_ref > p.engines[REF_ENGINE].invention_ref).length };
    }
    // worst five: by CER when a reference exists, else by proxy CER, else by invention
    const key = x => x.m.cer != null ? x.m.cer : (x.m.invention ?? 0);
    s.worst = rows.filter(x => x.m.cer != null || x.m.invention != null).sort((a, b) => key(b) - key(a)).slice(0, 5).map(x => ({ slug: x.p.slug, title: x.p.title, year: x.p.year, cer: x.m.cer, gap: x.m.gap, invention: x.m.invention, has_ref: x.p.has_ref, unsupported: x.m.unsupported_sample }));
    summary.engines[e] = s;
  }
  summaryAll[stratum] = summary;
  fs.writeFileSync(path.join(OUT_DIR, `${stratum}-${date}.json`), JSON.stringify({ summary, pages }, null, 2));

  // ── console table ──
  console.log(`\n## ${stratum} (#${summary.issue}) — ${pages.length} pages scored (${summary.n_with_ref} with reference; ${summary.ref_mismatch.length} reference-mismatch → proxy: ${summary.ref_mismatch.join(', ') || '—'}), ${textless.length} textless: ${textless.join(', ') || '—'}`);
  console.log('| engine | pages | empty | ref n | median CER | catastrophic | median gap | invention (vs ref) | vs ref-engine (proxy) n / median CER / catastrophic | unsupported (vs other engines) | paired CER vs ' + REF_ENGINE + ' W/L/T (p) | invention W/L |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const e of engines) {
    const s = summary.engines[e];
    const pv = s.paired_vs_ref ? `${s.paired_vs_ref.wins}/${s.paired_vs_ref.losses}/${s.paired_vs_ref.ties} (p=${s.paired_vs_ref.p_sign})` : '—';
    const iv = s.paired_vs_ref ? `${s.paired_vs_ref.invention_wins}/${s.paired_vs_ref.invention_losses}` : '—';
    console.log(`| ${e} | ${s.pages_run} | ${s.empty} | ${s.ref.n} | ${s.ref.median_cer ?? '—'} | ${s.ref.catastrophic} | ${s.ref.median_gap ?? '—'} | ${s.invention.ref_median ?? '—'} | ${s.proxy_vs_ref_engine.n} / ${s.proxy_vs_ref_engine.median_cer ?? '—'} / ${s.proxy_vs_ref_engine.catastrophic} | ${s.invention.median ?? '—'} | ${pv} | ${iv} |`);
  }
  // worst pages, excerpts for reading by eye
  for (const e of engines) {
    console.log(`\n### worst 5 — ${e}`);
    for (const w of summary.engines[e].worst) {
      const src = refText[w.slug] || texts[w.slug][REF_ENGINE] || '';
      console.log(`- ${w.slug} (${w.year || '?'}, ${(w.title || '').slice(0, 50)}) CER ${w.cer ?? '—'} gap ${w.gap ?? '—'} inv ${w.invention ?? '—'} ${w.has_ref ? '[ref]' : '[proxy]'}`);
      console.log(`    ENGINE: ${(texts[w.slug][e] || '').replace(/\s+/g, ' ').slice(0, 300)}`);
      console.log(`    ${w.has_ref ? 'REF' : REF_ENGINE}: ${src.replace(/\s+/g, ' ').slice(0, 300)}`);
    }
  }
}
fs.writeFileSync(path.join(OUT_DIR, `summary-${date}.json`), JSON.stringify(summaryAll, null, 2));
console.log(`\nwrote ${OUT_DIR}/summary-${date}.json`);
