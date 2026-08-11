import { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';

export const metadata: Metadata = {
  title: 'Research Notes - Source Library',
  description: 'Research notes on the history and translation of rare philosophical, esoteric, and scientific texts. AI-assisted analysis directed by Derek Lomas.',
  alternates: {
    canonical: '/blog',
  },
};

export interface BlogPost {
  slug: string;
  title: string;
  subtitle: string;
  date: string;
  readTime: string;
  tag?: string;
  tagColor?: string;
  image?: string;
  imageAlt?: string;
}

// Exported so the RSS feed (/api/feed/blog) reads the same list — single source of truth.
export const posts: BlogPost[] = [
  {
    slug: 'suda-benchmark',
    title: 'Graded by the Suda',
    subtitle:
      'One book in our library came with its own answer key: the Suda On Line, 31,000 entries translated by two hundred volunteer scholars over sixteen years. We aligned our AI translation with theirs, let each grade the other with the Greek as arbiter, and learned that a model cannot grade its own family’s homework. Total API cost: $1.15.',
    date: '11 August 2026',
    readTime: '9 min read',
    tag: 'Research',
    tagColor: 'bg-blue-50 text-blue-700',
    image: 'https://images.sourcelibrary.org/pages/69a99ce86c7545e2236e12de/0300.jpg',
    imageAlt:
      'A two-column page of Bekker’s 1854 edition of the Suda, dense Greek type listing the seven men named Didymus.',
  },
  {
    slug: 'the-library-card',
    title: 'The Library Card',
    subtitle:
      'We used to badge books as "first translations" — a claim about the absence of any prior, which no search can prove. We replaced the badge with one cited list of known English translations per work, spot-checked by adversarial verifiers who caught five fabrications and failed fourteen times to break an absence claim. It is live on every book page.',
    date: '11 August 2026',
    readTime: '7 min read',
    tag: 'Essay',
    tagColor: 'bg-amber-50 text-amber-700',
    image: 'https://images.sourcelibrary.org/archived/6958ea099659a6529d577d58/1.jpg',
    imageAlt:
      'A page of the 1546 Latin De Materia Medica of Dioscorides — a work whose English translation history is now written on its card.',
  },
  {
    slug: 'nobody-knows-what-has-been-scanned',
    title: 'Nobody Knows What Has Been Scanned',
    subtitle:
      'No institution on earth can answer whether a book has already been digitized. We had to harvest 3.5 million records to answer it for one library — and found 3,655 books nobody has scanned. The case for a global registry.',
    date: '9 August 2026',
    readTime: '6 min read',
    tag: 'Essay',
    tagColor: 'bg-amber-50 text-amber-700',
    image: 'https://images.sourcelibrary.org/archived/69b51d1f47b06ecd58183e84/2.jpg',
    imageAlt:
      "Engraved title page of Zwinger's Theatrum Humanae Vitae, 1604 — the largest encyclopedia of its age.",
  },
  {
    slug: 'reciting-not-reading',
    title: 'Reciting, Not Reading',
    subtitle:
      'We covered four lines of Genesis with an opaque grey box. Our OCR transcribed them anyway — correctly, seamlessly, and without a word of warning. Then four different prompts failed to stop it, and the one thing that worked was not something we said.',
    date: '30 July 2026',
    readTime: '8 min read',
    tag: 'Research',
    tagColor: 'bg-blue-50 text-blue-700',
    image: 'https://sourcelibrary.org/blog/reciting-not-reading/mask-rect-zoom.jpg',
    imageAlt:
      'A 1566 Vulgate page with a grey rectangle covering four lines of Genesis 1:2, fragments of the covered lines still visible at the right edge.',
  },
  {
    slug: 'nine-models-forty-pages',
    title: 'Nine Models, Forty Pages',
    subtitle:
      "We benchmarked every OCR-capable model we could reach — Google's newest releases, three open-weight challengers, one self-hosted on a rented GPU — against the same forty historical pages, with a memorization control and paired statistics. The newest budget model lost to its own predecessor, and an open-weight model reached parity on the pages it can read.",
    date: '23 July 2026',
    readTime: '9 min read',
    tag: 'Research',
    tagColor: 'bg-blue-50 text-blue-700',
    image: 'https://images.sourcelibrary.org/archived/69a5e9bb787d6e9b8d42e183/120.jpg',
    imageAlt:
      "Page 109 of Eznik of Kołb's Ełc ałandoc' in the 1826 Venice printing — the Armenian page most models could not read.",
  },
  {
    slug: 'playable-page',
    title: 'The Playable Page',
    subtitle:
      'Old treatises are full of instruments diagrammed and silenced — monochord divisions, tetrachord arcs, string tables worked out to the integer. Three of them, replicated and strung: Galilei\'s two-string bench with its weight pan, the Lyre of Mercury\'s disputed numbers read as three different laws, and the full two-octave system of ancient music from a Boethius manuscript, playable in all three genera.',
    date: '19 July 2026',
    readTime: '3 instruments',
    tag: 'Interactive',
    tagColor: 'bg-stone-100 text-stone-600',
    image: 'https://images.sourcelibrary.org/archived/6955739df63a7571091720cf/80.jpg',
    imageAlt:
      'A page of the Boethius manuscript: nested red arcs mapping the chromatic and enharmonic tetrachords, with string names and monochord numbers.',
  },
  {
    slug: 'ngram-viewer',
    title: 'Chart a Word, Then Read the Page',
    subtitle:
      'A Google-Books-style ngram viewer over five centuries of alchemy, Hermetica, and early science — with the two things word-frequency charts have never done: one curve that follows a concept across Latin, German, and French sources at once, and a click-through from any peak to the actual readable pages. Plus an honest guide to what these curves can and cannot prove.',
    date: '19 July 2026',
    readTime: '7 min read',
    tag: 'Interactive',
    tagColor: 'bg-stone-100 text-stone-600',
    image: 'https://images.sourcelibrary.org/artwork/art-khunrath-the-four-the-three-the-two-and-the-one.jpg',
    imageAlt: "Concentric rings of Latin, Greek, and Hebrew words — Heinrich Khunrath's 'The Four, the Three, the Two, and the One,' 1595.",
  },
  {
    slug: 'sound-laboratory',
    title: 'The Sound Laboratory',
    subtitle:
      'Ten interactive stations that put twenty-five centuries of claims about harmony to the test with your own ears — the smith\'s hammers weighed, the comma that won\'t close, Bharata\'s two vīṇās, Kepler\'s planets auditioned against modern orbits, Kircher\'s sympathetic strings, and Euler\'s formula for sweetness, graded by you. Headphones recommended.',
    date: '16 July 2026',
    readTime: '10 experiments',
    tag: 'Interactive',
    tagColor: 'bg-stone-100 text-stone-600',
    image: 'https://images.sourcelibrary.org/artwork/art-sadeler-fabel-van-de-smid-en-de-hond.jpg',
    imageAlt: "A smith at his anvil, hammer raised — Aegidius Sadeler's engraving, 1608.",
  },
  {
    slug: 'nature-of-harmony',
    title: 'The Nature of Harmony',
    subtitle:
      'For twenty-five centuries and across five civilizations, people said the world is built like music — and split at once into those who heard a deep order and those who demanded to measure it. A history of that quarrel, from a plucked string in antiquity to the whole-number ratios inside the atom, told through the books one library holds.',
    date: '15 July 2026',
    readTime: '18 min read',
    tag: 'History of Ideas',
    tagColor: 'bg-stone-100 text-stone-600',
    image: 'https://images.sourcelibrary.org/artwork/art-anima-mundi-the-world-soul.jpg',
    imageAlt:
      "Fludd's 1617 engraving Integrae Naturae Speculum, Artisque Imago — Nature chained to the divine name above and to the ape of Art below.",
  },
  {
    slug: 'show-me-the-number',
    title: 'Show Me the Number',
    subtitle:
      'We keep saying AI should be in "harmony" with us — aligned, attuned, in tune. Is that a claim you can measure, or a picture we find comforting? Kepler forged the test four hundred years ago. A sequel on synchrony, the Platonic Representation Hypothesis, and where a real law of human–AI harmony could live.',
    date: '15 July 2026',
    readTime: '12 min read',
    tag: 'Essay',
    tagColor: 'bg-stone-100 text-stone-600',
    image: 'https://images.sourcelibrary.org/artwork/art-anima-mundi-the-world-soul.jpg',
    imageAlt:
      "Fludd's ape of Art at the centre of the cosmos, holding a gridded model of the world — the artificial imitator, four centuries early.",
  },
  {
    slug: 'fish-voiced-priest',
    title: 'The Fish-Voiced Priest',
    subtitle:
      'An AI read a thousand-year-old Greek hand in the Codex Marcianus and invented a character who is not on the page — it turned "I am Ion, the priest of the inner sanctuaries" into "the fish-voiced one," then footnoted its own mistake. Why, for a hard script, the printed critical edition has to carry the text while the manuscript carries the facsimile.',
    date: '2 July 2026',
    readTime: '11 min read',
    tag: 'Technical',
    tagColor: 'bg-stone-100 text-stone-600',
    image: 'https://images.sourcelibrary.org/manuscripts/marciana-gr-299/208.jpg',
    imageAlt: 'Folio 93 recto of the Codex Marcianus gr. Z. 299, in tenth-century Greek minuscule',
  },
  {
    slug: 'reading-classical-chinese',
    title: 'Can AI Read Classical Chinese?',
    subtitle:
      'We hold ~1,600 Chinese works, most never translated into English. Measured against ctext.org, our OCR reads canonical printed text at ~98.5% character accuracy; measured against James Legge, our translations match or beat the standard scholarly editions on clean text. The honest catch is complex layouts and the works with no reference to check against.',
    date: '25 June 2026',
    readTime: '13 min read',
    tag: 'Research',
    tagColor: 'bg-blue-50 text-blue-700',
    image: 'https://images.sourcelibrary.org/archived/6992c88d4f3a879124230200/346.jpg',
    imageAlt: 'Woodcut of laborers forging a large iron anchor, from the Tiangong Kaiwu (1637)',
  },
  {
    slug: 'naked-philosophers',
    title: 'The Naked Philosophers',
    subtitle:
      'In 327 BCE Alexander\'s fleet-captain was sent to sit before fifteen naked, motionless sages who would not come when the king summoned them. Nineteen centuries later a Rosicrucian alchemist enrolled those same "gymnosophists" as ancestors of his Brotherhood. How a single image — eyewitness ethnography, moral exemplar, Hermetic ancestor — travelled three thousand miles and nineteen centuries, told through eight books in the library.',
    date: '21 June 2026',
    readTime: '8 min read',
    tag: 'Research',
    tagColor: 'bg-blue-50 text-blue-700',
    image: 'https://images.sourcelibrary.org/gallery/69c1bd308522835be8468096/69c1bd308522835be8468180-0.jpg',
    imageAlt: 'Alexander the Great gesturing toward three naked philosophers among flowering plants, a 1544 Armenian Romance of Alexander miniature',
  },
  {
    slug: 'the-giants-werent-translated',
    title: 'The Giants Were Never Fully Translated',
    subtitle:
      'The most-read book on Source Library, Robert Fludd\'s Utriusque Cosmi Historia, has never been translated into English in full. Neither have the major works of Kircher; Ficino reached English only this century. On why "first full translation" is still a meaningful claim, and what the gap really looks like.',
    date: '21 June 2026',
    readTime: '6 min read',
    tag: 'Research',
    tagColor: 'bg-blue-50 text-blue-700',
    image: 'https://images.sourcelibrary.org/archived/6952dac677f38f6761bc683a/13.jpg',
    imageAlt: 'Robert Fludd\'s Integra Naturae, from Utriusque Cosmi Historia, 1617',
  },
  {
    slug: 'counting-first-translations',
    title: 'How Many First Translations, Really?',
    subtitle:
      'We badge ~5,700 books as first-ever English translations. Are they? We sent an AI research agent to independently fact-check a random sample of both the badged books and the never-assessed ones — and found the bigger error was the firsts we missed, not the ones we over-claimed. On precision, recall, Wilson intervals, and why fame (not language) predicts a false claim.',
    date: '19 June 2026',
    readTime: '11 min read',
    tag: 'Research',
    tagColor: 'bg-blue-50 text-blue-700',
    image: 'https://images.sourcelibrary.org/archived/69af0a0a4c57359b8d2d0f49/1.jpg',
    imageAlt: "Title page of Athanasius Kircher's Arithmologia, 1665 — a genuine first English translation",
  },
  {
    slug: 'cannabis-bangue',
    title: 'Theire Soe Admirable Herbe: How the West Forgot, and Remembered, Cannabis',
    subtitle:
      'In 1689 a sea-captain set a sample of "bangue" on Robert Hooke\'s coffeehouse table, and the Royal Society met cannabis. But the plant had two lives, and the West had been forgetting one of them for two thousand years. A tour through sixty books in twelve languages — from the Shennong Bencao Jing to Baudelaire.',
    date: '19 June 2026',
    readTime: '9 min read',
    tag: 'Research',
    tagColor: 'bg-blue-50 text-blue-700',
    image: 'https://images.sourcelibrary.org/archived/69ef286185daccce30f2ca01/390.jpg',
    imageAlt: "Botanical woodcut of the cannabis plant labelled 'Bangue' in Cristóvão da Costa's Tractado, 1578",
  },
  {
    slug: 'translation-collapse',
    title: 'Quality Control on Four Million Machine-Translated Pages',
    subtitle:
      'A reader found a 1589 page that the AI returned as a single word instead of a translation. Pulling the thread surfaced 25,000 more — and the two times our own measurement was wrong before the model was. On detecting "translation collapse," why long pages and looping OCR drive it, and what it takes to check a generative system at scale.',
    date: '17 June 2026',
    readTime: '7 min read',
    tag: 'Research',
    tagColor: 'bg-blue-50 text-blue-700',
    image: 'https://images.sourcelibrary.org/archived/69b2f434f9f1ad2b3b15154a/9.jpg',
    imageAlt: "A page from Henri Estienne's 1589 edition of the fragments of Dicaearchus",
  },
  {
    slug: 'iiif',
    title: 'How IIIF Helped Us Translate the Renaissance',
    subtitle:
      'One image standard turned thirteen institutional archives into a single input layer for an AI pipeline — and let us hand the results back to the whole IIIF world. With diagrams of the import pipeline, the real challenges (rate limits, the datacenter problem), the workflow when there is no manifest, why provenance matters, and appreciations. Notes for a lightning talk at IIIF 2026 in Leiden.',
    date: '2 June 2026',
    readTime: '14 min read',
    tag: 'Technical',
    tagColor: 'bg-stone-100 text-stone-600',
    image: 'https://images.sourcelibrary.org/pages/69bd9e336120d54bd037bf37/0010.jpg',
    imageAlt: "Engraved frontispiece of Michael Maier's Atalanta Fugiens (Oppenheim, 1617), digitized by e-rara and re-hosted on Source Library",
  },
  {
    slug: 'how-big-is-the-library',
    title: 'How Big Is the Library?',
    subtitle:
      'We counted every word — original OCR, AI translation, and enrichment. Roughly five to seven billion words, about the size of English Wikipedia. With the methodology, and the recitation-loop bug that nearly tripled the count.',
    date: '1 June 2026',
    readTime: '6 min read',
    tag: 'Research',
    tagColor: 'bg-blue-50 text-blue-700',
    image: 'https://images.sourcelibrary.org/gallery/a5d0c381-d4ea-42cd-8864-44457e7fda33/69500509f426a210d109c5bd-0.jpg',
    imageAlt: "Frontispiece of Athanasius Kircher's Ars Magna Lucis et Umbrae (1671)",
  },
  {
    slug: 'how-long-to-translate',
    title: 'How Long Would It Take to Translate the Renaissance?',
    subtitle: 'We measured the rate of new Latin translations and counted what is left. At the current pace, the Latin Renaissance alone would take about ten thousand years to finish.',
    date: '31 May 2026',
    readTime: '8 min read',
    tag: 'Research',
    tagColor: 'bg-blue-50 text-blue-700',
  },
  {
    slug: 'man-his-own-maker',
    title: 'Man, His Own Maker',
    subtitle:
      "Leo XIV's encyclical on AI is, strangely, the grandchild of the first printed book the Church ever banned — Pico's Oration on the Dignity of Man. Reading them across five centuries shows what AI really forces us to decide about the soul.",
    date: '30 May 2026',
    readTime: '15 min read',
    tag: 'Deep dive',
    tagColor: 'bg-accent-rust/10 text-accent-rust',
    image: 'https://images.sourcelibrary.org/archived/adad5f6d-4f68-4009-9406-d0e083cf0acc/3.jpg',
    imageAlt: 'Title page of an early printed edition of Pico della Mirandola\'s collected works, listing the Heptaplus, the Apologia, De Ente et Uno, and the Oration',
  },
  {
    slug: 'does-ai-get-religion',
    title: 'Does the AI Get Religion?',
    subtitle: 'The longest page in our library is one leaf of a Javanese Bible that the AI translated into 491,418 characters of "generations of generations of generations." It only happens with scripture.',
    date: '30 May 2026',
    readTime: '3 min read',
    tag: 'Field notes',
    tagColor: 'bg-amber-50 text-amber-800',
  },
  {
    slug: 'did-an-ai-write-the-encyclical',
    title: "Did an AI Write the Pope's AI Encyclical?",
    subtitle:
      'Magnifica Humanitas was flagged 46% AI-written, with 127 em-dashes vs zero in a comparison encyclical. We re-ran the test against eight human encyclicals — Benedict XVI used dashes 2.5× more. The smoking gun is a baseline-selection artifact.',
    date: '30 May 2026',
    readTime: '11 min read',
    tag: 'Research',
    tagColor: 'bg-blue-50 text-blue-700',
    image: 'https://images.sourcelibrary.org/archived/6990505e7d19f3f2aac1e2b7/5.jpg',
    imageAlt: "Frontispiece of Athanasius Kircher's Turris Babel (1679)",
  },
  {
    slug: 'carbon-ledger',
    title: 'The Carbon Ledger of a Digital Library',
    subtitle: "Source Library has OCR'd 4.1M pages and translated almost all of them using AI. We logged every API call. ~1.8 tonnes CO₂e — about seven round-trip flights AMS↔London. Six independent estimation methods, full data + sources.",
    date: '26 May 2026',
    readTime: '10 min read',
    tag: 'Research',
    tagColor: 'bg-amber-50 text-amber-800',
    image: 'https://images.sourcelibrary.org/gallery/a5d0c381-d4ea-42cd-8864-44457e7fda33/69500509f426a210d109c5bd-0.jpg',
    imageAlt: "Frontispiece of Athanasius Kircher's Ars Magna Lucis et Umbrae (1671)",
  },
  {
    slug: 'did-the-ai-read-this',
    title: 'Did the AI Read This?',
    subtitle: 'A Bayesian survey of which books in our 16,871-volume OCR\'d corpus are already in frontier-model training data. About 43% are confidently new to AI; about 21% are confidently in training.',
    date: '18 May 2026',
    readTime: '8 min read',
    tag: 'Research',
    tagColor: 'bg-blue-50 text-blue-700',
    image: 'https://images.sourcelibrary.org/archived/9cafe1ee-dd5a-4dcf-ac9a-803ca75f5bb4/12.jpg',
    imageAlt: 'Title page of Cornelius Drebbel\'s Tractatus duo de Natura Elementorum (Hamburg, 1621)',
  },
  {
    slug: 'hogwarts-library',
    title: 'The Real Hogwarts Library',
    subtitle: 'Nicolas Flamel was real. So was Cornelius Agrippa. So was Paracelsus. The books behind the wizarding world — alchemy, bestiaries, grimoires, Kabbalah — read in modern English.',
    date: '17 May 2026',
    readTime: '16 min read',
    tag: 'Deep dive',
    tagColor: 'bg-accent-rust/10 text-accent-rust',
    image: 'https://images.sourcelibrary.org/archived/699065973dc2ed39a49f1e71/2.jpg',
    imageAlt: 'Detail from the Ripley Scroll, 15th-century illustrated alchemical manuscript, Bodleian Library MS Bodl. Rolls 1',
  },
  {
    slug: 'what-makes-a-good-scan',
    title: 'What Makes a Good Scan?',
    subtitle: 'Pixel statistics, AI judgment, and the moment a model rated a blank page 95/100. Designing a per-illustration quality system for 100,000 rare-book images.',
    date: '17 May 2026',
    readTime: '9 min read',
    tag: 'Research',
    tagColor: 'bg-blue-50 text-blue-700',
  },
  {
    slug: 'the-deletion',
    title: 'The Deletion',
    subtitle: 'How a Claude Code session in one of my ten open terminals hard-deleted 4,758 books from our rare-books library — with the actual prompts, the actual postmortem, and what it means for running AI agents against production data.',
    date: '15 May 2026',
    readTime: '13 min read',
    tag: 'Postmortem',
    tagColor: 'bg-accent-rust/10 text-accent-rust',
  },
  {
    slug: 'confident-hallucinator',
    title: 'The Confident Hallucinator',
    subtitle: 'What we learned evaluating AI OCR across five scripts. A model can be perfectly consistent and completely wrong — 100% consistency, 0% accuracy.',
    date: '23 April 2026',
    readTime: '10 min read',
    tag: 'Research',
    tagColor: 'bg-blue-50 text-blue-700',
  },
  {
    slug: 'tibetan-ocr',
    title: 'Benchmarking AI OCR on 232,000 Pages of Bhutanese Manuscripts',
    subtitle: 'Claude, Gemini, and the question of what "good enough" means for handwritten Tibetan. We test three models on monastery manuscripts from Gangtey, Drametse, and Tshamdrak.',
    date: '23 April 2026',
    readTime: '12 min read',
    tag: 'Research',
    tagColor: 'bg-emerald-50 text-emerald-700',
    image: 'https://images.eap.bl.uk/EAP039/EAP039_1_4_277/10.jp2/full/600,/0/default.jpg',
    imageAlt: 'Ritual mandala from Gangtey Monastery, Bhutan',
  },
  {
    slug: 'incunabula-knowledge-graph',
    title: 'Mapping the Incunabula',
    subtitle: 'An interactive knowledge graph connecting nearly 1,000 pre-1501 printed books by author, printer, place, and subject — revealing the networks behind the printing revolution.',
    date: '22 April 2026',
    readTime: '8 min read',
    tag: 'Interactive',
    tagColor: 'bg-amber-50 text-amber-700',
  },
  {
    slug: 'cellulae',
    title: 'Cellulae',
    subtitle: 'A word on page 32 of a medieval manuscript launched modern biology. The argument on page 33 helped criminalize rape victims for eight centuries. They were written by the same man.',
    date: '16 April 2026',
    readTime: '12 min read',
    tag: 'Deep dive',
    tagColor: 'bg-accent-rust/10 text-accent-rust',
  },
  {
    slug: 'singularity-1486',
    title: 'The Singularity Was Published in 1486',
    subtitle: 'Transhumanism, panpsychism, and the planetary mind — in the original Latin and German. The source code for ideas we think are modern.',
    date: '15 April 2026',
    readTime: '12 min read',
    tag: 'Deep dive',
    tagColor: 'bg-accent-rust/10 text-accent-rust',
    image: 'https://images.sourcelibrary.org/archived/6fc11c7d-782a-47c3-a855-f3b4415e797b/10.jpg',
    imageAlt: 'Page from Kepler\'s Harmonices Mundi showing geometric diagrams of planetary harmony, 1619',
  },
  {
    slug: '10000-books',
    title: '10,000 Books',
    subtitle: 'Source Library passes 10,000 translated historical texts. The symbolic 10,000th: a 1517 Renaissance encyclopedia from the BPH, in English for the first time.',
    date: '13 April 2026',
    readTime: '5 min read',
    tag: 'Milestone',
    tagColor: 'bg-accent-gold/10 text-accent-gold-dark',
    image: 'https://images.sourcelibrary.org/archived/6909aba7cf28baa1b4caef69/5.jpg',
    imageAlt: 'Woodcut dedication page from Champier\'s Four Volumes of Divine and Human Marvels, 1517',
  },
  {
    slug: 'word-alignment',
    title: 'Reading Through the Translation',
    subtitle: 'Click any English word to see the Latin or Greek that produced it. On-demand alignment powered by Gemini embeddings.',
    date: '17 April 2026',
    readTime: '4 min read',
    tag: 'Interactive',
    tagColor: 'bg-amber-50 text-amber-700',
  },
  {
    slug: 'rashi-ocr',
    title: 'The Rashi Problem: When AI OCR Hallucinates in Hebrew',
    subtitle: 'Gemini reads Arabic, Sanskrit, and Chinese fine. On Rashi script it hallucinates — and our quality metrics gave it a passing grade.',
    date: '24 March 2026',
    readTime: '10 min read',
    tag: 'Technical',
    tagColor: 'bg-stone-100 text-stone-600',
    image: 'https://images.sourcelibrary.org/archived/6990630be7b7642c081de08b/8.jpg',
    imageAlt: 'Page from the Zohar, Cremona 1558 edition, showing dense Rashi script in Aramaic',
  },
  {
    slug: 'translation-rate',
    title: 'How Many Renaissance Books Get Translated Each Year?',
    subtitle: 'We queried 13,862 records from the UNESCO Index Translationum and 11 other catalogs. The answer is smaller than anyone guesses.',
    date: '21 March 2026',
    readTime: '10 min read',
    tag: 'Deep dive',
    tagColor: 'bg-accent-rust/10 text-accent-rust',
  },
  {
    slug: 'visualizing-classification',
    title: 'Visualizing 20,000 Books Across Six Dimensions',
    subtitle: 'Four interactive D3 visualizations of our faceted classification: scatter plot, heatmap, Sankey flow, and chord diagram.',
    date: '16 March 2026',
    readTime: '6 min read',
    tag: 'AI research report',
    tagColor: 'bg-accent-sage/10 text-accent-sage-dark',
  },
  {
    slug: 'history-of-classification',
    title: 'Ten Thousand Years of Tagging',
    subtitle: 'From Callimachus at Alexandria to LLM-assigned faceted tags, the history of classification runs through books we actually have.',
    date: '16 March 2026',
    readTime: '20 min read',
    tag: 'AI research report',
    tagColor: 'bg-accent-sage/10 text-accent-sage-dark',
  },
  {
    slug: 'counting-the-gap',
    title: 'We Spent a Day Counting What Hasn\'t Been Translated',
    subtitle: 'We matched 1.6 million early modern editions against translation catalogs. It started as a quick check and turned into an all-day rabbit hole.',
    date: '15 March 2026',
    readTime: '8 min read',
    tag: 'Behind the scenes',
    tagColor: 'bg-stone-100 text-stone-600',
  },
  {
    slug: 'untranslated-renaissance',
    title: 'How Much of the Renaissance Has Been Translated?',
    subtitle: '1.4 million editions, every English translation catalog we could find. The numbers are rough, but the gap is enormous.',
    date: '15 March 2026',
    readTime: '10 min read',
    tag: 'Deep dive',
    tagColor: 'bg-accent-rust/10 text-accent-rust',
  },
  {
    slug: 'origin-story',
    title: 'Where Source Library Came From',
    subtitle: 'One untranslated Ficino manuscript at the Embassy of the Free Mind, 5,000 books later.',
    date: '15 March 2026',
    readTime: '8 min read',
    tag: 'Origin',
    tagColor: 'bg-accent-gold/10 text-accent-gold-dark',
    image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/blog/ficino-bust-laptop.jpg',
    imageAlt: 'Bronze bust of Marsilio Ficino with a laptop at the Embassy of the Free Mind',
  },
  {
    slug: 'hieroglyph-ocr',
    title: 'Can AI Read Hieroglyphs? (No.)',
    subtitle: 'Four approaches to hieroglyphic OCR, four failures. The Unicode block has 1,071 characters and Gemini can\'t reliably pick the right ones.',
    date: '14 March 2026',
    readTime: '12 min read',
    tag: 'Technical',
    tagColor: 'bg-stone-100 text-stone-600',
    image: 'https://iiif.archive.org/iiif/egyptianreadingb00budguoft$80/full/1000,/0/default.jpg',
    imageAlt: 'Page from Budge\'s Egyptian Reading Book showing hieroglyphic text and transliteration, 1896',
  },
  {
    slug: 'clustering',
    title: 'What Does a Library of 3,400 Rare Books Look Like?',
    subtitle: 'Embedding summaries and letting HDBSCAN find the structure. 48 clusters, six intellectual traditions, from alchemy to Sanskrit astronomy.',
    date: '14 March 2026',
    readTime: '10 min read',
    tag: 'Methodology',
    tagColor: 'bg-accent-sage/10 text-accent-sage-dark',
    image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/6952dac677f38f6761bc683a/13.jpg',
    imageAlt: 'Integra Naturae Speculum by Robert Fludd, showing the Great Chain of Being, 1617',
  },
  // Hidden: needs rewrite with proper import session data
  // {
  //   slug: 'autonomous-agents',
  //   title: 'How We Added 950 Books in a Weekend',
  //   subtitle: 'A human curator and three AI agents worked in parallel...',
  //   date: '9 March 2026',
  //   readTime: '12 min read',
  //   tag: 'Methodology',
  //   tagColor: 'bg-accent-sage/10 text-accent-sage-dark',
  //   image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/695230c6ab34727b1f044784/9.jpg',
  //   imageAlt: 'Page from a 16th-century manuscript showing mechanical diagrams',
  // },
  {
    slug: 'progress-studies',
    title: 'The Deeper Roots of Progress',
    subtitle: 'Mokyr, Howes, and Crawford ask why innovation happens. 5,000 newly translated books show where the experimental mindset came from.',
    date: '8 March 2026',
    readTime: '15 min read',
    tag: 'Deep dive',
    tagColor: 'bg-accent-rust/10 text-accent-rust',
    image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/695230c6ab34727b1f044784/9.jpg',
    imageAlt: 'Page from a 16th-century Greek manuscript of Hero of Alexandria\'s Pneumatica, showing mechanical diagrams',
  },
  {
    slug: 'ocr-consistency',
    title: 'How Consistent Is AI OCR?',
    subtitle: 'A digitization error gave us 1,448 natural experiments: two photos of the same page, OCR\'d independently. Median disagreement: 1.8%.',
    date: '7 March 2026',
    readTime: '12 min read',
    tag: 'Methodology',
    tagColor: 'bg-accent-sage/10 text-accent-sage-dark',
    image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/uploads/697b079ac66889d6835b576a/697b09f386b3d3c458a4c04c.jpg',
    imageAlt: 'Page spread from Einleitung zum wahren und gründlichen Erkänntnis des grossen Geheimnisses der Gottseligkeit, an early modern German alchemical text',
  },
  {
    slug: 'cuneiform-ocr',
    title: 'Can AI Read Cuneiform?',
    subtitle: 'Gemini identified the Code of Hammurabi and caught a 2,500-year-old forgery. It also hallucinated an entire document.',
    date: '7 March 2026',
    readTime: '20 min read',
    tag: 'Technical',
    tagColor: 'bg-stone-100 text-stone-600',
    image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/blog/cuneiform/P464358_d-sBPv8Z5dT88Vwi9ZcuAMnSz4nYflrw.jpg',
    imageAlt: 'Code of Hammurabi stele detail showing cuneiform inscription, ca. 1750 BCE',
  },
  {
    slug: 'rithmomachia',
    title: 'Rithmomachia: The Forgotten Game That Taught Europe to Think Like Pythagoras',
    subtitle: 'A mathematical board game played for six centuries. You capture by arithmetic and win by creating harmony.',
    date: '2 March 2026',
    readTime: '18 min read',
    tag: 'Collection',
    tagColor: 'bg-accent-violet/10 text-accent-violet',
    image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/699fcd499ff0f1d2c4518062/498.jpg',
    imageAlt: 'Copperplate engraving of a Rithmomachia game board from Selenus, Das Schach- oder König-Spiel, 1616',
  },
  {
    slug: 'hidden-engineers',
    title: 'The Hidden Engineers',
    subtitle: 'Before engineering was a discipline, its knowledge lived inside spell books and alchemy. One 16th-century manuscript binds Hero\'s steam engines with the Corpus Hermeticum.',
    date: '27 February 2026',
    readTime: '22 min read',
    tag: 'Deep dive',
    tagColor: 'bg-accent-rust/10 text-accent-rust',
    image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/695230c6ab34727b1f044784/93.jpg',
    imageAlt: 'Page from a 16th-century Greek manuscript showing Hero of Alexandria\'s Aeolipile diagram',
  },
  {
    slug: 'philosophers-stone',
    title: "What Is the Philosopher's Stone?",
    subtitle: 'An allegorical emblem sequence, a universal salt, a red powder found in a bishop\'s tomb. Eight primary sources, eight different answers.',
    date: '27 February 2026',
    readTime: '20 min read',
    tag: 'Deep dive',
    tagColor: 'bg-accent-rust/10 text-accent-rust',
    image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/uploads/69804b952c52aad359879321/69804ceaefc8a337f6e2717b.jpg',
    imageAlt: 'Frontispiece engraving from Lambspringk\'s De Lapide Philosophico, Frankfurt 1625',
  },
  {
    slug: 'first-translation-methodology',
    title: 'How We Identify First Translations',
    subtitle: 'AI enrichment, bibliographic heuristics, six-level status system, and the limitations we know about.',
    date: '23 February 2026',
    readTime: '10 min read',
    tag: 'Methodology',
    tagColor: 'bg-accent-sage/10 text-accent-sage-dark',
    image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/6952587bab34727b1f045546/3.jpg',
    imageAlt: 'Title page of Symbola Aureae Mensae by Michael Maier, with twelve alchemist portrait medallions, 1617',
  },
  {
    slug: 'astrological-diagrams',
    title: 'Astrological Diagrams from Nine Centuries',
    subtitle: 'From the 10th-century Dunhuang Star Chart to Kepler\'s cosmic harmonics.',
    date: '22 February 2026',
    readTime: '15 min read',
    tag: 'Visual essay',
    tagColor: 'bg-accent-gold/10 text-accent-gold-dark',
    image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/6952dac677f38f6761bc683a/13.jpg',
    imageAlt: 'Integra Naturae Speculum by Robert Fludd, showing the Great Chain of Being with celestial spheres and zodiac signs, 1617',
  },
  {
    slug: 'demonology',
    title: 'What Are Demons? Five Answers from the Primary Sources',
    subtitle: 'The Hermetic daemon is your cosmic guardian. The Christian demon is a fallen angel. The same word, reversed.',
    date: '21 February 2026',
    readTime: '18 min read',
    tag: 'Deep dive',
    tagColor: 'bg-accent-rust/10 text-accent-rust',
    image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/6953b56577f38f6761bd979d/62.jpg',
    imageAlt: 'Illustration of a jinn from the Book of Wonders, 14th century',
  },
  {
    slug: 'history-of-astrology',
    title: 'A History of Astrology Across Traditions',
    subtitle: 'Babylonian omen tablets to Kepler\'s geometrical cosmos, independently across five civilizations.',
    date: '21 February 2026',
    readTime: '22 min read',
    tag: 'Deep dive',
    tagColor: 'bg-accent-rust/10 text-accent-rust',
    image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/699068948034a3640265b709/311.jpg',
    imageAlt: 'Zodiac Man (Homo Signorum) from a medieval astrological manuscript',
  },
  {
    slug: 'first-translations',
    title: 'Over 500 First English Translations',
    subtitle: 'Lab manuals, radical theology, women alchemists, Sanskrit astrology, founding texts of biblical criticism. Never before in English.',
    date: '20 February 2026',
    readTime: '14 min read',
    tag: 'Collection',
    tagColor: 'bg-accent-violet/10 text-accent-violet',
    image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/4d4089b9-9227-4cc5-b0a2-9b06ee731061/2.jpg',
    imageAlt: 'Frontispiece of Kircher\'s Oedipus Aegyptiacus, 1653',
  },
  {
    slug: 'mcp-server',
    title: 'Claude Can Now Read Thousands of Rare Books',
    subtitle: 'An MCP server giving Claude direct access to Source Library: historical texts, translations, entity graph, and 90,000+ illustrations.',
    date: '18 February 2026',
    readTime: '8 min read',
    tag: 'Technical',
    tagColor: 'bg-stone-100 text-stone-600',
    image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/699065973dc2ed39a49f1e71/4.jpg',
    imageAlt: 'The Fountain of Hermes from the Ripley Scroll, Bodleian Library, c. 1450',
  },
  {
    slug: 'fire-horse',
    title: 'The Year of the Fire Horse',
    subtitle: 'Double yang fire, a 17th-century arsonist, and the original texts behind Chinese astrology.',
    date: '17 February 2026',
    readTime: '16 min read',
    tag: 'Deep dive',
    tagColor: 'bg-accent-rust/10 text-accent-rust',
    image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/6992cac0d4d545ae73feea71/6.jpg',
    imageAlt: 'He Tu (River Map) diagram from Chinese cosmological tradition',
  },
  {
    slug: 'indigenous-traditions',
    title: 'The Sacred Texts That Were Never \'Texts\'',
    subtitle: '90+ volumes: Navajo ceremonies, Yoruba cosmology, Celtic place-lore, Norse Eddas. Every inhabited continent.',
    date: '16 February 2026',
    readTime: '18 min read',
    tag: 'Collection',
    tagColor: 'bg-accent-violet/10 text-accent-violet',
    image: 'https://archive.org/download/gri_33125009545621/page/n23/full/pct:50/0/default.jpg',
    imageAlt: 'Weighing of the Heart scene from the Book of the Dead, Papyrus of Ani, British Museum, c. 1250 BCE',
  },
  {
    slug: 'fechner-bohme',
    title: 'The Mystic Who Invented Psychophysics',
    subtitle: 'Fechner founded experimental psychology. His real goal was proving the universe has a soul.',
    date: '16 February 2026',
    readTime: '15 min read',
    tag: 'Deep dive',
    tagColor: 'bg-accent-rust/10 text-accent-rust',
    image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/6867c580aadfee9e955eca92/4.jpg',
    imageAlt: 'Title page of Aurora by Jakob Bohme, with cosmic diagram and Fraktur typography',
  },
  {
    slug: 'invisible-hand',
    title: 'The Invisible Hand Has a History',
    subtitle: 'Before Adam Smith: Florentine merchants, Salamanca theologians, Cambridge Platonists.',
    date: '15 February 2026',
    readTime: '20 min read',
    tag: 'Deep dive',
    tagColor: 'bg-accent-rust/10 text-accent-rust',
    image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/69520c46ab34727b1f044141/7.jpg',
    imageAlt: 'Title page of Atalanta Fugiens by Michael Maier, with allegorical scenes',
  },
  {
    slug: 'chakra-tradition',
    title: 'Recovering the Chakra Tradition',
    subtitle: 'The primary tantric sources on chakras, nadis, and kundalini. Many translated for the first time.',
    date: '15 February 2026',
    readTime: '12 min read',
    tag: 'Collection',
    tagColor: 'bg-accent-violet/10 text-accent-violet',
    image: 'https://iiif.wellcomecollection.org/image/b33599051_0001.jp2/full/1000,/0/default.jpg',
    imageAlt: 'Chakra diagram from the Shaiva tantric tradition, Wellcome Collection',
  },
];

export default function BlogPage() {
  const [hero, ...rest] = posts;

  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Research Notes"
          subtitle="AI-assisted research on rare texts, classification, and the history of knowledge. Derek Lomas directs the questions; Claude (Anthropic) builds the analysis. Every claim is grounded in primary sources from the collection."
          image="https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/699065973dc2ed39a49f1e71/4.jpg"
          imageAlt="The Fountain of Hermes from the Ripley Scroll, Bodleian Library, c. 1450"
        >
          <p className="text-stone-400 text-sm mt-4">
            <Link href="/blog/how-these-are-made" className="hover:text-white underline decoration-stone-500 underline-offset-2 transition-colors">
              How these notes are made
            </Link>
          </p>
        </ContentHeader>
      }
      bg="bg-cream"
    >
      <div className="flex justify-end mb-6">
        <a
          href="/api/feed/blog"
          className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-accent-rust transition-colors"
          title="Subscribe to Research Notes via RSS"
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 11a9 9 0 0 1 9 9h2.5A11.5 11.5 0 0 0 4 8.5V11zm0 4a5 5 0 0 1 5 5h2.5A7.5 7.5 0 0 0 4 12.5V15zm1.6 2.4A1.6 1.6 0 1 0 4 19a1.6 1.6 0 0 0 1.6-1.6z" />
          </svg>
          RSS
        </a>
      </div>

      {/* Hero post — editorial side-by-side feature */}
      <Link
        href={`/blog/${hero.slug}`}
        className="block bg-white rounded-xl overflow-hidden shadow-sm border border-border-light hover:shadow-lg hover:border-accent-gold/12 transition-all group mb-12"
      >
        <div className="md:flex md:min-h-[340px]">
          {hero.image && (
            <div className="md:w-[45%] shrink-0 overflow-hidden relative h-56 md:h-auto">
              <Image
                src={hero.image}
                alt={hero.imageAlt || ''}
                fill
                sizes="(max-width: 768px) 100vw, 45vw"
                className="object-cover group-hover:scale-[1.02] transition-transform duration-700"
                priority
              />
            </div>
          )}
          <div className="p-8 md:p-10 flex flex-col justify-center">
            <div className="flex items-center gap-3 mb-4">
              {hero.tag && (
                <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${hero.tagColor}`}>
                  {hero.tag}
                </span>
              )}
              <span className="text-xs text-muted tracking-wide uppercase">{hero.date} &middot; {hero.readTime}</span>
            </div>
            <h2 className="font-serif text-2xl md:text-3xl text-primary group-hover:text-accent-gold-dark transition-colors mb-4 leading-tight">
              {hero.title}
            </h2>
            <p className="text-secondary leading-relaxed font-body md:text-lg">
              {hero.subtitle}
            </p>
            <span className="inline-block mt-6 text-accent-rust text-sm font-medium group-hover:translate-x-1 transition-transform">
              Read article &rarr;
            </span>
          </div>
        </div>
      </Link>

      {/* Post list */}
      <div className="divide-y divide-border-light">
        {rest.map((post) => (
          <Link
            key={post.slug}
            href={`/blog/${post.slug}`}
            className="flex gap-5 py-6 first:pt-0 group"
          >
            {post.image && (
              <div className="w-28 h-28 md:w-44 md:h-32 shrink-0 rounded-lg overflow-hidden relative">
                <Image
                  src={post.image}
                  alt={post.imageAlt || ''}
                  fill
                  sizes="(max-width: 768px) 112px, 176px"
                  className="object-cover group-hover:scale-[1.04] transition-transform duration-500"
                />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                {post.tag && (
                  <span className={`text-xs font-medium px-2.5 py-0.5 rounded-full ${post.tagColor}`}>
                    {post.tag}
                  </span>
                )}
              </div>
              <h2 className="font-serif text-xl md:text-2xl text-primary group-hover:text-accent-gold-dark transition-colors leading-snug mb-2">
                {post.title}
              </h2>
              <p className="text-base text-secondary leading-relaxed line-clamp-2 font-body mb-2 hidden sm:block">
                {post.subtitle}
              </p>
              <span className="text-base text-muted">{post.date} &middot; {post.readTime}</span>
            </div>
          </Link>
        ))}
      </div>
    </ContentPageLayout>
  );
}
