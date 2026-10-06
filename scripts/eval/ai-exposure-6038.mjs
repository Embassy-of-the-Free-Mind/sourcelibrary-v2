#!/usr/bin/env node
/**
 * PRIOR ART: public/contamination-probe-paper.pdf §3 (the May 2026 method; its code was never
 * committed, so this rebuilds it from the text). scripts/eval/fingerprint-5549.mjs — the
 * FILE-level detector (continuations scored against our misreads); it is unpowered for current
 * models (all our served text postdates their cutoffs), and it asks a different question, so this
 * reuses its packet rule (no two items of one work/author in a packet) and its stage layout but
 * not its scoring. scripts/eval/cloze-probe.mjs — image cloze, out of scope (#6038). Also checked
 * scripts/eval/lib/agreement-stats.mjs (`wilson`, `weightedKappa` reused) and
 * scripts/eval/lib/paired-stats.mjs (`makeRng` reused); no existing helper does fuzzy
 * quote-in-text containment across scripts, so `normQuote` below is new.
 *
 * ai-exposure-6038 — WORK-level training exposure ("is this work new to AI?") on today's corpus.
 *
 * Measures whether a model RECOGNISES A WORK (has met it through any channel), never whether it
 * has seen OUR file. measure: agreement between a bibliographic prior and behavioural probes;
 * there is no ground truth except the controls (canonical positives, invented decoys).
 *
 * Stages (Mongo is read-only, maxTimeMS on every query; private texts never enter the repo):
 *   --stage=ids        dump every book's catalogue fields to PRIVATE/ids.jsonl (the checkpoint)
 *   --stage=draw       seeded walk over WORKS (work-uniform), keep a work when an edition has OCR
 *                      text; main quota 2000 + per-stratum quotas. Resumable from walk.jsonl.
 *   --stage=controls   canonical positives (held, with text) + invented decoys -> controls.jsonl
 *   --stage=packets --set=controls|main|sub500
 *   --stage=gemini  --set=... --model=...   (gemini-script-client, endpoint eval/ai-exposure-refresh)
 *   --stage=ingest  --set=... --model=claude-haiku   (subagent outputs in packets-<set>-out/)
 *   --stage=verify     opening quotes vs our OCR, with a cross-book null to set the threshold
 *   --stage=report     prior, fusion, bootstrap CIs, strata, controls, kappa -> report.json/.md
 *
 * node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/ai-exposure-6038.mjs --stage=ids
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { makeRng } from './lib/paired-stats.mjs';
import { wilson } from './lib/agreement-stats.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'results', 'ai-exposure-6038');
const PRIVATE = process.env.AIEXP_PRIVATE || '/root/claude-jobs/ai-exposure-6038-private';
const SEED = 6038;
const MAIN_N = 2000;
const STRATUM_N = 150;
const SUB_N = 500;
const PACKET_REAL = 25; // + 2 decoys + 1 positive = 28, the May batch size
const ENDPOINT = 'eval/ai-exposure-refresh';
const CAP_USD = 8;

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true];
}));
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(path.join(PRIVATE, 'texts'), { recursive: true });

const readJsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const writeJsonl = (f, rows) => fs.writeFileSync(f, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));

// ---------- catalogue normalisation ----------
const LANG = { la: 'Latin', lat: 'Latin', de: 'German', ger: 'German', deu: 'German', fr: 'French', fre: 'French', fra: 'French', en: 'English', eng: 'English', it: 'Italian', ita: 'Italian', zh: 'Chinese', lzh: 'Classical Chinese', bo: 'Tibetan', sa: 'Sanskrit', pi: 'Pali', ar: 'Arabic', fa: 'Persian', he: 'Hebrew', heb: 'Hebrew', el: 'Greek', grc: 'Greek', nl: 'Dutch', es: 'Spanish', ja: 'Japanese', ko: 'Korean', ru: 'Russian' };
const SENTINEL = /^(unknown|und|x-unknown|not applicable|no linguistic content|visual|n\/a|\?|)$/i;
function langOf(b) {
  const raw = String(b.language || '').trim();
  const l = LANG[raw.toLowerCase()] || raw;
  return SENTINEL.test(l) ? null : l;
}
const STRATA = {
  nalanda: (b) => /^(tibetan|sanskrit|pali)$/i.test(langOf(b) || ''),
  hermetica: (b) => b.provider === 'bph' || (b.collections || []).some((c) => /herme|kabbal|cabal|alchem|rosicruc|theosoph|magia|magic|occult|astrolog/i.test(c)),
  chinese: (b) => /chinese/i.test(langOf(b) || ''),
  arabic_persian: (b) => /^(arabic|persian|ottoman turkish)$/i.test(langOf(b) || ''),
  hebrew: (b) => /^(hebrew|judeo-|aramaic)/i.test(langOf(b) || ''),
};
const fold = (s) => String(s || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const SENTINEL_AUTHOR = /^(unknown|anonymous|anon|anonym|unbekannt|n a|none|various|)$/;
function authorKey(b) { const a = fold(b.author).split(' ').filter((w) => w.length > 2).sort().slice(0, 3).join(' '); return SENTINEL_AUTHOR.test(a) ? null : a; }
function workKey(b) {
  if (b.work_id) return `w:${b.work_id}`;
  const a = authorKey(b); const t = fold(b.title).slice(0, 60);
  return a && t && !/^(unknown|untitled)/.test(t) ? `t:${a}|${t}` : `b:${b.id}`;
}

// ---------- stage: ids ----------
async function stageIds() {
  const { MongoClient } = await import('mongodb');
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const cur = c.db('bookstore').collection('books').find({}, {
    projection: { id: 1, _id: 1, work_id: 1, title: 1, author: 1, year: 1, language: 1, original_language: 1, visible: 1, hidden_reason: 1, pages_count: 1, collections: 1, 'image_source.provider': 1, ia_identifier: 1, created_at: 1, tenant: 1, is_first_translation: 1, 'translation_verification.disposition': 1, 'translation_verification.translations': 1, 'translation_verification.has_english_translation': 1 },
    maxTimeMS: 600000, batchSize: 2000,
  });
  const f = path.join(PRIVATE, 'ids.jsonl'); const w = fs.createWriteStream(f); let n = 0;
  for await (const b of cur) {
    const tv = b.translation_verification;
    const tr = Array.isArray(tv?.translations) ? tv.translations : [];
    w.write(JSON.stringify({
      id: b.id || String(b._id), work_id: b.work_id || null, title: String(b.title || '').slice(0, 300), author: String(b.author || '').trim().slice(0, 120),
      year: b.year ?? null, language: b.language ?? null, original_language: b.original_language ?? null,
      visible: b.visible === true && (b.pages_count || 0) > 0, hidden_reason: b.hidden_reason ?? null, pages_count: b.pages_count || 0,
      collections: b.collections || [], provider: b.image_source?.provider || null, ia: !!b.ia_identifier,
      created_at: b.created_at || null, tenant: b.tenant || null, is_first_translation: b.is_first_translation ?? null,
      disposition: tv?.disposition || null, has_en: tv?.has_english_translation ?? null,
      n_tr: tr.length, tr_publishers: tr.map((t) => `${t.publisher || ''} ${t.series || ''}`).join(' | ').slice(0, 400),
      tr_oldest: tr.map((t) => Number(String(t.pub_year || '').match(/\d{4}/)?.[0])).filter(Boolean).sort()[0] || null,
    }) + '\n');
    n++;
  }
  await new Promise((r) => w.end(r));
  await c.close();
  const sha = crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
  fs.writeFileSync(path.join(OUT, 'ids-manifest.json'), JSON.stringify({ written_at: new Date().toISOString(), books: n, sha256: sha, file: 'PRIVATE/ids.jsonl (not committed: holds hidden books)' }, null, 1) + '\n');
  console.log('ids', n, sha.slice(0, 12));
}

// ---------- page text (what a reader sees) ----------
function cleanServed(raw) {
  return String(raw || '')
    .replace(/<(scan-quality|language|script|page-type|page-num|header|meta|warning|vocab|image-desc|figure|detected-images|columns)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/\*\*/g, '').replace(/[ \t]+/g, ' ').trim();
}

// ---------- stage: draw (work-uniform, checkpointed) ----------
async function stageDraw() {
  const books = readJsonl(path.join(PRIVATE, 'ids.jsonl')).filter((b) => b.pages_count > 0);
  const works = new Map();
  for (const b of books) { const k = workKey(b); if (!works.has(k)) works.set(k, []); works.get(k).push(b); }
  const rng = makeRng(SEED);
  const order = [...works.keys()].sort().map((k) => ({ k, r: rng() })).sort((a, b) => a.r - b.r).map((o) => o.k);
  const walkF = path.join(OUT, 'walk.jsonl');
  const walked = new Map(readJsonl(walkF).map((w) => [w.k, w]));
  const { MongoClient } = await import('mongodb');
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const pages = c.db('bookstore').collection('pages');
  const quotas = { main: MAIN_N, ...Object.fromEntries(Object.keys(STRATA).map((s) => [s, STRATUM_N])) };
  const got = Object.fromEntries(Object.keys(quotas).map((s) => [s, 0]));
  const fill = (w) => { if (!w.book_id) return; const b = w.rep; if (got.main < quotas.main) { got.main++; w.in_main = true; } for (const s of Object.keys(STRATA)) if (STRATA[s](b) && got[s] < quotas[s]) { got[s]++; (w.in_strata ||= []).push(s); } };
  const ws = fs.createWriteStream(walkF, { flags: 'a' });
  let i = 0;
  for (const k of order) {
    const done = Object.entries(quotas).every(([s, q]) => got[s] >= q);
    if (done) break;
    i++;
    let w = walked.get(k);
    if (w) { w.rep = w.book_id ? books.find((b) => b.id === w.book_id) : null; w.in_main = false; w.in_strata = []; fill(w); continue; }
    const eds = works.get(k);
    // Does any edition matter to an unfilled quota? Skip the text check otherwise (strata tail).
    const needMain = got.main < quotas.main;
    const needS = Object.keys(STRATA).filter((s) => got[s] < quotas[s] && eds.some((b) => STRATA[s](b)));
    if (!needMain && !needS.length) continue;
    // Edition order: visible first, then a seeded order — the edition a reader would meet.
    const edOrder = eds.map((b) => ({ b, r: rng() })).sort((x, y) => (y.b.visible - x.b.visible) || (x.r - y.r)).map((o) => o.b);
    w = { k, n_editions: eds.length, n_visible: eds.filter((b) => b.visible).length, book_id: null, checked: 0 };
    for (const b of edOrder.slice(0, 6)) {
      w.checked++;
      const ps = await pages.find({ book_id: b.id, 'ocr.data': { $exists: true, $ne: '' } }, { projection: { page_number: 1, 'ocr.data': 1 } }).sort({ page_number: 1 }).limit(15).maxTimeMS(20000).toArray();
      const text = ps.map((p) => cleanServed(p.ocr?.data)).join('\n\n');
      if (normQuote(text).length >= 300) {
        w.book_id = b.id; w.text_pages = ps.length; w.text_chars = text.length;
        fs.writeFileSync(path.join(PRIVATE, 'texts', `${b.id}.txt`), text.slice(0, 60000));
        break;
      }
    }
    ws.write(JSON.stringify({ k: w.k, n_editions: w.n_editions, n_visible: w.n_visible, book_id: w.book_id, checked: w.checked, text_pages: w.text_pages, text_chars: w.text_chars }) + '\n');
    w.rep = w.book_id ? books.find((b) => b.id === w.book_id) : null; w.in_strata = []; fill(w); walked.set(k, w);
    if (i % 200 === 0) console.log('walked', i, JSON.stringify(got));
  }
  await new Promise((r) => ws.end(r));
  await c.close();
  // Sample file: every kept work, its representative edition and its memberships.
  const byId = new Map(books.map((b) => [b.id, b]));
  const sample = [];
  const walkedOrder = order.filter((k) => walked.has(k));
  for (const k of walkedOrder) {
    const w = walked.get(k); if (!w.book_id || !(w.in_main || w.in_strata?.length)) continue;
    const b = byId.get(w.book_id);
    sample.push({ ...pick(b), work_key: k, n_editions: w.n_editions, n_visible_editions: w.n_visible, in_main: !!w.in_main, strata: w.in_strata || [], lang: langOf(b) });
  }
  // A seeded 500-work subsample of MAIN for the Pro and Haiku arms.
  const r2 = makeRng(SEED + 500);
  const mainIds = sample.filter((s) => s.in_main).map((s) => ({ id: s.id, r: r2() })).sort((a, b) => a.r - b.r).slice(0, SUB_N).map((o) => o.id);
  const sub = new Set(mainIds); for (const s of sample) s.in_sub500 = sub.has(s.id);
  writeJsonl(path.join(OUT, 'sample.jsonl'), sample);
  const walkedN = walkedOrder.length; const withText = walkedOrder.filter((k) => walked.get(k).book_id).length;
  const summary = { seed: SEED, works_total: works.size, books_with_pages: books.length, works_walked: walkedN, works_with_text: withText, quotas: got, visible_in_main: sample.filter((s) => s.in_main && s.visible).length };
  fs.writeFileSync(path.join(OUT, 'draw-summary.json'), JSON.stringify(summary, null, 1) + '\n');
  console.log(summary);
}
const pick = (b) => ({ id: b.id, work_id: b.work_id, title: b.title, author: b.author, year: b.year, language: b.language, visible: b.visible, hidden_reason: b.hidden_reason, provider: b.provider, ia: b.ia, created_at: b.created_at, disposition: b.disposition, has_en: b.has_en, n_tr: b.n_tr, tr_publishers: b.tr_publishers, tr_oldest: b.tr_oldest, is_first_translation: b.is_first_translation, collections: b.collections });

// ---------- stage: controls ----------
// Canonical positives we hold: [label, title regex, author regex | null]. The first held edition
// with OCR text wins. They MUST come out "in"; if they do not, the instrument is broken.
const POSITIVES = [
  ['Vulgate Genesis / Biblia', /^biblia\b|vulgat/i, null], ['Iliad', /ilia[sd]|ἰλιά/i, /homer/i], ['Odyssey', /^Homers Odyssey|^The Odyssey I/i, null],
  ['Aeneid', /aene[ia]|eneid/i, /vergil|virgil|maro/i], ['Bhagavad Gita', /भगवद्गीता|bhagavad-gita, id est/i, null], ['Analects', /^論語/, null], ['Diamond Sutra', /^金剛般若波羅蜜經 \(vol 1\)/, null],
  ['Plato Republic / Opera', /respublica|politeia|πολιτεία|republic|opera omnia|dialog/i, /plato/i], ['Euclid Elements', /element/i, /euclid/i],
  ['Augustine Confessions', /confession/i, /augustin/i], ['Boethius Consolatio', /consolatio/i, /boet/i], ['Ovid Metamorphoses', /metamorph/i, /ovid|naso/i],
  ['Lucretius', /rerum natura/i, /lucret/i], ['Dao De Jing', /^道德經/, null], ['Quran', /qur.?an|koran|alcoran|القرآن/i, null],
  ['Imitatio Christi', /imitatione? christi/i, null], ['Divina Commedia', /comedia|commedia/i, /dante/i], ['Caesar Bellum Gallicum', /bell.*gallic|commentari/i, /caesar/i],
  ['Cicero De officiis', /officiis/i, /cicero/i], ['Aristotle Ethics', /ethic/i, /aristot/i], ['Marcus Aurelius', /meditation|ad se ipsum|τὰ εἰς ἑαυτόν/i, /aurel|antonin/i],
  ['Copernicus De revolutionibus', /revolutionibus/i, /copernic/i], ['Newton Principia', /principia/i, /newton/i], ['Corpus Hermeticum / Pimander', /pimander|poemander|hermes trismegist|mercurii trismegisti/i, null],
];
// Known-but-not-canonical works we hold (added after the first flash-lite pass showed the
// canonical tier is too easy): a model that knows these must not call them new. Their
// false-"new" rate is the error that matters for a "new to AI" claim.
const KNOWN = [
  ['Agrippa De occulta philosophia', /^De occulta philosophia libri/i, /agripp/i], ['Kircher Oedipus Aegyptiacus', /^Oedipus Aegyptiacus/i, null],
  ['Maier Atalanta fugiens', /^Atalanta fugiens: Emblemata/i, null], ['Fludd Utriusque cosmi', /^Utriusque cosmi majoris/i, null],
  ['Dee Monas hieroglyphica', /^Monas hieroglyphica/i, null], ['Kepler Harmonices mundi', /^Harmonices mundi/i, null],
  ['Della Porta Magia naturalis', /^Magia naturalis/i, null], ['Khunrath Amphitheatrum', /^Amphitheatrum sapientiae/i, null],
  ['Ficino De vita', /^De vita libri tres/i, null], ['Bruno De umbris idearum', /^De Umbris Idearum/i, null],
  ['Vesalius Fabrica', /^De Humani Corporis Fabrica/i, null], ['Galileo Sidereus nuncius', /^Sidereus Nuncius/i, null],
  ['Comenius Orbis pictus', /^Orbis Sensualium Pictus/i, null], ['Andreae Chymische Hochzeit', /^Chymische Hochzeit/i, null],
  ['Reuchlin De arte cabalistica', /^De Arte Cabalistica/i, null], ['Pico Conclusiones', /^Conclusiones sive Theses/i, null],
  ['Bacon Novum organum', /^Novum organum/i, null], ['Zohar', /^Sefer ha-Zohar/i, null], ['Mencius', /^孟子 \(Mencius\)/, null],
  ['Zhuangzi', /^莊子旁注/, null], ['Avicenna Canon', /^Canon Medicinae/i, null], ['Lull Ars magna', /^Ars Magna Generalis/i, null],
  ['Bencao gangmu', /^本草綱目·卷上之中/, null],
];
// Invented decoys: plausible titles, authors and years, in the corpus's languages. None is a real
// book (checked by the author of this list against memory; a decoy a model "knows" is a finding).
const DECOYS = [
  ['De concordia elementorum libri tres', 'Ioannes Bertholdus Vlmensis', 1583, 'Latin'], ['Tractatus de lumine metallorum occulto', 'Matthias Kesselring', 1617, 'Latin'],
  ['Disputatio physica de igne coelesti et terrestri', 'Henricus Altdorfius', 1642, 'Latin'], ['Speculum mysteriorum Hermeticorum', 'Petrus Lanzenius', 1609, 'Latin'],
  ['Clavis sapientiae Salomonis restituta', 'Andreas Wolfhardus', 1598, 'Latin'], ['Commentarius in Psalmum centesimum decimum nonum', 'Ioannes Caspar Rötelius', 1671, 'Latin'],
  ['Oratio de laudibus geometriae habita Lipsiae', 'Georgius Fabricius Pirnensis', 1556, 'Latin'], ['Theatrum chymicum minus', 'Laurentius Eyssenhart', 1652, 'Latin'],
  ['Von der verborgenen Krafft der Kräuter und Steine', 'Johann Christoph Hellwig von Zeitz', 1687, 'German'], ['Geistlicher Rosengarten der wahren Weißheit', 'Michael Sternfeldt', 1622, 'German'],
  ['Kurtzer Bericht von dem Philosophischen Saltz', 'Georg Andreas Würffel', 1709, 'German'], ['Neu-eröffnetes Kunst-Cabinet der Natur', 'Christian Ehrenfried Molitor', 1734, 'German'],
  ['Discorso sopra la generazione delle comete', 'Bartolomeo Zanchetti', 1619, 'Italian'], ['Trattato della pietra filosofale e delle sue virtù', 'Giovan Battista Merlotti', 1588, 'Italian'],
  ['Traité de la lumière cachée des métaux', 'Pierre de Vaucelles', 1636, 'French'], ['Le miroir des secrets de nature', 'Jacques Ourlin', 1611, 'French'],
  ['Verhandeling van de geheime vuuren der natuur', 'Cornelis van Hoogeveen', 1694, 'Dutch'], ['Tratado de la quinta essencia de los minerales', 'Diego Ruiz de Albornoz', 1602, 'Spanish'],
  ['Περὶ τῆς ἱερᾶς τέχνης ὑπομνήματα', 'Θεόδωρος ὁ Φιλαδελφεύς', 1550, 'Greek'], ['Λόγος περὶ τῆς τῶν ἀστέρων φύσεως', 'Νικηφόρος Καλλιόπης', 1520, 'Greek'],
  ['養生玄珠集', '周懷素', 1592, 'Chinese'], ['丹臺秘錄', '陳元澄', 1638, 'Chinese'], ['易理通微', '黃世瑾', 1705, 'Chinese'], ['醫門鈎玄', '吳廷芳', 1663, 'Chinese'],
  ['金液還真論', '張道沖', 1610, 'Classical Chinese'], ['رسالة في أسرار المعادن الخفية', 'أبو الفضل بن يحيى الحرّاني', 1240, 'Arabic'],
  ['كتاب الأنوار في علم الأحجار', 'شمس الدين الطرابلسي', 1310, 'Arabic'], ['رساله در خواص سنگ‌ها و فلزات', 'میرزا حسن کرمانی', 1650, 'Persian'],
  ['ספר מאור הגנוז', 'ר׳ יהודה בן שמואל מקרקא', 1612, 'Hebrew'], ['שער הסודות הנעלמים', 'ר׳ אברהם חיים מליוורנו', 1685, 'Hebrew'],
  ['रसतत्त्वप्रदीपिका', 'श्रीकण्ठमिश्र', 1600, 'Sanskrit'], ['योगसारमञ्जरी', 'वासुदेवभट्ट', 1550, 'Sanskrit'],
  ['ཟབ་དོན་གསལ་བའི་སྒྲོན་མེ', 'བློ་བཟང་དཔལ་འབྱོར', 1720, 'Tibetan'], ['སྨན་དཔྱད་གསེར་གྱི་ཕྲེང་བ', 'ཀུན་དགའ་རིན་ཆེན', 1650, 'Tibetan'],
  ['Tractatus de harmonia mundi interiori', 'Fridericus Ottonius Brennerus', 1661, 'Latin'], ['Lexicon alchemicum novum et emendatum', 'Ioannes Iacobus Hartungus', 1679, 'Latin'],
  ['Exercitationes de spiritu mundi', 'Gualterus Fennerus Anglus', 1647, 'Latin'], ['Gründliche Erklärung der Smaragdinen Tafel', 'Heinrich Volckmar Krause', 1698, 'German'],
  ['Annotationes in Picatricem', 'Caspar Hornfeldius', 1604, 'Latin'], ['De arcanis numerorum Pythagoricis dialogus', 'Ludovicus Vasselius', 1574, 'Latin'],
];
async function stageControls() {
  const books = readJsonl(path.join(PRIVATE, 'ids.jsonl')).filter((b) => b.pages_count > 0);
  const { MongoClient } = await import('mongodb');
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const pages = c.db('bookstore').collection('pages');
  const out = []; const used = new Set();
  for (const [label, tre, are, kind] of [...POSITIVES, ...KNOWN.map((k) => [...k, 'known'])]) {
    const cands = books.filter((b) => !used.has(b.id) && tre.test(b.title) && (!are || are.test(b.author) || are.test(b.title))).sort((a, b) => (b.visible - a.visible) || String(a.id).localeCompare(String(b.id)));
    let hit = null;
    for (const b of cands.slice(0, 8)) {
      const ps = await pages.find({ book_id: b.id, 'ocr.data': { $exists: true, $ne: '' } }, { projection: { page_number: 1, 'ocr.data': 1 } }).sort({ page_number: 1 }).limit(15).maxTimeMS(20000).toArray();
      const text = ps.map((p) => cleanServed(p.ocr?.data)).join('\n\n');
      if (normQuote(text).length >= 300) { hit = b; fs.writeFileSync(path.join(PRIVATE, 'texts', `${b.id}.txt`), text.slice(0, 60000)); break; }
    }
    if (!hit) { console.log('positive not held with text:', label, cands.length); continue; }
    used.add(hit.id); out.push({ ...pick(hit), control: kind || 'positive', label, lang: langOf(hit) });
  }
  DECOYS.forEach(([title, author, year, language], i) => out.push({ id: `decoy-${String(i + 1).padStart(2, '0')}`, title, author, year, language, lang: language, control: 'decoy', disposition: null, n_tr: 0, ia: false }));
  await c.close();
  writeJsonl(path.join(OUT, 'controls.jsonl'), out);
  console.log('positives', out.filter((x) => x.control === 'positive').length, 'known', out.filter((x) => x.control === 'known').length, 'decoys', out.filter((x) => x.control === 'decoy').length);
}

// ---------- probe ----------
const PROMPT_VERSION = 'ai-exposure-6038-v1';
function bookLine(i, b) {
  const parts = [`Title: ${String(b.title).replace(/\s+/g, ' ').slice(0, 220)}`];
  if (b.author && !SENTINEL_AUTHOR.test(fold(b.author))) parts.push(`Author: ${b.author}`);
  if (b.year) parts.push(`Year: ${b.year}`);
  if (b.lang) parts.push(`Language: ${b.lang}`);
  return `${i}. ${parts.join(' | ')}`;
}
function probePrompt(items) {
  return `You are helping a library find out which of its historical books are already known to AI models. Answer each question from your own memory only. Be honest: "no" and "unknown" are good answers. Never invent a quotation.

For each numbered book below, give:
- "knows_of": do you know OF this work — who wrote it and roughly what it is? "yes", "no" or "unsure".
- "self_familiar": did you encounter the TEXT of this work in your training data, not just references to it? Distinguish knowing OF a book from having seen its text. "yes", "no" or "unsure".
- "opening": one sentence from the opening of the work, verbatim, in its original language and script, exactly as you remember it — or the string "unknown" if you cannot quote it from memory. Do not translate, paraphrase or reconstruct.

Books:
${items.map((b, i) => bookLine(i + 1, b)).join('\n')}

Return ONLY a JSON array with one object per book, in order: [{"i":1,"knows_of":"...","self_familiar":"...","opening":"..."}, ...]`;
}

// Packets: real books + 2 decoys + 1 positive, never two items of one work or author together.
function stagePackets() {
  const set = args.set;
  const controls = readJsonl(path.join(OUT, 'controls.jsonl'));
  const decoys = controls.filter((x) => x.control === 'decoy'); const positives = controls.filter((x) => x.control === 'positive'); const known = controls.filter((x) => x.control === 'known');
  let real;
  if (set === 'controls') real = [];
  else {
    const sample = readJsonl(path.join(OUT, 'sample.jsonl'));
    real = set === 'sub500' ? sample.filter((s) => s.in_sub500) : sample;
  }
  const rng = makeRng(SEED + set.length);
  const order = real.map((b) => ({ b, r: rng() })).sort((x, y) => x.r - y.r).map((o) => o.b);
  const packets = [];
  if (set === 'controls') {
    const all = [...positives, ...known, ...decoys].map((b) => ({ b, r: rng() })).sort((x, y) => x.r - y.r).map((o) => o.b);
    for (let i = 0; i < all.length; i += 21) packets.push(all.slice(i, i + 21));
  } else {
    const nP = Math.ceil(order.length / PACKET_REAL);
    for (let p = 0; p < nP; p++) packets.push([]);
    const authors = packets.map(() => new Set()); const worksIn = packets.map(() => new Set());
    let p = 0;
    for (const b of order) {
      const a = authorKey(b); const wk = b.work_key;
      let tries = 0;
      while (tries < nP && (packets[p].length >= PACKET_REAL || (a && authors[p].has(a)) || worksIn[p].has(wk))) { p = (p + 1) % nP; tries++; }
      if (tries >= nP) { packets.push([]); authors.push(new Set()); worksIn.push(new Set()); p = packets.length - 1; }
      packets[p].push(b); if (a) authors[p].add(a); worksIn[p].add(wk); p = (p + 1) % packets.length;
    }
    packets.forEach((pk, k) => {
      pk.push(decoys[(2 * k) % decoys.length], decoys[(2 * k + 1) % decoys.length], positives[k % positives.length]);
    });
    for (let k = 0; k < packets.length; k++) packets[k] = packets[k].map((b) => ({ b, r: rng() })).sort((x, y) => x.r - y.r).map((o) => o.b);
  }
  const dir = path.join(OUT, `packets-${set}`); fs.mkdirSync(dir, { recursive: true });
  packets.forEach((pk, k) => {
    fs.writeFileSync(path.join(dir, `packet-${String(k + 1).padStart(3, '0')}.json`), JSON.stringify({ packet: k + 1, prompt_version: PROMPT_VERSION, ids: pk.map((b) => b.id), prompt: probePrompt(pk) }, null, 1) + '\n');
  });
  console.log(set, packets.length, 'packets', packets.reduce((s, p) => s + p.length, 0), 'items');
}

function parseAnswers(text, ids) {
  const m = String(text || '').match(/\[[\s\S]*\]/);
  if (!m) return null;
  let arr; try { arr = JSON.parse(m[0]); } catch { return null; }
  if (!Array.isArray(arr)) return null;
  const norm3 = (v) => { const s = String(v || '').toLowerCase().trim(); return ['yes', 'no', 'unsure'].includes(s) ? s : 'invalid'; };
  return ids.map((id, k) => {
    const a = arr.find((x) => Number(x?.i) === k + 1) || arr[k];
    if (!a) return { id, missing: true };
    const op = String(a.opening ?? '').trim();
    return { id, knows_of: norm3(a.knows_of), self_familiar: norm3(a.self_familiar), opening: /^(unknown|"unknown"|n\/a|none|)$/i.test(op) ? null : op.slice(0, 1200) };
  });
}

async function stageGemini() {
  const set = args.set; const model = args.model;
  const { callGemini } = await import('../lib/gemini-script-client.mjs');
  const { costOf } = await import('../lib/model-pricing.mjs');
  const dir = path.join(OUT, `packets-${set}`); const outF = path.join(OUT, `answers-${set}-${model}.jsonl`);
  const spentF = path.join(OUT, 'spend.jsonl');
  const totalSpent = () => readJsonl(spentF).reduce((s, r) => s + (r.usd || 0), 0);
  const done = new Set(readJsonl(outF).filter((r) => !r.error).map((r) => r.packet));
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  const limit = Number(args.limit || files.length);
  const conc = Number(args.conc || 4);
  const todo = files.filter((f) => !done.has(JSON.parse(fs.readFileSync(path.join(dir, f))).packet)).slice(0, limit);
  const isPro = /pro/.test(model);
  let k = 0;
  async function worker() {
    while (k < todo.length) {
      const f = todo[k++];
      if (totalSpent() > CAP_USD - 0.25) { console.error('cap reached'); return; }
      const pk = JSON.parse(fs.readFileSync(path.join(dir, f)));
      let row;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const r = await callGemini({ model, prompt: pk.prompt, endpoint: ENDPOINT, maxOutputTokens: isPro ? 16000 : 8000, temperature: 0, promptVersion: PROMPT_VERSION, ...(isPro ? { thinkingBudget: Number(args.think || 1024) } : {}) });
          const usd = costOf(model, r.inputTokens, r.outputTokens);
          fs.appendFileSync(spentF, JSON.stringify({ at: new Date().toISOString(), set, model, packet: pk.packet, usd }) + '\n');
          const ans = parseAnswers(r.text, pk.ids);
          row = { packet: pk.packet, model, usd, input_tokens: r.inputTokens, output_tokens: r.outputTokens, thinking_tokens: r.thinkingTokens, finish: r.finishReason, ...(ans ? { answers: ans } : { error: 'parse', raw: r.text.slice(0, 3000) }) };
          if (ans) break;
        } catch (e) { row = { packet: pk.packet, model, error: String(e.message || e).slice(0, 300) }; await new Promise((res) => setTimeout(res, 3000 * (attempt + 1))); }
      }
      fs.appendFileSync(outF, JSON.stringify(row) + '\n');
    }
  }
  await Promise.all(Array.from({ length: conc }, worker));
  const rows = readJsonl(outF);
  console.log(set, model, 'packets ok', rows.filter((r) => !r.error).length, 'errors', rows.filter((r) => r.error).length, 'total spend $', totalSpent().toFixed(3));
}

function stageIngest() {
  const set = args.set; const model = args.model || 'claude-haiku';
  const dir = path.join(OUT, `packets-${set}`); const odir = path.join(OUT, `packets-${set}-out`);
  const rows = [];
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    const pk = JSON.parse(fs.readFileSync(path.join(dir, f)));
    const of = path.join(odir, f.replace('.json', '.out.json'));
    if (!fs.existsSync(of)) { rows.push({ packet: pk.packet, model, error: 'no output' }); continue; }
    const ans = parseAnswers(fs.readFileSync(of, 'utf8'), pk.ids);
    rows.push(ans ? { packet: pk.packet, model, answers: ans } : { packet: pk.packet, model, error: 'parse' });
  }
  writeJsonl(path.join(OUT, `answers-${set}-${model}.jsonl`), rows);
  console.log(model, 'packets ok', rows.filter((r) => !r.error).length, 'errors', rows.filter((r) => r.error).length);
}

// ---------- verification: is the quoted opening in OUR OCR? ----------
// Normalise per non-latin-text-operations.md: NFKC, letters+digits of EVERY script, marks
// dropped on both sides alike, Latin early-modern folds (ſ/s, v/u, j/i, æ, œ, ß), no spaces
// (word segmentation differs between OCR and memory; Tibetan, CJK have none or tsheg).
function normQuote(s) {
  return String(s || '').normalize('NFKC').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/ſ/g, 's').replace(/æ/g, 'ae').replace(/œ/g, 'oe').replace(/ß/g, 'ss').replace(/v/g, 'u').replace(/j/g, 'i')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}
const isHan = (s) => /[㐀-鿿豈-﫿]/.test(s);
function grams(s, n) { const g = new Set(); for (let i = 0; i + n <= s.length; i++) g.add(s.slice(i, i + n)); return g; }
// Coverage: share of the quote's characters covered by runs of >= L characters that occur
// verbatim (after normalisation) in our text. Runs survive scattered OCR errors; a 5-gram
// share did not — generic English sentences scored 0.6–0.75 against unrelated books.
const gramCache = new Map();
function containment(quote, text, key) {
  const q = normQuote(quote); const t = normQuote(text);
  const han = isHan(q); const L = han ? 4 : 12; const minLen = han ? 8 : 20;
  if (q.length < minLen) return { judgeable: false, why: 'quote too short' };
  if (t.length < 300) return { judgeable: false, why: 'our text too short' };
  const ck = `${key}|${L}`;
  if (!gramCache.has(ck)) gramCache.set(ck, grams(t, L));
  const tg = gramCache.get(ck); const cov = new Uint8Array(q.length);
  for (let i = 0; i + L <= q.length; i++) if (tg.has(q.slice(i, i + L))) cov.fill(1, i, i + L);
  return { judgeable: true, score: +(cov.reduce((s, x) => s + x, 0) / q.length).toFixed(3), qlen: q.length };
}
const textCache = new Map();
function textOf(id) {
  if (!textCache.has(id)) { const f = path.join(PRIVATE, 'texts', `${id}.txt`); textCache.set(id, fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : ''); }
  return textCache.get(id);
}
function allAnswers() {
  const rows = [];
  for (const f of fs.readdirSync(OUT).filter((f) => /^answers-.*\.jsonl$/.test(f))) {
    const [, set, model] = f.match(/^answers-([^-]+)-(.+)\.jsonl$/);
    const seen = new Set();
    for (const r of readJsonl(path.join(OUT, f)).reverse()) { // last good row per packet wins
      if (r.error || seen.has(r.packet)) continue; seen.add(r.packet);
      for (const a of r.answers) rows.push({ ...a, set, model, packet: r.packet });
    }
  }
  return rows;
}
function stageVerify() {
  const sample = readJsonl(path.join(OUT, 'sample.jsonl')); const controls = readJsonl(path.join(OUT, 'controls.jsonl'));
  const meta = new Map([...sample, ...controls].map((b) => [b.id, b]));
  const ans = allAnswers().filter((a) => a.opening && !a.missing);
  // Null: the same quote against ANOTHER book's text in the same language (seeded). Sets the
  // threshold so that a cross-book match passes < 1% of the time.
  const byLang = new Map();
  for (const b of [...sample, ...controls]) if (b.lang && textOf(b.id)) { if (!byLang.has(b.lang)) byLang.set(b.lang, []); byLang.get(b.lang).push(b.id); }
  const rng = makeRng(SEED + 7);
  const out = []; const nullScores = [];
  for (const a of ans) {
    const b = meta.get(a.id); if (!b) continue;
    const own = b.control === 'decoy' ? { judgeable: false, why: 'decoy (no text exists)' } : containment(a.opening, textOf(a.id), a.id);
    // Null partner: same language, different author AND different work (a second edition is a true match).
    const ak = authorKey(b); const wk = b.work_key || workKey(b);
    const pool = (byLang.get(b.lang) || []).filter((x) => x !== a.id && (!ak || authorKey(meta.get(x)) !== ak) && (meta.get(x).work_key || workKey(meta.get(x))) !== wk && fold(meta.get(x).title).slice(0, 25) !== fold(b.title).slice(0, 25));
    let nul = null;
    if (pool.length) { const other = pool[Math.floor(rng() * pool.length)]; nul = containment(a.opening, textOf(other), other); if (nul.judgeable) nullScores.push(nul.score); }
    out.push({ id: a.id, set: a.set, model: a.model, ...own, null_score: nul?.judgeable ? nul.score : null });
  }
  nullScores.sort((x, y) => x - y);
  const q99 = nullScores.length ? nullScores[Math.floor(0.99 * (nullScores.length - 1))] : null;
  const threshold = Math.max(0.5, q99 == null ? 0.5 : +(q99 + 0.05).toFixed(3));
  for (const r of out) r.verified = r.judgeable ? r.score >= threshold : null;
  writeJsonl(path.join(OUT, 'verify.jsonl'), out);
  const s = { quotes: out.length, judgeable: out.filter((r) => r.judgeable).length, verified: out.filter((r) => r.verified).length, null_n: nullScores.length, null_q99: q99, null_max: nullScores.at(-1) ?? null, threshold };
  fs.writeFileSync(path.join(OUT, 'verify-summary.json'), JSON.stringify(s, null, 1) + '\n');
  console.log(s);
}

// ---------- fusion ----------
// Hand-set BEFORE any sample answer was read (as in May; May's coefficients were never
// published, so these are new). Sensitivity variants are reported alongside.
const logit = (p) => Math.log(p / (1 - p)); const sigm = (x) => 1 / (1 + Math.exp(-x));
const DISP_P = { confirmed_first: 0.15, first_from_source: 0.40, first_complete_translation: 0.55, first_modern_translation: 0.65, translation_found: 0.75, needs_review: 0.35 };
const CANON = /loeb|brill|oxford|clarendon|cambridge|penguin|princeton|routledge|gruyter|harvard|yale|chicago/i;
function priorLogOdds(b) {
  let l; const f = [];
  if (b.disposition && DISP_P[b.disposition] != null) {
    l = logit(DISP_P[b.disposition]); f.push(`disp:${b.disposition}`);
    if (b.n_tr >= 2) { l += 0.5; f.push('n_tr>=2'); }
    if (CANON.test(b.tr_publishers || '')) { l += 0.7; f.push('canonical imprint'); }
    if (b.tr_oldest && b.tr_oldest < 1950) { l += 0.3; f.push('translation<1950'); }
  } else {
    // Fallback for works the verifier never reached (most of today's corpus).
    l = logit(0.30); f.push('no verification');
    if (/^english$/i.test(b.lang || '')) { l += 0.8; f.push('English'); }
    if (b.is_first_translation === true) { l -= 0.5; f.push('is_first_translation'); }
  }
  if (b.ia) { l += 0.3; f.push('IA scan'); }
  return { l, f };
}
// Likelihood ratios P(answer | in) / P(answer | new). Flash-Lite says "yes" to most obscure
// books (May §4.8), so its yes is weak; Haiku declined calibratedly in May, so it is strongest.
const LR_SELF = {
  'gemini-3.1-flash-lite': { yes: 1.5, unsure: 0.8, no: 0.4 },
  'gemini-3-flash-preview': { yes: 2.5, unsure: 0.8, no: 0.35 },
  'gemini-3.1-pro-preview': { yes: 3, unsure: 0.8, no: 0.3 },
  'claude-haiku': { yes: 4, unsure: 0.8, no: 0.25 },
};
const LR_OPEN = { verified: 30, unverified: 1.0, unknown: 0.8, unjudgeable: 1 };

function fuse(b, byModel, models, verifyMap, { prior = true, scale = 1 } = {}) {
  let l = prior ? priorLogOdds(b).l : 0;
  // Sibling models are correlated: average the Gemini self-familiarity log-LRs, then add the
  // Claude one. Openings: one update, from the best verification across the arms used.
  const g = []; let c = null; let open = 'unjudgeable'; const rank = { verified: 3, unverified: 2, unknown: 1, unjudgeable: 0 };
  for (const m of models) {
    const a = byModel.get(m); if (!a || a.missing) continue;
    const lr = LR_SELF[m]?.[a.self_familiar];
    if (lr) { if (m.startsWith('claude')) c = Math.log(lr); else g.push(Math.log(lr)); }
    let o = 'unknown';
    if (a.opening) { const v = verifyMap.get(`${a.id}|${a.set}|${m}`); o = v?.verified === true ? 'verified' : v?.verified === false ? 'unverified' : 'unjudgeable'; }
    if (rank[o] > rank[open]) open = o;
  }
  if (g.length) l += scale * g.reduce((s, x) => s + x, 0) / g.length;
  if (c != null) l += scale * c;
  l += scale * Math.log(LR_OPEN[open]);
  return { p: sigm(l), open };
}

// ---------- stage: report ----------
function bootstrap(vals, iters = 4000, seed = SEED) {
  const rng = makeRng(seed); const n = vals.length; if (n < 2) return [null, null]; const ms = [];
  for (let i = 0; i < iters; i++) { let s = 0; for (let j = 0; j < n; j++) s += vals[Math.floor(rng() * n)]; ms.push(s / n); }
  ms.sort((a, b) => a - b); return [ms[Math.floor(iters * 0.025)], ms[Math.floor(iters * 0.975)]];
}
function summarise(ps, w = null) {
  const n = ps.length; if (!n) return { n: 0 };
  const share = (f) => { const v = ps.map((p) => (f(p) ? 1 : 0)); const m = v.reduce((s, x) => s + x, 0) / n; return { pct: +(100 * m).toFixed(1), ci: bootstrap(v).map((x) => (x == null ? null : +(100 * x).toFixed(1))) }; };
  const out = { n, new_lt25: share((p) => p < 0.25), in_gt75: share((p) => p > 0.75), ambiguous: share((p) => p >= 0.25 && p <= 0.75), new_lt10: share((p) => p < 0.10), in_gt90: share((p) => p > 0.90) };
  const mean = ps.reduce((s, x) => s + x, 0) / n; const ci = bootstrap(ps);
  out.expected_in = { pct: +(100 * mean).toFixed(1), ci: ci.map((x) => (x == null ? null : +(100 * x).toFixed(1))) };
  if (w) { const W = w.reduce((s, x) => s + x, 0); out.book_weighted_new_lt25 = +(100 * ps.reduce((s, p, i) => s + (p < 0.25 ? w[i] : 0), 0) / W).toFixed(1); out.book_weighted_expected_in = +(100 * ps.reduce((s, p, i) => s + p * w[i], 0) / W).toFixed(1); }
  return out;
}
function cohenKappa(pairs, cats = ['yes', 'no', 'unsure']) {
  const n = pairs.length; if (!n) return null; let agree = 0; const pa = {}, pb = {};
  for (const [a, b] of pairs) { if (a === b) agree++; pa[a] = (pa[a] || 0) + 1; pb[b] = (pb[b] || 0) + 1; }
  const po = agree / n; const pe = cats.reduce((s, c) => s + ((pa[c] || 0) / n) * ((pb[c] || 0) / n), 0);
  return { n, agree: +(po).toFixed(3), kappa: +((po - pe) / (1 - pe)).toFixed(3) };
}
function stageReport() {
  const sample = readJsonl(path.join(OUT, 'sample.jsonl')); const controls = readJsonl(path.join(OUT, 'controls.jsonl'));
  const verify = readJsonl(path.join(OUT, 'verify.jsonl')); const verifyMap = new Map(verify.map((v) => [`${v.id}|${v.set}|${v.model}`, v]));
  const ans = allAnswers();
  // byId -> model -> answer (main-set answers win over sub500 for the same model; controls kept by set)
  const idx = new Map();
  for (const a of ans) {
    const key = a.set === 'controls' ? `ctl:${a.id}` : a.id;
    if (!idx.has(key)) idx.set(key, new Map());
    const m = idx.get(key);
    if (!m.has(a.model) || a.set === 'main') m.set(a.model, a);
    // in-packet control appearances, per model
    if (a.set !== 'controls' && /^decoy-|^ctlpos/.test(a.id)) { /* handled below */ }
  }
  const modelsSeen = [...new Set(ans.map((a) => a.model))];
  const rep = { run_id: `ai-exposure-6038-${new Date().toISOString().slice(0, 10)}`, measure: 'agreement (work-level recognition); no ground truth except controls', seed: SEED, models: modelsSeen, lr_self: LR_SELF, lr_open: LR_OPEN, disp_prior: DISP_P, verify: JSON.parse(fs.readFileSync(path.join(OUT, 'verify-summary.json'), 'utf8')), spend_usd: +readJsonl(path.join(OUT, 'spend.jsonl')).reduce((s, r) => s + r.usd, 0).toFixed(3) };

  // Controls: standalone run + every in-packet appearance, per model.
  const ctlMeta = new Map(controls.map((c) => [c.id, c]));
  rep.controls = {};
  for (const m of modelsSeen) {
    const rows = ans.filter((a) => a.model === m && ctlMeta.has(a.id) && !a.missing);
    const cell = (kind, set) => {
      const rs = rows.filter((a) => ctlMeta.get(a.id).control === kind && (set === 'any' || (set === 'controls' ? a.set === 'controls' : a.set !== 'controls')));
      const k = (f) => rs.filter(f).length; const n = rs.length;
      const verified = rs.filter((a) => verifyMap.get(`${a.id}|${a.set}|${m}`)?.verified).length;
      return { n, self_yes: k((a) => a.self_familiar === 'yes'), self_yes_wilson: wilson(k((a) => a.self_familiar === 'yes'), n), knows_of_yes: k((a) => a.knows_of === 'yes'), opening_given: k((a) => a.opening), opening_verified: verified,
        p_gt75: rs.filter((a) => fuse(kind === 'decoy' ? { ...ctlMeta.get(a.id) } : ctlMeta.get(a.id), new Map([[m, a]]), [m], verifyMap).p > 0.75).length,
        p_lt25: rs.filter((a) => fuse(ctlMeta.get(a.id), new Map([[m, a]]), [m], verifyMap).p < 0.25).length };
    };
    rep.controls[m] = { positive_standalone: cell('positive', 'controls'), known_standalone: cell('known', 'controls'), decoy_standalone: cell('decoy', 'controls'), positive_in_packets: cell('positive', 'packets'), decoy_in_packets: cell('decoy', 'packets') };
  }

  // Sample posteriors, per arm combination.
  const arms = {
    prior_only: { models: [], prior: true },
    lite_prior: { models: ['gemini-3.1-flash-lite'], prior: true },
    lite_flash_prior: { models: ['gemini-3.1-flash-lite', 'gemini-3-flash-preview'], prior: true },
    all_prior: { models: ['gemini-3.1-flash-lite', 'gemini-3-flash-preview', 'gemini-3.1-pro-preview', 'claude-haiku'], prior: true, sub: true },
    lite_flash_noprior: { models: ['gemini-3.1-flash-lite', 'gemini-3-flash-preview'], prior: false },
    lite_flash_prior_halfLR: { models: ['gemini-3.1-flash-lite', 'gemini-3-flash-preview'], prior: true, scale: 0.5 },
  };
  const per = [];
  for (const b of sample) {
    const m = idx.get(b.id) || new Map();
    const row = { id: b.id, visible: b.visible, in_main: b.in_main, strata: b.strata, in_sub500: b.in_sub500, lang: b.lang, disposition: b.disposition, n_editions: b.n_editions, prior: +sigm(priorLogOdds(b).l).toFixed(3) };
    for (const [name, a] of Object.entries(arms)) {
      if (a.models.some((x) => !modelsSeen.includes(x)) && a.models.length) { continue; }
      if (a.models.some((x) => !m.has(x))) { row[name] = null; continue; }
      const r = fuse(b, m, a.models, verifyMap, { prior: a.prior, scale: a.scale ?? 1 }); row[name] = +r.p.toFixed(3); row[`${name}_open`] = r.open;
    }
    for (const x of modelsSeen) { const a = m.get(x); if (a) row[`ans_${x}`] = `${a.self_familiar}/${a.knows_of}/${a.opening ? (verifyMap.get(`${a.id}|${a.set}|${x}`)?.verified ? 'V' : 'q') : '-'}`; }
    per.push(row);
  }
  writeJsonl(path.join(OUT, 'posteriors.jsonl'), per);
  rep.arms = {};
  for (const name of Object.keys(arms)) {
    const has = per.filter((r) => r[name] != null); if (!has.length) continue;
    const groups = { main_all_held: has.filter((r) => r.in_main), main_visible: has.filter((r) => r.in_main && r.visible), main_hidden: has.filter((r) => r.in_main && !r.visible),
      main_with_verification: has.filter((r) => r.in_main && r.disposition), main_without_verification: has.filter((r) => r.in_main && !r.disposition) };
    for (const s of Object.keys(STRATA)) groups[`stratum_${s}`] = has.filter((r) => r.strata?.includes(s));
    rep.arms[name] = Object.fromEntries(Object.entries(groups).map(([g, rs]) => [g, summarise(rs.map((r) => r[name]), g === 'main_all_held' ? rs.map((r) => r.n_editions) : null)]));
  }
  // Raw answer rates per model on main.
  rep.answer_rates = {};
  for (const x of modelsSeen) {
    const rs = per.filter((r) => r.in_main && r[`ans_${x}`]);
    const c = (re) => rs.filter((r) => re.test(r[`ans_${x}`])).length;
    rep.answer_rates[x] = { n: rs.length, self_yes: c(/^yes\//), self_no: c(/^no\//), self_unsure: c(/^unsure\//), knows_of_yes: c(/^[a-z]+\/yes/), opening_given: c(/\/[Vq]$/), opening_verified: c(/\/V$/) };
  }
  // Agreement between models on self_familiar (same books).
  rep.kappa = {};
  for (let i = 0; i < modelsSeen.length; i++) for (let j = i + 1; j < modelsSeen.length; j++) {
    const a = modelsSeen[i], b = modelsSeen[j];
    const pairs = sample.filter((s) => s.in_main && idx.get(s.id)?.get(a) && idx.get(s.id)?.get(b)).map((s) => [idx.get(s.id).get(a).self_familiar, idx.get(s.id).get(b).self_familiar]).filter(([x, y]) => x !== 'invalid' && y !== 'invalid');
    rep.kappa[`${a} vs ${b}`] = { self_familiar: cohenKappa(pairs), binary_yes: cohenKappa(pairs.map(([x, y]) => [x === 'yes' ? 'yes' : 'no', y === 'yes' ? 'yes' : 'no']), ['yes', 'no']) };
  }
  // By disposition (prior vs behaviour).
  rep.by_disposition = {};
  for (const d of [...new Set(per.filter((r) => r.in_main).map((r) => r.disposition || 'none'))]) {
    const rs = per.filter((r) => r.in_main && (r.disposition || 'none') === d);
    const best = Object.keys(rep.arms).includes('lite_flash_prior') ? 'lite_flash_prior' : 'lite_prior';
    rep.by_disposition[d] = { n: rs.length, mean_prior: +(rs.reduce((s, r) => s + r.prior, 0) / rs.length).toFixed(3), [`mean_${best}`]: +(rs.filter((r) => r[best] != null).reduce((s, r) => s + r[best], 0) / Math.max(1, rs.filter((r) => r[best] != null).length)).toFixed(3) };
  }
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(rep, null, 1) + '\n');
  // Markdown table.
  const f = (c) => (c?.pct == null ? '—' : `${c.pct}% [${c.ci[0]}–${c.ci[1]}]`);
  const L = ['| arm | group | n | new (P<0.25) | in (P>0.75) | ambiguous | new (P<0.10) | in (P>0.90) | expected in |', '|---|---|---:|---|---|---|---|---|---|'];
  for (const [arm, gs] of Object.entries(rep.arms)) for (const [g, s] of Object.entries(gs)) if (s.n) L.push(`| ${arm} | ${g} | ${s.n} | ${f(s.new_lt25)} | ${f(s.in_gt75)} | ${f(s.ambiguous)} | ${f(s.new_lt10)} | ${f(s.in_gt90)} | ${f(s.expected_in)} |`);
  L.push('', '| model | control | n | self yes | knows-of yes | opening given | opening verified | P>0.75 | P<0.25 |', '|---|---|---:|---:|---:|---:|---:|---:|---:|');
  for (const [m, cs] of Object.entries(rep.controls)) for (const [k, c] of Object.entries(cs)) if (c.n) L.push(`| ${m} | ${k} | ${c.n} | ${c.self_yes} | ${c.knows_of_yes} | ${c.opening_given} | ${c.opening_verified} | ${c.p_gt75} | ${c.p_lt25} |`);
  fs.writeFileSync(path.join(OUT, 'report.md'), L.join('\n') + '\n');
  console.log(L.join('\n'));
  console.log(JSON.stringify({ answer_rates: rep.answer_rates, kappa: rep.kappa, by_disposition: rep.by_disposition, verify: rep.verify, spend: rep.spend_usd }, null, 1));
}

const stage = args.stage;
if (stage === 'ids') await stageIds();
else if (stage === 'draw') await stageDraw();
else if (stage === 'controls') await stageControls();
else if (stage === 'packets') stagePackets();
else if (stage === 'gemini') await stageGemini();
else if (stage === 'ingest') stageIngest();
else if (stage === 'verify') stageVerify();
else if (stage === 'report') stageReport();
else { console.error('--stage=ids|draw|controls|packets|gemini|ingest|verify|report'); process.exit(1); }
