/**
 * Batch reimport books with TOO FEW pages (no OCR work to lose)
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

const safeToReimport = [
  '0a481175-492d-46c5-95b9-8042e7b6710a',
  '17c0e140-78f4-420f-98b3-01bf7dbb683a',
  '4a8d8a33-7bfe-47de-af1a-6febc5287f98',
  '4adda30b-b8da-4e16-ad21-9f14bf286a23',
  '5ddd6b40-5a26-4994-86ea-e2dfd4957597',
  '69488ddc73ee5c998cfe0f66',
  '6952587bab34727b1f045546',
  '69525f56ab34727b1f046185',
  '69528509ab34727b1f04b1db',
  '69528549ab34727b1f04b240',
  '69528566ab34727b1f04b7ee',
  '69528570ab34727b1f04b8a1',
  '6952861eab34727b1f04c3df',
  '69528622ab34727b1f04c566',
  '69528662ab34727b1f04c6f8',
  '69528666ab34727b1f04c966',
  '695286feab34727b1f04cf28',
  '69528702ab34727b1f04cf65',
  '695289a9ab34727b1f04dab6',
  '695289acab34727b1f04db44',
  '695289bdab34727b1f04dc4d',
  '69528a25ab34727b1f04e9ec',
  '69528a33ab34727b1f04ea51',
  '69528b14ab34727b1f04f20a',
  '69528f29b184004c526a0eb5',
  '69528f2bb184004c526a0f1a',
  '695294dbb184004c526a272b',
  '6952b03577f38f6761bc211a',
  '6952b05277f38f6761bc265c',
  '6952b05577f38f6761bc26c0',
  '6952b06677f38f6761bc2725',
  '6952c9c477f38f6761bc2eab',
  '6952ca2a77f38f6761bc33bf',
  '6952d04f77f38f6761bc4ee2',
  '6952d08677f38f6761bc5477',
  '6952d0c777f38f6761bc59f6',
  '6952d13377f38f6761bc5e29',
  '6952d19977f38f6761bc5eb1',
  '6952db5477f38f6761bc7402',
  '6952db5777f38f6761bc7519',
  '6952dbc477f38f6761bc75f1',
  '6952dbf977f38f6761bc7720',
  '6952dc0077f38f6761bc7792',
  '6952e45177f38f6761bc7806',
  '6952e45477f38f6761bc79e0',
  '6952e4b477f38f6761bc7d4c',
  '6952e4e277f38f6761bc9298',
  '6952f71777f38f6761bc997a',
  '6953113477f38f6761bcc018',
  '6953113877f38f6761bcc0d9',
  '6953114f77f38f6761bcc478',
  '6953117a77f38f6761bcc741',
  '6da19aeb-aec0-411c-b890-73035c92273d',
  '71f68423-2c87-47d3-87fa-a744688d3370',
  '7d66e9ad-9572-49c6-82ce-0265337e491d',
  '7fad466b-fc3a-4869-8b8d-8b121fd2def6',
  '8a9eea4b-6be1-4424-9a38-b7a0deb58f95',
  '96f54e7a-a3c2-4623-a8dd-563f61b4b6a0',
  '985e5c8f-b1a4-400e-8761-08ce0fc5b6da',
  '9cafe1ee-dd5a-4dcf-ac9a-803ca75f5bb4',
  '9f2fd808-7d15-40c2-a333-885c67ff3cb5',
  'b453af34-40c2-46ff-876b-9d0245b70087',
  'dcb9a95b-40b3-4a72-ad3b-744f0f766699',
  'dfb9c1de-d300-4e1b-a9c1-941cdb809764'
];

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://sourcelibrary.org';

async function reimportBook(bookId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(`${BASE_URL}/api/books/${bookId}/reimport`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'full' })
    });

    if (!res.ok) {
      const text = await res.text();
      return { success: false, error: `HTTP ${res.status}: ${text.substring(0, 100)}` };
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

async function main() {
  console.log(`Reimporting ${safeToReimport.length} books without OCR work...\n`);

  let success = 0;
  let failed = 0;

  for (let i = 0; i < safeToReimport.length; i++) {
    const bookId = safeToReimport[i];
    process.stdout.write(`[${i + 1}/${safeToReimport.length}] ${bookId}... `);

    const result = await reimportBook(bookId);

    if (result.success) {
      console.log('✓');
      success++;
    } else {
      console.log(`✗ ${result.error}`);
      failed++;
    }

    // Small delay between requests
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Success: ${success}`);
  console.log(`Failed: ${failed}`);
}

main().catch(console.error);
