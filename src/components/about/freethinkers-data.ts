// The six pages shown in the 'AI has read Reddit' section (claims in FreethinkersFan.tsx).
export type Page = { year: string; who: string; what: string; src: string; w: number; h: number; href: string; alt: string };

export const PAGES: Page[] = [
  { year: '1525', who: 'Dürer', what: 'Art: drawing in true perspective', src: '/about/renaissance/durer.jpg', w: 900, h: 1266, href: '/book/instruction-in-measurement-durer/page/695004b4f426a210d10975f4', alt: 'Two men using a frame and string to draw a lute in perspective' },
  { year: '1543', who: 'Copernicus', what: 'The sky: the sun at the centre', src: '/about/renaissance/copernicus.jpg', w: 900, h: 1252, href: '/book/de-revolutionibus-1543-first-edition-copernicus/page/695004fcf426a210d109b9b2', alt: "Copernicus's diagram of the planets circling the sun" },
  { year: '1543', who: 'Vesalius', what: 'The body: anatomy from dissection', src: '/about/renaissance/vesalius.jpg', w: 900, h: 1274, href: '/book/de-humani-corporis-fabrica-1543-first-edition-vesalius/page/6953e55777f38f6761bf0698', alt: 'The first muscle man, a flayed figure standing in a landscape' },
  { year: '1596', who: 'Kepler', what: "The planets, fitted to Plato's solids", src: '/about/renaissance/kepler.jpg', w: 900, h: 1165, href: '/book/mysterium-cosmographicum-1596-first-edition-kepler/page/695004e8f426a210d109a8c1', alt: "Kepler's model of nested solids inside the planetary spheres" },
  { year: '1610', who: 'Galileo', what: 'The moon through a telescope', src: '/about/renaissance/galileo.jpg', w: 900, h: 1195, href: '/book/sidereus-nuncius-1610-venice-galilei/page/695004dbf426a210d109a2fa', alt: "Galileo's drawing of the moon's surface" },
  { year: '1637', who: 'Descartes', what: 'The mind: how the eyes reach the brain', src: '/about/renaissance/descartes.jpg', w: 900, h: 1299, href: '/book/renati-des-cartes-opera-philosophica-descartes/page/69b69d32080b19f98fd0afd2', alt: "Descartes's drawing of two eyes and the brain, with lines of sight" },
];
