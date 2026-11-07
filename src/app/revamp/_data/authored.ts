/*
 * What a curator writes for a collection. On the live site this copy sits in
 * hand-built page files; here it is data, so the same template serves every
 * collection. Text copied verbatim from src/app/collections/{slime-moulds,mycology}.
 */
export interface Authored {
  name?: string; deck?: string; intro?: string[]; label?: string;
  subjects?: { id: string; label: string }[];
  featuredPrefix?: string; featuredTitle?: string; featuredBy?: string; featuredText?: string[];
  plateMatch?: string; wholeBookMatch?: string; platesNote?: string; ask?: string | null; askVideo?: string; introImage?: string;
  quote?: { text: string; original?: string; source: string };
}

export const AUTHORED: Record<string, Authored> = {
  'slime-moulds': {
    deck: 'One cell, big enough to see, that creeps across rotting wood and then stands up as a crop of tiny stalked spore-heads. These are the books that first drew, named and puzzled over it, from a seventeenth-century herbal to the first monograph of 1875.',
    intro: [
      'A slime mould spends most of its life as a single crawling cell, and ends it standing still, dried into something that looks exactly like a very small fungus. Naturalists kept finding the second half and filing it with the mushrooms. The first half is what took two hundred years to see.',
      'Thomas Panckow put one in his herbal in 1654 and called it the fungus that grows quickly, which was the most anyone could honestly say about it. Micheli figured them in 1729, Persoon gave them genus names that are still in use, and Fries gathered them into an order he called the Myxogastres. Every one of those books treats them as fungi.',
      'Anton de Bary broke that in 1859 by watching one develop from the start rather than collecting it at the end. What he found crawling and feeding did not behave like a plant or a fungus, so he moved the whole group out and named it Mycetozoa, the fungus animals. His student Józef Rostafiński then wrote the first monograph of the group, in Polish, in 1875. It reached most of the field second hand, through Arthur Lister’s English rearrangement of 1894, and the pages themselves went largely unread.',
    ],
    featuredPrefix: 'sluzowce-mycetozoa-monografia',
    featuredTitle: 'Śluzowce (Mycetozoa). Monografia',
    featuredBy: 'by Józef Tomasz Rostafiński · 1875 · Polish',
    featuredText: [
      'The first monograph of the slime moulds, written by de Bary’s student and published in Paris by the Kórnik Library in 1875. It set out the classification and the species descriptions that myxomycete taxonomy still rests on.',
      'It was written in Polish, a language almost none of its readership had, and reached the field mainly through Arthur Lister’s English monograph of 1894, which rearranged it. This is the text itself.',
    ],
    plateMatch: 'myxomycet|mycetozo|myxogastr|schleimpilz|slime|plasmodi|lycogala|trichia|stemonitis|arcyria|physarum|cribraria|didymium|aethalium|fuligo|reticularia|tubulina|perichaena|diderma|badhamia|comatricha|lamproderma|leocarpus|craterium|spumaria',
    wholeBookMatch: 'myxomycet|mycetozo|myxogastr|schleimpilz|śluzowce|sluzowce|pilzthiere|slime mou?ld',
    platesNote: 'Plates of the slime moulds themselves, drawn from across the collection.',
    ask: 'Ask a question about slime moulds…',
    askVideo: '/collections/mycology/librarian.mp4',
  },
  mycology: {
    name: 'Fungi & Mycology',
    introImage: '/collections/mycology/intro-plate.webp',
    quote: {
      text: 'There is diverse sort: their water is the rain, their mother the oak-tree, the nurse. … Here comes this clear star, that parts the evil from the good: the life from the death, the poison from the medicine, the darkness from the light.',
      original: "Daer is diverse soort: hun waeder is den reghen; hun moeder, Eycken-boom, de voester. … Hier comt dees clare STER, die scheydt het quaet uyt goet: het leven uyt de doodt, 't vergif uyt medecyn, het duyster uyt het licht.",
      source: 'Sterbeeck, Theatrum Fungorum, 1675',
    },
    deck: 'Fungi built the soil that built our world. These are the books that first studied them.',
    intro: [
      'Fungi feed forests and ferment bread, heal and poison, and break the dead back down into the soil that feeds the living. People gathered and used them for centuries before anyone could say what they even were: not quite plant, not quite animal, but a kingdom of their own.',
      'The books that worked this out run from pocket field guides to vast scientific surveys. Sterbeeck wrote the first work devoted entirely to mushrooms; Bulliard had each species painted from life, in plates still prized for their accuracy; Persoon and Fries built the orderings the whole field still rests on. Much of this writing survives only in Latin, French, and German, reachable until now mainly through citation while the pages themselves sat unread.',
      'Read directly, these works show a science built from close looking. A plate Bulliard coloured by hand can be set beside the mushroom in your hand, a poisoning described in an old treatise matched to the species that caused it, the long work of separating the edible from the deadly followed across two centuries of patient observation.',
    ],
    ask: 'Ask a question about mycology…',
    askVideo: '/collections/mycology/librarian.mp4',
  },
  'jungs-library': { label: 'Historic library' },
  'javanese-kraton': { label: 'Historic library' },
};
