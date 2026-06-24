#!/usr/bin/env node
/**
 * Bulk-flag truly-unevaluated Tibetan books with OCR as `is_first_translation: true`,
 * EXCLUDING (a) Kanjur volumes and (b) titles that match well-known previously-translated works.
 *
 * Rationale: ~1,000 Bhutanese woodblock recensions in the IIIF source have never been
 * translated to English. Manual catalog search via Open Library / Google Books / IA returns
 * zero hits because Wylie transliteration doesn't index in those catalogs. A title-substring
 * probe across ~100 well-known translated works lets us identify the ~15% that ARE at risk
 * of being prior-translated and leave them for individual review.
 *
 * Usage:
 *   node scripts/maintenance/bulk-flag-tibetan-ft.mjs              # dry-run (default)
 *   node scripts/maintenance/bulk-flag-tibetan-ft.mjs --apply      # actually write
 *   node scripts/maintenance/bulk-flag-tibetan-ft.mjs --apply --limit 100   # cap writes
 */

import { MongoClient } from 'mongodb';
import fs from 'fs';

function loadEnv() {
  const env = {};
  try {
    const content = fs.readFileSync('.env.production.local', 'utf8');
    for (const line of content.split('\n')) {
      const m = line.match(/^([^=#]+)=(.*)$/);
      if (m) {
        let v = m[2].trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        env[m[1].trim()] = v;
      }
    }
  } catch {}
  return { ...process.env, ...env };
}

const env = loadEnv();
const MONGODB_URI = env.MONGODB_URI;
const MONGODB_DB = env.MONGODB_DB || 'bookstore';

// ── Kanjur — canonical scriptures, separate category ────────────────
const KANJUR_RX = [
  { title: { $regex: 'kanjur', $options: 'i' } },
  { title: { $regex: 'kangyur', $options: 'i' } },
  { title: { $regex: 'kah-?gyur', $options: 'i' } },
  { title: { $regex: "bka\\' \\'gyur", $options: 'i' } },
  { title: { $regex: 'thadrak', $options: 'i' } },
];

// ── Well-known translated Tibetan works (cumulative across probe rounds 1-4 + leak fixes) ──
const TRANSLATED_WORK_PATTERNS = [
  // Bardo Thodol cycle (Evans-Wentz, Fremantle/Trungpa, Coleman/Jinpa)
  "bardo tho?s grol", "zhi khro", "bar do thos grol",
  // Milarepa (Garma Chang, Lhalungpa, Quintman)
  "mi la ras pa", "milarepa", "mgur \\'bum",
  // Shantideva Bodhicaryavatara (Padmakara, Crosby/Skilton, Wallace, Batchelor)
  "byang chub sems dpa\\'i spyod pa", "spyod \\'jug", "shantideva", "zhi ba lha", "bodhicaryavatara",
  // Longchenpa Trilogy of Rest (Padmakara)
  "ngal gso skor gsum", "sems nyid ngal gso",
  // Longchen Nyingthig liturgies (Lotsawa House, Rigpa)
  "klong chen snying thig",
  // Hevajra (Snellgrove, Khenpo Migmar)
  "kye\\'i rdo rje rgyud", "hevajra",
  // Kalachakra (Wallace)
  "dus \\'khor", "kalachakra", "kalacakra",
  // Medical tantras (multiple partial)
  "rgyud bzhi", "four medical tantras", "four tantras",
  // Madhyamakavatara (Padmakara)
  "dbu ma la \\'jug pa", "madhyamakavatara", "entering the middle way", "madhyamaka commentary",
  // Drukpa Künleg (Dowman 1980)
  "kun dga\\' legs", "kunley", "drukpa kunleg", "drukpa kunley", "divine madman",
  // Pema Karpo
  "padma dkar po", "pema karpo",
  // Zhabdrung
  "zhabs drung", "ngag dbang rnam rgyal", "zhabdrung",
  // Padmasambhava biographies
  "padma bka\\' thang", "pad ma bka\\'i thang", "padmasambhava",
  // Yeshe Tsogyal (Lady of the Lotus-Born)
  "ye shes mtsho rgyal", "mtsho rgyal.*rnam thar", "yeshe tsogyal", "lotus-born",
  // Tara
  "sgrol ma", "tara.*praise", "twenty.one tara",
  // Mipham — Gateway / Beacon / collected
  "mkhas pa\\'i tshul la \\'jug pa\\'i sgo", "mkhas \\'jug", "gateway for the learned", "gateway to knowledge",
  "nges shes sgron me", "beacon of certainty",
  "mi pham", "mipham",
  // Mahamudra (multiple)
  "phyag rgya chen po", "phyag chen", "mahamudra",
  // Naropa biography & Six Yogas
  "nA ro pa", "naropa", "nA ro\\'i chos drug", "chos drug", "six yogas",
  // Cakrasamvara (Gray)
  "\\'khor lo sdom pa", "bde mchog", "cakrasamvara",
  // Vajrayogini (Tsongkhapa via GFI)
  "rdo rje rnal \\'byor ma", "vajrayogini",
  // Vajrakilaya (Boord, Mayer)
  "rdo rje phur ba", "phur pa", "vajrakilaya", "kilaya",
  // Phowa (Trungpa, Drikung)
  "\\'pho ba", "phowa",
  // Dorje Lingpa / Pema Lingpa termas
  "rdo rje gling pa", "padma gling pa", "pema lingpa",
  // Atisha
  "jo bo rje dpal ldan a ti sha", "atisha", "bodhipathapradipa",
  // Avalokiteshvara
  "spyan ras gzigs", "thugs rje chen po", "avalokiteshvara", "chenrezig",
  "yi ge drug pa", "mani kabum", "om mani padme",
  // Manjushri
  "jam dpal mtshan brjod", "mtshan yang dag par brjod", "manjushri.*nama",
  // Vajrasattva
  "rdo rje sems dpa", "vajrasattva",
  // King of Aspirations
  "bzang po spyod pa\\'i smon lam", "samantabhadra.*pranidhana",
  // Heart Sutra & commentaries
  "shes rab snying po", "heart sutra", "sher snying",
  // Drikung Single Intent
  "dgongs gcig", "single intent", "jigten sumgon", "jigten sumgön",
  // Marpa
  "mar pa.*rnam thar", "marpa",
  // Sera Khandro
  "sera khandro",
  // Dilgo Khyentse
  "dil mgo mkhyen brtse", "dilgo khyentse",
  // Bhutanese saints with translations
  "bstan \\'dzin rab rgyas", "tenzin rabgye",
  "rgyal dbang \\'brug", "gyalwang drukpa",
  // Khyentse Wangpo / Kongtrul
  "jam dbyangs mkhyen brtse", "khyentse wangpo",
  "kong sprul", "kongtrul",
  // Yang Tik (Khandro/Lama Yangtik — Longchenpa)
  "yang tig", "yangtik",
  // Tsangnyon Heruka
  "gtsang smyon he ru ka", "tsangnyon",
  // Hayagriva
  "rta mgrin", "hayagriva",
  // Pith Instructions (Longchen)
  "klong chen pa\\'i man ngag", "man ngag mdzod",
  // Bhutan history
  "lho.*chos \\'byung",
  // Yamantaka
  "gshin rje gshed", "yamantaka", "vajrabhairava",
  // Guhyagarbha
  "gsang ba snying po", "guhyagarbha",
  // Kanjur sections (will mostly be caught by Kanjur exclusion, but English titles can leak)
  "phal chen", "avatamsaka", "phal po che", "flower ornament",
  "dkon brtsegs", "ratnakuta", "heap of jewels",
  "brgyad stong", "shes rab khri pa", "sher phyin", "ashtasahasrika", "prajnaparamita",
  "dam pa\\'i chos pad ma dkar po", "lotus sutra", "saddharmapundarika",
  "lang kar gshegs pa", "lankavatara",
  "rdo rje gcod pa", "vajracchedika", "diamond sutra",
  "dri ma med par grags pa", "vimalakirti",
  "rgya cher rol pa", "lalitavistara",
  "za ma tog bkod pa", "karandavyuha",
  "mdzangs blun", "sutra of the wise.*foolish",
  "bskal pa bzang po", "bhadrakalpika", "fortunate aeon",
  // 37 Practices (Thogme Zangpo)
  "rgyal sras lag len", "so bdun ma", "thogs med bzang po", "37 practices",
  // Sakya
  "zhen pa bzhi bral", "parting.*four attachment",
  "lam \\'bras", "lamdre",
  "sa skya legs bshad", "subhashitaratnanidhi", "treasury of good sayings",
  "go rams pa", "gorampa",
  // Mahakala
  "mgon po", "mahakala", "ye shes mgon po", "bernag chen",
  // Medicine Buddha
  "sangs rgyas sman bla", "sman bla", "medicine buddha",
  // White Tara / Amitayus
  "sgrol dkar", "white tara",
  "tshe dpag med", "amitayus",
  // Karmapas
  "rang byung rdo rje",
  "mi bskyod rdo rje",
  // Padampa Sangye / Zhi byed
  "pha dam pa", "padampa", "zhi byed",
  // Machig Labdron / Chöd
  "ma gcig lab sgron", "machig labdron", "gcod", "chöd",
  // Shabkar
  "zhabs dkar", "shabkar",
  // Saraha
  "do ha skor gsum", "sa ra ha.*do ha", "royal song.*saraha", "doha trilogy",
  // Tibetan grammar
  "sum cu pa", "rtags \\'jug", "thonmi sambhota",
  // Karma Lingpa
  "kar gling", "karma gling pa",
  // Ratna Lingpa
  "ratna gling pa", "rin chen gter mdzod", "rinchen terdzo",
  // Dudjom Tröma
  "khros ma nag mo", "tröma nagmo",
  // Karma Chagme — Pure Land
  "karma chags med", "bde smon",
  // Heart Essence broadly
  "snying thig", "nyingthig", "heart essence",
  // Niguma / Sukhasiddhi / Shangpa
  "ni gu ma", "niguma", "sukhasiddhi", "shangs pa",
  // Yang Dag
  "yang dag", "vishuddha heruka",
  // Drikung fivefold
  "lnga ldan",
  // Vaidurya (Tibetan medicine)
  "vai DUrya", "blue beryl",
  // Pema Lingpa / Terdag Lingpa
  "gter bdag",
  // Khyentse Chökyi Lodrö
  "chos kyi blo gros", "khyentse chökyi",
  // Seventeen Tantras of Dzogchen
  "rdzogs chen.*rgyud", "seventeen tantras",
  // Saraha doha commentaries (catches "Do ha'i bshad lugs sogs")
  "do ha",
  // Nyingma rgyud 'bum
  "rnying rgyud", "rnying ma rgyud \\'bum", "nyingma.*rgyud",
  // Dzam gling rgyas bshad / Tibetan World Geography (Wylie 1962)
  "\\'dzam gling rgyas bshad", "dzam.*gling.*rgyas", "tibetan world geography",
  // Gesar Epic (Alexandra David-Néel, Penick, Kornman, Stein)
  "gesar", "ge sar", "gling g\\.?yul", "hor gling", "gling rje",
  // Prajnaparamita 100k ('bum) — Conze, 84000
  "^bum\\b", "\\bbum ka\\b", "\\bbum kha\\b", "shes phyin.*\\'bum", "satasahasrika",
  // Tibetan astrology (some compendia translated, e.g. Cornu)
  "nag rtsis", "nag-rtsis", "tibetan astrology",
  // Tibetan medical (Sangye Gyatso, drang srong school — some translated)
  "drang srong", "sangs rgyas rgya mtsho",
  // Longchenpa — Wish-Fulfilling Treasury / Yid bzhin mdzod (Padmakara 2024)
  "yid bzhin.*mdzod", "yid bzhin rin po che", "wish.?fulfilling treasury", "yid bzhin nor bu",
  // Jataka / birth stories (Cowell, Khoroche, multiple)
  "skyes rabs", "\\'khrung rabs", "jataka",
  // Sakya gser chos (Golden Dharmas) — Snow Lion has some
  "gser chos", "golden dharmas", "lam \\'bras gser chos",
  // Rigdzin Gödem / Northern Treasures (some translations)
  "rgod ldem", "rgod-ldem", "rig \\'dzin rgod", "northern treasures", "byang gter",
  // Tales from the Kanjur (Schiefner/Ralston 1882)
  "tales from the", "tibetan tales",
  // Sutra of Golden Light / Suvarnaprabhasa (multiple)
  "gser \\'od dam pa", "suvarnaprabhasa", "golden light",
  // Surangama Sutra (Luk, Hsuan Hua)
  "surangama", "leng yan",
  // Tilopa Mahamudra Upadesha (multiple)
  "phyag chen gangga ma", "mahamudra upadesha",
];

const TRANSLATED_OR = TRANSLATED_WORK_PATTERNS.flatMap(p => [
  { title: { $regex: p, $options: 'i' } },
  { normalized_title: { $regex: p, $options: 'i' } },
]);

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--apply');
  const limit = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1]) : null;

  console.log('=== Bulk-flag Tibetan books as is_first_translation: true ===');
  console.log('Mode:', dryRun ? 'DRY RUN' : 'APPLYING');
  if (limit) console.log('Cap:', limit, 'writes');
  console.log();

  const client = new MongoClient(MONGODB_URI, { maxPoolSize: 3, serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db(MONGODB_DB);

  const baseQ = {
    hidden: { $ne: true },
    pages_ocr: { $gt: 0 },
    language: 'Tibetan',
    is_first_translation: { $exists: false },
  };

  const kanjurQ = { ...baseQ, $or: KANJUR_RX };
  const matchQ = { ...baseQ, $and: [{ $nor: KANJUR_RX }, { $or: TRANSLATED_OR }] };
  const cleanQ = { ...baseQ, $and: [{ $nor: KANJUR_RX }, { $nor: TRANSLATED_OR }] };

  const universe = await db.collection('books').countDocuments(baseQ);
  const kanjurN = await db.collection('books').countDocuments(kanjurQ);
  const matchN = await db.collection('books').countDocuments(matchQ);
  const cleanN = await db.collection('books').countDocuments(cleanQ);

  console.log('=== BUCKETS ===');
  console.log(`  Universe:                          ${universe}`);
  console.log(`  A) Kanjur (SKIP, no flag):        ${kanjurN}`);
  console.log(`  B) Match translated (REVIEW):     ${matchN}`);
  console.log(`  C) Clean (FLAG as is_first=true): ${cleanN}`);
  console.log(`  Sum check: ${kanjurN + matchN + cleanN} === ${universe}`,
    (kanjurN + matchN + cleanN) === universe ? 'OK' : 'MISMATCH');
  console.log();

  // Sample previews
  const samples = await db.collection('books').find(cleanQ).sort({ pages_ocr: -1 }).limit(10).project({ title: 1, pages_ocr: 1 }).toArray();
  console.log('=== BUCKET C SAMPLE (largest first, this is what will be flagged) ===');
  samples.forEach(s => console.log(`  - ${s.title.slice(0, 95)}  [${s.pages_ocr}p]`));
  console.log();

  if (dryRun) {
    console.log('Dry-run complete. To apply, re-run with --apply.');
    await client.close();
    return;
  }

  // Apply: update bucket C
  const now = new Date();
  const verification = {
    has_english_translation: false,
    translations: [],
    confidence: 'medium',
    reasoning: 'Bulk-flagged: OCR\'d Tibetan book from Bhutan/BPH collection, NOT a Kanjur volume, NOT matching any well-known previously-translated work via title-substring probe (across ~100 patterns covering Bardo Thodol, Milarepa, Shantideva, Mahamudra, Vajrakilaya, Cakrasamvara, Pema Lingpa, Mahakala, Chöd, Padampa Sangye, etc.). This specific Bhutanese recension is assumed first English translation; underlying canonical material may have prior partial translations.',
    source: 'bulk_assumption',
    method: 'tibetan_no_known_translation_match',
    verified_at: now,
    search_evidence: {
      method: 'title_substring_probe',
      probe_pattern_count: TRANSLATED_WORK_PATTERNS.length,
      kanjur_excluded: true,
    },
  };

  const provenance = {
    is_first_translation: {
      source: 'bulk_assumption',
      method: 'tibetan_no_known_translation_match',
      date: now,
      confidence: 'medium',
      script: 'bulk-flag-tibetan-ft.mjs',
    },
  };

  let processed = 0;
  const cursor = db.collection('books').find(cleanQ).project({ _id: 1, id: 1, title: 1, field_provenance: 1 });

  for await (const book of cursor) {
    if (limit && processed >= limit) break;

    const update = {
      $set: {
        is_first_translation: true,
        translation_verification: verification,
        updated_at: now,
        ...Object.fromEntries(Object.entries(provenance).map(([k, v]) => [`field_provenance.${k}`, v])),
      },
    };

    const res = await db.collection('books').updateOne({ _id: book._id }, update);
    if (res.modifiedCount !== 1) {
      console.warn(`  WARN: book ${book.id} not modified (modifiedCount=${res.modifiedCount})`);
    }
    processed++;
    if (processed % 50 === 0) {
      console.log(`  [${processed}/${cleanN}] flagged...`);
    }
  }

  console.log();
  console.log(`Done. Flagged ${processed} books as is_first_translation: true.`);
  await client.close();
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
