import { MongoClient } from 'mongodb';
// PRIOR ART: scripts/eval/tibetan-mt-ab/ and note-facts-5624 pulled their pages ad hoc; none selects the Tengyur pilot by model + updated_at. Read-only dump for #5497 QA.
import fs from 'fs';
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db('bookstore');
const vols = {'6abeb583896ea18127c84e6f':113,'6abe932b6a920ffd924d73b0':33,'6abeb158896ea18127c82682':96,'6abed3fc896ea18127c8d272':174,'6abec7fa896ea18127c8ac69':157};
const out = fs.createWriteStream('pages.jsonl');
let n=0;
for (const [id,vol] of Object.entries(vols)) {
  const cur = db.collection('pages').find({book_id:id, 'translation.model':'gemini-3-flash-preview', 'translation.updated_at': {$gte: new Date('2026-10-02T21:00:00Z')}}).sort({page_number:1});
  for await (const p of cur) {
    out.write(JSON.stringify({book_id:id, vol, page_id:p.id, page_number:p.page_number, label:p.page_label, image:p.archived_photo||p.photo, src:p.ocr?.data||'', tohoku:p.ocr?.text_edition?.tohoku||[], folio:p.ocr?.text_edition?.folio, en:p.translation?.data||'', tr_updated:p.translation?.updated_at, prompt_version:p.translation?.prompt_version, finish:p.translation?.engine?.run?.finish_reason ?? p.translation?.finish_reason})+'\n'); n++;
  }
}
out.end(); console.log('dumped', n);
await c.close();
