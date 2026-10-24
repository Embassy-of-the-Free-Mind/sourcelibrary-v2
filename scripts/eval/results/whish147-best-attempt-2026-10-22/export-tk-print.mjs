// Export the machine OCR of the library's printed Sāṃkhya-tattvakaumudī (6aa35fc539e924dd9a9122ab, BSB bsb10996672)
// to JSON, as the edition the Whish 147 Tattvakaumudī leaves are anchored to (#7119). Read-only.
// Run: node --env-file=/root/sourcelibrary/.env.production.local export-tk-print.mjs > $JOB_SCRATCH/tk-print.json
import { MongoClient } from 'mongodb';
const c = await MongoClient.connect(process.env.MONGODB_URI);
const ps = await c.db('bookstore').collection('pages').find({ book_id: '6aa35fc539e924dd9a9122ab' }, { projection: { _id: 0, page_number: 1, 'ocr.data': 1, 'ocr.model': 1 } }).sort({ page_number: 1 }).toArray();
console.log(JSON.stringify(ps.map((p) => ({ n: p.page_number, model: p.ocr?.model ?? null, text: p.ocr?.data ?? '' }))));
await c.close();
