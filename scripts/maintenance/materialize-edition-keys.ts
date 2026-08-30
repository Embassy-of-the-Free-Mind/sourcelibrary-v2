/**
 * materialize-edition-keys — write the edition layer onto `books`.
 *
 * Workstream A of #3258 / step 3 of #3102. Computes `edition_key`,
 * `edition_key_quality` and `edition_external_ids` from the canonical builder in
 * `src/lib/edition-key.ts` (single source of truth — do not reimplement the key
 * here; three divergent private copies is the problem this layer removes).
 *
 * Dry-run by DEFAULT. Nothing is written without `--apply`, and `--apply` takes
 * a backup of every field it is about to overwrite first, so `--restore` can put
 * the collection back exactly as it was.
 *
 *   DOTENV_CONFIG_PATH=.env.production.local npx tsx -r dotenv/config \
 *     scripts/maintenance/materialize-edition-keys.ts [flags]
 *
 * or, from a checkout with the env sourced:
 *
 *   set -a; source .env.production.local; set +a
 *   npx tsx scripts/maintenance/materialize-edition-keys.ts            # dry run + report
 *   npx tsx scripts/maintenance/materialize-edition-keys.ts --apply
 *   npx tsx scripts/maintenance/materialize-edition-keys.ts --restore=<backup.jsonl>
 *   npx tsx scripts/maintenance/materialize-edition-keys.ts --clear --apply
 *
 * Flags:
 *   --apply            actually write (default: report only)
 *   --clear            $unset the three fields instead of computing them
 *   --restore=PATH     replay a backup file written by a previous --apply
 *   --limit=N          only process the first N books (smoke test)
 *   --out=PATH         where to write the cluster report (default scripts/output/)
 *   --json             machine-readable summary on stdout
 */
import { MongoClient, type AnyBulkWriteOperation, type Collection, type Document } from 'mongodb';
import { createWriteStream, existsSync, mkdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { buildEditionKey, ustcEditionLink, type EditionKeyQuality, type UstcInput } from '../../src/lib/edition-key';

const argv = process.argv.slice(2);
const has = (f: string) => argv.includes(f);
const val = (f: string) => argv.find((a) => a.startsWith(`${f}=`))?.split('=').slice(1).join('=');

const APPLY = has('--apply');
const CLEAR = has('--clear');
const RESTORE = val('--restore');
const LIMIT = val('--limit') ? parseInt(val('--limit')!, 10) : 0;
const JSON_OUT = has('--json');

const OUT_DIR = join(process.cwd(), 'scripts/output');
const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

const log = (...a: unknown[]) => { if (!JSON_OUT) console.log(...a); };

/** Fields this script owns. Backup and --clear must stay in sync with this list. */
const OWNED_FIELDS = ['edition_key', 'edition_key_quality', 'edition_external_ids'] as const;

interface BookRow extends UstcInput {
  id?: string;
  _id: unknown;
  slug?: string;
  visible?: boolean;
  edition_key?: string | null;
  edition_key_quality?: string | null;
  edition_external_ids?: Record<string, unknown> | null;
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error('MONGODB_URI not set'); process.exit(1); }
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || 'bookstore');
  const books = db.collection('books');

  if (RESTORE) { await restore(books, RESTORE); await client.close(); return; }

  // Artworks have their own sha1/CLIP identity lane — they are not editions.
  const scope: Document = { content_type: { $ne: 'artwork' } };

  if (CLEAR) {
    if (!APPLY) {
      const n = await books.countDocuments({ edition_key: { $exists: true } });
      log(`--clear dry run: would $unset ${OWNED_FIELDS.join(', ')} on ${n} books. Re-run with --apply.`);
      await client.close();
      return;
    }
    const unset = Object.fromEntries(OWNED_FIELDS.map((f) => [f, '']));
    const r = await books.updateMany({ edition_key: { $exists: true } }, { $unset: unset });
    log(`cleared edition fields on ${r.modifiedCount} books`);
    await client.close();
    return;
  }

  const cursor = books.find(scope, {
    projection: {
      id: 1, slug: 1, title: 1, display_title: 1, author: 1, year: 1, published: 1,
      visible: 1, ustc_id: 1, 'ustc_match.ustc_year': 1, 'ustc_match.confidence': 1,
      edition_key: 1, edition_key_quality: 1, edition_external_ids: 1,
    },
  });
  if (LIMIT) cursor.limit(LIMIT);

  // ---- pass 1: compute -----------------------------------------------------
  const quality: Record<string, number> = { full: 0, 'no-year': 0, 'no-author': 0, 'title-only': 0 };
  const unkeyable: Record<string, number> = {};
  const ustcScope: Record<string, number> = { edition: 0, unverified: 0 };
  const clusters = new Map<string, { ids: string[]; visible: number; quality: EditionKeyQuality }>();

  let scanned = 0;
  let keyed = 0;
  let unchanged = 0;
  const ops: AnyBulkWriteOperation<Document>[] = [];
  const backupRows: string[] = [];

  for await (const raw of cursor) {
    const b = raw as unknown as BookRow;
    scanned++;
    const id = b.id || String(b._id);

    const built = buildEditionKey(b);
    const link = ustcEditionLink(b);
    if (link) ustcScope[link.scope]++;

    if (!built.key) {
      unkeyable[built.reason || 'unknown'] = (unkeyable[built.reason || 'unknown'] || 0) + 1;
    } else {
      keyed++;
      quality[built.quality!]++;
      const c = clusters.get(built.key);
      if (c) { c.ids.push(id); if (b.visible) c.visible++; }
      else clusters.set(built.key, { ids: [id], visible: b.visible ? 1 : 0, quality: built.quality! });
    }

    // Only touch documents whose stored value actually differs — a no-op
    // bulkWrite over 100k docs is pure churn, and modifiedCount is how we
    // verify the run did what it claims. One asymmetry: an ABSENT field is
    // never "unchanged", even when the computed value is null — the convention
    // (src/lib/identity-fields.ts) is field-absent = never computed, field-null
    // = computed-and-unkeyable, and the identity worker's queue query depends
    // on unkeyable books getting their explicit null stamped exactly once.
    const hasField = Object.prototype.hasOwnProperty.call(raw, 'edition_key');
    const nextExternal = link ? { ustc: link.ustc, ustc_scope: link.scope, ustc_reason: link.reason } : null;
    const sameKey = (b.edition_key ?? null) === built.key;
    const sameQuality = (b.edition_key_quality ?? null) === (built.quality ?? null);
    const sameExternal = JSON.stringify(b.edition_external_ids ?? null) === JSON.stringify(nextExternal);
    if (hasField && sameKey && sameQuality && sameExternal) { unchanged++; continue; }

    if (APPLY) {
      backupRows.push(JSON.stringify({
        id,
        edition_key: b.edition_key ?? null,
        edition_key_quality: b.edition_key_quality ?? null,
        edition_external_ids: b.edition_external_ids ?? null,
      }));
      const set: Document = { edition_key: built.key, edition_key_quality: built.quality };
      const unset: Document = {};
      if (nextExternal) set.edition_external_ids = nextExternal;
      else if (b.edition_external_ids != null) unset.edition_external_ids = '';
      ops.push({
        updateOne: {
          filter: { _id: b._id as never },
          update: Object.keys(unset).length ? { $set: set, $unset: unset } : { $set: set },
        },
      });
    }
  }

  // ---- pass 2: what the clusters look like --------------------------------
  let multi = 0, multiVisible = 0, extraVisibleCopies = 0, multiFullQuality = 0;
  const biggest: { key: string; n: number; visible: number; quality: string }[] = [];
  for (const [key, c] of clusters) {
    if (c.ids.length < 2) continue;
    multi++;
    if (c.quality === 'full') multiFullQuality++;
    if (c.visible >= 2) { multiVisible++; extraVisibleCopies += c.visible - 1; }
    biggest.push({ key, n: c.ids.length, visible: c.visible, quality: c.quality });
  }
  biggest.sort((a, b) => b.n - a.n);

  const summary = {
    date: stamp,
    applied: APPLY,
    scanned,
    keyed,
    unkeyable,
    unchanged,
    quality,
    ustcScope,
    distinctKeys: clusters.size,
    clustersGe2: multi,
    clustersGe2FullQuality: multiFullQuality,
    bothVisibleClusters: multiVisible,
    extraVisibleCopies,
    written: 0,
  };

  // ---- write ---------------------------------------------------------------
  if (APPLY && ops.length) {
    if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
    const backupPath = join(OUT_DIR, `edition-key-backup-${stamp}.jsonl`);
    const bs = createWriteStream(backupPath);
    for (const r of backupRows) bs.write(r + '\n');
    await new Promise((res) => bs.end(res));
    log(`backup (${backupRows.length} rows) -> ${backupPath}`);

    for (let i = 0; i < ops.length; i += 1000) {
      const r = await books.bulkWrite(ops.slice(i, i + 1000), { ordered: false });
      summary.written += r.modifiedCount;
      log(`  wrote ${summary.written}/${ops.length}`);
    }

    await books.createIndex({ edition_key: 1 });
    await books.createIndex({ edition_key: 1, visible: 1 });
    log('indexes ensured on edition_key');
  }

  // ---- report --------------------------------------------------------------
  const outPath = val('--out') || join(OUT_DIR, `edition-key-clusters-${stamp}.json`);
  if (!existsSync(dirname(outPath))) mkdirSync(dirname(outPath), { recursive: true });
  const report = {
    summary,
    largestClusters: biggest.slice(0, 40),
    bothVisibleClusters: [...clusters.entries()]
      .filter(([, c]) => c.visible >= 2)
      .map(([key, c]) => ({ key, quality: c.quality, ids: c.ids })),
  };
  const rs = createWriteStream(outPath);
  rs.write(JSON.stringify(report, null, 2));
  await new Promise((res) => rs.end(res));

  if (JSON_OUT) {
    console.log(JSON.stringify(summary));
  } else {
    console.log('');
    console.log(`edition_key materialization — ${stamp} ${APPLY ? '(APPLIED)' : '(dry run)'}`);
    console.log(`  scanned:        ${scanned}`);
    console.log(`  keyed:          ${keyed}  (unkeyable: ${JSON.stringify(unkeyable)})`);
    console.log(`  quality:        ${JSON.stringify(quality)}`);
    console.log(`  distinct keys:  ${clusters.size}`);
    console.log(`  clusters >=2:   ${multi}  (${multiFullQuality} at full quality)`);
    console.log(`  both-visible:   ${multiVisible} clusters, +${extraVisibleCopies} extra visible copies`);
    console.log(`                  (duplicate-integrity-check.mjs baseline: 296 / +340 on 2026-07-19)`);
    console.log(`  USTC links:     ${ustcScope.edition} edition-authority, ${ustcScope.unverified} unverified`);
    console.log(`  already correct: ${unchanged}`);
    if (APPLY) console.log(`  WRITTEN:        ${summary.written}`);
    else console.log(`  would write:    ${ops.length === 0 ? scanned - unchanged : ops.length} (re-run with --apply)`);
    console.log(`  report ->       ${outPath}`);
  }

  await client.close();
}

async function restore(books: Collection<Document>, path: string) {
  const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
  const ops: AnyBulkWriteOperation<Document>[] = [];
  for (const line of lines) {
    const row = JSON.parse(line) as Record<string, unknown> & { id: string };
    const set: Document = {};
    const unset: Document = {};
    for (const f of OWNED_FIELDS) {
      if (row[f] == null) unset[f] = '';
      else set[f] = row[f];
    }
    ops.push({
      updateOne: {
        filter: { id: row.id },
        update: Object.keys(set).length ? { $set: set, $unset: unset } : { $unset: unset },
      },
    });
  }
  let restored = 0;
  for (let i = 0; i < ops.length; i += 1000) {
    const r = await books.bulkWrite(ops.slice(i, i + 1000), { ordered: false });
    restored += r.modifiedCount;
  }
  console.log(`restored ${restored} of ${lines.length} rows from ${path}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
