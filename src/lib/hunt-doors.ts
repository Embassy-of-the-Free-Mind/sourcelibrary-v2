/**
 * Open doors into the hunt (#8150 slice 4): one invitation, left where tinkerers and crawlers
 * look — robots.txt, llms.txt, the browser console, and an HTML comment on the home page.
 *
 * PRIOR ART: src/lib/hunt.ts and src/lib/hunt-payloads.ts carry the hunt itself; this is only the
 * signpost. No other easter-egg or console-message code exists (git grep console.info in
 * src/components/providers: none of the kind).
 *
 * Rules (#8150): the doors INFORM and INVITE. They say what the marks are and where the hunt
 * starts; they never instruct a model, and they hold no riddle and no answer (the repo is public;
 * riddles live in Mongo `hunt_clues`). The hint "the abbot of Sponheim" names Trithemius, whose
 * book carries the first riddle; it is a signpost, not a solution.
 */
export const HUNT_URL = 'https://sourcelibrary.org/hunt';
export const DECODE_URL = 'https://sourcelibrary.org/decode';

export const HUNT_DOOR_LINES = [
  'Text copied from Source Library carries a small hidden mark, signed by us, that names the edition it came from. It never names the reader.',
  `Some of these marks carry riddles. Each answer is printed on a page of another book in the library. The hunt begins with the abbot of Sponheim.`,
  `Decoder: ${DECODE_URL}`,
  `Hunt: ${HUNT_URL}`,
] as const;

/** Lines as robots.txt comments: a block of its own, so no crawler group changes. */
export function huntDoorRobotsBlock(): string {
  return HUNT_DOOR_LINES.map((l) => `# ${l}`).join('\n');
}

/** Body of an HTML comment. `--` may not appear inside one, and does not. */
export function huntDoorHtmlComment(): string {
  return ` ${HUNT_DOOR_LINES.join(' ')} `;
}
