/**
 * Trigger on-demand revalidation for a book page after pipeline processing.
 * Call this after OCR, translation, enrichment, or image extraction completes.
 */
export async function revalidateBook(bookId: string): Promise<boolean> {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL
    || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null)
    || 'https://sourcelibrary.org';

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (process.env.REVALIDATE_SECRET) {
      headers['x-revalidate-secret'] = process.env.REVALIDATE_SECRET;
    }

    const res = await fetch(`${baseUrl}/api/admin/revalidate-book/${bookId}`, {
      method: 'POST',
      headers,
    });

    return res.ok;
  } catch {
    // Non-fatal — stale cache is acceptable
    console.warn(`[revalidate] Failed to revalidate book ${bookId}`);
    return false;
  }
}
