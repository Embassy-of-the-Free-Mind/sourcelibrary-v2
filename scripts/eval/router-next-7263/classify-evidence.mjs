#!/usr/bin/env node
// PRIOR ART: none — scripts/eval/router-next-7263/script-type.mjs classifies; this only runs it over evidence_pages.py's rows.
/**
 * Adds script (print | manuscript | unknown) and its basis to every judged evidence row (#7263, Derek inbox 11:54Z).
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/router-next-7263/classify-evidence.mjs IN.jsonl OUT.jsonl
 */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
import { classifyPages } from './script-type.mjs';
const [IN, OUTF] = process.argv.slice(2);
const rows = fs.readFileSync(IN, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const cls = await classifyPages(c.db('bookstore'), [...new Set(rows.map((r) => r.page_id).filter(Boolean))]);
await c.close();
fs.writeFileSync(OUTF, rows.map((r) => { const s = cls.get(r.page_id) ?? { cls: 'unknown', basis: 'no page id' }; return JSON.stringify({ ...r, script: s.cls, script_basis: s.basis, script_field: s.field ?? null, script_tag: s.tag ?? null }); }).join('\n') + '\n');
const t = {}; for (const [, s] of cls) { const k = `${s.cls}/${s.basis}`; t[k] = (t[k] || 0) + 1; } console.log('pages', JSON.stringify(t));
