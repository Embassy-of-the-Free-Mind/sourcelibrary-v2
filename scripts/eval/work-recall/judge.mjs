// PRIOR ART: scripts/analysis/gap-validation-cli-adjudicate.mjs (lean claude -p flags, reused); rubric from .claude/docs/work-identity-gold-rubric.md (#7761).
// Sonnet judge over the claude CLI (subscription). usage: node judge.mjs <frame|pairs> <in.jsonl> <out.jsonl> [perCall] [concurrency]
import fs from 'fs'; import { spawn } from 'child_process'; import { claudeSubscriptionEnv } from '../../lib/claude-cli-env.mjs';
const [,, mode, inF, outF, PER = mode === 'frame' ? '4' : '12', CONC = '3'] = process.argv;
const items = fs.readFileSync(inF, 'utf8').trim().split('\n').map(l => JSON.parse(l));
const done = new Set(fs.existsSync(outF) ? fs.readFileSync(outF, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l).key) : []);
const keyOf = it => mode === 'frame' ? it.target.id : `${it.a.id}__${it.b.id}`;
const todo = items.filter(it => !done.has(keyOf(it)));
const RULES = `You are a rare-books cataloguer deciding WORK identity (FRBR "work": one intellectual creation; editions, printings, re-scans and translations of it are the same work).
Relations, pick exactly one:
- same_edition: the same printing/edition (duplicate scan or copy).
- same_work: a different edition or printing of the same work, same language.
- translation: the same work in another language (or a bilingual edition of it).
- volume_same_set: another volume/part of the SAME multi-volume set or serial work (e.g. Vol. 1 vs Vol. 2).
- part_or_container: one contains the other (anthology vs a text inside it, whole work vs one book of it, base text vs a commentary on it).
- different: different works (incl. different works by the same author, numbered series items, same generic title).
- unsure: the records do not let you decide.
Judge from title, author, year, language and page count only. Do not guess; prefer unsure over a confident wrong call. Display titles in [display: ...] are English glosses written by our system and may be wrong.`;
function prompt(batch) {
  if (mode === 'frame') return `${RULES}

For each TARGET, decide the relation of EVERY candidate to it. Output ONLY a JSON array, one object per target: {"target":"<id>","calls":[{"id":"<candidate id>","rel":"<relation>"}]}. You may omit candidates that are clearly "different".

${batch.map((it, i) => `### TARGET ${i + 1}\n${JSON.stringify(strip(it.target))}\nCANDIDATES:\n${it.candidates.map(c => JSON.stringify(strip(c))).join('\n') || '(none)'}`).join('\n\n')}`;
  return `${RULES}

For each PAIR decide the relation of B to A. Output ONLY a JSON array: [{"pair":"<pair key>","rel":"<relation>","why":"<8 words max>"}].

${batch.map(it => `PAIR ${keyOf(it)}\nA: ${JSON.stringify(strip(it.a))}\nB: ${JSON.stringify(strip(it.b))}`).join('\n\n')}`;
}
const strip = b => ({ id: b.id, title: b.title, author: b.author, year: b.year, language: b.language, pages: b.pages });
function run(p) { return new Promise(res => { const c = spawn('claude', ['-p', '--model', 'sonnet', '--output-format', 'json', '--tools', '', '--strict-mcp-config', '--setting-sources', 'local', '--disable-slash-commands', '--no-session-persistence', '--system-prompt', 'You are a careful rare-books cataloguer. Answer only with the requested JSON array.'], { stdio: ['pipe', 'pipe', 'pipe'], env: claudeSubscriptionEnv() });
  let o = '', e = ''; c.stdout.on('data', d => o += d); c.stderr.on('data', d => e += d); c.on('close', code => res({ code, o, e })); c.stdin.end(p); }); }
const batches = []; for (let i = 0; i < todo.length; i += +PER) batches.push(todo.slice(i, i + +PER));
const w = fs.createWriteStream(outF, { flags: 'a' }); let bi = 0, fails = 0;
async function worker() { while (bi < batches.length) { const b = batches[bi++]; let parsed = null;
  for (let attempt = 0; attempt < 2 && !parsed; attempt++) { const r = await run(prompt(b));
    try { const env = JSON.parse(r.o); const txt = env.result || ''; if (/limit|usage/i.test(txt) && !txt.includes('[')) { console.error('LIMIT', txt.slice(0, 200)); process.exit(3); }
      const m = txt.replace(/^[\s\S]*?```(?:json)?\s*/,'').replace(/```[\s\S]*$/,''); const body = m.trim().startsWith('[') ? m : txt; parsed = JSON.parse(body.slice(body.search(/\[\s*\{/), body.lastIndexOf(']') + 1)); } catch (err) { console.error('parse fail', r.code, (r.o || r.e).slice(0, 300)); } }
  if (!parsed) { fails++; continue; }
  if (mode === 'frame') for (const it of b) { const j = parsed.find(x => x.target === it.target.id); if (j) w.write(JSON.stringify({ key: it.target.id, cluster_size: it.cluster_size, target: it.target, calls: j.calls, candidates: it.candidates }) + '\n'); }
  else for (const it of b) { const j = parsed.find(x => x.pair === keyOf(it)); if (j) w.write(JSON.stringify({ key: keyOf(it), ...it, rel: j.rel, why: j.why }) + '\n'); }
  console.log(`batch ${bi}/${batches.length}`); } }
await Promise.all(Array.from({ length: +CONC }, worker)); w.end(); console.log('done fails=' + fails);
