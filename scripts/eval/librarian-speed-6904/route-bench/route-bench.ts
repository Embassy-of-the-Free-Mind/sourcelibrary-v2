/**
 * Time to the threadId event, chat route before vs after #6904.
 *
 * PRIOR ART: tests/integration/embassy-api.test.ts drives the same handler
 * against MongoMemoryServer, which has no network round trips to time; this
 * runs it against the production Atlas with auth, model and limiter names
 * stubbed (route-bench/hooks.mjs).
 *
 * Usage (from the repo root):
 *   cp <(git show <base>:src/app/api/embassy/chat/route.ts) src/app/api/embassy/chat/route-before.bench.ts
 *   npx tsx --env-file=/root/sourcelibrary/.env.production.local --import ./scripts/eval/librarian-speed-6904/route-bench/register.mjs \
 *     scripts/eval/librarian-speed-6904/route-bench/route-bench.ts --n=20
 *
 * Writes: one unlisted anonymous thread + one human message per request
 * (title "bench 6904 …"), deleted by id at the end; bench6904-* rate_limits
 * counters (TTL-expired). Any embassy_errors row whose message is a bench
 * message is deleted too.
 */
import { NextRequest } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { POST as before } from '@/app/api/embassy/chat/route-before.bench';
import { POST as after } from '@/app/api/embassy/chat/route';

const n = Number(process.argv.find(a => a.startsWith('--n='))?.slice(4) ?? 20);
const created: string[] = [];

async function timeOne(handler: (r: NextRequest) => Promise<Response>, i: number, label: string) {
  const req = new NextRequest('http://localhost/api/embassy/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.69.4.${i % 250}`, 'x-real-ip': `10.69.4.${i % 250}` },
    body: JSON.stringify({ message: `bench 6904 ${label} ${i} ${Date.now()}`, visibility: 'private', stream: true }),
  });
  const t0 = performance.now();
  const res = await handler(req);
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let ms = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value);
    const m = !ms && buf.match(/"threadId":"([0-9a-f]{24})"/);
    if (m) { created.push(m[1]); ms = performance.now() - t0; }
  }
  // Drained to the end (the stub model yields nothing, so `done` follows at
  // once): cancelling instead makes the route log an agent_error.
  if (res.status !== 200 || !ms) throw new Error(`${label} status ${res.status}: ${buf.slice(0, 200)}`);
  return ms;
}

const q = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

async function main() {
  await getDb();
  // Warm both (module init, connection pool) before timing.
  await timeOne(before, 900, 'warm-before');
  await timeOne(after, 901, 'warm-after');
  const t = { before: [] as number[], after: [] as number[] };
  for (let i = 0; i < n; i++) {
    const order = i % 2 === 0 ? (['before', 'after'] as const) : (['after', 'before'] as const);
    for (const k of order) t[k].push(await timeOne(k === 'before' ? before : after, i * 2 + (k === 'before' ? 0 : 1), k));
  }
  for (const k of ['before', 'after'] as const) {
    console.log(`${k}\tn=${t[k].length}\tp50=${q(t[k], 0.5).toFixed(0)}ms\tp90=${q(t[k], 0.9).toFixed(0)}ms\tmean=${(t[k].reduce((a, b) => a + b, 0) / t[k].length).toFixed(0)}ms`);
  }
  console.log(JSON.stringify(t));
  await new Promise(r => setTimeout(r, 2000)); // let deferred saves settle (they no-op: no AI text)
  const db = await getDb();
  const ids = created.map(id => new ObjectId(id));
  const threads = await db.collection('embassy_threads').find({ _id: { $in: ids } }, { projection: { title: 1 } }).toArray();
  if (threads.some(th => !String(th.title).startsWith('bench 6904 '))) throw new Error('refusing cleanup: a thread is not a bench thread');
  const m = await db.collection('embassy_messages').deleteMany({ threadId: { $in: ids }, content: /^bench 6904 / });
  const th = await db.collection('embassy_threads').deleteMany({ _id: { $in: ids }, title: /^bench 6904 / });
  const e = await db.collection('embassy_errors').deleteMany({ message: /^bench 6904 / });
  console.log(`cleanup: ${th.deletedCount} bench threads, ${m.deletedCount} bench messages (of ${created.length} created), ${e.deletedCount} bench error rows`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
