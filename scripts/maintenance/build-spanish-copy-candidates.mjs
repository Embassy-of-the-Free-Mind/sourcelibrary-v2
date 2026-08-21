/**
 * Pool the `spanish-copy` review queue: every translated interface string,
 * paired with its English original, for a Spanish reader to judge.
 *
 * Unlike the other queues this reviews OUR words, not a scanned page. There is
 * no book, no image and no page link — `review_candidates` only requires
 * `queue` + `item_id`, and `nextCandidate()` matches on `queue` alone.
 *
 * WHY THIS EXISTS. /es was translated by machine and never read by a Spanish
 * speaker. 44 people told us on /welcome that they read Spanish and not
 * English, and Argentina is our second-largest country. Asking one of them to
 * check 100 short strings is a task that takes twenty minutes, needs no
 * credentials, and answers a standing offer several of them have already made.
 *
 * The dictionaries are parsed out of src/lib/i18n.ts rather than imported,
 * because it is TypeScript and this is a plain .mjs maintenance script. The
 * parse is deliberately narrow: it reads `Record<Locale, X>` blocks with an
 * `en:` and an `es:` object of flat string literals. If someone adds a nested
 * or computed dictionary this will skip it rather than emit garbage — it warns
 * about anything it could not pair, so a silent shortfall is visible.
 *
 *   node scripts/maintenance/build-spanish-copy-candidates.mjs            # dry run
 *   node scripts/maintenance/build-spanish-copy-candidates.mjs --apply
 */
import { MongoClient } from 'mongodb';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const APPLY = process.argv.includes('--apply');
const I18N = path.join(process.cwd(), 'src/lib/i18n.ts');
const QUEUE = 'spanish-copy';

/** Pull `name: '...'` pairs out of one object literal body. */
function parseFlatStrings(body) {
  const out = {};
  const re = /^\s*([a-zA-Z][a-zA-Z0-9_]*)\s*:\s*'((?:[^'\\]|\\.)*)'\s*,?\s*$/gm;
  let m;
  while ((m = re.exec(body))) {
    out[m[1]] = m[2]
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/\\'/g, "'")
      .replace(/\\\\/g, '\\');
  }
  return out;
}

/** Find each `export const NAME: Record<Locale, ...> = { en: {...}, es: {...} }`. */
function parseDictionaries(src) {
  const dicts = [];
  const header = /export const ([A-Z_]+): Record<Locale, [A-Za-z]+> = \{/g;
  let h;
  while ((h = header.exec(src))) {
    // Walk braces from the opening `{` so nested objects don't end it early.
    let depth = 0, i = header.lastIndex - 1, start = i;
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') { depth--; if (depth === 0) break; }
    }
    const body = src.slice(start, i + 1);
    const locale = /(\ben\b|\bes\b)\s*:\s*\{/g;
    const blocks = {};
    let l;
    while ((l = locale.exec(body))) {
      let d = 0, j = locale.lastIndex - 1, s = j;
      for (; j < body.length; j++) {
        if (body[j] === '{') d++;
        else if (body[j] === '}') { d--; if (d === 0) break; }
      }
      blocks[l[1]] = body.slice(s, j + 1);
    }
    if (blocks.en && blocks.es) {
      dicts.push({ name: h[1], en: parseFlatStrings(blocks.en), es: parseFlatStrings(blocks.es) });
    }
  }
  return dicts;
}

const src = readFileSync(I18N, 'utf8');
const dicts = parseDictionaries(src);
if (!dicts.length) {
  console.error('Parsed no dictionaries from i18n.ts — the file shape changed. Refusing to build.');
  process.exit(1);
}

// Where each dictionary shows up, so a reviewer can picture the string in place
// and so coverage is reportable per surface rather than as one lump.
const SURFACE = {
  NAV_STRINGS: 'Site header and navigation',
  FOOTER_STRINGS: 'Footer',
  FEEDBACK_STRINGS: 'Feedback button and dialog',
};

const candidates = [];
const unpaired = [];
for (const d of dicts) {
  for (const [key, en] of Object.entries(d.en)) {
    const es = d.es[key];
    if (!es) { unpaired.push(`${d.name}.${key}`); continue; }
    candidates.push({
      queue: QUEUE,
      build_id: 'i18n-v1',
      item_id: `${d.name}.${key}`,
      stratum: { surface: SURFACE[d.name] || d.name },
      payload: { key, en, es, dictionary: d.name, where: SURFACE[d.name] || d.name },
      is_gold: false,
      created_at: new Date(),
    });
  }
}

console.log(`dictionaries: ${dicts.map(d => `${d.name}(${Object.keys(d.en).length})`).join(', ')}`);
console.log(`paired strings: ${candidates.length}`);
if (unpaired.length) console.log(`WARNING — English with no Spanish (skipped): ${unpaired.join(', ')}`);
console.log('\nsample:');
for (const c of candidates.slice(0, 4)) console.log(`  ${c.item_id}\n    en: ${c.payload.en}\n    es: ${c.payload.es}`);

if (!APPLY) { console.log('\nDry run. Re-run with --apply to write.'); process.exit(0); }
if (!process.env.MONGODB_URI) { console.error('MONGODB_URI required'); process.exit(1); }

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const col = client.db('bookstore').collection('review_candidates');
// (queue, item_id) is uniquely indexed, so a re-run must upsert rather than
// insert — otherwise adding one new string means rebuilding the whole pool.
let upserted = 0, updated = 0;
for (const c of candidates) {
  const r = await col.updateOne(
    { queue: QUEUE, item_id: c.item_id },
    { $set: { payload: c.payload, stratum: c.stratum, build_id: c.build_id }, $setOnInsert: { queue: QUEUE, item_id: c.item_id, is_gold: false, created_at: c.created_at } },
    { upsert: true },
  );
  if (r.upsertedCount) upserted++; else if (r.modifiedCount) updated++;
}
console.log(`\ninserted ${upserted}, updated ${updated}, pool now ${await col.countDocuments({ queue: QUEUE })}`);
await client.close();
