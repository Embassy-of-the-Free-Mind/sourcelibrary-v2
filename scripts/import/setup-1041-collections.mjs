#!/usr/bin/env node
/**
 * Issue #1041: Create collection structure and assign books
 *
 * Collections:
 * - Chinese Theater (+ Yuan Zaju, Ming Chuanqi & Kunqu, Theater Theory)
 * - European Theater (+ Medieval Drama, Italian Renaissance, Spanish Golden Age, French Classical, English Renaissance)
 * - World Fable Traditions (+ Panchatantra & Derivatives, Buddhist Jataka, Chinese Philosophical Fables, Persian & Arabic Fables)
 * - Chinese Technology (+ Agricultural & Industrial, Military, Architecture, Natural History)
 */

import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
dotenv.config({ path: '/Users/dereklomas/sourcelibrary/.env.production.local' });

const client = new MongoClient(process.env.MONGODB_URI);

const COLLECTIONS = [
  // === CHINESE THEATER ===
  {
    slug: 'chinese-theater',
    name: 'Chinese Theater',
    subtitle: 'Yuan zaju through Ming chuanqi — the golden ages of Chinese drama',
    description: 'The two great eras of Chinese dramatic literature: the Yuan dynasty zaju (杂剧, 13th–14th century) — short, intense plays with arias in a single mode — and the Ming dynasty chuanqi (传奇, 16th–17th century) — extended romantic dramas with their own musical system. This collection presents original woodblock editions from the period, including the landmark 元曲選 anthology of 100 Yuan plays, Tang Xianzu\'s masterpiece 牡丹亭 (The Peony Pavilion), and the illustrated 琵琶記 (The Lute) with its 74 Wanli-era woodcuts.',
    color: '#b5383c',
    order: 25,
    subcollections: [
      { slug: 'yuan-zaju', name: 'Yuan Zaju (元曲)', subtitle: 'The hundred masterpieces of Yuan dynasty drama', parent: 'chinese-theater' },
      { slug: 'ming-chuanqi', name: 'Ming Chuanqi & Kunqu', subtitle: 'Romantic drama and the art of kunqu opera', parent: 'chinese-theater' },
      { slug: 'chinese-theater-theory', name: 'Chinese Theater Theory', subtitle: 'Critical and aesthetic writings on drama', parent: 'chinese-theater' },
    ],
  },

  // === EUROPEAN THEATER ===
  {
    slug: 'renaissance-theater',
    name: 'European Theater',
    subtitle: 'From medieval morality plays to Shakespeare\'s First Folio',
    description: 'The emergence and flowering of European dramatic literature, from Hrotsvitha of Gandersheim\'s 10th-century Latin plays (printed in 1501 with Dürer woodcuts) through the commedia dell\'arte scenarios of Flaminio Scala, to the national traditions of Shakespeare, Lope de Vega, Corneille, and Racine. Period editions preserve the material culture of early modern theater: quartos, folios, and illustrated printings from the workshops that first brought these plays to readers.',
    color: '#4a6741',
    order: 26,
    subcollections: [
      { slug: 'medieval-drama', name: 'Medieval Drama', subtitle: 'Latin plays, mystery cycles, and morality plays', parent: 'renaissance-theater' },
      { slug: 'italian-renaissance-theater', name: 'Italian Renaissance Theater', subtitle: 'Pastoral drama, commedia dell\'arte, and dramatic theory', parent: 'renaissance-theater' },
      { slug: 'spanish-golden-age', name: 'Spanish Golden Age Theater', subtitle: 'Comedia nueva from La Celestina to Calderón', parent: 'renaissance-theater' },
      { slug: 'french-classical-theater', name: 'French Classical Theater', subtitle: 'Corneille, Molière, and Racine in first editions', parent: 'renaissance-theater' },
      { slug: 'english-renaissance-theater', name: 'English Renaissance Theater', subtitle: 'From Kyd and Marlowe to Shakespeare and Jonson', parent: 'renaissance-theater' },
    ],
  },

  // === WORLD FABLE TRADITIONS ===
  {
    slug: 'world-fable-traditions',
    name: 'World Fable Traditions',
    subtitle: 'The Panchatantra transmission chain and its global descendants',
    description: 'One of the most remarkable chains of transmission in world literature: animal fables that originated in Sanskrit India, traveled through Persian and Arabic courts, crossed into medieval Latin and German, and shaped storytelling traditions across three continents. This collection traces the Panchatantra from its earliest critical editions through the Arabic Kalila wa-Dimna (including a spectacular 13th-century illuminated manuscript with 98 miniatures), the Buddhist Jataka tales, and the Chinese philosophical fable tradition of Han Feizi and Liezi.',
    color: '#c9862e',
    order: 27,
    subcollections: [
      { slug: 'panchatantra-derivatives', name: 'Panchatantra & Derivatives', subtitle: 'Sanskrit originals and their Latin, German, and Persian adaptations', parent: 'world-fable-traditions' },
      { slug: 'buddhist-jataka', name: 'Buddhist Jataka Tales', subtitle: 'Birth stories of the Buddha in Pali and translation', parent: 'world-fable-traditions' },
      { slug: 'chinese-philosophical-fables', name: 'Chinese Philosophical Fables', subtitle: 'Parables from Han Feizi, Liezi, and the Legalist tradition', parent: 'world-fable-traditions' },
      { slug: 'persian-arabic-fables', name: 'Persian & Arabic Fables', subtitle: 'Kalila wa-Dimna and the Anvar-i Suhaili tradition', parent: 'world-fable-traditions' },
    ],
  },

  // === CHINESE TECHNOLOGY ===
  {
    slug: 'chinese-technology',
    name: 'Chinese Technology & Science',
    subtitle: 'Illustrated technical manuals from the Song through Ming dynasties',
    description: 'China\'s extraordinary tradition of illustrated technical literature, from Shen Kuo\'s 11th-century Dream Pool Essays to Song Yingxing\'s 1637 天工開物 (Tiangong Kaiwu) — a comprehensive encyclopedia of manufacturing and agriculture that has been called "the Chinese Diderot." These woodblock-illustrated manuals document everything from bronze casting and silk weaving to gunpowder weapons and astronomical instruments, preserving knowledge that was centuries ahead of contemporary European practice.',
    color: '#6b5b3e',
    order: 28,
    subcollections: [
      { slug: 'chinese-agricultural-industrial', name: 'Agricultural & Industrial Manuals', subtitle: 'Manufacturing, agriculture, and craft production', parent: 'chinese-technology' },
      { slug: 'chinese-military-technology', name: 'Military Technology', subtitle: 'Weapons, fortifications, and naval engineering', parent: 'chinese-technology' },
      { slug: 'chinese-natural-history', name: 'Natural History & Materia Medica', subtitle: 'Botanical, medical, and encyclopedic works', parent: 'chinese-technology' },
    ],
  },
];

// Book assignments: ia_id or title fragment → collection slugs
const BOOK_ASSIGNMENTS = [
  // Yuan Zaju
  { match: { ia_id: /^02111(087|088|089|090|091)\.cn$/ }, collections: ['chinese-theater', 'yuan-zaju'] },

  // Ming Chuanqi & Kunqu
  { match: { ia_id: 'pipa-ji' }, collections: ['chinese-theater', 'ming-chuanqi'] },
  { match: { ia_id: '02111381.cn' }, collections: ['chinese-theater', 'ming-chuanqi'] },
  { match: { ia_id: '02111355.cn' }, collections: ['chinese-theater', 'ming-chuanqi'] },
  { match: { ia_id: 'sheng-ming-za-ju2' }, collections: ['chinese-theater', 'ming-chuanqi'] },
  { match: { ia_id: '02111240.cn' }, collections: ['chinese-theater', 'ming-chuanqi'] },
  { match: { ia_id: '02110809.cn' }, collections: ['chinese-theater', 'ming-chuanqi'] },
  { match: { ia_id: /^m_042_yumingtang/ }, collections: ['chinese-theater', 'ming-chuanqi'] },
  { match: { ia_id: /kunqucuicun/ }, collections: ['chinese-theater', 'ming-chuanqi'] },

  // Chinese Theater Theory
  { match: { ia_id: '02097225.cn' }, collections: ['chinese-theater', 'chinese-theater-theory'] },

  // Medieval Drama
  { match: { ia_id: 'operahrosviteill00hrot' }, collections: ['renaissance-theater', 'medieval-drama'] },
  { match: { ia_id: /everymanamoralp/ }, collections: ['renaissance-theater', 'medieval-drama'] },

  // Italian Renaissance Theater
  { match: { ia_id: 'ita-bnc-in2-00002210-001' }, collections: ['renaissance-theater', 'italian-renaissance-theater'] },
  { match: { ia_id: /amintafavolabos/ }, collections: ['renaissance-theater', 'italian-renaissance-theater'] },
  { match: { ia_id: 'ARes71610' }, collections: ['renaissance-theater', 'italian-renaissance-theater'] },
  { match: { ia_id: /ilteatrodellefau/ }, collections: ['renaissance-theater', 'italian-renaissance-theater'] },
  { match: { ia_id: /bub_gb_xWsKZT3LoX4C/ }, collections: ['renaissance-theater', 'italian-renaissance-theater'] },

  // Spanish Golden Age
  { match: { ia_id: /artenuevodehacer/ }, collections: ['renaissance-theater', 'spanish-golden-age'] },
  { match: { title: /Celestina/i }, collections: ['renaissance-theater', 'spanish-golden-age'] },
  { match: { ia_id: /comediafamosalav/ }, collections: ['renaissance-theater', 'spanish-golden-age'] },

  // French Classical Theater
  { match: { gallica_ark: 'bpt6k70391c' }, collections: ['renaissance-theater', 'french-classical-theater'] },
  { match: { gallica_ark: 'btv1b8610800k' }, collections: ['renaissance-theater', 'french-classical-theater'] },
  { match: { gallica_ark: 'bpt6k70169n' }, collections: ['renaissance-theater', 'french-classical-theater'] },
  // Also try matching by title for Gallica books
  { match: { title: /Le Cid/i }, collections: ['renaissance-theater', 'french-classical-theater'] },
  { match: { title: /Tartuffe/i }, collections: ['renaissance-theater', 'french-classical-theater'] },
  { match: { title: /Ph[eè]dre/i }, collections: ['renaissance-theater', 'french-classical-theater'] },

  // English Renaissance Theater
  { match: { ia_id: /workesofbenjamin/ }, collections: ['renaissance-theater', 'english-renaissance-theater'] },
  { match: { ia_id: /thomaskydsspani/ }, collections: ['renaissance-theater', 'english-renaissance-theater'] },
  { match: { ia_id: /bim_early-english.*defence-of-poesie/ }, collections: ['renaissance-theater', 'english-renaissance-theater'] },
  { match: { title: /First Folio|Shakespeare.*Comedies.*Histories/i }, collections: ['renaissance-theater', 'english-renaissance-theater'] },
  { match: { ia_id: /tamburlainegreat/ }, collections: ['renaissance-theater', 'english-renaissance-theater'] },

  // Panchatantra & Derivatives
  { match: { ia_id: /panchatantra/i }, collections: ['world-fable-traditions', 'panchatantra-derivatives'] },
  { match: { ia_id: /firstfourthbooks01mull/ }, collections: ['world-fable-traditions', 'panchatantra-derivatives'] },
  { match: { ia_id: /kathasaritsagar/ }, collections: ['world-fable-traditions', 'panchatantra-derivatives'] },
  { match: { ia_id: /oceanofstorybein/ }, collections: ['world-fable-traditions', 'panchatantra-derivatives'] },
  { match: { title: /Directorium Humanae Vitae/i }, collections: ['world-fable-traditions', 'panchatantra-derivatives'] },
  { match: { title: /Buch der Beispiele/i }, collections: ['world-fable-traditions', 'panchatantra-derivatives'] },

  // Buddhist Jataka
  { match: { ia_id: /in\.ernet\.dli.*292631/ }, collections: ['world-fable-traditions', 'buddhist-jataka'] },

  // Persian & Arabic Fables
  { match: { title: /Kalila.*Dimna/i }, collections: ['world-fable-traditions', 'persian-arabic-fables'] },
  { match: { title: /Anvar.*Suhaili|Suhayli/i }, collections: ['world-fable-traditions', 'persian-arabic-fables'] },
  { match: { title: /Bidpai/i }, collections: ['world-fable-traditions', 'persian-arabic-fables'] },

  // Chinese Technology
  { match: { title: /天工開物|Tiangong Kaiwu/i }, collections: ['chinese-technology', 'chinese-agricultural-industrial'] },
  { match: { ia_id: '02098268.cn' }, collections: ['chinese-technology'] }, // Sancai Tuhui - general
  { match: { ia_id: '06061737.cn' }, collections: ['chinese-technology'] }, // Mengxi Bitan
  { match: { ia_id: /q_099_kaogong/ }, collections: ['chinese-technology', 'chinese-agricultural-industrial'] },
  { match: { ia_id: '02092259.cn' }, collections: ['chinese-technology', 'chinese-military-technology'] },
  { match: { title: /本草綱目|Bencao Gangmu/i }, collections: ['chinese-technology', 'chinese-natural-history'] },
  { match: { ia_id: /florasinensisfru/ }, collections: ['chinese-technology', 'chinese-natural-history'] },
  { match: { title: /農書|Nongshu|Wang Zhen/i }, collections: ['chinese-technology', 'chinese-agricultural-industrial'] },
];

async function main() {
  await client.connect();
  const db = client.db('bookstore');
  const colls = db.collection('collections');
  const books = db.collection('books');

  console.log('=== Issue #1041: Collection Setup ===\n');

  // Step 1: Create/update top-level collections
  for (const col of COLLECTIONS) {
    const existing = await colls.findOne({ slug: col.slug });
    if (existing) {
      console.log(`Updating: ${col.name} (${col.slug})`);
      await colls.updateOne({ slug: col.slug }, {
        $set: {
          name: col.name,
          subtitle: col.subtitle,
          description: col.description,
          color: col.color,
          order: col.order,
          updated_at: new Date(),
        },
      });
    } else {
      console.log(`Creating: ${col.name} (${col.slug})`);
      await colls.insertOne({
        slug: col.slug,
        name: col.name,
        subtitle: col.subtitle,
        description: col.description,
        color: col.color,
        order: col.order,
        book_count: 0,
        languages: [],
        featured_images: [],
        type: 'category',
        hidden: false,
        created_at: new Date(),
        updated_at: new Date(),
      });
    }

    // Create subcollections
    for (const sub of col.subcollections || []) {
      const existingSub = await colls.findOne({ slug: sub.slug });
      if (existingSub) {
        console.log(`  Updating sub: ${sub.name} (${sub.slug})`);
        await colls.updateOne({ slug: sub.slug }, {
          $set: {
            name: sub.name,
            subtitle: sub.subtitle,
            parent: sub.parent,
            updated_at: new Date(),
          },
        });
      } else {
        console.log(`  Creating sub: ${sub.name} (${sub.slug})`);
        await colls.insertOne({
          slug: sub.slug,
          name: sub.name,
          subtitle: sub.subtitle,
          parent: sub.parent,
          book_count: 0,
          languages: [],
          featured_images: [],
          type: 'category',
          hidden: false,
          order: 0,
          created_at: new Date(),
          updated_at: new Date(),
        });
      }
    }
  }

  // Step 2: Assign books to collections
  console.log('\n--- Assigning books ---\n');
  let assigned = 0;

  for (const rule of BOOK_ASSIGNMENTS) {
    let query = {};

    if (rule.match.ia_id) {
      if (rule.match.ia_id instanceof RegExp) {
        query.ia_id = { $regex: rule.match.ia_id.source, $options: rule.match.ia_id.flags };
      } else {
        query.ia_id = rule.match.ia_id;
      }
    }
    if (rule.match.title) {
      query.title = { $regex: rule.match.title.source, $options: rule.match.title.flags };
    }
    if (rule.match.gallica_ark) {
      query.gallica_ark = rule.match.gallica_ark;
    }

    const matchedBooks = await books.find(query, { projection: { title: 1, ia_id: 1, collections: 1 } }).toArray();

    for (const book of matchedBooks) {
      const result = await books.updateOne(
        { _id: book._id },
        { $addToSet: { collections: { $each: rule.collections } } }
      );
      if (result.modifiedCount > 0) {
        console.log(`  + ${book.title.substring(0, 60)} → [${rule.collections.join(', ')}]`);
        assigned++;
      }
    }
  }

  console.log(`\nAssigned ${assigned} book-collection links`);

  // Step 3: Update book counts
  console.log('\n--- Updating book counts ---\n');
  const allColSlugs = [];
  for (const col of COLLECTIONS) {
    allColSlugs.push(col.slug);
    for (const sub of col.subcollections || []) {
      allColSlugs.push(sub.slug);
    }
  }

  for (const slug of allColSlugs) {
    const count = await books.countDocuments({ collections: slug, status: { $ne: 'deleted' } });
    await colls.updateOne({ slug }, { $set: { book_count: count } });
    if (count > 0) {
      // Get language breakdown
      const langAgg = await books.aggregate([
        { $match: { collections: slug, status: { $ne: 'deleted' } } },
        { $group: { _id: '$original_language', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]).toArray();
      const languages = langAgg.map(l => ({ lang: l._id || 'Unknown', count: l.count }));
      await colls.updateOne({ slug }, { $set: { languages } });
    }
    console.log(`  ${slug}: ${count} books`);
  }

  console.log('\n=== Done ===');
  await client.close();
}

main().catch(console.error);
