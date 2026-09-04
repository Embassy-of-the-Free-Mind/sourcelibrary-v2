import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getReadDb } from '@/lib/mongodb';
import { verifyInviteToken } from '@/lib/review-invite-token';
import { isValidRating } from '@/lib/review-queue';
import InviteCheck from '@/components/review/InviteCheck';

/**
 * /check/<token>?v=<verdict>
 *
 * What an emailed invitation opens. The verdict in `?v=` is only PRESELECTED,
 * never recorded — the write needs a POST from a real click (mail scanners
 * fetch every link in a message before a human sees it).
 *
 * Deliberately noindex: these URLs are personal capabilities, not content.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Translation check — Source Library',
  robots: { index: false, follow: false },
};

export default async function CheckPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ v?: string }>;
}) {
  const { token } = await params;
  const { v } = await searchParams;

  const payload = verifyInviteToken(token);
  if (!payload) notFound();

  const db = await getReadDb();
  const candidate = (await db
    .collection('review_candidates')
    .findOne(
      { queue: 'translation-check', item_id: payload.itemId },
      { projection: { _id: 0, payload: 1, stratum: 1 } },
    )) as { payload?: { url?: string; prompt?: string }; stratum?: { language?: string } } | null;

  if (!candidate?.payload?.url) notFound();

  const language = candidate.stratum?.language ?? '';
  // The book title is the tail of the prompt the builder wrote; showing it
  // saves the reader a click to find out what they are being asked about.
  const title = /This is “([^”]+)”/.exec(candidate.payload.prompt ?? '')?.[1] ?? '';

  return (
    <InviteCheck
      token={token}
      url={candidate.payload.url}
      language={language}
      bookTitle={title}
      preselect={v && isValidRating('translation-check', v) ? v : null}
    />
  );
}
