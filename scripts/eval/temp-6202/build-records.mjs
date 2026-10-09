#!/usr/bin/env node
// PRIOR ART: scripts/eval/xlref-t1 — reused. Its records.jsonl (Latin), xlref-t4's records-arms.jsonl (Hebrew/Aramaic/Arabic/Persian) and tengyur-ref's reference.jsonl (84000, rebuilt with tengyur-ref/build-reference.py) already hold the pages, OCR texts and references. This only PICKS ~50 of each by seed and writes them in the translation-vs-reference record shape; it draws no new page and aligns nothing.
/** Assemble the #6202 page set (≈50 Tengyur-vs-84000, 50 Hebrew/Arabic/Persian, 50 Latin) from the existing reference sets. Read-only, $0. */
/**
 *   node scripts/eval/temp-6202/build-records.mjs [--work /data/scratch/sl/temp-6202] [--tref /root/tref] [--t4 /root/xlref-t4/work2/records-arms.jsonl]
 * Writes <work>/records.jsonl (carries reference text, some of it in copyright or NC-ND: never in the repo) and
 * scripts/eval/results/temp-6202-2026-10/pages.json (ids and provenance only).
 */
import fs from 'node:fs';
import path from 'node:path';
import { makeRng } from '../lib/paired-stats.mjs';
import { readJsonl, writeJsonl, sha16 } from '../translation-vs-reference/common.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] != null ? args[i + 1] : d; };
const WORK = opt('work', '/data/scratch/sl/temp-6202');
const TREF = opt('tref', '/root/tref');
const T4 = opt('t4', '/root/xlref-t4/work2/records-arms.jsonl');
const RES = 'scripts/eval/results/temp-6202-2026-10';
const SEED = 6202; const N = 50;
const shuffled = (a, salt) => { const rng = makeRng((SEED ^ salt) >>> 0); const o = [...a]; for (let i = o.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [o[i], o[j]] = [o[j], o[i]]; } return o; };
const tail = (s, n = 300) => String(s || '').slice(-n); const head = (s, n = 300) => String(s || '').slice(0, n);

// ── Latin: 50 of the 71 #5695 T1 pages, seeded ────────────────────────────────────────────────────────────────
const t1 = readJsonl('scripts/eval/results/xlref-t1-2026-10/records.jsonl');
const latin = shuffled(t1.map((_, i) => i), 1).slice(0, N).sort((a, b) => a - b).map((i) => t1[i])
  .map((r) => ({ set: 'latin', track: 'T1', lang: r.lang, book_id: r.book_id, page_number: r.page_number, context_mode: 'worker', source_text: r.source_text, reference_text: r.reference_text, reference_meta: r.reference_meta, source_prev_tail: r.source_prev_tail, source_next_head: r.source_next_head }));

// ── Hebrew/Aramaic/Arabic/Persian: the 52 #5695 T4 pages minus the 2 whose reference sits in the translator's context ──
const leak = new Set(readJsonl('scripts/eval/results/xlref-t4-2026-10/pages.jsonl').filter((p) => p.arm === 'served' && p.reference_in_translator_context).map((p) => `${p.book_id}_${p.page_number}`));
const t4 = readJsonl(T4).filter((r) => !leak.has(`${r.book_id}_${r.page_number}`))
  .map((r) => ({ set: 't4', track: 'T4', lang: r.lang, book_id: r.book_id, page_number: r.page_number, context_mode: 'worker', source_text: r.source_text, reference_text: r.reference_text, reference_meta: r.reference_meta, source_prev_tail: r.source_prev_tail, source_next_head: r.source_next_head }));

// ── Tengyur: 50 of the 354 #5797 sides, seeded; reference cuts rebuilt by tengyur-ref/build-reference.py ─────────────
const ref = Object.fromEntries(readJsonl(path.join(TREF, 'ref/reference.jsonl')).map((r) => [r.page_id, r]));
const pagesByBook = {};
for (const f of fs.readdirSync(path.join(TREF, 'pages')).filter((x) => x.endsWith('.jsonl'))) for (const p of readJsonl(path.join(TREF, 'pages', f))) (pagesByBook[p.book_id] ||= {})[p.page_number] = p;
const s5797 = JSON.parse(fs.readFileSync('scripts/eval/results/tengyur-ref-2026-10/stored/sample.json', 'utf8')).pairs;
const tengyur = shuffled(s5797.map((_, i) => i), 2).map((i) => s5797[i]).filter((s) => ref[s.page_id]?.src && ref[s.page_id]?.ref_en).slice(0, N)
  .map((s) => { const r = ref[s.page_id]; const nb = pagesByBook[r.book_id] || {};
    return { set: 'tengyur', track: 'TENGYUR', lang: 'Tibetan', book_id: r.book_id, page_number: r.page_number, context_mode: 'none', toh: r.toh, folio: r.folio, source_text: r.src,
      reference_text: [r.ref_prev_tail ? `[context] ${r.ref_prev_tail}` : null, r.ref_en, r.ref_next_head ? `[context] ${r.ref_next_head}` : null].filter(Boolean).join('\n'),
      reference_meta: { title: r.title, translator: '84000: Translating the Words of the Buddha', year: null, licence: 'CC BY-NC-ND 3.0', private: true, style: 'literal', canonical: false, located: `${r.toh} F.${r.folio}`, url: 'https://84000.co', coverage_note: `84000's aligned Tibetan covers ${Math.round(100 * r.cover_ours)}% of our side` },
      source_prev_tail: tail(nb[r.page_number - 1]?.src), source_next_head: head(nb[r.page_number + 1]?.src) }; });

const records = [...tengyur, ...t4, ...latin];
const ids = records.map((r) => `${r.book_id}_${r.page_number}`);
if (new Set(ids).size !== ids.length) throw new Error('duplicate page across sets');
for (const r of records) if (!r.source_text || !r.reference_text) throw new Error(`empty source or reference: ${r.book_id}_${r.page_number}`);
writeJsonl(path.join(WORK, 'records.jsonl'), records);
fs.mkdirSync(RES, { recursive: true });
fs.writeFileSync(path.join(RES, 'pages.json'), JSON.stringify({ seed: SEED, built: new Date().toISOString().slice(0, 10), counts: { tengyur: tengyur.length, t4: t4.length, latin: latin.length },
  sources: { tengyur: 'scripts/eval/results/tengyur-ref-2026-10/stored/sample.json (#5797), reference cuts rebuilt with tengyur-ref/build-reference.py', t4: 'xlref-t4 records-arms.jsonl (#5695 T4), minus 2 pages with the reference in the translator context', latin: 'scripts/eval/results/xlref-t1-2026-10/records.jsonl (#5695 T1)' },
  pages: records.map((r) => ({ set: r.set, lang: r.lang, book_id: r.book_id, page_number: r.page_number, toh: r.toh, folio: r.folio, context_mode: r.context_mode, source_sha16: sha16(r.source_text), source_chars: r.source_text.length, reference_translator: r.reference_meta.translator, reference_style: r.reference_meta.style, reference_private: !!r.reference_meta.private, canonical: !!r.reference_meta.canonical })) }, null, 1));
console.log(`records: tengyur ${tengyur.length}, t4 ${t4.length}, latin ${latin.length} → ${path.join(WORK, 'records.jsonl')}`);
const by = {}; for (const r of records) by[`${r.set}:${r.lang}`] = (by[`${r.set}:${r.lang}`] || 0) + 1; console.log(JSON.stringify(by));
