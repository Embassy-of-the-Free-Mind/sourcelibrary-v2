#!/usr/bin/env node
// Crawl SHWEP episode pages to extract cited works from show notes.
// Uses actual sitemap URLs (not guessed /episode-N/ patterns).
// Run from Hetzner: node crawl-shwep.mjs

import { writeFileSync, existsSync, readFileSync } from 'fs';

const OUTPUT = '/tmp/shwep_crawled_all.jsonl';

// Episode URLs from sitemap, in order (ep 0 → ep 214)
const EPISODE_URLS = [
  'https://shwep.net/podcast/so-what-is-western-esotericism-anyway/',
  'https://shwep.net/podcast/a-secret-history-of-secret-history-part-i/',
  'https://shwep.net/podcast/a-secret-history-of-secret-history-part-ii/',
  'https://shwep.net/podcast/wouter-hanegraaff-on-western-esotericism-interview/',
  'https://shwep.net/podcast/richard-seaford-on-origins-soul-interview/',
  'https://shwep.net/podcast/methodologies-for-the-study-of-magic/',
  'https://shwep.net/podcast/magicians-ghosts-amulets-and-spells-daniel-ogden-on-graeco-roman-magic/',
  'https://shwep.net/podcast/esoteric-orientalism-part-i-ancient-barbarian-sages/',
  'https://shwep.net/podcast/esoteric-orientalism-part-ii-the-greeks-are-always-children/',
  'https://shwep.net/podcast/prayer-to-the-gods-of-night-the-near-eastern-roots-of-astrology/',
  'https://shwep.net/podcast/the-long-secret-history-of-judaism-part-i/',
  'https://shwep.net/podcast/richard-seaford-on-the-mysteries/',
  'https://shwep.net/podcast/from-mystery-to-mysticism/',
  'https://shwep.net/podcast/methodologies-for-the-study-of-mysticism/',
  'https://shwep.net/podcast/for-the-love-of-wisdom-the-birth-of-philosophy/',
  'https://shwep.net/podcast/the-enigma-of-pythagoras/',
  'https://shwep.net/podcast/the-enigma-of-pythagoreanism/',
  'https://shwep.net/podcast/the-birth-of-the-symbol-peter-struck-on-ancient-greek-esoteric-hermeneutics/',
  'https://shwep.net/podcast/all-for-one-and-one-for-all-parmenides-of-elea/',
  'https://shwep.net/podcast/severed-heads-and-cosmic-eggs-orpheus-and-esotericism/',
  'https://shwep.net/podcast/dont-spill-the-beans-pythagorean-silence/',
  'https://shwep.net/podcast/riddle-me-this-heraclitus-of-ephesus/',
  'https://shwep.net/podcast/elementary-empedocles-and-the-secret-history-of-the-elements/',
  'https://shwep.net/podcast/christopher-gill-on-platos-atlantis/',
  'https://shwep.net/podcast/miguel-herrero-de-jauregui-on-ancient-orphism/',
  'https://shwep.net/podcast/introducing-the-father-of-western-esotericism-plato/',
  'https://shwep.net/podcast/the-esoteric-plato/',
  'https://shwep.net/podcast/platos-timaeus/',
  'https://shwep.net/podcast/otherworlds-inner-worlds-and-utopias/',
  'https://shwep.net/podcast/introducing-platos-republic/',
  'https://shwep.net/podcast/sun-line-cave-platos-inner-republic/',
  'https://shwep.net/podcast/maya-alapin-on-mathematical-structures-in-platos-republic/',
  'https://shwep.net/podcast/nowhere-to-go-but-up-philosophic-ascent-in-plato/',
  'https://shwep.net/podcast/mystery-and-initiation-in-plato/',
  'https://shwep.net/podcast/special-episode-wouter-hanegraaff-on-western-esotericism/',
  'https://shwep.net/podcast/mystery-and-immortality-platos-phaedo/',
  'https://shwep.net/podcast/peter-adamson-on-plato/',
  'https://shwep.net/podcast/platos-parmenides-and-metaphysics/',
  'https://shwep.net/podcast/peter-adamson-on-plato-and-beyond/',
  'https://shwep.net/podcast/the-esoteric-aristotle/',
  'https://shwep.net/podcast/seaford-on-soul-ritual-and-money/',
  'https://shwep.net/podcast/robert-bolton-on-the-immaterial-immortal-soul/',
  'https://shwep.net/podcast/the-esoteric-aristotle-part-2/',
  'https://shwep.net/podcast/matthew-melvin-koushki-on-the-west/',
  'https://shwep.net/podcast/wheels-within-wheels-toward-western-esoteric-cosmology/',
  'https://shwep.net/podcast/daniel-ogden-on-three-ancient-mages/',
  'https://shwep.net/podcast/fate-and-foreknowledge-toward-hellenistic-astrology/',
  'https://shwep.net/podcast/chris-brennan-on-hellenistic-astrology/',
  'https://shwep.net/podcast/christopher-gill-on-stoicism/',
  'https://shwep.net/podcast/chris-brennan-gets-fatalistic/',
  'https://shwep.net/podcast/esoteric-hermeneutics-in-stoicism/',
  'https://shwep.net/podcast/christopher-gill-gets-stoical/',
  'https://shwep.net/podcast/stoic-physics-and-esoteric-metaphysics/',
  'https://shwep.net/podcast/further-travels-in-atlantis-with-christopher-gill/',
  'https://shwep.net/podcast/pythagoras-revived-an-anatomy-of-neopythagoreanism/',
  'https://shwep.net/podcast/the-numbers-dont-lie-joel-kalvesmaki-on-pythagorean-number/',
  'https://shwep.net/podcast/after-pythagoras/',
  'https://shwep.net/podcast/joel-kalvesmaki-expands-arithmetically/',
  'https://shwep.net/podcast/the-long-secret-history-of-the-jews-part-ii-second-temple-judaism/',
  'https://shwep.net/podcast/john-j-collins-on-apocalyptic/',
  'https://shwep.net/podcast/matthew-neujahr-on-near-eastern-roots-of-apocalyptic/',
  'https://shwep.net/podcast/enoch-and-the-book-of-watchers/',
  'https://shwep.net/podcast/enoch-apocalyptic-and-esoteric-abrahamic-faith/',
  'https://shwep.net/podcast/palaces-of-heavenly-wisdom-the-hekhalot-and-merkavah-traditions/',
  'https://shwep.net/podcast/naomi-janowitz-on-ancient-jewish-magic/',
  'https://shwep.net/podcast/the-first-western-esotericist-philo-of-alexandria/',
  'https://shwep.net/podcast/the-esoteric-philo/',
  'https://shwep.net/podcast/justin-rogers-on-philo-in-early-christianity/',
  'https://shwep.net/podcast/were-together-in-dreams-dreaming-and-western-esotericism/',
  'https://shwep.net/podcast/frances-flannery-on-jewish-dreams-in-antiquity/',
  'https://shwep.net/podcast/frances-flannery-dreams-on/',
  'https://shwep.net/podcast/gil-renberg-on-dream-incubation/',
  'https://shwep.net/podcast/adam-tetlow-on-mathematics-useful-for-reading-plato/',
  'https://shwep.net/podcast/roman-history-for-esotericists/',
  'https://shwep.net/podcast/politics-and-the-esoteric-in-rome/',
  'https://shwep.net/podcast/john-dillon-on-middle-platonism/',
  'https://shwep.net/podcast/dylan-burns-on-the-underworld-of-platonism/',
  'https://shwep.net/podcast/beyond-the-underworld-with-dylan-burns/',
  'https://shwep.net/podcast/the-esoteric-and-the-state-in-ancient-rome-part-2-the-state-and-the-stars/',
  'https://shwep.net/podcast/john-dillon-platonizes-further/',
  'https://shwep.net/podcast/the-enigma-of-early-christianity/',
  'https://shwep.net/podcast/graeme-miles-on-apollonius-of-tyana/',
  'https://shwep.net/podcast/graeme-miles-apollonicates-further/',
  'https://shwep.net/podcast/astrology-politics-and-platonism-in-the-early-empire-the-case-of-thrasyllus/',
  'https://shwep.net/podcast/an-erudite-esotericist-introducing-plutarch-of-chaeronea/',
  'https://shwep.net/podcast/plutarchs-myths-of-cosmic-ascent/',
  'https://shwep.net/podcast/plutarchs-on-isis-and-osiris/',
  'https://shwep.net/podcast/korshi-dosoo-on-the-papyri-graeci-magici-and-western-esotericism/',
  'https://shwep.net/podcast/daniel-harris-mccoy-on-the-oneirocritica-of-artemidorus/',
  'https://shwep.net/podcast/daniel-harris-mccoy-lives-the-dream/',
  'https://shwep.net/podcast/kocku-von-stuckrad-on-western-esotericism/',
  'https://shwep.net/podcast/hypochondria-and-epiphany-the-strange-case-of-aelius-aristides/',
  'https://shwep.net/podcast/ineffable-initiations-and-golden-asses-apuleius-of-madauros-and-the-metamorphoses/',
  'https://shwep.net/podcast/im-not-sorry-the-apology-of-apuleius/',
  'https://shwep.net/podcast/storytime-the-tale-of-cupid-and-psyche/',
  'https://shwep.net/podcast/the-chaldaean-oracles/',
  'https://shwep.net/podcast/the-chaldaean-oracles-and-theurgy/',
  'https://shwep.net/podcast/korshi-dosoo-papyrologises-magically/',
  'https://shwep.net/podcast/numenius-of-apamea/',
  'https://shwep.net/podcast/alone-with-the-alone-numenius-metaphysics/',
  'https://shwep.net/podcast/michael-williams-on-the-trouble-with-gnosticism/',
  'https://shwep.net/podcast/michael-williams-on-early-christian-heterodoxies/',
  'https://shwep.net/podcast/warfaring-strangers-prolegomena-to-second-century-christianity/',
  'https://shwep.net/podcast/i-got-soul-and-im-super-bad-basilides-of-alexandria/',
  'https://shwep.net/podcast/geoffrey-smith-on-valentinus-and-valentinianism/',
  'https://shwep.net/podcast/geoffrey-smith-valentinicates-further/',
  'https://shwep.net/podcast/other-gospels-and-alien-gods-marcion-of-sinope/',
  'https://shwep.net/podcast/introducing-alchemy-with-lawrence-principe/',
  'https://shwep.net/podcast/matteo-martelli-on-the-pseudo-democritus/',
  'https://shwep.net/podcast/numerical-mysteries-nichomachus-of-gerasa-arithmology-and-second-century-neopythagoreanism/',
  'https://shwep.net/podcast/claudius-ptolemy-and-the-tetrabiblos/',
  'https://shwep.net/podcast/the-astrology-of-vettius-valens/',
  'https://shwep.net/podcast/the-orthodox-gnostic-introducing-clement-of-alexandria/',
  'https://shwep.net/podcast/mystagogic-patchwork-esoteric-writing-in-clements-stromateis/',
  'https://shwep.net/podcast/the-writings-of-clement-of-alexandria/',
  'https://shwep.net/podcast/henny-fiska-hagg-on-clements-apophatic-writing/',
  'https://shwep.net/podcast/becoming-gods-divinisation-and-angelomorphic-transformation-in-clement/',
  'https://shwep.net/podcast/lifting-the-veil-esoteric-reading-in-clements-stromateis/',
  'https://shwep.net/podcast/the-third-century-and-the-long-late-antiquity/',
  'https://shwep.net/podcast/from-word-to-silence-the-rise-of-the-apophatic-in-late-antiquity/',
  'https://shwep.net/podcast/storytime-exploring-book-v-of-the-stromateis/',
  'https://shwep.net/podcast/speaking-the-silence-on-reading-apophatic-language/',
  'https://shwep.net/podcast/aron-reppmann-introduces-origen-of-alexandria/',
  'https://shwep.net/podcast/aron-reppmann-on-origen-castration-rejection-and-redemption/',
  'https://shwep.net/podcast/the-true-account-celsus-origen-and-ideological-esotericism-in-late-antiquity/',
  'https://shwep.net/podcast/an-antidote-to-esotericism-karen-ni-mheallaigh-on-lucian-of-samosata/',
  'https://shwep.net/podcast/total-war-polemical-esotericism-in-the-contra-celsum/',
  'https://shwep.net/podcast/claire-hall-on-prophecy-in-origen/',
  'https://shwep.net/podcast/brian-copenhaver-on-the-hermetica/',
  'https://shwep.net/podcast/professor-christian-wildberg-on-emending-the-corpus-hermeticum/',
  'https://shwep.net/podcast/m-david-litwa-on-deification-in-the-hermetica/',
  'https://shwep.net/podcast/thrice-greatest-hermes/',
  'https://shwep.net/podcast/philhellenism-and-the-egyptian-other-wouter-hanegraaff-on-reading-the-hermetica/',
  'https://shwep.net/podcast/corpus-hermeticum-i-the-poimandres/',
  'https://shwep.net/podcast/wouter-hanegraaff-on-the-poimandres/',
  'https://shwep.net/podcast/christian-bull-on-the-way-of-hermes-in-antiquity/',
  'https://shwep.net/podcast/other-hermetic-worlds-the-asclepius-and-kore-kosmou/',
  'https://shwep.net/podcast/storytime-reading-the-corpus-hermeticum-part-i/',
  'https://shwep.net/podcast/silent-encounters-the-esoteric-in-the-ancient-hermetica/',
  'https://shwep.net/podcast/anna-van-den-kerchove-on-the-hermetic-way-in-antiquity/',
  'https://shwep.net/podcast/storytime-reading-the-corpus-hermeticum-part-ii/',
  'https://shwep.net/podcast/storytime-reading-the-corpus-hermeticum-part-iii/',
  'https://shwep.net/podcast/litwa-expands-on-the-hermetic-reception/',
  'https://shwep.net/podcast/anna-van-den-kerchove-hermeticises-further/',
  'https://shwep.net/podcast/storytime-exploring-book-v-of-the-stromateis-part-ii/',
  'https://shwep.net/podcast/the-philosopher-of-our-time-introducing-plotinus/',
  'https://shwep.net/podcast/matthew-neujahr-on-the-sibylline-oracles/',
  'https://shwep.net/podcast/was-plotinus-a-platonist-lineage-identity-and-scholarship/',
  'https://shwep.net/podcast/we-are-the-one-plotinus-participatory-metaphysics/',
  'https://shwep.net/podcast/mateusz-strozynski-on-spiritual-practices-in-plotinus/',
  'https://shwep.net/podcast/ascending-further-with-mateusz-strozynski/',
  'https://shwep.net/podcast/plotinus-the-magician-ritual-practice-and-power-in-platonism/',
  'https://shwep.net/podcast/dylan-burns-on-sethian-gnosticism/',
  'https://shwep.net/podcast/dylan-burns-ascends-to-the-pleroma/',
  'https://shwep.net/podcast/jean-marc-narbonne-on-plotinus-in-dialogue-with-the-gnostics/',
  'https://shwep.net/podcast/the-esoteric-plotinus-part-i-philosophic-silence-and-esoteric-reading/',
  'https://shwep.net/podcast/plotinus-on-astrology-with-marilynn-lawrence/',
  'https://shwep.net/podcast/the-esoteric-plotinus-part-ii-unsaying-the-real/',
  'https://shwep.net/podcast/marilynn-lawrence-casts-the-chart/',
  'https://shwep.net/podcast/the-secret-life-of-the-undescended-self/',
  'https://shwep.net/podcast/the-secret-life-of-the-one/',
  'https://shwep.net/podcast/ammonius-origen-and-plotinus-exploring-an-enigma/',
  'https://shwep.net/podcast/mysteries-of-the-rock-born-god-the-roman-cult-of-mithras/',
  'https://shwep.net/podcast/mithras-and-the-stars-astral-elements-in-the-cult-of-mithras/',
  'https://shwep.net/podcast/radcliffe-g-edmonds-iii-on-the-mithrasliturgie/',
  'https://shwep.net/podcast/into-the-otherworld-with-radcliffe-g-edmonds-iii/',
  'https://shwep.net/podcast/sarah-iles-johnston-on-hekate/',
  'https://shwep.net/podcast/jason-beduhn-on-mani-and-manichaeism/',
  'https://shwep.net/podcast/jason-beduhn-separates-the-light-from-the-darkness/',
  'https://shwep.net/podcast/charles-m-stang-on-the-divine-double-in-late-antiquity/',
  'https://shwep.net/podcast/charles-m-stang-doubles-down/',
  'https://shwep.net/podcast/poet-philosopher-hierophant-introducing-porphyry-of-tyre/',
  'https://shwep.net/podcast/porphyry-and-the-barbarians-ethnicity-religious-practice-and-esoteric-interpretation/',
  'https://shwep.net/podcast/storytime-a-cavern-pleasant-though-involvd-in-night-reading-porphyrys-on-the-cave-of-the-nymphs-part-i/',
  'https://shwep.net/podcast/porphyrys-gods-the-metaphysics-and-physics-of-divinity/',
  'https://shwep.net/podcast/dorian-greenbaum-on-porphyry-and-astrology/',
  'https://shwep.net/podcast/nilufer-akcay-on-porphyrys-on-the-cave-of-the-nymphs/',
  'https://shwep.net/podcast/storytime-a-cavern-pleasant-though-involvd-in-night-reading-porphyrys-on-the-cave-of-the-nymphs-part-ii/',
  'https://shwep.net/podcast/noetic-triads-and-lost-palimpsests-introducing-the-anonymous-commentary-on-the-parmenides/',
  'https://shwep.net/podcast/methodologies-for-studying-the-subtle-body/',
  'https://shwep.net/podcast/the-anonymous-commentary-on-the-parmenides-porphyry-and-the-sethian-gnostics/',
  'https://shwep.net/podcast/soul-flight-noetic-bodies-and-pneumatic-vehicles-toward-a-history-of-the-platonist-subtle-body/',
  'https://shwep.net/podcast/a-word-to-conjure-with-on-theurgy-in-late-antiquity-and-beyond/',
  'https://shwep.net/podcast/the-greek-iatromanteis-katabasis-metempsychosis-soul-flight-and-the-question-of-shamanism/',
  'https://shwep.net/podcast/the-theory-of-the-soul-vehicle-in-late-antique-platonism-and-islamicate-medical-sciences/',
  'https://shwep.net/podcast/astral-accretions-fate-and-the-resurrection-body-other-subtle-bodies-of-antiquity/',
  'https://shwep.net/podcast/introducing-iamblichus-of-chalcis/',
  'https://shwep.net/podcast/esoteric-hermeneutics-divine-hierarchy-and-the-ineffable-the-philosophy-of-iamblichus/',
  'https://shwep.net/podcast/the-greater-kinds-souls-and-kosmos-introducing-iamblichus-philosophy-part-ii/',
  'https://shwep.net/podcast/ivan-miroshnikov-on-the-gospel-of-thomas-part-i/',
  'https://shwep.net/podcast/ivan-miroshnikov-on-the-gospel-of-thomas-part-ii/',
  'https://shwep.net/podcast/the-esoteric-iamblichus/',
  'https://shwep.net/podcast/storytime-reading-eunapius-of-sardis-lives-of-philosophers-and-sophists/',
  'https://shwep.net/podcast/the-great-theurgy-debate-porphyrys-letter-to-anebo-iamblichus-response-and-the-questions-of-ritual/',
  'https://shwep.net/podcast/john-finamore-on-iamblichean-theurgy-in-theory-and-practice/',
  'https://shwep.net/podcast/john-finamore-ascends-to-the-noetic-triad-while-still-in-the-body/',
  'https://shwep.net/podcast/gregory-shaw-on-the-phenomenology-of-iamblichean-theurgy/',
  'https://shwep.net/podcast/gregory-shaw-briefly-divinises-the-soul/',
  'https://shwep.net/podcast/danielle-layne-on-synthemata-late-platonist-ritual-praxis-and-weird-platonism-2/',
  'https://shwep.net/podcast/brian-alt-on-sacred-materials-divine-names-and-subtle-physiology-in-iamblichean-theurgy/',
  'https://shwep.net/podcast/brian-alt-on-iamblichus-late-antique-egypt-and-ritual/',
  'https://shwep.net/podcast/run-the-numbers-the-theology-of-arithmetic/',
  'https://shwep.net/podcast/politics-and-religion-in-late-antiquity-part-i-geopolitics-empire-and-rabbinic-judaism/',
  'https://shwep.net/podcast/politics-and-religion-in-late-antiquity-part-ii-the-rise-of-christianity-and-the-invention-and-eclipse-of-paganism/',
  'https://shwep.net/podcast/platos-cratylus-esoteric-etymology-and-the-language-of-the-gods/',
  'https://shwep.net/podcast/thinking-through-monotheism-henotheism-polytheism-and-dualism-in-late-antiquity/',
  'https://shwep.net/podcast/the-ascension-of-isaiah-and-the-second-century-christian-esoteric/',
  'https://shwep.net/podcast/gideon-bohak-on-late-antique-jewish-magic/',
  'https://shwep.net/podcast/daniel-james-waller-on-the-jewish-incantation-bowls/',
  'https://shwep.net/podcast/daniel-waller-bowls-on/',
  'https://shwep.net/podcast/curses-sarah-veale-on-roman-curse-tablets/',
  'https://shwep.net/podcast/beyond-curse-tablets-with-sarah-veale/',
  'https://shwep.net/podcast/exploring-the-sefer-ha-razim/',
  'https://shwep.net/podcast/the-testament-of-solomon-and-the-solomonic-tradition/',
  'https://shwep.net/podcast/the-testament-of-solomon-and-the-solomonic-tradition-part-ii/',
  'https://shwep.net/podcast/prolegomena-to-christian-magic/',
  'https://shwep.net/podcast/jesus-the-magician-interrogating-ancient-and-modern-discourses-of-ritual-power-in-the-gospels/',
  'https://shwep.net/podcast/the-esoteric-new-testament-part-i-the-gospel-of-mark/',
  'https://shwep.net/podcast/the-esoteric-new-testament-part-ii-paul-and-the-mysteries/',
  'https://shwep.net/podcast/korshi-dosoo-on-early-christian-magic/',
  'https://shwep.net/podcast/the-esoteric-new-testament-part-iii-john-and-apocalypse/',
  'https://shwep.net/podcast/into-coptic-magic-with-korshi-dosoo-2/',
  'https://shwep.net/podcast/paul-pasquesi-on-christian-asceticism-in-the-late-antique-syriac-world/',
  'https://shwep.net/podcast/into-syriac-spirituality-in-theory-and-practice-with-paul-pasquesi/',
  'https://shwep.net/podcast/charles-haberl-on-the-mandaeans/',
  'https://shwep.net/podcast/into-the-light-worlds-with-charles-haberl/',
  'https://shwep.net/podcast/approaches-to-the-question-of-early-christian-esotericism/',
  'https://shwep.net/podcast/father-sergey-trostyanskiy-on-the-cappadocian-fathers-part-i/',
  'https://shwep.net/podcast/matteo-martelli-introduces-zosimus-of-panopolis/',
  'https://shwep.net/podcast/matteo-martelli-perfects-the-tincture/',
  'https://shwep.net/podcast/recognising-the-real-in-the-forgery-the-pseudo-clementine-literature/',
  'https://shwep.net/podcast/metals-temples-and-living-statues-shannon-grimes-on-zosimus-egyptian-context/',
  'https://shwep.net/podcast/bink-hallum-on-the-extended-zosimus/',
  'https://shwep.net/podcast/bink-hallum-on-zosimus-arabicus-the-final-quittance/',
  'https://shwep.net/podcast/claire-hall-on-firmicus-maternus/',
  'https://shwep.net/podcast/kocku-von-stuckrad-on-monotheist-astrologies-in-late-antiquity/',
  'https://shwep.net/podcast/joel-kalvesmaki-on-evagrius-of-pontus-the-gnostic-trilogy-and-the-origenist-controversy/',
  'https://shwep.net/podcast/storytime-reading-zosimus-of-panopolis-the-final-accounting/',
  'https://shwep.net/podcast/storytime-reading-zosimus-of-panopolis-on-the-letter-omega/',
  'https://shwep.net/podcast/storytime-reading-the-visions-of-zosimus/',
  'https://shwep.net/podcast/sergey-trostyanskiy-on-the-cappadocian-fathers-part-ii/',
  'https://shwep.net/podcast/theology-politics-and-radiant-darkness-michael-motia-on-gregory-of-nyssa/',
  'https://shwep.net/podcast/into-the-darkness-with-michael-motia/',
  'https://shwep.net/podcast/joel-kalvesmaki-on-evagrius-kephalaia-gnostika-philosophy-scripture-and-apophatic-mysticism/',
  'https://shwep.net/podcast/jeremy-swist-on-the-emperor-julian-part-i-the-political-background-and-political-project-of-the-emperor/',
  'https://shwep.net/podcast/jeremy-swist-on-julian-part-ii-the-emperors-religio-philosophic-project/',
  'https://shwep.net/podcast/strategies-of-the-esoteric-in-the-hellenism-of-the-emperor-julian-exclusion-and-pluralism-in-a-late-antique-polytheism/',
  'https://shwep.net/podcast/frederico-fidler-on-sallustius-on-the-gods-and-the-world/',
  'https://shwep.net/podcast/storytime-reading-eunapius-part-ii-the-emperor-and-the-thaumaturge/',
  'https://shwep.net/podcast/visibly-a-goddess-heidi-marx-on-sosipatra-of-pergamum/',
  'https://shwep.net/podcast/storytime-reading-eunapius-part-iii-the-diviners-purge-and-the-end-of-the-theurgic-revolution/',
  'https://shwep.net/podcast/gretchen-reydams-schils-on-calcidius-and-the-timaeus/',
  'https://shwep.net/podcast/and-when-rome-falls-falls-the-world-the-fall-of-rome-and-western-esotericism/',
  'https://shwep.net/podcast/hypatia-of-alexandria-the-life-and-death-of-a-philosopher-and-her-city/',
  'https://shwep.net/podcast/jay-bregman-on-synesius-of-cyrene/',
  'https://shwep.net/podcast/storytime-reading-synesius-on-dreams/',
  'https://shwep.net/podcast/noble-lies-and-philosophic-silence-hypatia-synesius-and-the-new-esotericism-in-the-fourth-century/',
  'https://shwep.net/podcast/plato-latinus/',
  'https://shwep.net/podcast/stephen-a-cooper-on-marius-victorinus-and-latinate-christian-platonism/',
  'https://shwep.net/podcast/david-hernandez-de-la-fuente-on-nonnus-of-panopolis/',
  'https://shwep.net/podcast/stephen-cooper-on-marius-victorinus-philosophy-panpsychism-and-a-modern-religious-platonism/',
  'https://shwep.net/podcast/the-manichaean-catholic-augustine-of-hippo/',
  'https://shwep.net/podcast/augustine-of-hippo-saint-of-the-exoteric/',
  'https://shwep.net/podcast/macrobius-and-the-commentary-on-scipios-dream/',
  'https://shwep.net/podcast/mateusz-strozynski-on-augustine-and-platonism/',
  'https://shwep.net/podcast/mateusz-strozynski-on-spiritual-practices-in-augustine/',
  'https://shwep.net/podcast/poseidonius-of-rhodes-weird-stoicism-and-cosmic-religion/',
  'https://shwep.net/podcast/storytime-reading-ciceros-dream-of-scipio/',
  'https://shwep.net/podcast/%e2%86%84-martiana-on-martianus-capella-and-the-marriage-of-philologia-and-mercury/',
  'https://shwep.net/podcast/%e2%86%84-martiana-rises-to-the-occasion/',
  'https://shwep.net/podcast/storytime-reading-macrobius-commentary-on-the-dream-of-scipio-part-i/',
  'https://shwep.net/podcast/storytime-reading-macrobius-commentary-on-the-dream-of-scipio-part-ii/',
  'https://shwep.net/podcast/the-great-god-pan-lives-introducing-the-athenian-academy/',
  'https://shwep.net/podcast/hierocles-of-alexandria-and-the-pythagorean-golden-verses/',
  'https://shwep.net/podcast/storytime-reading-hierocles-on-the-golden-verses-part-i/',
  'https://shwep.net/podcast/storytime-reading-hierocles-on-the-golden-verses-part-ii/',
  'https://shwep.net/podcast/dylan-burns-on-proclus-the-successor/',
  'https://shwep.net/podcast/graeme-miles-on-proclus-the-commentator/',
  'https://shwep.net/podcast/the-esoteric-proclus-part-i-the-life-and-thought-of-an-esoteric-sage/',
  'https://shwep.net/podcast/danielle-layne-on-proclus-religious-life-and-thought/',
  'https://shwep.net/podcast/dylan-burns-with-the-noetic-fire-on-proclus-and-christianity/',
  'https://shwep.net/podcast/the-esoteric-proclus-part-ii-esoteric-exegesis-and-the-occult-ontology-of-language/',
  'https://shwep.net/podcast/edward-butler-on-proclus-part-i-henadology/',
  'https://shwep.net/podcast/edward-butler-on-proclus-part-ii-on-the-metaphysics-of-polytheism-and-monotheism/',
  'https://shwep.net/podcast/stephen-rego-on-the-nous-in-proclus-part-i-exegesis/',
  'https://shwep.net/podcast/stephen-rego-on-the-nous-in-proclus-part-ii-metaphysics-and-myth/',
  'https://shwep.net/podcast/edward-watts-on-the-age-of-justinian-and-the-closing-of-the-athenian-academy/',
  'https://shwep.net/podcast/kevin-van-bladel-on-the-%e1%b9%a3abians-of-%e1%b8%a5arran-and-the-fate-of-the-athenian-academy/',
  'https://shwep.net/podcast/hagia-sophia-and-the-problem-of-esoteric-architecture/',
  'https://shwep.net/podcast/robbert-van-den-berg-on-proclus-hymns/',
  'https://shwep.net/podcast/joseph-sanzo-on-magic-and-confessional-boundaries-in-late-antiquity/',
  'https://shwep.net/podcast/all-from-nothing-sara-rappe-on-damascius/',
  'https://shwep.net/podcast/naming-divine-nothingness-introducing-the-pseudo-dionysios/',
  'https://shwep.net/podcast/one-empire-many-names-reading-byzantium-with-anthony-kaldellis/',
  'https://shwep.net/podcast/the-last-platonists-philosophic-teaching-christianity-and-polytheism-in-late-antique-alexandria/',
  'https://shwep.net/podcast/contested-esotericisms-at-the-end-of-antiquity-simplicius-philoponus-and-olympiodorus/',
  'https://shwep.net/podcast/storytime-reading-damascius-philosophic-history-part-i-text-context-and-themes/',
  'https://shwep.net/podcast/michael-griffin-on-the-higher-virtues-in-late-platonism/',
  'https://shwep.net/podcast/storytime-reading-damascius-philosophic-history-part-ii-theurgy-and-philosophy-at-late-antique-athens-and-alexandria/',
  'https://shwep.net/podcast/storytime-reading-damascius-philosophic-history-part-iii-the-breaking-of-the-golden-chain/',
  'https://shwep.net/podcast/an-apollonian-man-plato-at-the-end-of-antiquity-in-the-anonymous-prolegomena/',
  'https://shwep.net/podcast/the-pseudo-dionysios-the-esoteric-and-christian-mysticism/',
  'https://shwep.net/podcast/unsaying-the-divine-darkness-exploring-dionysian-apophasis-and-mysticism/',
  'https://shwep.net/podcast/fake-apostles-and-real-christianity-exploring-the-pseudo-in-the-pseudo-dionysios/',
  'https://shwep.net/podcast/paul-pasquesi-on-the-book-of-the-holy-hierotheos/',
  'https://shwep.net/podcast/introducing-islam/',
  'https://shwep.net/podcast/matthew-melvin-koushki-on-islam-the-west-and-western-esotericism/',
  'https://shwep.net/podcast/westward-ho-with-matthew-melvin-koushki/',
  'https://shwep.net/podcast/fred-donner-on-the-history-of-early-islam/',
  'https://shwep.net/podcast/fred-donner-on-the-history-of-the-history-of-early-islam/',
  'https://shwep.net/podcast/introducing-the-quran-part-i-revelation-text-and-history/',
  'https://shwep.net/podcast/introducing-the-quran-part-ii-ambiguity-and-esoteric-themes/',
  'https://shwep.net/podcast/introducing-the-quran-part-iii-quranic-texts-vs-the-quran/',
  'https://shwep.net/podcast/seventh-century-history-for-students-of-western-esotericism/',
  'https://shwep.net/podcast/ahab-bdaiwi-on-ali-ibn-abi-%e1%b9%adalib-his-family-and-the-origins-of-shii-islam/',
  'https://shwep.net/podcast/ahab-bdaiwi-on-the-rise-of-shii-esotericism/',
  'https://shwep.net/podcast/touraj-daryaee-on-zoroastrianism-in-the-seventh-century-and-beyond/',
  'https://shwep.net/podcast/jewish-apocalypse-in-the-seventh-century-martha-himmelfarb-on-the-sefer-zerubbabel/',
  'https://shwep.net/podcast/introducing-the-apocalypse-of-the-pseudo-methodios-with-christopher-bonura/',
  'https://shwep.net/podcast/esoteric-orthodoxy-in-east-rome-jonathan-greig-on-maximus-the-confessor/',
  'https://shwep.net/podcast/jonathan-greig-on-the-question-of-universal-salvation-in-maximus/',
  'https://shwep.net/podcast/philosophy-and-occult-sciences-at-constantinople-maria-papathanassiou-on-stephanos-of-alexandria-part-i/',
  'https://shwep.net/podcast/the-horoscope-of-islam-and-the-alchemical-stone-maria-papathanassiou-on-stephanos-of-alexandria-part-ii/',
];

// Real browser user agents
const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
];

function randomDelay(minMs, maxMs) {
  return new Promise(resolve => setTimeout(resolve, minMs + Math.random() * (maxMs - minMs)));
}

function pickUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function extractCitedWorks(html) {
  const works = new Set();
  const italicRegex = /<(?:em|i)>([^<]{3,80})<\/(?:em|i)>/gi;
  let m;
  while ((m = italicRegex.exec(html)) !== null) {
    const text = m[1].replace(/<[^>]+>/g, '').trim();
    if (text.length < 3 || text.length > 80) continue;
    if (/^(here|this|that|click|read more|listen|see|note|episode|podcast|shwep|http|www\.|the |a |an )/i.test(text)) continue;
    if (/\.(com|org|net|html|php)/i.test(text)) continue;
    if (/^\d+$/.test(text)) continue;
    works.add(text);
  }
  return [...works];
}

function loadAlreadyCrawled() {
  const done = new Set();
  if (existsSync(OUTPUT)) {
    const lines = readFileSync(OUTPUT, 'utf8').trim().split('\n');
    for (const line of lines) {
      try { const ep = JSON.parse(line); if (ep.n !== undefined) done.add(ep.n); } catch {}
    }
  }
  return done;
}

async function main() {
  const done = loadAlreadyCrawled();
  console.log(`Output: ${OUTPUT}`);
  console.log(`Already crawled: ${done.size}, total episodes: ${EPISODE_URLS.length}`);

  let success = 0, fail = 0, skip = 0;

  // Start from most recent episodes (we already have 0-44, 133-214 from earlier crawls)
  for (let n = EPISODE_URLS.length - 1; n >= 0; n--) {
    if (done.has(n)) { skip++; continue; }

    // Human-like delay (8-25s between requests, longer every ~10 episodes)
    if (success + fail > 0) {
      const isBreak = (success + fail) % 10 === 0;
      const delay = isBreak ? (30000 + Math.random() * 30000) : (8000 + Math.random() * 17000);
      if (isBreak) console.log(`  [break: ${(delay/1000).toFixed(0)}s]`);
      await randomDelay(delay, delay);
    }

    const url = EPISODE_URLS[n];
    process.stdout.write(`Ep ${n}: `);

    try {
      const resp = await fetch(url, {
        headers: {
          'User-Agent': pickUA(),
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'Connection': 'keep-alive',
          'Referer': 'https://shwep.net/podcast/',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
        },
        redirect: 'follow',
      });

      if (!resp.ok) {
        console.log(`${resp.status}`);
        fail++;
        writeFileSync(OUTPUT, (existsSync(OUTPUT) && readFileSync(OUTPUT,'utf8').length > 0 ? '\n' : '') +
          JSON.stringify({ n, status: resp.status, citedWorks: [], error: `HTTP ${resp.status}` }), { flag: 'a' });
        continue;
      }

      const html = await resp.text();
      const citedWorks = extractCitedWorks(html);

      const titleMatch = html.match(/<h1[^>]*>(.*?)<\/h1>/s) || html.match(/<title>(.*?)(?:\s*[-–|].*)?<\/title>/);
      const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : '';

      const record = { n, title, url, citedWorks, status: resp.status };
      writeFileSync(OUTPUT, (existsSync(OUTPUT) && readFileSync(OUTPUT,'utf8').length > 0 ? '\n' : '') +
        JSON.stringify(record), { flag: 'a' });

      console.log(`OK "${title.slice(0, 60)}" — ${citedWorks.length} cited`);
      success++;
    } catch (err) {
      console.log(`ERR: ${err.message}`);
      fail++;
      writeFileSync(OUTPUT, (existsSync(OUTPUT) && readFileSync(OUTPUT,'utf8').length > 0 ? '\n' : '') +
        JSON.stringify({ n, citedWorks: [], error: err.message }), { flag: 'a' });
    }
  }

  console.log(`\nDone! Success: ${success}, Failed: ${fail}, Skipped (already done): ${skip}`);
}

main().catch(e => { console.error(e); process.exit(1); });
