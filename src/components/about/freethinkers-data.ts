// The six pages shown in the 'AI has read Reddit' section.
export type Page = { year: string; who: string; what: string; title?: string; lang?: string; src: string; w: number; h: number; href: string; alt: string };

// 2026-11-04: books with no earlier English translation (first_translation_status
// first_no_prior or first_complete in the books collection), so the section's
// claim holds.
export const PAGES: Page[] = [
  { year: 'c. 1500', lang: 'Ottoman Turkish', who: 'Anonymous', title: 'Wonders of Creatures', what: 'A painted manuscript of the stars, the zodiac and divination, from the Islamic tradition.', src: '/about/unread/wonders.jpg', w: 631, h: 1000, href: '/book/acaib-ul-mahlukat-wonders-of-creatures-anonymous?page=30', alt: 'Painted miniature of a figure riding a white bull, the sign of Taurus' },
  { year: '1588', lang: 'Latin', who: 'Giambattista della Porta', title: 'Phytognomonica', what: 'Argues that a plant’s looks reveal its powers: flowers like animal heads, seeds like a child in the womb.', src: '/about/unread/porta.jpg', w: 703, h: 1000, href: '/book/phytognomonica-porta?page=179', alt: 'Woodcut of flowering plants beside the animal heads they resemble' },
  { year: '1617', lang: 'Latin', who: 'Robert Fludd', title: 'The History of the Two Worlds', what: 'An English physician’s map of the universe, in which the cosmos and the human body mirror each other.', src: '/about/unread/fludd.jpg', w: 987, h: 1000, href: '/book/history-of-both-worlds-macrocosm-fludd?page=13', alt: 'Engraving of the cosmos in rings, with a woman standing at its centre' },
  { year: '1646', lang: 'Latin', who: 'Athanasius Kircher', title: 'The Great Art of Light and Shadow', what: 'A Jesuit scholar’s ten books on light, optics, shadows and sundials.', src: '/about/unread/kircher.jpg', w: 792, h: 1000, href: '/book/kircher-ars-magna-lucis-et-umbrae-1646-kircher?page=7', alt: 'Frontispiece with rays of light passing between sun, moon and earth' },
  { year: '1658', lang: 'Sanskrit', who: 'Kamalakara Bhatta', title: 'Discernment of the Principles of Astronomy', what: 'An astronomer in Varanasi questions older Indian methods for calculating the planets and eclipses.', src: '/about/unread/kamalakara.jpg', w: 707, h: 1000, href: '/book/siddhanta-tattva-viveka-bhatta?page=429', alt: "Diagram of the earth's shadow cone in a lunar eclipse, labelled in Sanskrit" },
  { year: '1848', lang: 'Chinese', who: 'Wu Qijun', title: 'Illustrated Investigation of the Names and Realities of Plants', what: 'A Qing official’s survey of plants, each drawn and named, with how it was grown and used.', src: '/about/unread/wu.jpg', w: 633, h: 1000, href: '/book/illustrated-investigation-of-the-names-and-realities-of?page=76', alt: 'Woodcut of water spinach in flower' },
];
