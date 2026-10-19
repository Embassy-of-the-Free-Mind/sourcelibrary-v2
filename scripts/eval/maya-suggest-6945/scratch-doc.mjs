// node --env-file=<env> scratch-doc.mjs put <file> | get <name> <outFile> | list | del <name>... : the ops_reports scratch
// docs that carry private payloads to and from the Gemini helper on main (prefix eval-scratch:maya-suggest-6945:).
import { MongoClient } from 'mongodb'; import fs from 'node:fs';
const PFX = 'eval-scratch:maya-suggest-6945:';
const c = new MongoClient(process.env.MONGODB_URI); await c.connect(); const col = c.db('bookstore').collection('ops_reports');
const [cmd, ...a] = process.argv.slice(2);
if (cmd === 'put') { const d = JSON.parse(fs.readFileSync(a[0], 'utf8')); d.created_at = new Date(d.created_at); await col.replaceOne({ _id: d._id }, d, { upsert: true }); console.log('put', d._id); }
if (cmd === 'get') { const d = await col.findOne({ _id: PFX + a[0] }); if (d) { fs.writeFileSync(a[1], JSON.stringify(d)); console.log('got', a[0], Object.keys(d.out || {}).length); } else console.log('missing', a[0]); }
if (cmd === 'list') console.log(JSON.stringify(await col.find({ _id: { $regex: '^' + PFX } }, { projection: { _id: 1, n: 1, created_at: 1 } }).toArray()));
if (cmd === 'del') console.log(JSON.stringify(await col.deleteMany({ _id: { $in: a.map((n) => PFX + n) } })));
await c.close();
