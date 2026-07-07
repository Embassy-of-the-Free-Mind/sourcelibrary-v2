#!/usr/bin/env node
/**
 * detect-language-mislabels.mjs — find and fix books whose stored `language`
 * disagrees with their actual OCR content (#3026 language cleanup).
 *
 * The `language` field is often set from the import source or an edition's
 * apparatus language, not the text on the page — so Greek critical editions get
 * tagged "Latin", vernacular translations get tagged as their classical source,
 * etc. This detects the mismatch from real OCR body text (deterministic, no
 * agents) and, on --apply, corrects `language` (+ sets `original_language` when
 * the book is a translation) with a full backup.
 *
 * Method: sample deep body pages, keep only transcribed text (post-"->" runs),
 * strip the OCR's English image-descriptions, then score script ranges +
 * function words. Only proposes a change when the detected language wins by a
 * clear margin AND differs from the stored one. Everything else is left alone.
 *
 * Dry-run by default. Writes only with --apply (backs up to --backup <file>).
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/detect-language-mislabels.mjs --pattern latin-vernacular
 *   node scripts/maintenance/detect-language-mislabels.mjs --ids <file>
 *   node scripts/maintenance/detect-language-mislabels.mjs --pattern latin-vernacular --apply --backup out.json
 */
import { MongoClient, ObjectId } from 'mongodb';
import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const getArg = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const APPLY = args.includes('--apply');
const PATTERN = getArg('--pattern', null);
const IDS_FILE = getArg('--ids', null);
const BACKUP = getArg('--backup', null);
const LIMIT = parseInt(getArg('--limit', '0'), 10) || 0;

const SCRIPTS = [
  ['Greek', /[Ͱ-Ͽἀ-῿]/g],
  ['Devanagari', /[ऀ-ॿ]/g],
  ['Tibetan', /[ༀ-࿿]/g],
  ['Arabic', /[؀-ۿ]/g],
  ['Hebrew', /[֐-׿]/g],
  ['Cyrillic', /[Ѐ-ӿ]/g],
  ['Chinese', /[一-鿿]/g],
];
const FUNC = {
  Italian: /\b(che|della|delle|questo|questa|nella|nel|con|per|gli|sono|quando|così|più|anche|essere|fatto|volgare|dello|degli|come|non|suo|nostro)\b/gi,
  French: /\b(que|dans|avec|pour|les|des|une|être|cette|aussi|traduit|nous|vous|leur|dont|ainsi|même|toutes)\b/gi,
  Latin: /\b(quod|autem|enim|atque|esse|sunt|quae|quam|cum|nam|igitur| omnia|etiam|ipse|hujus|eius|inter|apud|secundum)\b/gi,
  German: /\b(und|der|die|das|nicht|welche|sich|auch|einer|ein|von|zu|mit|dem|den|dieser|wird|durch|nach|aber)\b/gi,
  Dutch: /\b(ende|het|van|voor|niet|welke|deze|zijn|door|naar|geweest|een|met|dat|zoo|aldereerst|schepen|reys|verhaal)\b/gi,
  English: /\b(the|and|of|that|which|with|hath|unto|shall|this|from|they|their|were|would|there|these|also)\b/gi,
};
const BOILER = /the image (shows|shows the|depicts|is|provided|displays)|this (image|page|is)|(front|back|outer|exterior) cover|\bblank\b|marbled|vellum|parchment|leather|\bbinding\b|calibration|digitized by|proquest|copyright|e-?rara|visual library|\blogo\b|shelfmark|library (stamp|label|ownership)|ownership stamp|flyleaf|endpaper|no (legible|text)|color chart|watermark|biblioteca nazionale|centrale|firenze|raccolta|nencini|aldini|early european books|images reproduced|courtesy|raised bands|\bspine\b|gilded|ornamental|scrollwork|photograph|\boval\b|paper label|decorative border|text block|book spine|handwritten (library|identification|shelfmark|page)|likely refers/gi;

// Institutional/library English that pollutes OCR image-descriptions is NOT
// evidence of English content. For a known-foreign pool, an "English" detection
// is almost always that artifact — treat it as unclear rather than retag.
const NO_ENGLISH_PATTERNS = new Set(['latin-vernacular']);

function transcription(ocr) {
  let t = (ocr || '').replace(/<[^>]+>/g, ' ');
  // prefer post-arrow transcription runs; else whole
  const arrows = t.split('->');
  if (arrows.length > 1) t = arrows.slice(1).join(' ');
  return t.replace(BOILER, ' ').replace(/\s+/g, ' ').trim();
}

function detect(text, excludeLangs = []) {
  if (text.length < 40) return { lang: null, score: 0, conf: 'none' };
  const scores = {};
  for (const [name, re] of SCRIPTS) {
    const n = (text.match(re) || []).length;
    if (n >= 8) scores[name] = n / text.length * 100; // script chars are decisive
  }
  // if a non-Latin script dominates, return it
  const scriptWinner = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  if (scriptWinner && scriptWinner[1] > 2) return { lang: scriptWinner[0], score: scriptWinner[1], conf: 'high' };
  // else Latin-script function words
  const fs = {};
  const words = (text.match(/\b[a-zà-ÿ]+\b/gi) || []).length || 1;
  for (const [name, re] of Object.entries(FUNC)) {
    if (excludeLangs.includes(name)) continue;
    fs[name] = (text.match(re) || []).length / words;
  }
  const ranked = Object.entries(fs).sort((a, b) => b[1] - a[1]);
  const [top, second] = ranked;
  if (!top || top[1] < 0.04) return { lang: null, score: top?.[1] || 0, conf: 'low' };
  const margin = top[1] - (second?.[1] || 0);
  const conf = top[1] > 0.09 && margin > 0.03 ? 'high' : margin > 0.015 ? 'medium' : 'low';
  return { lang: top[0], score: +top[1].toFixed(3), conf, runnerUp: second?.[0] };
}

async function main() {
  const nowIso = new Date().toISOString();
  const c = await MongoClient.connect(process.env.MONGODB_URI);
  const db = c.db('bookstore');
  const books = db.collection('books');
  const pages = db.collection('pages');

  let query;
  if (IDS_FILE) {
    const ids = readFileSync(IDS_FILE, 'utf8').trim().split('\n').map((s) => s.trim()).filter(Boolean);
    const or = ids.flatMap((id) => [{ id }, ...(/^[0-9a-f]{24}$/.test(id) ? [{ _id: new ObjectId(id) }] : [])]);
    query = { $or: or };
  } else if (PATTERN === 'latin-vernacular') {
    query = { language: /^latin/i, title: /\btradott|\btradui|\bvolgar|^l'|\bdelle\b|fatte volgari|übersetzt/i };
  } else if (PATTERN === 'greek-in-latin') {
    // Latin-tagged editions of Greek authors — often Greek texts wearing their
    // critical-edition's Latin apparatus label. Greek-script content is
    // unambiguous, so detection here is high-precision.
    query = { language: /^latin/i, visible: true, pages_count: { $gt: 0 }, title: /graece|graeca|aristotel|platon|homer|plutarch|galen|hippocrat|xenophon|thucydid|herodot|sophocl|euripid|demosthen|isocrat|epictet|plotin|proclus|porphyr|byzantin|gregorae|nicephor|photii|origen|chrysostom|eusebi|basili|nazianzen|dioscorid|ptolem|euclid|archimed|diophant|apolloni|strabo|pausan|athenae|synesi|philon/i };
  } else if (PATTERN === 'loeb') {
    query = { language: { $not: /^english/i }, title: /loeb|with an english translation|\(english\)|parallel (english|text)/i };
  } else { console.error('need --pattern latin-vernacular|loeb or --ids <file>'); process.exit(1); }

  const candidates = await books.find(query, { projection: { id: 1, title: 1, language: 1, original_language: 1, text_role: 1 } }).toArray();
  console.log(`${candidates.length} candidates`);
  const batch = LIMIT ? candidates.slice(0, LIMIT) : candidates;

  const excludeLangs = NO_ENGLISH_PATTERNS.has(PATTERN) ? ['English'] : [];
  const proposed = [], unclear = [], confirmed = [];
  for (const b of batch) {
    const realId = b.id || String(b._id);
    // Sample from deep in the book (page 12+) to skip library-stamp/ProQuest
    // front matter, and pull a wide window so real body text dominates.
    const pgs = await pages.find({ book_id: realId, page_number: { $gte: 12 } }, { projection: { 'ocr.data': 1 } }).sort({ page_number: 1 }).limit(50).toArray();
    const text = pgs.map((p) => transcription(p.ocr?.data)).filter((t) => t.length > 30).join(' ').slice(0, 8000);
    let d = detect(text, excludeLangs);
    // Fallback: when the page content is too noisy to read (short book, heavy
    // OCR image-descriptions), the TITLE is often decisive for this pool. Only
    // used to rescue an otherwise-unclear book, and only on a clear title signal.
    if ((!d.lang || d.conf === 'low' || d.conf === 'none')) {
      const td = detect((b.title || '') + ' ' + (b.title || ''), excludeLangs);
      if (td.lang && (td.conf === 'high' || td.conf === 'medium')) d = { ...td, conf: td.conf === 'high' ? 'medium' : 'low', fromTitle: true };
    }
    const stored = (b.language || '').trim();
    const changed = d.lang && d.conf !== 'none' && d.conf !== 'low' && !stored.toLowerCase().startsWith(d.lang.toLowerCase().slice(0, 4));
    const row = { book_id: realId, title: b.title, stored, detected: d.lang, conf: d.conf, score: d.score, runnerUp: d.runnerUp, text_role: b.text_role, sample: text.slice(0, 120) };
    if (changed) proposed.push(row);
    else if (!d.lang || d.conf === 'low') unclear.push(row);
    else confirmed.push(row);
  }

  console.log(`\n── ${proposed.length} PROPOSED retags | ${confirmed.length} confirmed-as-stored | ${unclear.length} unclear ──`);
  for (const r of proposed) console.log(`  [${r.stored} → ${r.detected} ${r.conf}] ${(r.title || '').slice(0, 46)}\n     "${r.sample}"`);
  if (unclear.length) console.log(`\n  (unclear, left alone: ${unclear.map((u) => (u.title || '').slice(0, 30)).join('; ')})`);

  if (BACKUP) { writeFileSync(BACKUP, JSON.stringify({ proposed, confirmed, unclear }, null, 2)); console.log(`\nreport → ${BACKUP}`); }

  if (!APPLY) { console.log(`\nDRY-RUN. ${proposed.length} would be retagged. Re-run --apply --backup <file>.`); await c.close(); return; }

  // backup originals then apply
  const backup = [];
  let wrote = 0;
  for (const r of proposed) {
    const or = [{ id: r.book_id }, ...(/^[0-9a-f]{24}$/.test(r.book_id) ? [{ _id: new ObjectId(r.book_id) }] : [])];
    const doc = await books.findOne({ $or: or }, { projection: { _id: 1, language: 1, original_language: 1 } });
    if (!doc) continue;
    backup.push({ _id: String(doc._id), book_id: r.book_id, was_language: doc.language });
    // Fix ONLY the text language (unambiguous from content). original_language is
    // NOT touched here: for these the source varies (Appian → Greek, Cicero →
    // Latin) and many are original vernacular works, not translations — so
    // deriving it needs per-work knowledge. Separate pass.
    await books.updateOne({ _id: doc._id }, { $set: { language: r.detected, 'field_provenance.language': { source: 'detect-language-mislabels', from: doc.language, to: r.detected, method: 'ocr-content-detection', applied_at: nowIso } } });
    wrote++;
  }
  const bfile = BACKUP ? BACKUP.replace(/\.json$/, '') + '-applied-backup.json' : `lang-retag-backup-${Date.now()}.json`;
  writeFileSync(bfile, JSON.stringify(backup, null, 2));
  console.log(`\nAPPLIED. Retagged ${wrote} books. Backup → ${bfile}`);
  await c.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
