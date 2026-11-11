#!/usr/bin/env node
/**
 * edition-language-vs-ocr.mjs — public books whose `books.language` disagrees with
 * the language their OCR declared on the pages we sampled. READ-ONLY. (#6056, #4654)
 *
 * PRIOR ART: scripts/audit/language-vs-ocr.mjs (#4662) — same `<language>` tag, but it
 *   samples ONE window (12 pages from 35% in), stops at --limit 500 books, and can
 *   --apply a write. This one walks the whole public corpus, samples up to 20 pages
 *   SPREAD through each book (so a book that is mostly another language cannot hide in
 *   an unlucky window), never writes, and separates multilingual editions from
 *   mismatches via `languages[]`. It is a count-and-list instrument, not a fixer.
 *
 * Rule (language-fields.md): `language` is the EDITION's language. A flag is a RECORD
 * to look at, not a verdict — a German edition of a Latin work is correctly `German`,
 * and an English translation of Latin pages reads English in the OCR anyway. A human
 * decides. `text_role` is carried on every row so translation editions can be filtered.
 *
 * Flag = public book (visible:true, pages_count>0) with >= MIN_TAGGED tagged pages among
 * <= SAMPLE sampled, where one normalised language holds a majority (>= 50%; "strong" at
 * >= 80%) of the tagged pages and is NOT in the book's label set (language + languages[],
 * split on / , ; & and "et"). Positive control 69de98d21b234a773e439622 (labelled Latin,
 * OCR German on 13 of 19 tagged sampled pages) is "moderate"; run with --ids to see votes.
 * Buckets: flagged | multilingual (page tags split, but every top tag is in the label set)
 * | consistent | thin (< MIN_TAGGED tagged pages — not judged).
 *
 * The tag is extracted SERVER-side ($regexFind) so only the captured string crosses the wire.
 *
 * Usage (run on Hetzner for the full walk; the laptop's Atlas link resets):
 *   node --env-file=.env.production.local scripts/audit/edition-language-vs-ocr.mjs \
 *        [--out FILE.jsonl] [--limit N] [--ids a,b,c]
 *   stdout: counts only. --out gets one JSON row per flagged book.
 */
import { MongoClient } from 'mongodb';
import { writeFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const OUT = opt('out', null);
const LIMIT = Number(opt('limit', 0));
const IDS = opt('ids', null)?.split(',');
const SAMPLE = 20, MIN_TAGGED = 5, MAJORITY = 0.8, PLURALITY = 0.5;

/** Fold the many spellings of a language into one comparison key. */
export function normLang(s) {
  let t = String(s ?? '').toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-zÀ-ɏͰ-῿一-鿿 ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  // The OCR sometimes tags with the ISO code ("de", "la") instead of the name; the first run
  // flagged ~230 books on that alone (german -> de). Fold codes to names before comparing.
  const ISO = { de: 'german', ger: 'german', deu: 'german', en: 'english', eng: 'english', la: 'latin', lat: 'latin', fr: 'french', fre: 'french', fra: 'french', it: 'italian', ita: 'italian', es: 'spanish', spa: 'spanish', nl: 'dutch', dut: 'dutch', nld: 'dutch', el: 'greek', grc: 'greek', gre: 'greek', he: 'hebrew', heb: 'hebrew', ar: 'arabic', ara: 'arabic', zh: 'chinese', chi: 'chinese', zho: 'chinese', ko: 'korean', kor: 'korean', fa: 'persian', sa: 'sanskrit', pt: 'portuguese', por: 'portuguese', ru: 'russian', rus: 'russian' };
  if (ISO[t]) return ISO[t];
  if (/chinese|literary chinese|wenyan/.test(t)) return 'chinese';
  if (/greek/.test(t)) return /modern/.test(t) ? 'modern greek' : 'greek';
  if (/latin/.test(t)) return 'latin';
  if (/hebrew/.test(t)) return 'hebrew';
  if (/german|deutsch/.test(t) && !/low german|plattdeutsch/.test(t)) return 'german';
  if (/french/.test(t)) return 'french';
  if (/english/.test(t)) return 'english';
  if (/italian/.test(t)) return 'italian';
  if (/spanish|castilian/.test(t)) return 'spanish';
  if (/dutch|flemish/.test(t)) return 'dutch';
  if (/arabic/.test(t)) return 'arabic';
  if (/persian|farsi/.test(t)) return 'persian';
  if (/sanskrit/.test(t)) return 'sanskrit';
  if (/tibetan/.test(t)) return 'tibetan';
  return t;
}
const NOT_A_LANGUAGE = /^(unknown|und|mul|zxx|none|n a|books?|texts?|)$/;
/** A label like "Latin/Greek" or "Latin and Greek" names several languages. */
export function labelSet(language, languages) {
  const parts = [language, ...(Array.isArray(languages) ? languages : [])]
    .flatMap((x) => String(x ?? '').split(/[/,;&]| and | et /i)).map(normLang);
  return new Set(parts.filter((p) => p && !NOT_A_LANGUAGE.test(p)));
}
/** Pure verdict from a vote map {normLang: n} — exported so the positive control can be tested without Mongo. */
export function judge(label, votes) {
  const tagged = Object.values(votes).reduce((a, n) => a + n, 0);
  if (tagged < MIN_TAGGED) return { bucket: 'thin', tagged };
  const ranked = Object.entries(votes).sort((a, b) => b[1] - a[1]);
  const [top, topN] = ranked[0];
  const share = topN / tagged;
  if (label.has(top) && share >= PLURALITY) return { bucket: 'consistent', tagged, top, share };
  // Strong = the requested >= 80% majority. Moderate = a plain majority (>= 50%) of a language
  // the label does not name; the De Prospectiva Pingendi control sits here (German 13/19 = 68%,
  // labelled Latin) and an 80% bar would have missed it, so both tiers are reported.
  if (share >= PLURALITY && !label.has(top)) return { bucket: 'flagged', strength: share >= MAJORITY ? 'strong' : 'moderate', tagged, top, share };
  return { bucket: ranked.slice(0, 2).every(([l]) => label.has(l)) ? 'multilingual' : 'mixed_unjudged', tagged, top, share };
}
const spread = (n) => {
  const k = Math.min(SAMPLE, n);
  return [...new Set(Array.from({ length: k }, (_, i) => Math.round((i * (n - 1)) / Math.max(1, k - 1)) + 1))];
};

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const client = await MongoClient.connect(process.env.MONGODB_URI);
  const db = client.db('bookstore');
  const q = IDS ? { id: { $in: IDS } } : { visible: true, pages_count: { $gt: 0 }, language: { $type: 'string' } };
  let cur = db.collection('books').find(q, { projection: { id: 1, title: 1, language: 1, languages: 1, text_role: 1, pages_count: 1, original_language: 1 } });
  if (LIMIT) cur = cur.limit(LIMIT);
  const books = await cur.toArray();
  const buckets = {}, pairs = {}, flagged = [];
  for (let i = 0; i < books.length; i += 100) {
    const batch = books.slice(i, i + 100);
    const rows = await db.collection('pages').aggregate([
      { $match: { $or: batch.map((b) => ({ book_id: b.id, page_number: { $in: spread(b.pages_count) } })) } },
      { $project: { book_id: 1, m: { $regexFind: { input: { $ifNull: ['$ocr.data', ''] }, regex: /<language>([^<]{1,40})<\/language>/i } } } },
      { $match: { 'm.captures.0': { $nin: [null, ''] } } },
      { $group: { _id: { b: '$book_id', l: { $toLower: { $trim: { input: { $arrayElemAt: ['$m.captures', 0] } } } } }, n: { $sum: 1 } } },
    ], { allowDiskUse: true }).toArray();
    const votes = new Map();
    for (const r of rows) {
      // A page tagged "German, Latin" votes for its FIRST (primary) language; folding the whole
      // string let the Latin regex swallow it and flagged German books as Latin.
      const l = normLang(r._id.l.split(/[,/;&]| and /)[0]);
      if (!l || NOT_A_LANGUAGE.test(l)) continue;
      const v = votes.get(r._id.b) ?? {};
      v[l] = (v[l] ?? 0) + r.n;
      votes.set(r._id.b, v);
    }
    for (const b of batch) {
      const label = labelSet(b.language, b.languages);
      const j = judge(label, votes.get(b.id) ?? {});
      buckets[j.bucket] = (buckets[j.bucket] ?? 0) + 1;
      if (IDS) console.error(b.id, JSON.stringify(votes.get(b.id) ?? {}), JSON.stringify(j));
      if (j.bucket === 'flagged') {
        const key = `${normLang(b.language)} -> ${j.top}`;
        pairs[key] = (pairs[key] ?? 0) + 1;
        flagged.push({ id: b.id, title: b.title, language: b.language, languages: b.languages, text_role: b.text_role ?? null, strength: j.strength, ocr_language: j.top, share: +j.share.toFixed(2), tagged: j.tagged });
      }
    }
  }
  if (OUT) writeFileSync(OUT, flagged.map((r) => JSON.stringify(r)).join('\n') + '\n');
  console.log(JSON.stringify({ books: books.length, buckets, flagged_strong: flagged.filter((r) => r.strength === 'strong').length, flagged_non_translation_role: flagged.filter((r) => !/translation/.test(r.text_role ?? '')).length, top_pairs: Object.entries(pairs).sort((a, b) => b[1] - a[1]).slice(0, 12), out: OUT }, null, 1));
  await client.close();
}
