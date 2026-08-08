/**
 * dedup-replay-sample — the END-TO-END gate for import dedup (#3730).
 *
 * Field-presence metrics ("N books have normalized_title") measure that a
 * field exists, not that the system works — and they can be gamed by a
 * definition change. This script measures the behavior we actually care
 * about: **if we tried to re-import a book we already hold, would dedup
 * catch it?** It samples live books and replays each one through the real
 * `checkDuplicate()` twice:
 *
 *   same-source replay   full metadata, identifiers included. Tier 1
 *                        (fingerprint) / tier 3 (IIIF) should make this ~100%.
 *   cross-source replay  identifiers STRIPPED — simulates the same edition
 *                        arriving from a different provider, which only the
 *                        title+author tier can catch. This is the recall
 *                        number that matters, and the one the ASCII-normalizer
 *                        hole put in doubt for non-Latin books.
 *
 * Results are stratified Latin vs non-Latin (a corpus-wide average would let
 * the 85% Latin majority mask a dead non-Latin lane — the exact shape of the
 * bug this gate exists to detect).
 *
 * CONTROLS (lesson: a probe needs a positive control — "not found" is
 * worthless until the probe has returned "found"):
 *   positive — a handful of books from known duplicate_of pairs, replayed
 *              cross-source; the keeper must match.
 *   negative — fabricated titles that exist nowhere; any match is a false
 *              positive in the probe itself.
 *
 *   set -a; source .env.production.local; set +a
 *   npx tsx scripts/audit/dedup-replay-sample.ts [--sample=500] [--json]
 */
import 'dotenv/config';
import { MongoClient, type Db } from 'mongodb';
import { checkDuplicate } from '../../src/lib/dedup';

const argv = process.argv.slice(2);
const SAMPLE = parseInt(argv.find((a) => a.startsWith('--sample='))?.split('=')[1] || '500', 10);
const JSON_OUT = argv.includes('--json');

interface BookDoc {
  id: string;
  title?: string;
  display_title?: string;
  author?: string;
  year?: number;
  published?: string;
  normalized_title?: string;
  ia_identifier?: string;
  gallica_ark?: string;
  mdz_id?: string;
  bsb_id?: string;
  google_books_id?: string;
  image_source?: { provider?: string; identifier?: string; iiif_manifest?: string; pdf_url?: string; source_url?: string };
  duplicate_of?: string;
}

/** The cross-source variant: same edition, no shared identifiers. */
function stripIdentifiers(b: BookDoc) {
  return {
    title: b.title || '',
    author: b.author || '',
    display_title: b.display_title,
    year: b.year,
    published: b.published,
  };
}

function fullMetadata(b: BookDoc) {
  return { ...stripIdentifiers(b),
    ia_identifier: b.ia_identifier, gallica_ark: b.gallica_ark, mdz_id: b.mdz_id,
    bsb_id: b.bsb_id, google_books_id: b.google_books_id, image_source: b.image_source,
  };
}

/**
 * Non-Latin stratum: the stored normalized_title is too short to reach tier 2
 * (< 5 chars) while a real title exists. Not merely empty: «Чехова. Том 3»
 * ASCII-normalizes to "3" — non-empty, but just as invisible to the title
 * tier as the empty string, and stratifying it as "Latin" understates the
 * non-Latin miss population.
 */
function isNonLatin(b: BookDoc): boolean {
  return !!b.title && (b.normalized_title ?? '').length < 5;
}

async function replay(db: Db, candidate: Parameters<typeof checkDuplicate>[1]): Promise<boolean> {
  const r = await checkDuplicate(db, candidate);
  return r.isDuplicate;
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error('MONGODB_URI not set'); process.exit(1); }
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || 'bookstore');
  const books = db.collection<BookDoc>('books');

  // Live books only — the population a curator could actually re-import.
  // Oversample non-Latin so its stratum is statistically meaningful instead
  // of ~15% of whatever $sample returns.
  const perStratum = Math.ceil(SAMPLE / 2);
  // Stratify by tier-2 REACHABILITY (normalized_title length >= 5, the guard
  // tier 2 itself applies), not by empty-vs-not — see isNonLatin().
  const latinRaw = await books.aggregate<BookDoc>([
    { $match: { visible: true, pages_count: { $gt: 0 }, content_type: { $ne: 'artwork' }, normalized_title: { $nin: [null, ''] } } },
    { $sample: { size: perStratum * 2 } },
  ]).toArray();
  const latin = latinRaw.filter((b) => !isNonLatin(b)).slice(0, perStratum);
  const nonLatinRaw = await books.aggregate<BookDoc>([
    { $match: { visible: true, pages_count: { $gt: 0 }, content_type: { $ne: 'artwork' }, title: { $nin: [null, ''] } } },
    { $sample: { size: perStratum * 6 } },
  ]).toArray();
  const nonLatin = nonLatinRaw.filter(isNonLatin).slice(0, perStratum);

  const strata: Record<string, { same: [number, number]; cross: [number, number] }> = {
    latin: { same: [0, 0], cross: [0, 0] },
    nonLatin: { same: [0, 0], cross: [0, 0] },
  };
  const crossMisses: { id: string; title?: string; stratum: string }[] = [];

  for (const [name, sample] of [['latin', latin], ['nonLatin', nonLatin]] as const) {
    for (const b of sample) {
      const s = strata[name];
      s.same[1]++; s.cross[1]++;
      if (await replay(db, fullMetadata(b))) s.same[0]++;
      if (await replay(db, stripIdentifiers(b))) s.cross[0]++;
      else crossMisses.push({ id: b.id, title: b.title, stratum: name });
    }
  }

  // Positive control: keepers of known duplicate pairs, cross-source. These
  // are books the system has ALREADY adjudicated as having a copy — if the
  // replay can't find a match for them, the probe is broken, and every miss
  // above is meaningless.
  // BOOKS only — most duplicate_of pointers are artworks, whose identity lane
  // is sha1/CLIP, not title dedup. Sampling them here broke the control on the
  // first run (0/20 "matched" — every one an artwork with a filename title).
  const dupPointers = await books.aggregate<BookDoc>([
    { $match: { duplicate_of: { $exists: true, $nin: [null, ''] }, content_type: { $ne: 'artwork' }, title: { $nin: [null, ''] } } },
    { $sample: { size: 20 } },
  ]).toArray();
  let posCaught = 0;
  for (const b of dupPointers) {
    if (await replay(db, stripIdentifiers(b))) posCaught++;
  }

  // Negative control: fabricated books that exist nowhere.
  const fabricated = [
    { title: 'Zxq Phantasmagoria Nonexistens Codexicus', author: 'Nemo, Nusquam', year: 1234 },
    { title: '虛構之書不存在的目錄編號九九九', author: '無名氏測試', year: 1234 },
    { title: 'Liber Fictus De Probatione Negativa Anno MMXXVI', author: 'Testman, Probe', year: 1599 },
  ];
  let negFalse = 0;
  for (const f of fabricated) {
    if (await replay(db, f)) negFalse++;
  }

  const pct = (n: [number, number]) => (n[1] ? ((100 * n[0]) / n[1]).toFixed(1) + '%' : 'n/a');
  const summary = {
    date: new Date().toISOString().slice(0, 10),
    sample: { latin: strata.latin.same[1], nonLatin: strata.nonLatin.same[1] },
    sameSource: { latin: pct(strata.latin.same), nonLatin: pct(strata.nonLatin.same) },
    crossSource: { latin: pct(strata.latin.cross), nonLatin: pct(strata.nonLatin.cross) },
    controls: {
      positive: `${posCaught}/${dupPointers.length} known-dup keepers matched (must be high or the probe is broken)`,
      negative: `${negFalse}/${fabricated.length} fabricated books matched (must be 0)`,
    },
    crossMisses: crossMisses.length,
  };

  if (JSON_OUT) {
    console.log(JSON.stringify({ ...summary, missSample: crossMisses.slice(0, 30) }, null, 2));
  } else {
    console.log(`dedup replay — ${summary.date}, ${strata.latin.same[1]} Latin + ${strata.nonLatin.same[1]} non-Latin live books`);
    console.log(`  same-source  (identifiers kept):    Latin ${summary.sameSource.latin}   non-Latin ${summary.sameSource.nonLatin}`);
    console.log(`  cross-source (identifiers stripped): Latin ${summary.crossSource.latin}   non-Latin ${summary.crossSource.nonLatin}   <- the recall that matters`);
    console.log(`  positive control: ${summary.controls.positive}`);
    console.log(`  negative control: ${summary.controls.negative}`);
    if (crossMisses.length) {
      console.log(`  cross-source misses (first 10 of ${crossMisses.length}):`);
      for (const m of crossMisses.slice(0, 10)) console.log(`    [${m.stratum}] ${m.id}  ${JSON.stringify((m.title || '').slice(0, 70))}`);
    }
  }

  await client.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
