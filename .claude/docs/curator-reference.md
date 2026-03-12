# Curator Reference Material

Reference data for the `/curator` skill. Read this file on-demand when doing research or building import scripts — it is NOT loaded into every conversation.

## Thematic Focus

### Primary Collections
| Collection | Key Authors/Texts |
|------------|-------------------|
| **Hermetica** | Corpus Hermeticum, Ficino, Trismegistus tradition |
| **Alchemy** | Paracelsus, Theatrum Chemicum, Valentine, Sendivogius |
| **Kabbalah** | Pico, Reuchlin, Knorr von Rosenroth |
| **Rosicrucianism** | Manifestos, Andreae, Fludd |
| **Theosophy** | Boehme, Gichtel, Pordage |
| **Natural Magic** | Agrippa, Della Porta, Bruno |

### Greek Classical Canon (Priority 1)
Goal: match the scope of the Loeb Classical Library's Greek half (~280 volumes, ~70 authors).

| Collection | Key Authors |
|------------|------------|
| **Epic Poetry** | Homer, Hesiod, Apollonius Rhodius |
| **Tragedy** | Aeschylus, Sophocles, Euripides |
| **Comedy** | Aristophanes, Menander |
| **History** | Thucydides, Herodotus, Polybius, Plutarch, Xenophon, Diodorus Siculus, Dio Cassius, Appian |
| **Philosophy** | Plato, Aristotle, Diogenes Laertius, Marcus Aurelius, Epictetus |
| **Oratory** | Demosthenes, Lysias, Isocrates |
| **Science/Medicine** | Hippocrates, Galen, Ptolemy, Euclid, Theophrastus, Archimedes |
| **Satire/Rhetoric** | Lucian, Athenaeus, Greek Anthology |
| **Geography** | Strabo, Pausanias |
| **Neoplatonic** | Plotinus, Proclus, Iamblichus, Porphyry, Pseudo-Dionysius |
| **Biblical/Patristic** | Septuagint, New Testament, Apostolic Fathers, Eusebius, Basil, Chrysostom |

**Edition priority for Greek:**
1. Original manuscripts (4th-15th c.) from Vatican, Cambridge, Bodleian, BnF
2. Greek-only critical editions: Teubner, OCT, Bekker
3. Loeb bilingual editions (pre-1929 = public domain)
4. 19th c. scholarly editions with commentary

**Key IA collections:**
- [Teubner Edition Collection](https://archive.org/details/Teubner-Edition-Collection) — 146 Greek critical texts
- [Loebolus project](https://ryanfb.xyz/loebolus) — ~277 PD Loeb volumes
- Loeb identifiers: `L{NNN}{AuthorTitle}` (e.g., `L170NHomerIliadI112`)

### Secondary Collections
- **Early Science** - Copernicus, Kepler, Newton
- **Neoplatonism** - Plotinus, Proclus, Florentine Academy
- **Emblemata** - Alciato, Atalanta Fugiens, Splendor Solis
- **Architecture** - Vitruvius, Palladio, sacred geometry
- **Esoteric Music** - Pythagorean harmony, musica universalis

### Esoteric Music Focus
| Theme | Key Authors/Texts |
|-------|-------------------|
| **Pythagorean** | Iamblichus, Nicomachus, Philolaus, Theon of Smyrna |
| **Ancient Greek** | Aristoxenus, Ptolemy Harmonics, Aristides Quintilianus |
| **Medieval** | Boethius De Musica, Augustine, Guido d'Arezzo, Macrobius |
| **Cosmic Harmony** | Kepler Harmonices, Fludd Monochord, Mersenne, Francesco Giorgio |
| **Renaissance** | Zarlino, Vincenzo Galilei, Glarean, Gaffurius, Praetorius |
| **Cross-Cultural** | Al-Farabi, Al-Kindi, Ikhwan al-Safa, Sufi sama traditions |

### Syriac & Armenian Collections (Priority 2)
| Collection | Key Authors/Texts |
|------------|-------------------|
| **Syriac Christianity** | Ephrem, Bardaisan, Isaac of Nineveh, Philoxenus |
| **Syriac Mysticism** | Pseudo-Dionysius (Syriac), Book of the Holy Hierotheos, Odes of Solomon, Hymn of the Pearl |
| **Syriac Apocrypha** | Cave of Treasures, Book of the Bee, Acts of Thomas, Pseudo-Methodios |
| **Armenian Historiography** | Agathangelos, Moses of Chorene, Elishe, Sebeos |
| **Armenian Theology** | Eznik of Kolb, Gregory of Narek, Nerses Shnorhali |
| **Armenian Philosophy** | David the Invincible, Philo in Armenian (Aucher ed.), Armenian Eusebius Chronicle |

**Edition priority for Syriac/Armenian:**
1. Original Syriac/Armenian (Grabar) text editions — Mechitarist/San Lazzaro Venice
2. 19th c. critical editions (Cureton, Wright, Budge, Bedjan, Bickell)
3. Latin translations by early Orientalists
4. French/German scholarly editions
5. NEVER import English-only translations when original text editions exist

### East Asian & Chinese Collections (Priority 3)
| Collection | Key Texts/Genres |
|------------|-----------------|
| **Cosmology & Divination** | I Ching commentaries, star charts, Five Elements astrology |
| **Daoist Canon** | Tao Te Ching, Zhuangzi, Daozang texts, inner alchemy (neidan) |
| **Buddhist Texts** | Dunhuang cave manuscripts, illustrated sutras, Diamond Sutra |
| **Natural Philosophy** | Bencao Gangmu, Tiangong Kaiwu, Shanhai Jing |
| **Art & Symbolism** | Mustard Seed Garden Manual, emblem books, Sancai Tuhui |

### Languages (priority order)
1. Latin, 2. Ancient Greek, 3. German, 4. English, 5. Italian, 6. French, 7. Dutch, 8. Syriac, 9. Armenian/Grabar, 10. Classical Chinese, 11. Arabic, 12. Hebrew

---

## Current Gaps (Priority)

### URGENT - Missing Key Authors
| Author | What We Need | Priority |
|--------|--------------|----------|
| **Thomas Vaughan** | Lumen de Lumine, Aula Lucis | HIGH |
| **Gichtel** | Theosophia Practica | HIGH |
| **Jane Lead** | Philadelphian Society works | MEDIUM |
| **Cudworth** | True Intellectual System | MEDIUM |

### Need More Coverage
| Author | Have | Need |
|--------|------|------|
| Boehme | 3 works | German originals, Aurora |
| Fludd | Complete Utriusque | Additional volumes |
| Dee | Monas | True Relation |
| Paracelsus | Opera Omnia | Individual treatises |

---

## Catalog & Library Sources

### Local Catalogs
- **BPH Catalog** (`data/bph_catalog.csv`) - 28,814 entries
- **IA Catalog** (`data/ia_catalog.csv`) - 9,000 entries

### Web Search Patterns
- Archive.org: `site:archive.org "Author Name" texts`
- Gallica: `site:gallica.bnf.fr "Author Name"`
- MDZ: `site:digitale-sammlungen.de "Author Name"`
- Wellcome: `site:wellcomecollection.org "Author Name"`
- Bodleian: `site:digital.bodleian.ox.ac.uk "Author Name"`
- Cambridge: search at https://cudl.lib.cam.ac.uk/
- Vatican: search at https://digi.vatlib.it/
- e-rara: `site:e-rara.ch "Author Name"`
- Europeana: search at https://www.europeana.eu/
- British Library: https://www.bl.uk/manuscripts/ (use generic IIIF import)
- Polona: https://polona.pl/ (use generic IIIF import)
- Biblissima: https://iiif.biblissima.fr/collections/ (find IIIF manifests)

### Greek Manuscript Search Patterns
- Vatican: browse `https://digi.vatlib.it/mss/Vat.gr` or `site:digi.vatlib.it "Author Name"`
- Cambridge CUDL Greek: `https://cudl.lib.cam.ac.uk/collections/greekmanuscripts` (425+ MSS)
- Bodleian: `site:digital.bodleian.ox.ac.uk "Barocci"`
- BnF: `Grec site:gallica.bnf.fr "Author Name"`
- Pinakes: `https://pinakes.irht.cnrs.fr/` — master catalog of all Greek manuscripts

### Armenian & Syriac Search Patterns
- IA: `creator:(Agathangelos OR "Moses of Chorene" OR Mechitarist) mediatype:(texts)`
- IA: `publisher:("San Lazzaro" OR "Mechitarist" OR "Venice Armenian") mediatype:(texts)`
- Gallica: `arménien site:gallica.bnf.fr`

---

## Greek Manuscript Libraries

| Library | Import API | Size | Browse URL |
|---------|-----------|------|------------|
| Vatican DigiVatLib | `/api/import/vatican` | ~4,200 Greek MSS | `digi.vatlib.it/mss/Vat.gr` |
| Cambridge CUDL | `/api/import/cambridge` | 425+ Greek MSS | `cudl.lib.cam.ac.uk/collections/greekmanuscripts` |
| Bodleian (Oxford) | `/api/import/bodleian` | 500+ Greek MSS | `digital.bodleian.ox.ac.uk/` |
| BnF/Gallica | `/api/import/gallica` | 3,000+ Greek MSS | `gallica.bnf.fr/` |
| BSB/MDZ Munich | `/api/import/mdz` | 600+ Greek MSS | `digitale-sammlungen.de/` |
| British Library | `/api/import/iiif` | 900+ Greek MSS | `bl.uk/manuscripts/` |
| Mount Sinai | `/api/import/iiif` | ~3,300 MSS | `codexsinaiticus.org/` |

**Shelfmark patterns:** `Vat.gr.{N}`, `Pal.gr.{N}`, `Barb.gr.{N}`, `Ott.gr.{N}`, `Urb.gr.{N}`, `Ross.{N}`, `Reg.gr.{N}`
**Cambridge MS ID format:** `MS-{COLLEGE}-{NUMBER}` (e.g., `MS-CCCC-00081`, `MS-ADD-01732`)
**Bodleian collections:** Barocci (242 MSS), Auct. T, Canon. Gr., D'Orville, Laud. Gr.

### Already Imported Greek Manuscripts
Vat.gr.1209 (Codex Vaticanus, 4th c.), MS-ADD-06594 (Codex Macedoniensis, 9th c.), Vat.gr.1 (Plato's Laws), Vat.gr.90 (Lucian), Urb.gr.61 (Theophrastus), Vat.gr.370 (Pseudo-Dionysius), Vat.gr.124 (Polybius), Vat.gr.1613 (Menologion), Vat.gr.126 (Thucydides), Vat.gr.1319 (Homer Iliad), Vat.gr.244 (Aristotle Organon), MS-GG-00002-00033 (Ptolemy/Euclid), MS-GONVILLE-AND-CAIUS-00050-00027 (Hippocratic Corpus), MS-GONVILLE-AND-CAIUS-00360-00587 (Galen)

### Next Targets (not yet imported)
- Bodleian: Barocci 87 (Aristotle), Barocci 131 (Plato), Auct. T.4.13 (Homer), MS. Canon. Gr. 97 (Ptolemy)
- Vatican: Vat.gr.218 (Plato Republic), Vat.gr.1594 (Pindar)
- BnF: Grec 1807 (Plato, 9th c.), Grec 2771 (Homer, 10th c.), Grec 2 (Gospels, 10th c.)
- British Library: Burney 86 (Plato), Add. 17210 (Thucydides), Royal 16.C.IV (Ptolemy)

---

## Armenian & Syriac Libraries

| Library | URL | Strengths |
|---------|-----|-----------|
| Mechitarist San Lazzaro (via IA) | archive.org | Definitive Armenian Grabar editions |
| Armenian Manuscripts Index | armenian-manuscripts-index.com | 2,579 MSS from 48 digital libraries |
| Cambridge CUDL Syriac | cudl.lib.cam.ac.uk/collections/syriac | 300+ Syriac MSS |
| British Library Syriac | bl.uk/manuscripts | Rich Syriac collection (Add., Or. series) |
| Vatican Syriac | digi.vatlib.it | Vat.sir. collection |
| BnF Syriac | gallica.bnf.fr | Fonds syriaque |

**Syriac texts already in collection:** Spicilegium Syriacum (Bardaisan), Hymn of the Soul/Pearl, Odes of Solomon, Cave of Treasures, Book of the Bee, Isaac of Nineveh, Carmina Nisibena, Apocryphal Acts of the Apostles, Philoxenus

---

## East Asian IIIF Libraries

| Library | Strengths |
|---------|-----------|
| Library of Congress | 2,000+ Chinese rare books, Yongle Dadian (41 vols) |
| Harvard-Yenching | 9,600+ Chinese rare books (13th-19th c.) |
| National Palace Museum Taipei | 690,000+ items, open access since 2015 |
| Waseda University | 300,000 Chinese/Japanese classics |
| National Diet Library Japan | 340,000 IIIF manifests |
| IDP / British Library | 538,821 Dunhuang manuscript images |
| Princeton East Asian | Gest Collection |
| Cambridge CUDL | 500,000 Chinese titles, Yongle Dadian fragments |

### High-Priority Illustrated Chinese Texts
| Text | Period | Best Source |
|------|--------|-------------|
| Shanhai Jing | Ming (1628) | LOC |
| Tiangong Kaiwu | 1637 | LOC |
| Bencao Gangmu | 1590 | Wellcome / LOC |
| Mustard Seed Garden Manual | 1679-1701 | IA |
| Diamond Sutra | 868 CE | IDP |
| Wubei Zhi | 1621 | LOC |
| Sancai Tuhui | 1609 | Already in collection |

---

## Additional IIIF Libraries (use generic IIIF import)

British Library, National Library of Israel, Polona (Poland), Austrian National Library (850k items), Leiden University (6,500 Islamic MSS), e-codices (Swiss MSS), Princeton (10k Islamic MSS), Harvard (Houghton alchemy), Qatar Digital Library, Biblissima (IIIF aggregator)

---

## Post-Import Workflow

After importing, books are automatically enrolled in the processing pipeline by the `post-import-pipeline` cron. No manual action needed for:
- Image archiving (handled by Hetzner script + pipeline)
- OCR (Lambda workers)
- Translation (Lambda FIFO workers)
- Summary/index generation
- Image extraction

For faster archiving of large batches, use the Hetzner server:
```bash
ssh root@46.224.122.120 "cd /root/thumbnails && nohup bash run-archive.sh > archive.log 2>&1 &"
```
