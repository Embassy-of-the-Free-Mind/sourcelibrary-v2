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
  const firstPage = new Map();
  if (second) {
    const fr = firstReads().filter((r) => r.disagrees || (r.compound && r.reads.length));
    for (const r of fr) firstPage.set(r.book_id, r.reads.find((x) => x.read === 1)?.page_number);
    cands = cands.filter((c) => firstPage.has(c.book_id));
  }
  const fraction = second ? 0.72 : 0.4;
  const picksPath = inDir('picks.jsonl');
  const have = new Set(readJsonl(picksPath).map((p) => p.book_id));
  for (const d of readJsonl(inDir('deferred.jsonl'))) have.add(d.read === 2 ? `${d.book_id}~2` : d.book_id);
  const deferred = [];
  let written = 0;
  await withDb(async (db) => {
    const pages = db.collection('pages');
    for (const c of cands) {
      const key = second ? `${c.book_id}~2` : c.book_id;
      if (have.has(key)) continue;
      let order = around(c.pages_count, fraction, second ? 10 : 6);
      // The confirming read takes a page of the OTHER parity, so a facing-page edition shows both sides.
      if (second) { const p1 = firstPage.get(c.book_id); order = order.filter((n) => p1 == null || (n % 2 !== p1 % 2 && Math.abs(n - p1) > 1)); }
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
    reads.get(id).set(`${n || 1}:${r.page_number}`, { read: Number(n || 1), page_number: r.page_number, ...r.verdict, codes: observedCodes(r.verdict) });
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

const MIN_CONFIDENCE = 0.8;
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
  if (!row.disagrees) return { decision: 'label-confirmed' };
  if (!r1 || !r2) return { decision: 'report', why: 'fewer than two confident text reads' };
  const labelFams = new Set(row.label.map(codeFamily));
  const f1 = codeFamily(r1.codes[0]), f2 = codeFamily(r2.codes[0]);
  if (r1.codes.length > 1 || r2.codes.length > 1) return { decision: 'report', why: 'a read names two languages on one page' };
  if (labelFams.has(f2)) return { decision: 'report', why: `mixed: one page ${languageName(r1.codes[0])}, one page in the label's language` };
  if (f1 !== f2) return { decision: 'report', why: `two reads disagree (${languageName(r1.codes[0])} / ${languageName(r2.codes[0])})` };
  if (NEVER_FLIP.has(`${codeFamily(row.label[0])}>${f1}`)) return { decision: 'report', why: 'tradition class (language-fields.md): never flipped' };
  if (TRANSLATION_ROLES.has(row.text_role)) return { decision: 'report', why: `text_role ${row.text_role}` };
  if (row.compound) return { decision: 'report', why: 'compound label: curatorial' };
  if (tags && tags.tagged >= 10) {
    const top = Object.keys(tags.shares)[0];
    const labelShare = Math.max(0, ...[...labelFams].map((f) => tags.shares[f] || 0));
    if (top !== f1 || tags.shares[top] < 0.6) return { decision: 'report', why: `OCR tags do not put ${languageName(r1.codes[0])} first at ≥ 60%` };
    if (labelShare >= 0.1) return { decision: 'report', why: `label language on ${Math.round(labelShare * 100)}% of OCR-tagged pages: bilingual, curatorial` };
  }
  // Same code on both reads keeps it; two stages of one family fall back to the family's own code.
  const to = r1.codes[0] === r2.codes[0] ? r1.codes[0] : f1;
  return { decision: 'flip', to, instruments: tags && tags.tagged >= 10 ? 'two page reads + OCR tags' : 'two page reads' };
}

/** Pattern = what the write would change, by name: "Greek → Latin". Rare targets fold into the script. */
function writePattern(row, to) {
  const from = languageName(row.label[0]);
  return `${from} → ${languageName(to)}`;
}

async function phasePropose() {
  const rows = firstReads();
  const out = [];
  await withDb(async (db) => {
    for (const row of rows) {
      const pre = decide(row, null);
      const tags = pre.decision === 'flip' && row.pages_ocr > 0 ? await tagTally(db, row.book_id) : null;
      const d = tags ? decide(row, tags) : pre;
      out.push({
        book_id: row.book_id, candidate_pattern: row.pattern, title: row.title, visible: row.visible, text_role: row.text_role, language: row.language,
        languages: row.languages, language_multi: row.language_multi, original_language: row.original_language, status: row.status, hold: row.hold, provider: row.provider,
        pages_count: row.pages_count, pages_ocr: row.pages_ocr, ...d, to_name: d.to ? languageName(d.to) : null, pattern: d.to ? writePattern(row, d.to) : null, ocr_tags: tags,
        reads: row.reads.map((r) => ({ read: r.read, page_number: r.page_number, script: r.script, language: r.language, content: r.content, production: r.production, confidence: r.confidence, note: r.note })),
      });
    }
  });
  fs.writeFileSync(inDir('proposals.jsonl'), out.map((o) => JSON.stringify(o)).join('\n') + '\n');
  const tally = (f, src = out) => { const t = {}; for (const o of src) { const k = f(o); t[k] = (t[k] || 0) + 1; } return Object.fromEntries(Object.entries(t).sort((a, b) => b[1] - a[1])); };
  const summary = {
    generated_at: new Date().toISOString(), candidates: out.length, by_decision: tally((o) => o.decision),
    first_read_disagrees_by_candidate_pattern: tally((o) => o.candidate_pattern, rows.filter((r) => r.disagrees)),
    read_by_candidate_pattern: tally((o) => o.candidate_pattern, rows.filter((r) => r.reads.length)),
    flips_by_pattern: tally((o) => o.pattern, out.filter((o) => o.decision === 'flip')),
    flips_visible_by_pattern: tally((o) => o.pattern, out.filter((o) => o.decision === 'flip' && o.visible)),
    report_reasons: tally((o) => o.why.replace(/\(.*\)|\d+%|: one page .*/g, '').trim(), out.filter((o) => o.decision === 'report')),
  };
  fs.writeFileSync(inDir('proposals.summary.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify(summary, null, 1));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (has('candidates')) await phaseCandidates();
  else if (has('pick')) await phasePick();
  else if (has('propose')) await phasePropose();
  else console.log('usage: --candidates | --pick | --propose | --write [--commit] | --undo [--commit]');
}
