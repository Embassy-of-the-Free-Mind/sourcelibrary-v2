/**
 * What each collection's maker has switched on, for the prototype. In the real thing these are
 * settings on the collection. Notes and ranks are the collections' own (highlighted_books);
 * section headings do not exist yet anywhere, so the one demo of them is marked as placeholder.
 */
export interface MakerOptions { notes: boolean; numbered: boolean; sections: boolean; startHere: boolean }

export const MAKER_DEMO: Record<string, Partial<MakerOptions>> = {
  'beguine-mystics': { notes: true, numbered: true },
  'alchemical-emblem': { notes: true, sections: true },
  alchemy: { notes: true, startHere: true },
};

/** The three collections the base template is shown on: small, medium, large. */
export const BASE_EXAMPLES = ['beguine-mystics', 'alchemical-emblem', 'alchemy'];

/** These keep their own hand-made pages. */
export const HAND_MADE = ['mycology', 'slime-moulds'];
