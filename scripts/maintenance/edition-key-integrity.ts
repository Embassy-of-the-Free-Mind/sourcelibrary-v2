/**
 * edition-key-integrity — the validator for the edition layer.
 *
 * Every layer of the identity stack gets three things: a writer convention, an
 * integrity script, and a human queue (#3258 workstream F — the pattern proven
 * on `duplicate_of` 2026-07-19). This is the integrity script.
 *
 * It answers four questions:
 *   1. DRIFT      — does the stored key still equal what the builder computes?
 *                   A non-zero count means a writer path set title/author/year
 *                   without recomputing, so the layer is quietly lying.
 *   2. COVERAGE   — how many keyable books carry no key (missed by the sweep).
 *   3. CONFLICT   — clusters whose members disagree on `work_id`. Same edition
 *                   but different work is a contradiction: one of the two
 *                   layers is wrong, and it is always worth a human look.
 *   4. QUEUE      — both-visible clusters, the keeper-choice backlog.
 *
 *   set -a; source .env.production.local; set +a
 *   npx tsx scripts/maintenance/edition-key-integrity.ts [--strict] [--json]
 *
 * `--strict` exits 1 on drift or on a trusted-tier work_id conflict — safe for
 * CI. Coverage gaps and the queue are reported but never fail the run; they are
 * backlog, not corruption.
 */
import { MongoClient, type Document } from 'mongodb';
import { createWriteStream, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { buildEditionKey, isTrustedEditionKey, ustcEditionLink, type UstcInput } from '../../src/lib/edition-key';

const argv = process.argv.slice(2);
const STRICT = argv.includes('--strict');
const JSON_OUT = argv.includes('--json');

const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
const OUT_DIR = join(process.cwd(), 'scripts/output');

interface Row extends UstcInput {
  id?: string;
  _id: unknown;
  slug?: string;
  visible?: boolean;
  work_id?: string | null;
  edition_key?: string | null;
  edition_key_quality?: string | null;
  edition_external_ids?: { ustc?: string; ustc_scope?: string } | null;
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error('MONGODB_URI not set'); process.exit(1); }
  const client = new MongoClient(uri);
  await client.connect();
  const books = client.db(process.env.MONGODB_DB || 'bookstore').collection('books');

  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  const detailPath = join(OUT_DIR, `edition-key-integrity-${stamp}.jsonl`);
  const detail = createWriteStream(detailPath);
  const row = (o: Document) => detail.write(JSON.stringify(o) + '\n');

  const cursor = books.find(
    { content_type: { $ne: 'artwork' } },
    { projection: {
      id: 1, slug: 1, title: 1, display_title: 1, author: 1, year: 1, published: 1,
      visible: 1, work_id: 1, ustc_id: 1, 'ustc_match.ustc_year': 1, 'ustc_match.confidence': 1,
      edition_key: 1, edition_key_quality: 1, edition_external_ids: 1,
    } }
  );

  let scanned = 0, drift = 0, qualityDrift = 0, missing = 0, unkeyable = 0, staleUstc = 0;
  const clusters = new Map<string, { ids: string[]; visible: string[]; works: Set<string>; trusted: boolean }>();

  for await (const raw of cursor) {
    const b = raw as unknown as Row;
    scanned++;
    const id = b.id || String(b._id);
    const built = buildEditionKey(b);

    // Convention (src/lib/identity-fields.ts): field absent = never computed
    // (missing — the identity worker's queue); field null = computed,
    // unkeyable (correct state for a stub title, NOT missing).
    const hasField = Object.prototype.hasOwnProperty.call(raw, 'edition_key');
    if (!built.key) {
      unkeyable++;
      if (b.edition_key) { drift++; row({ check: 'key-on-unkeyable-book', id, slug: b.slug, stored: b.edition_key }); }
      else if (!hasField) { missing++; row({ check: 'missing-key', id, slug: b.slug, computed: null }); }
      continue;
    }
    if (!b.edition_key) {
      missing++;
      row({ check: 'missing-key', id, slug: b.slug, computed: built.key });
      continue;
    }
    if (b.edition_key !== built.key) {
      drift++;
      row({ check: 'key-drift', id, slug: b.slug, stored: b.edition_key, computed: built.key });
    } else if (b.edition_key_quality !== built.quality) {
      qualityDrift++;
      row({ check: 'quality-drift', id, slug: b.slug, stored: b.edition_key_quality, computed: built.quality });
    }

    const link = ustcEditionLink(b);
    const storedScope = b.edition_external_ids?.ustc_scope ?? null;
    if ((link?.scope ?? null) !== storedScope) {
      staleUstc++;
      row({ check: 'ustc-scope-drift', id, slug: b.slug, stored: storedScope, computed: link?.scope ?? null });
    }

    const c = clusters.get(built.key) || { ids: [], visible: [], works: new Set<string>(), trusted: isTrustedEditionKey(built.quality) };
    c.ids.push(id);
    if (b.visible) c.visible.push(id);
    if (b.work_id) c.works.add(b.work_id);
    clusters.set(built.key, c);
  }

  let bothVisible = 0, extraCopies = 0, workConflicts = 0, trustedWorkConflicts = 0;
  for (const [key, c] of clusters) {
    if (c.visible.length >= 2) {
      bothVisible++;
      extraCopies += c.visible.length - 1;
      row({ check: 'both-visible-same-edition', key, trusted: c.trusted, members: c.visible });
    }
    // Same edition, two work_ids — one of the two layers is wrong.
    if (c.works.size > 1) {
      workConflicts++;
      if (c.trusted) trustedWorkConflicts++;
      row({ check: 'work-id-conflict', key, trusted: c.trusted, works: [...c.works], members: c.ids });
    }
  }

  detail.end();

  const summary = {
    date: stamp,
    scanned,
    unkeyable,
    missingKey: missing,
    keyDrift: drift,
    qualityDrift,
    ustcScopeDrift: staleUstc,
    distinctKeys: clusters.size,
    bothVisibleClusters: bothVisible,
    extraVisibleCopies: extraCopies,
    workIdConflicts: workConflicts,
    workIdConflictsTrusted: trustedWorkConflicts,
  };

  if (JSON_OUT) {
    console.log(JSON.stringify(summary));
  } else {
    console.log(`edition_key integrity — ${stamp}`);
    console.log(`  scanned: ${scanned}  (unkeyable by design: ${unkeyable})`);
    console.log(`  missing key:      ${missing}   ${missing ? '<- run materialize-edition-keys.ts --apply' : ''}`);
    console.log(`  KEY DRIFT:        ${drift}     ${drift ? '<- a writer changed title/author/year without recomputing' : ''}`);
    console.log(`  quality drift:    ${qualityDrift}`);
    console.log(`  USTC scope drift: ${staleUstc}`);
    console.log(`  distinct editions: ${clusters.size}`);
    console.log(`  both-visible clusters: ${bothVisible} (+${extraCopies} extra copies) — keeper-choice queue`);
    console.log(`  work_id conflicts: ${workConflicts} (${trustedWorkConflicts} at full quality) — same edition, two works`);
    console.log(`  detail -> ${detailPath}`);
  }

  await client.close();
  if (STRICT && (drift > 0 || trustedWorkConflicts > 0)) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
