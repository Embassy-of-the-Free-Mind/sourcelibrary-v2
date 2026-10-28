import { MongoClient } from 'mongodb';
const c = new MongoClient(process.env.MONGODB_URI); await c.connect(); const db = c.db('bookstore');
const one = await db.collection('lane_job_books').findOne({}); console.log(JSON.stringify(one).slice(0, 600));
const r = await db.collection('lane_job_books').aggregate([{ $group: { _id: '$lane', n: { $sum: 1 } } }]).toArray(); console.log(r);
await c.close();
