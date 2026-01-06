// Test script to measure crop job speed
const BASE_URL = 'http://localhost:3000';

async function testCropSpeed() {
  // First, find a book with pages that need cropping or have been cropped
  const booksRes = await fetch(`${BASE_URL}/api/books`);
  const books = await booksRes.json();

  if (!books.length) {
    console.log('No books found');
    return;
  }

  // Find a book with split pages
  for (const book of books.slice(0, 5)) {
    console.log(`\nChecking book: ${book.title} (${book.id})`);

    const pagesRes = await fetch(`${BASE_URL}/api/books/${book.id}/pages`);
    const pages = await pagesRes.json();

    const pagesWithCrop = pages.filter(p => p.crop && p.crop.xStart !== undefined);
    const pagesNeedingCrop = pages.filter(p => p.crop && !p.cropped_photo);

    console.log(`  Total pages: ${pages.length}`);
    console.log(`  Pages with crop data: ${pagesWithCrop.length}`);
    console.log(`  Pages needing cropped images: ${pagesNeedingCrop.length}`);

    if (pagesNeedingCrop.length > 0) {
      console.log(`\n  Found ${pagesNeedingCrop.length} pages needing crops!`);
      return { book, pagesNeedingCrop };
    }
  }

  console.log('\nNo pages needing crops found. Testing with already-cropped pages...');

  // Find a book with cropped pages to benchmark
  for (const book of books) {
    const pagesRes = await fetch(`${BASE_URL}/api/books/${book.id}/pages`);
    const pages = await pagesRes.json();
    const pagesWithCroppedPhoto = pages.filter(p => p.cropped_photo);

    if (pagesWithCroppedPhoto.length >= 10) {
      console.log(`\nBook "${book.title}" has ${pagesWithCroppedPhoto.length} already-cropped pages`);
      return { book, pagesWithCroppedPhoto };
    }
  }

  return null;
}

async function benchmarkCropJob(bookId, pageIds, count = 20) {
  console.log(`\n=== Benchmarking crop job with ${count} pages ===`);

  // Create a test job
  const createJobRes = await fetch(`${BASE_URL}/api/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'generate_cropped_images',
      book_id: bookId,
      page_ids: pageIds.slice(0, count),
    }),
  });

  const job = await createJobRes.json();
  console.log(`Created job: ${job.id}`);

  // Process and time it
  const start = Date.now();

  const processRes = await fetch(`${BASE_URL}/api/jobs/${job.id}/process`, {
    method: 'POST',
  });

  const result = await processRes.json();
  const duration = Date.now() - start;

  console.log(`Processed ${result.processed} pages in ${duration}ms`);
  console.log(`Average: ${(duration / result.processed).toFixed(0)}ms per page`);
  console.log(`Remaining: ${result.remaining}`);

  return { duration, processed: result.processed, avgPerPage: duration / result.processed };
}

async function main() {
  console.log('Testing crop speed...\n');

  try {
    const result = await testCropSpeed();
    if (result && result.pagesNeedingCrop) {
      const pageIds = result.pagesNeedingCrop.map(p => p.id);
      await benchmarkCropJob(result.book.id, pageIds, Math.min(20, pageIds.length));
    } else {
      console.log('\nNo test data available');
    }
  } catch (e) {
    console.error('Error:', e.message);
  }
}

main();
