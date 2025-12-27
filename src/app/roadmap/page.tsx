'use client';

import Link from 'next/link';
import { ArrowLeft, ExternalLink, BookOpen, Scroll, Compass, FlaskConical, Calculator, Star } from 'lucide-react';

interface RoadmapWork {
  author: string;
  title: string;
  originalTitle?: string;
  date: string;
  firstPrinted?: string;
  language: string;
  significance: string;
  iaIdentifier?: string;
  iaUrl?: string;
  status: 'available' | 'in_progress' | 'planned';
  priority: 'high' | 'medium' | 'low';
}

interface RoadmapSection {
  id: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  works: RoadmapWork[];
}

const roadmapSections: RoadmapSection[] = [
  {
    id: 'ancient-foundations',
    title: 'Ancient Foundations',
    description: 'The foundational texts of Western philosophy, mathematics, and science from ancient Greece and Rome (c. 300 BCE - 500 CE)',
    icon: <Scroll className="w-6 h-6" />,
    works: [
      {
        author: 'Euclid',
        title: 'Elements',
        originalTitle: 'Elementa',
        date: 'c. 300 BCE',
        firstPrinted: '1482 (Venice, Ratdolt)',
        language: 'Latin',
        significance: 'The foundational text of geometry, used for over 2000 years. First printed mathematical work with diagrams. Translation by Adelard of Bath with Campanus commentary.',
        iaIdentifier: 'preclarissimusli00eucl',
        iaUrl: 'https://archive.org/details/preclarissimusli00eucl',
        status: 'planned',
        priority: 'high'
      },
      {
        author: 'Plato',
        title: 'Complete Works (Ficino translation)',
        originalTitle: 'Opera Omnia',
        date: 'c. 380 BCE',
        firstPrinted: '1484 (Florence)',
        language: 'Latin',
        significance: 'Ficino\'s landmark translation that sparked the Renaissance. First complete Latin Plato, including Republic, Symposium, Timaeus, Phaedo.',
        iaIdentifier: 'bub_gb_ucju1UXVU9UC',
        iaUrl: 'https://archive.org/details/bub_gb_ucju1UXVU9UC',
        status: 'planned',
        priority: 'high'
      },
      {
        author: 'Aristotle',
        title: 'Complete Works (Aldine Greek edition)',
        originalTitle: 'Opera',
        date: 'c. 350 BCE',
        firstPrinted: '1495-1498 (Venice, Aldus Manutius)',
        language: 'Greek',
        significance: 'First printed Greek edition of Aristotle. Physics, Metaphysics, De Anima, Ethics, Politics - the texts that shaped medieval and Renaissance thought.',
        iaUrl: 'https://archive.org/details/bplscinc',
        status: 'planned',
        priority: 'high'
      },
      {
        author: 'Ptolemy',
        title: 'Cosmographia',
        originalTitle: 'Geographia',
        date: 'c. 150 CE',
        firstPrinted: '1482 (Ulm)',
        language: 'Latin',
        significance: 'First printed edition with woodcut maps. The geographic system that guided exploration until the Age of Discovery.',
        iaIdentifier: 'cosmographia00ptol',
        iaUrl: 'https://archive.org/details/cosmographia00ptol',
        status: 'planned',
        priority: 'high'
      },
      {
        author: 'Ptolemy',
        title: 'Almagest',
        originalTitle: 'Mathematike Syntaxis',
        date: 'c. 150 CE',
        firstPrinted: '1515 (Venice)',
        language: 'Latin',
        significance: 'The astronomical system that dominated for 1400 years. Mathematical models of planetary motion.',
        iaIdentifier: 'almagest00ptol',
        iaUrl: 'https://archive.org/details/almagest00ptol',
        status: 'planned',
        priority: 'high'
      },
      {
        author: 'Archimedes',
        title: 'Works',
        originalTitle: 'Opera',
        date: 'c. 250 BCE',
        firstPrinted: '1544 (Basel)',
        language: 'Greek/Latin',
        significance: 'On the Sphere and Cylinder, On Floating Bodies, The Sand Reckoner. The mathematics that inspired Galileo and Newton.',
        iaUrl: 'https://archive.org/details/thirteenbooksofe0011eucl',
        status: 'planned',
        priority: 'high'
      },
      {
        author: 'Apollonius of Perga',
        title: 'Conics',
        originalTitle: 'Conica',
        date: 'c. 200 BCE',
        firstPrinted: '1537 (Venice)',
        language: 'Latin',
        significance: 'Defined ellipse, parabola, hyperbola. Essential for Kepler\'s planetary orbits and modern physics.',
        iaIdentifier: 'treatiseonconics00apolrich',
        iaUrl: 'https://archive.org/details/treatiseonconics00apolrich',
        status: 'planned',
        priority: 'medium'
      },
      {
        author: 'Boethius',
        title: 'Consolation of Philosophy',
        originalTitle: 'De Consolatione Philosophiae',
        date: '524 CE',
        firstPrinted: '1471 (Nuremberg)',
        language: 'Latin',
        significance: 'Most influential philosophical work of the Middle Ages. Translated by Alfred the Great, Chaucer, and Elizabeth I.',
        iaIdentifier: 'b24862617',
        iaUrl: 'https://archive.org/details/b24862617',
        status: 'planned',
        priority: 'high'
      }
    ]
  },
  {
    id: 'renaissance-philosophy',
    title: 'Renaissance Philosophy',
    description: 'The Florentine Platonic revival and the recovery of ancient wisdom (1450-1550)',
    icon: <Star className="w-6 h-6" />,
    works: [
      {
        author: 'Marsilio Ficino',
        title: 'Platonic Theology',
        originalTitle: 'Theologia Platonica',
        date: '1482',
        language: 'Latin',
        significance: 'Ficino\'s masterwork on the immortality of the soul. Synthesis of Platonism and Christianity that defined Renaissance thought.',
        iaUrl: 'https://archive.org/search?query=ficino%20theologia%20platonica',
        status: 'planned',
        priority: 'high'
      },
      {
        author: 'Ficino / Iamblichus / Porphyry',
        title: 'De Mysteriis Aegyptiorum',
        originalTitle: 'De mysteriis Aegyptiorum, Chaldaeorum, Assyriorum',
        date: '1497',
        language: 'Latin',
        significance: 'Theurgy, divine possession, and ritual magic. The Aldine edition that shaped Western esotericism.',
        status: 'in_progress',
        priority: 'high'
      },
      {
        author: 'Giovanni Pico della Mirandola',
        title: 'Oration on the Dignity of Man',
        originalTitle: 'Oratio de hominis dignitate',
        date: '1486',
        language: 'Latin',
        significance: 'The "Manifesto of the Renaissance." Human potential and the synthesis of all philosophies.',
        iaUrl: 'https://archive.org/search?query=pico%20della%20mirandola%20oratio',
        status: 'planned',
        priority: 'high'
      },
      {
        author: 'Hermes Trismegistus',
        title: 'Corpus Hermeticum (Ficino translation)',
        originalTitle: 'Pimander',
        date: '1463 (trans.), 1471 (printed)',
        language: 'Latin',
        significance: 'Ancient Egyptian wisdom tradition. Cosimo de\' Medici prioritized this over Plato. Foundation of Renaissance magic.',
        iaUrl: 'https://archive.org/search?query=hermes%20trismegistus%20ficino',
        status: 'planned',
        priority: 'high'
      },
      {
        author: 'Plotinus',
        title: 'Enneads (Ficino translation)',
        originalTitle: 'Enneades',
        date: '1492',
        language: 'Latin',
        significance: 'The source of Neoplatonism. The One, emanation, and return. Shaped Christian, Islamic, and Jewish mysticism.',
        iaIdentifier: 'plotinioperaomn00chumgoog',
        iaUrl: 'https://archive.org/details/plotinioperaomn00chumgoog',
        status: 'planned',
        priority: 'high'
      }
    ]
  },
  {
    id: 'mathematics-astronomy',
    title: 'Mathematics & Astronomy',
    description: 'The mathematical revolution from medieval to early modern (1200-1650)',
    icon: <Calculator className="w-6 h-6" />,
    works: [
      {
        author: 'Campanus of Novara',
        title: 'Tetragonismus (Squaring the Circle)',
        originalTitle: 'Tetragonismus idest circuli quadratura',
        date: '1503',
        language: 'Latin',
        significance: 'Medieval commentary on Archimedes and Boethius. The geometry that linked antiquity to the Renaissance.',
        status: 'in_progress',
        priority: 'medium'
      },
      {
        author: 'Nicolaus Copernicus',
        title: 'On the Revolutions of the Heavenly Spheres',
        originalTitle: 'De revolutionibus orbium coelestium',
        date: '1543',
        language: 'Latin',
        significance: 'The heliocentric revolution. Displaced Earth from the center of the cosmos.',
        iaIdentifier: 'nicolaicopernici00cope_1',
        iaUrl: 'https://archive.org/details/nicolaicopernici00cope_1',
        status: 'planned',
        priority: 'high'
      },
      {
        author: 'Johannes Kepler',
        title: 'Mysterium Cosmographicum',
        originalTitle: 'Prodromus dissertationum cosmographicarum',
        date: '1596',
        language: 'Latin',
        significance: 'First openly heliocentric work since Copernicus. Platonic solids and planetary orbits.',
        iaUrl: 'https://archive.org/search?query=kepler%20mysterium%20cosmographicum',
        status: 'planned',
        priority: 'high'
      },
      {
        author: 'Johannes Kepler',
        title: 'New Astronomy',
        originalTitle: 'Astronomia Nova',
        date: '1609',
        language: 'Latin',
        significance: 'Laws of planetary motion. Elliptical orbits replace perfect circles. Foundation of modern astronomy.',
        iaUrl: 'https://archive.org/search?query=kepler%20astronomia%20nova',
        status: 'planned',
        priority: 'high'
      },
      {
        author: 'Johannes Kepler',
        title: 'Harmonies of the World',
        originalTitle: 'Harmonices Mundi',
        date: '1619',
        language: 'Latin',
        significance: 'Third law of planetary motion. Music of the spheres made mathematical.',
        iaUrl: 'https://archive.org/search?query=kepler%20harmonices%20mundi',
        status: 'planned',
        priority: 'medium'
      }
    ]
  },
  {
    id: 'natural-philosophy',
    title: 'Natural Philosophy & Early Science',
    description: 'The investigation of nature from observation to experiment (1500-1700)',
    icon: <FlaskConical className="w-6 h-6" />,
    works: [
      {
        author: 'Galileo Galilei',
        title: 'Starry Messenger',
        originalTitle: 'Sidereus Nuncius',
        date: '1610',
        language: 'Latin',
        significance: 'First scientific work based on telescope observations. Moons of Jupiter, mountains on the Moon.',
        iaUrl: 'https://archive.org/search?query=galileo%20sidereus%20nuncius',
        status: 'planned',
        priority: 'high'
      },
      {
        author: 'Galileo Galilei',
        title: 'Dialogue Concerning the Two Chief World Systems',
        originalTitle: 'Dialogo sopra i due massimi sistemi del mondo',
        date: '1632',
        language: 'Italian',
        significance: 'The work that led to Galileo\'s trial. Accessible defense of heliocentrism.',
        iaUrl: 'https://archive.org/search?query=galileo%20dialogo%20due%20massimi',
        status: 'planned',
        priority: 'high'
      },
      {
        author: 'Andreas Vesalius',
        title: 'On the Fabric of the Human Body',
        originalTitle: 'De humani corporis fabrica',
        date: '1543',
        language: 'Latin',
        significance: 'Revolutionized anatomy. Published same year as Copernicus. The body observed, not inherited from Galen.',
        iaUrl: 'https://archive.org/search?query=vesalius%20fabrica',
        status: 'planned',
        priority: 'high'
      },
      {
        author: 'William Gilbert',
        title: 'On the Magnet',
        originalTitle: 'De Magnete',
        date: '1600',
        language: 'Latin',
        significance: 'First great English scientific work. Earth as a giant magnet. Experimental method applied to physics.',
        iaUrl: 'https://archive.org/search?query=gilbert%20de%20magnete',
        status: 'planned',
        priority: 'medium'
      },
      {
        author: 'Francis Bacon',
        title: 'Novum Organum',
        date: '1620',
        language: 'Latin',
        significance: 'New method of scientific inquiry. Induction over syllogism. Blueprint for the scientific method.',
        iaUrl: 'https://archive.org/search?query=bacon%20novum%20organum',
        status: 'planned',
        priority: 'high'
      },
      {
        author: 'Robert Boyle',
        title: 'The Sceptical Chymist',
        date: '1661',
        language: 'English',
        significance: 'Birth of modern chemistry. Elements defined by experiment, not Aristotelian tradition.',
        iaUrl: 'https://archive.org/search?query=boyle%20sceptical%20chymist',
        status: 'planned',
        priority: 'medium'
      }
    ]
  },
  {
    id: 'esoteric-traditions',
    title: 'Esoteric & Hermetic Traditions',
    description: 'Alchemy, Kabbalah, and the hidden wisdom traditions (1450-1700)',
    icon: <Compass className="w-6 h-6" />,
    works: [
      {
        author: 'Heinrich Cornelius Agrippa',
        title: 'Three Books of Occult Philosophy',
        originalTitle: 'De occulta philosophia libri tres',
        date: '1533',
        language: 'Latin',
        significance: 'Encyclopedia of Renaissance magic. Natural, celestial, and ceremonial magic synthesized.',
        iaUrl: 'https://archive.org/search?query=agrippa%20occulta%20philosophia',
        status: 'planned',
        priority: 'high'
      },
      {
        author: 'Johannes Reuchlin',
        title: 'On the Art of the Kabbalah',
        originalTitle: 'De arte cabalistica',
        date: '1517',
        language: 'Latin',
        significance: 'First systematic Christian Kabbalah. Hebrew mysticism meets Renaissance philosophy.',
        iaUrl: 'https://archive.org/search?query=reuchlin%20cabala',
        status: 'planned',
        priority: 'medium'
      },
      {
        author: 'Giordano Bruno',
        title: 'On the Shadows of Ideas',
        originalTitle: 'De umbris idearum',
        date: '1582',
        language: 'Latin',
        significance: 'Memory magic and infinite cosmos. Bruno\'s art of memory as spiritual practice.',
        iaUrl: 'https://archive.org/search?query=bruno%20umbris%20idearum',
        status: 'planned',
        priority: 'medium'
      },
      {
        author: 'Athanasius Kircher',
        title: 'Oedipus Aegyptiacus',
        date: '1652-1654',
        language: 'Latin',
        significance: 'Monumental study of Egyptian wisdom, hieroglyphics, and universal symbolism.',
        iaUrl: 'https://archive.org/search?query=kircher%20oedipus%20aegyptiacus',
        status: 'planned',
        priority: 'medium'
      },
      {
        author: 'Robert Fludd',
        title: 'History of the Macrocosm and Microcosm',
        originalTitle: 'Utriusque cosmi historia',
        date: '1617-1621',
        language: 'Latin',
        significance: 'Illustrated cosmic philosophy. Music, geometry, and the correspondences between worlds.',
        iaUrl: 'https://archive.org/search?query=fludd%20utriusque%20cosmi',
        status: 'planned',
        priority: 'medium'
      }
    ]
  }
];

function StatusBadge({ status }: { status: RoadmapWork['status'] }) {
  const styles = {
    available: 'bg-green-100 text-green-800 border-green-200',
    in_progress: 'bg-amber-100 text-amber-800 border-amber-200',
    planned: 'bg-stone-100 text-stone-600 border-stone-200'
  };

  const labels = {
    available: 'Available',
    in_progress: 'In Progress',
    planned: 'Planned'
  };

  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}

function PriorityIndicator({ priority }: { priority: RoadmapWork['priority'] }) {
  if (priority === 'high') {
    return <span className="text-amber-500" title="High Priority">★</span>;
  }
  return null;
}

export default function RoadmapPage() {
  const totalWorks = roadmapSections.reduce((acc, section) => acc + section.works.length, 0);
  const inProgress = roadmapSections.reduce(
    (acc, section) => acc + section.works.filter(w => w.status === 'in_progress').length,
    0
  );
  const available = roadmapSections.reduce(
    (acc, section) => acc + section.works.filter(w => w.status === 'available').length,
    0
  );

  return (
    <div className="min-h-screen bg-stone-50">
      {/* Header */}
      <header className="bg-white border-b border-stone-200">
        <div className="max-w-5xl mx-auto px-4 py-4">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-stone-600 hover:text-stone-900"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Library
          </Link>
        </div>
      </header>

      {/* Hero */}
      <div className="bg-gradient-to-b from-stone-800 to-stone-900 text-white">
        <div className="max-w-5xl mx-auto px-4 py-12">
          <h1 className="text-3xl sm:text-4xl font-serif font-bold mb-4">
            Translation Roadmap
          </h1>
          <p className="text-stone-300 max-w-3xl text-lg">
            Our prioritized list of the most influential texts in the history of philosophy,
            mathematics, and natural science. We focus on the earliest available editions
            from the Internet Archive, bringing foundational works into modern accessibility.
          </p>

          {/* Stats */}
          <div className="flex gap-8 mt-8">
            <div>
              <div className="text-3xl font-bold text-amber-400">{totalWorks}</div>
              <div className="text-sm text-stone-400">Total Works</div>
            </div>
            <div>
              <div className="text-3xl font-bold text-amber-400">{inProgress}</div>
              <div className="text-sm text-stone-400">In Progress</div>
            </div>
            <div>
              <div className="text-3xl font-bold text-amber-400">{available}</div>
              <div className="text-sm text-stone-400">Available</div>
            </div>
          </div>
        </div>
      </div>

      {/* Mission Statement */}
      <div className="bg-amber-50 border-b border-amber-200">
        <div className="max-w-5xl mx-auto px-4 py-8">
          <h2 className="text-xl font-serif font-semibold text-stone-800 mb-3">
            Our Mission
          </h2>
          <p className="text-stone-700 leading-relaxed">
            Less than 3% of Renaissance Latin literature has ever been translated.
            Source Library aims to digitize, OCR, and translate the foundational texts
            of Western thought—starting with the earliest printed editions of ancient
            philosophy, medieval science, and Renaissance wisdom. These are the works
            that shaped Copernicus, Kepler, Newton, and the Scientific Revolution.
          </p>
        </div>
      </div>

      {/* Roadmap Sections */}
      <main className="max-w-5xl mx-auto px-4 py-12">
        {/* Table of Contents */}
        <nav className="mb-12 p-6 bg-white rounded-xl border border-stone-200">
          <h2 className="text-lg font-semibold text-stone-800 mb-4">Contents</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {roadmapSections.map(section => (
              <a
                key={section.id}
                href={`#${section.id}`}
                className="flex items-center gap-3 p-3 rounded-lg hover:bg-stone-50 transition-colors group"
              >
                <span className="text-amber-600">{section.icon}</span>
                <div>
                  <div className="font-medium text-stone-800 group-hover:text-amber-700">
                    {section.title}
                  </div>
                  <div className="text-sm text-stone-500">
                    {section.works.length} works
                  </div>
                </div>
              </a>
            ))}
          </div>
        </nav>

        {/* Sections */}
        <div className="space-y-16">
          {roadmapSections.map(section => (
            <section key={section.id} id={section.id}>
              <div className="flex items-center gap-3 mb-4">
                <span className="text-amber-600">{section.icon}</span>
                <h2 className="text-2xl font-serif font-bold text-stone-800">
                  {section.title}
                </h2>
              </div>
              <p className="text-stone-600 mb-6 max-w-3xl">
                {section.description}
              </p>

              <div className="space-y-4">
                {section.works.map((work, idx) => (
                  <div
                    key={idx}
                    className="bg-white rounded-xl border border-stone-200 p-5 hover:border-amber-200 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <PriorityIndicator priority={work.priority} />
                          <h3 className="font-semibold text-stone-900">
                            {work.author}
                          </h3>
                          <StatusBadge status={work.status} />
                        </div>
                        <div className="text-lg text-amber-800 font-medium">
                          {work.title}
                        </div>
                        {work.originalTitle && work.originalTitle !== work.title && (
                          <div className="text-sm text-stone-500 italic">
                            {work.originalTitle}
                          </div>
                        )}
                        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-sm text-stone-600">
                          <span>Written: {work.date}</span>
                          {work.firstPrinted && (
                            <span>First printed: {work.firstPrinted}</span>
                          )}
                          <span>Language: {work.language}</span>
                        </div>
                        <p className="mt-3 text-stone-700 leading-relaxed">
                          {work.significance}
                        </p>
                      </div>
                      {work.iaUrl && (
                        <a
                          href={work.iaUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex-shrink-0 p-2 text-stone-400 hover:text-amber-600 transition-colors"
                          title="View on Internet Archive"
                        >
                          <ExternalLink className="w-5 h-5" />
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>

        {/* Call to Action */}
        <div className="mt-16 bg-gradient-to-r from-stone-800 to-stone-900 rounded-2xl p-8 text-white">
          <h2 className="text-2xl font-serif font-bold mb-4">
            Help Build the Library
          </h2>
          <p className="text-stone-300 mb-6 max-w-2xl">
            Source Library is a project of the Ancient Wisdom Trust, working in partnership
            with the Embassy of the Free Mind. We seek patrons, scholars, and volunteers
            to help digitize and translate the foundational texts of human thought.
          </p>
          <div className="flex flex-wrap gap-4">
            <a
              href="mailto:derek@ancientwisdomtrust.org"
              className="inline-flex items-center gap-2 bg-amber-600 hover:bg-amber-500 text-white px-6 py-3 rounded-lg font-medium transition-colors"
            >
              <BookOpen className="w-5 h-5" />
              Get Involved
            </a>
            <a
              href="https://archive.org"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 bg-white/10 hover:bg-white/20 text-white px-6 py-3 rounded-lg font-medium transition-colors"
            >
              <ExternalLink className="w-5 h-5" />
              Browse Internet Archive
            </a>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-stone-200 bg-white">
        <div className="max-w-5xl mx-auto px-4 py-8">
          <p className="text-sm text-stone-500">
            Roadmap inspired by{' '}
            <a
              href="https://secondrenaissance.ai/blog/roadmap"
              target="_blank"
              rel="noopener noreferrer"
              className="text-amber-700 hover:text-amber-800"
            >
              Second Renaissance Research
            </a>
            . All source texts are in the public domain.
          </p>
        </div>
      </footer>
    </div>
  );
}
