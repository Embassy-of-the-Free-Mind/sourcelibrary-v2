#!/usr/bin/env node
/**
 * Queue translation jobs for books via direct MongoDB + SQS.
 * Bypasses Vercel API auth. Requires env vars for MongoDB, SQS, and AWS.
 *
 * Usage:
 *   set -a; source .env.local; set +a; node scripts/queue-translations.mjs
 *
 * Options:
 *   --book-id=ID     Queue a specific book
 *   --dry-run        Show what would be queued without actually queuing
 *   --limit=N        Max books to queue (default: all in BOOKS list)
 */

import { MongoClient } from 'mongodb';
import { SQSClient, SendMessageBatchCommand } from '@aws-sdk/client-sqs';
import { nanoid } from 'nanoid';

// ── Configuration ──────────────────────────────────────────────────────

const TRANSLATION_QUEUE_URL = process.env.SQS_PAGE_TRANSLATION_QUEUE_URL;
const MONGODB_URI = process.env.MONGODB_URI;
const AWS_REGION = process.env.AWS_REGION || 'eu-central-1';

// Books to translate, in priority order
const BOOKS = [
  // === WAVE 3: Major alchemical/kabbalistic collections ===
  { id: '69751588a88d83c830d99e16', note: 'Artis auriferae vol 1 — 1245p Latin' },
  { id: '69751588a88d83c830d99e18', note: 'Artis cabalisticae Tomus I — 1135p Latin' },
  { id: '6974b642457dd8909910b9e5', note: 'Opus de arcanis catholicae veritatis (Cabala) — 945p Latin' },
  { id: '6975158ea88d83c830d99e3c', note: 'Auriferae artis antiquissimae — 753p Latin' },
  { id: '69526137ab34727b1f046674', note: 'Auriferae artis (Turba Philosophorum) — 400p Latin' },
  { id: '6976e865caea4bb6304d1aac', note: 'Basilica chymica (Crollius) — 581p Latin' },
  { id: '697947a145e954e8a877872d', note: 'Commentarius in Currum triumphalem antimonii — 804p Latin' },

  // === WAVE 3: Key English modernizations ===
  { id: '6952caa077f38f6761bc408b', note: 'Complete Works of Plato (English) — 1147p' },
  { id: '6991e93135ed50020acc1458', note: 'Notebooks of Leonardo da Vinci — 898p English' },
  { id: '6975158ea88d83c830d99e40', note: 'Aurora (Boehme) — 724p English' },
  { id: '6816b270-a7e0-4782-b332-3f827bed541d', note: 'Ripley Revivd — 340p English' },
  { id: '69528a11ab34727b1f04e1cb', note: 'Key to Theosophy (Blavatsky) — 152p English' },
  { id: '6974b63c19126e775cf6d7cd', note: 'Apostolici (lives of the apostles) — 424p English' },

  // === WAVE 3: Boehme & German mysticism ===
  { id: '69751590233423aeec9e88ee', note: 'Aurora, oder Morgen-Roehte (Boehme) — 618p German' },
  { id: '697704f1d2171799db0a732f', note: 'Beschreibung der drey Principien (Boehme) — 677p German' },
  { id: '697704f4594860622102d565', note: 'Beschreibung drey Grundeigenschaften (Boehme) — 580p German' },
  { id: '6978ee37a87012956d883ad4', note: 'Christosophia (Boehme) — 567p German' },
  { id: '695258ceab34727b1f0457c2', note: 'Opus Mago-Cabbalisticum (Welling) — 465p German' },
  { id: '6978ee3af4d5bdc7b3df604c', note: 'Chymische Schriften — 1012p German' },
  { id: '6975158da88d83c830d99e38', note: 'Aureum vellus (Golden Fleece) — 892p German' },
  { id: '6970e3849b09d309d780a2da', note: 'Antrum naturae et artis reclusum — 397p German' },

  // === WAVE 3: German alchemical ===
  { id: '6978ee3a696f7923ca0f5c12', note: 'Chymische Schrifften — 589p German' },
  { id: '69792492f35c6bbfbfd252eb', note: 'Closter pratic — 581p German' },
  { id: '6970e3639b09d309d780a270', note: 'Alchymia denudata — 604p German' },

  // === WAVE 3: Descartes, Pascal, French philosophy ===
  { id: '6953eaad1479a63c11087441', note: 'Oeuvres de Descartes Vol I (Correspondance) — 513p French' },
  { id: '6953eab81479a63c1108770c', note: 'Oeuvres de Descartes Vol VII (Meditationes) — 450p French' },
  { id: '6953e5f21479a63c110842bb', note: 'Oeuvres de Blaise Pascal Vol I — 276p French' },
  { id: '697d9c99f2b56306a9ec9612', note: 'Harmonie mystique (alchemical) — 577p French' },

  // === WAVE 3: Kircher, Macrobius, classical ===
  { id: '69527350ab34727b1f048c2e', note: 'Obeliscus Pamphilius (Kircher) — 433p Latin' },
  { id: '695273a7ab34727b1f04a708', note: 'Oedipus Aegyptiacus Vol III (Kircher) — 418p Latin' },
  { id: '695273a1ab34727b1f049baf', note: 'Oedipus Aegyptiacus Vol II (Kircher) — 356p Latin' },
  { id: '695573a0f63a757109172141', note: 'In Somnium Scipionis / Saturnalia (Macrobius) — 448p Latin' },
  { id: '6979446ddcf302c58a41a4d5', note: 'Commentariorum in Apocalypsin — 649p Latin' },
  { id: '6970e3549b09d309d780a242', note: 'Adagiorum chiliades (Erasmus) — 696p Latin' },
  { id: '6970e37f9b09d309d780a2ca', note: 'Antiquitates biblicae — 483p Latin' },
  { id: '6970e35d9b09d309d780a25e', note: 'Al-Coranus (Latin Quran) — 172p Latin' },

  // === WAVE 3: Dutch collection ===
  { id: '6970e36a9b09d309d780a286', note: 'Het eerste stuck van de wercken — 1184p Dutch' },
  { id: '6978ee3aa6943c06198ef83f', note: 'De christelyke god-geleertheid — 876p Dutch' },
  { id: '6970e36e9b09d309d780a294', note: 'Alphabetische naamlyst der Ketteren — 470p Dutch' },
  { id: '6978ee3af4d5bdc7b3df604a', note: 'Christus de wegh — 455p Dutch' },
  { id: '6978ee3a4c10f187b13c7816', note: 'Chronyck der Waldensen — 399p Dutch' },

  // === WAVE 3: Latin-German alchemical ===
  { id: '69792cdef35c6bbfbfd252fb', note: 'Coelum reseratum chymicum — 377p Latin-German' },
  { id: '6975158ca88d83c830d99e36', note: 'Aureum seculum patefactum — 217p Latin-German' },
  { id: '69792abef35c6bbfbfd252f7', note: 'Coelum philosophorum (Liebhaber) — 165p Latin-German' },
  { id: '697936d98e450bc779a9cadb', note: 'Colloquium Rhodostauroticum — 145p Latin-German' },
  { id: '69792ac2f35c6bbfbfd252f9', note: 'Coelum philosophorum (heimlichkeit) — 143p Latin-German' },

  // === WAVE 3: Greek, Armenian, Hebrew, Irish ===
  { id: '6953114a77f38f6761bcc13e', note: 'Patrum Apostolicorum Opera — 418p Greek' },
  { id: '6953a8b277f38f6761bd365c', note: 'Codex Sinaiticus (Tischendorf) — 94p Greek' },
  { id: '69557474f63a7571091734e4', note: 'Commentarius in Platonis Timaeum — 203p Greek/Latin' },
  { id: '6953a81577f38f6761bd08df', note: 'David the Invincible — 262p Armenian' },
  { id: '6953a82c77f38f6761bd0bc5', note: 'NT Armenian-Greek-Italian trilingual — 131p Armenian' },
  { id: '697711607e1d5a07ae945879', note: 'Chamisha chumshe Torah (Pentateuch) — 316p Hebrew' },
  { id: '6990630be7b7642c081de08b', note: 'Sefer ha-Zohar (Cremona 1558) — 48p Hebrew' },
  { id: '695584065336c55c8910fd83', note: 'Ancient Laws of Ireland (Brehon Laws) — 106p Irish/English' },
  { id: '695583d05336c55c8910fa27', note: 'Dean of Lismore Book (Gaelic Poetry) — 110p Irish/English' },

  // === WAVE 3: Italian (Leonardo + more) ===
  { id: '6991eab12f801130a473dfd8', note: 'Leonardo manuscripts Vol 6 — 406p Italian' },
  { id: '6991eabc2f801130a473e2bc', note: 'Leonardo: Dell anatomia — 358p Italian' },
  { id: '6991eac32f801130a473e514', note: 'Del moto e misura dell acqua — 304p Italian' },
  { id: '6991e70febc7adff9a0b2259', note: 'Codex Forster II (Leonardo) — 105p Italian' },
  { id: '695272feab34727b1f048676', note: 'Le Opere Italiane — 160p Italian' },
];

// ── Args ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const SPECIFIC_BOOK = args.find(a => a.startsWith('--book-id='))?.split('=')[1];
const LIMIT = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] || '999');
const AUTO_MODE = args.includes('--auto');

// ── Main ───────────────────────────────────────────────────────────────

async function main() {
  if (!MONGODB_URI) throw new Error('MONGODB_URI not set');
  if (!TRANSLATION_QUEUE_URL && !DRY_RUN) throw new Error('SQS_PAGE_TRANSLATION_QUEUE_URL not set');

  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  const sqs = new SQSClient({ region: AWS_REGION });

  let bookList;
  if (SPECIFIC_BOOK) {
    bookList = [{ id: SPECIFIC_BOOK, note: 'manual' }];
  } else if (AUTO_MODE) {
    // Dynamically find all translation-ready books
    const candidates = await db.collection('books').find({
      'pipeline_auto.status': { $in: ['ocr_complete', 'metadata_enriched'] },
      pages_ocr: { $gt: 0 },
    }, {
      projection: { id: 1, title: 1, language: 1, pages_ocr: 1, pages_translated: 1, read_count: 1 }
    }).sort({ read_count: -1, pages_ocr: -1 }).toArray();

    bookList = candidates
      .filter(b => (b.pages_ocr || 0) - (b.pages_translated || 0) > 0)
      .slice(0, LIMIT)
      .map(b => ({
        id: b.id,
        note: `${(b.title || '').substring(0, 50)} — ${(b.pages_ocr || 0) - (b.pages_translated || 0)}p ${b.language || '?'}`
      }));
    console.log(`AUTO MODE: Found ${bookList.length} translation-ready books\n`);
  } else {
    bookList = BOOKS.slice(0, LIMIT);
  }

  let totalQueued = 0;
  let totalBooks = 0;

  for (const entry of bookList) {
    const book = await db.collection('books').findOne({ id: entry.id });
    if (!book) {
      console.log(`SKIP ${entry.id}: book not found`);
      continue;
    }

    // Check for active job
    if (book.job) {
      const activeJob = await db.collection('jobs').findOne({
        id: book.job.job_id,
        status: { $nin: ['completed', 'failed', 'cancelled', 'partial', 'completed_with_errors'] }
      });
      if (activeJob) {
        console.log(`SKIP "${book.title}": active ${activeJob.type} job (${activeJob.status})`);
        continue;
      }
    }

    // Get untranslated pages with OCR
    const untranslated = await db.collection('pages').find({
      book_id: entry.id,
      'ocr.data': { $exists: true, $ne: '' },
      $or: [
        { 'translation.data': { $exists: false } },
        { 'translation.data': '' },
        { 'translation.data': null }
      ]
    }, { projection: { id: 1, page_number: 1 } }).sort({ page_number: 1 }).toArray();

    if (untranslated.length === 0) {
      console.log(`SKIP "${book.title}": all pages translated`);
      continue;
    }

    const pageIds = untranslated.map(p => p.id);
    console.log(`\nQUEUE "${book.title}" — ${pageIds.length} pages (${book.language || 'unknown'})`);
    console.log(`  ${entry.note}`);

    if (DRY_RUN) {
      console.log(`  [DRY RUN] Would queue ${pageIds.length} pages`);
      totalQueued += pageIds.length;
      totalBooks++;
      continue;
    }

    // Create job record
    const jobId = nanoid(12);
    await db.collection('jobs').insertOne({
      id: jobId,
      type: 'translation',
      book_id: entry.id,
      book_title: book.title,
      status: 'pending',
      progress: { total: pageIds.length, completed: 0, failed: 0 },
      config: {
        page_ids: pageIds,
        model: 'gemini-3-flash-preview',
        language: book.language || 'auto-detect'
      },
      initiated_by: 'script:queue-translations',
      created_at: new Date(),
      updated_at: new Date()
    });

    // Set active job on book
    await db.collection('books').updateOne(
      { id: entry.id },
      { $set: { job: { type: 'realtime', job_id: jobId } } }
    );

    // Send to SQS FIFO queue in batches of 10
    let sent = 0;
    for (let i = 0; i < pageIds.length; i += 10) {
      const batch = pageIds.slice(i, i + 10);
      const entries = batch.map((pageId, idx) => ({
        Id: String(idx),
        MessageBody: JSON.stringify({ bookId: entry.id, pageId, jobId }),
        MessageGroupId: jobId, // FIFO: sequential per job
        MessageDeduplicationId: `${jobId}-${pageId}` // Prevent duplicates
      }));

      const result = await sqs.send(new SendMessageBatchCommand({
        QueueUrl: TRANSLATION_QUEUE_URL,
        Entries: entries
      }));

      const successCount = result.Successful?.length || 0;
      const failCount = result.Failed?.length || 0;
      sent += successCount;
      if (failCount > 0) {
        console.log(`  WARNING: ${failCount} messages failed in batch`);
        result.Failed?.forEach(f => console.log(`    ${f.Id}: ${f.Message}`));
      }
    }

    console.log(`  -> Job ${jobId}, ${sent}/${pageIds.length} messages sent to SQS`);
    totalQueued += sent;
    totalBooks++;

    // Small delay between books to be gentle
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`\n=== Done: ${totalBooks} books, ${totalQueued} pages queued ===`);
  if (DRY_RUN) console.log('(DRY RUN — nothing actually queued)');

  await client.close();
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
