import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getDb, getReadDb } from '@/lib/mongodb';
import { verifyInviteToken } from '@/lib/review-invite-token';
import { isValidRating } from '@/lib/review-queue';
import {
  isReaderCheckToken,
  loadReaderCheck,
  loadReaderCheckAnswers,
  toClientItems,
} from '@/lib/reader-check';
import InviteCheck from '@/components/review/InviteCheck';
import ReaderCheck from '@/components/review/ReaderCheck';

/**
 * /check/<token>
 *
 * What a personal link opens. Two kinds of token, told apart by shape:
 *  - a minted reader-check token (32 base64url characters, #7573): twenty pages,
 *    each a scan and two versions of its text, compared blind;
 *  - an emailed one-page invitation (`<item>.<invitee>.<mac>`), with `?v=`
 *    only PRESELECTING a verdict. Neither records anything on a GET: the write
 *    needs a POST from a real click (mail scanners fetch every link in a
 *    message before a human sees it).
 *
 * Deliberately noindex: these URLs are personal capabilities, not content.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Reader check | Source Library',
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

  if (isReaderCheckToken(token)) {
    // Primary, not a secondary: a reader who reloads right after answering must
    // see their answer, not a replica that has not caught up.
    const db = await getDb();
    const doc = await loadReaderCheck(db, token);
    if (!doc) notFound();
    const answers = await loadReaderCheckAnswers(db, doc._id);
    return (
      <ReaderCheck
        token={token}
        // The packet's language, not the reader's stated one: it sets the
        // heading and the text direction of the page being compared.
        language={doc.packet.language}
        items={toClientItems(doc)}
        initialAnswers={answers}
      />
    );
  }

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
