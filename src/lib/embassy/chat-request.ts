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
  // Default PRIVATE. A Librarian thread is published in the public "Recent"
  // feed under the reader's real account name, so publishing has to be
  // something they chose, not something they failed to opt out of. The old
  // default was 'public', which put 515 conversations and 10 readers' full
  // names into that feed — a reader wrote in asking why her questions carried
  // her first and last name.
  visibility: z.enum(['public', 'private']).default('private'),
  stream: z.boolean().optional(),
  // Optional collection slug/topic to weight the search toward. Set by the
  // "Ask the Librarian" entry point on a collection page; the Librarian biases
  // results toward this collection while still surfacing strong outside matches.
  collection: z.string().max(120).nullable().optional(),
});

export type ChatRequest = z.infer<typeof chatRequestSchema>;
