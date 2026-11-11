// Question search (#6875), live check: send readers' questions to the Librarian on a deploy, record every tool
// step and its time, read back the stored answer, the find_passages cost/latency rows from ai_usage, and the
// status of every sourcelibrary.org link in the answer.
//
// PRIOR ART: scripts/eval/librarian-speed-6904/run.ts — drives streamAgenticResponse in-process, not a deploy;
//   agent-tool-results.md asks for a turn on a preview with every URL curled, which this does.
//
//   node --env-file=<.env.production.local> scripts/eval/question-search-6875/live-check.mjs <base-url> <questions.json> <out.jsonl> [from] [to]
import fs from 'node:fs';
import { MongoClient, ObjectId } from 'mongodb';

const [BASE, QFILE, OUT, FROM = '0', TO = '999'] = process.argv.slice(2);
const questions = JSON.parse(fs.readFileSync(QFILE, 'utf8')).slice(Number(FROM), Number(TO));
const mongo = new MongoClient(process.env.MONGODB_URI);
await mongo.connect();
const db = mongo.db('bookstore');

async function ask(q) {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/embassy/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'SourceLibrary-eval/6875' },
    body: JSON.stringify({ message: q, visibility: 'private', stream: true }),
  });
  if (res.status !== 200) return { q, status: res.status, error: (await res.text()).slice(0, 300) };
  const dec = new TextDecoder();
  let buf = '';
  const steps = [];
  let threadId = null;
  let firstText = null;
  for await (const chunk of res.body) {
    buf += dec.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) !== -1) {
      const line = buf.slice(0, i).replace(/^data: /, '');
      buf = buf.slice(i + 2);
      let ev;
      try { ev = JSON.parse(line); } catch { continue; }
      const ms = Date.now() - t0;
      if (ev.type === 'threadId') threadId = ev.threadId;
      else if (ev.type === 'chunk') { if (firstText === null) firstText = ms; }
      else if (['tool_call', 'tool_result', 'error'].includes(ev.type)) steps.push({ ms, ...ev });
    }
  }
  const total = Date.now() - t0;
  // The answer is saved after the stream ends; wait for it.
  let msg = null;
  for (let i = 0; threadId && !msg && i < 20; i++) {
    msg = await db.collection('embassy_messages').findOne({ threadId: new ObjectId(threadId), authorType: { $ne: 'human' } }, { sort: { _id: -1 } });
    if (!msg) await new Promise((r) => setTimeout(r, 1000));
  }
  const answer = msg?.content || '';
  const urls = [...new Set(answer.match(/https:\/\/sourcelibrary\.org\/[^\s)\]>"]+/g) || [])];
  const links = [];
  for (const u of urls) {
    const r = await fetch(u, { method: 'GET', redirect: 'follow', headers: { 'user-agent': 'SourceLibrary-eval/6875' } }).catch(() => null);
    links.push({ url: u, status: r?.status ?? 0 });
  }
  return { q, threadId, total_ms: total, first_text_ms: firstText, steps, answer, links };
}

const since = new Date();
for (const q of questions) {
  const r = await ask(q);
  fs.appendFileSync(OUT, JSON.stringify(r) + '\n');
  const fp = r.steps?.filter((s) => s.name === 'find_passages') || [];
  console.log(q.slice(0, 60), '|', r.status || 200, `${r.total_ms}ms`, 'tools', (r.steps || []).filter((s) => s.type === 'tool_call').map((s) => s.name).join(','),
    '| fp', fp.map((s) => `${s.type}@${s.ms}`).join(' '), '| links', (r.links || []).map((l) => l.status).join(','));
}
const usage = await db.collection('ai_usage').find({ feature: 'librarian_question_search', timestamp: { $gte: since } }).toArray();
fs.appendFileSync(OUT, JSON.stringify({ usage: usage.map((u) => ({ costUsd: u.costUsd, ms: u.ms, ok: u.ok })) }) + '\n');
console.log('ai_usage rows', usage.length, 'cost', usage.reduce((s, u) => s + (u.costUsd || 0), 0).toFixed(4));
await mongo.close();
