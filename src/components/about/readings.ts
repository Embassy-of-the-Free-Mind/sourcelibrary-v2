/**
 * Openings read in the /about "What we do" demo. Same data as the folium-studio.com
 * homepage hero (assets/hero-bph.js): boxes are % of the opening image, and the
 * text is the page's own transcription and translation, cut to the marked line.
 * Scans: public/about/readings/<img>-{m,l}.jpg.
 */
export type Box = { l: number; t: number; w: number; h: number; side?: "l" | "r" };
export type Reading = {
  img: string; ar: number; title: string; meta: string; lang: string;
  line: Box; orig: string; en: string;
  ents: (Box & { k: string; v: string })[];
  terms: string[];
  plate: Box & { k: string; tags: string[] };
};

export const READINGS: Reading[] = [
  {
    "img": "o176",
    "ar": 1.37,
    "title": "Preparation of Drinkable Gold",
    "meta": "Marcus Eugenius Bonacina · manuscript",
    "lang": "Latin · manuscript",
    "line": {
      "l": 52,
      "t": 17.3,
      "w": 40,
      "h": 21
    },
    "orig": "donec Pavonis cauda prorsus consumetur, et opus fiat album et perlucidum sicut margarita orientalis",
    "en": "until the peacock's tail is utterly consumed, and the work becomes white and transparent like an oriental pearl",
    "ents": [
      {
        "l": 75,
        "t": 18.3,
        "w": 8,
        "h": 4,
        "k": "Term",
        "v": "peacock's tail"
      },
      {
        "l": 59,
        "t": 33.3,
        "w": 20.5,
        "h": 4.2,
        "k": "Term",
        "v": "oriental pearl"
      },
      {
        "l": 52.3,
        "t": 52.2,
        "w": 6.8,
        "h": 4.2,
        "k": "Figure",
        "v": "the Queen"
      }
    ],
    "terms": [
      "transmutation",
      "the white work"
    ],
    "plate": {
      "l": 17,
      "t": 17.5,
      "w": 33.5,
      "h": 60.5,
      "k": "Figure · watercolour",
      "tags": [
        "Queen enthroned",
        "flaming heart",
        "caduceus"
      ]
    }
  },
  {
    "img": "o164",
    "ar": 1.303,
    "title": "De Roode Leeuw, of het Sout der Philosophen",
    "meta": "1672 · pages 90 and 91",
    "lang": "Dutch",
    "line": {
      "l": 52,
      "t": 65.6,
      "w": 33.5,
      "h": 8.6
    },
    "orig": "Nu dat ik my hier heb ingelaten, om van de Vruchten des Lands te schryven, soo sal ik daer noch soo niet af scheiden",
    "en": "Now that I have committed myself here to writing of the Fruits of the Land, I shall not depart from the subject just yet",
    "ents": [
      {
        "l": 19.8,
        "t": 49,
        "w": 5.6,
        "h": 3.2,
        "k": "Person",
        "v": "Bacchus"
      },
      {
        "l": 39,
        "t": 49,
        "w": 5.8,
        "h": 3.2,
        "k": "Person",
        "v": "Hermes"
      },
      {
        "l": 76.7,
        "t": 82.4,
        "w": 8.2,
        "h": 3.4,
        "k": "Reference",
        "v": "Psalm 23"
      }
    ],
    "terms": [
      "salts of metals",
      "water ∇"
    ],
    "plate": {
      "l": 50.3,
      "t": 23.3,
      "w": 35,
      "h": 36,
      "k": "Engraving",
      "tags": [
        "Aeolus",
        "Sun ☉ and Moon ☽",
        "Mercury ☿"
      ]
    }
  },
  {
    "img": "o69",
    "ar": 1.444,
    "title": "Le cueur de philosophie",
    "meta": "1534",
    "lang": "Middle French",
    "line": {
      "l": 20,
      "t": 31.3,
      "w": 25,
      "h": 3.6
    },
    "orig": "Icy est la figure & demonstrance des douze signes.",
    "en": "Here is the figure and demonstration of the twelve signs.",
    "ents": [
      {
        "l": 52.5,
        "t": 27.6,
        "w": 33.5,
        "h": 3.2,
        "k": "Terms",
        "v": "the twelve signs"
      },
      {
        "l": 54,
        "t": 59.8,
        "w": 5.5,
        "h": 3.8,
        "k": "Term",
        "v": "equinoctial"
      }
    ],
    "terms": [
      "zodiac",
      "astronomy"
    ],
    "plate": {
      "l": 15,
      "t": 35.2,
      "w": 34.5,
      "h": 48.1,
      "k": "Woodcut · diagram",
      "tags": [
        "zodiac",
        "twelve signs",
        "the seasons"
      ]
    }
  },
  {
    "img": "o201",
    "ar": 1.308,
    "title": "Wasserstein der Weisen",
    "meta": "Frankfurt and Leipzig, 1743",
    "lang": "German · Fraktur",
    "line": {
      "l": 54.5,
      "t": 38,
      "w": 38,
      "h": 11
    },
    "orig": "der Weg gezeiget, die Materia genennet, und der Process beschrieben wird, zu dem hohen Geheimniß der Universal-Tinctur zu kommen",
    "en": "the way is shown, the matter is named and the process described, to attain the high secret of the Universal Tincture",
    "ents": [
      {
        "l": 59,
        "t": 69,
        "w": 28,
        "h": 4,
        "k": "Person",
        "v": "Lucas Jennis"
      },
      {
        "l": 57.5,
        "t": 91.8,
        "w": 13,
        "h": 3.6,
        "k": "Place",
        "v": "Frankfurt",
        "side": "l"
      },
      {
        "l": 75,
        "t": 94.8,
        "w": 15,
        "h": 3.4,
        "k": "Date",
        "v": "1743",
        "side": "r"
      }
    ],
    "terms": [
      "Universal Tincture",
      "Rosicrucianism"
    ],
    "plate": {
      "l": 8,
      "t": 9.5,
      "w": 38,
      "h": 65,
      "k": "Frontispiece · engraving",
      "tags": [
        "heart on a root",
        "hand from a cloud",
        "pilgrims"
      ]
    }
  },
  {
    "img": "o181",
    "ar": 1.571,
    "title": "Livre des figures hiéroglyphiques",
    "meta": "Nicolas Flamel · manuscript, 18th century",
    "lang": "French · manuscript",
    "line": {
      "l": 11,
      "t": 21.8,
      "w": 38,
      "h": 6.8
    },
    "orig": "La fable nous represente la pucelle Hesione preste a etre devorée par un monstre marin, que Hercée delivre apres avoir tué ce dragon.",
    "en": "Fable represents to us the maiden Hesione ready to be devoured by a sea monster, whom Hercée delivers after having killed this dragon.",
    "ents": [
      {
        "l": 40.5,
        "t": 38.8,
        "w": 6,
        "h": 3.2,
        "k": "Term",
        "v": "Mercury"
      },
      {
        "l": 12.5,
        "t": 41.8,
        "w": 14.5,
        "h": 3.2,
        "k": "Motif",
        "v": "seven-headed dragon"
      },
      {
        "l": 36,
        "t": 53.7,
        "w": 9.5,
        "h": 3.2,
        "k": "Term",
        "v": "seven metals"
      }
    ],
    "terms": [
      "Hesione",
      "alchemy"
    ],
    "plate": {
      "l": 51.5,
      "t": 4,
      "w": 39,
      "h": 91,
      "k": "Figure · hand-coloured",
      "tags": [
        "Woman of the Apocalypse",
        "crown of twelve stars",
        "hydra"
      ]
    }
  }
];
