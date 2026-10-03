#!/usr/bin/env node
// PRIOR ART: scripts/eval/tibetan-mt-ab/build-judge-packet.mjs --generic reads this same layout (sample.json +
// <lang>/packet.jsonl + arms/gemini/<engine>/<id>.json, as written by #5606) straight into a packet. This converts it
// to the translation-vs-reference INPUT RECORD instead, so the #5606 references (SuttaCentral CC0, pre-1931 PD
// English) can be re-used by the #5695 tracks without re-cutting them.
/** Convert a #5606-style A/B sample (sample.json + per-language packet + arm outputs) into translation-vs-reference input records. */
/**
 *   node scripts/eval/translation-vs-reference/from-ab-sample.mjs --dir <results dir> --lang Pali --track T5 --out <records.jsonl>
 *        [--engines flash=flash-batch,lite=lite-batch] [--style literal] [--canonical true] [--year 2018] [--limit 6] [--ids a,b]
 * The source text is the one the arms were given (<dir>/<lang>/packet.jsonl "source"). Translator is parsed from the
 * sample's reference "source" field ("English by …"), or "translator" if present.
 */
import fs from 'node:fs';
import path from 'node:path';
import { readJsonl, writeJsonl } from './common.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] != null ? args[i + 1] : d; };
const DIR = opt('dir'); const LANG = opt('lang'); const TRACK = opt('track'); const OUT = opt('out');
if (!DIR || !LANG || !TRACK || !OUT) { console.error('--dir, --lang, --track, --out required'); process.exit(1); }
const ENGINES = Object.fromEntries(opt('engines', 'flash=flash-batch,lite=lite-batch').split(',').map((kv) => kv.split('=')));
const STYLE = opt('style', 'literal'); const CANON = opt('canonical', 'false') === 'true'; const YEAR = opt('year', null);
const LIMIT = Number(opt('limit', 1e9)); const IDS = opt('ids', null)?.split(',');

const sample = JSON.parse(fs.readFileSync(path.join(DIR, 'sample.json'), 'utf8')).filter((r) => r.lang === LANG);
const src = Object.fromEntries(readJsonl(path.join(DIR, LANG, 'packet.jsonl')).map((l) => [l.id, l.source]));
const translatorOf = (r) => {
  if (r.translator) return r.translator;
  const m = String(r.source || '').match(/English by ([^;(]+)/);
  if (m) return /pli-tv/.test(r.located || '') && /Brahmali/.test(r.source) ? 'Bhikkhu Brahmali' : m[1].trim();
  return String(r.source || 'unknown').split(',')[0].trim();
};
const out = []; const skipped = [];
for (const r of sample) {
  const id = `${r.book_id}_${String(r.page_number).padStart(5, '0')}`;
  if (IDS && !IDS.includes(id)) continue;
  if (!src[id]) { skipped.push({ id, why: 'not in the language packet (excluded or replaced in #5606)' }); continue; }
  const candidates = [];
  for (const [arm, dir] of Object.entries(ENGINES)) {
    const f = path.join(DIR, 'arms', 'gemini', dir, `${id}.json`);
    if (!fs.existsSync(f)) continue;
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    candidates.push({ arm, text: j.text || '', model: j.model ?? null, finishReason: j.finishReason ?? null });
  }
  if (!candidates.length) { skipped.push({ id, why: 'no arm output' }); continue; }
  out.push({
    track: TRACK, lang: LANG, book_id: r.book_id, page_number: Number(r.page_number), source_text: src[id], reference_text: r.reference,
    reference_meta: { title: r.title, translator: translatorOf(r), year: YEAR ? Number(YEAR) : null, licence: r.licence, private: false, style: STYLE,
      canonical: CANON, located: r.located ?? null, url: r.url ?? null, coverage_note: r.coverage_note ?? null, origin: path.basename(path.resolve(DIR)) },
    candidates,
  });
  if (out.length >= LIMIT) break;
}
writeJsonl(OUT, out);
console.log(`${out.length} ${LANG} records → ${OUT}; skipped ${skipped.length}`);
