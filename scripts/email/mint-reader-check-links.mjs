#!/usr/bin/env node
/**
 * Mint personal /check/<token> links for the blind reader check (#7573).
 *
 * PRIOR ART: scripts/email/build-translation-check-invites.mjs mints one-page
 * HMAC invitations into the translation-check queue; it does not fit because a
 * reader check is twenty pages with two frozen arm texts and a shuffled A/B
 * order, which has to be stored, not carried in the URL. Its reader-id
 * derivation (HMAC of the email, uuid-shaped) is copied exactly so one person
 * keeps one id across both flows. Packets come from
 * scripts/eval/flash-reread-5924/w-human.mjs (#7568).
 *
 * WHAT IT WRITES. Dry run by default: it prints the plan and writes nothing.
 * With --apply it inserts one `reader_check_tokens` row per reader and writes
 * the links (with email addresses) to --out, a local file for the person who
 * sends the emails. That file holds addresses: keep it out of the repo. It sends
 * nothing. Nothing reads the new rows except /check/<token> itself.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local \
 *     scripts/email/mint-reader-check-links.mjs --readers=readers.jsonl --out=$JOB_SCRATCH/links.json [--apply]
 *
 * readers.jsonl, one reader per line:
 *   {"email":"a@x.org","language":"greek","level":"professional",
 *    "credit":"name","name":"A. Reader","consent_publish":true}
 *   credit: "anonymous" (default) or "name". consent_publish: CC BY-SA
 *   publication of their judgements; default false. Both defaults are the
 *   private value on purpose (safe-defaults.md): a reader who said nothing is
 *   never named and never published.
 *
 * Options:
 *   --packets=<dir>      default scripts/eval/dataset/judge-human-check-7573
 *   --pages=20           pages per link
 *   --controls=2         of those, pages comparing the unreviewed lite read
 *                        against the corrected text where the judge called lite
 *                        misleading and the correction sound: a planted easy
 *                        call, to measure each rater (issue body, Lane A)
 *   --pair=corrected,reread   the two arms compared on the other pages
 *   --test               mark the link and its answers test:true (excluded from analysis)
 *
 * Which pages: review:true rows first (the 30 per language the packet builder
 * picked for people), least-assigned first across every link already minted
 * for that packet, so each page collects two or more readers before any gets a
 * fifth; never a page this reader was already given. Order of pages and A/B
 * order per page are drawn with crypto.randomInt and stored on the row.
 */
import { MongoClient } from 'mongodb';
import { createHash, createHmac, randomBytes, randomInt } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const SITE = 'https://sourcelibrary.org';
const ISSUE = 7573;
const args = process.argv.slice(2);
const argOf = (n, d) => {
  const a = args.find(x => x.startsWith(`--${n}=`));
  return a ? a.slice(n.length + 3) : d;
};
const flag = n => args.includes(`--${n}`);

const APPLY = flag('apply');
const TEST = flag('test');
const READERS = argOf('readers', '');
const OUT = argOf('out', '');
const PACKETS = argOf('packets', path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'eval', 'dataset', 'judge-human-check-7573'));
const PAGES = Number(argOf('pages', '20'));
const CONTROLS = Number(argOf('controls', '2'));
const PAIR = argOf('pair', 'corrected,reread').split(',');

const die = m => { console.error(m); process.exit(1); };
if (!READERS) die('Need --readers=<file.jsonl> (see the header for the row shape).');
if (APPLY && !OUT) die('--apply needs --out=<file> for the links (it holds email addresses: keep it outside the repo).');
if (PAIR.length !== 2 || PAIR[0] === PAIR[1]) die('--pair needs two different arm names, e.g. corrected,reread');
if (!(PAGES > 0) || !(CONTROLS >= 0) || CONTROLS >= PAGES) die('--pages must be > --controls >= 0');
const SECRET = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
if (!SECRET) die('AUTH_SECRET required: it keys the reader id.');
if (!process.env.MONGODB_URI) die('MONGODB_URI required');

/** Mirrors inviteeIdFor() in src/lib/review-invite-token.ts. */
const readerIdFor = email => {
  const h = createHmac('sha256', SECRET).update(`invitee:${email.trim().toLowerCase()}`).digest('hex');
  return [h.slice(0, 8), h.slice(8, 12), `4${h.slice(13, 16)}`, `8${h.slice(17, 20)}`, h.slice(20, 32)].join('-');
};
/** Mirrors readerCheckTokenId() in src/lib/reader-check.ts. */
const tokenIdFor = token => createHash('sha256').update(`reader-check:${token}`).digest('hex');
/** 24 random bytes → 32 base64url characters, the shape isReaderCheckToken() accepts. */
const newToken = () => randomBytes(24).toString('base64url');

const LANGUAGE_ALIASES = {
  'ancient greek': 'greek', 'classical greek': 'greek', 'byzantine greek': 'greek',
  'classical chinese': 'chinese', 'literary chinese': 'chinese',
};
const packetNameFor = lang => {
  const l = String(lang || '').trim().toLowerCase();
  return LANGUAGE_ALIASES[l] ?? l;
};

/**
 * The header blocks are the model's notes ABOUT the page (language, script,
 * warnings, vocabulary), not text ON it. Both arms lose them identically, so the
 * comparison is between transcriptions only. Inline markup (<margin>, <gloss>,
 * <unclear>, ->centred<-) is page content and stays.
 */
const META_BLOCKS = /<(scan-quality|language|script|page-type|warning|vocab|image-desc|summary|keywords)>[\s\S]*?<\/\1>/gi;
const displayText = t => String(t ?? '').replace(META_BLOCKS, '').replace(/\n{3,}/g, '\n\n').trim();

const shuffle = arr => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};

const packetCache = new Map();
function loadPacket(name) {
  if (packetCache.has(name)) return packetCache.get(name);
  const file = path.join(PACKETS, `${name}.jsonl`);
  if (!existsSync(file)) return null;
  const rows = readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  packetCache.set(name, rows);
  return rows;
}

const readers = readFileSync(READERS, 'utf8').split('\n').map(l => l.trim()).filter(Boolean).map((l, i) => {
  let r;
  try { r = JSON.parse(l); } catch { die(`readers line ${i + 1}: not JSON`); }
  if (!r.email || !String(r.email).includes('@')) die(`readers line ${i + 1}: needs an email`);
  if (!r.language) die(`readers line ${i + 1}: needs a language`);
  const credit = r.credit === 'name' ? 'name' : 'anonymous';
  if (credit === 'name' && !String(r.name || '').trim()) die(`readers line ${i + 1}: credit "name" needs a name`);
  return {
    email: String(r.email).trim(),
    language: String(r.language).trim(),
    level: String(r.level || 'unstated').trim(),
    credit,
    credit_name: credit === 'name' ? String(r.name).trim() : null,
    consent_publish: r.consent_publish === true,
  };
});

const available = [...new Set(readers.map(r => packetNameFor(r.language)))];
const missing = available.filter(n => !loadPacket(n));
if (missing.length) {
  die(`No packet for: ${missing.join(', ')}. Packets in ${PACKETS}: ` +
    (existsSync(PACKETS) ? 'see the directory' : 'directory missing (packets land with #7568 / PR #7571)'));
}

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db(process.env.MONGODB_DB || 'bookstore');
const tokens = db.collection('reader_check_tokens');

// Assignment counts per packet, from every link already minted (test links excluded).
const assigned = new Map(); // `${file}|${page_id}` → count
const seenByReader = new Map(); // reader_id → Set(page_id)
const priorBatches = new Map(); // reader_id → n
for await (const t of tokens.find({}, { projection: { reader_id: 1, 'packet.file': 1, 'items.page_id': 1, test: 1, revoked: 1 } }).batchSize(1000)) {
  priorBatches.set(t.reader_id, (priorBatches.get(t.reader_id) ?? 0) + 1);
  const seen = seenByReader.get(t.reader_id) ?? new Set();
  for (const it of t.items ?? []) {
    seen.add(it.page_id);
    if (!t.test && !t.revoked) assigned.set(`${t.packet.file}|${it.page_id}`, (assigned.get(`${t.packet.file}|${it.page_id}`) ?? 0) + 1);
  }
  seenByReader.set(t.reader_id, seen);
}

const docs = [];
const links = [];
for (const r of readers) {
  const name = packetNameFor(r.language);
  const file = `judge-human-check-7573/${name}.jsonl`;
  const rows = loadPacket(name);
  const readerId = readerIdFor(r.email);
  const seen = seenByReader.get(readerId) ?? new Set();
  const hasPair = x => PAIR.every(a => typeof x.texts?.[a] === 'string' && x.texts[a].trim());

  const controlsPool = shuffle(rows.filter(x =>
    !x.review && !seen.has(x.page_id) && x.texts?.lite && x.texts?.corrected &&
    x.judge?.verdict?.lite === 'misleading' && x.judge?.verdict?.corrected === 'sound' &&
    x.judge?.prefer?.corrected_vs_lite?.prefer === 'C' && x.judge?.prefer?.corrected_vs_lite?.loser_material === true));
  const controls = controlsPool.slice(0, CONTROLS);
  const controlIds = new Set(controls.map(x => x.page_id));

  const main = rows
    .filter(x => hasPair(x) && !seen.has(x.page_id) && !controlIds.has(x.page_id))
    .map(x => ({ x, k: [x.review ? 0 : 1, assigned.get(`${file}|${x.page_id}`) ?? 0, -(x.disagreement_score ?? 0), randomInt(1e9)] }))
    .sort((a, b) => a.k[0] - b.k[0] || a.k[1] - b.k[1] || a.k[2] - b.k[2] || a.k[3] - b.k[3])
    .slice(0, PAGES - controls.length)
    .map(({ x }) => x);

  if (main.length + controls.length < PAGES) {
    console.warn(`  ${r.language}: only ${main.length + controls.length} unseen pages left for this reader (wanted ${PAGES})`);
  }
  if (!main.length) { console.warn(`  skipping one ${r.language} reader: no unseen pages`); continue; }

  const items = shuffle([
    ...main.map(x => ({ x, pair: PAIR, control: false })),
    ...controls.map(x => ({ x, pair: ['lite', 'corrected'], control: true })),
  ]).map(({ x, pair, control }) => {
    const arms = randomInt(2) ? [pair[1], pair[0]] : [pair[0], pair[1]];
    return {
      packet_id: `${name}:${x.page_id}`,
      page_id: x.page_id,
      book_id: x.book_id,
      title: x.title ?? '',
      page_number: x.page_number,
      image_url: x.image_url,
      arms,
      text_a: displayText(x.texts[arms[0]]),
      text_b: displayText(x.texts[arms[1]]),
      control,
    };
  });
  for (const it of items) if (!it.control) assigned.set(`${file}|${it.page_id}`, (assigned.get(`${file}|${it.page_id}`) ?? 0) + 1);

  const token = newToken();
  docs.push({
    _id: tokenIdFor(token),
    reader_id: readerId,
    reader: { language: r.language, level: r.level, credit: r.credit, credit_name: r.credit_name, consent_publish: r.consent_publish },
    packet: { file, language: name, pair: PAIR, issue: ISSUE },
    items,
    batch: (priorBatches.get(readerId) ?? 0) + 1,
    test: TEST,
    revoked: false,
    created_at: new Date(),
    minted_by: 'scripts/email/mint-reader-check-links.mjs',
  });
  priorBatches.set(readerId, (priorBatches.get(readerId) ?? 0) + 1);
  links.push({ email: r.email, name: r.credit_name, language: r.language, pages: items.length, url: `${SITE}/check/${token}` });
}

const byLang = {};
for (const d of docs) byLang[d.packet.language] = (byLang[d.packet.language] ?? 0) + 1;
// After this run: how many pages per packet have two or more readers assigned.
const coverage = {};
for (const name of Object.keys(byLang)) {
  const counts = loadPacket(name).map(x => assigned.get(`judge-human-check-7573/${name}.jsonl|${x.page_id}`) ?? 0);
  coverage[name] = { pages_with_2plus_readers: counts.filter(c => c >= 2).length, pages_with_any: counts.filter(c => c >= 1).length };
}
console.log(JSON.stringify({ mode: APPLY ? 'apply' : 'dry-run', links: docs.length, by_language: byLang, pages_per_link: PAGES, controls: CONTROLS, pair: PAIR, test: TEST, coverage }));

if (!APPLY) {
  console.log('Dry run: nothing written. Re-run with --apply --out=<file> to mint.');
  await client.close();
  process.exit(0);
}

await tokens.createIndex({ reader_id: 1 });
const judgements = db.collection('reader_check_judgements');
await judgements.createIndex({ token_id: 1 });
await judgements.createIndex({ reader_id: 1 });
await judgements.createIndex({ packet_file: 1, page_id: 1 });
if (docs.length) await tokens.insertMany(docs, { ordered: true });
writeFileSync(OUT, JSON.stringify(links, null, 2) + '\n', { mode: 0o600 });
console.log(`Minted ${docs.length} links; written to ${OUT} (holds email addresses).`);
await client.close();
