/**
 * IndexNow - Instant URL indexing for search engines
 * https://www.indexnow.org/
 *
 * Notifies Bing, Yandex, and other search engines when content changes.
 */

const INDEXNOW_KEY = '091651ad52d44f5d9b1c6bcf465196dc';
const INDEXNOW_HOST = 'sourcelibrary.org';
const INDEXNOW_KEY_LOCATION = `https://${INDEXNOW_HOST}/${INDEXNOW_KEY}.txt`;

// Use Bing's endpoint (also notifies other participating search engines)
const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/IndexNow';

/**
 * Notify search engines about updated URLs via IndexNow
 *
 * @param urls - Array of full URLs that have been updated
 * @returns Promise with success status
 */
export async function notifyIndexNow(urls: string[]): Promise<{ success: boolean; error?: string }> {
  if (!urls.length) {
    return { success: true };
  }

  // Filter to only include sourcelibrary.org URLs
  const validUrls = urls.filter(url => url.includes(INDEXNOW_HOST));

  if (!validUrls.length) {
    return { success: true };
  }

  try {
    const response = await fetch(INDEXNOW_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({
        host: INDEXNOW_HOST,
        key: INDEXNOW_KEY,
        keyLocation: INDEXNOW_KEY_LOCATION,
        urlList: validUrls.slice(0, 10000), // Max 10,000 URLs per request
      }),
    });

    if (response.ok || response.status === 200 || response.status === 202) {
      console.log(`[IndexNow] Notified ${validUrls.length} URLs`);
      return { success: true };
    }

    const errorText = await response.text().catch(() => 'Unknown error');
    console.error(`[IndexNow] Failed: ${response.status} - ${errorText}`);
    return { success: false, error: `${response.status}: ${errorText}` };
  } catch (error) {
    console.error('[IndexNow] Error:', error);
    return { success: false, error: String(error) };
  }
}

/**
 * Notify about a single page translation
 */
export async function notifyPageTranslation(bookId: string, pageNumber: number, slug?: string): Promise<void> {
  const bookPath = slug || bookId;
  const url = `https://${INDEXNOW_HOST}/book/${bookPath}/page-number/${pageNumber}`;
  await notifyIndexNow([url]);
}

/**
 * Notify about multiple page translations (batch)
 */
export async function notifyBatchTranslation(bookId: string, pageNumbers: number[], slug?: string): Promise<void> {
  const bookPath = slug || bookId;
  const urls = pageNumbers.map(p => `https://${INDEXNOW_HOST}/book/${bookPath}/page-number/${p}`);
  // Also include the book page and read page
  urls.push(`https://${INDEXNOW_HOST}/book/${bookPath}`);
  urls.push(`https://${INDEXNOW_HOST}/book/${bookPath}/read`);
  urls.push(`https://${INDEXNOW_HOST}/book/${bookPath}/guide`);
  await notifyIndexNow(urls);
}

/**
 * Notify about a new book import
 */
export async function notifyBookImport(bookId: string, slug?: string): Promise<void> {
  const bookPath = slug || bookId;
  await notifyIndexNow([
    `https://${INDEXNOW_HOST}/book/${bookPath}`,
  ]);
}

/**
 * Notify about edition publication (DOI minted)
 */
export async function notifyEditionPublished(bookId: string, slug?: string): Promise<void> {
  const bookPath = slug || bookId;
  await notifyIndexNow([
    `https://${INDEXNOW_HOST}/book/${bookPath}`,
    `https://${INDEXNOW_HOST}/book/${bookPath}/read`,
    `https://${INDEXNOW_HOST}/book/${bookPath}/guide`,
  ]);
}
