import { MongoClient } from 'mongodb'; import fs from 'fs';
import { bodyHanCount, longestCharRun, MAX_CHAR_RUN } from '/data/scratch/sl/sourcelibrary/.claude/worktrees/job-zh-held-quality-8053/scripts/lib/paddle-zh-lane.mjs';
import { gpuLoopVerdict } from '/data/scratch/sl/sourcelibrary/.claude/worktrees/job-zh-held-quality-8053/scripts/lib/gpu-ocr-loop-guard.mjs';
const c = await MongoClient.connect(process.env.MONGODB_URI); const db = c.db('bookstore');
const bs = await db.collection('books').find({ 'pipeline_auto.hold.reason': 'zh-histories-7546' }, { projection: { id:1, work_id:1, title:1 } }).toArray();
const W = Object.fromEntries(bs.map(b=>[b.id,b.work_id]));
const out = fs.createWriteStream(process.argv[2]);
const cur = db.collection('pages').find({ book_id: { $in: bs.map(b=>b.id) } }, { projection: { book_id:1, page_number:1, 'ocr.data':1, 'translation.data':1 } });
for await (const p of cur) {
  const o = p.ocr?.data || '', t = p.translation?.data || '';
  const body = o.replace(/<language>[\s\S]*?<\/language>|<script>[\s\S]*?<\/script>/g, '');
  const bh = o ? bodyHanCount(body) : 0;
  const tEn = t.replace(/<(note|gloss|meta|term)>[\s\S]*?<\/\1>/g, ' ');
  const latin = (tEn.match(/[A-Za-z]/g) || []).length, cjk = (t.match(/\p{Script=Han}/gu) || []).length;
  let loop = null; try { loop = o ? gpuLoopVerdict(o) : null; } catch (e) { loop = 'err'; }
  out.write(JSON.stringify({ w: W[p.book_id], bid: p.book_id, pn: p.page_number, hasO: !!o.trim(), bh, run: o ? longestCharRun(body) : 0, loop: loop && (loop.looped ?? loop.loop ?? loop.verdict ?? loop), hasT: !!t.trim(), tlen: t.length, latin, cjk }) + '\n');
}
out.end(); await c.close();
