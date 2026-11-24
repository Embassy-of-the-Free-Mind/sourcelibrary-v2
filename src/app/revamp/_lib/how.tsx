import Link from 'next/link';
import type { ReactNode } from 'react';

/** The "How we …" panels, one per kind of page, so a century, language or type page only explains its own category. */
export type How = { title: string; items: ReactNode[] };

export const HOW_PERIODS: How = { title: 'How we date texts', items: [
        'Each text sits in the century it was written, not the century of the copy we hold: a 1502 printing of Herodotus is in 500–401 BCE.',
        'Centuries are plain date spans, the way library catalogues give dates (FAST). Named eras such as Renaissance mean different years in different places, so they are subjects, not dates.',
        'Some dates come from a record (Wikidata, the author’s dates, the book’s own title page); the rest are estimates, marked as such on the text.',
        <span key="made">When the copy itself was made is a separate filter, Date made, on every list. <Link href="/revamp/standards" className="text-primary underline underline-offset-[3px]">Every term against its standard</Link></span>,
] };

export const howLanguages = (values: number | string, unmatched: number | string): How => ({ title: 'How we name languages', items: [
        'A book is listed under the language of this copy, which can differ from the original’s: a Latin text in English translation is under English.',
        `The catalogue stores ${values} different spellings. Codes such as “De” and “Fr” are matched here to their language, following the ISO 639 language codes; the ${unmatched} that are not one language (such as “Und” or “Latin. German”) are left out here; their books are still in the Library.`,
        <span key="std"><Link href="/revamp/standards" className="text-primary underline underline-offset-[3px]">Every term against its standard</Link></span>,
      ] });

export const HOW_PICTURE_TYPES: How = { title: 'How we name types of pictures', items: [
        'Three questions, kept apart: what a picture shows, how it was made, and where it sits in the book. The names follow the Getty Art & Architecture Thesaurus, the museum standard.',
        'A picture has one type for now, so an engraved portrait is under either Engraving or Portrait, not both. Giving every picture an answer to each question is the next step.',
        <span key="std"><Link href="/revamp/standards" className="text-primary underline underline-offset-[3px]">Every term against its standard</Link></span>,
      ] };

export const HOW_TEXT_TYPES: How = { title: 'How we name types of texts', items: [
        'Two questions, kept apart: what a text is written on (a printed book, a scroll, a clay tablet) and what kind of writing it is (a treatise, a commentary, letters).',
        'What it is written on follows the Getty object types; the kinds of writing follow the Library of Congress genre and form terms.',
        'What a text is written on is not recorded in the catalogue yet. It is part of the coming catalogue round.',
        <span key="std"><Link href="/revamp/standards" className="text-primary underline underline-offset-[3px]">Every term against its standard</Link></span>,
      ] };
