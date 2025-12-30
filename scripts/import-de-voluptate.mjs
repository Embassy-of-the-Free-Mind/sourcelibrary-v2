#!/usr/bin/env node
/**
 * Import Ficino's De Voluptate from Gallica
 * Extracts specific page range (folios 322-370) from the 1570 compilation
 */

const GALLICA_ARK = 'bpt6k585129';
const START_FOLIO = 322;
const END_FOLIO = 370; // Approximate end of De Voluptate

const bookData = {
  title: 'De Voluptate (On Pleasure)',
  display_title: 'De Voluptate',
  author: 'Marsilio Ficino',
  language: 'Latin',
  published: '1457',
  categories: ['Philosophy', 'Platonism', 'Renaissance'],
  dublin_core: {
    dc_identifier: [`Gallica:${GALLICA_ARK}:f${START_FOLIO}-f${END_FOLIO}`],
    dc_source: `https://gallica.bnf.fr/ark:/12148/${GALLICA_ARK}`,
    dc_description: 'Ficino\'s treatise on pleasure according to Plato, extracted from the 1570 Jamblichus compilation'
  }
};

async function importBook() {
  const pageCount = END_FOLIO - START_FOLIO + 1;

  console.log('=== Importing De Voluptate ===');
  console.log(`Source: Gallica ${GALLICA_ARK}`);
  console.log(`Folios: ${START_FOLIO}-${END_FOLIO} (${pageCount} pages)`);
  console.log('');

  // Build pages array with Gallica IIIF URLs
  const pages = [];
  for (let f = START_FOLIO; f <= END_FOLIO; f++) {
    const pageNum = f - START_FOLIO + 1;
    pages.push({
      page_number: pageNum,
      folio: f,
      photo: `https://gallica.bnf.fr/iiif/ark:/12148/${GALLICA_ARK}/f${f}/full/1500,/0/default.jpg`,
      thumbnail: `https://gallica.bnf.fr/iiif/ark:/12148/${GALLICA_ARK}/f${f}/full/200,/0/default.jpg`,
    });
  }

  // Call import API
  const importPayload = {
    ...bookData,
    source: 'gallica_extract',
    gallica_ark: GALLICA_ARK,
    start_folio: START_FOLIO,
    end_folio: END_FOLIO,
    pages_data: pages,
  };

  console.log('Calling import API...');

  try {
    const res = await fetch('http://localhost:3000/api/import/iiif', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(importPayload),
    });

    const result = await res.json();

    if (res.ok) {
      console.log('✓ Import successful!');
      console.log(`Book ID: ${result.bookId}`);
      console.log(`Pages created: ${result.pagesCreated}`);
      console.log(`View at: http://localhost:3000/book/${result.bookId}`);
    } else {
      console.error('✗ Import failed:', result.error);

      // Try direct DB approach as fallback
      console.log('\nAttempting direct import via /api/books...');
      await directImport(pages);
    }
  } catch (error) {
    console.error('Network error:', error.message);
    console.log('\nAttempting direct import...');
    await directImport(pages);
  }
}

async function directImport(pages) {
  // Create book first
  const bookRes = await fetch('http://localhost:3000/api/books', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...bookData,
      pages_count: pages.length,
      thumbnail: pages[0].thumbnail,
      image_source: {
        provider: 'gallica',
        provider_name: 'Gallica (Bibliothèque nationale de France)',
        source_url: `https://gallica.bnf.fr/ark:/12148/${GALLICA_ARK}`,
        identifier: GALLICA_ARK,
        license: 'publicdomain',
        access_date: new Date().toISOString(),
        page_range: `f${START_FOLIO}-f${END_FOLIO}`,
      },
    }),
  });

  if (!bookRes.ok) {
    const err = await bookRes.json();
    console.error('Failed to create book:', err);
    return;
  }

  const book = await bookRes.json();
  console.log(`✓ Book created: ${book.id}`);

  // Create pages
  console.log(`Creating ${pages.length} pages...`);
  for (const page of pages) {
    await fetch(`http://localhost:3000/api/books/${book.id}/pages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        page_number: page.page_number,
        photo: page.photo,
        photo_original: page.photo,
        thumbnail: page.thumbnail,
        gallica_folio: page.folio,
      }),
    });
  }

  console.log(`✓ Import complete!`);
  console.log(`View at: http://localhost:3000/book/${book.id}`);
}

importBook().catch(console.error);
