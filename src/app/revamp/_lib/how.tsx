import Link from 'next/link';
import type { ReactNode } from 'react';

/** The "How we …" panels, one per kind of page, so a century, language or type page only explains its own category. */
export type How = { title: string; items: ReactNode[] };

export const HOW_PERIODS: How = { title: 'How we date works', items: [
        'Each work sits in the century it was written, not the century of the copy we hold: a 1502 printing of Herodotus is in 500–401 BCE.',
        'Centuries are plain date spans, the way library catalogues give dates (FAST). Named eras such as Renaissance mean different years in different places, so they are subjects, not dates.',
        'Some dates come from a record (Wikidata, the author’s dates, the book’s own title page); the rest are estimates, marked as such on the work.',
        <span key="made">When the copy itself was made is a separate filter, Date made, on every list. <Link href="/revamp/standards" className="text-primary underline underline-offset-[3px]">Every term against its standard</Link></span>,
] };

export const howLanguages = (values: number | string, unmatched: number | string): How => ({ title: 'How we name languages', items: [
        'A book is listed under the language of this copy, which can differ from the original’s: a Latin text in English translation is under English.',
        `The catalogue stores ${values} different spellings. Codes such as “De” and “Fr” are matched here to their language, following the ISO 639 language codes; the ${unmatched} that are not one language (such as “Und” or “Latin. German”) are left out here; their books are still in the Library.`,
        <span key="std"><Link href="/revamp/standards" className="text-primary underline underline-offset-[3px]">Every term against its standard</Link></span>,
      ] });

export const HOW_TYPES: How = { title: 'How we name types', items: [
        'Picture types are named after the Getty Art & Architecture Thesaurus, the museum standard, which keeps how a picture was made (technique) apart from what it shows.',
        'Text types are named after the Library of Congress genre and form terms, the library standard.',
        'A picture has one type for now, so an engraved portrait is under either Engraving or Portrait, not both. Giving every picture both is the next step.',
        <span key="std"><Link href="/revamp/standards" className="text-primary underline underline-offset-[3px]">Every term against its standard</Link></span>,
      ] };
