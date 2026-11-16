#!/usr/bin/env node
// PRIOR ART: the colophon-4809 job (2026-11-07) hid 40 books through setPublication() with no committed
// script; its record is ops rights/2026-11-08-colophon-review.json. scripts/lib/publication.mjs is the one
// writer and is used here unchanged. This script carries out the 2026-11-13 decision on the nine books that
// job left for a person (6 UNCERTAIN + 3 review_flags), with a backup and a revert it did not have.
/**
 * v2#4809 — colophon review, the nine books left over (decision 2026-11-13, default taken, v3#90):
 *   HIDE    the five UNCERTAIN books whose imprint is after 1930 (grey-zone rule), with the same
 *           publication fields colophon-4809 used for its 40: state hidden, reason `rights`,
 *           note `copyright-review: <publisher> <year>`, issue 4809.
 *   KEEP    the 1930 Beverly Hall typeset reprint (Eulis!) public — nothing written.
 *   RESTORE the 1949 Theosophical University Press reprint of the 1792 edition, and the Tattvartha Sutra
 *           whose p5 notice allows reproduction with source credit — state public.
 *   KEEP    the 1994 Science and Health hidden — nothing written.
 * Hiding and restoring only; nothing is deleted.
 *
 * Each write is guarded on the state the review saw (`from`); a book that moved since is SKIPPED.
 * The backup holds every legacy + publication field as it was, and --revert puts them back verbatim
 * (setPublication cannot: a restore would lose the earlier publication note).
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/maintenance/colophon-decision-4809.mjs              dry run
 *   … --apply --backup=<path.json>            write, then evict the nine books' cached pages
 *   … --revert=<path.json> [--apply]
 */
import { MongoClient } from 'mongodb';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { setPublication, legacyPublication } from '../lib/publication.mjs';
import { revalidateBookPages } from '../lib/revalidate.mjs';
import { recordSweepAction } from '../lib/sweep-log.mjs';

const RUN = 'colophon-decision-4809';
const BY = 'claude:dec-data-90';
const ISSUE = 4809;
const ROWS = [
  { id: '6a3e763e28fae891bf27ce0e', act: 'hide', from: 'public', note: 'copyright-review: 1973 scan, catalogue misnames it (uncertain; grey-zone default 2026-11-13)' },
  { id: '6a3e76bdc7e5622c3d0bc3ca', act: 'hide', from: 'public', note: 'copyright-review: The Theosophical Publishing House, Adyar 1973 (uncertain; grey-zone default 2026-11-13)' },
  { id: '69af21afa854057228c07c20', act: 'hide', from: 'public', note: 'copyright-review: Harvard University Press / William Heinemann 1977 (uncertain; grey-zone default 2026-11-13)' },
  { id: '6a3e761628fae891bf27c80e', act: 'hide', from: 'public', note: 'copyright-review: University of Chicago Press 1990s (uncertain; grey-zone default 2026-11-13)' },
  { id: '69af21ad7c27d4b637fedb65', act: 'hide', from: 'public', note: 'copyright-review: Harvard University Press / William Heinemann 1976 (uncertain; grey-zone default 2026-11-13)' },
  { id: '69de0d31f44bb4908bdcdb28', act: 'keep', from: 'public', why: '1930 typeset reprint, before the 1931 cutoff' },
  { id: '6a1aa4e6c8638d1ea5c80240', act: 'restore', from: 'hidden', why: '1949 verbatim reprint of the 1792 edition; no copyright notice quoted' },
  { id: '699257e64d1ab664f1c94b84', act: 'restore', from: 'hidden', why: 'p5 notice allows reproduction with source credit' },
  { id: '6a5837d96701425b993051ba', act: 'keep', from: 'hidden', why: '1994 reprint, copyright claimed on index, notes and cover' },
];
const SNAP = ['visible', 'hidden', 'hidden_reason', 'hidden_at', 'publication'];

const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, ...v] = a.slice(2).split('='); return [k, v.length ? v.join('=') : true]; }));
const APPLY = 'apply' in args;
const mc = new MongoClient(process.env.MONGODB_URI);
await mc.connect();
const db = mc.db(process.env.MONGODB_DB || 'bookstore');
const books = db.collection('books');

try {
  if (args.revert) {
    const bk = JSON.parse(readFileSync(args.revert, 'utf8'));
    console.log(`revert ${bk.rows.length} books${APPLY ? '' : ' (dry run)'}`);
    for (const r of bk.rows) {
      const set = {}, unset = {};
      for (const f of SNAP) (r.before[f] === undefined || r.before[f] === '__ABSENT__') ? (unset[f] = '') : (set[f] = r.before[f]);
      if (set.hidden_at) set.hidden_at = new Date(set.hidden_at);
      if (set.publication?.since) set.publication.since = new Date(set.publication.since);
      console.log(`  ${r.id} → ${JSON.stringify(set.publication?.state ?? (set.visible ? 'public' : '?'))}`);
      if (APPLY) await books.updateOne({ id: r.id }, { $set: { ...set, updated_at: new Date() }, ...(Object.keys(unset).length ? { $unset: unset } : {}) });
    }
    if (APPLY) await revalidateBookPages(bk.rows.map((r) => ({ id: r.id, slug: r.slug })));
  } else {
    if (APPLY && (!args.backup || existsSync(args.backup))) { console.error('--backup=<new path> required with --apply'); process.exit(2); }
    const docs = new Map((await books.find({ id: { $in: ROWS.map((r) => r.id) } }).toArray()).map((d) => [d.id, d]));
    const plan = [];
    for (const r of ROWS) {
      const d = docs.get(r.id);
      if (!d) { console.log(`SKIP ${r.id}: not found`); continue; }
      const cur = legacyPublication(d).state;
      const line = `${r.act.padEnd(7)} ${r.id} ${cur.padEnd(7)} ${String(d.published).padEnd(5)} ${String(d.title).slice(0, 60)}`;
      if (cur !== r.from) { console.log(`SKIP    ${line}  (expected ${r.from})`); continue; }
      console.log(line);
      if (r.act !== 'keep') plan.push({ r, d });
    }
    console.log(`\nwrites: ${plan.length} (hide ${plan.filter((p) => p.r.act === 'hide').length}, restore ${plan.filter((p) => p.r.act === 'restore').length})`);
    if (!APPLY) { console.log('DRY RUN: nothing written.'); }
    else {
      writeFileSync(args.backup, JSON.stringify({ run: RUN, at: new Date().toISOString(),
        rows: plan.map(({ r, d }) => ({ id: d.id, slug: d.slug ?? null, act: r.act, before: Object.fromEntries(SNAP.map((f) => [f, d[f] === undefined ? '__ABSENT__' : d[f]])) })) }, null, 1));
      console.log(`backup: ${args.backup}`);
      for (const { r, d } of plan) {
        await recordSweepAction(db, { sweep: RUN, book_id: d.id, action: r.act, detail: { note: r.note ?? null, why: r.why ?? null, before: legacyPublication(d) } });
        const opts = r.act === 'hide'
          ? { state: 'hidden', reason: 'rights', note: r.note, by: BY, issue: ISSUE, from: ['public'], evict: false }
          : { state: 'public', note: `colophon review 2026-11-13: ${r.why}`, by: BY, issue: ISSUE, from: ['hidden'], evict: false };
        const res = await setPublication(db, d.id, opts);
        console.log(`  ${r.act} ${d.id} ${res.status}`);
      }
      const fresh = await books.find({ id: { $in: plan.map((p) => p.d.id) } }, { projection: { id: 1, slug: 1, visible: 1, hidden_reason: 1, 'publication.state': 1 } }).toArray();
      for (const f of fresh) console.log(`  readback ${f.id} visible=${f.visible} state=${f.publication?.state} hidden_reason=${f.hidden_reason ?? '-'}`);
      const ev = await revalidateBookPages(fresh.map((f) => ({ id: f.id, slug: f.slug })));
      console.log(`evicted: ${JSON.stringify(ev?.revalidated ?? ev)}`);
    }
  }
} finally { await mc.close(); }
