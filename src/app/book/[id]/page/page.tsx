import { permanentRedirect } from 'next/navigation';

/**
 * Bare /book/<id>/page — a page link with the page number missing. These
 * arrive steadily from AI-chat citations and hand-truncated URLs (~230
 * 404s/week in not_found_reports, real browser UAs). Send the reader to the
 * book overview instead of a dead end; the reader can pick a page from there.
 */
export default async function BarePageRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  permanentRedirect(`/book/${encodeURIComponent(id)}`);
}
