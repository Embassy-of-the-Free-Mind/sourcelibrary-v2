import { MongoClient } from 'mongodb';
const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri);
await client.connect();
const db = client.db('bookstore');

const distinctLang = await db.collection('books').distinct('language');
console.log('distinct language values (sample):', distinctLang.slice(0, 60));
console.log('count total distinct:', distinctLang.length);

const distinctOrigLang = await db.collection('books').distinct('original_language');
console.log('distinct original_language values (sample):', distinctOrigLang.slice(0, 60));

await client.close();
