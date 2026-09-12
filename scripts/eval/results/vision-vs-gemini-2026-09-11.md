
# Google Cloud Vision vs Gemini on the pinned reference set (2026-09-11)

Engine: Cloud Vision DOCUMENT_TEXT_DETECTION with per-page language hints. 0 units, list cost $0.00 (inside the free tier).
Positive control (vision-control-modern-print-2026-09-11.png, latin-la-copernicus-derev-p142): CER 0.0%, aligned=true, confidence 0.983.

## Vision alone — per language

| language | pages | aligned | median CER | mean block conf | detected lang matches hint |
|---|---:|---:|---:|---:|---:|
| Armenian | 9 | 6 | 4.92% | 0.781 | 9/9 |
| Chinese | 6 | 3 | 8.2% | 0.702 | 6/6 |
| German | 7 | 7 | 0.71% | 0.876 | 7/7 |
| Greek | 17 | 13 | 0.21% | 0.844 | 17/17 |
| Hebrew | 4 | 3 | 2.82% | 0.746 | 0/4 |
| Latin | 12 | 5 | 3.68% | 0.862 | 12/12 |

## Paired vs `gemini-3-flash-preview` (pages BOTH align; page = mean over that arm's aligned runs)

n=25 pairs · Vision wins 1 / ties 13 / losses 11 · sign p=0.0063 · mean Δ -0.51pp · median Δ -0.46pp
Coverage: Vision aligned where gemini-3-flash-preview did not: 5; gemini-3-flash-preview aligned where Vision did not: 14.

| language | n | Vision median CER | Gemini median CER | W | L | novel-word rate Vision / Gemini |
|---|---:|---:|---:|---:|---:|---:|
| Armenian | 5 | 3.63% | 0.7% | 0 | 4 | 0.448 / 0.295 |
| Chinese | 2 | 8.35% | 0.28% | 0 | 2 | — / — |
| German | 5 | 0.33% | 0% | 0 | 2 | 0.471 / 0.427 |
| Greek | 9 | 0.1% | 0% | 0 | 0 | 0.304 / 0.287 |
| Hebrew | 2 | 1.41% | 12.43% | 1 | 1 | 0.294 / 0.068 |
| Latin | 2 | 3.69% | 2.04% | 0 | 2 | 0.811 / 0.712 |

## Paired vs `gemini-3.1-flash-lite` (pages BOTH align; page = mean over that arm's aligned runs)

n=37 pairs · Vision wins 3 / ties 19 / losses 15 · sign p=0.0075 · mean Δ -1.09pp · median Δ -0.28pp
Coverage: Vision aligned where gemini-3.1-flash-lite did not: 0; gemini-3.1-flash-lite aligned where Vision did not: 15.

| language | n | Vision median CER | Gemini median CER | W | L | novel-word rate Vision / Gemini |
|---|---:|---:|---:|---:|---:|---:|
| Armenian | 6 | 4.93% | 3.14% | 2 | 3 | 0.486 / 0.436 |
| Chinese | 3 | 8.2% | 1.69% | 0 | 2 | — / — |
| German | 7 | 0.71% | 0% | 0 | 3 | 0.457 / 0.421 |
| Greek | 13 | 0.21% | 0.19% | 0 | 0 | 0.301 / 0.284 |
| Hebrew | 3 | 2.82% | 0% | 1 | 1 | 0.361 / 0.343 |
| Latin | 5 | 3.68% | 1.06% | 0 | 5 | 0.679 / 0.608 |

## Five worst Vision pages (raw accuracy, 300-char excerpts)

### greek-iliad-13-idomeneus — acc 12.6% aligned=false conf=0.643 novel=0.4286 detected=el/en/de/pt/kri/es/fi/la/fy/hu/yo/eu/sv/af/nl/ca/ff/mi/fr/mg/gd/co
- REF: πιόμεν’ ἐκ βοτάνης· γάνυται δ’ ἄρα τε φρένα ποιμήν· ὣς Αἰνείᾳ θυμὸς ἐνὶ στήθεσσι γεγήθει, ὡς ἴδε λαῶν ἔθνος ἐπισπόμενον ἑοῖ αὐτῷ. Οἱ δ’ ἀμφ’ Ἀλκαθόῳ αὐτοσχεδὸν ὁρμήθησαν μακροῖσι ξυστοῖσι· περὶ στήθεσσι δὲ χαλκὸς σμερδαλέον κονάβιζε τιτυσκομένων καθ’ ὅμιλον ἀλλήλων· δύο δ’ ἄνδρες ἀρήϊοι ἔξοχον ἄλλων
- OUT: Inches cm 1 2 13 4 2 15 ww pww. ws, S andfor Dar For las deas. When Perls, 5. Huda: drws Now, visor Bouw orgula με diov. mula la. Through Onneur: In: N. Thouche an Bolarus. Larulas de apa de Peera Targeti τε dis arrera dopios evi sudeas gepuder. ,'"'de Nawr advos amadouchvor vos auſ Επι 201 Ond'app'

### chinese-zhuangzi-xiaoyaoyou — acc 23.5% aligned=false conf=0.658 novel=null detected=zh/en
- REF: 北冥有魚，其名為鯤。鯤之大，不知其幾千里也。化而為鳥，其名為鵬。鵬之背，不知其幾千里也；怒而飛，其翼若垂天之雲。是鳥也，海運
- OUT: 齊諧者志怪 颶風大作則海氣先動 |/莊于爱注危一 不相干廣作一各 則將徙於南冥南魚都和 者則 L 橫已極 風名爾雅風 鵬飛撃术 鵬之徙於南冥也水擊三千 言其高 一去半歲言其遠 里攙區扶摇而上者九萬里去以六月息者 日中遊氣 章法 大之視上如此 00 绝形弯 其正 鳩之視下亦如此 造物也老于云素箫 哀 。 耶下 同 其遠 082 9 8 4 9 5 2 言 0. 灬所至極 言培風先借水為喻 港 OR

### chinese-analects-xue-er — acc 26.7% aligned=false conf=0.922 novel=null detected=en/zh/ca
- REF: 學而時習之，不亦說乎？有朋自遠方來，不亦樂乎？人不知而不慍，不亦君子乎？
- OUT: 2 CONFUCIAN ANALECTS. 而務有亂上犯孝其 一節 有子 道本也。者而不上弟為有 生本君未好好者而人子 孝子之作犯鮮好也日 CHAPTER II. 1. The philosopher Yew said, "They are few who, being filial and fraternal, are fond of offending against their supe- riors. There have been none, who, not liking to offend against their superiors, have been fond of st

### chinese-xunzi-quan-xue — acc 30.0% aligned=false conf=0.679 novel=null detected=zh
- REF: 君子曰：學不可以已。青、取之於藍，而青於藍；冰、水為之，而寒於水。木直中繩，輮以為輪，其曲中規，雖有槁暴，不復挺者，輮使之然也。
- OUT: 4 49 荀子勸學 神莫大於化道福莫長於無禍 美丽對自開著大趣 11 吾嘗終日而思矣不如須臾之所學也吾嘗跂而望矣不如登高之博見 也) 登高而招臂非加長也而見者遠順風而呼聲非加疾也而聞者彰假輿馬 若非利足一 也而致千里假舟機者非能水也而絕江河◎ 君子生 非異也善 假於物也因爾夫息散 南方有鳥焉名曰『蒙鳩 』 以羽爲巢而編之以髮繫之葦苕 風至苕 折卵破子死巢非不完也所繫者然也西方有木焉名日『射干 』 莖長四寸 生於高山之上而臨百仞之淵木莖非能長也所立者然也蓬生麻中不扶而直 49 ⊕爲學則自化道故神莫大焉脩身則自無禍故福莫長焉 ●跂音器(ㄑ)舉踵也博見廣見也 D ●利捷足也 四能讀爲『』給直也 金生

### greek-iliad-1 — acc 44.3% aligned=false conf=0.707 novel=0.8214 detected=el/la/pt/sv/en/eu/su/co/hu/ca/pl/fy/es/lt/sw/lus/fr
- REF: Μῆνιν ἄειδε, θεά, Πηληϊάδεω Ἀχιλῆος οὐλομένην, ἣ μυρί' Ἀχαιοῖς ἄλγε' ἔθηκε, πολλὰς δ' ἰφθίμους ψυχὰς Ἄϊδι προΐαψεν ἡρώων, αὐτοὺς δὲ ἑλώρια τεῦχε κύνεσσιν οἰωνοῖσί τε πᾶσι· Διὸς δ' ἐτελείετο βουλή, ἐξ οὗ δὴ τὰ πρῶτα διαστήτην ἐρίσαντε Ἀτρεΐδης τε ἄναξ ἀνδρῶν καὶ δῖος Ἀχιλλεύς.
- OUT: thena cm İnches 2 4 M adna Sham cont walitu J Oune ou Iriados. A. IMÁДOZ OMHPOY.H.A. ΙΛΙΑΔΟΣ Payudios. Nopos xa's pelives. Arda Tiras Nevoon, Vainor rearon, dos arauſes. A. preas Chriſe peſtem exercitis inimicitias Regum. um ände der entründen Muo Ouropirke, u wei H Tolla's d² ippopous yuxa's aide r

## Five worst `gemini-3-flash-preview` pages

### greek-hero-pneumatica-178 — acc 0.0% aligned=false novel=0.0574
- REF: ἕτερα δὲ ἁλυσείδια ἐπειληθέντα πρὸς τοὺς στροφεῖς τὰ ἐναντία τοῖς πρότερον εἰς ἓν ἀποδεθέντα διὰ τροχίλου εἰς βάρος μολιβοῦν ἀποδεδέσθω, διʼ οὗ καταρρέποντος ἀποκεκλεισμέναι ἔσονται αἰ θύραι. ὁ δὲ Κ ΛΜ σίφων τὸ ἐκτὸς σκέλος ἐχέτω φέρον εἰς τὸ κρεμαστὸν ἀγγεῖον. ἐμβεβλήσθω δὲ διά τινος τρυπήματος τοῦ
- OUT: <language>Ancient Greek</language> <page-type>text</page-type> <page-num>178</page-num> <header>ΗΡΩΝΟΣ ΑΛΕΞΑΝΔΡΕΩΣ ΠΝΕΥΜΑΤΙΚΩΝ Α.</header> μενον· ἕτερα δὲ ἁλυσείδια ἐπειληθέντα πρὸς τοὺς στροφεῖς τὰ ἐναντία τοῖς πρότερον εἰς ἓν ἀποδεθέντα διὰ τροχίλου εἰς βάρος μολιβοῦν ἀποδεδέσθω, δι’ οὗ καταρρέπον

### armenian-zohrab-john-1 — acc 15.9% aligned=false novel=null
- REF: Ի սկզբանէ էր բանն . եւ բանն էր առ Աստուած . եւ Աստուած էր բանն ։ Նա էր ի սկզբանէ առ Աստուած ։ Ամենայն ինչ ՝ նովաւ եղեւ . եւ առանց նորա եղեւ եւ ոչինչ ՝ որ ինչ եղեւն ։ Նովաւ ՝ կեանք էր , եւ կեանքն ՝ էր լոյս մարդկան . Եւ լոյսն ՝ ի խաւարի անդ ՝ լուսաւոր էր , եւ խաւար ՝ նմա ոչ եղեւ հասու ։ Եղեւ այր մի առ
- OUT: " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " " 

### german-herder-sprache-p44 — acc 33.3% aligned=true novel=0.0439
- REF: Kraft in die Seele hinein gedacht, die dem Menſchen als eine Zugabe vor allen Thieren zu eigen geworden, und die alſo auch, wie die vierte Stuffe einer Leiter nach den drei unterſten, allein betrachtet werden muͤſſe; und das iſt freilich, es moͤgen es ſo große Philoſophen ſagen, als da wollen, Philo
- OUT: 00074551 44 Kraft in die Seele hinein gedacht, die dem Men- ſchen als eine Zugabe vor allen Thieren zu eigen geworden, und die alſo auch, wie die vierte Stuffe einer Leiter nach den drei unterſten, allein betrach- tet werden müſſe; und das iſt freilich, es mögen es ſo große Philoſophen ſagen, als da

### chinese-hanfeizi-nan-yan — acc 41.0% aligned=false novel=null
- REF: 臣非非難言也，所以難言者：言順比滑澤，洋洋纚纚然，則見以為華而不實。敦祗恭厚，鯁固慎完，則見以為掘而不倫。多言繁稱，連類比物，則見以為虛而無用。
- OUT: 韓非子新釋（上卷） 難 言 第 三 叙説 難言なんげんとは「言いうをはゞかる」の意い。臣下しんかとして君上くんじやうに事ことを言上ごんじやうして嘉納かなふを得うることは、なか なか困難こんなんなことで容易よういならぬ苦心くしんを要ようする。加しかのみならず之こうつかり物ものを申まを上あげ君きみの御機嫌おきげんを損そこねたら最後さいご、 死亡しはう立どころに至いたる有様ありさまである、故ゆゑに臣下しんかたる者もの、君きみに對たいし申まを上あげたいことは山々やまやまあつても、勢いきほひ、 差控さしひかへざるを得えないと謂いうのが此この篇へんの趣旨しゆしである。 此この篇へん、上書じやうしよの體たい

### latin-vulgate-genesis-5-genealogy — acc 46.4% aligned=false novel=0.8627
- REF: Vixit autem Adam centum triginta annis : et genuit ad imaginem et similitudinem suam, vocavitque nomen ejus Seth. Et facti sunt dies Adam, postquam genuit Seth, octingenti anni : genuitque filios et filias. Et factum est omne tempus quod vixit Adam, anni nongenti triginta, et mortuus est. Vixit quoq
- OUT: Adam. CAP. IIII. GENESIS. CAP. V. 3 7 Nónne ſi bene egeris, recipies: ſin autem 25 Cognouit quoque adhuc Adam vxorem malè, ſtatim in foribus peccatum - tuum ſuam, & peperit filium, vocauitq; nomen -12. aderit? ſed ſub te erit appetitus eius, & tu eius Seth: dicens, Poſuit mihi Deus ſemen dominaberis

## Five worst `gemini-3.1-flash-lite` pages

### latin-la-praetorius-syntagma1-p120 — acc 59.3% aligned=false novel=0.9239
- REF: Ex iis Psalmis μεγαλυνῳδία sane Lειturgodiæ Ecelesiasticæ pars maxime insignis ac frequentissima est. Etenim Magnificat illud tam magnifecit pia vetustas, ut omnibus Tonis, Tonorumque differentiis, cuiusque Dominicem ac Festi solennitati congruentibus, post Antiphonas rite concini instituerint μελοπ
- OUT: ET VESPERTINA. 73 Denique: Esurientes implevit bonis, & divites dimisit inanes: domesticis januis, cellis penuarijs & cubiculis adscribantur. Præterea scitè & mirificè nobis commendat hanc memorabilem B. Mariæ ODEN, quòd personarum cognominum cognatíque argumenti canticis, in Veteri Testamento præca

### latin-la-malleus-ed2-p30 — acc 76.3% aligned=false novel=0.7063
- REF: Impossibile est effectum sine causa sua producere. sed opera maleficorum sunt talia quod non possunt nisi opere demonum fieri. patet ex descriptione operum maleficorum. ex Isido. libro. viij. ethimol. Malefici dicuntur ob magnitudinem facinorum. Hi enim elementa concutiunt. mentes hominum turbant & 
- OUT: plant. Fortificatur argumentū ex.p.Reguz.c.xvi. ybi faul vexabat a demone alleuiabat qñ Dauid cythara pcutiebat corā eo z q recedebat spūs ma lus.Sed prra. Impossibile est effectum sine causa sua pducere.h opa maleficoy sunt talia q non pfit nisi ope demonū fieri.prz ex descriptiōe opey male ficoy.e

### greek-dioscorides-ruel-106 — acc 86.4% aligned=false novel=0.6522
- REF: ἄχρις οὗ τακηρὸς γένηται, καὶ ἐπιπλασθεὶς νύκτα ὅλην τρίχας μελαίνει προαποσμηχθείσας Κιμωλίᾳ γῇ. 3 ἁρμόζει δὲ τὰ φύλλα πάντων λεῖα κοπέντα οἰδήμασι, καὶ τὰ ἄτονα δὲ μέρη κρατύνει. αἱ δὲ Σαρδιαναὶ βάλανοι, ἄς τινες λόπιμα ἢ καστανίας ἢ μότα ἡ Διὸς βαλάνους καλοῦσι, στύρουσι καὶ αὐταί, τῶν ὁμοίων τέ 
- OUT: LIBER L 57 σὺν σέαι δὲ χοιρείῳ ταειχη- ad duritias quas coëthe vo- ρῷ, πρὸς κακοήθεις σκληρίας, ὴ cant, & malefica vlcera cum πρὸς πονηρευόμενα ἕλκη ἁρμό- falfa axungia conueniunt. Ili- ζοισιν· ἰσχυρότεραι δὲ τ δρυϊνῶν gnæ glandes viribus quernas αἱ πρίνινα τῇ δυνάμει εἰσίν. antecellunt. Περὶ Φηγοῦ 

### hebrew-shaarei-orah-gate2-yovel — acc 91.1% aligned=true novel=0.5089
- REF: וביאור העיקר הזה: דע, כי מידת היוב"ל למעלה היא שביעית, היא עליונה, והיא סוד הגאולה השלמה והחירות; ומן היובל, שהיא סוד הגאולה השלמה, מקבלת מידת אל ח"י שפע הגאולה ומביא גאולה לעולם, כמו שמקבל מן היובל כוח החיים ונקרא על זה אל ח"י. ודע כי בכוח ספירת היובל, שנמשכת באל חי, נגאלו ישראל ויצאו ממצרים, שנאמר
- OUT: רה שער ב אדני פועלת גאולה בשליחות אל חי ומצלת את הצדיק וגואלת אותם מכל פגע ומחלה ומכל מיני משחית ופורענות ונקרא באותה השעה המלאך הגואל ולפי שמדת אדני הנקרא שכינה היתה הולכת עם יעקב בשליחות אל חי כאמרו אם יהיה אלהים עמדי ושמרני בדרך הזה ושבתי בשלום בית אבי והיה יהוה לי לאלהים והיתה המרה הזאת הולכת עם

### latin-vita-vergilii-donatus-auctus — acc 91.8% aligned=true novel=0.6278
- REF: ubi, cum litteris et Graecis et Latinis uehementissimam operam dedisset, tandem omni cura omnique studio indulsit medicinae et mathematicis. quibus rebus cum ante alios eruditior peritiorque esset, se in urbem contulit statimque, magistri stabuli equorum Augusti amicitiam nactus, multos uariosque mo
- OUT: V I R G I L I I polim tranfiit: ubi cum litteris & Graecis, & Latinis uehementiffimam operam dediffet, tandem omni cu- ra, omniq. ftudio indulfit medicinae, & mathemati- cis. Quibus rebus cū ante alios eruditior, peritiorq. eflet, fe in urbem contulit: ftatimq. magiftri ftabuli equorum Augufti, amic

## Tibetan cross-check — 20 pages of the #4523 pilot book, Derge alignment identity

Instrument: `kanjur_align.py` on clawdbot (positive control median 0.968, chance floor 0.083). Identity, not CER: higher is better.

| arm | n | median identity | mean | Vision − arm (median) | Vision W / L |
|---|---:|---:|---:|---:|---:|
| google-vision (hint bo) | 20 | 0.339 | 0.348 | — | — / — |
| gemini re-OCR, woodblock prompt (#4523 txt-wood) | 20 | 0.453 | 0.44 | -0.086 | 0 / 20 |
| gemini re-OCR, dbu-can prompt (#4523 txt-uchan) | 20 | 0.426 | 0.422 | -0.082 | 0 / 19 |
| BDRC Yigdzin-v1 (#4722 txt-yigdzin) | 20 | 0.51 | 0.53 | -0.143 | 0 / 20 |

Vision is the WORST of the four on our scans, losing 20/20 pages to the woodblock-prompt Gemini arm and to Yigdzin. The BDRC leaderboard rank (3rd, uchen CER 0.09) does not transfer to this manuscript Kanjur.
