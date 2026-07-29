import { ObjectId } from 'mongodb';

/**
 * Convert a session/JWT user id into the form the `users` collection is keyed by.
 *
 * The NextAuth MongoDBAdapter stores `users._id` as an ObjectId but hands the
 * application the string form (`session.user.id`, `token.id`). Querying with the
 * raw string matches nothing and — because Mongo returns null rather than an
 * error — the failure is completely silent. That is exactly how the welcome
 * interstitial and the membership check were both dead in production while
 * looking fine in code review.
 *
 * Every read/write of a `users` document keyed by a session id must go through
 * this helper. Falls back to the string for ids that aren't valid ObjectIds, so
 * it stays correct if a non-adapter user doc is ever introduced.
 */
export function toUserId(id: string): ObjectId | string {
  // Deliberately NOT ObjectId.isValid(): it also returns true for any
  // 12-character string, and the modern driver then throws on the constructor
  // ("input must be a 24 character hex string"). A strict 24-hex test is the
  // only shape the adapter actually produces.
  return /^[0-9a-fA-F]{24}$/.test(id) ? new ObjectId(id) : id;
}
