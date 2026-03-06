import { MongoClient } from 'mongodb';

// Pre-computed alternatives from Phase 1 search
const FOUND = [
  { title: 'The Secret Teachings of All Ages', author: 'Manly P. Hall', language: 'English', altIa: 'manly-p.-hall-the-secret-teachings-of-all-ages-2009-j.-augustus-knapp', collections: ['magic', 'secret-societies'] },
  { title: 'The Book of the Dead', author: 'E.A. Wallis Budge', language: 'Egyptian', altIa: 'in.ernet.dli.2015.200659', collections: ['sacred-texts'] },
  { title: 'The Book of the Dead: The Papyrus of Ani', author: 'E.A. Wallis Budge', language: 'Egyptian', altIa: 'papyrus-of-ani-volumen-i', collections: ['sacred-texts'] },
  { title: 'The Book of Ceremonial Magic', author: 'Arthur Edward Waite', language: 'English', altIa: 'a.-e.-waite-the-book-of-ceremonial-magic', collections: ['magic'] },
  { title: 'Kebra Nagast', author: 'E. A. Wallis Budge', language: 'Egyptian', altIa: 'kebranagast', collections: ['sacred-texts', 'theology'] },
  { title: 'The Confucian Analects', author: 'Confucius / James Legge', language: 'Chinese', altIa: 'bub_gb_oJ49Fe-drvcC', collections: ['chinese-classics', 'classical-philosophy'] },
  { title: 'The Buddhism of Tibet, or Lamaism', author: 'L. Austine Waddell', language: 'English', altIa: 'cu31924023203288', collections: ['indic-traditions', 'theology'] },
  { title: 'The Gods of Northern Buddhism', author: 'Alice Getty', language: 'English', altIa: 'in.ernet.dli.2015.207352', collections: ['indic-traditions', 'theology'] },
  { title: 'Divine Love and Divine Wisdom', author: 'Emanuel Swedenborg', language: 'English', altIa: 'bub_gb_Xotx7VTaEZ4C', collections: ['theology', 'mysticism'] },
  { title: 'Conjugial Love', author: 'Emanuel Swedenborg', language: 'English', altIa: 'conjugialloveits0000unse', collections: ['theology'] },
  { title: 'The Principia; or, The First Principles of Natural Things', author: 'Emanuel Swedenborg', language: 'Latin', altIa: 'principiaorfirs00swedgoog', collections: ['natural-philosophy', 'theology'] },
  { title: 'The Soul, or Rational Psychology', author: 'Emanuel Swedenborg', language: 'English', altIa: 'soulorrationalps00sweduoft', collections: ['theology', 'renaissance-philosophy'] },
  { title: 'The Book of the Thousand Nights and a Night, Vol. 1', author: 'Richard F. Burton', language: 'English', altIa: 'plainliteraltran02burtiala', collections: ['literature'] },
  { title: 'Process and Reality', author: 'Alfred North Whitehead', language: 'English', altIa: 'processreality0000alfr_b1l4', collections: ['theology', 'classical-philosophy'] },
  { title: 'The Religious System of the Amazulu', author: 'Henry Callaway', language: 'English', altIa: 'relamazulu00calluoft', collections: ['theology'] },
  { title: 'West African Studies', author: 'Mary Kingsley', language: 'English', altIa: 'westafricanstudi00king', collections: ['theology'] },
  { title: 'Ashanti', author: 'Robert Sutherland Rattray', language: 'English', altIa: 'ashantilawconsti0000ratt_g8d4', collections: ['theology'] },
  { title: 'The Village Gods of South India', author: 'Henry Whitehead', language: 'English', altIa: 'VillageGodsOfSouthIndia', collections: ['indic-traditions', 'theology'] },
  { title: 'The Melanesians', author: 'Robert Henry Codrington', language: 'English', altIa: 'melanesiansstud00codrgoog', collections: ['theology'] },
  { title: 'The Native Tribes of Central Australia', author: 'Baldwin Spencer and F. J. Gillen', language: 'English', altIa: 'nativetribesofce00spen_0', collections: [] },
  { title: 'The Literature of the Ancient Egyptians', author: 'Adolf Erman', language: 'English', altIa: 'literatureofanci0000adol_d8q3', collections: ['theology', 'sacred-texts'] },
  { title: 'Epic Mythology', author: 'Edward Washburn Hopkins', language: 'English', altIa: 'epicmythology00hopkuoft', collections: ['classical-philosophy'] },
  { title: 'On the Sensations of Tone', author: 'Hermann von Helmholtz', language: 'English', altIa: 'onsensationston01helmgoog', collections: ['medicine'] },
  { title: 'Korean Folk Tales: Imps, Ghosts, and Fairies', author: 'Im Pang (tr. James Gale)', language: 'English', altIa: 'koreanfolktalesi00impaiala', collections: ['literature', 'chinese-classics', 'demonology'] },
  { title: 'Sri Ramakrishna, the Great Master', author: 'Swami Saradananda', language: 'English', altIa: 'dli.ernet.475773', collections: ['indic-traditions', 'mysticism'] },
  { title: 'A Prose English Translation of the Harivamsha', author: 'Manmatha Nath Dutt', language: 'Sanskrit', altIa: 'a-prose-english-translation-of-harivamsha', collections: ['indic-traditions', 'literature'] },
  { title: 'The Seven Valleys and The Four Valleys', author: "Bahá'u'lláh", language: 'English', altIa: 'thesevenvalleysa16986gut', collections: ['sacred-texts', 'theology'] },
  { title: 'Hayti, or the Black Republic', author: 'Spenser St. John', language: 'English', altIa: 'b24849868', collections: ['theology'] },
  { title: 'Ancient Buddhism in Japan, Vol. 1', author: 'M.W. de Visser', language: 'English', altIa: 'in.gov.ignca.35672', collections: ['indic-traditions'] },
  { title: 'The Sacred Formulas of the Cherokees', author: 'James Mooney', language: 'English', altIa: 'b24859059', collections: ['magic', 'sacred-texts'] },
  { title: 'The Art of Logical Thinking', author: 'William Walker Atkinson', language: 'English', altIa: 'artoflogicalthin00atki', collections: ['renaissance-philosophy'] },
  { title: 'How to Read Human Nature', author: 'William Walker Atkinson', language: 'English', altIa: 'howtoreadhumanna00atki', collections: ['renaissance-philosophy'] },
  { title: 'Thought-Culture; or, Practical Mental Training', author: 'William Walker Atkinson', language: 'English', altIa: 'thoughtcultureor00atki', collections: ['mysticism'] },
  { title: 'Practical Psychomancy and Crystal Gazing', author: 'William Walker Atkinson', language: 'English', altIa: 'practicalpsycho00atki', collections: ['magic', 'mysticism'] },
  { title: 'Practical Mental Influence', author: 'William Walker Atkinson', language: 'English', altIa: 'b33408853', collections: ['mysticism'] },
  { title: 'Reincarnation and the Law of Karma', author: 'William Walker Atkinson', language: 'English', altIa: 'william-walker-atkinson-reincarnation-and-the-law-of-karma', collections: ['indic-traditions', 'mysticism'] },
  { title: 'The Secret of Success', author: 'William Walker Atkinson', language: 'English', altIa: 'william-walker-atkinson-secret-of-success', collections: ['mysticism'] },
  { title: 'Mind and Body; or, Mental States and Physical Conditions', author: 'William Walker Atkinson', language: 'English', altIa: 'mindandbody00walkgoog', collections: ['mysticism'] },
  { title: 'The Human Aura', author: 'Swami Panchadasi (William Walker Atkinson)', language: 'English', altIa: 'humanauraastral00pancgoog', collections: ['mysticism', 'natural-philosophy'] },
  { title: 'A History of Indian Philosophy, Volume 1', author: 'Surendranath Dasgupta', language: 'English', altIa: 'historyofindianp01dasguoft', collections: ['indic-traditions', 'classical-philosophy'] },
  { title: 'Samayasara, or The Nature of the Self', author: 'Kundakunda', language: 'Sanskrit', altIa: 'in.ernet.dli.2015.341277', collections: ['indic-traditions', 'mysticism'] },
  { title: 'Samayasara: The Soul-Essence', author: 'Kundakunda', language: 'Sanskrit', altIa: 'samayasarathesou0008kund', collections: ['indic-traditions', 'mysticism'] },
  { title: 'I Libri della Famiglia', author: 'Leon Battista Alberti', language: 'Italian', altIa: 'libridellafamigliaileonbattistaalberti', collections: ['renaissance-philosophy'] },
  { title: 'De Deo (Refutation of Sects)', author: 'Eznik of Kolb', language: 'Armenian', altIa: 'eznik-1959-maries-mercier', collections: ['theology'] },
  { title: 'The Geneva Bible (1560, Facsimile)', author: 'William Whittingham et al.', language: 'English', altIa: 'geneva-bible-1560-truthbetold-ministry-joern-andre-halseth', collections: ['sacred-texts', 'theology'] },
  { title: 'The Book of the Thousand Nights and a Night, Vol. 5', author: 'Richard F. Burton', language: 'English', altIa: 'bookthousandnig01smitgoog', collections: ['literature'] },
  // Vol 6 — need to find separately, skip for now
];

async function reimportBook(bookData) {
  const url = 'https://sourcelibrary.org/api/import/ia';
  const body = {
    ia_identifier: bookData.altIa,
    title: bookData.title,
    author: bookData.author,
    original_language: bookData.language,
  };

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.CRON_SECRET}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
    });
    const data = await resp.json();
    if (!resp.ok) {
      return { success: false, error: data.error || `HTTP ${resp.status}` };
    }
    return { success: true, bookId: data.id || data.bookId, url: data.url, pages: data.pages_count || data.pagesCount };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  let imported = 0, failed = 0, skipped = 0;

  console.log(`Importing ${FOUND.length} books from alternative IA editions...\n`);

  for (let i = 0; i < FOUND.length; i++) {
    const book = FOUND[i];
    process.stdout.write(`[${i+1}/${FOUND.length}] ${book.title.substring(0, 55)}... `);

    // Check if already imported
    const existing = await db.collection('books').findOne(
      { 'image_source.identifier': book.altIa },
      { projection: { id: 1, title: 1, _id: 0 } }
    );
    if (existing) {
      console.log(`SKIP (exists: ${existing.id})`);
      skipped++;
      continue;
    }

    const result = await reimportBook(book);
    if (result.success) {
      console.log(`OK — ${result.pages || '?'} pages (${result.bookId})`);
      // Assign collections
      if (book.collections?.length) {
        await db.collection('books').updateOne(
          { id: result.bookId },
          { $set: { collections: book.collections } }
        );
      }
      imported++;
    } else {
      console.log(`FAILED: ${result.error}`);
      failed++;
    }

    // Wait 2s between imports to avoid hammering IA
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log(`\n=== Results ===`);
  console.log(`Imported: ${imported}`);
  console.log(`Failed: ${failed}`);
  console.log(`Skipped (already exist): ${skipped}`);

  await client.close();
}

main();
