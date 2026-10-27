// PRIOR ART: none — the dry-run worker (scripts/workers/librarian-citation-fixer.ts) logs one JSON line a run on
// l7a, which no other box can read; this measures the same run from its Mongo rows. Read-only.
/**
 * Health of the citation fixer's dry run (#6946): answers written vs recorded per day, status, per-link outcomes,
 * fixer latency and lag behind the answer, and gaps between runs.
 * Usage: node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/librarian-fixer-week-6946/health.mjs
 */
import { MongoClient } from 'mongodb';

const c = new MongoClient(process.env.MONGODB_URI);
await c.connect();
const db = c.db(process.env.MONGODB_DB || 'bookstore');
const rows = await db.collection('librarian_citation_fixes').find({}).sort({ messageId: 1 }).toArray();
const first = rows[0].messageId, last = rows.at(-1).messageId;
const have = new Set(rows.map(r => String(r.messageId)));
const ai = await db.collection('embassy_messages').find({ authorType: 'ai', _id: { $gte: first, $lte: last } }).project({ _id: 1 }).toArray();
const day = id => id.getTimestamp().toISOString().slice(0, 10);
const t = {};
for (const m of ai) { const e = t[day(m._id)] ??= { written: 0, recorded: 0, proposed: 0, no_change: 0, skipped: 0, error: 0, links: 0 }; e.written++; }
const outcomes = {};
for (const r of rows) {
  const e = t[day(r.messageId)]; e.recorded++; e[r.status]++;
  for (const o of r.outcomes ?? []) { e.links++; outcomes[o.outcome] = (outcomes[o.outcome] ?? 0) + 1; }
}
console.table(t);
const links = Object.values(outcomes).reduce((a, b) => a + b, 0);
for (const [k, v] of Object.entries(outcomes).sort((a, b) => b[1] - a[1])) console.log(k, v, `${(100 * v / links).toFixed(1)}%`);
const q = (a, p) => a[Math.floor(p * (a.length - 1))];
const ms = rows.filter(r => r.ms).map(r => r.ms).sort((a, b) => a - b);
console.log('fixer calls', ms.length, 'ms p50', q(ms, 0.5), 'p90', q(ms, 0.9), 'max', ms.at(-1));
const lag = rows.filter(r => r.status !== 'skipped').map(r => (r.fixedAt - r.messageId.getTimestamp()) / 60e3).sort((a, b) => a - b);
console.log('lag min p50', q(lag, 0.5).toFixed(1), 'p90', q(lag, 0.9).toFixed(1), '>24h', lag.filter(l => l > 1440).length);
const runs = rows.map(r => r.fixedAt).sort((a, b) => a - b);
for (let i = 1; i < runs.length; i++) if (runs[i] - runs[i - 1] > 12 * 3600e3) console.log('gap', ((runs[i] - runs[i - 1]) / 3600e3).toFixed(1), 'h before', runs[i].toISOString());
await c.close();
