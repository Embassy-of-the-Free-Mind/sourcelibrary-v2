#!/usr/bin/env node
/**
 * relabel-language-4884.mjs — correct `books.language` where the PAGE shows another language (#4884).
 *
 * PRIOR ART: scripts/maintenance/detect-language-from-pages.mjs (#4696) and
 * scripts/audit/detect-book-languages.mjs (#4117) read the `<language>` tag out of OCR text, so they
 * cannot see a book that was never transcribed (most hidden Greek); here the tag aggregation is the
 * SECOND instrument, not the first. scripts/maintenance/relabel-bilingual-edition.mjs adds a second
 * language to one book by hand. scripts/eval/langid-5777.mjs is the reader this job reuses unchanged
 * (its --fetch / --submit / --collect run against this job's picks via LANGID_RESULTS_DIR); this file
 * holds only the candidate rule, the proposal rule and the writer.
 *
 * Phases:
 *   --candidates   $0   books whose label's script disagrees with book_class.script_family (#5768),
 *                       plus the confusable families of #5795 / #4884           → candidates.jsonl
 *   --pick         $0   one interior page per candidate (two for compound labels) → picks.jsonl
 *   (read)         paid LANGID_RESULTS_DIR=scripts/eval/results/relabel-4884 node scripts/eval/langid-5777.mjs --fetch|--submit|--collect
 *   --propose      $0   page reads + OCR-tag aggregation → proposals.jsonl, one pattern per row
 *   --write        dry run unless --commit; writes only patterns named in accepted-patterns.json
 *   --undo         dry run unless --commit; restores every book from its sweep_log row
 *
 * Writes `language`, `languages[]`, `language_multi`, `field_provenance.language`, `updated_at` and one
 * `sweep_log` row per book (sweep `relabel-4884`, old values in `detail.before`). No new field.
 * Never touches `original_language`, `text_role`, `pipeline_auto` or a hold.
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { toLanguageCodes, languageRow, codeFamily, languageCode, languageName } from '../lib/language-normalize.mjs';

export const SWEEP = 'relabel-4884';
const DIR = path.resolve('scripts/eval/results/relabel-4884');
const args = process.argv.slice(2);
const has = (f) => args.includes(`--${f}`);
const readJsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const inDir = (f) => path.join(DIR, f);

/** ISO 15924 script → the family vocabulary `book_class.script_family` uses (book-class-5768.mjs). */
const SCRIPT_FAMILY = {
  Latn: 'latin', Goth: 'latin', Grek: 'greek', Cyrl: 'cyrillic', Cyrs: 'cyrillic', Armn: 'armenian', Geor: 'georgian',
  Hebr: 'hebrew', Samr: 'hebrew', Syrc: 'syriac', Arab: 'arabic', Ethi: 'ethiopic', Copt: 'coptic', Egyp: 'egyptian', Xsux: 'cuneiform',
  Mong: 'mongolian', Tibt: 'tibetan', Hani: 'cjk', Jpan: 'cjk', Kore: 'cjk', Tang: 'cjk',
  Deva: 'indic', Newa: 'indic', Beng: 'indic', Gujr: 'indic', Guru: 'indic', Taml: 'indic', Telu: 'indic', Knda: 'indic', Mlym: 'indic', Sinh: 'indic', Brah: 'indic',
  Mymr: 'southeast-asian', Thai: 'southeast-asian', Khmr: 'southeast-asian', Java: 'southeast-asian', Kawi: 'southeast-asian', Bali: 'southeast-asian', Sund: 'southeast-asian', Bugi: 'southeast-asian',
};
export const scriptFamilyOfCode = (code) => SCRIPT_FAMILY[languageRow(code)?.script] || 'other';

/** The families #5795 showed are confused WITHIN one script, by the first catalogued language. */
const ARABIC_SCRIPT = new Set(['ara', 'fas', 'urd', 'ota', 'chg', 'uig', 'msa', 'jrb', 'jpr']);
const DEVANAGARI = new Set(['san', 'pra', 'pka', 'hin', 'mar', 'nep', 'mai', 'kas']);
const INDEPENDENT = new Set(['ocr-text-letters', 'contact-sheet', 'clip-knn']);

/** One candidate pattern per book, or null. First rule that fires wins. */
export function candidatePattern(b) {
  const { codes } = toLanguageCodes(b.language);
  if (!codes.length) return null; // und / Unknown: #5777's population, not this job's
  const first = codes[0];
  const labelFamilies = new Set(codes.map(scriptFamilyOfCode));
  const fam = b.book_class?.script_family || null;
  const src = b.book_class?.evidence?.family_source || null;
  const firstFam = scriptFamilyOfCode(first);
  if (src === 'books.language (OCR is a transliteration)') {
    // #5768 saw LATIN letters in the OCR under a non-Latin label and kept the label's family.
    if (firstFam === 'other' || firstFam === 'cuneiform' || firstFam === 'egyptian') return null; // Turfan / ETCSL: real transliterations
    return codeFamily(first) === 'grc' ? 'greek-label/latin-ocr-letters' : `${firstFam}-label/latin-ocr-letters`;
  }
  if (fam && INDEPENDENT.has(src) && !labelFamilies.has(fam) && firstFam !== 'other') return `${firstFam}-label/${fam}-pages`;
  if (codeFamily(first) === 'grc' && (!fam || !INDEPENDENT.has(src))) return 'greek-label/unread';
  if (ARABIC_SCRIPT.has(first)) return 'arabic-script/confusable';
  if (DEVANAGARI.has(first)) return 'devanagari/confusable';
  return null;
}

async function withDb(fn) {
  const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 4 }); await client.connect();
  try { return await fn(client.db('bookstore')); } finally { await client.close(); }
}

async function phaseCandidates() {
  fs.mkdirSync(DIR, { recursive: true });
  await withDb(async (db) => {
    const cur = db.collection('books').find({ pages_count: { $gt: 0 } }, { projection: {
      id: 1, title: 1, language: 1, languages: 1, language_multi: 1, original_language: 1, text_role: 1, visible: 1, created_at: 1,
      pages_count: 1, pages_ocr: 1, 'image_source.provider': 1, 'book_class.class': 1, 'book_class.script_family': 1,
      'book_class.evidence.family_source': 1, 'book_class.evidence.secondary_family': 1, 'pipeline_auto.status': 1, 'pipeline_auto.hold.reason': 1,
    } });
    const out = fs.createWriteStream(inDir('candidates.jsonl'));
    const T = {}; let n = 0, total = 0;
    for await (const b of cur) {
      total++;
      const pattern = candidatePattern(b);
      if (!pattern) continue;
      n++;
      const k = (T[pattern] ||= { books: 0, visible: 0, pages: 0 }); k.books++; k.pages += b.pages_count; if (b.visible) k.visible++;
      out.write(JSON.stringify({
        book_id: b.id, pattern, title: b.title || null, language: b.language, languages: b.languages ?? null, language_multi: b.language_multi ?? null,
        original_language: b.original_language ?? null, text_role: b.text_role ?? null, visible: !!b.visible, created_at: b.created_at ?? null,
        pages_count: b.pages_count, pages_ocr: b.pages_ocr || 0, provider: b.image_source?.provider || null,
        class: b.book_class?.class ?? null, script_family: b.book_class?.script_family ?? null, family_source: b.book_class?.evidence?.family_source ?? null,
        secondary_family: b.book_class?.evidence?.secondary_family ?? null, status: b.pipeline_auto?.status ?? null, hold: b.pipeline_auto?.hold?.reason ?? null,
      }) + '\n');
    }
    await new Promise((r) => out.end(r));
    const rows = Object.entries(T).sort((a, b) => b[1].books - a[1].books);
    fs.writeFileSync(inDir('candidates.summary.json'), JSON.stringify({ generated_at: new Date().toISOString(), books_scanned: total, candidates: n, by_pattern: Object.fromEntries(rows) }, null, 2) + '\n');
    console.log(`scanned ${total}; candidates ${n}`);
    for (const [p, v] of rows) console.log(`${String(v.books).padStart(6)} books  ${String(v.visible).padStart(5)} visible  ${String(v.pages).padStart(8)} pp  ${p}`);
  });
}

// ── --pick ─────────────────────────────────────────────────────────────────────────────────────
// BSB and the Vatican ration image requests by the day and the box's archivers share that budget
// (book-class-5768.mjs, 2026-10-04: 9,577 429s). A book whose page image lives only there is deferred.
const RATE_LIMITED_HOSTS = /(^|\.)(digitale-sammlungen\.de|vatlib\.it)$/;
const SKIP_TYPES = /blank|cover|binding|endpaper|flyleaf|spine|colou?r.?(chart|target)|calibration/i;
const hostOf = (u) => { try { return new URL(u).host; } catch { return null; } };

/** Page numbers nearest a fraction of the book, alternating outward. */
function around(pagesCount, fraction, k = 6) {
  const t = Math.min(pagesCount, Math.max(1, Math.round(pagesCount * fraction)));
  const out = [t];
  for (let d = 1; out.length < Math.min(k, pagesCount) && d <= pagesCount; d++) { if (t + d <= pagesCount) out.push(t + d); if (t - d >= 1) out.push(t - d); }
  return out.slice(0, k);
}

/**
 * `--pick` is the first read: one page at 40% of every candidate. `--pick --second` is the confirming
 * read at 72%, for every book whose first read named a language its label does not, and for every
 * compound label. The second read is filed under the pseudo id `<book_id>~2` so the #5777 reader,
 * which keeps one page per book id per round, runs unchanged.
 */
async function phasePick() {
  const { imageUrlFor } = await import('../eval/langid-5777.mjs');
  const second = has('second');
  let cands = readJsonl(inDir('candidates.jsonl'));
  if (second) {
    const want = new Set(firstReads().filter((r) => r.disagrees || r.compound).map((r) => r.book_id));
    cands = cands.filter((c) => want.has(c.book_id));
  }
  const fraction = second ? 0.72 : 0.4;
  const picksPath = inDir('picks.jsonl');
  const have = new Set(readJsonl(picksPath).map((p) => p.book_id));
  const deferred = [];
  let written = 0;
  await withDb(async (db) => {
    const pages = db.collection('pages');
    for (const c of cands) {
      const key = second ? `${c.book_id}~2` : c.book_id;
      if (have.has(key)) continue;
      const order = around(c.pages_count, fraction);
      const docs = await pages.find({ book_id: c.book_id, page_number: { $in: order } }, { projection: { id: 1, page_number: 1, photo: 1, photo_original: 1, display_photo: 1, archived_photo: 1, enhanced_photo: 1, cropped_photo: 1, split_from_spread: 1, crop: 1, page_type: 1, 'image_characteristics.flags.is_blank': 1 } }).toArray();
      const byNum = new Map(docs.map((d) => [d.page_number, d]));
      const good = [], poor = [];
      for (const n of order) {
        const p = byNum.get(n); if (!p) continue;
        const img = imageUrlFor(p); if (!img) continue;
        const skip = !!p.image_characteristics?.flags?.is_blank || SKIP_TYPES.test(p.page_type || '');
        (skip ? poor : good).push({ page_number: n, page_id: p.id, ...img });
      }
      const candidates = [...good, ...poor].filter((x) => !RATE_LIMITED_HOSTS.test(hostOf(x.url) || ''));
      if (!candidates.length) { deferred.push({ book_id: c.book_id, pattern: c.pattern, visible: c.visible, read: second ? 2 : 1, reason: good.length + poor.length ? 'rate-limited host only (BSB / Vatican)' : 'no page image' }); continue; }
      fs.appendFileSync(picksPath, JSON.stringify({ book_id: key, real_book_id: c.book_id, pattern: c.pattern, stored_language: c.language, pages_count: c.pages_count, provider: c.provider, target_page: order[0], candidates }) + '\n');
      written++;
    }
  });
  fs.appendFileSync(inDir('deferred.jsonl'), deferred.map((d) => JSON.stringify(d)).join('\n') + (deferred.length ? '\n' : ''));
  const t = {}; for (const d of deferred) t[`${d.pattern} — ${d.reason}`] = (t[`${d.pattern} — ${d.reason}`] || 0) + 1;
  console.log(`picks written: ${written}; deferred: ${deferred.length}`); console.log(t);
}

function firstReads() { return []; }

if (import.meta.url === `file://${process.argv[1]}`) {
  if (has('candidates')) await phaseCandidates();
  else if (has('pick')) await phasePick();
  else console.log('usage: --candidates | --pick | --propose | --write [--commit] | --undo [--commit]');
}
