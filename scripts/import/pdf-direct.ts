/**
 * pdf-direct.ts — local/Hetzner PDF importer (poppler required)
 *
 * The Vercel `/api/import/pdf` route can't run because `pdftoppm` (poppler)
 * is absent from the Vercel serverless runtime (`spawnSync ENOENT`). This
 * script does the same work where poppler EXISTS (local macOS / Hetzner):
 * download PDF -> pdftoppm -> upload page JPEGs to R2 via storagePut ->
 * insert book + pages HIDDEN. Mirrors the route's doc shape exactly.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   npx tsx scripts/import/pdf-direct.ts <jobs.json>
 *
 * jobs.json: [{ pdf_url | local_pdf+identifier, ia_identifier?, title, author, language,
 *               categories?, source_url?, acquisition_batch?,
 *               provider?, provider_name?, license?, license_url?,   // required without ia_identifier
 *               published?, place_published? }, ...]
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { storagePut } from '@/lib/storage';
import { normalizeTitle, normalizeAuthor, sourceFingerprint, checkDuplicate } from '@/lib/dedup';
import { generateUniqueBookSlug } from '@/lib/slugify';
import { applyTextRole } from '@/lib/text-role';

const DPI = 150;

type Job = {
  pdf_url?: string; ia_identifier?: string; title: string; author: string;
  language: string; categories?: string[]; source_url?: string; acquisition_batch?: string;
  // Who holds the scan and under what terms. Required unless ia_identifier is set: a PDF from
  // a regional library labelled 'Internet Archive' / 'publicdomain' credits the wrong holder (#6559).
  provider?: string; provider_name?: string; license?: string; license_url?: string;
  published?: string; place_published?: string;
  // A PDF a person downloaded through a browser (sources behind a human challenge, e.g. BNE Digital).
  // Needs `identifier` (the library's own item id) so the fingerprint is provider:id, never a disk path.
  local_pdf?: string; identifier?: string;
};

// Rasterise at the PDF's own image resolution (median x-ppi), clamped: a fixed 150 dpi undersamples
// 300-400 ppi library scans, and import-workflow.md says archive at native resolution.
function nativeDpi(pdfPath: string): number {
  try {
    const out = execFileSync('pdfimages', ['-list', pdfPath], { encoding: 'utf8', timeout: 120_000 });
    const ppi = out.split('\n').slice(2).map(l => Number(l.trim().split(/\s+/)[12])).filter(n => n > 0).sort((a, b) => a - b);
    if (ppi.length) return Math.min(400, Math.max(DPI, Math.round(ppi[Math.floor(ppi.length / 2)])));
  } catch { /* fall back */ }
  return DPI;
}

async function importOne(job: Job) {
  const db = await getDb();
  if (!job.ia_identifier && (!job.provider || !job.provider_name || !job.license)) {
    console.log(`  FAIL provenance: a non-IA PDF needs provider, provider_name and license: ${job.title}`);
    return null;
  }
  const provider = job.provider || 'internet_archive';
  const providerName = job.provider_name || 'Internet Archive';
  if (job.local_pdf && (!job.identifier || !job.source_url)) {
    console.log(`  FAIL provenance: a local_pdf needs identifier and source_url (the library's item page): ${job.title}`);
    return null;
  }
  const identifier = job.ia_identifier || job.identifier || null;
  if (!job.pdf_url && !job.local_pdf) { console.log(`  FAIL: neither pdf_url nor local_pdf: ${job.title}`); return null; }
  const source_url = (job.source_url || job.pdf_url) as string;

  // dedup (manifestation + cross-source)
  const fp = sourceFingerprint({ image_source: { provider, identifier: identifier || undefined, pdf_url: job.pdf_url } });
  if (await db.collection('books').findOne({ source_fingerprint: fp })) { console.log(`  SKIP (dupe fingerprint): ${job.title}`); return null; }
  const dedup = await checkDuplicate(db, { title: job.title, author: job.author, image_source: { provider, identifier: identifier || undefined, pdf_url: job.pdf_url, source_url } });
  if (dedup.isDuplicate) { console.log(`  SKIP (dupe ${dedup.matches[0].matchType} -> ${dedup.matches[0].matchedTitle}): ${job.title}`); return null; }

  const tmp = mkdtempSync(join(tmpdir(), 'pdfimp-'));
  try {
    // 1. download (or read the file a person downloaded)
    let buf: Buffer;
    if (job.local_pdf) {
      buf = readFileSync(job.local_pdf);
    } else {
      const res = await fetch(job.pdf_url as string, { signal: AbortSignal.timeout(180000), headers: { 'User-Agent': 'SourceLibrary/1.0 (https://sourcelibrary.org; derek@sourcelibrary.org)' } });
      if (!res.ok) { console.log(`  FAIL download ${res.status}: ${job.title}`); return null; }
      buf = Buffer.from(await res.arrayBuffer());
    }
    const sha256 = createHash('sha256').update(buf).digest('hex');
    const pdfPath = join(tmp, 'book.pdf'); writeFileSync(pdfPath, buf);

    // 2. pdftoppm
    const pagesDir = join(tmp, 'pages'); execFileSync('mkdir', ['-p', pagesDir]);
    const dpi = nativeDpi(pdfPath);
    execFileSync('pdftoppm', ['-jpeg', '-r', String(dpi), '-jpegopt', 'quality=85', pdfPath, join(pagesDir, 'page')], { timeout: 1_800_000 });
    const files = readdirSync(pagesDir).filter(f => f.endsWith('.jpg')).sort();
    if (!files.length) { console.log(`  FAIL 0 pages: ${job.title}`); return null; }

    // 3. upload to R2 (canonical books/{id}/pages/{NNNN}.jpg, matches route)
    const bookId = new ObjectId(); const bookIdStr = bookId.toHexString();
    const urls: { photo: string; bytes: number }[] = [];
    const C = 10;
    for (let b = 0; b < files.length; b += C) {
      const chunk = files.slice(b, b + C);
      const out = await Promise.all(chunk.map(async (f, i) => {
        const idx = b + i; const img = readFileSync(join(pagesDir, f));
        const r = await storagePut(`books/${bookIdStr}/pages/${String(idx).padStart(4, '0')}.jpg`, img, { access: 'public', contentType: 'image/jpeg' });
        return { idx, photo: r.url, bytes: img.length };
      }));
      for (const o of out) urls[o.idx] = { photo: o.photo, bytes: o.bytes };
    }
    const now = new Date(); const pageCount = files.length;

    // 4. book doc (hidden, language explicit, QA-gated)
    const slug = await generateUniqueBookSlug(db, job.title, job.author);
    const bookDoc: Record<string, unknown> = {
      _id: bookId, id: bookIdStr, slug, title: job.title, display_title: null, author: job.author,
      language: job.language, original_language: job.language,
      field_provenance: { language: 'manual_curator_override' },
      curation_status: 'awaiting_qa_eval', acquisition_batch: job.acquisition_batch || 'pdf-direct',
      categories: job.categories || [], thumbnail: urls[0]?.photo || '',
      pages_count: pageCount, pages_ocr: 0, pages_translated: 0,
      ...(job.published ? { published: String(job.published) } : {}),
      ...(job.place_published ? { place_published: job.place_published } : {}),
      dublin_core: { dc_identifier: identifier ? [`IA:${identifier}`] : [], dc_source: source_url },
      image_source: { provider, provider_name: providerName, source_url, ...(job.pdf_url ? { pdf_url: job.pdf_url } : {}), identifier,
        license: job.license || 'publicdomain', ...(job.license_url ? { license_url: job.license_url } : {}), access_date: now,
        extraction: { method: 'pdftoppm', dpi, pdf_sha256: sha256, ...(job.local_pdf ? { acquired_via: 'manual_browser_download' } : {}), jpeg_quality: 85, pdf_size_bytes: buf.length, pages_extracted: pageCount, extracted_at: now } },
      page_count_source: 'pdf_extraction', status: 'draft', hidden: true, visible: false,
      source_fingerprint: fp, normalized_title: normalizeTitle(job.title), normalized_author: normalizeAuthor(job.author),
      created_at: now, updated_at: now,
    };
    applyTextRole(bookDoc);
    await db.collection('books').insertOne(bookDoc as any);

    // 5. pages
    const pageDocs = files.map((_, i) => {
      const pid = new ObjectId(); const photo = urls[i]?.photo || '';
      return { _id: pid, id: pid.toHexString(), book_id: bookIdStr, page_number: i + 1, photo, photo_original: job.pdf_url || source_url, archived_photo: photo,
        archive_metadata: { source_url: job.pdf_url || source_url, source_page: i + 1, archived_at: now, method: 'pdf_extraction', dpi, bytes: urls[i]?.bytes || 0 }, created_at: now, updated_at: now };
    });
    await db.collection('pages').insertMany(pageDocs as any);
    console.log(`  OK ${job.title.slice(0, 48)} -> ${bookIdStr} (${pageCount}pp)`);
    return { bookId: bookIdStr, pages: pageCount };
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

async function main() {
  const jobsFile = process.argv[2];
  if (!jobsFile) { console.error('usage: pdf-direct.ts <jobs.json>'); process.exit(1); }
  const jobs: Job[] = JSON.parse(readFileSync(jobsFile, 'utf8'));
  console.log(`pdf-direct: ${jobs.length} job(s)`);
  let ok = 0;
  for (const j of jobs) { try { if (await importOne(j)) ok++; } catch (e) { console.log(`  ERROR ${j.title}: ${e instanceof Error ? e.message : e}`); } }
  console.log(`done: ${ok}/${jobs.length} imported`);
  process.exit(0);
}
main();
