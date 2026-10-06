#!/usr/bin/env node
// PRIOR ART: ocr-error-classes.py (#5488) sorts word differences into classes — reused here, unchanged in its
// CLI, through its --pages mode; benchmark-score.mjs and lib/metrics.mjs scoreAgainstReference give the CER
// on /quality today, but with a different fold per source (the Wikisource tier folds u/v, i/j and every
// accent, the sealed strata only case and ſ), and neither follows the OCR prompt; long-s-tcp-ab.mjs holds the
// v16 vs v16+long-s arms whose effect this reproduces from its stored outputs. None reports one CER three
// ways, or splits it by the prompt that wrote the text.
/**
 * ocr-cer-three-ways.mjs — transcription error three ways, per language and per prompt (#5939).
 *
 *   1. raw CER — letters and digits only, nothing else folded: case, ſ, accents, u/v all count;
 *   2. CER after the prompt's conventions — the fold the live OCR prompt asks for, and nothing more:
 *      abbreviations expanded where the reference abbreviates ("ALWAYS expand abbreviations"), standard
 *      Unicode (NFKC; æ/œ and other ligatures written out), ſ written as s (the stored house convention:
 *      lib/ocr-long-s-retry.mjs foldLongS — no prompt version says it), and for CJK the old/new form fold
 *      benchmark-score.mjs already applies. NOT folded, because the prompt says keep them as printed:
 *      u/v, i/j, capitals, spelling, accents and marks (Greek accents, Hebrew points …), and never ſ read
 *      as f, modernisation, refusals or invention;
 *   3. what the remaining error is — ocr-error-classes.py, prompt_rules=True, grouped into the kinds a
 *      reader can act on. Weighted by the characters of the affected words: a ranking, not a CER.
 * Both CERs use the same scorer (lib/metrics.mjs windowedErrorRate: fitting alignment, so text outside the
 * reference window is free and everything inside it is charged); a refused page counts as CER 1.
 * Line-end hyphenation and line breaks fold in both (spaces and punctuation are not scored).
 *
 * Page sets (each page carries the prompt that wrote it):
 *   bench     benchmark arms on disk (generic transcription prompt, benchmark-run-api.mjs): ref-ws (Wikisource,
 *             same scan: Latin, German, Greek), eebo-tcp-5488 (EEBO-TCP, same edition: English, Latin),
 *             chinese + chinese-ext (other editions: CER only, no word classes);
 *   longs-ab  long-s-tcp-ab.mjs arms (#5488): A/A2 = flash on live v16, LA = flash-lite on v16, B/LB = v16 +
 *             LONG_S_LINE (the refusal-retry prompt, scripts/lib/ocr-long-s-retry.mjs), LC = the "write it as
 *             s" variant. Windows are recut from the TCP XML with lib/edition-window.mjs cutEditionWindow,
 *             probed by the stored OCR as the A/B did; the A/B's own counts are re-derived as a check;
 *   served    the OCR readers see (pages.ocr.data) for every one of those pages that is one of our books, plus
 *             latin-period-5126, resolved to its `prompts` row by prompt_id, then prompt_hash, then label
 *             (.claude/docs/prompt-history.md lesson 3); `ocr.prompt_variant: long-s-glyph` = long-s retry.
 *
 *   node --env-file=.env.production.local scripts/eval/ocr-cer-three-ways.mjs --stage=collect \
 *        --roots=/root/ocr-bench/images,/root/ocr-bench-5660 --tcp-dir=<dir of TCP P5 xml> [--work=/root/cer3-work]
 *   node scripts/eval/ocr-cer-three-ways.mjs --stage=score [--work=…]      # $0, no Mongo
 * Writes results/ocr-cer-three-ways/three-ways-<date>.json (no page text beyond short examples), and
 * <work>/pages.jsonl (texts; not committed). quality-by-language.mjs reads the latest results file.
 *
 * How it fails: the u/v direction, the abbreviation pairing and every class are heuristics; read the
 * hand-check (results/ocr-cer-three-ways/hand-check-<date>.md) before quoting a kind.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { windowedErrorRate } from './lib/metrics.mjs';
import { cutEditionWindow, foldedWords } from './lib/edition-window.mjs';
import { stripMarkupTags } from '../lib/strip-markup-tags.mjs';
import { LONG_S_GLYPH_VARIANT } from '../lib/ocr-long-s-retry.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argOf = (n, d) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const STAGE = argOf('stage', 'score');
const WORK = argOf('work', '/root/cer3-work');
const OUT_DIR = path.join(HERE, 'results', 'ocr-cer-three-ways');
const REFS = path.join(HERE, 'benchmark', 'refs');
const LITE = 'gemini-3.1-flash-lite', FLASH = 'gemini-3-flash-preview';
const readJsonl = (f) => fs.readFileSync(f, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
const r3 = (x) => (x == null || Number.isNaN(x) ? null : Math.round(x * 1000) / 1000);
const median = (xs) => { const s = xs.filter((x) => x != null).sort((a, b) => a - b); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

// ── TCP P5 XML → text (the A/B's flattener was not committed; windows are recut, not re-used by offset) ──
export function flattenTcp(xml) {
  const at = xml.search(/<text[\s>]/); // the <text> element, not <textClass> in the header
  let t = at >= 0 ? xml.slice(at) : '';
  t = t.replace(/<g ref="char:EOLhyphen"\s*\/>/g, '')
    .replace(/<g ref="[^"]*"\s*>([^<]*)<\/g>/g, '$1').replace(/<g ref="[^"]*"\s*\/>/g, '')
    .replace(/<gap\b[^>]*>[\s\S]*?<\/gap>/g, '').replace(/<gap\b[^>]*\/>/g, '')
    .replace(/<lb\s*\/>/g, '\n').replace(/<[^>]+>/g, '');
  const ent = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  return t.replace(/&(amp|lt|gt|quot|apos);/g, (_, e) => ent[e]).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/〈[^〉]*〉/g, '');
}

// ── the two folds ─────────────────────────────────────────────────────────────
// Body text only: metadata and description tags out (as benchmark-score.mjs normAlpha), centred-line
// markers out BEFORE tag stripping (#5564), entities out.
const body = (s) => stripMarkupTags(String(s || '').replace(/->|<-/g, ' ')
  .replace(/<(warning|meta|image-desc|figure|note|scan-quality|language|page-type|columns|detected-images|vocab|header|sig|page-num|script)\b[^>]*>[\s\S]*?<\/\1>/gi, ' '))
  .replace(/```[a-z]*/g, ' ').replace(/&[a-z]{2,8};|&#\d+;/gi, ' ').normalize('NFC');
// Kyūjitai → shinjitai, the fold benchmark-score.mjs applies to every CJK page (copied: that script is a CLI).
const KYU_SHIN = '氣気觸触發発傳伝禮礼醫医體体國国學学會会當当對対經経藥薬寶宝齊斉齋斎變変邊辺圓円廣広應応惡悪榮栄營営藝芸壓圧鹽塩澤沢擇択譯訳驛駅釋釈澁渋濕湿實実寫写收収從従縱縦讀読續続賣売讓譲亂乱亞亜圍囲爲為僞偽衞衛舊旧兒児條条處処與与齒歯齡齢壽寿圖図團団晝昼點点黨党燈灯獨独樂楽靈霊勞労勵励歷歴曆暦龍竜隸隷兩両獵猟錄録麥麦滿満萬万默黙彌弥譽誉餘余豫予嚴厳髓髄隨随數数樞枢聲声靜静濟済劑剤攝摂淺浅錢銭賤賎踐践纖繊專専戰戦禪禅單単彈弾斷断遲遅廳庁徵徴聽聴鎭鎮鐵鉄轉転屆届縣県驗験險険檢検劍剣顯顕權権勸勧觀観歡歓鑛鉱鑄鋳絲糸獸獣敍叙將将奬奨狀状乘乗剩剰淨浄燒焼稱称證証囑嘱眞真盡尽竊窃說説拜拝廢廃佛仏拂払辯弁辨弁步歩豐豊每毎黑黒龜亀假仮價価繪絵壞壊懷懐覺覚舉挙歸帰據拠徑径輕軽莖茎繼継惠恵鷄鶏缺欠儉倹圈圏獻献效効號号碎砕櫻桜參参慘惨產産蠶蚕贊賛殘残辭辞肅粛緖緒涉渉疊畳醉酔雙双壯壮莊荘裝装藏蔵臟臓總総騷騒增増屬属帶帯滯滞臺台擔担膽胆蟲虫貳弐惱悩腦脳霸覇髮髪拔抜晚晩蠻蛮濱浜搖揺樣様謠謡來来賴頼覽覧樓楼灣湾淚涙沒没稻稲廐厩冨富鬪闘關関陷陥隱隠靑青淸清敎教卽即槪概旣既溉漑硏研卷巻內内册冊咒呪曾曽溫温縕緼醬醤獎奨妝粧姊姉曉暁迴回廻回瀧滝籠篭鬭闘';
const KYU = new Map(); for (let i = 0; i + 1 < KYU_SHIN.length; i += 2) KYU.set(KYU_SHIN[i], KYU_SHIN[i + 1]);
const CJK_CHAR = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}〇]/u;
const LIGATURES = { 'æ': 'ae', 'Æ': 'AE', 'œ': 'oe', 'Œ': 'OE', 'ꝛ': 'r' };

/** Normalised scoring string. level: 'raw' | 'prompt'. script: 'latin' | 'greek' | 'cjk'. */
export function norm(text, level, script) {
  let t = body(text);
  if (script === 'cjk') {
    if (level === 'prompt') t = [...t.normalize('NFKC')].map((c) => KYU.get(c) || c).join('');
    return [...t].filter((c) => CJK_CHAR.test(c)).join('');
  }
  if (level === 'prompt') t = t.normalize('NFKC').replace(/[æÆœŒꝛ]/g, (c) => LIGATURES[c]).replace(/ſ/g, 's').normalize('NFC');
  // Greek pages score Greek letters only (parallel Greek–Latin leaves; benchmark-score.mjs GREEK_STRATA rule).
  const keep = script === 'greek' ? /[\p{Script=Greek}\p{M}]/u : /[\p{L}\p{N}\p{M}]/u;
  return [...t].filter((c) => keep.test(c)).join('');
}
/** Abbreviation pairs the classifier aligned (reference form → engine expansion): put the expansion into
 * the reference, once per pair, so the prompt-fold CER does not charge an expansion the prompt asked for. */
function expandRef(ref, pairs) {
  let r = ref;
  for (const [a, b] of pairs) { const i = r.indexOf(a); if (i >= 0) r = r.slice(0, i) + b + r.slice(i + a.length); }
  return r;
}
const cerOf = (ref, hyp, level, script) => {
  const R = norm(ref, level, script), H = norm(hyp, level, script);
  if (!R.length) return null;
  return windowedErrorRate(R, H).windowedCer;
};

// ── reader-facing kinds over ocr-error-classes.py classes (prompt_rules=True) ──
export const READER_KIND = {
  'long-s read as f': 'ſ read as f',
  'other misread': 'misread letters and words', 'garbled phrase': 'misread letters and words', 'numerals': 'misread letters and words',
  'f read as s': 'misread letters and words', 'word split / joined': 'misread letters and words', 'inserted word(s)': 'misread letters and words',
  'accent or mark differs': 'misread letters and words', 'abbreviation kept or contracted': 'misread letters and words',
  'markup leaked (html entity / latex)': 'misread letters and words',
  'refusal (empty output)': 'refusals',
  'inserted run (≥6 words)': 'invented or recited text',
  'omitted word(s)': 'omissions', 'omitted run (≥6 words)': 'omissions',
  'spelling normalised': 'silent modernisation', 'u/v i/j modernised by the engine': 'silent modernisation',
  'reference illegible-letter gap (engine right)': 'reference defects', 'u/v i/j regularised in the reference': 'reference defects',
  'u/v i/j convention': 'u/v, i/j or capitals differ', 'case only': 'u/v, i/j or capitals differ',
  'marginal note / note marker / furniture order': 'margins and page furniture',
  // folded (the prompt's own conventions) or not text on the page — excluded from the breakdown
  'abbreviation expanded as the prompt asks': null, 'diacritics convention': null, 'u/v i/j': null,
  'edge: reference padding not on page': null, 'edge: running head / page no. / catchword added': null,
};
export const KINDS = ['ſ read as f', 'misread letters and words', 'refusals', 'invented or recited text', 'omissions', 'silent modernisation', 'reference defects', 'u/v, i/j or capitals differ', 'margins and page furniture'];

// ═════════════════════════════ collect ═════════════════════════════
async function collect() {
  const ROOTS = argOf('roots', '/root/ocr-bench/images,/root/ocr-bench-5660').split(',');
  const TCP = argOf('tcp-dir');
  if (!TCP) throw new Error('--tcp-dir required (TCP P5 XML, <id>.xml)');
  const { MongoClient } = await import('mongodb');
  const client = new MongoClient(process.env.MONGODB_URI); await client.connect();
  const db = client.db('bookstore');
  fs.mkdirSync(WORK, { recursive: true });
  const out = [];
  const outDirOf = (stratum, engine) => ROOTS.map((r) => path.join(r, stratum, 'out', engine)).find((d) => fs.existsSync(d));
  const meterOf = (dir) => { const f = path.join(dir, '_meter.jsonl'); const m = new Map(); if (fs.existsSync(f)) for (const o of readJsonl(f)) m.set(o.slug, o); return m; };

  // bench: same-scan Wikisource pages
  for (const engine of [LITE, FLASH]) {
    const dir = outDirOf('ref-ws', engine); if (!dir) continue; const meter = meterOf(dir);
    for (const f of fs.readdirSync(path.join(HERE, 'ground-truth-ws')).filter((x) => x.endsWith('.json') && !x.startsWith('_'))) {
      const g = JSON.parse(fs.readFileSync(path.join(HERE, 'ground-truth-ws', f), 'utf8')); const slug = f.slice(0, -5);
      const hf = path.join(dir, `${slug}.txt`); if (!g.ocr_ground_truth || !fs.existsSync(hf)) continue;
      out.push({ set: 'bench', stratum: 'ref-ws', slug, book: null, language: g.language, script: g.script === 'greek' ? 'greek' : 'latin', engine, prompt: 'benchmark generic', long_s_retry: false,
        ref: g.ocr_ground_truth, hyp: fs.readFileSync(hf, 'utf8'), finish: meter.get(slug)?.finishReason ?? null });
    }
  }
  // bench: sealed strata with page references
  const registry = (s) => JSON.parse(fs.readFileSync(path.join(HERE, 'benchmark', `${s}.json`), 'utf8')).pages;
  for (const [stratum, script] of [['eebo-tcp-5488', 'latin'], ['chinese', 'cjk'], ['chinese-ext', 'cjk']]) {
    for (const engine of [LITE, FLASH]) {
      const dir = outDirOf(stratum, engine); if (!dir) continue; const meter = meterOf(dir);
      for (const p of registry(stratum)) {
        const rf = path.join(REFS, `${p.slug}.txt`), hf = path.join(dir, `${p.slug}.txt`);
        if (!fs.existsSync(rf) || !fs.existsSync(hf)) continue;
        out.push({ set: 'bench', stratum, slug: p.slug, book: p.book_id, language: String(p.language).split(/[;,]/)[0].trim(), script, engine, prompt: 'benchmark generic', long_s_retry: false,
          ref: fs.readFileSync(rf, 'utf8'), hyp: fs.readFileSync(hf, 'utf8'), finish: meter.get(p.slug)?.finishReason ?? null });
      }
    }
  }

  // prompts rows, to resolve served pages (prompt-history.md lesson 3: id, then hash, then label)
  const prompts = await db.collection('prompts').find({ type: 'ocr' }, { projection: { name: 1, version: 1, content_hash: 1 } }).toArray();
  const byId = new Map(prompts.map((p) => [String(p._id), p])), byHash = new Map(prompts.map((p) => [p.content_hash, p]));
  const resolve = (o) => {
    const row = (o?.prompt_id && byId.get(String(o.prompt_id))) || (o?.prompt_hash && byHash.get(o.prompt_hash)) || null;
    if (row) return { prompt: `${row.name === 'Standard OCR' ? '' : `${row.name} `}v${row.version}`, resolved_by: o.prompt_id && byId.get(String(o.prompt_id)) ? 'prompt_id' : 'prompt_hash' };
    return { prompt: o?.prompt_version != null ? `label "${o.prompt_version}" (unresolved)` : 'no prompt recorded', resolved_by: o?.prompt_version != null ? 'label_only' : 'none' };
  };
  const pages = db.collection('pages');
  const served = async (book, page) => (await pages.findOne({ book_id: book, page_number: Number(page) }, { projection: { ocr: 1 } }))?.ocr ?? null;
  const servedRow = (base, o, ref) => {
    const r = resolve(o);
    return { ...base, set: 'served', engine: o?.model ?? null, prompt: r.prompt, resolved_by: r.resolved_by, prompt_variant: o?.prompt_variant ?? null,
      long_s_retry: o?.prompt_variant === LONG_S_GLYPH_VARIANT, human_edited: !!o?.human_edited, updated_at: o?.updated_at ?? null, ref, hyp: o?.data ?? '', finish: null };
  };
  for (const stratum of ['eebo-tcp-5488', 'latin-period-5126', 'chinese', 'chinese-ext']) {
    for (const p of registry(stratum)) {
      if (/corrected-OCR reference/.test(p.substratum || '')) continue; // corrected FROM the served read (#5126 prereg)
      const rf = path.join(REFS, `${p.slug}.txt`); if (!fs.existsSync(rf)) continue;
      const o = await served(p.book_id, p.page_number); if (!o?.data) continue;
      out.push(servedRow({ stratum, slug: p.slug, book: p.book_id, language: String(p.language).split(/[;,]/)[0].trim(), script: stratum.startsWith('chinese') ? 'cjk' : 'latin' }, o, fs.readFileSync(rf, 'utf8')));
    }
  }

  // long-s A/B: recut windows from the TCP XML, probed by the stored OCR as the A/B's draw was
  const AB = path.join(HERE, 'results', 'long-s-tcp-ab');
  const { draw } = JSON.parse(fs.readFileSync(path.join(AB, 'draw.json'), 'utf8'));
  const editions = new Map(); const windows = [];
  for (const d of draw) {
    if (!editions.has(d.tcp)) { const t = flattenTcp(fs.readFileSync(path.join(TCP, `${d.tcp}.xml`), 'utf8')); editions.set(d.tcp, { text: t, words: foldedWords(t, 'latin') }); }
    const e = editions.get(d.tcp); const o = await served(d.book, d.page);
    const cut = o?.data ? cutEditionWindow(e.words, e.text, o.data, 'latin') : null;
    windows.push({ ...d, window: cut?.window ?? null, overlap: cut?.overlap ?? null, from_char_recut: cut?.from_char ?? null, to_char_recut: cut?.to_char ?? null });
    if (cut?.window) out.push(servedRow({ stratum: 'long-s-tcp-ab', slug: `${d.book}-p${d.page}`, book: d.book, language: /latin/i.test(d.cell) ? 'Latin' : 'English', script: 'latin', cell: d.cell }, o, cut.window));
  }
  const ARM_PROMPT = { A: 'v16', A2: 'v16 (repeat)', LA: 'v16', B: 'v16 + long-s line', LB: 'v16 + long-s line', LC: 'v16 + long-s line, "write it as s"' };
  for (const arm of Object.keys(ARM_PROMPT)) {
    const rows = new Map(readJsonl(path.join(AB, `outputs-${arm}.jsonl`)).map((o) => [`${o.book}:${o.page}`, o]));
    for (const w of windows) {
      const o = rows.get(`${w.book}:${w.page}`); if (!w.window || !o) continue;
      out.push({ set: 'longs-ab', stratum: 'long-s-tcp-ab', arm, slug: `${w.book}-p${w.page}`, book: w.book, language: /latin/i.test(w.cell) ? 'Latin' : 'English', cell: w.cell, script: 'latin',
        engine: o.model, prompt: ARM_PROMPT[arm], prompt_hash: o.prompt_hash, long_s_retry: arm === 'B' || arm === 'LB' || arm === 'LC', ref: w.window, hyp: o.text || '', finish: o.finish_reason });
    }
  }
  // corpus-wide: how many pages the long-s retry has written (ocr.prompt_variant is unindexed; the jobs that sent it are few)
  const retryJobs = await db.collection('batch_jobs').countDocuments({ prompt_variant: LONG_S_GLYPH_VARIANT }).catch(() => null);
  await client.close();
  fs.writeFileSync(path.join(WORK, 'pages.jsonl'), out.map((o) => JSON.stringify(o)).join('\n') + '\n');
  fs.writeFileSync(path.join(WORK, 'meta.json'), JSON.stringify({ collected_at: new Date().toISOString(), long_s_retry_jobs: retryJobs,
    windows: windows.map(({ window, ...w }) => ({ ...w, window_chars: window?.length ?? 0 })) }, null, 1));
  const c = {}; for (const o of out) { const k = `${o.set} | ${o.stratum} | ${o.arm ?? o.engine} | ${o.prompt}`; c[k] = (c[k] || 0) + 1; }
  console.log(`${out.length} page rows → ${WORK}/pages.jsonl; long-s retry jobs: ${retryJobs}`);
  for (const [k, v] of Object.entries(c).sort()) console.log(`  ${String(v).padStart(4)}  ${k}`);
}

// ═════════════════════════════ score ═════════════════════════════
function score() {
  const rows = readJsonl(path.join(WORK, 'pages.jsonl'));
  const meta = JSON.parse(fs.readFileSync(path.join(WORK, 'meta.json'), 'utf8'));
  // A refusal is an empty answer the engine declined (finishReason) or, for stored text, under 30 letters.
  const letters = (s) => norm(s, 'raw', 'latin').length;
  for (const [i, r] of rows.entries()) {
    r.id = i;
    r.refused = (r.finish && r.finish !== 'STOP' && r.finish !== 'MAX_TOKENS' && letters(r.hyp) < 30) || (r.script !== 'cjk' && letters(r.hyp) < 30 && letters(r.ref) >= 200);
  }
  // word classes (alphabetic pages only), via the classifier's --pages mode
  const alpha = rows.filter((r) => r.script !== 'cjk');
  const greekOnly = (s) => body(s).split(/\s+/).filter((w) => /\p{Script=Greek}/u.test(w)).join(' ');
  const inFile = path.join(WORK, 'classify-in.jsonl');
  fs.writeFileSync(inFile, alpha.map((r) => JSON.stringify({ id: r.id, ref: r.script === 'greek' ? greekOnly(r.ref) : r.ref, hyp: r.refused ? '' : (r.script === 'greek' ? greekOnly(r.hyp) : r.hyp) })).join('\n') + '\n');
  const cls = new Map(execFileSync('python3', [path.join(HERE, 'ocr-error-classes.py'), `--pages=${inFile}`], { maxBuffer: 1 << 30 }).toString().split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((o) => [o.id, o]));
  for (const r of rows) {
    const c = cls.get(r.id);
    r.classes = c?.classes ?? null; r.examples = c?.examples ?? null;
    const ref2 = c ? expandRef(r.ref, c.abbr_pairs) : r.ref;
    r.cer_raw = r.refused ? 1 : r3(cerOf(r.ref, r.hyp, 'raw', r.script));
    r.cer_prompt = r.refused ? 1 : r3(cerOf(ref2, r.hyp, 'prompt', r.script));
  }

  const group = (rs) => {
    const ok = rs.filter((r) => r.cer_raw != null);
    const kinds = Object.fromEntries(KINDS.map((k) => [k, 0])); let classified = 0;
    for (const r of ok) for (const [c, v] of Object.entries(r.classes || {})) { const k = READER_KIND[c]; if (k === undefined) throw new Error(`unmapped class ${c}`); if (k) { kinds[k] += v; classified++; } }
    const tot = Object.values(kinds).reduce((a, b) => a + b, 0);
    const pagesWith = (k) => ok.filter((r) => Object.entries(r.classes || {}).some(([c, v]) => READER_KIND[c] === k && v > 0)).length;
    return {
      pages: ok.length, books: new Set(ok.map((r) => r.book ?? r.slug)).size, refused: ok.filter((r) => r.refused).length,
      median_cer_raw: r3(median(ok.map((r) => r.cer_raw))), median_cer_prompt: r3(median(ok.map((r) => r.cer_prompt))),
      mean_cer_raw: r3(mean(ok.map((r) => r.cer_raw))), mean_cer_prompt: r3(mean(ok.map((r) => r.cer_prompt))),
      answered_median_cer_prompt: r3(median(ok.filter((r) => !r.refused).map((r) => r.cer_prompt))),
      kinds: ok.some((r) => r.classes) ? Object.fromEntries(KINDS.map((k) => [k, { share: tot ? r3(kinds[k] / tot) : 0, pages: pagesWith(k) }])) : null,
    };
  };
  const by = (rs, f) => { const m = new Map(); for (const r of rs) { const k = f(r); if (k == null) continue; if (!m.has(k)) m.set(k, []); m.get(k).push(r); } return m; };

  // 1. per language, the benchmark arms the /quality column reports (generic prompt). Greek: same-scan
  //    Wikisource pages only (the modern-edition strata measure edition variance, #5488 write-up).
  const bench = rows.filter((r) => r.set === 'bench');
  const languages = {};
  for (const engine of [LITE, FLASH]) for (const [lang, rs] of by(bench.filter((r) => r.engine === engine), (r) => r.language)) {
    const g = group(rs); g.strata = [...new Set(rs.map((r) => r.stratum))];
    (languages[lang] ||= {})[engine] = g;
  }
  // 2. per prompt: the EEBO pages, early print (English + Latin), every source of text side by side
  const eebo = rows.filter((r) => r.stratum === 'eebo-tcp-5488' || r.stratum === 'long-s-tcp-ab');
  const prompts = [];
  for (const [k, rs] of by(eebo, (r) => `${r.set}|${r.set === 'longs-ab' ? r.arm : r.set === 'bench' ? r.engine : 'served'}|${r.prompt}|${r.stratum}`)) {
    const [set, arm, prompt, stratum] = k.split('|');
    prompts.push({ set, arm, prompt, stratum, engine: set === 'served' ? 'as stored (mixed)' : rs[0].engine, long_s_retry: rs.some((r) => r.long_s_retry), ...group(rs) });
  }
  // served text, every alphabetic page (EEBO English + Latin, Latin 1400–1799), each page once, by the
  // prompts row it resolves to. Version and engine are confounded here (v14/v15 pages are mostly flash,
  // v16 mostly flash-lite): the clean prompt comparison is the A/B above, this is what readers are served.
  const seen = new Set();
  const servedAlpha = rows.filter((r) => r.set === 'served' && r.script !== 'cjk').filter((r) => { const k = `${String(r.book).replace(/-/g, '')}:${r.slug.replace(/^.*-p/, '')}`; if (seen.has(k)) return false; seen.add(k); return true; });
  const servedByPrompt = [];
  for (const [prompt, rs] of by(servedAlpha, (r) => (r.resolved_by === 'prompt_id' || r.resolved_by === 'prompt_hash' ? r.prompt : 'label only or none (not resolvable)'))) {
    const engines = {}; for (const r of rs) engines[r.engine] = (engines[r.engine] || 0) + 1;
    servedByPrompt.push({ prompt, engines, long_s_retry_pages: rs.filter((r) => r.long_s_retry).length, ...group(rs) });
  }
  servedByPrompt.sort((a, b) => a.prompt.localeCompare(b.prompt, 'en', { numeric: true }));
  const servedOther = [];
  for (const [prompt, rs] of by(rows.filter((r) => r.set === 'served' && r.script === 'cjk'), (r) => r.prompt)) servedOther.push({ stratum: 'chinese', prompt, ...group(rs) });
  const servedPooled = Object.fromEntries([...by(rows.filter((r) => r.set === 'served' && r.script !== 'cjk'), (r) => r.language)].map(([l, rs]) => [l, group(rs)]));

  // 3. the long-s A/B, re-derived from its stored outputs on the recut windows (paired, as its report)
  const abRows = rows.filter((r) => r.set === 'longs-ab');
  const arm = (a) => new Map(abRows.filter((r) => r.arm === a).map((r) => [r.slug, r]));
  const ab = {};
  for (const [x, y] of [['A', 'A2'], ['A', 'B'], ['LA', 'LB'], ['LA', 'LC']]) {
    const X = arm(x), Y = arm(y); let xo = 0, yo = 0, both = 0; const px = [], py = [];
    for (const [slug, a] of X) { const b = Y.get(slug); if (!b) continue; if (a.refused && b.refused) both++; else if (a.refused) xo++; else if (b.refused) yo++; else { px.push(a); py.push(b); } }
    const lsf = (rs) => rs.reduce((s, r) => s + (r.classes?.['long-s read as f'] || 0), 0);
    const mod = (rs) => rs.reduce((s, r) => s + (r.classes?.['spelling normalised'] || 0) + (r.classes?.['u/v i/j modernised by the engine'] || 0), 0);
    ab[`${x}_vs_${y}`] = { refused_first_only: xo, refused_second_only: yo, both_refused: both, answered_both: px.length,
      long_s_as_f_chars: [lsf(px), lsf(py)], modernisation_chars: [mod(px), mod(py)],
      median_cer_prompt_answered: [r3(median(px.map((r) => r.cer_prompt))), r3(median(py.map((r) => r.cer_prompt)))] };
  }
  const servedRetry = rows.filter((r) => r.set === 'served' && r.long_s_retry).length;

  // hand-check draw: one example per book, spread over kinds (deterministic: slug order)
  const examples = [];
  const seenBook = new Set();
  const pool = rows.filter((r) => r.examples && (r.set === 'bench' && r.engine === LITE || r.set === 'served')).sort((a, b) => String(a.slug).localeCompare(String(b.slug)));
  for (const kind of KINDS) {
    for (const r of pool) {
      if (examples.filter((e) => e.kind === kind).length >= 5) break;
      const book = r.book ?? r.slug; if (seenBook.has(book)) continue;
      const c = Object.keys(r.examples).find((cl) => READER_KIND[cl] === kind && r.examples[cl].length); if (!c) continue;
      seenBook.add(book); const e = r.examples[c][0];
      examples.push({ kind, class: c, set: r.set, stratum: r.stratum, slug: r.slug, book: r.book, language: r.language, engine: r.engine, prompt: r.prompt, ...e });
    }
  }

  const date = new Date().toISOString().slice(0, 10);
  const res = {
    date, issue: 5939, generated_by: 'scripts/eval/ocr-cer-three-ways.mjs', cost_usd: 0,
    definitions: {
      cer_raw: 'Character error, letters and digits only (Greek pages: Greek letters only), nothing folded: case, ſ, accents and u/v all count. Fitting alignment (lib/metrics.mjs windowedErrorRate), so text outside the reference window is free. A refused page counts as 1.',
      cer_prompt: 'The same, after the fold the live OCR prompt asks for: abbreviations the reference keeps, expanded as the engine expanded them; Unicode NFKC with æ/œ and other ligatures written out; ſ as s (the stored house convention); CJK old/new forms. Not folded: u/v, i/j, capitals, spelling, accents and marks.',
      kinds: 'ocr-error-classes.py with prompt_rules=True, grouped (READER_KIND). Share of the classified error weight, weighted by the characters of the affected words: a ranking, not a CER. A heuristic: see the hand-check.',
      prompt: 'benchmark generic = benchmark-run-api.mjs GENERIC_PROMPT; v16 / v16 + long-s line = long-s-tcp-ab.mjs arms; served = pages.ocr resolved to its prompts row by prompt_id, then prompt_hash, else the stored label (unresolved).',
    },
    live_prompt: { version: '19.1', asks: ['ALWAYS expand abbreviations', 'punctuation in standard Unicode'], keeps_as_printed: ['u/v (Do NOT modernize)', 'spelling', 'capitalization', 'punctuation'], long_s: 'no rule in any version v0–v19.1; v16 writes s by habit; the collector folds ſ to s only after the long-s retry' },
    languages, prompts: prompts.filter((p) => p.set !== 'served').sort((a, b) => a.set.localeCompare(b.set) || a.prompt.localeCompare(b.prompt)), served_by_prompt: servedByPrompt, served_chinese_by_prompt: servedOther, served_pooled: servedPooled,
    long_s_ab: ab, long_s_retry: { served_pages_in_these_sets: servedRetry, jobs_sent_corpus_wide: meta.long_s_retry_jobs },
    windows: { recut: meta.windows.filter((w) => w.window_chars).length, of: meta.windows.length },
    pages: rows.map(({ ref, hyp, examples: _e, ...r }) => r),
    hand_check_draw: examples,
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const f = path.join(OUT_DIR, `three-ways-${date}.json`);
  fs.writeFileSync(f, JSON.stringify(res, null, 1) + '\n');
  console.log(`wrote ${path.relative(process.cwd(), f)}`);
  for (const [lang, e] of Object.entries(languages)) for (const [eng, g] of Object.entries(e)) console.log(`${lang.padEnd(8)} ${eng.padEnd(24)} n=${String(g.pages).padStart(3)} raw ${g.median_cer_raw} prompt ${g.median_cer_prompt} refused ${g.refused}  ${g.kinds ? KINDS.map((k) => `${k.split(' ')[0]}:${g.kinds[k].share}`).join(' ') : ''}`);
  console.log('\nby prompt (EEBO pages):');
  for (const p of res.prompts) console.log(`  ${p.set.padEnd(8)} ${String(p.arm).padEnd(24)} ${p.prompt.padEnd(36)} n=${String(p.pages).padStart(3)} raw ${p.median_cer_raw} prompt ${p.median_cer_prompt} refused ${p.refused} ſ→f ${p.kinds?.['ſ read as f'].share} mod ${p.kinds?.['silent modernisation'].share}`);
  console.log('\nserved, by resolved prompt (alphabetic pages, each once):');
  for (const p of servedByPrompt) console.log(`  ${p.prompt.padEnd(36)} n=${String(p.pages).padStart(3)} raw ${p.median_cer_raw} prompt ${p.median_cer_prompt} ſ→f ${p.kinds?.['ſ read as f'].share} mod ${p.kinds?.['silent modernisation'].share} misread ${p.kinds?.['misread letters and words'].share} ${JSON.stringify(p.engines)}`);
  console.log('\nlong-s A/B:', JSON.stringify(ab));
  console.log(`\nhand-check draw: ${examples.length} examples, ${new Set(examples.map((e) => e.book ?? e.slug)).size} books`);
}

if (STAGE === 'collect') await collect(); else if (STAGE === 'score') score(); else throw new Error('--stage=collect|score');
