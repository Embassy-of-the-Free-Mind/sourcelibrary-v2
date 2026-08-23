import { z } from 'zod';

const messageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  // History is context, not content of record — clip rather than reject. The
  // Librarian's own answers regularly exceed 10k chars, and the client sends
  // them back verbatim as history; rejecting here made every follow-up in such
  // a thread fail with a bare "Invalid request" (the thread looked dead to the
  // reader). Allow empty for assistant messages (e.g., choices-only responses).
  content: z.string().transform(s => s.slice(0, 10000)),
});

/**
 * Body schema for POST /api/embassy/chat.
 *
 * Lives here rather than in the route module so the defaults can be exercised
 * by a unit test — importing the route drags in next-auth and the whole
 * Librarian agent graph, which does not load under vitest.
 */
export const chatRequestSchema = z.object({
  threadId: z.string().nullable().optional(),
  message: z.string()
    .min(1, 'Message cannot be empty')
    .max(5000, 'That message is too long for the Librarian — please keep it under 5,000 characters, or share the text a section at a time.'),
  history: z.array(messageSchema).max(50).optional(),
  // The reader's listing choice, not a name-sharing choice — those were the
  // same switch until now and that is what went wrong twice. Publishing under
  // real account names put 515 conversations and 10 readers' full names in the
  // Recent feed, and a reader wrote in asking why her questions carried her
  // first and last name. Defaulting to private then emptied the feed to zero
  // for good. Names are now stripped server-side on every surface but the
  // reader's own (see lib/embassy/thread-visibility), which is what lets the
  // default go back to listed. 'private' here means "don't list it".
  visibility: z.enum(['public', 'private']).default('public'),
  stream: z.boolean().optional(),
  // Optional collection slug/topic to weight the search toward. Set by the
  // "Ask the Librarian" entry point on a collection page; the Librarian biases
  // results toward this collection while still surfacing strong outside matches.
  collection: z.string().max(120).nullable().optional(),
  // The conversation's language (the URL locale of the page that sent it:
  // `/es/librarian` → 'es'). Selects the edition the tools quote from and the
  // `/es` prefix on every link. The model would answer in Spanish anyway;
  // this is what makes it quote OUR Spanish edition instead of improvising one.
  lang: z.enum(['en', 'es']).default('en'),
});

export type ChatRequest = z.infer<typeof chatRequestSchema>;
