// Model-free count of the 欽定四庫全書-margin garble class over the four held histories (#5142 O11 / #8053)
import { MongoClient } from 'mongodb'; import fs from 'fs';
const c = await MongoClient.connect(process.env.MONGODB_URI); const db = c.db('bookstore');
const works = {'kr:KR2a0001':'shiji','kr:KR2a0007':'hanshu','kr:KR2a0009':'houhanshu','kr:KR2a0012':'sanguozhi'};
const bs = await db.collection('books').find({ 'pipeline_auto.hold.reason': 'zh-histories-7546', work_id: { $in: Object.keys(works) } }, { projection: { id:1, work_id:1 } }).toArray();
const W = Object.fromEntries(bs.map(b=>[b.id,works[b.work_id]]));
const out = fs.createWriteStream(process.argv[2]);
const agg = {};
const cur = db.collection('pages').find({ book_id: { $in: bs.map(b=>b.id) } }, { projection: { book_id:1, page_number:1, 'ocr.data':1, 'translation.data':1 } });
for await (const p of cur) {
  const o = p.ocr?.data || ''; if (!o.trim()) continue;
  const t = p.translation?.data || '';
  const body = o.replace(/<header>[\s\S]*?<\/header>|<language>[\s\S]*?<\/language>|<script>[\s\S]*?<\/script>/g, '');
  const lines = body.split('\n').map(s=>s.trim()).filter(Boolean);
  const tail = lines.slice(-3);
  // garbled margin: a short body line (<=8 Han) in the last 3 lines beginning with a 欽定 look-alike
  const ocrHit = tail.some(l => /^(次定|金定|欽定|欠定|飲定|钦定|次之|金之)/.test(l) && l.length <= 9) || (lines.length && /^欠.{0,7}$/.test(lines[lines.length-1]));
  const enHit = /\bCi[- ]?ding\b|\bJin[- ]?ding\b/i.test(t);
  const a = agg[W[p.book_id]] ||= { ocr_pages:0, ocr_hit:0, en_hit:0, both:0, ocr_hit_translated:0 };
  a.ocr_pages++; if (ocrHit) a.ocr_hit++; if (enHit) a.en_hit++; if (ocrHit && enHit) a.both++; if (ocrHit && t.trim()) a.ocr_hit_translated++;
  if (ocrHit || enHit) out.write(JSON.stringify({ w: W[p.book_id], bid: p.book_id, pn: p.page_number, ocrHit, enHit, tail }) + '\n');
}
out.end(); console.log(JSON.stringify(agg, null, 1)); await c.close();
