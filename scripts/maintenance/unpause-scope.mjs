#!/usr/bin/env node
// Manage selective-unpause scopes ADDITIVELY (multi-session safe).
//
// The pipeline pause is global; selective unpause lets specific books run while
// the rest stay paused. Because ~10 Claude sessions share this DB, scopes are
// namespaced under processing_control.allow_scopes['<tag>'] so each task edits
// ONLY its own key and never clobbers another session's books.
//
// Usage (always source prod env first: `set -a; source .env.production.local; set +a`):
//   node scripts/maintenance/unpause-scope.mjs list
//   node scripts/maintenance/unpause-scope.mjs add <tag> [--collections a,b] [--books id1,id2] [--reason "..."]
//   node scripts/maintenance/unpause-scope.mjs remove <tag>
//   node scripts/maintenance/unpause-scope.mjs resolve            # print total book-id count in scope
//
// Examples:
//   node scripts/maintenance/unpause-scope.mjs add cannabis --collections cannabis-western-record
//   node scripts/maintenance/unpause-scope.mjs add manly-hall --books 6a35...,6a36...
//   node scripts/maintenance/unpause-scope.mjs remove cannabis
//
// NOTE: an empty scope (no allow_scopes entries, no legacy arrays) means the
// global pause is a full stop — removing the last scope re-pauses everything.

import { MongoClient } from 'mongodb';
import { getScopeConfig, resolveScopeBookIds } from '../workers/lib/selective-unpause.mjs';

const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
if (!uri) { console.error('No MONGODB_URI in env (source .env.production.local).'); process.exit(1); }

const [cmd, tag] = process.argv.slice(2);
const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const list = (v) => (v ? v.split(',').map(s => s.trim()).filter(Boolean) : []);

const client = new MongoClient(uri);
await client.connect();
const db = client.db('bookstore');
const cfg = db.collection('system_config');
const CTRL = { _id: 'processing_control' };

async function show() {
  const control = await cfg.findOne(CTRL);
  const scopes = control?.allow_scopes || {};
  console.log(`paused: ${control?.paused}`);
  console.log(`legacy allow_book_ids: ${(control?.allow_book_ids || []).length}, allow_collections: ${JSON.stringify(control?.allow_collections || [])}`);
  console.log(`allow_scopes (${Object.keys(scopes).length} tag(s)):`);
  for (const [k, v] of Object.entries(scopes)) {
    console.log(`  • ${k}: books=${(v.book_ids || []).length} collections=${JSON.stringify(v.collections || [])}${v.reason ? `  — ${v.reason}` : ''}`);
  }
  const union = getScopeConfig(control);
  console.log(`union: ${union.bookIds.length} explicit book ids + ${union.collections.length} collection(s)`);
}

if (cmd === 'list') {
  await show();
} else if (cmd === 'resolve') {
  const control = await cfg.findOne(CTRL);
  const ids = await resolveScopeBookIds(db, control);
  console.log(`scope resolves to ${ids.size} book ids`);
} else if (cmd === 'add') {
  if (!tag) { console.error('add requires a <tag>'); process.exit(1); }
  const collections = list(flag('--collections'));
  const books = list(flag('--books'));
  const reason = flag('--reason') || `selective-unpause: ${tag}`;
  if (!collections.length && !books.length) { console.error('provide --collections and/or --books'); process.exit(1); }
  await updateConfigVersioned(db, 'processing_control', {
    $set: {
      [`allow_scopes.${tag}`]: { book_ids: books, collections, reason, set_at: new Date(), set_by: process.env.USER || 'claude-session' },
      updated_at: new Date(),
    },
  }, `unpause-scope add ${tag}`);
  console.log(`✓ added/updated scope "${tag}" (books=${books.length}, collections=${collections.length}) — did NOT touch other scopes`);
  await show();
} else if (cmd === 'remove') {
  if (!tag) { console.error('remove requires a <tag>'); process.exit(1); }
  await updateConfigVersioned(db, 'processing_control', { $unset: { [`allow_scopes.${tag}`]: '' }, $set: { updated_at: new Date() } }, `unpause-scope remove ${tag}`);
  console.log(`✓ removed scope "${tag}"`);
  await show();
} else {
  console.log('Usage: list | add <tag> [--collections a,b] [--books id1,id2] [--reason "..."] | remove <tag> | resolve');
}

await client.close();
