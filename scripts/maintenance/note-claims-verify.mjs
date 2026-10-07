#!/usr/bin/env node
/**
 * PRIOR ART: scripts/eval/ft-gemini-adjudicate.mjs — the grounded flash-preview pattern
 * (googleSearch, positive thinking budget, grounding-budget meter), but per BOOK, realtime,
 * and for first-translation priors; it writes no claim rows and plants no seeds.
 * scripts/maintenance/note-claims-match.mjs — stage 2 over the same `note_claims` rows; $0,
 * no model. scripts/eval/results/note-facts-full-2026-10-02-5624/ — the #5624 subagent sweep
 * whose verdict taxonomy and seeded-false-claim design this reuses (its 16 seeds are NOT
 * reused: every batch here gets a fresh one).
 *
 * Translation-note fact-check lane, stage 3 (#5647): grounded model verification of the
 * candidate notes the $0 reference table could not settle (`match.status: no-entry`, minus
 * the bare mantra/dharani descriptions), plus the #5624-judged notes as a calibration set.
 *
 *   model     gemini-3-flash-preview + googleSearch, thinkingBudget 512 (flash-lite does not
 *             ground; -1 suppresses grounding — measurement-instruments.md)
 *   lane      Batch API (probed 2026-10-03: an inline batch request with google_search returns
 *             groundingMetadata), submitted in WAVES so each wave is priced before the next
 *             one is sent (spend-controls.md failure mode 4: a batch is unpriced in flight)
 *   batches   20 claims + 1 fresh seeded FALSE claim, shuffled, opaque ids
 *   verdicts  correct / wrong / partly-wrong / unverifiable; a verdict without a source URL is
 *             recorded as unverifiable (`url_missing`) — unverifiable is never correct
 *   spend     every row on book_id `note-factcheck-5647` (the envelope of the same name meters
 *             exactly this job), tokens via logUsage (mode batch), searches via
 *             grounding-budget `record` ($0.014/query). Before each wave: measured envelope
 *             spend + this wave's worst case must stay under --stop-usd (default 30).
 *
 * Writes: the state dir (plan, raw responses) always; `note_claims.verify` only with --write.
 * It writes NO note text — repair is scripts/maintenance/fix-note-facts-5647.mjs, by hand.
 *
 * Usage (Hetzner):
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/maintenance/note-claims-verify.mjs plan
 *   … run  [--wave 8] [--max-waves N] [--stop-usd 30]
 *   … report [--write]     # verdicts → results JSON (and note_claims.verify with --write)
 */
import fs from 'node:fs';
import path from 'node:path';
import { getScriptClient } from '../lib/mongo.mjs';
import { indexTable, sktSame, sktKey, wylieKey, noteAnchor, pageNotes, translationHash } from '../lib/note-claims.mjs';
import { openGroundingBudget } from '../lib/grounding-budget.mjs';
import { logUsage, outputTokensFrom } from '../workers/lib/supabase-usage-logger.mjs';
import { getScopeSpendUsd } from '../lib/spend-guard.mjs';
import { searchCostOf } from '../lib/model-pricing.mjs';

const arg = (k, d) => (process.argv.includes(`--${k}`) ? process.argv[process.argv.indexOf(`--${k}`) + 1] : d);
const CMD = process.argv[2];
const STATE = arg('state', '/root/factcheck-lane/stage3');
const TABLE = arg('table', '/root/factcheck-lane/refs/tib-skt-table.jsonl');
const VALIDATION = 'scripts/eval/results/note-claims-5647/validation.json';
const ENVELOPE = 'note-factcheck-5647';
const ENDPOINT = 'scripts/maintenance/note-claims-verify.mjs';
const MODEL = 'gemini-3-flash-preview';
const PER_REQUEST = 20;
const VERIFIER = { name: 'note-claims-verify', version: 1, model: MODEL, thinking_budget: 512, lane: 'batch' };
// A request's search queries are unbounded by the API; this is the stop rule. At 3/claim the
// run would cost ~2x the central estimate — a wave that averages above it ends the run.
const MAX_QUERIES_PER_CLAIM = 3;
const WORST_CASE_QUERIES_PER_REQUEST = 70; // pre-wave reservation, ~$0.98 per request
const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const BATCH_KEY = process.env.GEMINI_API_KEY_TIER3 || process.env.GEMINI_API_KEY_2 || process.env.GEMINI_API_KEY;
fs.mkdirSync(path.join(STATE, 'responses'), { recursive: true });

// ---------------------------------------------------------------------------------------------
// Seeds: false claims written in the shape of the real notes. Each is used at most once.
// [note, anchor, truth]
const HAND_SEEDS = [
  ['Atiśa Dīpaṃkara Śrījñāna (982–1054), the Bengali master who founded the Sakya school', 'when the master Atiśa came to Tibet', 'Sakya was founded by Khön Könchok Gyalpo (1073); Atiśa’s line is the Kadam'],
  ['Milarepa, the poet-yogi who was the root teacher of Marpa the Translator', 'as the yogi Milarepa sang', 'Marpa was Milarepa’s teacher'],
  ['Gampopa, the 15th-century founder of the Gelug school', 'the physician of Dagpo, Gampopa', 'Gampopa (1079–1153), Kagyu; Gelug founded by Tsongkhapa'],
  ['Longchenpa (1308–1364), the great systematizer of the Kagyu Mahāmudrā tradition', 'as the omniscient Longchenpa explained', 'Longchenpa systematized Nyingma Dzogchen'],
  ['Śāntarakṣita, the Indian abbot invited to Tibet by King Ralpachen to ordain the first monks', 'the abbot Bodhisattva (Zhi ba ’tsho)', 'invited by Trisong Detsen'],
  ['Vasubandhu, the brother of Nāgārjuna and co-founder of the Madhyamaka school', 'the master dByig gnyen', 'Vasubandhu was Asaṅga’s half-brother, Yogācāra'],
  ['Sukhāvatī, the pure land of the buddha Akṣobhya in the east', 'to be reborn in the realm of Sukhāvatī', 'Sukhāvatī is Amitābha’s western pure land'],
  ['Tibetan: sangs rgyas sman bla; Sanskrit: Amitāyus', 'homage to the Medicine Buddha', 'sman bla = Bhaiṣajyaguru'],
  ['Tibetan: sgrol ma; Sanskrit: Prajñāpāramitā', 'praise to the noble Drolma', 'sgrol ma = Tārā'],
  ['Tibetan: ’jam dpal dbyangs; Sanskrit: Avalokiteśvara', 'homage to Jampelyang', '’jam dpal dbyangs = Mañjughoṣa'],
  ['Tibetan: byams pa; Sanskrit: Kṣitigarbha, the future buddha', 'the regent Jampa', 'byams pa = Maitreya'],
  ['Tibetan: phyag na rdo rje; Sanskrit: Vajrasattva', 'the Lord of Secrets, Chakna Dorje', 'phyag na rdo rje = Vajrapāṇi'],
  ['Tibetan: klu sgrub; Sanskrit: Āryadeva', 'as the protector Lu drup taught', 'klu sgrub = Nāgārjuna'],
  ['Tibetan: thogs med; Sanskrit: Vasubandhu', 'the noble Thokme', 'thogs med = Asaṅga'],
  ['Tibetan: zhi ba lha; Sanskrit: Śāntarakṣita', 'as Zhiwa Lha wrote', 'zhi ba lha = Śāntideva'],
  ['Tibetan: chos kyi grags pa; Sanskrit: Dignāga', 'the logician Chökyi Drakpa', 'chos kyi grags pa = Dharmakīrti'],
  ['Tibetan: zla ba grags pa; Sanskrit: Buddhapālita', 'the master Dawa Drakpa', 'zla ba grags pa = Candrakīrti'],
  ['The Bodhicaryāvatāra, composed by Nāgārjuna in the 2nd century', 'the Guide to the Bodhisattva’s Way of Life', 'Śāntideva, 8th century'],
  ['The Abhidharmakośa, the treatise composed by Asaṅga', 'the Treasury of Abhidharma', 'Vasubandhu'],
  ['The Bardo Thödol, revealed as a treasure by Pema Lingpa', 'Liberation through Hearing in the Bardo', 'revealed by Karma Lingpa'],
  ['Songtsen Gampo, the 9th-century king who persecuted Buddhism in Tibet', 'in the time of King Songtsen', '7th century; Langdarma persecuted'],
  ['Ganden Monastery, founded by the Fifth Dalai Lama in 1642', 'at Ganden Namgyal Ling', 'founded by Tsongkhapa, 1409'],
  ['Tashilhunpo, the seat of the Karmapas in Shigatse', 'arrived at Tashilhunpo', 'seat of the Panchen Lamas; founded by Gendun Drup'],
  ['Tsurphu, the principal monastery of the Sakya school', 'the great seat of Tsurphu', 'seat of the Karmapas, Karma Kagyu'],
  ['Rāhula, the Buddha’s father, king of the Śākyas', 'the prince Rāhula', 'Rāhula was the Buddha’s son'],
  ['Mahāprajāpatī Gautamī, the Buddha’s wife and the mother of Rāhula', 'Gautamī requested ordination', 'aunt and foster mother; wife was Yaśodharā'],
  ['Śāriputra, the disciple foremost in miraculous powers', 'the elder Śāriputra said', 'foremost in wisdom; Maudgalyāyana in powers'],
  ['Bodhgayā, where the Buddha delivered his first sermon', 'at the Vajra Seat', 'first sermon at Sarnath; Bodhgayā is the awakening'],
  ['Lumbinī, the place where the Buddha passed into parinirvāṇa', 'in the grove of Lumbinī', 'birthplace; parinirvāṇa at Kuśinagara'],
  ['Devadatta, the Buddha’s attendant who memorized all his discourses', 'Devadatta then', 'that is Ānanda'],
  ['Rinchen Zangpo (958–1055), the great translator who founded Samye monastery', 'the great translator Rinchen Zangpo', 'Samye founded c. 779 under Trisong Detsen'],
  ['Jamgön Kongtrul (1813–1899), the compiler of the first Tibetan Kangyur', 'as Jamgön Kongtrul compiled', 'compiled the Five Treasuries; Kangyur compiled 14th c. (Bu ston and others)'],
  ['The Fifth Dalai Lama, Ngawang Lobsang Gyatso, who built the Potala Palace in the 12th century', 'the Great Fifth', '17th century (from 1645)'],
  ['Tilopa, the principal disciple of Nāropa', 'the siddha Tilopa', 'Nāropa was Tilopa’s disciple'],
  ['Kumārajīva, the translator who rendered the sūtras into Tibetan', 'as translated by Kumārajīva', 'Kumārajīva translated into Chinese'],
  ['Yamāntaka, the wrathful form of Avalokiteśvara', 'the conqueror of death, Yamāntaka', 'wrathful form of Mañjuśrī'],
  ['Mount Kailash, the sacred mountain in central Bhutan', 'around the snow mountain Tise', 'Kailash is in western Tibet (Ngari)'],
  ['Nālandā, the great monastic university in Kashmir', 'the great vihāra of Nālandā', 'Nālandā was in Bihar (Magadha)'],
  ['Tibetan: rnam par snang mdzad; Sanskrit: Amoghasiddhi', 'Nampar Nangdzé at the centre', 'rnam par snang mdzad = Vairocana'],
  ['Tibetan: rin chen ’byung ldan; Sanskrit: Akṣobhya', 'Rinchen Jungden in the south', 'rin chen ’byung ldan = Ratnasambhava'],
  ['Tibetan: mi bskyod pa; Sanskrit: Amitābha', 'the buddha Mikyöpa', 'mi bskyod pa = Akṣobhya'],
  ['Tibetan: sa’i snying po; Sanskrit: Ākāśagarbha', 'the bodhisattva Sayi Nyingpo', 'sa’i snying po = Kṣitigarbha'],
  ['Tibetan: kun tu bzang po; Sanskrit: Vajradhara', 'the primordial buddha Küntu Zangpo', 'kun tu bzang po = Samantabhadra'],
  ['Tibetan: gshin rje; Sanskrit: Mahākāla', 'the Lord of Death, Shinje', 'gshin rje = Yama'],
  ['Tibetan: dkon mchog gsum; Sanskrit: pañcaśīla', 'taking refuge in the Könchok Sum', 'dkon mchog gsum = triratna, the Three Jewels'],
  ['Tibetan: ’khor lo sgyur ba; Sanskrit: dharmapāla, a protector deity', 'like a khorlo gyurwa', '’khor lo sgyur ba = cakravartin, wheel-turning king'],
  ['Tibetan: dge slong; Sanskrit: upāsaka, a lay follower', 'the gelong said', 'dge slong = bhikṣu, a fully ordained monk'],
  ['Langdarma, the king who invited Padmasambhava to Tibet', 'in the reign of Langdarma', 'Trisong Detsen invited Padmasambhava; Langdarma persecuted Buddhism'],
  ['Marpa Lotsawa (1012–1097), the founder of the Nyingma school', 'Marpa the Translator', 'Marpa is the Kagyu forefather; Nyingma traces to Padmasambhava'],
  ['Dromtön Gyalwai Jungné, the founder of Sakya Monastery in 1073', 'the layman Dromtön', 'founded Reting (1056), the Kadam seat'],
];

function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const rand = mulberry32(5647);
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const rid = () => Math.floor(rand() * 0xffffff).toString(16).padStart(6, '0');

/** Swap the Sanskrit a table-matched note asserts for another matched note's Sanskrit that the table does NOT give for this Tibetan. */
function tableSeeds(matched, table) {
  const out = [];
  const pool = matched.filter((r) => r.claim?.wylie && r.claim?.sanskrit_groups?.[0]?.[0]);
  for (const r of pool) {
    const from = r.claim.sanskrit_groups[0][0];
    if (!r.note.includes(from)) continue;
    const allowed = (table.byW.get(wylieKey(r.claim.wylie)) || []).map((t) => t.skt);
    const donors = shuffle(pool.filter((d) => d !== r));
    const donor = donors.find((d) => {
      const to = d.claim.sanskrit_groups[0][0];
      return sktKey(to).length >= 5 && !sktSame(to, from) && !allowed.some((a) => sktSame(a, to));
    });
    if (!donor) continue;
    const to = donor.claim.sanskrit_groups[0][0];
    out.push({ note: r.note.replace(from, to), anchor: r.anchor || '', title_from: r.book_id, truth: `${r.claim.wylie} = ${from} (84000/Mahāvyutpatti table); seeded with ${to}`, source_row: r._id });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// v1 (r000–r018 as first sent) said only "Do at most 2 searches per item"; half its answers ran no search at all.
const PROMPT_VERSION = 'v2';
const PROMPT_HEAD = `You are fact-checking translator's notes. Each note was added by a machine translator to an English translation of a historical text (mostly Tibetan Buddhist canonical and commentarial works). For each item you get the book title, the passage the note glosses, and the note.

Check the factual claims each note makes — identifications of people, deities, places and texts; Sanskrit or Tibetan equivalents of a term or name; dates; authorship and attribution; relations (teacher, disciple, father, founder). Use Google Search. Prefer authoritative sources: 84000.co (translations and glossaries), Treasury of Lives (treasuryoflives.org), BDRC (library.bdrc.io), Rangjung Yeshe Wiki, Rigpa Wiki, Lotsawa House, Himalayan Art Resources, the Digital Dictionary of Buddhism, Wisdom Library, Encyclopaedia Britannica, Wikipedia. Search before you answer: run at least one Google Search for every item that makes a checkable claim, and at most 2 per item; an answer you did not search for is not accepted. No search for an item with no checkable fact.

Verdict for each item:
- "correct": every checkable claim in the note is supported by a source you found.
- "wrong": the note's main claim is contradicted by a source (the wrong person, the wrong Sanskrit, the wrong founder, the wrong date, the wrong relation).
- "partly-wrong": one claim is right and another is wrong, or one of the alternatives it offers ("X or Y") is wrong, or it is materially imprecise.
- "unverifiable": you could not find a source that settles it either way, or the note makes no checkable factual claim (set "no_checkable_fact": true). Never answer "correct" without a source that supports the claim.
Judge a hedged note ("likely", "possibly") on what it asserts as likely. Judge the note against what the sources say, not against the passage: the translation itself may be wrong.

For every item give "source_url": the URL of the page that settles the verdict (for "unverifiable", the best page you consulted, or ""). For "wrong" and "partly-wrong", give "correction": the fact as the source states it, in a few words, and "evidence": what the source says, quoted or closely paraphrased, under 40 words.

Answer with ONLY a JSON array, one object per item, in item order:
[{"id": "...", "verdict": "correct|wrong|partly-wrong|unverifiable", "checked_claim": "the claim you checked, under 20 words", "correction": "", "source_url": "", "evidence": "", "no_checkable_fact": false}]

Items:
`;

function promptFor(items) {
  return PROMPT_HEAD + items.map((it) => JSON.stringify({ id: it.qid, book: it.title, passage: it.anchor || '', note: it.note })).join('\n');
}

// ---------------------------------------------------------------------------------------------
async function plan() {
  const planFile = path.join(STATE, 'plan.json');
  if (fs.existsSync(planFile)) throw new Error(`${planFile} exists — the plan is frozen once made (delete it deliberately to re-plan)`);
  const table = indexTable(fs.readFileSync(TABLE, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)));
  const { client, db } = await getScriptClient({ noTimeout: true, socketTimeoutMs: 120_000 });
  const coll = db.collection('note_claims');
  const rows = await coll.find({ source_tag: 'note', 'match.status': 'no-entry', claim_kind: { $ne: 'description' } }).sort({ book_id: 1, page_number: 1, note_index: 1 }).toArray();
  const matched = await coll.find({ source_tag: 'note', 'match.status': 'match', claim_kind: 'sanskrit-equivalent' }).sort({ _id: 1 }).toArray();

  // Stale rows (page retranslated since extraction) are not verified: their note may be gone.
  const pages = new Map();
  for (let i = 0; i < rows.length; i += 300) {
    for (const p of await db.collection('pages').find({ id: { $in: rows.slice(i, i + 300).map((r) => r.page_id) } }, { projection: { id: 1, 'translation.data': 1, 'translation.content_hash': 1 } }).toArray()) pages.set(p.id, p);
  }
  const main = [];
  let stale = 0;
  for (const r of rows) {
    const p = pages.get(r.page_id);
    if (!p || translationHash(p.translation) !== r.translation_hash) { stale++; continue; }
    main.push({ key: r._id, set: 'main', book_id: r.book_id, page: r.page_number, page_id: r.page_id, note: r.note, anchor: r.anchor || '', claim_kind: r.claim_kind, translation_hash: r.translation_hash });
  }

  // Calibration: the #5624-judged notes that stage 2 left no-entry, AS JUDGED (18 have been
  // corrected since). A note whose text is identical to a main row on the same page shares
  // that row's verdict — the same verifier, asked once.
  const val = JSON.parse(fs.readFileSync(VALIDATION, 'utf8')).rows.filter((r) => r.status === 'no-entry');
  const mainBy = new Map(main.map((m) => [`${m.book_id}|${m.page}|${m.note}`, m]));
  const calib = [];
  let shared = 0;
  for (const v of val) {
    const m = mainBy.get(`${v.book_id}|${v.page}|${v.note}`);
    if (m) { m.calib_nid = v.nid; shared++; continue; }
    calib.push({ key: `calib:${v.nid}`, set: 'calib', nid: v.nid, book_id: v.book_id, page: v.page, note: v.note, anchor: '', claim_kind: v.claim_kind });
  }
  // Anchor for calibration notes: the running text before the note, where it still stands verbatim.
  for (const c of calib) {
    const p = await db.collection('pages').findOne({ book_id: c.book_id, page_number: c.page }, { projection: { 'translation.data': 1 } });
    const text = p?.translation?.data || '';
    const hit = pageNotes(text).find((n) => n.note === c.note);
    if (hit) c.anchor = noteAnchor(text, hit.offset);
  }

  const all = [...main, ...calib];
  const bookIds = [...new Set(all.map((x) => x.book_id))];
  const titles = new Map((await db.collection('books').find({ id: { $in: bookIds } }, { projection: { id: 1, title: 1, english_title: 1, display_title: 1 } }).toArray())
    .map((b) => [b.id, b.english_title || b.display_title || b.title || '']));
  for (const x of all) x.title = titles.get(x.book_id) || '';

  // Batches of 20 real claims, contiguous by page (the model sees a book's notes together),
  // each with one fresh seed at a random position.
  const tSeeds = shuffle(tableSeeds(matched, table));
  const hSeeds = shuffle(HAND_SEEDS.map(([note, anchor, truth]) => ({ note, anchor, truth, kind: 'hand' })));
  const requests = [];
  for (let i = 0; i < all.length; i += PER_REQUEST) {
    const real = all.slice(i, i + PER_REQUEST);
    const n = requests.length;
    const s = (n % 3 === 2 && tSeeds.length) ? { ...tSeeds.shift(), kind: 'table' } : (hSeeds.shift() || { ...tSeeds.shift(), kind: 'table' });
    if (!s?.note) throw new Error('ran out of seeds');
    const donorTitle = s.title_from ? (titles.get(s.title_from) || real[0].title) : real[Math.floor(rand() * real.length)].title;
    const seed = { key: `seed:${n}`, set: 'seed', seed_kind: s.kind, note: s.note, anchor: s.anchor, truth: s.truth, title: donorTitle, source_row: s.source_row || null };
    const items = [...real];
    items.splice(Math.floor(rand() * (items.length + 1)), 0, seed);
    for (const it of items) it.qid = rid();
    if (new Set(items.map((it) => it.qid)).size !== items.length) throw new Error('qid collision — re-plan');
    requests.push({ req: `r${String(n).padStart(3, '0')}`, items });
  }
  const summary = { made_at: new Date().toISOString(), verifier: VERIFIER, main: main.length, stale_skipped: stale, calib_shared: shared, calib_own: calib.length, calib_total: val.length, requests: requests.length, seeds: { table: requests.filter((r) => r.items.some((i) => i.seed_kind === 'table')).length, hand: requests.filter((r) => r.items.some((i) => i.seed_kind === 'hand')).length } };
  fs.writeFileSync(planFile, JSON.stringify({ summary, requests }, null, 1));
  console.log(JSON.stringify(summary, null, 1));
  await client.close();
}

// ---------------------------------------------------------------------------------------------
function parseJsonArray(text) {
  const t = String(text || '').replace(/^```(?:json)?\s*/m, '').replace(/```\s*$/m, '').trim();
  const a = t.indexOf('['); const b = t.lastIndexOf(']');
  if (a < 0 || b < a) return null;
  try { return JSON.parse(t.slice(a, b + 1)); } catch { return null; }
}

async function envelopeSpend(db) {
  const ctl = await db.collection('system_config').findOne({ _id: 'processing_control' });
  const env = ctl?.allow_scopes?.[ENVELOPE];
  if (!env?.created_at) throw new Error(`envelope ${ENVELOPE} missing — refusing to spend`);
  const s = await getScopeSpendUsd(db, { ids: [ENVELOPE], since: new Date(env.created_at) });
  if (s.meterError) throw new Error(`envelope meter unreadable (${s.meterError}) — refusing to spend`);
  return { usd: s.usd, budget: env.budget_usd };
}

const respFile = (req) => path.join(STATE, 'responses', `${req}.json`);
const readResp = (req) => (fs.existsSync(respFile(req)) ? JSON.parse(fs.readFileSync(respFile(req), 'utf8')) : null);
// A response counts only if it parsed AND searched: a 0-query answer is the model's memory, and
// the URLs it cites are unsearched (measured: 4 of the first 8 requests, plausible 84000 URLs).
const accepted = (resp) => !!(resp?.parsed && resp.queries?.length > 0);
const MAX_ATTEMPTS = 4;
function attempts(req) {
  return fs.readdirSync(path.join(STATE, 'responses')).filter((f) => f.startsWith(`${req}.`) && f.endsWith('.json')).length;
}

/** Wait for one batch job, then meter and store every response in it. Returns { queries, claims }. */
async function collectBatch(name, requests, gb, promptVersion) {
  let job;
  for (let i = 0; i < 180; i++) {
    job = await (await fetch(`${BASE}/${name}?key=${BATCH_KEY}`)).json();
    const state = job.metadata?.state || job.state;
    if (/SUCCEEDED|FAILED|CANCELLED|EXPIRED/.test(state)) { console.log(`  ${state} (${name})`); break; }
    await new Promise((res) => setTimeout(res, 20000));
  }
  const resps = job?.response?.inlinedResponses?.inlinedResponses || job?.response?.inlinedResponses || [];
  if (!resps.length) throw new Error(`no responses from ${name}: ${JSON.stringify(job).slice(0, 400)}`);
  let queriesN = 0; let claims = 0;
  for (const resp of resps) {
    const reqKey = resp.metadata?.key;
    const r = requests.find((x) => x.req === reqKey);
    const out = resp.response;
    const cand = out?.candidates?.[0];
    const text = (cand?.content?.parts || []).filter((p) => p.text && !p.thought).map((p) => p.text).join('');
    const g = cand?.groundingMetadata || {};
    const queries = g.webSearchQueries || [];
    const u = out?.usageMetadata || {};
    // Price it now: the tokens (batch rate) and every search query.
    await logUsage({ type: 'note_factcheck', mode: 'batch', model: MODEL, book_id: ENVELOPE, endpoint: ENDPOINT, triggered_by: 'manual',
      input_tokens: u.promptTokenCount || 0, output_tokens: outputTokensFrom(u), status: resp.error ? 'failed' : 'success',
      batch_job_id: name, prompt_version: `note-claims-verify-${promptVersion}:${reqKey}` });
    await gb.record({ model: MODEL, queries: queries.length, book_id: ENVELOPE });
    const parsed = parseJsonArray(text);
    queriesN += queries.length; claims += r.items.length;
    // Keep every attempt: the previous one moves aside, never overwritten.
    if (fs.existsSync(respFile(reqKey))) fs.renameSync(respFile(reqKey), path.join(STATE, 'responses', `${reqKey}.a${attempts(reqKey)}.json`));
    fs.writeFileSync(respFile(reqKey), JSON.stringify({
      req: reqKey, batch: name, prompt_version: promptVersion, at: new Date().toISOString(), finish: cand?.finishReason, error: resp.error || null,
      usage: u, queries, chunks: (g.groundingChunks || []).map((c) => ({ uri: c.web?.uri, title: c.web?.title })),
      search_usd: searchCostOf(MODEL, queries.length), text, parsed: Array.isArray(parsed) ? parsed : null,
    }, null, 1));
    console.log(`  ${reqKey}: ${queries.length} queries, ${Array.isArray(parsed) ? parsed.length : 'UNPARSED'} verdicts, finish ${cand?.finishReason}${resp.error ? ` error ${resp.error.message}` : ''}`);
  }
  return { queries: queriesN, claims };
}

async function run() {
  const WAVE = Number(arg('wave', 8));
  const MAX_WAVES = Number(arg('max-waves', 99));
  const STOP_USD = Number(arg('stop-usd', 30));
  const { requests } = JSON.parse(fs.readFileSync(path.join(STATE, 'plan.json'), 'utf8'));
  const { client, db } = await getScriptClient({ noTimeout: true, socketTimeoutMs: 120_000 });
  const gb = await openGroundingBudget({ endpoint: ENDPOINT });
  if (CMD === 'collect') {
    await collectBatch(arg('batch'), requests, gb, arg('prompt-version', 'v1'));
    await client.close();
    return;
  }
  for (let wave = 0; wave < MAX_WAVES; wave++) {
    const todo = requests.filter((r) => !accepted(readResp(r.req)) && attempts(r.req) < MAX_ATTEMPTS).slice(0, WAVE);
    if (!todo.length) { console.log('no request left to run (accepted, or out of attempts)'); break; }
    const spend = await envelopeSpend(db);
    const reserve = todo.length * WORST_CASE_QUERIES_PER_REQUEST * 0.014;
    console.log(`[wave ${wave}] envelope $${spend.usd.toFixed(2)} / $${spend.budget}; stop at $${STOP_USD}; this wave ${todo.length} requests (${todo.map((r) => r.req).join(' ')}), worst case +$${reserve.toFixed(2)}`);
    if (spend.usd + reserve > STOP_USD || spend.usd + reserve > spend.budget) { console.log('STOP: the next wave could cross the stop line'); break; }
    if (!gb.allows(reserve)) { console.log('STOP: monthly grounding budget'); break; }

    const body = {
      batch: {
        display_name: `note-factcheck-5647-${PROMPT_VERSION}-w${wave}-${todo[0].req}`,
        input_config: { requests: { requests: todo.map((r) => ({
          metadata: { key: r.req },
          request: {
            contents: [{ parts: [{ text: promptFor(r.items) }] }],
            tools: [{ google_search: {} }], // googleSearch: {} — snake case is the form the batch probe grounded with
            // thinking-ok: grounding needs a POSITIVE budget (512 → grounded; -1 suppresses it; flash-lite does not ground)
            generationConfig: { temperature: 0.1, maxOutputTokens: 16000, thinkingConfig: { thinkingBudget: 512 } },
          },
        })) } },
      },
    };
    const cr = await fetch(`${BASE}/models/${MODEL}:batchGenerateContent?key=${BATCH_KEY}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const cj = await cr.json();
    if (!cr.ok) throw new Error(`batch create ${cr.status}: ${JSON.stringify(cj).slice(0, 400)}`);
    console.log(`  submitted ${cj.name}`);
    fs.appendFileSync(path.join(STATE, 'submitted.log'), `${new Date().toISOString()} ${cj.name} ${PROMPT_VERSION} ${todo.map((r) => r.req).join(',')}\n`);
    const w = await collectBatch(cj.name, requests, gb, PROMPT_VERSION);
    const perClaim = w.queries / Math.max(1, w.claims);
    console.log(`  wave: ${w.queries} queries over ${w.claims} claims = ${perClaim.toFixed(2)}/claim`);
    if (perClaim > MAX_QUERIES_PER_CLAIM) { console.log(`STOP: ${perClaim.toFixed(2)} queries/claim > cap ${MAX_QUERIES_PER_CLAIM}`); break; }
  }
  const spend = await envelopeSpend(db);
  console.log(`envelope now $${spend.usd.toFixed(2)}`);
  await client.close();
}

// ---------------------------------------------------------------------------------------------
const VERDICTS = new Set(['correct', 'wrong', 'partly-wrong', 'unverifiable']);
const COMMON = new Set(['which', 'there', 'their', 'about', 'buddha', 'tibetan', 'sanskrit', 'refers', 'referring', 'known', 'their', 'these', 'those', 'where', 'school', 'teacher', 'master', 'great', 'century', 'meaning']);
const foldWords = (t) => String(t || '').normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 5 && !COMMON.has(w));

function collect() {
  const { summary, requests } = JSON.parse(fs.readFileSync(path.join(STATE, 'plan.json'), 'utf8'));
  const out = [];
  let queries = 0; let searchUsd = 0; let inTok = 0; let outTok = 0; let answered = 0; let attemptsN = 0; const promptVersions = {};
  for (const r of requests) {
    const f = path.join(STATE, 'responses', `${r.req}.json`);
    const resp = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
    // Metered totals over EVERY attempt (each was billed), verdicts from the accepted one only.
    for (const a of fs.readdirSync(path.join(STATE, 'responses')).filter((x) => x === `${r.req}.json` || (x.startsWith(`${r.req}.a`) && x.endsWith('.json')))) {
      const ra = JSON.parse(fs.readFileSync(path.join(STATE, 'responses', a), 'utf8'));
      queries += ra.queries.length; searchUsd += ra.search_usd; inTok += ra.usage?.promptTokenCount || 0; outTok += outputTokensFrom(ra.usage || {}); attemptsN++;
    }
    const ok = accepted(resp);
    if (ok) answered++;
    if (ok) promptVersions[resp.prompt_version || 'v1'] = (promptVersions[resp.prompt_version || 'v1'] || 0) + 1;
    const byId = new Map((ok ? resp.parsed : []).map((v) => [String(v.id), v]));
    const domains = [...new Set((resp?.chunks || []).map((c) => c.title).filter(Boolean))];
    for (const it of r.items) {
      const v = byId.get(it.qid);
      let verdict = v && VERDICTS.has(v.verdict) ? v.verdict : null;
      const flags = [];
      if (!resp) flags.push('not-run'); else if (!ok) flags.push(resp.parsed ? 'ungrounded' : 'unparsed'); else if (!v) flags.push('no-verdict');
      const url = (v?.source_url || '').trim();
      if (verdict && verdict !== 'unverifiable' && !/^https?:\/\//.test(url)) { flags.push(`url_missing(was ${verdict})`); verdict = 'unverifiable'; }
      let host = '';
      try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { /* no url */ }
      const urlInGrounding = !!host && domains.some((d) => d.replace(/^www\./, '') === host || host.endsWith(`.${d.replace(/^www\./, '')}`));
      // Per-item grounding hint: a search query shares a distinctive word (≥5 letters) with the
      // note. groundingChunks cannot say this — they list only the few spans the answer cited.
      const words = new Set(foldWords(it.note));
      const searched = ok && resp.queries.some((q) => foldWords(q).some((w) => words.has(w)));
      out.push({ ...it, req: r.req, prompt_version: ok ? (resp.prompt_version || 'v1') : null, url_in_grounding: urlInGrounding, searched, verdict, checked_claim: v?.checked_claim || '', correction: v?.correction || '', source_url: url, evidence: v?.evidence || '', no_checkable_fact: !!v?.no_checkable_fact, flags, grounding_domains: domains, request_queries: resp?.queries.length ?? null });
    }
  }
  return { summary, requests, out, meter: { requests_accepted: answered, attempts: attemptsN, accepted_by_prompt_version: promptVersions, queries, search_usd: searchUsd, input_tokens: inTok, output_tokens: outTok } };
}

async function report() {
  const WRITE = process.argv.includes('--write');
  const OUT = arg('out', 'scripts/eval/results/note-claims-5647/stage3');
  const { summary, out, meter } = collect();
  const count = (xs, f) => xs.reduce((m, x) => { const k = f(x); m[k] = (m[k] || 0) + 1; return m; }, {});
  const seeds = out.filter((x) => x.set === 'seed' && x.verdict != null);
  const caught = seeds.filter((x) => x.verdict === 'wrong' || x.verdict === 'partly-wrong');
  const main = out.filter((x) => x.set === 'main' && x.verdict != null);

  // Calibration vs #5624 (worst verdict per note, from validation.json).
  const val = new Map(JSON.parse(fs.readFileSync(VALIDATION, 'utf8')).rows.map((r) => [r.nid, r]));
  const calib = out.filter((x) => (x.set === 'calib' || x.calib_nid) && x.verdict != null).map((x) => ({ nid: x.nid || x.calib_nid, ours: x.verdict, theirs: val.get(x.nid || x.calib_nid)?.verdict, x }));
  const confusion = {};
  for (const c of calib) { confusion[c.theirs] ??= {}; confusion[c.theirs][c.ours] = (confusion[c.theirs][c.ours] || 0) + 1; }
  const four = calib.filter((c) => c.theirs !== 'no-claim');
  const coarse = (v) => (v === 'wrong' || v === 'partly-wrong' ? 'error' : v);
  const known = calib.filter((c) => c.theirs === 'wrong' || c.theirs === 'partly-wrong');
  const calibration = {
    notes: calib.length,
    confusion_theirs_by_ours: confusion,
    exact_agreement_4class: `${four.filter((c) => c.ours === c.theirs).length}/${four.length}`,
    coarse_agreement_4class: `${four.filter((c) => coarse(c.ours) === coarse(c.theirs)).length}/${four.length}`,
    known_errors_found: `${known.filter((c) => coarse(c.ours) === 'error').length}/${known.length}`,
    known_errors: known.map((c) => ({ nid: c.nid, theirs: c.theirs, ours: c.ours, note: c.x.note, correction: c.x.correction, source_url: c.x.source_url })),
    ours_error_theirs_correct: calib.filter((c) => coarse(c.ours) === 'error' && c.theirs === 'correct').map((c) => ({ nid: c.nid, note: c.x.note, ours: c.ours, correction: c.x.correction, source_url: c.x.source_url, evidence: c.x.evidence })),
    no_claim_labelled: count(calib.filter((c) => c.theirs === 'no-claim'), (c) => c.ours),
  };
  const res = {
    stage: 3, issue: '#5647', verifier: VERIFIER, plan: summary, meter,
    seed_catch: { caught: caught.length, answered: seeds.length, rate: seeds.length ? +(caught.length / seeds.length).toFixed(3) : null, by_kind: count(seeds, (s) => `${s.seed_kind}:${s.verdict}`), missed: seeds.filter((s) => !caught.includes(s)).map((s) => ({ req: s.req, note: s.note, truth: s.truth, verdict: s.verdict, evidence: s.evidence })) },
    main_verdicts: count(main, (x) => x.verdict),
    main_by_kind: count(main, (x) => `${x.claim_kind}:${x.verdict}`),
    main_unanswered: out.filter((x) => x.set === 'main' && x.verdict == null).length,
    url_missing_downgrades: out.filter((x) => x.flags.some((f) => f.startsWith('url_missing'))).length,
    main_searched_by_verdict: count(main, (x) => `${x.verdict}:${x.searched ? 'searched' : 'no-matching-query'}`),
    main_url_domain_in_grounding_chunks: main.filter((x) => x.url_in_grounding).length,
    calibration,
  };
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(res, null, 1));
  const strip = ({ qid, ...x }) => x;
  fs.writeFileSync(path.join(OUT, 'verdicts.json'), JSON.stringify(out.filter((x) => x.set !== 'seed').map(strip), null, 1));
  fs.writeFileSync(path.join(OUT, 'seeds.json'), JSON.stringify(out.filter((x) => x.set === 'seed').map(strip), null, 1));
  console.log(JSON.stringify({ ...res, calibration: { ...calibration, known_errors: calibration.known_errors.length, ours_error_theirs_correct: calibration.ours_error_theirs_correct.length } }, null, 1));

  if (WRITE) {
    const { client, db } = await getScriptClient({ noTimeout: true, socketTimeoutMs: 120_000 });
    const ops = main.map((x) => ({ updateOne: {
      filter: { _id: x.key, translation_hash: x.translation_hash },
      update: { $set: { verify: { verdict: x.verdict, checked_claim: x.checked_claim, correction: x.correction, source_url: x.source_url, evidence: x.evidence, no_checkable_fact: x.no_checkable_fact, flags: x.flags, grounding_domains: x.grounding_domains, request: x.req, request_queries: x.request_queries, translation_hash: x.translation_hash, verifier: VERIFIER, verified_at: new Date() } } },
    } }));
    const r = ops.length ? await db.collection('note_claims').bulkWrite(ops, { ordered: false }) : { matchedCount: 0, modifiedCount: 0 };
    console.log(`note_claims.verify: matched ${r.matchedCount}, modified ${r.modifiedCount} of ${ops.length}`);
    await client.close();
  }
}

if (CMD === 'plan') await plan();
else if (CMD === 'run' || CMD === 'collect') await run();
else if (CMD === 'report') await report();
else { console.error('usage: note-claims-verify.mjs plan | run [--wave N] [--max-waves N] [--stop-usd 30] | report [--write]'); process.exit(1); }
