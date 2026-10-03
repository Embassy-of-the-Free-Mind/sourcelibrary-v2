import { MongoClient } from 'mongodb';
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db('bookstore');
const langs = ['Hebrew','Aramaic','Arabic','Persian','Judeo-Arabic','Yiddish','Ladino','Judeo-Persian','Ottoman Turkish','Syriac'];
const rows = await db.collection('books').aggregate([
 {$match:{language:{$in:langs}, visible:true, pages_count:{$gt:0}}},
 {$group:{_id:'$language', books:{$sum:1}, pages:{$sum:'$pages_count'}, tr:{$sum:{$ifNull:['$pages_translated',0]}}}}]).toArray();
console.log(rows);
