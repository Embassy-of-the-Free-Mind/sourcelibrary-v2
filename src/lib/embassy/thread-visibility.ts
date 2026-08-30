/**
 * Who can see a Librarian conversation, and under whose name.
 *
 * The history is the design. Conversations were once listed publicly by
 * default *and* attributed to the account holder, and a reader wrote in to ask
 * why her questions were on the site under her full name (feedback
 * 6a6ab4808b1d5089bd554672, 2026-07-30). Everything was flipped to private.
 * That closed the leak and also emptied the Recent feed permanently: of 1,240
 * threads, exactly zero were public, because publishing required flipping a
 * toggle *before* the first message and no one ever did (feedback
 * 6a7ca639e9e3ddd465b53523 — "It shows that there are no conversations").
 *
 * Both states were wrong because they treated one question as two answers to
 * the same switch. They are separate:
 *
 *     listing the conversation   ≠   naming the person who had it
 *
 * So: conversations are listed by default, no name is ever attached for
 * anyone but the creator, and any reader can take their conversation off the
 * list entirely.
 */

export type ThreadVisibility = 'public' | 'private' | 'unlisted';

/** What a reader is called on every surface that is not their own. */
export const ANONYMOUS_ATTRIBUTION = 'A reader';

/** The visibility values that appear in the Recent feed. */
export const LISTED_VISIBILITY: ThreadVisibility = 'public';

/**
 * Visibility for a thread, given who is writing it and whether they want it
 * listed.
 *
 * Opting out means different things for the two kinds of author:
 *   - signed in → `private`: only the creator can ever open it.
 *   - anonymous → `unlisted`: off the feed, but still readable by id, because
 *     that is the only way an anonymous visitor gets back to their own
 *     conversation (`/librarian?thread=<id>`). `private` would lock them out
 *     of it — a null creatorId can never match a session id, so the detail
 *     route would 404 them.
 */
export function threadVisibility(userId: string | null, listed: boolean): ThreadVisibility {
  if (listed) return LISTED_VISIBILITY;
  return userId ? 'private' : 'unlisted';
}

/**
 * The name to serve for a thread creator or a human message author.
 *
 * Anonymisation happens here, on the server, before a name reaches a response
 * body — never in the component that renders it. The original leak was visible
 * in the API payload, so hiding it in JSX would have left it one `curl` away.
 */
export function attribution(
  storedName: string | null | undefined,
  isOwner: boolean,
): string {
  if (!isOwner) return ANONYMOUS_ATTRIBUTION;
  return storedName || 'You';
}

/**
 * Same, for a message — the Librarian's own byline is not a person's name and
 * survives anonymisation.
 */
export function messageAttribution(
  message: { authorType?: string; authorName?: string | null },
  isOwner: boolean,
): string {
  if (message.authorType === 'ai') return message.authorName || 'The Librarian';
  return attribution(message.authorName, isOwner);
}
