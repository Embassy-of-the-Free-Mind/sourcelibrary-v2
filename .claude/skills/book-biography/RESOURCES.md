# Bibliographic Research Resources

Quick reference for digital libraries, catalogs, and scholarly tools.

## Digital Libraries

### Primary Sources

| Library | URL | Strengths | Import API |
|---------|-----|-----------|------------|
| **Internet Archive** | archive.org | Largest free collection, good pre-1928 | `/api/import/ia` |
| **Gallica (BnF)** | gallica.bnf.fr | French MSS, incunabula, Enlightenment | `/api/import/gallica` |
| **MDZ (BSB Munich)** | digitale-sammlungen.de | German/Latin, excellent early print | `/api/import/mdz` |
| **e-rara** | e-rara.ch | Swiss rare books, science, Reformation | Manual |
| **Google Books** | books.google.com | Pre-1928 scans, variable quality | Manual |
| **HathiTrust** | hathitrust.org | US libraries, good for 19th c. | Manual |

### Manuscript Collections

| Collection | URL | Focus |
|------------|-----|-------|
| **Biblissima** | portail.biblissima.fr | French medieval MSS portal |
| **BVMM** | bvmm.irht.cnrs.fr | French illuminated MSS |
| **Manuscripta Mediaevalia** | manuscripta-mediaevalia.de | German MSS catalogs |
| **DigiVatLib** | digi.vatlib.it | Vatican Library |
| **Parker Library** | parkerweb.stanford.edu | Corpus Christi Cambridge |
| **Cambridge Digital Library** | cudl.lib.cam.ac.uk | Cambridge collections |
| **Bodleian Digital** | digital.bodleian.ox.ac.uk | Oxford collections |

## Catalogs & Databases

### Short Title Catalogs

| Catalog | Coverage | URL |
|---------|----------|-----|
| **USTC** | European books 1450-1650 | ustc.ac.uk |
| **ISTC** | Incunabula (pre-1501) | data.cerl.org/istc |
| **VD16** | German books 1501-1600 | gateway-bayern.de/vd16 |
| **VD17** | German books 1601-1700 | vd17.de |
| **ESTC** | English books 1473-1800 | estc.bl.uk |
| **STCN** | Dutch books 1540-1800 | stcn.nl |

### Union Catalogs

| Catalog | Coverage | URL |
|---------|----------|-----|
| **WorldCat** | Global | worldcat.org |
| **CERL HPB** | European rare books | cerl.org/resources/hpb |
| **COPAC** | UK/Ireland | jisc.ac.uk/copac |
| **KVK** | German-speaking | kvk.bibliothek.kit.edu |

### Specialized Databases

| Database | Focus | URL |
|----------|-------|-----|
| **Iter** | Medieval/Renaissance | itergateway.org |
| **IMB** | Medieval bibliography | lib.byu.edu/imb |
| **Bibliographie der Buch- und Bibliotheksgeschichte** | Book history | bbb-online.de |

## Archive.org Search Syntax

```bash
# Basic search
curl -s "https://archive.org/advancedsearch.php?q=QUERY&output=json"

# By creator
curl -s "https://archive.org/advancedsearch.php?q=creator:(NAME)&output=json"

# By title
curl -s "https://archive.org/advancedsearch.php?q=title:(WORDS)&output=json"

# Combined
curl -s "https://archive.org/advancedsearch.php?q=creator:(AUTHOR)+AND+title:(TITLE)&output=json"

# With date range
curl -s "https://archive.org/advancedsearch.php?q=QUERY+AND+date:[1500+TO+1600]&output=json"

# Select fields and sort
curl -s "https://archive.org/advancedsearch.php?q=QUERY&fl[]=identifier&fl[]=title&fl[]=date&fl[]=creator&sort[]=date+asc&rows=50&output=json"
```

## Key Metadata Fields

### For Manuscripts

| Field | Description | Example |
|-------|-------------|---------|
| **Shelfmark** | Library location | Paris, BnF, grec 2518 |
| **Date** | When made | 1530-1539 |
| **Origin** | Where made | Venice |
| **Scribe** | Who copied | Ange Vergèce |
| **Patron** | Who commissioned | Francis I |
| **Support** | Material | Parchment / Paper |
| **Format** | Size | 137 × 198 mm |
| **Foliation** | Page structure | ff. I-III + 1-120 |
| **Binding** | Cover | Leather with gold tooling |
| **Provenance** | Ownership history | Ex libris, stamps |

### For Printed Books

| Field | Description | Example |
|-------|-------------|---------|
| **Title** | Full title page | Heronis Alexandrini Spiritalium liber |
| **Author** | Primary creator | Hero of Alexandria |
| **Editor/Translator** | Secondary | Federico Commandino (trans.) |
| **Place** | City of printing | Urbino |
| **Publisher/Printer** | Who printed | Domenico Frisolino |
| **Year** | Publication date | 1575 |
| **Format** | Page size | Folio / Quarto / Octavo |
| **Signatures** | Gatherings | A-Z⁴, Aa-Bb⁴ |
| **USTC/ESTC** | Catalog number | USTC 852412 |

## Latin Place Names

| Latin | Modern |
|-------|--------|
| Basileae | Basel |
| Lugduni | Lyon |
| Lutetiae / Parisiis | Paris |
| Coloniae | Cologne |
| Venetiis | Venice |
| Romae | Rome |
| Florentiae | Florence |
| Norimbergae | Nuremberg |
| Francofurti | Frankfurt |
| Argentorati | Strasbourg |
| Genevae | Geneva |
| Amstelodami | Amsterdam |
| Lugduni Batavorum | Leiden |
| Cantabrigiae | Cambridge |
| Oxoniae | Oxford |
| Londini | London |
| Witebergae | Wittenberg |
| Lipsiae | Leipzig |
| Hamburgi | Hamburg |
| Antverpiae | Antwerp |

## Standard Reference Works

### Textual Criticism
- **West, M.L.** *Textual Criticism and Editorial Technique* (1973)
- **Reynolds & Wilson** *Scribes and Scholars* (3rd ed. 1991)
- **Maas, Paul** *Textual Criticism* (1958)

### Codicology
- **Lemaire, J.** *Introduction à la codicologie* (1989)
- **Derolez, A.** *Codicologie des manuscrits en écriture humanistique* (1984)
- **Bischoff, B.** *Latin Palaeography* (1990)

### Book History
- **Febvre & Martin** *The Coming of the Book* (1976)
- **Eisenstein, E.** *The Printing Press as an Agent of Change* (1979)
- **Johns, A.** *The Nature of the Book* (1998)
- **Chartier, R.** *The Order of Books* (1994)

### Bibliography
- **Gaskell, P.** *A New Introduction to Bibliography* (1972)
- **Bowers, F.** *Principles of Bibliographical Description* (1949)
- **McKerrow, R.B.** *An Introduction to Bibliography* (1927)

## Critical Edition Series

| Series | Publisher | Focus |
|--------|-----------|-------|
| **Teubner** | De Gruyter | Greek & Latin classics |
| **Loeb Classical Library** | Harvard | Facing translation |
| **Oxford Classical Texts** | OUP | Critical Greek/Latin |
| **Budé** | Les Belles Lettres | French critical editions |
| **CSEL** | Austrian Academy | Church Fathers |
| **CCSL** | Brepols | Church Fathers |
| **CCCM** | Brepols | Medieval Latin |
| **Sources Chrétiennes** | Cerf | Patristics with French |
