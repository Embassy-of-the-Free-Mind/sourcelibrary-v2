// Isaac Beeckman's notes on Cornelis Drebbel, 1619–1634 (#5936).
//
// Beeckman's own words only. The text follows C. de Waard's transcription
// (Journal tenu par Isaac Beeckman, 1939–53) and every passage was read against
// the printed page. De Waard's notes, headings, dating brackets and sigla are
// NOT reproduced (he died in 1963; they are protected to 2034), and where his
// apparatus records that he corrected a word, the manuscript reading is printed
// here instead. Dates and folios are facts taken from the edition's running
// heads and page-break marks. The English is ours.

export interface BeeckmanPassage {
  id: string;
  /** Date as Beeckman gives it, or the span the entry falls in. */
  date: string;
  /** Where it stands: manuscript leaf, or the letter it comes from. */
  source: string;
  title: string;
  /** Beeckman's own marginal head, where the entry has one. */
  head?: string;
  lang: 'nl' | 'la';
  original: string[];
  translation: string[];
  /** A plain remark of ours, shown under the passage. */
  note?: string;
}

export const PASSAGES: BeeckmanPassage[] = [
  {
    id: 'elements-1619',
    date: '10 November 1619, Middelburg',
    source: 'fol. 138r',
    title: 'Reading Drebbel on the elements',
    head: 'Venti in unam duntaxat lineam spirantis ratio.',
    lang: 'la',
    original: [
      'Fit interdum ventum non undiquâque spirare, sed in unam duntaxat partem, idque fit cùm aer, vapor etc. circa unam duntaxat extremitatem attenuatur. Nequit enim attenuatum penetrare eam partem aeris, quæ crassis ijs vaporibus obsita adhuc est, sed omne attenuatum tenuioris aeris plagam pervolat, eo modo quo pulvis pyrij, flamma, globus fumus, per unicum orificium solummodo exeunt, bombardi lateribus et posticâ clausis crassâ substantiâ, quam pulvis is nequit perforare. Sic etiam à nubibus decidit ventus, attenuatâ inferiore solum nubis parte; fit ita turbo non rarò vehemens.',
      'Den 10 November te Middelb., occasionem præbente cap. 6 libri Drebbelij Alcmariensis, gedruckt te Haerlem, Van den natuyre der Elementen, in Duytsch.',
    ],
    translation: [
      'It sometimes happens that the wind blows not from every side but in one direction only, and this happens when the air, vapour etc. is thinned at one end only. For what has been thinned cannot pass through that part of the air which is still beset with thick vapours; everything thinned flies through the region of thinner air, in the way that gunpowder, flame, ball and smoke leave by the single opening only, the sides and back of the gun being closed by a thick substance which the powder cannot pierce. So too wind falls from the clouds when only the lower part of the cloud is thinned; this often makes a violent whirlwind.',
      'The 10th of November at Middelburg, prompted by chapter 6 of the book of Drebbel of Alkmaar, printed at Haarlem, On the Nature of the Elements, in Dutch.',
    ],
  },
  {
    id: 'submarine-1620',
    date: '15 March 1620',
    source: 'fol. 154r–154v',
    title: 'The boat that goes under water',
    head: 'Navem sub aquis navigantem fabricare.',
    lang: 'nl',
    original: [
      'Den 15en Meerte anno 1620 stilo novo.',
      'Over een dach ofte twee creegh ick van vader eenen brieff, in denwelcken hy my schreef, dat Drebbel in Engelandt een schuyte gepractiseert heeft, daermede hy onder ende boven water varen kan als hy wilt. Hetwelcke ick op dese ofte diergelycke maniere gepractiseert te wesen imaginere:',
      'ABCD is de schuyte, CDHE eenen dichten back, daerin D is een buysken, twelck van in den dichten back tot int water kompt, daer de schuyte in dryft ende wort toegesloten met een krane. Alsmen nu wilt, dat de schuyte sincke, soo gaetmer van binnen in ende men sluyt alles seer dichte toe, twelck niet en verhindert van den asem te konnen verhalen omdat de schuyte groot is, also datse niet besonders warm en kan worden van onsen aessem, ende oock omdat de locht van natuyren gedrongen ende geopent kan worden […] Alsmen dan in de schuyte is, soo doet men de krane D open ende laet het water door dat buysken in komen. […]',
      'En wat aengaet de schuyte, alsmen se maken moeste, doch soude wel een bequamen middel practiseren om het water in ende uyt te krygen: den middel, die ick stelle, en is maer demonstrationis ergo.',
    ],
    translation: [
      'The 15th of March in the year 1620, new style.',
      'A day or two ago I had a letter from father, in which he wrote to me that Drebbel in England has contrived a boat with which he can travel under and above water as he pleases. I imagine it to have been contrived in this or some such way:',
      'ABCD is the boat, CDHI [the manuscript has CDHE] a tight tank, in which D is a little pipe that runs from inside the tight tank out into the water the boat floats in, and is closed with a tap. Now when one wants the boat to sink, one goes inside and shuts everything very tight, which does not prevent one from drawing breath, because the boat is large, so that it cannot grow particularly warm from our breath, and also because air can by nature be pressed together and opened out […] Once one is in the boat, one opens the tap D and lets the water come in through that pipe. […]',
      'And as for the boat, if it had to be made, one would surely contrive a fitting means of getting the water in and out: the means I set down is only for the sake of demonstration.',
    ],
    note: 'Between these paragraphs Beeckman draws the boat and works through why it sinks when water is let into the tank and rises when it is pumped out.',
  },
  {
    id: 'glasses-1622',
    date: 'between 27 May and 2 July 1622',
    source: 'fol. 165bis r',
    title: 'A rich man in Haarlem who knows as much as Drebbel',
    head: 'Vitra motui perpetuo inservientia.',
    lang: 'nl',
    original: [
      'Jacobus Bernhardi seght, dat hy voor eenen hooftman, ryck alchymist te Haerlem, soodanighe glasen heeft doen blasen, vier of vyve, also dat de pypen in malkanderen pasten, die sy daerna toemaken konden, met een lampe de eynden aeneen smeltende, also dat men soveel sulcke glasen aeneen setten konde als men wilde.',
      'Seyde oock, dat desen hooftman met Drebbel, die het perpetuum mobile gevonden heeft, alle dynghen ondersocht heeft, ende so wel weet als hy, maer daer soseer niet naer en vraeght, omdat hy so rycke is, ende Drebbel niet. Seyde oock, dat dese glasen tot het motum perpetuum gemaeck wierden.',
    ],
    translation: [
      'Jacobus Bernhardi says that for a captain [hooftman], a rich alchemist at Haarlem, he had such glasses blown, four or five of them, so that the pipes fitted into one another, and they could afterwards close them by melting the ends together with a lamp, so that one could join as many such glasses together as one wished.',
      'He also said that this captain has looked into all things together with Drebbel, who found the perpetuum mobile, and knows them as well as he does, but does not much care about it, because he is so rich and Drebbel is not. He also said that these glasses were made for the perpetual motion.',
    ],
  },
  {
    id: 'perpetuum-1622',
    date: 'between 27 May and 2 July 1622',
    source: 'fol. 165bis r',
    title: 'The perpetual motion, explained from hearsay',
    head: 'Motus perpetuus Drebbelij ex auditu explicatus.',
    lang: 'nl',
    original: [
      'Die het motum perpetuum van Drebbel gesien hebben, segghen, dat het twee glase halve rynghen syn, tegen malkanderen kommende, waerin een liqeur is, twelck met het getye op ende neer gaet in de rynghen, also dat het van beyde syden ontrent a byeen komt, ende dan na b toe wederom afwyckt. Segghen daerenboven, dat men daerin oock siet wat weer dattet in see maeckt.',
      'Vooreerst dan segghe ick, dat op dese manniere door de voorgaende wetenschap het liqeur door de veranderinghe van de locht in c uyt den back d, gelyck geseyde, teghen malcanderen kommen sal ende afwycken in de rynghe a, b, e, ja de rondicheyt geeft lichticheyt, also dat het liqeur so swaer niet op te trecken en is, omdatter veel plaetse verandert, weynich verhooght synde.',
      'Wat aengaet het wassen van het water, dat is misschien geseyde per similitudinem, te weten, gelyck het water wast ende daelt, also ryst dit oock ende daelt, twelck de lieden hoorende, kunnen gedocht hebben, dat men de getyen daerdoor weten konde als per signum. Wat aengaet de storm in see, datselvighe is my oock geseydt van het voorgaende te Delft int stadthuys staende, meughelick alleen om de sake te wonderlicker te maken.',
    ],
    translation: [
      'Those who have seen Drebbel’s perpetual motion say that it is two glass half-rings meeting each other, with a liquor in them that goes up and down in the rings with the tide, so that from both sides it comes together about a, and then draws back again towards b. They say besides that one also sees in it what the weather is doing at sea.',
      'First, then, I say that in this way, by the knowledge set out before, the liquor, through the change of the air in c, will come out of the vessel d, as said, and will meet and draw apart in the ring a, b, e; indeed the roundness makes it light work, so that the liquor is not so heavy to draw up, because it shifts far in place while being raised little.',
      'As for the rising of the water, that was perhaps said by way of likeness, namely: as the water rises and falls, so this too rises and falls; hearing which, people may have thought that the tides could be known by it as by a sign. As for the storm at sea, the same was told me of the earlier one that stands in the town hall at Delft, possibly only to make the thing more wonderful.',
    ],
    note: 'The letters refer to his drawing: a glass ball c above a ring a, b, e, with its foot in a small vessel d.',
  },
  {
    id: 'chimney-1626',
    date: 'between 28 March and 3 May 1626',
    source: 'fol. 251v',
    title: 'A second perpetual motion: the draught in a tower',
    head: 'Motus quidam perpetuus.',
    lang: 'nl',
    original: [
      'Dit soude men konnen neffens het Drebbeliaensche motus perpetuus setten, synde een ander manniere om een eeuwich roersel te maken. Want laetter eenen toren hol syn, van onder tot boven wyt genoech, daerin sal de locht altyt van onder na boven trecken, als geseydt is, maer onmerkelick, gelyck dit oock noch min merckelick is in de open locht. Maer maeckt onder, dicht aende aerde, een solderinghe, daermede den toren van onder gestopt sy, met een kleyn gadt van een vuyst of voet groot in de solderinge, so sult ghy het trecken door dat gat eerst voelen. […] Stelt daer yet aen, dat door de windt drayen kan, tsal door tgene gehoort is, altyt drayen sonder oyt stil te staen. Doch dit en sal gheen eenparich of gelyckvormich roersel syn, dewyle de locht onder ende boven deen tyt meer, ende dander tyt min, verschillen etc.',
    ],
    translation: [
      'This could be set beside the Drebbelian perpetual motion, being another way of making an everlasting movement. For let a tower be hollow, wide enough from bottom to top; in it the air will always draw from below upward, as has been said, but imperceptibly, just as this is still less perceptible in the open air. But make a floor below, close to the ground, by which the tower is stopped at the bottom, with a small hole the size of a fist or a foot in the floor, and you will first feel the draught through that hole. […] Set something there that the wind can turn, and from what has been said it will turn always without ever standing still. Yet this will not be an even or uniform movement, since the air below and the air above differ more at one time and less at another, etc.',
    ],
  },
  {
    id: 'body-1626',
    date: 'between 3 May and 18 June 1626',
    source: 'fol. 252r',
    title: 'Heat that draws in, in the body and in the glass',
    head: 'Facultatum 4 naturalium ratio.',
    lang: 'la',
    original: [
      'Sic quoque intelligantur omnia membra calefacta attrahere. […] Per hoc inventum quis poterit contrario modo attrahere et exprimere quàm fit instrumento Drebbeliano? ac fortassis utroque totam naturam rerum imitari. Sequamur modo ingeniosè naturam invitantem.',
    ],
    translation: [
      'In the same way let it be understood that all heated members attract. […] By this discovery one will be able to draw in and press out in the way contrary to what is done in the Drebbelian instrument [?], and perhaps with the two together to imitate the whole nature of things. Let us only follow with ingenuity where nature invites.',
    ],
  },
  {
    id: 'scale-1626',
    date: '16 August 1626',
    source: 'fol. 257v',
    title: 'With Stampioen: a true scale for the Drebbelian instrument',
    head: 'Vitri quo calor examinatur aer quomodo condensando se habeat.',
    lang: 'nl',
    original: [
      'Also ick gisteren, den 15en Augusti, Stampion voorstelde om te ondersoecken in het Drebbeliaensche instrument, hoemen de duymen soude moghen verminderende maken omdat men de koude ende hitte altyt soude in proportie met rysen ende dalen des waters in de buyse, so begeerde ick dat wy souden soecken te weten de manniere vant verdicken ende verdunnen des lochts, dewyle sy int beginsel door een kleyne koude gemackelicker verdunt wort dan daerna, alse qualick meer kan geperst worden door een grooter. Also gaettet oock met het spannen door de hitte.',
    ],
    translation: [
      'Yesterday, the 15th of August, I proposed to Stampioen that we look into how, in the Drebbelian instrument, the inches might be made to grow smaller step by step, so that cold and heat would always be in proportion to the rising and falling of the water in the tube; and so I wished that we should try to learn the manner in which air thickens and thins, since at the start it is more easily thickened [the manuscript has verdunt, thinned] by a small cold than afterwards, when it can hardly be pressed further by a greater one. So it goes too with stretching by heat.',
    ],
  },
  {
    id: 'virginal-1626',
    date: 'between 16 and 21 August 1626',
    source: 'fol. 258r',
    title: 'The harpsichord that plays in the sun',
    head: 'Clavicorda qui Solis solo calore agitetur.',
    lang: 'nl',
    original: [
      'Ten is niet vrempt dat Drebbel een klavercyne met de hitte van de Sonne doet spelen, want men kan het korpus van de klavercyne, van de personage, die speelt ende vant gene, daer se opsit ende de clavercyne op staet etc., al hol maken van dun bleck of koper dicht toe, ende op de voorsz. manniere daerdoor water optrecken of opstooten door de hitte van de Sonne, dewelcke veel vermach op so veel lochts als in de clavercyne, personage, stoel, kiste, etc. gaen mach, dewyde daer veel lochts is, daer is de vergrootinghe oock groot. Siet pag. seq.',
    ],
    translation: [
      'It is not strange that Drebbel makes a harpsichord play by the heat of the Sun, for one can make the body of the harpsichord, of the figure that plays, and of what she sits on and the harpsichord stands on, etc., all hollow, of thin tinplate or copper, tightly closed, and in the aforesaid way draw or push water up through it by the heat of the Sun, which can do much upon as much air as will go into the harpsichord, figure, chair, chest, etc.; for where there is much air, the expansion too is great. See the following page.',
    ],
  },
  {
    id: 'clock-1626',
    date: 'between 21 August and 30 September 1626',
    source: 'fol. 258v–259r',
    title: 'A clock driven by Drebbel’s glass, and the glass improved',
    head: 'Vitro quo calor examinatur hologium perpetuum facere.',
    lang: 'nl',
    original: [
      '[…] Alsmen dan doort gene opt voorgaende sydeken staet van het Drebbeliaens instrument maeckt, dat, alst kouder wort dan te vooren, mlb nederwaerts helt, so sal dat dobbel radt drayen, twelck men sal moeten appliceren aen een uerwerck, dat pertinent gemaeckt is ende licht drayt, So sal het uerwerck (gaende door het gewichte e) wysen hoe langhe het weder in dien staet geweest is. […] Twelck beyde also synde, so salt een uerwerck syn, dat van selfs altyt gaen, sonder t’gewichte op te stellen, twelck van een ygelick langhe gesocht is.',
      '[…] Daerenboven kanmen door het voorsz. Drebbeliaens glas de jaren rekenen, nadien datter gheen winter en kan gevonden worden, wiens alderkoutsten tyt warmer is dan den alderheetsten tyt in den somer. Waerdoor men een instrument maken kan, dat maer eens des jaer en roert, gelyckt voorgaende eens smaens ofte 14 daghen, ende het ander eens daeghs.',
      'Dese bystaende forme is het diarium Drebbelij tot beter bequaemheyt gebracht, dewyle ick rechs vooren getoont hebbe, datter meer kracht moet syn des weers om het water te doen rysen alst opt hooghste gekommen is, dan alst maer en begint te rysen, ende dat dit groote inegaliteyt in duymen brenght.',
    ],
    translation: [
      '[…] If then, by what stands on the preceding page about the Drebbelian instrument, one arranges that when it grows colder than before, mlb tilts downward, the double wheel will turn; this must be fitted to a clockwork that is accurately made and turns easily. Then the clockwork (going by the weight e) will show how long the weather has been in that state. […] Both being so, it will be a clockwork that always goes of itself, without the weight being wound up, which everyone has long sought.',
      '[…] Moreover one can reckon the years by the aforesaid Drebbelian glass, since no winter can be found whose coldest time is warmer than the hottest time in summer. From this one can make an instrument that stirs only once a year, as the preceding one does once a month or fortnight, and the other once a day.',
      'The form drawn beside this is Drebbel’s diarium brought to better use, since I showed just before that more force of weather is needed to make the water rise when it has come to its highest than when it only begins to rise, and that this brings great unevenness in the inches.',
    ],
    note: 'The last paragraph has its own marginal head, Vitrum quo calor examinatur alterius formæ. His drawing shows a glass ball above a tube bent back and forth, standing in a small vessel. Diarium, a daily register, is his word for the weather-glass.',
  },
  {
    id: 'tide-1626',
    date: 'between 30 September and 19 November 1626',
    source: 'fol. 261r–261v',
    title: 'The instrument that imitates the tide',
    head: 'Drebbelianum instrumentum quo æstum maris imitatur.',
    lang: 'nl',
    original: [
      'De eerste figure is, naet segghen van de pedagoge van den pensionaris Pauw’s kinderen (dewelcke seght kennisse te hebben met een, die so familiaer met Drebbel is als met syn eyghen broeder), het instrument van Drebbel, daer hy de lieden mede wys maeckt, dat hy het water daerin doet rysen ende dalen gelyck de vloet in de see. Maer, seght hy, Drebbel die kan de warmte int glas A also regieren dat het ten naesten by alle twaelf uren eens aen de rechter syde ryst ende eens aen de slyncker syde. Maer ick meyne dat de lieden daer so langhe niet en blyven staen kycken; maer die smorgens kommen, bevindent water hooghst aen de slyncker syde, ende die na den middach kommen, bevindent gelyckt nu staedt.',
      'Maer ick salt selvighe fatsoneren op de wyse van de tweede figuere dewyle ick gheen gelegentheyt en hebbe van glas te blasen na myn sin, ende sal misschien wel so aerdich syn.',
    ],
    translation: [
      'The first figure is, according to the tutor of Pensionary Pauw’s children (who says he knows a man as familiar with Drebbel as with his own brother), the instrument of Drebbel with which he makes people believe that he causes the water in it to rise and fall like the tide in the sea. But, he says, Drebbel can so govern the warmth in the glass A that about every twelve hours it rises once on the right side and once on the left. But I think people do not stay standing there to watch so long; those who come in the morning find the water highest on the left side, and those who come after noon find it as it stands now.',
      'But I shall fashion the same after the manner of the second figure, since I have no means of having glass blown to my liking, and it will perhaps be just as neat.',
    ],
    note: 'His first figure is a ring of glass above a flask marked A; the second is two upright tubes joined at top and bottom with a ball above.',
  },
  {
    id: 'wind-1627',
    date: 'between 18 December 1626 and 4 March 1627',
    source: 'fol. 263v',
    title: 'Why the winds are so changeable',
    head: 'Venti cur tam varij et quomodo oriantur.',
    lang: 'la',
    original: [
      'Sicut Luna author est humiditatis cum stellis ejus naturæ, indeque pendet motus maris, sic Sol cum stellis suæ naturæ aucthor est caliditatis indeque pendet motus aeris, id est ventus, ut antè alubi dixi. Incertior verò est fluxus aeris quàm maris, quia aer circa varios montes et loca, etc. incertiùs a Sole calefit. Confert Drebbelianum diarium, in quo aqua per calorem descendit. Etiam vide quàm varia sit hyems in calore et frigore. Quin igitur talis non esset ventus?',
    ],
    translation: [
      'As the Moon, with the stars of her nature, is the author of moisture, and on this the motion of the sea depends, so the Sun, with the stars of his nature, is the author of heat, and on this depends the motion of the air, that is, wind, as I have said elsewhere before. But the flow of the air is less certain than that of the sea, because the air around the various mountains and places etc. is heated less evenly by the Sun. Compare the Drebbelian diarium, in which the water goes down through heat. See also how changeable winter is in heat and cold. Why then should the wind not be so too?',
    ],
  },
  {
    id: 'tower-1628',
    date: 'between 10 and 18 September 1628',
    source: 'fol. 328r',
    title: 'A weather station on his tower',
    head: 'Ventorum et aeris mutatio a me ex turri observanda.',
    lang: 'la',
    original: [
      'In principio hujus libri vides a me duobus ferè annis observatas fuisse ephemerides aeris, sed ibi venti et calor et frigus crasso duntaxat modo potuerunt observari.',
      'Nunc verò statui in summitate turris, quam mihi magistratus ædificat, constituere ventorum indicem atque per ferrum teres et tenue, quod infra in musæum meum dimittetur, ibi accuratè in circulo ventorum per indicem inferiorem, eidem ferro adjunctum, idem indicare. […] Ad hæc in turris eâdem summitate, erigem instrumentum Drebbelianum, per quod aris constitutio circa frigus et calorem indicatur, et per fistulam intra museum continuabo, ubi aqua in vitro tereti, æquabili et perforato, ascendet et descendet. Ita accuratissimè singulis horis potero videre veram aeris mutationem, quia supra omnes ædes vitrum positum nihil ab ædium calore etc. patietur, et notabo quot digitis calor aut frigus hac aut illâ horâ auctum fuerit. Utque id fiat accuratiùs, conjungam in turris summitate vitra plura maximæ capacitatis. Ventis et aere ita observatis, facilè erit addi pluvias, tempestates, nivem, grandinem etc., quia illa eâdem quâ fiunt horâ, satis manifestè percipiuntur.',
      'His peractis per otium hæc omnia cum cœlo conferam. Utinam idem in multis et remotis regionibus eodem tempore fiat, ut varietas observatorum physicas rationes latiùs et meliùs possint manifestare.',
    ],
    translation: [
      'At the beginning of this book you see that for nearly two years I kept a daily record of the air, but there the winds and the heat and cold could be observed only in a rough way.',
      'Now I have resolved to set up, on the top of the tower which the magistrate is building for me, a wind vane, and by a thin round iron rod let down into my study below, to show the same there accurately on a circle of the winds by a lower pointer fixed to the same rod. […] Besides this, on the same top of the tower I shall set up a Drebbelian instrument, by which the state of the air as to cold and heat is shown, and I shall carry it on by a pipe into the study, where the water will rise and fall in a round, even, bored glass. Thus I shall be able to see most accurately, every hour, the true change of the air, because the glass, placed above all the houses, will suffer nothing from the warmth of the houses etc., and I shall note by how many finger-breadths heat or cold has grown at this or that hour. And so that this may be done more accurately, I shall join several glasses of the largest capacity together at the top of the tower. With winds and air so observed, it will be easy to add rains, storms, snow, hail etc., since these are perceived plainly enough at the very hour they happen.',
      'This done, I shall at leisure compare all these with the heavens. Would that the same were done in many and distant regions at the same time, so that the variety of things observed [or: of observers] might show the physical causes more widely and better.',
    ],
  },
  {
    id: 'lead-1629',
    date: 'on or after 19 March 1629, Dordrecht',
    source: 'fol. 341r',
    title: 'Why the lead on his roof bulges',
    head: 'Myn pladt met loot beleydt, waerom het scheurt ende de remedie daerteghen.',
    lang: 'nl',
    original: [
      'Als het loot op myn pladt (dat de magistraet van Dortrecht met groote kosten tot myn speculatie doen maken hebben) geleydt wiert, so seyde my de wercklieden, dat het loot altyt somers door de hitte van de Sonne oppuylde ende dickwils so seer, dat het loot daerdoor borst ende scheurt. Hebbe oock dat oppuyle nu selfs mede gewaer geworden.',
      'Ick gaf hiervan reden, te weten dat de hitte van de Sonne door het loot gaende, verdunt al de vochticheyt, die tusschen het loot ende de solder is, eveleens gelyck in het Drebbeliaens instrument de locht verdunt wort, of gelyck een weynich waters, in eenen yseren bol by het vier geleydt, door een kleyn gaetken door de wermte damp geworden synde, so sterck vliecht, dat het in stede van eenen blaesbalck dienen kan. Dese vochticheyt dan tusschen de solder ende het loot damp geworden synde, beslaet meer plaetse; om welcke plaetse te bekommen, perst sy het loot opwaerts.',
    ],
    translation: [
      'When the lead was laid on my platform (which the magistrates of Dordrecht have had made at great cost for my observations), the workmen told me that in summer the lead always bulged up through the heat of the Sun, and often so much that it burst and tore. I have now noticed this bulging myself as well.',
      'I gave the reason for it, namely that the heat of the Sun, passing through the lead, thins all the moisture that is between the lead and the floor, just as the air is thinned in the Drebbelian instrument, or as a little water, put in an iron ball by the fire and turned to vapour by the warmth, flies out through a small hole so strongly that it can serve in place of a bellows. This moisture between the floor and the lead, then, having become vapour, takes up more room; and to gain that room it presses the lead upward.',
    ],
  },
  {
    id: 'mersenne-1629',
    date: 'June 1629',
    source: 'letter to Marin Mersenne',
    title: 'To Mersenne: what tension is',
    lang: 'la',
    original: [
      'Quæ autem sit natura tensionis, intelliges commodisse ex instrumento Drebbeliano, quo temperies aeris exploratur. Ibi enim duplex calor aerem non reddit duplò rariorem exactè; in chordâ verò certum est AC tam expeditè tendi usque ad B quàm DC usque ad E, si supposueris chordam ubique esse uniformem; est enim ut AC ad DC, sic AB, BC ad DE, EC.',
    ],
    translation: [
      'What the nature of tension is, you will understand most conveniently from the Drebbelian instrument by which the temper of the air is tested. For there a double heat does not make the air exactly twice as rare; in a string, however, it is certain that AC is stretched to B as readily as DC to E, if you suppose the string to be uniform throughout; for as AC is to DC, so are AB, BC to DE, EC.',
    ],
  },
  {
    id: 'sweat-1629',
    date: 'between mid-July and 13 September 1629',
    source: 'fol. 347r',
    title: 'How sweat is made',
    head: 'Sudor quo pacto generatur.',
    lang: 'la',
    original: [
      'Sudor generatur hoc pacto: Calor vel ex medicamento vel ex inspiratione calidi aeris etc. rarefacit omnia, quæ in corpore rarefieri possunt, qualia sunt omnia loca quæ aere repleta sunt vel in quibus aer est, eo modo quo aer in instrumento Drebbeliano dilatatur; tum etiam, quæ olei cognationem obtinent etc. Ad hæc non nullibi aqua in vapores resolvitur. Quæ omnia, ita disposita, plus loci requirunt quàm antè, ideòque constringunt et comprimunt intus omnia, atque ita tenuissima (qualis est sudor) per poros venarum et cutis etc. exprimuntur.',
    ],
    translation: [
      'Sweat is made in this way: heat, whether from a medicine or from breathing in warm air etc., rarefies everything in the body that can be rarefied, such as all the places that are filled with air or have air in them, in the way that the air in the Drebbelian instrument expands; then also whatever is akin to oil, etc. Besides, in some places water is resolved into vapours. All these, so disposed, need more room than before, and so they tighten and squeeze everything within, and thus the thinnest things (such as sweat) are pressed out through the pores of the veins and skin etc.',
    ],
  },
  {
    id: 'mersenne-1630',
    date: '30 April 1630',
    source: 'letter to Marin Mersenne',
    title: 'To Mersenne: the air in the glass neither grows nor shrinks',
    lang: 'la',
    original: [
      '[…] aqua enim et aer essentia omninò differunt et in instrumento Drebbeliano, quo calor temporis exploratur, aer nec augetur nec (nisi id vitij accusaveris) unquam minuitur.',
    ],
    translation: [
      '[…] for water and air differ wholly in essence, and in the Drebbelian instrument by which the heat of the weather is tested, the air is neither increased nor (unless you put it down to some fault) ever lessened.',
    ],
  },
  {
    id: 'letter-note-1631',
    date: '16 March 1631',
    source: 'fol. 379v',
    title: 'He copies Drebbel’s letter to the King, and designs the clock',
    head: 'Horologium perpetuum construere.',
    lang: 'nl',
    original: [
      'Gisteren, synde den 15en Meerte 1631, hebbe ick eenen brief van Cornelis Drebbel aen den Coninck van Engelandt geschreven, hiervóór op een ledich bladt gecopieert. In denwelcken hy onder anderen schryft, dat hy een horologie maken kan dat altyt loopen sal; ende alst een weynich verloopen is, dat het dan als de Sonne schynt, wederom terecht kommen sal.',
      'Dit kan gedaen worden met eenen hollen back, also gestelt dat de Sonne winter ende somer om eenselve uere op eenselve plaetse schynt, twelck op de manniere van de sonnewysers moet geordineert worden […] Nu van binnen moetender interstitia gemaeckt worden dat elck quartier van de uere een caviteyt appart heeft, wiens locht de Sonne schynende op de superficie, door syn warmte verdunnen sal; dewelcke, meerder plaetse soeckende, moet gedirigeert werden, daerse het wyserken effen op die uere ende quartiere dryven kan.',
    ],
    translation: [
      'Yesterday, being the 15th of March 1631, I copied a letter of Cornelis Drebbel, written to the King of England, onto an empty leaf earlier in this book. In it he writes, among other things, that he can make a clock that will run for ever; and that when it has gone a little astray, it will come right again when the Sun shines.',
      'This can be done with a hollow vessel, so placed that winter and summer the Sun shines at the same hour on the same place, which must be laid out in the manner of sundials […] Inside, partitions must then be made so that each quarter of the hour has a cavity of its own, whose air the Sun, shining on the surface, will thin by its warmth; and this air, seeking more room, must be so led that it can drive the little pointer exactly to that hour and quarter.',
    ],
  },
  {
    id: 'letter-1631',
    date: 'copied 15 March 1631',
    source: 'fol. 294v–295v',
    title: 'Drebbel’s letter to King James, as Beeckman copied it',
    head: 'Ad verbum exscripta epistola Corn. Drebbelij ad Regem Angliae, 15e Meerte 1631.',
    lang: 'la',
    original: [
      '[…] Primò habeo modum omnia horologia perfectè movendi per motum perpetuum, ita ut seipsa dirigant et moveant, aut, quod magis est, si index duabus aut tribus circiter horis plus æquo manè aut serò protundatur vel retrahatur, ille ab veram horam et minutam diei redibit Sole lucente, cujus specimen vidit imperator Rudolphus.',
      'Secundò conficere possum instrumentum quo litteræ per miliare Anglicum legi poterunt, nec ambigo quin, si M.Vª velit mihi sumptu succurrere (uti spero), fore ut tantum præstando sim, quo litteræ legi possint plus minus 5, 6 aut 7 miliaribus; nec literarum caracteres vulgo majores sunto. Cujus quoque instrumenti V.M. ea videre poterit quæ circiter per 8 aut 10 milliaria fiunt, æquè benè ac si in proprio V.Mᵗⁱˢ cubiculo acciderent. Nec sunt hæcce mea instrumenta similia vulgaribus vitreis opticis: non possunt enim multiplicari.',
      'Tertiò et notitiam habeo omnis generis componendi instrumenta musica quæ ☉ᵉ lucente sponte lucant et suavissimum sonum edant, cujus rude solum specimen Vestra M. vidit, quæ, inquam, perfectiùs et absolutiùs perficere statueram, eo nimirum modo ut vela et portæ dictorum instrumentorum spontè aperiantur et ☉ splendente suavissimum faciant concentum musicum; ac denuò ☉ obnubilato, vela et portae eorundem per se spontè claudantur. Præterea huic musico instrumento (vulgo virginals) jungere decreveram fontem ex quo manarent duæ scaturigines perpetuò fluentes, et ☉ lucente inde prodibunt 100 diversi et varij rivuli aspectu longè jucundissimi; Neptunus etiam prodibit ex rupe vel petrâ, comitatus Tritonibus et deabus marinis, lavantes se aquâ promanante coram altari Neptuni.',
      'Super quod et videri poterit vitrum aquâ plenum, fluens et refluens debito tempore ut mare, singulis 24 horis circiter 40 minutis bis ascendens et descendens, eâ perfectione ut ex ascensu et descensu aquæ agnosci possint horæ et minutæ diei, semper seipsum spontè dirigens. Verùm ☉ᵉ nubilato aut occidente, scaturigines finem fluendi facient, duabus supradictis exceptis quæ æternum manabunt; et Neptunus cum suo consortio se rursus in rupem vel petram conferet tanquam vehementer deflens absentiam et jacturam splendoris ☉ⁱˢ. Adhæc Phœbus ex nubibus prodibit cythara ludens, curruique insidens suo cum 4 equis volantibus, qui putabuntur in aere pendere per modum alarum; rotæ quoque dicti currûs movebuntur; ☉ obnubilato Phœbus sub nubibus se abscondet. Quæ omnia per solos ☉ⁱˢ radios absque ullâ ope fient. Si V.M. cuperet oculos suos refocillare hisce artificiosis motionibus cœlo integro obnubilato, eas agitare nihilominùs poterit calidâ nimirum manu parvum vitrum tangendo.',
      '[…] Quam industriùs et sedulus fuerim subinde meis inventionibus, ut V.Mᵗⁱ cum jucundâ delectatione gratificarer, pro quibus nihil adhuc accepi remunerationis a V.Mᵗᵉ. Quapropter confido fore ut V.M. non sit planè depositura memoriam clementissimi promissi, sed gratiosè me cohonestatura sumptu vel pensione annuâ quâ possim me et familiam meam honestè alere et hac ratione ad majora fructuosiora stimuler inventa quæ sint V.M. magis arrisura. […]',
    ],
    translation: [
      '[…] First, I have a way of moving all clocks perfectly by perpetual motion, so that they direct and move themselves; or, what is more, if the hand be pushed forward or drawn back some two or three hours too far, in the morning or the evening, it will return to the true hour and minute of the day when the Sun shines; a specimen of which the Emperor Rudolf saw.',
      'Second, I can make an instrument by which letters can be read at an English mile, and I do not doubt that, if Your Majesty will help me with the cost (as I hope), I shall achieve so much that letters may be read at 5, 6 or 7 miles, more or less; and the characters need be no larger than usual. By this instrument Your Majesty will also be able to see what is done some 8 or 10 miles off, as well as if it happened in Your Majesty’s own chamber. Nor are these instruments of mine like the common optical glasses: for they cannot be multiplied [?].',
      'Third, I also know how to put together musical instruments of every kind which, when the Sun shines, play [?] of themselves and give a most sweet sound, of which Your Majesty has seen only a rough specimen; these, I say, I had resolved to finish more perfectly and completely, namely so that the curtains and doors of the said instruments open of themselves and, when the Sun shines, make a most sweet concert of music; and again, when the Sun is clouded, their curtains and doors close of themselves. Moreover I had decided to join to this musical instrument (commonly virginals) a fountain from which two springs would flow perpetually, and when the Sun shines a hundred different and varied streams will come forth from it, most pleasant to see; Neptune too will come out of a rock, accompanied by Tritons and sea-goddesses, washing themselves in the water flowing before Neptune’s altar.',
      'Above it there will also be seen a glass full of water, flowing and ebbing at its due time like the sea, rising and falling twice in every 24 hours and about 40 minutes, with such perfection that the hours and minutes of the day can be known from the rise and fall of the water, always directing itself of its own accord. But when the Sun is clouded or sets, the springs will cease to flow, except the two aforesaid, which will flow for ever; and Neptune with his company will withdraw again into the rock, as if bitterly lamenting the absence and loss of the Sun’s brightness. Besides this, Phoebus will come out of the clouds playing the lyre, seated in his chariot with 4 flying horses, which will seem to hang in the air by their wings; the wheels of the said chariot will also turn; when the Sun is clouded, Phoebus will hide himself under the clouds. All of which will be done by the Sun’s rays alone, without any help. If Your Majesty should wish to refresh your eyes with these artful motions when the whole sky is overcast, you can set them going none the less by touching a small glass with a warm hand.',
      '[…] How industrious and diligent I have been all along with my inventions, so as to gratify Your Majesty with pleasant delight, for which I have as yet received no reward from Your Majesty. I therefore trust that Your Majesty will not wholly lay aside the memory of your most gracious promise, but will graciously honour me with a grant or yearly pension by which I may keep myself and my family honestly, and in this way be spurred to greater and more fruitful inventions that will please Your Majesty more. […]',
    ],
    note: 'These are Drebbel’s words, not Beeckman’s. The heading is Beeckman’s, and he wrote three heads in the margin: Horologium perpetuum Drebbelij beside the first point, Telescopium Drebbelianum beside the second, Instrumenta Drebbeliana Sole lucente agitata beside the third. The letter carries no date. It speaks of Prince Henry as dead and of Drebbel’s return from the Emperor’s court at Prague. After it Beeckman drew three instruments: a glass ball on a marked tube with a wooden foot (basis lignea), a tall tapering tube standing over a small object, and a board set up “in camera clausâ ut in tabulâ appareant” [?], in a closed chamber so that things appear on the board. The drawings are not reproduced here.',
  },
  {
    id: 'neuburg-1633',
    date: '24 August 1633, Dordrecht',
    source: 'fol. 420v–421r',
    title: 'Moriaen: a perpetual clock offered to the Duke of Neuburg',
    head: 'Horolgium perpetuum facere.',
    lang: 'nl',
    original: [
      'Monsieur Moriaen, den goeden vriendt van myn swagher Justinus van Assche, seyde my hier te Dordrecht, den 24 Aug. 1633, dat de schoonsoon van Drebbel, den Hertoch van Nieuburgh tot Dusseldorp, nu onlanckx gepresenteert heeft te maken een eeuwichduerende horologium, hetwelcke een weynich des snachs ende andersins uyt syn juyste order geloopen synde, wederom op syn plaetse gaet staen, so haest als de Sonne daerop schyndt. Hy seght, dat het int kleyn al gemaeckt is geweest ende van den Hertoch voorss. gesien, dewelcke den voorss. swager van Drebbel beloofde thienduysent ryckxdaelders te geven om voor hem een diergelycke int groot te maken, twelck geschiet soude hebben, hadden des vorsts ondersaten dat niet verhindert. Ende hem is duysent rycksdalers geschonken tot vereeringhe, voor syn verledt, etc.',
      'Moriaen voorss. seyde, dat hy anders niet en wist hoet gemaeckt was, dan datter quicksilver toe gebesicht wort. Doch ick geloove liever dat hy door het gebruyck van quicksilver de ondersoeckers heeft willen abuseren, ende dat het met allerhande gewichte wel teweghe gebracht kan worden, ende dat, na myn fantasie, op de volgende wyse:',
      'Ick gisse het fondament van syn inventie, ofte ten minste so ist van de myne, te wesen de schaduwe, die den styl, ofte wyser, van het horologie geeft, want die maeckt de plaetse, daerse op schyndt, koelder dan eenighe andere plaetse op het geheel vlack des sonnewysers […]',
      '[…] Als de Sonne niet en schynt, so gaet het uerwerck om dat aen den asch vast is, ende het gewichte, dat het uerwerck doet gaen, wort altyt opgelicht als de Sonne schynt; want dan en behoevet niet te gaen, omdat dan de Sonne selve het werck doet.',
    ],
    translation: [
      'Monsieur Moriaen, the good friend of my brother-in-law Justinus van Assche, told me here at Dordrecht, on 24 Aug. 1633, that Drebbel’s son-in-law has lately offered the Duke of Neuburg at Düsseldorf to make an everlasting clock which, when it has run a little out of its true order at night or otherwise, goes back to its place as soon as the Sun shines on it. He says that it has already been made in small and seen by the said Duke, who promised the said son-in-law [swager in the manuscript] of Drebbel ten thousand rixdollars to make one like it for him on a large scale, which would have been done had the prince’s subjects not prevented it. And a thousand rixdollars were given him as a present, for his loss of time, etc.',
      'The said Moriaen said that he knew nothing more of how it was made than that quicksilver is used in it. But I rather believe that by the use of quicksilver he meant to mislead inquirers, and that it can well be done with any kind of weight, and that, to my fancy, in the following way:',
      'I guess the foundation of his invention, or at least it is that of mine, to be the shadow cast by the style, or pointer, of the dial, for it makes the place it falls on cooler than any other place on the whole face of the sundial […]',
      '[…] When the Sun does not shine, the clockwork fixed to the axle goes on, and the weight that drives the clockwork is always lifted when the Sun shines; for then it need not go, because then the Sun itself does the work.',
    ],
  },
  {
    id: 'quicksilver-1634',
    date: 'between 1 August and 15 October 1634',
    source: 'fol. 451v',
    title: 'Van Assche: quicksilver in the perpetual motion',
    head: 'Horologium perpetuum.',
    lang: 'nl',
    original: [
      'De glasen in perpetuo horologio quod antè descripsi, moeten in diepe bysondere holen staen, also en sal de Sonne altyt maer in één seffens schynen.',
      'Drebbel, seght Van Assche, besicht in syn motu perpetuo quicksilver, ick achte, omdat het swaerste synde, langhst beweecht, gelyck een swaer gewicht aen een touwken hangende, langher waggelt dan een lichter.',
    ],
    translation: [
      'The glasses in the perpetual clock which I described before must stand in deep separate hollows; then the Sun will only ever shine into one at a time.',
      'Drebbel, says Van Assche, uses quicksilver in his perpetual motion; I think because, being the heaviest, it keeps moving longest, as a heavy weight hanging on a cord swings longer than a lighter one.',
    ],
  },
  {
    id: 'deathbed-1634',
    date: '15 October 1634, The Hague',
    source: 'fol. 458v',
    title: 'Sibertus Kuffler on what Drebbel said on his deathbed',
    head: 'Cufles Drebbels swager, de Drebbel.',
    lang: 'nl',
    original: [
      'Sibertus Cufler, Drebbels swagher, seyde my dat syn schoonvader op syn dootbedde seyde dat hy perfecte telescopia maken konde, waermede syn kinderen alleen ryck souden konnen worden; doch stierf eer hy dat schreef. — 15en October 1634 in den Haghe.',
      'Seyde oock dat hy in een doncker kamer in de locht konde doen schynen wat hy wilde. Ick achte dat dit is tgene hy in eenen brief schryft dat hy sichselven kan subitelick veranderen in een leeuw, boom, etc., te weten buyten de donckere camer int licht staende, ende by beurte het een ofte het ander in syn plaetse stellende. Doch Sibertus voorseyt seyde dat hy het niet doen en konde.',
    ],
    translation: [
      'Sibertus Cufler, Drebbel’s son-in-law [swagher], told me that his father-in-law said on his deathbed that he could make perfect telescopes, by which alone his children could grow rich [or: all his children; the manuscript has alleen]; but he died before he wrote it down. 15 October 1634, at The Hague.',
      'He also said that in a dark room he could make whatever he wished appear in the air. I think this is what he writes of in a letter, that he can suddenly change himself into a lion, a tree, etc., namely by standing outside the dark chamber in the light and putting now one thing, now another in his place. But the said Sibertus said that he could not do it.',
    ],
  },
];
