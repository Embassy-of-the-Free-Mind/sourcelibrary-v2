#!/usr/bin/env node
// PRIOR ART: scripts/eval/continuation-probe-7271/draw.mjs (the indexed way into RECITATION pages, reused for the Latin
// "R" famous pages); scripts/eval/benchmark/{greek,greek-ext,greek-ext2,chinese,chinese-ext}.json + refs/ (sealed pages
// whose e-text reference was aligned: the Greek and Chinese famous pools, unchanged); a5-nonlatin-5700.json (by-eye
// Hebrew/Sanskrit references). None of them draws a matched famous/obscure pair, so the pairing lives here.
/**
 * draw.mjs — the candidate pools for the read-or-recall pilot (#7570). Read-only on Mongo. No model is called.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/read-or-recall-7570/draw.mjs [--write]
 *
 * Five scripts. For each, an ordered FAMOUS pool and an ordered OBSCURE pool, one page per book, seeded (7570).
 * The pools are longer than the 20 pairs: a candidate leaves at the screen (screen.mjs, the blind key read: wrong
 * script, plate, index, blank, manuscript where print is wanted) or at the online check, and the next one takes its
 * place, in pool order. The rules are in PREREG (the experiment file) and here; nothing below is picked by hand.
 *
 *   famous  = a page whose text is online. Latin: 10 pages Gemini refused with RECITATION (the #6740 census
 *             population, 7271's indexed entry) + 10 pages of canonical classical/biblical works. Greek and Chinese:
 *             the sealed benchmark pages whose reference is an aligned e-text window (Perseus / First1KGreek /
 *             el.wikisource; Kanripo / CBETA), printed (the SKQS manuscripts are left out). Hebrew and Sanskrit: books
 *             whose title names a canonical work (Torah, Talmud, Mishnah, Zohar, Siddur…; Gita, Ramayana, Veda…).
 *   obscure = a page of the same script, kind (print) and, where a year is known, half-century, from a book whose
 *             title names no canonical work, that is not in the census as refused, and has no aligned e-text. The
 *             "no online copy found" evidence is gathered AFTER the draw (online-check), on the key text.
 *   page    = interior (15–90% of the book), with a usable image; for pools drawn from Mongo, a stored model read of
 *             ≥ MIN letters in the target script (so the page is running text in that script; the read is NOT used as
 *             the key).
 * --write seals scripts/eval/results/read-or-recall-7570/pools.json.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { MongoClient } from 'mongodb';
import { getPageSource } from '../../lib/page-image-url.mjs';
import { SCRIPTS, scriptLetters } from './text.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BENCH = path.join(__dirname, '../benchmark');
const RES = path.join(__dirname, '../results/read-or-recall-7570');
const WRITE = process.argv.includes('--write');
const SEED = 7570;
const POOL = { famous: 34, obscure: 60 }; // per script; Latin famous is 17 R + 17 C
const hkey = (s) => crypto.createHash('sha256').update(`${SEED}:${s}`).digest('hex');
const seeded = (xs, key = (x) => x.id) => [...xs].sort((a, b) => hkey(key(a)).localeCompare(hkey(key(b))));
const half = (y) => (typeof y === 'number' && y > 0 ? Math.floor(y / 50) * 50 : null);
const strText = (f) => ({ $cond: [{ $eq: [{ $type: f }, 'string'] }, f, ''] });

// Canonical works, by title/author. A book matching this is never an obscure candidate, in any script.
const CANON = {
  latin: /\bBiblia|Vulgat|Vergil|Virgil|Aeneid|Aeneis|Bucolic|Georgic|Ovidi|Metamorphos|\bCicero|Ciceron|Caesar|Horati|Lucret|T\. ?Livi|Livius|Sallust|Tacit|Confessionum|Confessiones|Boeth|Imitatione Christi|Senecae|Terenti|Plaut|Juvenal|Iuvenal|Catull|Psalteri|Psalmi|Novum Testamentum|Evangeli|Suetoni|Lucan|Statius|Persius|Quintilian|Plinii|Valerius Maximus|Cornelius Nepos|Justinus|Florus/i,
  greek: /Homer|Iliad|Ilias|Odyss|Novum Testamentum|Testament|Καιν|Plat[oō]n|Aristot|Herodot|Thucyd|Xenophon|Sophocl|Aeschyl|Euripid|Hesiod|Septuag|Evangel|Pindar|Aristophan|Demosthen|Lucian|Plutarch|Isocrat|Epictet|Hippocrat|Galen|Euclid|Theocrit|Anacreon|Diogen|Polyb|Strabo|Pausanias|Josephus|Basil|Chrysostom|Gregor|Psalter|Apollon|Callimach|Lysias|Aesop|Aisop|Theophrast|Ptolem|Porphyr|Plotin|Proclus|Iambl|Philo\b|Origen|Clement|Athanas|Eusebi|Dionys|Marcus Aurel|Antonin/i,
  chinese: /論語|孟子|大學|中庸|道德經|老子|莊子|史記|詩經|毛詩|尚書|周易|易經|左傳|春秋|孫子|金剛|法華|心經|楞嚴|華嚴|阿彌陀|紅樓|三國|水滸|西遊|千字文|三字經|漢書|資治通鑑|禮記|周禮|儀禮|孝經|爾雅|說文|楚辭|文選|唐詩|四書|五經|十三經|藏經|大藏|Analects|Mencius|Daodejing|Tao Te|sutra/i,
  hebrew: /תורה|חומש|תנ"ך|תנך|משנה|תלמוד|גמרא|זוהר|סדור|מחזור|תהלים|הגדה|Pentateuch|Torah|Bible|Biblia|Mishna|Talmud|Zohar|Psalm|Siddur|Ma[hḥ]zor|Machzor|Haggad|Tanach|Kuzari|Moreh|Mishneh|Prophet|Hagiograph|Megill|Targum|Rashi|Shulchan|Shul[hḥ]an|Arba|Tur\b|Midrash|Tehill|Humash|Ḥumash|umshe|Talmud|Gemara|Berakhot|Shabbat|Bava/i,
  sanskrit: /Bhagavad|G[iī]t[aā]\b|गीता|Rig|R̥g|Ṛg|ऋग्|Veda|वेद|R[aā]m[aā]ya|रामायण|Mah[aā]bh[aā]rat|महाभारत|Manu|मनु|Upani|उपनिष|Meghad|मेघदूत|[SŚ]akuntal|शाकुन्तल|Pa[nñ]catantr|पञ्चतन्त्र|Hitopade|हितोपदेश|Amarako|अमरको|Raghuvam|रघुवंश|Kum[aā]rasam|कुमारसम्भव|Yoga ?S[uū]tr|योगसूत्र|Bh[aā]gavat|भागवत|Pur[aā][nṇ]a|पुराण|Brahmas[uū]tr|ब्रह्मसूत्र|P[aā][nṇ]ini|Ashtadhyayi|अष्टाध्यायी|Ka[uū]?[tṭ]il|Arthash|Kirat|किरात|Shishupal|शिशुपाल|Naishadh|नैषध|Kadamb|कादम्बरी|Dasakum|Gita Govind|गीतगोविन्द|Sa[uū]ndarya|Vishnu ?Sahasra|विष्णुसहस्र|Durga|दुर्गा|Saptashat|सप्तशती|Devi Mahat/i,
};
// Stricter: the canonical works the Latin "C" famous pool is drawn from (text, not commentary-on, in the title).
const LATIN_C = /^(?:(?!comment|annotat|scholi|index|lexic|concordan|disputat|quaestion|dissert|oratio de|vita\b).)*\b(Biblia|Vulgat|Vergil|Virgil|Aeneid|Ovidi|Metamorphos|Cicero|Ciceron|Caesaris|Commentarii de bello|Horati|Lucret|Livius|Sallust|Tacit|Confessionum|Boeth|Imitatione Christi|Senecae|Terenti|Plaut|Juvenal|Iuvenal|Catull|Psalteri|Novum Testamentum|Suetoni|Lucan|Quintilian|Plinii|Nepos)/i;
// Chinese titles from the Siku quanshu sets ("(vol N)", imperial compilations): every one is in Kanripo, so never obscure.
const SKQS = /\(vol \d+\)|御定|御製|欽定|御纂|御選|御批|四庫/;
const MANUSCRIPT = /\b(Vat\.|Borg\.|Neofiti|Ms\.|MS\b|manuscript|Codex|Cod\.|Hs\.|handschrift|scroll|Polonsky)/i;
const LANGS = { latin: ['Latin'], greek: ['Greek', 'Ancient Greek'], chinese: ['Chinese', 'Classical Chinese'], hebrew: ['Hebrew'], sanskrit: ['Sanskrit', 'Sanskrita'] };
const YEARS = { latin: [1470, 1800], greek: [1470, 1900], chinese: null, hebrew: [1475, 1930], sanskrit: [1800, 1960] };

const census = new Map(fs.readFileSync(path.join(__dirname, '../dataset/refusal-census-v1/books.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => { const b = JSON.parse(l); return [b.book_id, b]; }));

// ---- benchmark pages with an aligned e-text reference (Greek, Chinese) ------------------------------------------------
function benchPool(files, okSources, dropSub = []) {
  const rows = [];
  for (const f of files) {
    const d = JSON.parse(fs.readFileSync(path.join(BENCH, f), 'utf8'));
    for (const p of d.pages || []) {
      if (dropSub.includes(p.substratum)) continue;
      const rj = path.join(BENCH, 'refs', `${p.slug}.json`), rt = path.join(BENCH, 'refs', `${p.slug}.txt`);
      if (!fs.existsSync(rj) || !fs.existsSync(rt)) continue;
      const r = JSON.parse(fs.readFileSync(rj, 'utf8'));
      if (r.reason || !okSources.test(String(r.source || ''))) continue;
      if (typeof r.overlap === 'number' && r.overlap < 0.5) continue;
      rows.push({ book_id: p.book_id, page_number: p.page_number, image_url: p.image_url, title: p.title, year: p.year ?? null,
        bench_slug: p.slug, bench_file: f, substratum: p.substratum, ref: { kind: 'etext-window', path: `scripts/eval/benchmark/refs/${p.slug}.txt`,
          source: r.source, work: r.work || null, work_title: r.work_title || null, url: r.url || null, overlap: r.overlap ?? null, licence: r.licence || null } });
    }
  }
  const seen = new Set();
  return seeded(rows, (x) => x.book_id).filter((x) => !seen.has(x.book_id) && seen.add(x.book_id));
}

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');
const P = db.collection('pages'), B = db.collection('books');
const BOOKF = { _id: 0, id: 1, title: 1, author: 1, year: 1, language: 1, pages_count: 1, ia_identifier: 1, work_id: 1, visible: 1 };

/** One interior page of book b with a stored model read holding ≥ min letters of the script; null when none. */
async function pickPage(b, script, { min, extraMatch = {} } = {}) {
  const n = b.pages_count || 0; if (n < 8) return null;
  const lo = Math.ceil(n * 0.15), hi = Math.floor(n * 0.9);
  const cands = await P.aggregate([
    { $match: { book_id: b.id, page_number: { $gte: lo, $lte: hi }, ...extraMatch } },
    { $project: { _id: 0, id: 1, page_number: 1, photo: 1, photo_original: 1, archived_photo: 1, cropped_photo: 1, enhanced_photo: 1, split_from_spread: 1,
      'ocr.model': 1, 'ocr.updated_at': 1, 'ocr.recitation_count': 1, len: { $strLenCP: strText('$ocr.data') }, data: { $substrCP: [strText('$ocr.data'), 0, 6000] } } },
    { $match: { len: { $gte: min } } }]).toArray();
  const ok = cands.filter((p) => getPageSource(p) && !/^ia-|archive/i.test(String(p.ocr?.model || '')) && scriptLetters(p.data, script) >= min
    && !/<page-type>\s*(index|title|table|blank|plate|illustration)/i.test(p.data));
  if (!ok.length) return null;
  const p = seeded(ok, (x) => `${b.id}:${x.page_number}`)[0];
  return { page_id: p.id, page_number: p.page_number, image_url: getPageSource(p), stored_model: p.ocr?.model || null,
    stored_read_at: p.ocr?.updated_at || null, stored_letters: scriptLetters(p.data, script), recitation_count: p.ocr?.recitation_count ?? 0 };
}

async function booksOf(script) {
  const yr = YEARS[script];
  const q = { language: { $in: LANGS[script] }, pages_count: { $gte: 20 } };
  if (yr) q.year = { $gte: yr[0], $lte: yr[1] }; // imprint-write-ok: a read-only query filter, not a books write
  return B.find(q, { projection: BOOKF }).toArray();
}

async function fill(books, script, n, opts) {
  const out = [];
  for (const b of books) {
    if (out.length >= n) break;
    const p = await pickPage(b, script, opts);
    if (p) out.push({ book_id: b.id, title: String(b.title || '').slice(0, 200), author: b.author || null, year: b.year ?? null, language: b.language, ...p });
  }
  return out;
}

const MIN = { latin: 900, greek: 500, chinese: 200, hebrew: 400, sanskrit: 400 };
const pools = {};
const refusedBookIds = new Set([...census.values()].filter((b) => b.refused > 0).map((b) => b.book_id));
const benchBooks = new Set();
for (const f of fs.readdirSync(BENCH).filter((f) => f.endsWith('.json'))) {
  try { for (const p of JSON.parse(fs.readFileSync(path.join(BENCH, f), 'utf8')).pages || []) if (p?.book_id) benchBooks.add(p.book_id); } catch { /* not a stratum file */ }
}
const isObscureBook = (b, script) => !CANON[script].test(`${b.title || ''} ${b.author || ''}`) && !CANON.latin.test(String(b.title || '')) && !CANON.greek.test(String(b.title || ''))
  && !refusedBookIds.has(b.id) && !benchBooks.has(b.id) && !MANUSCRIPT.test(String(b.title || '')) && !(script === 'chinese' && SKQS.test(String(b.title || ''))) && !(census.get(b.id)?.gutenberg_ebooks || []).length && census.get(b.id)?.archive_text_online !== true;

for (const script of Object.keys(SCRIPTS)) {
  const books = seeded(await booksOf(script));
  console.log(`${script}: ${books.length} books in frame`);
  let famous;
  if (script === 'latin') {
    // R: RECITATION-refused pages (7271's indexed entry: books with a recitation_blocked page)
    const refBooks = new Set(await P.distinct('book_id', { 'ocr.recitation_blocked': true }));
    const rBooks = books.filter((b) => refBooks.has(b.id));
    const R = (await fill(rBooks, script, POOL.famous / 2, { min: MIN.latin, extraMatch: { 'ocr.recitation_count': { $gte: 1 } } }))
      .map((x) => ({ ...x, famous_kind: 'recitation-hit', famous_evidence: `#6740 census: page refused ${x.recitation_count}× with finishReason RECITATION; book refused ${census.get(x.book_id)?.refused ?? '?'} of ${census.get(x.book_id)?.lite_attempted ?? '?'} lite-attempted pages` }));
    const C = (await fill(books.filter((b) => LATIN_C.test(String(b.title || '')) && !refBooks.has(b.id) && !MANUSCRIPT.test(String(b.title || ''))), script, POOL.famous / 2, { min: MIN.latin }))
      .map((x) => ({ ...x, famous_kind: 'canonical-work', famous_evidence: `canonical work by title (${(LATIN_C.exec(x.title) || [])[1]}): full text on The Latin Library / Perseus / Wikisource; online check confirms the page's passage` }));
    famous = []; for (let i = 0; i < Math.max(R.length, C.length); i++) { if (R[i]) famous.push(R[i]); if (C[i]) famous.push(C[i]); }
  } else if (script === 'greek') {
    famous = benchPool(['greek.json', 'greek-ext.json', 'greek-ext2.json'], /Perseus|First1K|wikisource/i).slice(0, POOL.famous)
      .map((x) => ({ ...x, famous_kind: 'etext-aligned', famous_evidence: `${x.ref.source}: ${x.ref.work_title || x.ref.work} (${x.ref.url}); window overlap ${x.ref.overlap}` }));
  } else if (script === 'chinese') {
    famous = benchPool(['chinese.json', 'chinese-ext.json'], /Kanripo|CBETA/i, ['skqs-manuscript']).slice(0, POOL.famous)
      .map((x) => ({ ...x, famous_kind: 'etext-aligned', famous_evidence: `${x.ref.source}: ${x.ref.work_title || x.ref.work} (${x.ref.url}); window overlap ${x.ref.overlap}` }));
  } else {
    famous = (await fill(books.filter((b) => CANON[script].test(`${b.title || ''} ${b.author || ''}`) && !MANUSCRIPT.test(String(b.title || ''))), script, POOL.famous, { min: MIN[script] }))
      .map((x) => ({ ...x, famous_kind: 'canonical-work', famous_evidence: `canonical work by title (${(CANON[script].exec(`${x.title} ${x.author || ''}`) || [])[0]}): online on ${script === 'hebrew' ? 'Sefaria' : 'GRETIL / SanskritDocuments'}; online check confirms the page's passage` }));
  }
  // page ids for the benchmark rows
  for (const f of famous) if (!f.page_id) {
    const p = await P.findOne({ book_id: f.book_id, page_number: f.page_number }, { projection: { _id: 0, id: 1, 'ocr.model': 1, 'ocr.updated_at': 1 } });
    f.page_id = p?.id || null; f.stored_model = p?.ocr?.model || null; f.stored_read_at = p?.ocr?.updated_at || null;
    const b = await B.findOne({ id: f.book_id }, { projection: BOOKF }); f.author = b?.author || null; f.language = b?.language || null; if (f.year == null) f.year = b?.year ?? null; // imprint-write-ok: a field of an eval draw row, not a books write
  }
  const obscure = (await fill(books.filter((b) => isObscureBook(b, script)), script, POOL.obscure, { min: MIN[script] }))
    .map((x) => ({ ...x, half: half(x.year) }));
  pools[script] = { famous: famous.map((x) => ({ ...x, half: half(x.year) })), obscure };
  console.log(`  famous ${famous.length}, obscure ${obscure.length}`);
}
await client.close();

const out = { issue: 7570, seed: SEED, drawn_at: new Date().toISOString(), rule: 'see header of draw.mjs', pools };
if (WRITE) { fs.mkdirSync(RES, { recursive: true }); fs.writeFileSync(path.join(RES, 'pools.json'), JSON.stringify(out, null, 1)); console.log('wrote pools.json'); }
else for (const [s, p] of Object.entries(pools)) { console.log(`== ${s}`); for (const x of p.famous.slice(0, 6)) console.log('  F', x.year, x.title.slice(0, 70)); for (const x of p.obscure.slice(0, 6)) console.log('  O', x.year, x.title.slice(0, 70)); }
