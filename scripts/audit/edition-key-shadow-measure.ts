/**
 * edition-key-shadow-measure — #3730 §2, the measurement before the flip.
 *
 * Import dedup's tier 2 currently matches on `normalized_title` +
 * `normalized_author` (ASCII, whole-name) with year/volume as a both-sides
 * veto. The edition layer (#3710) proposes to replace that with the stored
 * `edition_key` (Unicode title + surname + year + volume). This script runs
 * BOTH matchers over a real import population and reports where they agree,
 * where the edition tier catches what the live tier misses, and — the part
 * that could block the flip — where the live tier catches something the
 * edition tier would let through.
 *
 * Population (per the issue): every non-artwork book imported since
 * 2026-07-01, plus a 1,000-doc sample of `books_warehouse`. Each is replayed
 * as a would-be import with identifiers stripped (tiers 1/3 are untouched by
 * the flip, so only tier-2 behaviour matters), with the candidate itself
 * excluded from the match sets — at import time it wasn't there yet.
 *
 * Shadow matcher semantics (from #3730): edition-key equality when both sides
 * carry full quality; title+surname with year/volume as a both-sides veto
 * otherwise. A missing year is NON-distinguishing — the safe error is "assume
 * duplicate". Implemented as one rule: stored keys sharing the candidate's
 * `title|surname|` prefix match unless both sides state a different year or
 * volume. (Full-vs-full then reduces to exact key equality.)
 *
 *   set -a; source .env.production.local; set +a
 *   npx tsx scripts/audit/edition-key-shadow-measure.ts [--since=2026-07-01]
 *     [--warehouse-sample=1000] [--limit=N] [--json]
 */
import 'dotenv/config';
import { MongoClient, type Collection, type Db, type Document } from 'mongodb';
import { normalizeTitle, normalizeAuthor, editionYear, extractVolume } from '../../src/lib/dedup';
import { buildEditionKey } from '../../src/lib/edition-key';

const argv = process.argv.slice(2);
const arg = (name: string, dflt: string) => argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] || dflt;
const SINCE = new Date(arg('since', '2026-07-01'));
const WAREHOUSE_SAMPLE = parseInt(arg('warehouse-sample', '1000'), 10);
const LIMIT = parseInt(arg('limit', '0'), 10); // 0 = full population
const JSON_OUT = argv.includes('--json');
const CONCURRENCY = 8;

interface Candidate {
  collection: 'books' | 'books_warehouse';
  id: string;
  title?: string;
  display_title?: string;
  author?: string;
  year?: number;
  published?: string;
  normalized_title?: string;
}

interface MatchRef {
  collection: string; id: string; title?: string; author?: string; year?: number | null;
  normalized_title?: string; edition_key?: string | null;
}

const PROJ = { id: 1, title: 1, display_title: 1, author: 1, year: 1, published: 1, normalized_title: 1, edition_key: 1 };

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Same reachability heuristic as dedup-replay-sample.ts: the stored ASCII
 * normalized_title is too short for tier 2 while a real title exists. */
function isNonLatin(c: Candidate): boolean {
  return !!c.title && normalizeTitle(c.title).length < 5;
}

function notSelf(c: Candidate) {
  return (m: { cn: string; doc: Document }) => !(m.cn === c.collection && (m.doc.id || String(m.doc._id)) === c.id);
}

function toRef(m: { cn: string; doc: Document }): MatchRef {
  return {
    collection: m.cn,
    id: m.doc.id || String(m.doc._id),
    title: m.doc.title,
    author: m.doc.author,
    year: editionYear(m.doc as { year?: number | null; published?: string | null }),
    normalized_title: m.doc.normalized_title,
    edition_key: Object.prototype.hasOwnProperty.call(m.doc, 'edition_key') ? m.doc.edition_key : undefined,
  };
}

/** Tier 2 of checkDuplicate(), verbatim semantics, self excluded. */
async function liveTier2(db: Db, c: Candidate): Promise<MatchRef[]> {
  const normTitle = normalizeTitle(c.title || '');
  const normAuthor = normalizeAuthor(c.author || '');
  if (normTitle.length < 5) return [];
  const candYear = editionYear(c);
  const candVol = extractVolume(c.display_title) ?? extractVolume(c.title);
  const out: { cn: string; doc: Document }[] = [];
  for (const cn of ['books', 'books_warehouse'] as const) {
    const rows = await db.collection(cn)
      .find({ normalized_title: normTitle, normalized_author: normAuthor }, { projection: PROJ })
      .limit(6).toArray();
    for (const doc of rows) {
      const tmYear = editionYear(doc as { year?: number | null; published?: string | null });
      const tmVol = extractVolume(doc.display_title) ?? extractVolume(doc.title);
      if (candYear != null && tmYear != null && candYear !== tmYear) continue;
      if (candVol != null && tmVol != null && candVol !== tmVol) continue;
      out.push({ cn, doc });
    }
  }
  return out.filter(notSelf(c)).map(toRef);
}

/** The proposed edition-key tier, self excluded. */
async function shadowTier(db: Db, c: Candidate): Promise<{ matches: MatchRef[]; blind?: string }> {
  const ek = buildEditionKey(c);
  if (!ek.key) return { matches: [], blind: ek.reason || 'unkeyable' };
  const { title, author, year, volume } = ek.parts;
  const prefix = new RegExp(`^${escapeRegex(`${title}|${author}|`)}`);
  const out: { cn: string; doc: Document }[] = [];
  for (const cn of ['books', 'books_warehouse'] as const) {
    const rows = await db.collection(cn)
      .find({ edition_key: prefix }, { projection: PROJ })
      .limit(25).toArray();
    for (const doc of rows) {
      // Stored key: `title|surname|year|vN`. Normalized parts never contain
      // '|' (normalization strips all punctuation), so a rsplit is safe.
      const segs = String(doc.edition_key).split('|');
      const volSeg = segs[segs.length - 1] || '';
      const yearSeg = segs[segs.length - 2] || '';
      const tmYear = yearSeg === '' ? null : parseInt(yearSeg, 10);
      const tmVol = volSeg === 'v' ? null : parseInt(volSeg.slice(1), 10);
      if (year != null && tmYear != null && year !== tmYear) continue;
      if (volume != null && tmVol != null && volume !== tmVol) continue;
      out.push({ cn, doc });
    }
  }
  return { matches: out.filter(notSelf(c)).map(toRef) };
}

type Verdict =
  | 'agree_clean' | 'agree_dup'
  | 'shadow_only_live_blind'   // live tier can't even query (non-Latin / short ASCII title)
  | 'shadow_only_author_form'  // same ASCII title, but whole-name normalized_author differs — surname caught it
  | 'shadow_only_other'        // Unicode title matched where the ASCII one didn't, or year/vol wildcard differences
  | 'live_only_unkeyable'      // candidate has no edition key at all
  | 'live_only_match_unkeyed'  // the doc live matched carries no stored edition_key (stamping gap, not a matcher gap)
  | 'live_only_surname_split'  // live matched a doc whose surname differs from candidate's
  | 'live_only_other';         // the flip would LOSE this catch — must stay ~0

interface Row {
  collection: string; id: string; title?: string; author?: string; year?: number | null;
  verdict: Verdict; live: MatchRef[]; shadow: MatchRef[]; nonLatin: boolean;
}

async function classify(db: Db, c: Candidate): Promise<Row> {
  const [live, shadow] = [await liveTier2(db, c), await shadowTier(db, c)];
  const liveDup = live.length > 0;
  const shadowDup = shadow.matches.length > 0;
  let verdict: Verdict;
  if (liveDup === shadowDup) {
    verdict = liveDup ? 'agree_dup' : 'agree_clean';
  } else if (shadowDup) {
    const normTitle = normalizeTitle(c.title || '');
    if (normTitle.length < 5) verdict = 'shadow_only_live_blind';
    else {
      // Same ASCII title on some shadow match => live's query key was the
      // author; the whole-name sorted form split what the surname unified.
      const normAuthor = normalizeAuthor(c.author || '');
      const authorForm = shadow.matches.some(
        (m) => m.normalized_title === normTitle && normalizeAuthor(m.author || '') !== normAuthor,
      );
      verdict = authorForm ? 'shadow_only_author_form' : 'shadow_only_other';
    }
  } else {
    if (shadow.blind) verdict = 'live_only_unkeyable';
    else if (live.some((m) => m.edition_key == null)) verdict = 'live_only_match_unkeyed';
    else {
      const surname = buildEditionKey(c).parts.author;
      const splitSurname = live.some((m) => buildEditionKey(m as Candidate).parts.author !== surname);
      verdict = splitSurname ? 'live_only_surname_split' : 'live_only_other';
    }
  }
  return {
    collection: c.collection, id: c.id, title: c.title, author: c.author,
    year: editionYear(c), verdict, live, shadow: shadow.matches, nonLatin: isNonLatin(c),
  };
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  }));
  return out;
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error('MONGODB_URI not set'); process.exit(1); }
  const client = new MongoClient(uri, { maxPoolSize: CONCURRENCY + 2 });
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || 'bookstore');

  const recentBooks = await db.collection('books').find(
    { content_type: { $ne: 'artwork' }, created_at: { $gte: SINCE }, title: { $nin: [null, ''] } },
    { projection: PROJ },
  ).toArray();
  const warehouse = await db.collection('books_warehouse').aggregate<Document>([
    { $match: { title: { $nin: [null, ''] } } },
    { $sample: { size: WAREHOUSE_SAMPLE } },
    { $project: PROJ },
  ]).toArray();

  let candidates: Candidate[] = [
    ...recentBooks.map((d) => ({ ...(d as Omit<Candidate, 'collection' | 'id'>), collection: 'books' as const, id: (d.id || String(d._id)) as string })),
    ...warehouse.map((d) => ({ ...(d as Omit<Candidate, 'collection' | 'id'>), collection: 'books_warehouse' as const, id: (d.id || String(d._id)) as string })),
  ];
  if (LIMIT > 0) candidates = candidates.slice(0, LIMIT);
  console.error(`population: ${recentBooks.length} books since ${SINCE.toISOString().slice(0, 10)} + ${warehouse.length} warehouse sample${LIMIT ? ` (capped ${LIMIT})` : ''}`);

  let done = 0;
  const rows = await pool(candidates, CONCURRENCY, async (c) => {
    const r = await classify(db, c);
    if (++done % 1000 === 0) console.error(`  ...${done}/${candidates.length}`);
    return r;
  });

  // Controls (lesson: a probe needs a positive control). Positive: keepers of
  // adjudicated duplicate pairs — BOTH matchers should flag them; the shadow
  // tier failing books the live tier catches here would block the flip on its
  // own. Negative: fabricated books that exist nowhere.
  const dupPointers = await db.collection('books').aggregate<Document>([
    { $match: { duplicate_of: { $exists: true, $nin: [null, ''] }, content_type: { $ne: 'artwork' }, title: { $nin: [null, ''] } } },
    { $sample: { size: 20 } },
    { $project: PROJ },
  ]).toArray();
  let posLive = 0, posShadow = 0;
  for (const d of dupPointers) {
    const c: Candidate = { ...(d as Omit<Candidate, 'collection' | 'id'>), collection: 'books', id: (d.id || String(d._id)) as string };
    if ((await liveTier2(db, c)).length) posLive++;
    if ((await shadowTier(db, c)).matches.length) posShadow++;
  }
  const fabricated: Candidate[] = [
    { collection: 'books', id: '_neg1', title: 'Zxq Phantasmagoria Nonexistens Codexicus', author: 'Nemo, Nusquam', year: 1234 },
    { collection: 'books', id: '_neg2', title: '虛構之書不存在的目錄編號九九九', author: '無名氏測試', year: 1234 },
  ];
  let negHits = 0;
  for (const f of fabricated) {
    if ((await liveTier2(db, f)).length || (await shadowTier(db, f)).matches.length) negHits++;
  }

  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.verdict] = (counts[r.verdict] || 0) + 1;
  const total = rows.length;
  const agree = (counts.agree_clean || 0) + (counts.agree_dup || 0);
  const nonLatinRows = rows.filter((r) => r.nonLatin);
  const nlAgree = nonLatinRows.filter((r) => r.verdict.startsWith('agree')).length;
  const nlShadowOnly = nonLatinRows.filter((r) => r.verdict.startsWith('shadow_only')).length;

  const sample = (v: Verdict, n = 8) => rows.filter((r) => r.verdict === v).slice(0, n)
    .map((r) => ({ collection: r.collection, id: r.id, title: (r.title || '').slice(0, 80), author: r.author, year: r.year,
      live: r.live.slice(0, 3), shadow: r.shadow.slice(0, 3) }));

  const summary = {
    date: new Date().toISOString().slice(0, 10),
    population: { books_since: SINCE.toISOString().slice(0, 10), books: recentBooks.length, warehouse: warehouse.length, measured: total },
    agreement_pct: total ? +((100 * agree) / total).toFixed(2) : null,
    counts,
    non_latin: { candidates: nonLatinRows.length, agree: nlAgree, shadow_only_catches: nlShadowOnly },
    controls: {
      positive: `live ${posLive}/${dupPointers.length}, shadow ${posShadow}/${dupPointers.length} known-dup keepers flagged`,
      negative: `${negHits}/${fabricated.length} fabricated books flagged (must be 0)`,
    },
    examples: {
      shadow_only_live_blind: sample('shadow_only_live_blind'),
      shadow_only_author_form: sample('shadow_only_author_form'),
      shadow_only_other: sample('shadow_only_other'),
      live_only_surname_split: sample('live_only_surname_split'),
      live_only_unkeyable: sample('live_only_unkeyable'),
      live_only_other: sample('live_only_other', 20),
    },
  };

  if (JSON_OUT) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`edition-key shadow measure — ${summary.date}, ${total} candidates`);
    console.log(`  agreement (same isDuplicate verdict): ${summary.agreement_pct}%`);
    console.log(`  verdicts: ${JSON.stringify(counts)}`);
    console.log(`  non-Latin stratum: ${nonLatinRows.length} candidates, ${nlShadowOnly} caught ONLY by the edition tier`);
    console.log(`  positive control: ${summary.controls.positive}`);
    console.log(`  negative control: ${summary.controls.negative}`);
    const loss = (counts.live_only_other || 0);
    console.log(`  regressions (live-only, unexplained): ${loss} ${loss === 0 ? '— safe to proceed to logging-first flip' : '<- READ THE EXAMPLES BEFORE FLIPPING'}`);
    for (const [k, v] of Object.entries(summary.examples)) {
      if (!v.length) continue;
      console.log(`  ${k} (${counts[k as Verdict] || 0}, first ${v.length}):`);
      for (const e of v) console.log(`    [${e.collection}] ${e.id}  ${JSON.stringify(e.title)} — ${e.author ?? ''}, ${e.year ?? '?'}${e.live.length ? ` live→${e.live.map((m) => m.id).join(',')}` : ''}${e.shadow.length ? ` shadow→${e.shadow.map((m) => m.id).join(',')}` : ''}`);
    }
  }

  await client.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
