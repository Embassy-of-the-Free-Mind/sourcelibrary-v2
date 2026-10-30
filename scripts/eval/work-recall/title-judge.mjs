#!/usr/bin/env node
// Pick one uniform work_title per merged work (#7761). A merge keeps the surviving id's own
// work_title, which is often a translation's or one edition's title page ("L'architettura di
// Leonbatista Alberti" for De re aedificatoria). The proposer also gave a uniform title; this
// asks Sonnet (subscription CLI, no tools) to choose between them, or correct both.
// PRIOR ART: scripts/eval/work-recall/merge-precision.mjs (same lean claude -p judge, batched);
// llm-verify-work-merges.mjs writes canonical_title unjudged, which is how Ptolemy got an English paraphrase.
//
// usage: node scripts/eval/work-recall/title-judge.mjs <survey.jsonl> <out.jsonl>
//   survey rows: {winner, author_id, canonical, titles[], langs[], bookTitles[]} (one per merged work)
//   out rows:    {winner, current, proposed, title, pick}  pick = now | new | edit
import { spawn } from 'child_process';
import fs from 'fs';

const [inF, outF] = process.argv.slice(2);
if (!inF || !outF) { console.error('usage: title-judge.mjs <survey.jsonl> <out.jsonl>'); process.exit(2); }
const rows = fs.readFileSync(inF, 'utf8').trim().split('\n').map(l => JSON.parse(l))
  .filter(r => r.canonical && !(r.titles.length === 1 && r.titles[0] === r.canonical));
const done = new Set(fs.existsSync(outF) ? fs.readFileSync(outF, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l).winner) : []);
const todo = rows.filter(r => !done.has(r.winner));

const RULES = `Each WORK below groups editions and translations of one text. Choose the title a work page should show: the work's uniform title as library catalogues give it, in the ORIGINAL language of the work (the language it was first written in, not a later translation's), concise (no author name, no imprint, no "edited by", no title-page puffery), in normal modern capitalisation. Keep a volume or part number only if every book in the work is that one volume.
For each work answer pick "now" (CURRENT is already right), "new" (PROPOSED is right), or "edit" (neither; give the right title). Output ONLY a JSON array: [{"w":"<id>","pick":"now|new|edit","title":"<the title to show>"}].`;
const run = (prompt) => new Promise(res => { const c = spawn('claude', ['-p', '--model', 'sonnet', '--output-format', 'json', '--tools', '', '--strict-mcp-config', '--setting-sources', 'local', '--disable-slash-commands', '--no-session-persistence', '--system-prompt', 'You are a careful rare-books cataloguer. Answer only with the requested JSON array.'], { stdio: ['pipe', 'pipe', 'pipe'] });
  let o = ''; c.stdout.on('data', d => o += d); c.on('close', () => res(o)); c.stdin.end(prompt); });

const PER = 25, CONC = 4; const batches = []; for (let i = 0; i < todo.length; i += PER) batches.push(todo.slice(i, i + PER));
const w = fs.createWriteStream(outF, { flags: 'a' }); let bi = 0, fails = 0;
async function worker() {
  while (bi < batches.length) {
    const n = bi++; const b = batches[n];
    const prompt = `${RULES}\n\n${b.map((r, i) => `WORK W${i} (author: ${r.author_id}; languages: ${r.langs.join(', ')})\n  book titles: ${r.bookTitles.map(t => (t || '').slice(0, 140)).join(' | ')}\n  CURRENT: ${r.titles.filter(Boolean).join(' || ').slice(0, 300) || '(none)'}\n  PROPOSED: ${r.canonical}`).join('\n\n')}`;
    let parsed = null;
    for (let a = 0; a < 2 && !parsed; a++) { const o = await run(prompt); try { const txt = JSON.parse(o).result || ''; if (/usage limit|rate limit/i.test(txt) && !txt.includes('[')) { console.error('LIMIT', txt.slice(0, 200)); process.exit(3); } parsed = JSON.parse(txt.slice(txt.search(/\[\s*\{/), txt.lastIndexOf(']') + 1)); } catch { console.error('parse fail', o.slice(0, 200)); } }
    if (!parsed) { fails++; continue; }
    b.forEach((r, i) => { const j = parsed.find(x => x.w === `W${i}`); if (j?.title) w.write(JSON.stringify({ winner: r.winner, current: r.titles, proposed: r.canonical, title: j.title.trim(), pick: j.pick }) + '\n'); });
    console.log(`batch ${n + 1}/${batches.length}`);
  }
}
await Promise.all(Array.from({ length: CONC }, worker)); w.end(); console.log('done fails=' + fails);
