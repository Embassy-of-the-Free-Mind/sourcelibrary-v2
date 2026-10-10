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
 * A page is TEXTLESS when every engine returns < 30 content characters and none REFUSED it; it is
 * excluded and listed, never averaged in.
 *
 * REFUSALS (#5581). A page whose output is empty because the engine declined it (Gemini
 * finishReason RECITATION / PROHIBITED_CONTENT / SAFETY …) is `refused`, which is not `empty`.
 * The source is the run's own record — <engine>/_meter.jsonl, written by benchmark-run-api.mjs,
 * last row per slug. Where an API engine left no meter row, a refusal is INFERRED from a zero-byte
 * output on a page with a substantial reference (≥ 200 reference characters), and labelled so.
 * An empty output is never inferred to be a refusal from the normalised text: the Greek strata
 * count Greek letters only, and Gemini returns genuinely empty STOP outputs on some Japanese leaves.
 * CER is reported twice — with a refusal counted as CER 1.0 (the pre-#5581 headline, unchanged) and
 * over answered pages — and the paired sign test runs on pages BOTH engines answered, with its n
 * and the number of pages a refusal took out of it. A page every engine refused is kept (it is not
 * textless, and it is not a reference mismatch).
 *
 *   --refusals-only  read the meters and write results/benchmark/refusals/refusals-<date>.json
 *                    without re-scoring: for a machine that holds only some engines' outputs,
 *                    where a re-score would silently drop the others from the committed results.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadRefText } from './lib/private-refs.mjs';
import { levenshtein, normalizeCJK, scoreAgainstReference } from './lib/metrics.mjs';
import { binomTwoSided } from './lib/paired-stats.mjs';
import { stripMarkupTags } from '../lib/strip-markup-tags.mjs';
import { readMeter, refusalOf } from './lib/refusals.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const argOf = (n, d) => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const ROOT = argOf('root');
const REF_ENGINE = argOf('ref', 'gemini-3.1-flash-lite');
const OUT_DIR = argOf('out', path.join(__dirname, 'results', 'benchmark'));
const REPEATS = argOf('repeat', 'gemini-3.1-flash-lite-b').split(',').filter(Boolean);
// a repeat arm is named <engine>-b; twins never count as independent support for each other
const isTwin = (a, b) => (REPEATS.includes(a) && a.replace(/-b$/, '') === b) || (REPEATS.includes(b) && b.replace(/-b$/, '') === a);
const ONLY = argOf('stratum') ? argOf('stratum').split(',') : null;
// --refs-dir: a folded copy of the references (#5924's latin-norm@1 view); default unchanged
const REFS_DIR = argOf('refs-dir', path.join(__dirname, 'benchmark', 'refs'));
if (!ROOT) { console.error('--root required'); process.exit(1); }

// ── normalisation ──────────────────────────────────────────────────
const CJK_STRATA = new Set(['chinese', 'chinese-ext', 'chinese-cohort-5547', 'japanese', 'japanese-ext']);
function normAlpha(s) {
  // Tags out WITHOUT eating the body after a ->centred<- line (#5564).
  return stripMarkupTags(String(s || '')
    .replace(/<(warning|meta|image-desc|figure|note|scan-quality|language|page-type|columns|detected-images|vocab)\b[^>]*>[\s\S]*?<\/\1>/gi, ' '))
    .replace(/```[a-z]*/g, ' ')
    .normalize('NFC').toLowerCase().replace(/ſ/g, 's').replace(/[’‘ʼ`´]/g, "'").replace(/[“”„]/g, '"')
    .replace(/[‐‑‒–—―¬]/g, '-').replace(/(\p{L})-\s*\n\s*/gu, '$1')   // rejoin hyphenated line breaks
    .replace(/\s+/g, ' ').trim();
}
const tokensAlpha = s => (s.match(/[\p{L}\p{N}']+/gu) || []);
const lettersOnly = s => s.replace(/[^\p{L}\p{N}]+/gu, '');
// Kyūjitai → shinjitai folding for CJK scoring: NDL classical OCR writes modern forms (気 for 氣, 発 for 發,
// 伝 for 傳…) while the page and the Gemini arms carry the traditional ones; without folding every such
// glyph is a CER "error" that is an orthographic convention, not a misread. Common pairs only; extend as met.
const KYU_SHIN = '氣気觸触發発傳伝禮礼醫医體体國国學学會会當当對対經経藥薬寶宝齊斉齋斎變変邊辺圓円廣広應応惡悪榮栄營営藝芸壓圧鹽塩澤沢擇択譯訳驛駅釋釈澁渋濕湿實実寫写收収從従縱縦讀読續続賣売讓譲亂乱亞亜圍囲爲為僞偽衞衛舊旧兒児條条處処與与齒歯齡齢壽寿圖図團団晝昼點点黨党燈灯獨独樂楽靈霊勞労勵励歷歴曆暦龍竜隸隷兩両獵猟錄録麥麦滿満萬万默黙彌弥譽誉餘余豫予嚴厳髓髄隨随數数樞枢聲声靜静濟済劑剤攝摂淺浅錢銭賤賎踐践纖繊專専戰戦禪禅單単彈弾斷断遲遅廳庁徵徴聽聴鎭鎮鐵鉄轉転屆届縣県驗験險険檢検劍剣顯顕權権勸勧觀観歡歓鑛鉱鑄鋳絲糸獸獣敍叙將将奬奨狀状乘乗剩剰淨浄燒焼稱称證証囑嘱眞真盡尽竊窃說説拜拝廢廃佛仏拂払辯弁辨弁步歩豐豊每毎黑黒龜亀假仮價価繪絵壞壊懷懐覺覚舉挙歸帰據拠徑径輕軽莖茎繼継惠恵鷄鶏缺欠儉倹圈圏獻献效効號号碎砕櫻桜參参慘惨產産蠶蚕贊賛殘残辭辞肅粛緖緒涉渉疊畳醉酔雙双壯壮莊荘裝装藏蔵臟臓總総騷騒增増屬属帶帯滯滞臺台擔担膽胆蟲虫貳弐惱悩腦脳霸覇髮髪拔抜晚晩蠻蛮濱浜搖揺樣様謠謡來来賴頼覽覧樓楼灣湾淚涙沒没稻稲廐厩冨富鬪闘關関陷陥隱隠靑青淸清敎教卽即槪概旣既溉漑硏研卷巻內内册冊咒呪曾曽溫温縕緼醬醤獎奨妝粧姊姉曉暁迴回廻回瀧滝籠篭鬭闘';
const KYU_MAP = new Map(); for (let i = 0; i + 1 < KYU_SHIN.length; i += 2) KYU_MAP.set(KYU_SHIN[i], KYU_SHIN[i + 1]);
const foldVariants = (s) => { let o = ''; for (const ch of s) o += KYU_MAP.get(ch) || ch; return o; };
function normCJK(s) {
  s = foldVariants(s);
  // Han + kana + Hangul kept; Latin digits dropped; punctuation and layout dropped (normalizeCJK
  // keeps only Han/ideographic — extend for kana so Japanese pages are scored on their kana too).
  const t = stripMarkupTags(s).normalize('NFC');
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

// GREEK strata score the GREEK letters only (#4925 step 2, preregistered): a Greek cell's reference
// is the Greek e-text, while 42 of the 80 drawn 1700–1799 leaves are Greek–Latin parallel pages.
// With the whole output in the Levenshtein, the Latin half is charged as insertions to EVERY engine
// (CER ≥ 0.5 → the mismatch guard demotes the page) — the metric would measure layout, not reading.
// Tokens are kept if they contain a Greek letter; Latin words are neither counted nor credited.
const GREEK_STRATA = new Set(['greek', 'greek-ext']);
const greekOnly = s => s.replace(/[^\p{Script=Greek}]+/gu, '');
const hasGreek = t => /\p{Script=Greek}/u.test(t);
// Diacritic fold for the secondary Greek CER: decompose, drop combining marks, lower-case, final sigma → sigma.
const foldGreek = s => s.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase().replace(/ς/g, 'σ');
// MARK strata keep combining marks (#6011): Devanagari vowel signs and virama, Arabic and Hebrew points are
// \p{M}, so lettersOnly drops them and tokensAlpha splits a Devanagari word at every matra. Preregistered in
// PREREGISTRATION-engine-wave1-6011.md; the existing strata are scored exactly as before.
const MARK_STRATA = new Set(['a5-nonlatin-5700']);
const tokensMarked = s => (s.match(/[\p{L}\p{M}\p{N}']+/gu) || []);
const lettersMarked = s => s.replace(/[^\p{L}\p{M}\p{N}]+/gu, '');
function prep(text, cjk, greek = false, marks = false) {
  if (cjk) { const n = normCJK(text).slice(0, CAP); return { chars: n, tokens: cjkTokens(n), content: cjkGrams(n, 3), nContent: n.length }; }
  const n = normAlpha(text).slice(0, CAP); const toks = greek ? tokensAlpha(n).filter(hasGreek) : marks ? tokensMarked(n) : tokensAlpha(n);
  const letters = greek ? greekOnly(n) : marks ? lettersMarked(n) : lettersOnly(n);
  return { chars: letters, tokens: toks, content: toks.filter(t => lettersOnly(t).length >= 4), nContent: letters.length };
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
  const meters = Object.fromEntries(engines.map(e => [e, readMeter(path.join(outRoot, e))]));
  const pages = [];
  for (const g of gts) {
    const script = g.script === 'cjk' || g.script === 'chinese' ? 'cjk' : (g.script || 'latin');
    const row = { slug: g.slug, language: g.language, script, year: g.year || null, tier: g.tier || 'pinned', non_canonical: !!g.non_canonical, engines: {} };
    for (const e of engines) {
      const f = path.join(outRoot, e, `${g.slug}.txt`);
      if (!fs.existsSync(f)) { row.engines[e] = { missing: true }; continue; }
      const hyp = fs.readFileSync(f, 'utf8');
      const rf = refusalOf({ engine: e, meterRow: meters[e]?.get(g.slug), rawText: hyp, refChars: g.ocr_ground_truth.length });
      // A refused page is never aligned (there is nothing to place); it is recorded, not scored.
      if (rf.refused) { row.engines[e] = { aligned: false, refused: true, refusal_source: rf.source, ...(rf.finish_reason ? { finish_reason: rf.finish_reason } : {}), chars: hyp.length }; continue; }
      let r; try { r = scoreAgainstReference(g.ocr_ground_truth, hyp, script); } catch (err) { row.engines[e] = { error: err.message.slice(0, 80) }; continue; }
      row.engines[e] = { aligned: r.aligned, refused: false, guard: r3(r.guard?.value), acc_upper: r3(r.charAccuracy), acc_windowed: r3(r.charAccuracyWindowed), cer: r3(r.charAccuracyWindowed == null ? null : 1 - r.charAccuracyWindowed), span_dispersion: r.spanDispersion ?? null, chars: hyp.length };
    }
    pages.push(row);
  }
  const langs = [...new Set(pages.map(p => p.language))].sort();
  const summary = { stratum, date, refusal_source: 'finishReason (meter) / inferred', cer_refusals: 'median_cer_windowed / mean_acc_windowed are over ALIGNED pages (refusals excluded, as before #5581); *_refusals_as_1 add each refused page at CER 1.0', n_pages: pages.length, ref_engine: REF_ENGINE, languages: {} };
  for (const lang of langs) {
    const lp = pages.filter(p => p.language === lang);
    summary.languages[lang] = { n: lp.length, engines: {} };
    for (const e of engines) {
      const rows = lp.map(p => ({ p, m: p.engines[e] })).filter(x => x.m && !x.m.missing && !x.m.error);
      const al = rows.filter(x => x.m.aligned);
      const refused = rows.filter(x => x.m.refused);
      const withRefusals = [...al.map(x => x.m.cer), ...refused.map(() => 1)];
      const s = { pages_run: rows.length, aligned: al.length, refused: refused.length, refused_inferred: refused.filter(x => x.m.refusal_source === 'inferred').length,
        median_cer_windowed: r3(median(al.map(x => x.m.cer))), mean_cer_windowed: r3(mean(al.map(x => x.m.cer))), mean_acc_windowed: r3(mean(al.map(x => x.m.acc_windowed))), mean_acc_upper: r3(mean(al.map(x => x.m.acc_upper))),
        median_cer_refusals_as_1: r3(median(withRefusals)), mean_cer_refusals_as_1: r3(mean(withRefusals)),
        catastrophic: rows.filter(x => !x.m.aligned || x.m.cer > 0.5).length, catastrophic_answered: rows.filter(x => !x.m.refused && (!x.m.aligned || x.m.cer > 0.5)).length };
      if (e !== REF_ENGINE) {
        const paired = lp.filter(p => p.engines[e]?.aligned && p.engines[REF_ENGINE]?.aligned);
        const wins = paired.filter(p => p.engines[e].cer < p.engines[REF_ENGINE].cer - 1e-9).length, losses = paired.filter(p => p.engines[e].cer > p.engines[REF_ENGINE].cer + 1e-9).length;
        const excludedRefused = lp.filter(p => (p.engines[e]?.refused && (p.engines[REF_ENGINE]?.aligned || p.engines[REF_ENGINE]?.refused)) || (p.engines[REF_ENGINE]?.refused && p.engines[e]?.aligned)).length;
        s.paired_vs_ref = { n: paired.length, excluded_refused: excludedRefused, wins, losses, ties: paired.length - wins - losses, median_delta_cer: r3(median(paired.map(p => p.engines[REF_ENGINE].cer - p.engines[e].cer))), p_sign: paired.length ? r3(binomTwoSided(Math.max(wins, losses), wins + losses)) : null,
          ref_engine_aligned: lp.filter(p => p.engines[REF_ENGINE]?.aligned).length, both_unaligned: lp.filter(p => p.engines[e] && !p.engines[e].missing && !p.engines[e].aligned && p.engines[REF_ENGINE] && !p.engines[REF_ENGINE].aligned).length };
      }
      summary.languages[lang].engines[e] = s;
    }
  }
  fs.writeFileSync(path.join(OUT_DIR, `${stratum}-${date}.json`), JSON.stringify({ summary, pages }, null, 2));
  console.log(`\n## ${stratum} — ${pages.length} reference pages, ${engines.length} engines (passage-level aligner; CER = windowed lower bound on ALIGNED pages)`);
  for (const lang of langs) {
    const L = summary.languages[lang];
    console.log(`\n### ${lang} (n=${L.n})\n| engine | run | aligned | refused | median CER (aligned) | mean CER aligned / refusal = 1.0 | mean acc (windowed / upper) | catastrophic | paired CER vs ${REF_ENGINE} W/L/T (p) on both-aligned |\n|---|---|---|---|---|---|---|---|---|`);
    for (const e of engines) { const s = L.engines[e]; if (!s.pages_run) continue; const pv = s.paired_vs_ref ? `${s.paired_vs_ref.wins}/${s.paired_vs_ref.losses}/${s.paired_vs_ref.ties} (p=${s.paired_vs_ref.p_sign}) n=${s.paired_vs_ref.n}${s.paired_vs_ref.excluded_refused ? `, ${s.paired_vs_ref.excluded_refused} refused excluded` : ''}` : '—'; console.log(`| ${e} | ${s.pages_run} | ${s.aligned} | ${s.refused} | ${s.median_cer_windowed ?? '—'} | ${s.mean_cer_windowed ?? '—'} / ${s.mean_cer_refusals_as_1 ?? '—'} | ${s.mean_acc_windowed ?? '—'} / ${s.mean_acc_upper ?? '—'} | ${s.catastrophic} | ${pv} |`); }
  }
  return summary;
}

// ── main ───────────────────────────────────────────────────────────
const strata = fs.readdirSync(ROOT).filter(d => fs.existsSync(path.join(ROOT, d, 'out')) && (!ONLY || ONLY.includes(d)));
fs.mkdirSync(OUT_DIR, { recursive: true });
const date = new Date().toISOString().slice(0, 10);
const summaryAll = {};

// --refusals-only: the refusal record alone, read from the meters, no re-score (see header).
if (process.argv.includes('--refusals-only')) {
  const out = { date, issue: 5581, reasons: 'finishReason in RECITATION|PROHIBITED_CONTENT|SAFETY|BLOCKLIST|SPII|IMAGE_SAFETY with an empty output; else inferred (API engine, zero-byte output, reference ≥ 200 chars)', strata: {} };
  for (const stratum of strata) {
    const outRoot = path.join(ROOT, stratum, 'out');
    const tier = stratum.startsWith('ref-');
    const gtDir = tier ? path.join(__dirname, stratum === 'ref-pinned' ? 'ground-truth' : 'ground-truth-ws') : null;
    const refChars = (slug) => {
      if (tier) { const f = path.join(gtDir, `${slug}.json`); return fs.existsSync(f) ? String(JSON.parse(fs.readFileSync(f, 'utf8')).ocr_ground_truth || '').length : 0; }
      return loadRefText(REFS_DIR, slug).text?.length || 0;
    };
    for (const e of fs.readdirSync(outRoot).filter(e => fs.statSync(path.join(outRoot, e)).isDirectory()).sort()) {
      const dir = path.join(outRoot, e);
      const slugs = fs.readdirSync(dir).filter(f => f.endsWith('.txt')).map(f => f.slice(0, -4)).sort();
      if (!slugs.length) continue;
      const meter = readMeter(dir);
      const refused = {}, inferred = [];
      for (const s of slugs) {
        const raw = fs.readFileSync(path.join(dir, `${s}.txt`), 'utf8');
        const r = refusalOf({ engine: e, meterRow: meter?.get(s), rawText: raw, refChars: raw.length ? 0 : refChars(s) });
        if (r.refused && r.source === 'inferred') inferred.push(s); else if (r.refused) refused[s] = r.finish_reason;
      }
      (out.strata[stratum] ||= {})[e] = { outputs: slugs.length, meter: !!meter, refused, inferred };
    }
  }
  const dir = path.join(OUT_DIR, 'refusals');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `refusals-${date}.json`), JSON.stringify(out, null, 2) + '\n');
  for (const [s, es] of Object.entries(out.strata)) for (const [e, v] of Object.entries(es)) if (Object.keys(v.refused).length || v.inferred.length) console.log(`${s} / ${e}: ${Object.keys(v.refused).length} refused, ${v.inferred.length} inferred (of ${v.outputs})`);
  console.log(`wrote ${path.join(dir, `refusals-${date}.json`)}`);
  process.exit(0);
}
for (const stratum of strata) {
  if (stratum.startsWith('ref-')) { summaryAll[stratum] = scoreRefTier(stratum); continue; }
  const cjk = CJK_STRATA.has(stratum), greek = GREEK_STRATA.has(stratum), marks = MARK_STRATA.has(stratum);
  const regPath = path.join(__dirname, 'benchmark', `${stratum}.json`);
  const reg = fs.existsSync(regPath) ? JSON.parse(fs.readFileSync(regPath, 'utf8')) : null;
  // english-ia-5124 (#5216) keeps its registry as `rows` (catalogue nested); a referenced, non-excluded row is a sealed page
  const regPages = reg?.pages || (reg?.rows || []).filter(r => r.reference && !r.excluded).map(r => ({ slug: r.slug, substratum: r.substratum || null, title: r.catalogue?.title || null, year: r.catalogue?.published ?? null }));
  const meta = new Map(regPages.map(p => [p.slug, p]));
  const outRoot = path.join(ROOT, stratum, 'out');
  const engines = fs.readdirSync(outRoot).filter(e => fs.statSync(path.join(outRoot, e)).isDirectory() && fs.readdirSync(path.join(outRoot, e)).some(f => f.endsWith('.txt'))).sort();
  // SCRIPT CLASS per page (out/script-class/<slug>.json, written by the flash-preview page classifier and
  // spot-checked by eye): what is physically on the page — typeset / woodblock / cursive / other. The
  // catalogue year is the WORK's date (a 1716 Hagakure is a modern typeset reprint), so the per-class
  // roll-up below is the one that answers "does engine X read kuzushiji".
  const classDir = path.join(outRoot, 'script-class');
  const classOf = new Map(); const leafOf = new Map(); const shareOf = new Map();   // leaf_language: the LEAF's language by eye (a Chinese title can hold a kanbun reprint); greek_share: the by-eye Greek share in tenths (Greek strata — a parallel Greek–Latin leaf is `mixed` and enters a Greek cell at ≥ 0.5)
  if (fs.existsSync(classDir)) for (const f of fs.readdirSync(classDir).filter(f => f.endsWith('.json'))) { try { const j = JSON.parse(fs.readFileSync(path.join(classDir, f), 'utf8')); classOf.set(f.replace(/\.json$/, ''), j.script_class || null); if (j.leaf_language) leafOf.set(f.replace(/\.json$/, ''), j.leaf_language); if (typeof j.greek_share === 'number') shareOf.set(f.replace(/\.json$/, ''), j.greek_share); } catch { /* unparsed */ } }
  // Only the SEALED pages are scored: registry entries that are not spares, plus spares
  // promoted in place of a textless page. Stray images in the directory are ignored.
  const slugs = fs.readdirSync(path.join(ROOT, stratum)).filter(f => f.endsWith('.jpg')).map(f => f.replace(/\.jpg$/, '')).sort()
    .filter(s => meta.has(s) && !meta.get(s).retired && (!meta.get(s).spare || meta.get(s).promoted));
  const texts = {};   // slug -> engine -> raw text | null
  for (const s of slugs) { texts[s] = {}; for (const e of engines) { const f = path.join(outRoot, e, `${s}.txt`); texts[s][e] = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null; } }
  const refText = {};
  const privateSkips = {};   // in-copyright references whose text is not on this machine (#5488)
  for (const s of slugs) {
    const r = loadRefText(REFS_DIR, s);
    if (r.text != null) refText[s] = r.text;
    else if (r.skipped !== 'no-reference') privateSkips[r.skipped] = (privateSkips[r.skipped] || 0) + 1;
  }
  if (Object.keys(privateSkips).length) console.warn(`  ${stratum}: private references not scored here: ${JSON.stringify(privateSkips)} (set SL_PRIVATE_REFS_DIR)`);
  const meters = Object.fromEntries(engines.map(e => [e, readMeter(path.join(outRoot, e))]));
  const refusal = {};   // slug -> engine -> { refused, source, finish_reason }
  for (const s of slugs) { refusal[s] = {}; for (const e of engines) refusal[s][e] = refusalOf({ engine: e, meterRow: meters[e]?.get(s), rawText: texts[s][e], refChars: refText[s]?.length || 0 }); }

  const pages = [];
  const textless = [];
  for (const s of slugs) {
    const prepped = {}; for (const e of engines) prepped[e] = texts[s][e] == null ? null : prep(texts[s][e], cjk, greek, marks);
    const maxContent = Math.max(0, ...engines.map(e => prepped[e]?.nContent || 0));
    const anyRefused = engines.some(e => refusal[s][e].refused);
    if (maxContent < 30 && !anyRefused) { textless.push(s); continue; }
    const hasRef = !!refText[s];
    const ref = hasRef ? prep(refText[s], cjk, greek, marks) : prepped[REF_ENGINE];
    const row = { slug: s, substratum: meta.get(s)?.substratum || null, script_class: classOf.get(s) || meta.get(s)?.observed_substratum || null, leaf_language: leafOf.get(s) || null, ...(shareOf.has(s) ? { greek_share: shareOf.get(s) } : {}), title: meta.get(s)?.title || null, year: meta.get(s)?.year || null, has_ref: hasRef, engines: {} };
    // LOOP: the failure kind a CER against a proxy cannot see (both arms loop on kuzushiji; flash-preview
    // wrote 448 lines for a 35-line Serto page). Repeated non-blank lines ≥ 30 % with ≥ 5 lines, or an
    // output more than 3× the median length of the other engines' and over 2,000 characters.
    const lens = engines.map(e => texts[s][e]?.length || 0);
    const loopOf = (e) => { const t = texts[s][e] || ''; const lines = t.split('\n').map(l => l.trim()).filter(Boolean); const rep = lines.length >= 5 ? 1 - new Set(lines).size / lines.length : 0; const others = lens.filter((_, i) => engines[i] !== e && lens[i] > 0); const med = median(others) || 0; return rep >= 0.3 || (t.length > 2000 && med > 0 && t.length > 3 * med); };
    for (const e of engines) {
      const h = prepped[e];
      if (!h) { row.engines[e] = { missing: true }; continue; }
      // invention: content tokens absent from reference AND from every other engine
      const others = new Set(); if (hasRef) for (const t of ref.content) others.add(t);
      for (const o of engines) if (o !== e && prepped[o]) for (const t of prepped[o].content) others.add(t);
      const uniq = [...new Set(h.content)];
      const unsupported = uniq.filter(t => !others.has(t));
      const inv = uniq.length ? unsupported.length / uniq.length : null;
      // invention_indep: the same measure, but a REPEAT arm may not vouch for its twin. At temperature 0
      // lite and lite-b are byte-identical on ~86 % of pages, so `invention` is structurally 0 for lite
      // (47/52 Greek pages) and any rule comparing an arm's invention to lite's can never pass (#4925 step 2).
      const indep = new Set(); if (hasRef) for (const t of ref.content) indep.add(t);
      for (const o of engines) if (o !== e && !isTwin(e, o) && prepped[o]) for (const t of prepped[o].content) indep.add(t);
      const invIndep = uniq.length ? uniq.filter(t => !indep.has(t)).length / uniq.length : null;
      // invention_ref: absent from the REFERENCE alone (the clean measure; needs a reference)
      let invRef = null, invRefSample = [];
      if (hasRef) { const R = new Set(ref.content); const miss = uniq.filter(t => !R.has(t)); invRef = uniq.length ? miss.length / uniq.length : null; invRefSample = miss.slice(0, 8); }
      const base = (e === REF_ENGINE && !hasRef) ? null : (ref ? compare(h, ref) : null);
      const rf = refusal[s][e];
      row.engines[e] = { n_content: h.nContent, empty: h.nContent < 30, refused: rf.refused, ...(rf.refused ? { refusal_source: rf.source } : {}), ...(rf.finish_reason && rf.finish_reason !== 'STOP' ? { finish_reason: rf.finish_reason } : {}), loop: loopOf(e), ...(base || {}), invention: r3(inv), invention_indep: r3(invIndep), invention_ref: r3(invRef), unsupported_sample: unsupported.slice(0, 8), invention_ref_sample: invRefSample };
      // Greek strata, referenced pages: a SECONDARY, exploratory CER with accents, breathings and
      // iota subscript folded away (PREREGISTRATION-greek-ext-4925.md, References §c) — the e-text
      // is an edition of the WORK, and its diacritic conventions differ from a 1550 page's; the
      // primary CER keeps diacritics.
      if (greek && hasRef && base && ref.chars.length) { const hf = [...foldGreek(h.chars)], rf = [...foldGreek(ref.chars)]; if (rf.length) row.engines[e].cer_folded = r3(levenshtein(hf, rf) / rf.length); }
      // agreement with every other engine, order-free, for the reference-free strata
      row.engines[e].agree = {}; for (const o of engines) if (o !== e && prepped[o]) row.engines[e].agree[o] = r3(bagDice(h.tokens, prepped[o].tokens));
    }
    // REFERENCE MISMATCH guard: a window from the wrong edition (a commentary edition where the
    // page prints the bare sutra, say) makes EVERY engine look catastrophic. If no engine gets
    // within 0.5 CER of the reference, the reference is judged unreliable for this page and the
    // page falls back to the proxy comparison — recorded, never averaged in as an engine fault.
    // A refusal says nothing about the reference, so it neither triggers nor blocks the guard; a
    // page every engine refused stays referenced (its CER is 1.0 for each, counted as refusals).
    const answered = engines.filter(e => row.engines[e] && !row.engines[e].missing && !row.engines[e].refused);
    if (hasRef && answered.length) {
      const best = Math.min(...answered.map(e => row.engines[e]?.cer ?? Infinity));
      if (!(best <= 0.5)) {
        row.ref_mismatch = true; row.has_ref = false;
        const proxy = prepped[REF_ENGINE];
        for (const e of engines) { const h = prepped[e]; if (!h) continue; const base = (e === REF_ENGINE) ? null : (proxy ? compare(h, proxy) : null); const keep = row.engines[e]; row.engines[e] = { n_content: keep.n_content, empty: keep.empty, refused: keep.refused, ...(keep.refusal_source ? { refusal_source: keep.refusal_source } : {}), ...(keep.finish_reason ? { finish_reason: keep.finish_reason } : {}), loop: keep.loop, ...(base || {}), invention: keep.invention, invention_ref: null, unsupported_sample: keep.unsupported_sample, invention_ref_sample: [], agree: keep.agree }; }
      }
    }
    pages.push(row);
  }

  // ── roll-up per engine ──
  const summary = { stratum, issue: reg?.issue || null, date, refusal_source: 'finishReason (meter) / inferred', cer_refusals: 'ref.median_cer / mean_cer count a refusal as CER 1.0 (the pre-#5581 headline); *_answered exclude refused pages', n_pages: pages.length, n_with_ref: pages.filter(p => p.has_ref).length, ref_mismatch: pages.filter(p => p.ref_mismatch).map(p => p.slug), textless, ref_engine: REF_ENGINE, engines: {} };
  for (const e of engines) {
    const rows = pages.map(p => ({ p, m: p.engines[e] })).filter(x => x.m && !x.m.missing);
    const withRef = rows.filter(x => x.p.has_ref && x.m.cer != null);
    const proxy = rows.filter(x => !x.p.has_ref && x.m.cer != null);
    const refAns = withRef.filter(x => !x.m.refused), proxyAns = proxy.filter(x => !x.m.refused);
    const s = {
      pages_run: rows.length, empty: rows.filter(x => x.m.empty && !x.m.refused).length, refused: rows.filter(x => x.m.refused).length,
      refused_inferred: rows.filter(x => x.m.refused && x.m.refusal_source === 'inferred').length, loop: rows.filter(x => x.m.loop).length,
      ref: { n: withRef.length, median_cer: r3(median(withRef.map(x => x.m.cer))), mean_cer: r3(mean(withRef.map(x => x.m.cer))), catastrophic: withRef.filter(x => x.m.cer > 0.5).length, median_gap: r3(median(withRef.map(x => x.m.gap))), median_seq: r3(median(withRef.map(x => x.m.seq))),
        refused: withRef.length - refAns.length, n_answered: refAns.length, median_cer_answered: r3(median(refAns.map(x => x.m.cer))), mean_cer_answered: r3(mean(refAns.map(x => x.m.cer))), catastrophic_answered: refAns.filter(x => x.m.cer > 0.5).length },
      proxy_vs_ref_engine: { n: proxy.length, median_cer: r3(median(proxy.map(x => x.m.cer))), catastrophic: proxy.filter(x => x.m.cer > 0.5).length, median_gap: r3(median(proxy.map(x => x.m.gap))), median_bow: r3(median(proxy.map(x => x.m.bow))),
        refused: proxy.length - proxyAns.length, n_answered: proxyAns.length, median_cer_answered: r3(median(proxyAns.map(x => x.m.cer))), mean_cer: r3(mean(proxy.map(x => x.m.cer))), mean_cer_answered: r3(mean(proxyAns.map(x => x.m.cer))) },
      invention: { median: r3(median(rows.map(x => x.m.invention))), mean: r3(mean(rows.map(x => x.m.invention))), n_engines: engines.length,
        ref_median: r3(median(withRef.map(x => x.m.invention_ref))), ref_mean: r3(mean(withRef.map(x => x.m.invention_ref))) },
    };
    // paired vs REF_ENGINE on pages with a reference (both present)
    if (e !== REF_ENGINE) {
      // on pages BOTH engines answered: a refusal is not a misread, and is counted in `refused` instead
      const bothScored = pages.filter(p => p.has_ref && p.engines[e]?.cer != null && p.engines[REF_ENGINE]?.cer != null);
      const paired = bothScored.filter(p => !p.engines[e].refused && !p.engines[REF_ENGINE].refused);
      const wins = paired.filter(p => p.engines[e].cer < p.engines[REF_ENGINE].cer - 1e-9).length;
      const losses = paired.filter(p => p.engines[e].cer > p.engines[REF_ENGINE].cer + 1e-9).length;
      const deltas = paired.map(p => p.engines[REF_ENGINE].cer - p.engines[e].cer);
      s.paired_vs_ref = { n: paired.length, excluded_refused: bothScored.length - paired.length, wins, losses, ties: paired.length - wins - losses, median_delta_cer: r3(median(deltas)), p_sign: paired.length ? r3(binomTwoSided(Math.max(wins, losses), wins + losses)) : null,
        invention_wins: paired.filter(p => p.engines[e].invention_ref < p.engines[REF_ENGINE].invention_ref).length, invention_losses: paired.filter(p => p.engines[e].invention_ref > p.engines[REF_ENGINE].invention_ref).length };
    }
    // worst five: by CER when a reference exists, else by proxy CER, else by invention
    const key = x => x.m.cer != null ? x.m.cer : (x.m.invention ?? 0);
    s.worst = rows.filter(x => x.m.cer != null || x.m.invention != null).sort((a, b) => key(b) - key(a)).slice(0, 5).map(x => ({ slug: x.p.slug, title: x.p.title, year: x.p.year, cer: x.m.cer, gap: x.m.gap, invention: x.m.invention, has_ref: x.p.has_ref, unsupported: x.m.unsupported_sample }));
    summary.engines[e] = s;
  }
  // ── per script class (typeset / woodblock / cursive / other): the roll-up that answers the routing question ──
  const classes = [...new Set(pages.map(p => p.script_class).filter(Boolean))].sort();
  if (classes.length) {
    summary.by_class = {};
    for (const c of classes) {
      const cp = pages.filter(p => p.script_class === c);
      summary.by_class[c] = { n: cp.length, engines: {} };
      for (const e of engines) {
        const rows = cp.map(p => ({ p, m: p.engines[e] })).filter(x => x.m && !x.m.missing);
        const cer = rows.filter(x => x.m.cer != null).map(x => x.m.cer);
        summary.by_class[c].engines[e] = { n: rows.length, empty: rows.filter(x => x.m.empty && !x.m.refused).length, refused: rows.filter(x => x.m.refused).length, loop: rows.filter(x => x.m.loop).length,
          median_cer: r3(median(cer)), catastrophic: cer.filter(v => v > 0.5).length, median_unsupported: r3(median(rows.map(x => x.m.invention))) };
      }
    }
  }
  summaryAll[stratum] = summary;
  fs.writeFileSync(path.join(OUT_DIR, `${stratum}-${date}.json`), JSON.stringify({ summary, pages }, null, 2));

  // ── console table ──
  console.log(`\n## ${stratum} (#${summary.issue}) — ${pages.length} pages scored (${summary.n_with_ref} with reference; ${summary.ref_mismatch.length} reference-mismatch → proxy: ${summary.ref_mismatch.join(', ') || '—'}), ${textless.length} textless: ${textless.join(', ') || '—'}`);
  console.log('| engine | pages | empty | refused | loop | ref n | median CER (refusal = 1.0) | mean CER (refusal = 1.0) | mean CER answered (n) | catastrophic | median gap | invention (vs ref) | vs ref-engine (proxy) n / median CER / catastrophic | unsupported (vs other engines) | paired CER vs ' + REF_ENGINE + ' W/L/T (p) | invention W/L |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const e of engines) {
    const s = summary.engines[e];
    const pv = s.paired_vs_ref ? `${s.paired_vs_ref.wins}/${s.paired_vs_ref.losses}/${s.paired_vs_ref.ties} (p=${s.paired_vs_ref.p_sign}, n=${s.paired_vs_ref.n}${s.paired_vs_ref.excluded_refused ? `, ${s.paired_vs_ref.excluded_refused} refused excluded` : ''})` : '—';
    const iv = s.paired_vs_ref ? `${s.paired_vs_ref.invention_wins}/${s.paired_vs_ref.invention_losses}` : '—';
    console.log(`| ${e} | ${s.pages_run} | ${s.empty} | ${s.refused} | ${s.loop} | ${s.ref.n} | ${s.ref.median_cer ?? '—'} | ${s.ref.mean_cer ?? '—'} | ${s.ref.mean_cer_answered ?? '—'} (${s.ref.n_answered}) | ${s.ref.catastrophic} | ${s.ref.median_gap ?? '—'} | ${s.invention.ref_median ?? '—'} | ${s.proxy_vs_ref_engine.n} / ${s.proxy_vs_ref_engine.median_cer ?? '—'} / ${s.proxy_vs_ref_engine.catastrophic} | ${s.invention.median ?? '—'} | ${pv} | ${iv} |`);
  }
  if (summary.by_class) {
    for (const [c, bc] of Object.entries(summary.by_class)) {
      console.log(`\n### script class: ${c} (n=${bc.n}) — CER is vs reference where one exists, else distance to ${REF_ENGINE}`);
      console.log('| engine | n | empty | refused | loop | median CER | catastrophic | median unsupported |');
      console.log('|---|---|---|---|---|---|---|---|');
      for (const [e, v] of Object.entries(bc.engines)) console.log(`| ${e} | ${v.n} | ${v.empty} | ${v.refused} | ${v.loop} | ${v.median_cer ?? '—'} | ${v.catastrophic} | ${v.median_unsupported ?? '—'} |`);
    }
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
