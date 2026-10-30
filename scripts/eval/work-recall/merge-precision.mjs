#!/usr/bin/env node
// PRIOR ART: scripts/analysis/llm-verify-work-merges.mjs writes the proposals and validated 16/16 by hand (2026-06);
// judge.mjs here judges pairs and candidate lists, not whole merge groups. This judges a uniform sample of HIGH
// merge groups with a second model before any --apply-from (#7761).
//
// usage: node scripts/eval/work-recall/merge-precision.mjs <live-books.jsonl> <out.jsonl> <proposals.json>... [--n 150]
// then:  node scripts/eval/work-recall/merge-precision.mjs --score <out.jsonl>
import fs from 'fs';
import { spawn } from 'child_process';
import { claudeSubscriptionEnv } from '../../lib/claude-cli-env.mjs';

const wilson = (k, n, z = 1.96) => { if (!n) return [0, 0]; const p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return [+((c - m) / d * 100).toFixed(1), +((c + m) / d * 100).toFixed(1)]; };

const key = p => `${p.author_id}::${p.canonical_title}::${p.bookIds.slice().sort()[0]}`;

if (process.argv[2] === '--score') {
  const rows = fs.readFileSync(process.argv[3], 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
  const t = {}; for (const r of rows) t[r.verdict] = (t[r.verdict] || 0) + 1;
  const ok = rows.filter(r => r.verdict === 'all_same_work').length;
  const books = rows.reduce((s, r) => s + r.nBooks, 0), okBooks = rows.filter(r => r.verdict === 'all_same_work').reduce((s, r) => s + r.nBooks, 0);
  console.log(JSON.stringify({ groups: rows.length, verdicts: t }));
  console.log(`group precision: ${ok}/${rows.length} = ${(100 * ok / rows.length).toFixed(1)}% [${wilson(ok, rows.length).join('–')}]`);
  console.log(`book-weighted:   ${okBooks}/${books} = ${(100 * okBooks / books).toFixed(1)}%`);
  if (!process.argv.includes('--quiet')) for (const r of rows.filter(r => r.verdict !== 'all_same_work')) console.log(`- ${r.verdict}: [${r.author}] ${r.canonical_title} :: ${r.why}`);
  // --approved-out FILE --proposals A.json [B.json]: write the HIGH groups this judge accepted, in the
  // proposals shape llm-verify-work-merges.mjs --apply-from reads. Nothing else may reach --apply-from.
  const ai = process.argv.indexOf('--approved-out');
  if (ai > -1) {
    const pi = process.argv.indexOf('--proposals');
    const files = process.argv.slice(pi + 1).filter(a => a.endsWith('.json'));
    const okKeys = new Set(rows.filter(r => r.verdict === 'all_same_work').map(r => r.key));
    const approved = files.flatMap(f => JSON.parse(fs.readFileSync(f, 'utf8')).proposals).filter(p => p.confidence === 'high' && okKeys.has(key(p)));
    fs.writeFileSync(process.argv[ai + 1], JSON.stringify({ source: 'merge-precision approved (#7761)', judged: rows.length, proposals: approved }, null, 2));
    console.log(`approved groups written: ${approved.length} (${approved.reduce((s, p) => s + p.bookIds.length, 0)} books) -> ${process.argv[ai + 1]}`);
  }
  process.exit(0);
}

const [,, booksF, outF, ...rest] = process.argv;
const nArg = rest.includes('--n') ? rest[rest.indexOf('--n') + 1] : '150';
const N = nArg === 'all' ? Infinity : +nArg;
const propFiles = rest.filter((a, i) => a.endsWith('.json') && rest[i - 1] !== '--n');
const books = new Map(fs.readFileSync(booksF, 'utf8').trim().split('\n').map(l => JSON.parse(l)).map(b => [b.id, b]));
const hash = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const high = propFiles.flatMap(f => JSON.parse(fs.readFileSync(f, 'utf8')).proposals.filter(p => p.confidence === 'high'));
const sample = high.sort((a, b) => hash('mp7761:' + key(a)) - hash('mp7761:' + key(b))).slice(0, N);
console.log(`HIGH groups ${high.length}, judging ${sample.length}`);

function describe(p) {
  // the books themselves, not the representative title the proposer saw: at most 4 per group member
  const byWork = new Map();
  for (const id of p.bookIds) { const b = books.get(id); if (!b) continue; const k = b.work_id || 'unset:' + id; byWork.set(k, [...(byWork.get(k) || []), b]); }
  let i = 0; const lines = [];
  for (const [, bs] of byWork) { i++; for (const b of bs.slice(0, 4)) lines.push(`  M${i}: "${b.title}" | ${b.author || ''} | ${b.published ?? b.year ?? '?'} | ${b.language || '?'} | ${b.pages_count}pp`); if (bs.length > 4) lines.push(`  M${i}: (+${bs.length - 4} more books under the same id)`); }
  return lines.join('\n');
}
const RULES = `You are a rare-books cataloguer checking a proposed FRBR WORK merge. Every listed book would be filed as ONE work. Books with the same M-number are already filed together.
Answer for each GROUP with exactly one verdict:
- all_same_work: every book is an edition, printing, copy or translation of the same work.
- contains_volume_or_part: the work is right but some book is only one volume/part/book of it, or a set mixes different volumes.
- contains_container: some book is an anthology or collected works containing it, or a commentary on it, or an excerpt.
- contains_different_work: some book is a different work.
- unsure: the records do not let you decide.
Judge from the records only. Prefer unsure over a confident wrong call. Output ONLY a JSON array: [{"group":"<id>","verdict":"<verdict>","why":"<12 words max>"}].`;
const done = new Set(fs.existsSync(outF) ? fs.readFileSync(outF, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l).key) : []);
const todo = sample.filter(p => !done.has(key(p)));
const run = (prompt) => new Promise(res => { const c = spawn('claude', ['-p', '--model', 'sonnet', '--output-format', 'json', '--tools', '', '--strict-mcp-config', '--setting-sources', 'local', '--disable-slash-commands', '--no-session-persistence', '--system-prompt', 'You are a careful rare-books cataloguer. Answer only with the requested JSON array.'], { stdio: ['pipe', 'pipe', 'pipe'], env: claudeSubscriptionEnv() });
  let o = ''; c.stdout.on('data', d => o += d); c.on('close', () => res(o)); c.stdin.end(prompt); });
const PER = 6, CONC = 3; const batches = []; for (let i = 0; i < todo.length; i += PER) batches.push(todo.slice(i, i + PER));
const w = fs.createWriteStream(outF, { flags: 'a' }); let bi = 0, fails = 0;
async function worker() {
  while (bi < batches.length) {
    const b = batches[bi++]; const ids = b.map((p, i) => `G${bi}-${i}`);
    const prompt = `${RULES}\n\n${b.map((p, i) => `GROUP ${ids[i]} (author: ${p.author}; proposed title: ${p.canonical_title})\n${describe(p)}`).join('\n\n')}`;
    let parsed = null;
    for (let a = 0; a < 2 && !parsed; a++) { const o = await run(prompt); try { const txt = JSON.parse(o).result || ''; if (/usage limit|rate limit/i.test(txt) && !txt.includes('[')) { console.error('LIMIT', txt.slice(0, 200)); process.exit(3); } parsed = JSON.parse(txt.slice(txt.search(/\[\s*\{/), txt.lastIndexOf(']') + 1)); } catch { console.error('parse fail', o.slice(0, 200)); } }
    if (!parsed) { fails++; continue; }
    b.forEach((p, i) => { const j = parsed.find(x => x.group === ids[i]); if (j) w.write(JSON.stringify({ key: key(p), author: p.author, canonical_title: p.canonical_title, nBooks: p.bookIds.length, nMembers: p.members.length, verdict: j.verdict, why: j.why }) + '\n'); });
    console.log(`batch ${bi}/${batches.length}`);
  }
}
await Promise.all(Array.from({ length: CONC }, worker)); w.end(); console.log('done fails=' + fails);
