// PRIOR ART: guard.mjs report/sample (#7152) and seam-repair.mjs verdicts — this is the job-local script as it ran (job seam-prevent-7118, 2026-10-22..24); paths point at that job's scratch and worktree.
// Shadow of the write-time seam guard (#7118, job seam-prevent-7118): while PR #7152 waits for review, poll the
// translation writes on Mongo every 5 min and run the branch's guard in DRY mode on each new page, as of its write
// (a neighbour written later is not yet there), exactly as the in-lane hook would. Writes nothing to Mongo.
// Stops when the merged guard (with the Sonnet fallback) is on the box's main checkout, so the two never both call
// Claude, or at --until.
import fs from 'fs';
import path from 'path';
import { MongoClient } from 'mongodb';
import { seamGuardAfterWrite } from './scripts/maintenance/seam-repair-6742/guard.mjs';

const arg = (k, d) => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? d;
const out = arg('out'), until = new Date(arg('until')), state = path.join(out, 'shadow-state.json');
fs.mkdirSync(out, { recursive: true });
const live = () => { try { return /sonnetOne/.test(fs.readFileSync('/root/sourcelibrary/scripts/maintenance/seam-repair-6742/guard.mjs', 'utf8')); } catch { return false; } };
const log = (x) => fs.appendFileSync(path.join(out, 'shadow.log'), `${new Date().toISOString()} ${typeof x === 'string' ? x : JSON.stringify(x)}\n`);
let st = fs.existsSync(state) ? JSON.parse(fs.readFileSync(state, 'utf8')) : { cursor: arg('since', new Date().toISOString()), seen: 0 };
const c = new MongoClient(process.env.MONGODB_URI); await c.connect(); const db = c.db('bookstore');
log(`start cursor ${st.cursor} until ${until.toISOString()}`);
while (Date.now() < until.getTime()) {
  if (live()) { log('the merged guard is on the box main checkout: shadow stops'); break; }
  if (fs.existsSync(path.join(out, 'STOP'))) { log('STOP file'); break; }
  try {
    const pages = await db.collection('pages').find({ 'translation.updated_at': { $gt: new Date(st.cursor) } },
      { projection: { _id: 0, id: 1, book_id: 1, page_number: 1, 'translation.updated_at': 1, 'translation.source': 1, 'translation.engine.run.job_id': 1 } })
      .sort({ 'translation.updated_at': 1 }).limit(400).toArray();
    for (const p of pages) {
      st.cursor = new Date(p.translation.updated_at).toISOString();
      if (String(p.translation.engine?.run?.job_id || '').startsWith('seam-repair')) continue;
      const t = await seamGuardAfterWrite(db, { page: p, mode: 'dry', out, asOf: new Date(p.translation.updated_at) });
      st.seen++;
      log({ page: p.id, book: p.book_id, p: p.page_number, job: p.translation.engine?.run?.job_id || null, joins: t.joins, arms: t.arms, ok: t.labelledOk, accepted: t.accepted, skipped: t.skipped, error: t.error, secs: t.secs });
      fs.writeFileSync(state, JSON.stringify(st));
    }
    fs.writeFileSync(state, JSON.stringify(st));
  } catch (e) { log(`error ${String(e?.message || e).slice(0, 300)}`); }
  await new Promise(r => setTimeout(r, 5 * 60e3));
}
await c.close();
log('end');
