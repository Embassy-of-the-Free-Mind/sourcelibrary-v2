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
    // The route fails CLOSED since #4470 — a missing secret is a guaranteed 401,
    // not a pass. CRON_SECRET is always set server-side; REVALIDATE_SECRET wins
    // if someone configures it.
    const secret = process.env.REVALIDATE_SECRET || process.env.CRON_SECRET;
    if (secret) {
      headers['x-revalidate-secret'] = secret;
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
