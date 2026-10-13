// Fix two fields of scope.json the builder recorded wrongly: human-edited count (a Set serialised as {}) and the repo commit.
import fs from 'node:fs'; import crypto from 'node:crypto'; import { createRequire } from 'node:module'; import { execSync } from 'node:child_process';
const REPO='/root/sourcelibrary', W='/root/tengyur-cli-6361';
const { MongoClient } = createRequire(`${REPO}/package.json`)('mongodb');
const { findHumanEditedPageIds } = await import(`${REPO}/scripts/lib/translate-core.mjs`);
const s = JSON.parse(fs.readFileSync(`${W}/scope.json`,'utf8'));
const ids = fs.readFileSync(`${W}/pages.jsonl`,'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l).page_id);
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const h = await findHumanEditedPageIds(c.db('bookstore'), ids); await c.close();
const arr=[...h]; s.human_edited_in_scope = arr.length; s.human_edited_page_ids = arr;
s.repo_commit = execSync(`git -C ${REPO} rev-parse HEAD`).toString().trim();
// sanity: prompts equal arm C38's units.jsonl prompts on any shared page
const u = fs.readFileSync('/root/pareto-6182/units.jsonl','utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l)).filter(x=>x.set.startsWith('tib'));
const mine = new Map(fs.readFileSync(`${W}/pages.jsonl`,'utf8').split('\n').filter(Boolean).map(l=>{const r=JSON.parse(l);return [r.page_id,r.prompt_sha256];}));
let shared=0, same=0; for (const x of u) if (mine.has(x.page_id)) { shared++; if (crypto.createHash('sha256').update(x.prompt).digest('hex')===mine.get(x.page_id)) same++; }
s.c38_units_check = { shared_pages: shared, identical_prompt: same };
fs.writeFileSync(`${W}/scope.json`, JSON.stringify(s,null,1));
console.log(s.human_edited_in_scope, s.repo_commit, s.c38_units_check);
