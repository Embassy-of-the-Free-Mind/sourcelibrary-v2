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
const picksPath0 = () => inDir('picks.jsonl');
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
  const READ = has('second') ? 2 : Number(args[args.indexOf('--read') + 1]) || 1;
  const second = READ > 1;
  let cands = readJsonl(inDir('candidates.jsonl'));
  const firstPage = new Map(), seen = new Map();
  if (READ === 2) {
    const fr = firstReads().filter((r) => r.disagrees || (r.compound && r.reads.length));
    for (const r of fr) firstPage.set(r.book_id, r.reads.find((x) => x.read === 1)?.page_number);
    cands = cands.filter((c) => firstPage.has(c.book_id));
  } else if (READ > 2) {
    // Reads 3 and 4 (gate 1 found a Greek–Latin edition whose two sampled pages were preface and notes):
    // only for books two reads already agree on, in the patterns named by --gate-patterns.
    const want = new Set(String(args[args.indexOf('--gate-patterns') + 1] || '').split('|'));
    const two = new Map(readJsonl(inDir('proposals.jsonl')).filter((p) => /^flip/.test(p.decision) && want.has(p.gate_pattern)).map((p) => [p.book_id, p]));
    for (const [id, p] of two) seen.set(id, new Set(p.reads.map((r) => r.page_number)));
    for (const k of readJsonl(picksPath0())) if (k.real_book_id && k.book_id !== k.real_book_id) seen.get(k.real_book_id)?.add(k.target_page);
    cands = cands.filter((c) => two.has(c.book_id));
  }
  const fraction = { 1: 0.4, 2: 0.72, 3: 0.22, 4: 0.56 }[READ];
  const picksPath = inDir('picks.jsonl');
  const have = new Set(readJsonl(picksPath).map((p) => p.book_id));
  for (const d of readJsonl(inDir('deferred.jsonl'))) have.add(d.read > 1 ? `${d.book_id}~${d.read}` : d.book_id);
  const deferred = [];
  let written = 0;
  await withDb(async (db) => {
    const pages = db.collection('pages');
    for (const c of cands) {
      const key = second ? `${c.book_id}~${READ}` : c.book_id;
      if (have.has(key)) continue;
      let order = around(c.pages_count, fraction, second ? 10 : 6);
      // The confirming read takes a page of the OTHER parity, so a facing-page edition shows both sides.
      if (READ === 2) { const p1 = firstPage.get(c.book_id); order = order.filter((n) => p1 == null || (n % 2 !== p1 % 2 && Math.abs(n - p1) > 1)); }
      if (READ > 2) { const used = seen.get(c.book_id) || new Set(); order = order.filter((n) => ![...used].some((u) => Math.abs(u - n) <= 1) && (READ === 3 ? n % 2 === 1 : n % 2 === 0)); }
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
      if (!candidates.length) { deferred.push({ book_id: c.book_id, pattern: c.pattern, visible: c.visible, read: READ, reason: good.length + poor.length ? 'rate-limited host only (BSB / Vatican)' : 'no page image' }); continue; }
      fs.appendFileSync(picksPath, JSON.stringify({ book_id: key, real_book_id: c.book_id, pattern: c.pattern, stored_language: c.language, pages_count: c.pages_count, provider: c.provider, target_page: order[0], candidates }) + '\n');
      written++;
    }
  });
  fs.appendFileSync(inDir('deferred.jsonl'), deferred.map((d) => JSON.stringify(d)).join('\n') + (deferred.length ? '\n' : ''));
  const t = {}; for (const d of deferred) t[`${d.pattern} — ${d.reason}`] = (t[`${d.pattern} — ${d.reason}`] || 0) + 1;
  console.log(`picks written: ${written}; deferred: ${deferred.length}`); console.log(t);
}

// ── reads ──────────────────────────────────────────────────────────────────────────────────────

/** The reader's free-text language → ordered vocabulary codes ("Sanskrit and Hindi" → [san, hin]). */
export function observedCodes(verdict) {
  if (!verdict || verdict.content === 'no_text' || /^(none|unknown)$/i.test(verdict.language || '')) return [];
  return toLanguageCodes(verdict.language).codes;
}

/** One row per candidate book: its label, its page reads, and whether the first read contradicts the label. */
function firstReads() {
  const cands = new Map(readJsonl(inDir('candidates.jsonl')).map((c) => [c.book_id, c]));
  const reads = new Map();
  for (const r of readJsonl(inDir('raw.jsonl'))) {
    if (r.error || !r.verdict) continue;
    const [id, n] = r.book_id.split('~');
    if (!reads.has(id)) reads.set(id, new Map());
    reads.get(id).set(`${n || 1}`, { read: Number(n || 1), page_number: r.page_number, ...r.verdict, codes: observedCodes(r.verdict) });
  }
  const out = [];
  for (const [id, c] of cands) {
    const rs = [...(reads.get(id)?.values() || [])].sort((a, b) => a.read - b.read);
    const label = toLanguageCodes(c.language).codes;
    const labelFams = new Set(label.map(codeFamily));
    const r1 = rs.find((r) => r.read === 1);
    const disagrees = !!r1 && r1.codes.length > 0 && !r1.codes.some((x) => labelFams.has(codeFamily(x)));
    out.push({ ...c, label, compound: label.length > 1 || c.language_multi === true, reads: rs, disagrees });
  }
  return out;
}

// ── --propose ──────────────────────────────────────────────────────────────────────────────────

/** The reader's script name → book_class family ("Greek" → greek, "Devanagari" → indic). */
const READER_SCRIPT = [[/^latin/i, 'latin'], [/greek/i, 'greek'], [/cyrillic/i, 'cyrillic'], [/hebrew|samaritan/i, 'hebrew'], [/arabic|perso/i, 'arabic'], [/syriac/i, 'syriac'], [/coptic/i, 'coptic'],
  [/devanagari|bengali|gujarati|gurmukhi|tamil|telugu|kannada|malayalam|sinhala|sharada|grantha|brahmi/i, 'indic'], [/tibetan/i, 'tibetan'], [/han|kana|hangul|chinese|japanese|korean/i, 'cjk'],
  [/thai|lao|khmer|burmese|javanese|balinese|batak/i, 'southeast-asian'], [/ge.?ez|ethiopic/i, 'ethiopic'], [/armenian/i, 'armenian'], [/georgian/i, 'georgian'], [/mongol|manchu/i, 'mongolian']];
const readerScriptFamily = (x) => (READER_SCRIPT.find(([re]) => re.test(String(x || ''))) || [])[1] || null;
const MIN_CONFIDENCE = 0.8;
const MIN_READS_TO_WRITE = 4;
const TRANSLATION_ROLES = new Set(['modern-translation', 'period-translation', 'translation']);
/** language-fields.md: provenance and tradition, not a mislabel. Label family → observed family never flipped. */
const NEVER_FLIP = new Set(['kor>zho', 'jpn>zho', 'vie>zho', 'bod>san', 'mon>bod', 'mnc>zho']);

/** The second instrument where the book has OCR: the per-page <language> tag, one vote per family per page. */
async function tagTally(db, bookId) {
  const rows = await db.collection('pages').aggregate([
    { $match: { book_id: bookId, 'ocr.data': { $type: 'string' } } },
    { $project: { m: { $regexFind: { input: '$ocr.data', regex: '<language>([^<]{0,200})</language>' } } } },
    { $group: { _id: { $arrayElemAt: ['$m.captures', 0] }, n: { $sum: 1 } } },
  ]).toArray();
  const fam = new Map(); let tagged = 0;
  for (const r of rows) {
    if (!r._id) continue;
    const fams = new Set(toLanguageCodes(r._id).codes.map(codeFamily));
    if (!fams.size) continue;
    tagged += r.n;
    for (const f of fams) fam.set(f, (fam.get(f) || 0) + r.n);
  }
  return { tagged, shares: Object.fromEntries([...fam].sort((a, b) => b[1] - a[1]).map(([f, n]) => [f, +(n / tagged).toFixed(3)])) };
}

/**
 * The decision for one book. `flip` needs TWO page reads from different parts of the book (opposite
 * page parity, so a facing-page edition shows both of its sides) naming one language family the label
 * does not carry, each at confidence ≥ 0.8 on a text page; and, where the book has ≥ 10 OCR-tagged
 * pages, the tags must put that family first at ≥ 60% and the label's family under 10%.
 */
export function decide(row, tags) {
  const usable = row.reads.filter((r) => r.codes.length && r.content === 'text' && (r.confidence ?? 0) >= MIN_CONFIDENCE);
  const r1 = usable.find((r) => r.read === 1), r2 = usable.find((r) => r.read === 2);
  if (!row.reads.length) return { decision: 'unread' };
  const first = row.reads.find((r) => r.read === 1);
  if (first && !first.codes.length) return { decision: 'report', why: /^(none|unknown)$/i.test(first.language) || first.content === 'no_text' ? 'no language readable on the page' : 'reader named a language outside the vocabulary' };
  if (!row.disagrees) return { decision: 'label-confirmed' };
  if (!r1 || !r2) return { decision: 'report', why: 'fewer than two confident text reads' };
  const labelFams = new Set(row.label.map(codeFamily));
  const f1 = codeFamily(r1.codes[0]), f2 = codeFamily(r2.codes[0]);
  if (r1.codes.length > 1 || r2.codes.length > 1) return { decision: 'report', why: 'a read names two languages on one page' };
  if (labelFams.has(f2)) return { decision: 'report', why: `mixed: one page ${languageName(r1.codes[0])}, one page in the label's language` };
  if (f1 !== f2) return { decision: 'report', why: `two reads disagree (${languageName(r1.codes[0])} / ${languageName(r2.codes[0])})` };
  if (NEVER_FLIP.has(`${codeFamily(row.label[0])}>${f1}`)) return { decision: 'report', why: 'tradition class (language-fields.md): never flipped' };
  if (row.compound) return { decision: 'report', why: 'compound label: curatorial' };
  if (tags && tags.tagged >= 10) {
    const top = Object.keys(tags.shares)[0];
    const labelShare = Math.max(0, ...[...labelFams].map((f) => tags.shares[f] || 0));
    if (top !== f1 || tags.shares[top] < 0.6) return { decision: 'report', why: `OCR tags do not put ${languageName(r1.codes[0])} first at ≥ 60%` };
    if (labelShare >= 0.1) return { decision: 'report', why: `label language on ${Math.round(labelShare * 100)}% of OCR-tagged pages: bilingual, curatorial` };
  }
  // Same code on both reads keeps it; two stages of one family fall back to the family's own code.
  const to = r1.codes[0] === r2.codes[0] ? r1.codes[0] : f1;
  // Reads 3 and 4, where taken: any page in the label's language, or in a third language, stops the flip.
  const extra = row.reads.filter((r) => r.read > 2);
  for (const r of extra) {
    if (r.codes.some((x) => labelFams.has(codeFamily(x)))) return { decision: 'report', why: `mixed: read ${r.read} is in the label's language`, to };
    if (r.codes.length && r.content === 'text' && codeFamily(r.codes[0]) !== f1) return { decision: 'report', why: 'two reads disagree', to };
  }
  const agreeing = 2 + extra.filter((r) => r.codes.length === 1 && r.content === 'text' && (r.confidence ?? 0) >= MIN_CONFIDENCE && codeFamily(r.codes[0]) === f1).length;
  const instruments = `${agreeing} page reads${tags && tags.tagged >= 10 ? ' + OCR tags' : ''}`;
  // Gate 2 (2026-10-04, eye-check-gate2.json): both Greek → Latin misses were Greek–Latin editions, and
  // on both the reader had listed the label's script among `other_scripts`. Any trace of it stops the flip.
  const labelScripts = new Set(row.label.map(scriptFamilyOfCode));
  const trace = row.reads.find((r) => [r.script, ...(r.other_scripts || [])].some((x) => labelScripts.has(readerScriptFamily(x))));
  if (trace) return { decision: 'report', why: `the label's script is on a sampled page (read ${trace.read}): possibly bilingual`, to };
  // The write needs four agreeing reads, not two.
  return { decision: agreeing >= MIN_READS_TO_WRITE ? 'flip' : 'flip-2-reads', to, agreeing, instruments };
}

/**
 * Pattern = what the write would change, by name: "Greek → Latin". A translation edition (text_role)
 * catalogued under its source's language is its own pattern (#2184): there the old label is the
 * work's language, so the write also fills an empty `original_language` with it.
 */
function writePattern(row, to) {
  const from = languageName(row.label[0]);
  if (TRANSLATION_ROLES.has(row.text_role)) return `translation edition: ${from} → ${languageName(to)}`;
  return `${from} → ${languageName(to)}`;
}

/** Pairs that had ≥ 10 two-read flips when gate 1 was drawn; they keep their name after the four-read rule thins them. */
const NAMED_AT_GATE_1 = new Set(['Greek → Latin', 'Javanese → Arabic', 'Javanese → Balinese', 'Latin → Greek', 'Sanskrit → English', 'Javanese → Malay', 'Sanskrit → Hindi']);
const VERNACULAR = new Set(['German', 'Italian', 'French', 'Spanish', 'English', 'Dutch']);
/** The by-eye gate judges groups it can sample: named pairs with ≥ 10 books, Greek → any vernacular, translation editions, and the rare-pair tail. */
function gatePatterns(out) {
  const flips = out.filter((o) => /^flip/.test(o.decision));
  const size = {}; for (const f of flips) size[f.pattern] = (size[f.pattern] || 0) + 1;
  for (const f of flips) {
    const [from, to] = f.pattern.split(' → ');
    if (f.pattern.startsWith('translation edition:')) f.gate_pattern = 'translation edition → its own language';
    else if (from === 'Greek' && VERNACULAR.has(to)) f.gate_pattern = 'Greek → Latin-script vernacular';
    else f.gate_pattern = size[f.pattern] >= 10 || NAMED_AT_GATE_1.has(f.pattern) ? f.pattern : 'rare pairs (< 10 books each)';
  }
}

async function phasePropose() {
  const rows = firstReads();
  const out = [];
  await withDb(async (db) => {
    for (const row of rows) {
      const pre = decide(row, null);
      const tags = /^flip/.test(pre.decision) && row.pages_ocr > 0 ? await tagTally(db, row.book_id) : null;
      const d = tags ? decide(row, tags) : pre;
      out.push({
        book_id: row.book_id, candidate_pattern: row.pattern, title: row.title, visible: row.visible, text_role: row.text_role, language: row.language,
        languages: row.languages, language_multi: row.language_multi, original_language: row.original_language, status: row.status, hold: row.hold, provider: row.provider,
        pages_count: row.pages_count, pages_ocr: row.pages_ocr, ...d, to_name: d.to ? languageName(d.to) : null, pattern: d.to ? writePattern(row, d.to) : null, ocr_tags: tags,
        reads: row.reads.map((r) => ({ read: r.read, page_number: r.page_number, script: r.script, language: r.language, content: r.content, production: r.production, confidence: r.confidence, note: r.note })),
      });
    }
  });
  gatePatterns(out);
  fs.writeFileSync(inDir('proposals.jsonl'), out.map((o) => JSON.stringify(o)).join('\n') + '\n');
  const tally = (f, src = out) => { const t = {}; for (const o of src) { const k = f(o); t[k] = (t[k] || 0) + 1; } return Object.fromEntries(Object.entries(t).sort((a, b) => b[1] - a[1])); };
  const summary = {
    generated_at: new Date().toISOString(), candidates: out.length, by_decision: tally((o) => o.decision),
    first_read_disagrees_by_candidate_pattern: tally((o) => o.pattern, rows.filter((r) => r.disagrees)),
    read_by_candidate_pattern: tally((o) => o.pattern, rows.filter((r) => r.reads.length)),
    flips_by_gate_pattern: tally((o) => o.gate_pattern, out.filter((o) => o.decision === 'flip')),
    two_read_only_by_gate_pattern: tally((o) => o.gate_pattern, out.filter((o) => o.decision === 'flip-2-reads')),
    flips_visible_by_gate_pattern: tally((o) => o.gate_pattern, out.filter((o) => o.decision === 'flip' && o.visible)),
    flips_by_pattern: tally((o) => o.pattern, out.filter((o) => o.decision === 'flip')),
    flips_visible_by_pattern: tally((o) => o.pattern, out.filter((o) => o.decision === 'flip' && o.visible)),
    report_reasons: tally((o) => o.why.replace(/\(.*\)|\d+%|: one page .*/g, '').trim(), out.filter((o) => o.decision === 'report')),
  };
  fs.writeFileSync(inDir('proposals.summary.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify(summary, null, 1));
}

// ── --eye-sample ───────────────────────────────────────────────────────────────────────────────

/** Deterministic PRNG (mulberry32) so the by-eye draw can be re-drawn. */
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/**
 * 40 proposed relabels for the by-eye gate, stratified across write patterns: every pattern gets
 * a share in proportion to the square root of its size. Each sample is the two pages the
 * reader saw, side by side; the file name carries no label.
 */
async function phaseEyeSample() {
  const sharp = (await import('sharp')).default;
  const WORK = process.env.LANGID_WORK_DIR || '/data/scratch/sl/relabel-4884';
  const N = Number(args[args.indexOf('--n') + 1]) || 40;
  const only = args.includes('--gate-patterns') ? new Set(String(args[args.indexOf('--gate-patterns') + 1]).split('|')) : null;
  // A second gate draws fresh books: nothing already looked at in gate 1.
  const seenBefore = new Set(!args.includes('--dir') ? [] : fs.readdirSync(DIR).filter((f) => /^eye-sample-gate\d\.json$/.test(f) && f !== `eye-sample-${args[args.indexOf('--dir') + 1]}.json`).flatMap((f) => JSON.parse(fs.readFileSync(inDir(f), 'utf8')).rows.map((r) => r.book_id)));
  const flips = readJsonl(inDir('proposals.jsonl')).filter((p) => p.decision === 'flip' && (!only || only.has(p.gate_pattern)) && !seenBefore.has(p.book_id));
  const by = new Map(); for (const f of flips) { if (!by.has(f.gate_pattern)) by.set(f.gate_pattern, []); by.get(f.gate_pattern).push(f); }
  const rand = rng(4884);
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const patterns = [...by.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  for (const [, v] of patterns) { v.sort((a, b) => a.book_id.localeCompare(b.book_id)); shuffle(v); }
  // Square-root allocation (largest remainder): the big pattern does not crowd out the small ones.
  const w = patterns.map(([, v]) => Math.sqrt(v.length)), W = w.reduce((x, y) => x + y, 0);
  const quota = patterns.map(([k, v], i) => ({ k, max: v.length, q: N * w[i] / W }));
  const take = new Map(quota.map((x) => [x.k, Math.min(x.max, Math.max(1, Math.floor(x.q)))]));
  for (const x of [...quota].sort((p, q) => (q.q % 1) - (p.q % 1))) { if ([...take.values()].reduce((s2, y) => s2 + y, 0) >= N) break; if (take.get(x.k) < x.max) take.set(x.k, take.get(x.k) + 1); }
  const sample = shuffle(patterns.flatMap(([k, v]) => v.slice(0, take.get(k))));
  const eyeDir = path.join(WORK, args.includes('--dir') ? args[args.indexOf('--dir') + 1] : 'eye'); fs.mkdirSync(eyeDir, { recursive: true });
  const rows = [];
  for (const [i, f] of sample.entries()) {
    const files = f.reads.map((r) => path.join(WORK, 'img', r.read === 1 ? `${f.book_id}.r1.jpg` : `${f.book_id}~${r.read}.r1.jpg`));
    const H = files.length > 2 ? 900 : 1100;
    const imgs = await Promise.all(files.map((x) => sharp(x).resize({ height: H, withoutEnlargement: false }).toBuffer({ resolveWithObject: true })));
    const file = path.join(eyeDir, `${String(i + 1).padStart(2, '0')}.jpg`);
    let left = 0; const comp = imgs.map((im) => { const c = { input: im.data, left, top: 0 }; left += im.info.width + 12; return c; });
    await sharp({ create: { width: left - 12, height: H, channels: 3, background: '#000' } }).composite(comp).jpeg({ quality: 85 }).toFile(file);
    rows.push({ n: i + 1, book_id: f.book_id, gate_pattern: f.gate_pattern, pattern: f.pattern, from: f.language, to: f.to_name, visible: f.visible, pages: f.reads.map((r) => r.page_number), title: f.title });
  }
  fs.writeFileSync(inDir(args.includes('--dir') ? `eye-sample-${args[args.indexOf('--dir') + 1]}.json` : 'eye-sample.json'), JSON.stringify({ seed: 4884, n: rows.length, drawn_from: flips.length, per_pattern: Object.fromEntries([...take].filter(([, n]) => n)), rows }, null, 2) + '\n');
  console.log(`eye sample: ${rows.length} of ${flips.length} flips → ${eyeDir}`); console.log(Object.fromEntries([...take].filter(([, n]) => n)));
}

// ── --write / --undo ───────────────────────────────────────────────────────────────────────────

/** Book statuses and job states in which a worker may be holding the book's language right now. */
const IN_FLIGHT_STATUS = new Set(['ocr_queued', 'enrolled', 'ocr_processing', 'translating', 'translation_queued', 'processing']);
const LIVE_JOB = ['pending', 'processing', 'in_progress', 'running', 'submitted'];

/** Books with a live row in `jobs` (sequential translation / OCR) or `batch_jobs` (Batch lanes). */
async function booksWithLiveJobs(db, ids) {
  const live = new Map();
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    for (const j of await db.collection('jobs').find({ book_id: { $in: chunk }, status: { $in: LIVE_JOB } }, { projection: { book_id: 1, type: 1, status: 1 } }).toArray()) live.set(j.book_id, `jobs ${j.type} ${j.status}`);
  }
  const want = new Set(ids);
  for (const j of await db.collection('batch_jobs').find({ status: { $in: LIVE_JOB } }, { projection: { book_id: 1, book_ids: 1, type: 1, status: 1 } }).toArray()) {
    for (const id of [j.book_id, ...(j.book_ids || [])]) if (id && want.has(id)) live.set(id, `batch_jobs ${j.type} ${j.status}`);
  }
  return live;
}

async function phaseWrite() {
  const { getOcrModelForBook } = await import('../lib/ocr-routing.mjs');
  const { getTranslateModelForBook } = await import('../lib/translate-core.mjs');
  const { recordSweepAction } = await import('../lib/sweep-log.mjs');
  const commit = has('commit');
  const accepted = new Set(JSON.parse(fs.readFileSync(inDir('accepted-patterns.json'), 'utf8')).accepted);
  const flips = readJsonl(inDir('proposals.jsonl')).filter((p) => p.decision === 'flip' && accepted.has(p.gate_pattern));
  const written = [], skipped = [];
  await withDb(async (db) => {
    const books = db.collection('books');
    const done = new Set((await db.collection('sweep_log').find({ sweep: SWEEP, action: 'relabel language' }, { projection: { book_id: 1 } }).toArray()).map((r) => r.book_id));
    const live = await booksWithLiveJobs(db, flips.map((p) => p.book_id));
    for (const p of flips) {
      if (live.has(p.book_id)) { skipped.push({ book_id: p.book_id, why: `live job (${live.get(p.book_id)})` }); continue; }
      if (done.has(p.book_id)) { skipped.push({ book_id: p.book_id, why: 'already written' }); continue; }
      const b = await books.findOne({ id: p.book_id }, { projection: { id: 1, language: 1, languages: 1, language_multi: 1, original_language: 1, text_role: 1, visible: 1, created_at: 1, 'image_source.provider': 1, 'field_provenance.language': 1, 'pipeline_auto.status': 1, 'pipeline_auto.hold': 1, pages_count: 1, pages_ocr: 1, pages_translated: 1 } });
      if (!b) { skipped.push({ book_id: p.book_id, why: 'book not found' }); continue; }
      if (b.language !== p.language) { skipped.push({ book_id: p.book_id, why: `language changed since the read (${JSON.stringify(b.language)})` }); continue; }
      const status = b.pipeline_auto?.status || null;
      if (!b.pipeline_auto?.hold && status && IN_FLIGHT_STATUS.has(status)) { skipped.push({ book_id: p.book_id, why: `pipeline status ${status}: possibly mid-run` }); continue; }
      const after = { language: p.to_name, languages: [p.to_name], language_multi: false };
      const now = new Date();
      const provenance = {
        source: SWEEP, value: p.to_name, chosen_from: 'page-read',
        claims: [{ source: 'catalogue (previous value)', value: String(b.language) }, ...p.reads.map((r) => ({ source: `langid page read p.${r.page_number} (gemini-3.1-flash-lite)`, value: r.language }))],
        date: now,
      };
      // A translation edition catalogued under its source's language: the old label IS the work's
      // language, so it moves to an EMPTY original_language (language-fields.md: never delete the source).
      const setOriginal = TRANSLATION_ROLES.has(b.text_role) && !b.original_language ? languageName(toLanguageCodes(b.language).codes[0]) : null;
      const routing = {
        ocr: [getOcrModelForBook(b), getOcrModelForBook({ ...b, ...after })],
        translate: [getTranslateModelForBook(b), getTranslateModelForBook({ ...b, ...after })],
      };
      const row = {
        book_id: b.id, pattern: p.pattern, visible: !!b.visible, status, hold: b.pipeline_auto?.hold?.reason || null,
        pages_count: b.pages_count, pages_ocr: b.pages_ocr || 0, pages_translated: b.pages_translated || 0,
        before: { language: b.language, languages: b.languages ?? null, language_multi: b.language_multi ?? null, field_provenance_language: b.field_provenance?.language ?? null },
        after, original_language: b.original_language ?? null, original_language_set: setOriginal, text_role: b.text_role ?? null, routing,
      };
      if (commit) {
        // The filter repeats the stored label, so a concurrent relabel is not overwritten.
        const res = await books.updateOne({ id: b.id, language: b.language }, { $set: { ...after, ...(setOriginal ? { original_language: setOriginal } : {}), 'field_provenance.language': provenance, updated_at: now } });
        if (res.modifiedCount !== 1) { skipped.push({ book_id: p.book_id, why: 'not modified (changed underneath)' }); continue; }
        await recordSweepAction(db, { sweep: SWEEP, book_id: b.id, action: 'relabel language', detail: { pattern: p.pattern, gate_pattern: p.gate_pattern, before: row.before, after, ...(setOriginal ? { original_language_set: setOriginal } : {}), routing, instruments: p.instruments, reads: p.reads.map((r) => ({ page_number: r.page_number, language: r.language, confidence: r.confidence })) } });
      }
      written.push(row);
    }
  });
  fs.writeFileSync(inDir(commit ? 'written.jsonl' : 'write-dry-run.jsonl'), written.map((o) => JSON.stringify(o)).join('\n') + '\n');
  const t = {}; for (const w of written) { const k = `${w.pattern} | OCR ${w.routing.ocr.join(' → ')} | translate ${w.routing.translate.join(' → ')} | ${w.visible ? 'visible' : 'hidden'}${w.hold ? ' held' : ''}`; t[k] = (t[k] || 0) + 1; }
  console.log(`${commit ? 'WROTE' : 'DRY RUN'}: ${written.length} books; skipped ${skipped.length}`);
  for (const [k, n] of Object.entries(t).sort((a, b) => b[1] - a[1])) console.log(`${String(n).padStart(5)}  ${k}`);
  const st = {}; for (const x of skipped) st[x.why.replace(/\(.*\)/, '')] = (st[x.why.replace(/\(.*\)/, '')] || 0) + 1; console.log('skipped:', st);
  if (skipped.length) fs.writeFileSync(inDir(commit ? 'write-skipped.jsonl' : 'write-dry-run-skipped.jsonl'), skipped.map((o) => JSON.stringify(o)).join('\n') + '\n');
}

/** Restore every book written by this sweep from its own sweep_log row. Skips a book relabelled again since. */
async function phaseUndo() {
  const { recordSweepAction } = await import('../lib/sweep-log.mjs');
  const commit = has('commit');
  await withDb(async (db) => {
    const rows = await db.collection('sweep_log').find({ sweep: SWEEP, action: 'relabel language' }).toArray();
    const undone = new Set((await db.collection('sweep_log').find({ sweep: SWEEP, action: 'undo relabel' }, { projection: { book_id: 1 } }).toArray()).map((r) => r.book_id));
    let n = 0, skipped = 0;
    for (const r of rows) {
      if (undone.has(r.book_id)) continue;
      const { before, after } = r.detail;
      const set = { language: before.language, updated_at: new Date() }, unset = {};
      for (const k of ['languages', 'language_multi']) { if (before[k] == null) unset[k] = ''; else set[k] = before[k]; }
      if (before.field_provenance_language == null) unset['field_provenance.language'] = ''; else set['field_provenance.language'] = before.field_provenance_language;
      if (r.detail.original_language_set) unset.original_language = '';
      if (!commit) { n++; continue; }
      const res = await db.collection('books').updateOne({ id: r.book_id, language: after.language }, { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) });
      if (res.modifiedCount === 1) { n++; await recordSweepAction(db, { sweep: SWEEP, book_id: r.book_id, action: 'undo relabel', detail: { restored: before } }); } else skipped++;
    }
    console.log(`${commit ? 'UNDONE' : 'DRY RUN, would undo'}: ${n}; skipped (label changed since): ${skipped}`);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (has('candidates')) await phaseCandidates();
  else if (has('pick')) await phasePick();
  else if (has('propose')) await phasePropose();
  else if (has('eye-sample')) await phaseEyeSample();
  else if (has('write')) await phaseWrite();
  else if (has('undo')) await phaseUndo();
  else console.log('usage: --candidates | --pick | --propose | --write [--commit] | --undo [--commit]');
}
