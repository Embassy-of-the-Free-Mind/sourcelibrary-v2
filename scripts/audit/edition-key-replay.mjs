#!/usr/bin/env node
/**
 * edition-key replay — what a change to the edition-key builder does to the
 * corpus, BEFORE the change merges (#4444, #6019 decision 6).
 *
 * PRIOR ART: scripts/maintenance/edition-key-integrity.ts — reports DRIFT
 * (stored key != what the builder on disk computes), which gives the count of
 * keys a change would rewrite but not which duplicate groups it merges or
 * splits, and it reads only `books`, not `books_warehouse`.
 * scripts/maintenance/materialize-edition-keys.ts (dry run) reports the cluster
 * totals after a change, not the difference from before. scripts/audit/
 * dedup-replay-sample.ts replays import-time `checkDuplicate()` on a sample; it
 * does not compare two versions of the key. This script defines no normalizer:
 * it loads `scripts/lib/identity-fields.mjs` twice, once from a git ref and
 * once from the working tree, and compares what they compute.
 *
 * THIS SCRIPT READS AND REPORTS. IT NEVER WRITES TO THE DATABASE.
 *
 *   node --env-file=.env.production.local scripts/audit/edition-key-replay.mjs snapshot [--out <dir>]
 *   node scripts/audit/edition-key-replay.mjs diff [--before origin/main] [--out <dir>]
 *
 * `snapshot` walks `books` and `books_warehouse` once each, by `_id`, one BSON
 * type at a time (a range query on `_id` is type-bracketed: `$gt: ObjectId`
 * never returns the string-`_id` rows), and caches the key inputs locally.
 * `diff` is offline. Groups are counted over both collections together, because
 * the import gate's edition-key tier queries both.
 */
import { execFileSync } from 'node:child_process';
import { createReadStream, createWriteStream, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const argv = process.argv.slice(2);
const cmd = argv[0];
const opt = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const OUT = opt('out', '/tmp/edition-key-replay');
const BEFORE = opt('before', 'origin/main');
const SNAPSHOT = join(OUT, 'snapshot.jsonl');
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TWIN_FILES = ['scripts/lib/identity-fields.mjs', 'scripts/lib/dedup-normalize.mjs'];

const PROJECTION = {
  _id: 1, id: 1, title: 1, display_title: 1, author: 1, year: 1, published: 1,
  visible: 1, pages_count: 1, content_type: 1, duplicate_of: 1,
  edition_key: 1, edition_key_quality: 1, normalized_title: 1, normalized_author: 1,
};

async function snapshot() {
  const { MongoClient } = await import('mongodb');
  if (!process.env.MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }
  mkdirSync(OUT, { recursive: true });
  const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 2 });
  await client.connect();
  const db = client.db('bookstore');
  const out = createWriteStream(SNAPSHOT);
  for (const name of ['books', 'books_warehouse']) {
    const coll = db.collection(name);
    let n = 0;
    for (const type of ['objectId', 'string']) {
      let last = null;
      for (;;) {
        const filter = last == null ? { _id: { $type: type } } : { _id: { $type: type, $gt: last } };
        const batch = await coll.find(filter, { projection: PROJECTION }).sort({ _id: 1 }).limit(5000).toArray();
        if (!batch.length) break;
        for (const b of batch) {
          if (b.content_type === 'artwork') continue; // own identity lane, never keyed
          out.write(JSON.stringify({ ...b, _id: String(b._id), coll: name, has_key: 'edition_key' in b }) + '\n');
          n++;
        }
        last = batch[batch.length - 1]._id;
      }
    }
    console.log(`${name}: ${n} non-artwork rows`);
  }
  await new Promise((res) => out.end(res));
  await client.close();
  console.log(`snapshot -> ${SNAPSHOT}`);
}

/** The key builder as it stands at a git ref, loaded from a scratch copy. */
async function loadBuilderAt(ref) {
  const dir = mkdtempSync(join(tmpdir(), 'edition-key-before-'));
  for (const f of TWIN_FILES) {
    writeFileSync(join(dir, f.split('/').pop()), execFileSync('git', ['-C', REPO, 'show', `${ref}:${f}`]));
  }
  return import(pathToFileURL(join(dir, 'identity-fields.mjs')).href);
}

const isLive = (b) => b.coll === 'books' && b.visible === true && (b.pages_count || 0) > 0;

async function diff() {
  if (!existsSync(SNAPSHOT)) { console.error(`no snapshot at ${SNAPSHOT} — run \`snapshot\` first`); process.exit(1); }
  const before = await loadBuilderAt(BEFORE);
  const after = await import(pathToFileURL(join(REPO, TWIN_FILES[0])).href);

  const rows = [];
  for await (const line of createInterface({ input: createReadStream(SNAPSHOT) })) {
    if (!line) continue;
    const b = JSON.parse(line);
    const o = before.buildEditionKey(b), n = after.buildEditionKey(b);
    rows.push({
      _id: b._id, id: b.id || b._id, coll: b.coll, live: isLive(b), title: b.title, author: b.author,
      stored: b.edition_key ?? null, has_key: b.has_key,
      old: o.key, new: n.key, oldQ: o.quality, newQ: n.quality, oldSurname: o.parts.author, newSurname: n.parts.author,
    });
  }

  const group = (field) => {
    const m = new Map();
    for (const r of rows) {
      if (!r[field]) continue;
      if (!m.has(r[field])) m.set(r[field], []);
      m.get(r[field]).push(r);
    }
    return m;
  };
  const oldGroups = group('old'), newGroups = group('new'), storedGroups = group('stored');

  // A MERGE is a group under the `to` key holding books that did not share a
  // `from` key; a SPLIT is a `from` group whose members no longer all share one.
  const regroup = (from, to, fromGroups, toGroups) => {
    const moved = rows.filter((r) => r[from] !== r[to]);
    const merges = [], splits = [];
    for (const key of new Set(moved.map((r) => r[to]).filter(Boolean))) {
      const g = toGroups.get(key);
      if (g.length > 1 && new Set(g.map((r) => r[from])).size > 1) merges.push({ key, members: g });
    }
    for (const key of new Set(moved.map((r) => r[from]).filter(Boolean))) {
      const g = fromGroups.get(key);
      if (g.length > 1 && new Set(g.map((r) => r[to])).size > 1) splits.push({ key, members: g });
    }
    return { moved, merges, splits };
  };
  const count = ({ merges, splits }) => ({
    merges: { groups: merges.length, books: merges.reduce((s, m) => s + m.members.length, 0), with_2plus_live: merges.filter((m) => m.members.filter((r) => r.live).length > 1).length },
    splits: { groups: splits.length, books: splits.reduce((s, m) => s + m.members.length, 0), with_2plus_live: splits.filter((m) => m.members.filter((r) => r.live).length > 1).length },
  });
  // The change itself: builder at the ref against the builder on disk.
  const change = regroup('old', 'new', oldGroups, newGroups);
  const { moved: changed, merges, splits } = change;
  // What a re-stamp does: stored value against the builder on disk. This also
  // carries drift the change did not cause (a year or author edited after the
  // key was stamped), so it is reported apart.
  const restamp = regroup('stored', 'new', storedGroups, newGroups);

  const tally = (list, f) => {
    const t = {};
    for (const r of list) { const k = f(r); t[k] = (t[k] || 0) + 1; }
    return Object.fromEntries(Object.entries(t).sort((a, b) => b[1] - a[1]));
  };
  const clusters = (m) => [...m.values()].filter((g) => g.length > 1).length;
  const bothLive = (m) => [...m.values()].filter((g) => g.filter((r) => r.live).length > 1).length;
  const brief = (r) => ({ id: r.id, coll: r.coll, live: r.live, title: String(r.title || '').slice(0, 90), author: r.author, old: r.old, new: r.new });

  const summary = {
    before_ref: BEFORE,
    before_sha: execFileSync('git', ['-C', REPO, 'rev-parse', '--short', BEFORE]).toString().trim(),
    rows: rows.length,
    rows_by_collection: tally(rows, (r) => r.coll),
    live_books: rows.filter((r) => r.live).length,
    keys_changed: changed.length,
    keys_changed_by_collection: tally(changed, (r) => r.coll),
    keys_changed_live: changed.filter((r) => r.live).length,
    quality_changed: tally(changed.filter((r) => r.oldQ !== r.newQ), (r) => `${r.oldQ} -> ${r.newQ}`),
    changed_by_old_surname: tally(changed, (r) => r.oldSurname || '(empty)'),
    groups_of_2plus: { before: clusters(oldGroups), after: clusters(newGroups) },
    groups_with_2plus_live: { before: bothLive(oldGroups), after: bothLive(newGroups) },
    ...count(change),
    restamp: {
      rows_rewritten: restamp.moved.length,
      rows_rewritten_by_collection: tally(restamp.moved, (r) => r.coll),
      rows_rewritten_live: restamp.moved.filter((r) => r.live).length,
      of_which_from_this_change: restamp.moved.filter((r) => r.old !== r.new).length,
      never_stamped: rows.filter((r) => !r.has_key).length,
      groups_of_2plus: { stored: clusters(storedGroups), after: clusters(newGroups) },
      groups_with_2plus_live: { stored: bothLive(storedGroups), after: bothLive(newGroups) },
      ...count(restamp),
    },
  };

  const outPath = join(OUT, 'replay.json');
  writeFileSync(outPath, JSON.stringify({
    summary,
    merges: merges.map((m) => ({ key: m.key, members: m.members.map(brief) })),
    splits: splits.map((m) => ({ key: m.key, members: m.members.map(brief) })),
    changed: changed.map(brief),
    restamp_merges: restamp.merges.map((m) => ({ key: m.key, members: m.members.map((r) => ({ ...brief(r), stored: r.stored })) })),
    restamp_splits: restamp.splits.map((m) => ({ key: m.key, members: m.members.map((r) => ({ ...brief(r), stored: r.stored })) })),
  }, null, 1));
  console.log(JSON.stringify(summary, null, 2));
  console.log(`detail -> ${outPath}`);
}

if (cmd === 'snapshot') await snapshot();
else if (cmd === 'diff') await diff();
else { console.error('usage: edition-key-replay.mjs snapshot|diff [--before <ref>] [--out <dir>]'); process.exit(1); }
