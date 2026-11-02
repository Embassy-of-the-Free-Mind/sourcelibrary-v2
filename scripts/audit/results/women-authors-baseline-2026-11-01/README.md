# Women authors baseline (#7908) — 2026-11-01

Read-only. Wikidata P21 (sex or gender) ∈ {female Q6581072, trans woman Q1052281}, fetched for every `authors` doc with a `wikidata_id`; books joined on `books.author_id`. Produced by `scripts/audit/women-authors-baseline.mjs`.

## Authors

| | n |
|---|---:|
| authors (thesaurus) | 41991 |
| with a Wikidata QID | 17634 |
| **without a QID (gender unknown — coverage limit)** | 24357 |
| QID with no P21 statement | 321 |
| QID missing/deleted on Wikidata | 0 |
| **women** | **196** |
| women with ≥1 book | 191 |
| women with ≥1 live book | 86 |

## Books by women

| | n |
|---|---:|
| all (hidden included) | 893 |
| live (visible:true && pages_count>0) | 344 |
| hidden / not live | 549 |
| live and readable_in_english | 238 |
| readable_in_english, hidden included | 244 |

Denominators: 70942 live books; 59792 of them carry an author_id, and 37923 have an author with a QID — so the share of live books by women is at least 0.48% of all live books and 0.91% of those whose author is gender-resolvable.

**Coverage limit.** Books with no `author_id`, authors with no QID, and QIDs with no P21 are all *unknown*, not *not women*. Anonymous and institutional works are in that remainder by construction. Nothing was written to Mongo — no gender field (field-sprawl rule).

## What P21 says about the rest

Of the 17,634 QIDs, P21 reads male (Q6581097) for **17,114**, female for **196**, and something else for 2; 321 carry no P21. Among gender-resolvable authors, women are **1.1%**.

## The coverage limit, concretely

The count is a floor, and a low one, for three separate reasons, each seen on a named case. Christine de Pizan is not in it: her `authors` doc (`christine-de-pisan`) has no `wikidata_id`. Margaret Cavendish *is* counted as a woman (Q242640), but none of her 13 held books carries an `author_id`, so she shows zero books. Mary Astell and Lucrezia Marinella have no `authors` doc at all. The #7908 holdings checks found ~70 books by women already in the catalogue that this join could not see. Read the table as "women we can currently prove are women", not as "women we hold". Raising it means minting QIDs onto author docs (the existing thesaurus work), never a gender field.

## Women authors held (by books held)

| author | QID | books | live | hidden | live & readable in English |
|---|---|---:|---:|---:|---:|
| Annie Besant | Q464318 | 75 | 67 | 8 | 22 |
| Elizabeth Gaskell | Q229226 | 45 | 3 | 42 | 2 |
| Hildegard of Bingen | Q70991 | 45 | 3 | 42 | 3 |
| Jane Leade | Q273703 | 34 | 18 | 16 | 16 |
| Joanna Southcott | Q449005 | 30 | 29 | 1 | 29 |
| La Roche, Sophie von | Q62404 | 28 | 0 | 28 | 0 |
| Helena Blavatsky | Q189454 | 23 | 22 | 1 | 17 |
| Mary Baker Eddy | Q235069 | 21 | 21 | 0 | 20 |
| Naubert, Benedikte | Q817035 | 20 | 0 | 20 | 0 |
| Evelyn Underhill | Q454734 | 18 | 2 | 16 | 2 |
| Gottsched, Luise Adelgunde Victorie | Q65863 | 18 | 0 | 18 | 0 |
| Staël, Madame de | Q123041 | 18 | 0 | 18 | 0 |
| Murasaki Shikibu | Q81731 | 14 | 14 | 0 | 7 |
| Antoinette Bourignon | Q270552 | 13 | 10 | 3 | 9 |
| Gertrud von Helfta | Q61934 | 13 | 2 | 11 | 1 |
| Katherine Tingley | Q444496 | 13 | 13 | 0 | 5 |
| Maria Sibylla Merian | Q62530 | 12 | 7 | 5 | 3 |
| Birgitta, von Schweden, Heilige | Q204996 | 11 | 1 | 10 | 0 |
| Brun, Friederike | Q450985 | 11 | 0 | 11 | 0 |
| Grumbach, Argula von | Q109277 | 11 | 1 | 10 | 0 |
| Huber, Marie | Q117075 | 11 | 0 | 11 | 0 |
| Leprince de Beaumont, Jeanne-Marie | Q466788 | 10 | 0 | 10 | 0 |
| Du Noyer, Anne Marguerite Petit | Q537012 | 9 | 0 | 9 | 0 |
| Clara Jessup Moore | Q5126004 | 8 | 6 | 2 | 6 |
| Genlis, Stéphanie Félicité de | Q55037230 | 8 | 0 | 8 | 0 |
| Maria Antonia, Sachsen, Kurfürstin | Q61649 | 8 | 0 | 8 | 0 |
| Teresa of Ávila | Q174880 | 8 | 6 | 2 | 5 |
| 王充耘 (Wang Chongyun) | Q15955441 | 8 | 8 | 0 | 3 |
| Jeanne-Marie Guyon | Q235098 | 7 | 7 | 0 | 7 |
| Mabel Collins | Q435981 | 7 | 7 | 0 | 6 |
| Morgenstern-Schulze, Johanna Katharina | Q15429567 | 7 | 0 | 7 | 0 |
| Neuber, Friederike Caroline | Q68316 | 7 | 0 | 7 | 0 |
| Anna Maria van Schurman | Q255261 | 6 | 2 | 4 | 2 |
| Eleonora Maria Rosalia, Troppau und Jägerndorf, Herzogin | Q28445289 | 6 | 0 | 6 | 0 |
| La Motte, Jeanne de Saint-Rémy de Valois de | Q271278 | 6 | 0 | 6 | 0 |
| Proba, Faltonia Betitia | Q570034 | 6 | 1 | 5 | 1 |
| Somerville, Mary | Q268702 | 6 | 0 | 6 | 0 |
| Unzer, Johanne Charlotte | Q1458154 | 6 | 0 | 6 | 0 |
| Barbauld, Anna Letitia | Q268305 | 5 | 0 | 5 | 0 |
| Falques, Marianne Agnès | Q19630307 | 5 | 0 | 5 | 0 |
| Gomez, Madeleine-Angélique de | Q3275571 | 5 | 1 | 4 | 0 |
| Graffigny, Françoise de | Q449451 | 5 | 0 | 5 | 0 |
| Karolina Matilda, Dänemark, Königin | Q57668 | 5 | 0 | 5 | 0 |
| Katharina II., Russland, Zarin | Q36450 | 5 | 0 | 5 | 0 |
| Lafayette, Madame de | Q237090 | 5 | 0 | 5 | 0 |
| Mechtilde | Q68598 | 5 | 3 | 2 | 3 |
| Riccoboni, Marie Jeanne de Heurles Laboras de Mezières | Q3087936 | 5 | 0 | 5 | 0 |
| Adelheid, Bayern, Kurfürstin | Q242928 | 4 | 0 | 4 | 0 |
| Agnes Smith Lewis | Q1300112 | 4 | 4 | 0 | 4 |
| Angela of Foligno | Q240297 | 4 | 3 | 1 | 2 |
| Aulnoy, Marie Catherine Le Jumel de Barneville d' | Q260006 | 4 | 1 | 3 | 0 |
| Chavannes, Herminie | Q19996834 | 4 | 0 | 4 | 0 |
| Craven, Elizabeth | Q449738 | 4 | 0 | 4 | 0 |
| Karsch, Anna Luise | Q469571 | 4 | 0 | 4 | 0 |
| Montagu, Mary Wortley | Q235121 | 4 | 0 | 4 | 0 |
| Morata, Olympia Fulvia | Q272798 | 4 | 2 | 2 | 0 |
| Recke, Elisa von der | Q72451 | 4 | 0 | 4 | 0 |
| Reiske, Ernestine Christine | Q1356620 | 4 | 0 | 4 | 0 |
| Rieger, Magdalena Sibylla | Q1290857 | 4 | 0 | 4 | 0 |
| Robert, Anne | Q109832483 | 4 | 2 | 2 | 0 |
| Rosa Luxemburg | Q7231 | 4 | 4 | 0 | 1 |
| Wiesenhütten, Friederike Henriette von | Q71302887 | 4 | 0 | 4 | 0 |
| Anna Comnena | Q179284 | 3 | 1 | 2 | 1 |
| Clairon, Claire Josèphe Hippolyte Leris de LaTude | Q467141 | 3 | 0 | 3 | 0 |
| Graffenried, Maria von | Q55904420 | 3 | 0 | 3 | 0 |
| Julian of Norwich | Q236699 | 3 | 3 | 0 | 3 |
| Le Rebours, Marie Angelique | Q55912932 | 3 | 0 | 3 | 0 |
| Maintenon, Madame de | Q230670 | 3 | 0 | 3 | 0 |
| Mary Anne Atwood | Q6778933 | 3 | 3 | 0 | 3 |
| Pichler, Caroline | Q78814 | 3 | 0 | 3 | 0 |
| Sor Juana Inés de la Cruz | Q183074 | 3 | 3 | 0 | 3 |
| Ulliac Trémadeure, Sophie | Q18747185 | 3 | 0 | 3 | 0 |
| Villedieu, Marie Cathérine Hortense Desjardins de | Q464422 | 3 | 0 | 3 | 0 |
| Williams, Helen Maria | Q525710 | 3 | 0 | 3 | 0 |
| Agnesi, Maria Gaetana | Q200392 | 2 | 0 | 2 | 0 |
| Alice Getty | Q131099251 | 2 | 2 | 0 | 1 |
| Anna Kingsford | Q466175 | 2 | 2 | 0 | 2 |
| Berry, Marie-Caroline de Bourbon-Sicile de | Q234931 | 2 | 0 | 2 | 0 |
| Blackwell, Elizabeth | Q469844 | 2 | 0 | 2 | 0 |
| Catherine Crowe | Q2537956 | 2 | 2 | 0 | 2 |
| Catherine of Siena | Q229190 | 2 | 2 | 0 | 2 |
| Caumont de la Force, Charlotte-Rose de | Q2960934 | 2 | 0 | 2 | 0 |
| Devonshire, Georgiana Spencer Cavendish | Q235644 | 2 | 0 | 2 | 0 |
| Engel, Regula | Q2138725 | 2 | 0 | 2 | 0 |
| Fuchs, Anna Rupertina | Q19130654 | 2 | 0 | 2 | 0 |
| Germain, Sophie | Q7103 | 2 | 0 | 2 | 0 |
| Gugelberg von Moos, Hortensia | Q121697 | 2 | 0 | 2 | 0 |
| Helen | Q164061 | 2 | 2 | 0 | 2 |
| Isabella Bird | Q288210 | 2 | 2 | 0 | 2 |
| Kleinau, Elke | Q95189983 | 2 | 2 | 0 | 0 |
| Lilien, Traugott Christiane Dorothea | Q55874963 | 2 | 0 | 2 | 0 |
| María de Jesús, de Agreda | Q275907 | 2 | 0 | 2 | 0 |
| Marie de France | Q5617 | 2 | 2 | 0 | 2 |
| Mary Alicia Owen | Q15959807 | 2 | 2 | 0 | 2 |
| Mary Kingsley | Q235525 | 2 | 2 | 0 | 2 |
| Mechthild of Magdeburg | Q269687 | 2 | 2 | 0 | 1 |
| Necker, Albertine Adrienne | Q2375310 | 2 | 0 | 2 | 0 |
| Nemours, Marie d'Orléans-Longueville de | Q1825637 | 2 | 0 | 2 | 0 |
| Saint-Mars, Anne Gabrielle de Cisternes de Courtiras de Poilloüe de | Q2991068 | 2 | 0 | 2 | 0 |
| Sei Shōnagon (清少納言) | Q231603 | 2 | 2 | 0 | 1 |
| Sophia Eleonora, Braunschweig-Lüneburg, Herzogin | Q523207 | 2 | 0 | 2 | 0 |
| Titzenhofer, Sophie Eleonore von | Q1735663 | 2 | 0 | 2 | 0 |
| Anna Akhmatova | Q80440 | 1 | 1 | 0 | 1 |
| Anne Halkett | Q565358 | 1 | 1 | 0 | 1 |
| Aragon, Anne-Alexandrine | Q77752528 | 1 | 0 | 1 | 0 |
| Aubin, Penelope | Q7162560 | 1 | 0 | 1 | 0 |
| Augusta Marie, Baden-Durlach, Markgräfin | Q3629556 | 1 | 0 | 1 | 0 |
| Auneuil, Louise de Bossigny | Q3263850 | 1 | 0 | 1 | 0 |
| Baillie, Marianne | Q6762193 | 1 | 0 | 1 | 0 |
| Behaim, Anna Elisabeth | Q55902327 | 1 | 0 | 1 | 0 |
| Berlepsch, Emilie von | Q1337360 | 1 | 0 | 1 | 0 |
| Berthe Hoola van Nooten | Q4895535 | 1 | 1 | 0 | 1 |
| Birch-Pfeiffer, Charlotte | Q68117 | 1 | 0 | 1 | 0 |
| Bordas, Camille | Q2934870 | 1 | 0 | 1 | 0 |
| Bosboom-Toussaint, Anna Louisa Geertruida | Q446879 | 1 | 0 | 1 | 0 |
| Bötticher, Dorothea Elisabeth | Q55886507 | 1 | 0 | 1 | 0 |
| Caterina da Genova | Q240413 | 1 | 1 | 0 | 0 |
| Clotilde Chivas-Baron | Q90156741 | 1 | 1 | 0 | 1 |
| Colonna, Vittoria | Q255368 | 1 | 1 | 0 | 0 |
| Devonshire, Elizabeth Cavendish, Duchess of | Q449103 | 1 | 0 | 1 | 0 |
| Dorothea Ewart | Q28059962 | 1 | 1 | 0 | 1 |
| Droste-Hülshoff, Annette von | Q57307 | 1 | 0 | 1 | 0 |
| Du Boccage, Marie-Anne | Q2850913 | 1 | 0 | 1 | 0 |
| Eger, Susanna | Q2369042 | 1 | 0 | 1 | 0 |
| Egeria | Q275899 | 1 | 1 | 0 | 1 |
| Elisabeth I., England, Königin | Q7207 | 1 | 0 | 1 | 0 |
| Elisabeth, Baden-Durlach, Markgräfin | Q23055540 | 1 | 0 | 1 | 0 |
| Elisabeth, Braunschweig-Calenberg, Herzogin | Q542899 | 1 | 0 | 1 | 0 |
| Elizabeth Cady Stanton | Q465335 | 1 | 1 | 0 | 1 |
| Elsie Spicer Eells | Q24013832 | 1 | 1 | 0 | 1 |
| Emily Dickinson | Q4441 | 1 | 1 | 0 | 1 |
| Frances Densmore | Q469150 | 1 | 1 | 0 | 1 |
| Gail, Sophie | Q3490938 | 1 | 0 | 1 | 0 |
| Grace James | Q5591226 | 1 | 1 | 0 | 1 |
| Gräf, Sophia Regina | Q115738859 | 1 | 0 | 1 | 0 |
| Grignan, Françoise Marguerite de Sévigné de | Q3086647 | 1 | 0 | 1 | 0 |
| Gulbadan Begum | Q2041521 | 1 | 1 | 0 | 0 |
| H. Emilie Cady | Q3780336 | 1 | 1 | 0 | 1 |
| Hadewijch of Brabant | Q466290 | 1 | 1 | 0 | 1 |
| Halem, Elisabeth Augusta von | Q94758538 | 1 | 0 | 1 | 0 |
| Hannah Glasse | Q531876 | 1 | 1 | 0 | 1 |
| Harriet Jacobs | Q944063 | 1 | 1 | 0 | 1 |
| Harriette Wilson | Q4470056 | 1 | 1 | 0 | 1 |
| Hemans, Felicia Dorothea Browne | Q272537 | 1 | 0 | 1 | 0 |
| Holst, Amalia | Q105333 | 1 | 0 | 1 | 0 |
| Isabella, Österreich, Erzherzogin | Q169448 | 1 | 0 | 1 | 0 |
| Janet Ross | Q6153581 | 1 | 1 | 0 | 1 |
| Johanna, Navarra, Königin | Q229286 | 1 | 1 | 0 | 0 |
| Kate McCosh Clark | Q64731288 | 1 | 1 | 0 | 1 |
| Kitt, Katharina | Q63485440 | 1 | 0 | 1 | 0 |
| Krock, Anna Helene von | Q55882116 | 1 | 0 | 1 | 0 |
| La Rochejaquelein, Marie Louise Victorine de Donnissan de Lescure de | Q462516 | 1 | 0 | 1 | 0 |
| Lady Gregory | Q239540 | 1 | 1 | 0 | 1 |
| Lee, Sarah | Q2375893 | 1 | 0 | 1 | 0 |
| Louise Labé | Q237098 | 1 | 1 | 0 | 1 |
| Lubert, Marie-Madeleine de | Q3290779 | 1 | 0 | 1 | 0 |
| Mabel Cook Cole | Q6721426 | 1 | 1 | 0 | 1 |
| Mallès de Beaulieu, Jeanne Sylvie | Q3176169 | 1 | 0 | 1 | 0 |
| Margaret Alice Murray | Q242542 | 1 | 1 | 0 | 1 |
| Margaret Cavendish | Q242640 | 1 | 1 | 0 | 1 |
| Margarete, Frankreich, Königin | Q220845 | 1 | 1 | 0 | 0 |
| Margarete, Navarra, Königin | Q190058 | 1 | 1 | 0 | 0 |
| Marguerite Porete | Q255132 | 1 | 1 | 0 | 1 |
| Maria I., Portugal, Königin | Q773874 | 1 | 0 | 1 | 0 |
| Marie Meurdrac | Q3292690 | 1 | 1 | 0 | 1 |
| Marjory Wardrop | Q6766368 | 1 | 1 | 0 | 1 |
| Mira Bai | Q466330 | 1 | 0 | 1 | 0 |
| Morin, Claude M. | Q112376976 | 1 | 0 | 1 | 0 |
| Mother Shipton (attributed) | Q468124 | 1 | 1 | 0 | 1 |
| Müller, Wilhelmine | Q18916999 | 1 | 0 | 1 | 0 |
| Noldi Baden, Helena Adelgundis de | Q95651420 | 1 | 0 | 1 | 0 |
| Olive Bray | Q136451226 | 1 | 1 | 0 | 1 |
| Paoli, Betty | Q88749 | 1 | 0 | 1 | 0 |
| Perkins, Janet Russel | Q3892474 | 1 | 0 | 1 | 0 |
| Queen Sohye (commissioner) | Q624060 | 1 | 1 | 0 | 1 |
| Rohan, Marie E. de | Q88270089 | 1 | 0 | 1 | 0 |
| Rottenberg, Maria Dominica Josepha von | Q94889942 | 1 | 0 | 1 | 0 |
| Sale, Florentia Wynch | Q5460883 | 1 | 0 | 1 | 0 |
| Schwendendörffer, Anna Maria | Q18916655 | 1 | 0 | 1 | 0 |
| Seward, Anna | Q1131816 | 1 | 0 | 1 | 0 |
| Solms-Laubach, Benigna zu | Q94777993 | 1 | 0 | 1 | 0 |
| Stampa, Gaspara | Q466811 | 1 | 1 | 0 | 0 |
| Talvj | Q91989 | 1 | 0 | 1 | 0 |
| The Sibyl | Q273320 | 1 | 1 | 0 | 1 |
| Trota of Salerno | Q16206163 | 1 | 1 | 0 | 1 |
| Viardot-García, Pauline | Q122998 | 1 | 0 | 1 | 0 |
| Volckmann, Anna Helena | Q81397091 | 1 | 0 | 1 | 0 |
| Waser, Anna | Q119788 | 1 | 0 | 1 | 0 |
| Weston, Elizabeth Johanna | Q2563872 | 1 | 0 | 1 | 0 |
| Wilmer Cave Wright | Q15278767 | 1 | 1 | 0 | 1 |
| Zelia Nuttall | Q187410 | 1 | 1 | 0 | 1 |
