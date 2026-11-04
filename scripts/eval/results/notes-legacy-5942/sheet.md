# #5942 legacy syntaxes — spot-check sheet (30 pages, old prompt versions, seed 5942)

Syntaxes covered: [interpolation], [[page number:]], [[vocabulary:]], [[margin:]], [[image:]], [[notes:]], [[meta:]], [[summary:]], [[keywords:]], bracketed image paragraph, free-text Vocabulary section, [[gloss:]], [[other label:]], (Note: …), Translator's note:, [[markup:]], [[language:]], [Note: …], [[header:]], [[insert:]], [[abbrev:]], [[term:]], → in a term, [[signature:]], code fence, plain Summary: line

## 1. The Notebooks of Leonardo da Vinci — p. 711

https://sourcelibrary.org/book/the-notebooks-of-leonardo-da-vinci-richter/page/6991e93135ed50020acc171f · prompt v2 · syntaxes: [interpolation]

**Raw `translation.data`**

````text
<meta>This page continues Leonardo’s observations on wave formation and current dynamics, specifically how obstructions in a canal create continuous waves and how water behaves at different depths and speeds.</meta>

<page-num>697</page-num>
<header>THE NATURE OF WATER</header>

the bottom or the sides of the canal; and if in these places there are no particular objects, then by what has been said, no wave will be created. This water is moved by minute upward movements that only rise slightly from the bottom, so they do not make waves by reaching the surface.

The simple half-cylindrical wave <note>This refers to the "standing waves" or ripples formed when water flows over an obstruction.</note> is formed upon some small object that is joined to the bank; the water that strikes it there makes a long wave in the shape of a half-column, which takes its course diagonally towards the opposite bank, where it dies out and is reborn.

<margin>Manuscript F, folio 93 verso</margin>
Let *a* be the object placed upon the bank *a o* of the canal *n o m p*. I say that the water which strikes upon this object will make a wave which, by being continually reformed, will also make itself continuous. It would always be so if it were not interrupted by the common course of the water of the canal, which strikes this wave and drives it unceasingly at every point along its length, so that in the end, it directs the wave according to the water's ordinary course.

### [Currents and falls of water]

In water of ordinary speed, the water in the middle will have tiny ripples. The water located between the surface level and the bed is not of the same nature as the surface; for this surface level receives the impact <note>original: "percussion"</note> of both the falling and the reflected <note>ori
… [1572 more characters]
````

**Clean `text` (annotation-layer/3)**

````text
the bottom or the sides of the canal; and if in these places there are no particular objects, then by what has been said, no wave will be created. This water is moved by minute upward movements that only rise slightly from the bottom, so they do not make waves by reaching the surface.

The simple half-cylindrical wave is formed upon some small object that is joined to the bank; the water that strikes it there makes a long wave in the shape of a half-column, which takes its course diagonally towards the opposite bank, where it dies out and is reborn.

Manuscript F, folio 93 verso
Let *a* be the object placed upon the bank *a o* of the canal *n o m p*. I say that the water which strikes upon this object will make a wave which, by being continually reformed, will also make itself continuous. It would always be so if it were not interrupted by the common course of the water of the canal, which strikes this wave and drives it unceasingly at every point along its length, so that in the end, it directs the wave according to the water's ordinary course.

### [Currents and falls of water]

In water of ordinary speed, the water in the middle will have tiny ripples. The water located between the surface level and the bed is not of the same nature as the surface; for this surface level receives the impact of both the falling and the reflected water. For both to remain within the boundary, one falls upon the other water, striking the air like a heavy object, and as a heavy object, it penetrates the water it has struck.

Manuscript F, folio 94 recto
The water falls at first, then rises up again, lifting itself with its semi-cylindrical wave above the opposing semi-cylindrical wave that made its fall more slanted.

### [The current of rivers]

Water that descends in a straight river a
… [551 more characters]
````

**Annotations** (14)

| # | type | tag | anchor (exact) | body |
|---|---|---|---|---|
| 1 | meta | meta | *page* | This page continues Leonardo’s observations on wave formation and current dynamics, specifically how obstructions in a c |
| 2 | pagedata | page-num | *page* | 697 |
| 3 | pagedata | header | *page* | THE NATURE OF WATER |
| 4 | note | note | “simple half-cylindrical wave” | This refers to the "standing waves" or ripples formed when water flows over an obstruction. |
| 5 | margin |  | “Manuscript F, folio 93 verso” |  |
| 6 | original | note | “receives the impact” | original: "percussion" |
| 7 | original | note | “and the reflected” | original: "reflex" |
| 8 | margin |  | “Manuscript F, folio 94 recto” |  |
| 9 | note | note | “obstruction is [lesser” | The text here breaks off, but the principle describes how friction at the banks and the bed creates different speeds and |
| 10 | summary | summary | *page* | Leonardo explains how bank obstructions create continuous diagonal waves and describes the complex, non-linear flow of w |
| 11 | keywords | keywords | *page* | fluid dynamics, hydraulics, wave formation, river currents, standing waves, Manuscript F, Leonardo da Vinci |
| 12 | interp | interp | “[Currents and falls of water]” |  |
| 13 | interp | interp | “[The current of rivers]” |  |
| 14 | interp | interp | “[lesser]” |  |

**Reader notes-off vs parser notes-off** (`[-reader only-]` `{+parser only+}`): same words

## 2. Erzählungen zum Vergnügen und zur Seelenbildung — p. 247

https://sourcelibrary.org/book/stories-for-pleasure-and-edification-eckartshausen/page/6909f604cf28baa1b4cb0ebd · prompt v2 · syntaxes: [[page number:]], [[vocabulary:]], [[margin:]]

**Raw `translation.data`**

````text
<meta>This page continues the narrative from page 237, where the knight Herman encountered a sighing spirit in a wasteland and offered it his friendship. Here, the spirit accepts that offer in a terrifying manner.</meta>

[[page number: 238]]

-> --- <-

It seemed as if the ghost were friendlier. "Follow me," it cried, "Herman! Follow me!" Herman followed the ghost as well. This spirit led him to the peak of a rock, where there was a large opening. "You have offered me your friendship," cried the ghost—"well then! You shall be my friend, and remain my friend." Here the ghost wrapped its ice-cold arm around Herman’s neck, pulled him with it into the opening, and like an arrow they sped deep down beneath the earth, almost to the **outer courts of hell** <note>original: "Vorhöfe der Hölle." This refers to the vestibule or the regions immediately preceding the entrance to the underworld, a common image in literature of the period.</note>.

Here!—yet I do not wish to tell my readers just yet what befell the bold Herman—good or evil. He shall tell us himself when he emerges from his hell again; and if he comes out no more, then we shall pity him, the noble knight <note>The narrator uses a "cliffhanger" device here, a popular technique in 18th-century Gothic fiction to build suspense before shifting the focus of the story.</note>.

Three whole days had already passed, during which Herman’s friends searched for their companion in vain. The gruesome thunderstorm was over; the rain and the hail, which had scattered the heroes, subsided. But all effort was in vain; no one knew where Herman was.

[[margin: Rein-]] <note>This is a catchword, a common printing practice where the first syllable of the next page is printed at the bottom of the current one to aid the bookbinder.</note>

… [371 more characters]
````

**Clean `text` (annotation-layer/3)**

````text
-> --- <-

It seemed as if the ghost were friendlier. "Follow me," it cried, "Herman! Follow me!" Herman followed the ghost as well. This spirit led him to the peak of a rock, where there was a large opening. "You have offered me your friendship," cried the ghost—"well then! You shall be my friend, and remain my friend." Here the ghost wrapped its ice-cold arm around Herman’s neck, pulled him with it into the opening, and like an arrow they sped deep down beneath the earth, almost to the **outer courts of hell**.

Here!—yet I do not wish to tell my readers just yet what befell the bold Herman—good or evil. He shall tell us himself when he emerges from his hell again; and if he comes out no more, then we shall pity him, the noble knight.

Three whole days had already passed, during which Herman’s friends searched for their companion in vain. The gruesome thunderstorm was over; the rain and the hail, which had scattered the heroes, subsided. But all effort was in vain; no one knew where Herman was.

Rein-
````

**Annotations** (9)

| # | type | tag | anchor (exact) | body |
|---|---|---|---|---|
| 1 | meta | meta | *page* | This page continues the narrative from page 237, where the knight Herman encountered a sighing spirit in a wasteland and |
| 2 | original | note | “courts of hell” | original: "Vorhöfe der Hölle." This refers to the vestibule or the regions immediately preceding the entrance to the und |
| 3 | note | note | “the noble knight” | The narrator uses a "cliffhanger" device here, a popular technique in 18th-century Gothic fiction to build suspense befo |
| 4 | note | note | “Rein-” | This is a catchword, a common printing practice where the first syllable of the next page is printed at the bottom of th |
| 5 | summary | summary | *page* | Herman is abducted by the ghost and taken deep underground into a cavernous opening; meanwhile, his companions search fo |
| 6 | keywords | keywords | *page* | Gothic fiction, kidnapping, underworld, suspense, Herman, chivalry, supernatural |
| 7 | pagedata | [[page number]] | *page* | 238 |
| 8 | vocab | [[vocabulary]] | *page* | **Ghost**, **Rock**, **Opening**, **Outer courts of hell**, **Knight** |
| 9 | margin | [[margin]] | “Rein-” |  |

**Reader notes-off vs parser notes-off** (`[-reader only-]` `{+parser only+}`): 

````text
{+->+}
{+<-+}
````

## 3. Cosmographia (Geography) — p. 10

https://sourcelibrary.org/book/geography-ptolemy/page/694fd604435f95fd0c955920 · prompt v1 · syntaxes: [[image:]]

**Raw `translation.data`**

````text
<meta>This page transitions from Nicolaus Germanus’s introductory preface to the actual text of Claudius Ptolemy’s "Cosmographia." It defines the fundamental difference between "Cosmography" (global mapping) and "Chorography" (regional mapping), a distinction that shaped geography for centuries.</meta>

-> ### 50. <-

[[image: Woodcut showing a seated astronomer, likely Ptolemy, looking at a terrestrial or celestial globe and holding a compass. A quadrant hangs on the wall behind him, symbolizing the mathematical tools required for global geography.]]

<margin>Parts of cosmography</margin>

**COSMOGRAPHY is a descriptive**
**imitation of the whole known world,**
**along with those things which**
**are joined to it almost universally.**
**It differs from <term>Chorography</term>** <note>original: "corographia"; the practice of describing or mapping specific regions or localities in great detail.</note>
**in this: For chorography is particular,**
**cutting away places from the whole, and by itself**
**it treats each of them, describing almost every**
**single smallest thing gathered from its locations,**
**such as ports, farms, villages, the courses of rivers,**
**and other such places. It is the property of Cosmography**
**to show one and the same habitable earth known to us,**
**how it is held in nature and position. Concerning**
**these things, it intends only those which, through**
**more general descriptions of the world, are joined**
**together, such as the major towns, great cities, mountains,**
**and also the more famous rivers. Furthermore, it concerns**
**all those things which, according to any species, are**
**worthy of greater note. The end of chorography is to observe**
**a part of the whole individually, as if one were to paint**
**just an ear or an eye. Bu
… [4204 more characters]
````

**Clean `text` (annotation-layer/3)**

````text
-> ### 50. <-

Parts of cosmography

**COSMOGRAPHY is a descriptive**
**imitation of the whole known world,**
**along with those things which**
**are joined to it almost universally.**
**It differs from Chorography**
**in this: For chorography is particular,**
**cutting away places from the whole, and by itself**
**it treats each of them, describing almost every**
**single smallest thing gathered from its locations,**
**such as ports, farms, villages, the courses of rivers,**
**and other such places. It is the property of Cosmography**
**to show one and the same habitable earth known to us,**
**how it is held in nature and position. Concerning**
**these things, it intends only those which, through**
**more general descriptions of the world, are joined**
**together, such as the major towns, great cities, mountains,**
**and also the more famous rivers. Furthermore, it concerns**
**all those things which, according to any species, are**
**worthy of greater note. The end of chorography is to observe**
**a part of the whole individually, as if one were to paint**
**just an ear or an eye. But the end of Cosmography is to**
**inspect the whole according to proportion, as if one**
**were to designate the entire head. For in complete**
**images, since it is necessary for the more important members**
**to be applied first, then those things which images**
**and pictures receive are placed with equal dimension**
**between themselves, and they can be discerned by sight**
**from a proper distance, whether they are the whole or a part**
**of that which is being painted. It follows, not unworthily**
**nor beside the point, that we attribute to chorography**
**whatever are even the smallest things, but to Cosmography**
**the regions themselves with those things which are**
**more gener
… [2924 more characters]
````

**Annotations** (11)

| # | type | tag | anchor (exact) | body |
|---|---|---|---|---|
| 1 | meta | meta | *page* | This page transitions from Nicolaus Germanus’s introductory preface to the actual text of Claudius Ptolemy’s "Cosmograph |
| 2 | margin |  | “Parts of cosmography” |  |
| 3 | term |  | “Chorography” |  |
| 4 | original | note | “differs from Chorography” | original: "corographia"; the practice of describing or mapping specific regions or localities in great detail. |
| 5 | note | note | “for the former” | chorography |
| 6 | term |  | “parallel” |  |
| 7 | definition | note | “parallel” | a line of latitude on the celestial sphere |
| 8 | summary | summary | *page* | This page defines Cosmography as a mathematical, global science focused on proportion and celestial positioning, contras |
| 9 | keywords | keywords | *page* | Cosmography, Chorography, Claudius Ptolemy, geography vs cartography, mathematical geography, habitable world, celestial |
| 10 | image | [[image]] | “” | Woodcut showing a seated astronomer, likely Ptolemy, looking at a terrestrial or celestial globe and holding a compass.  |
| 11 | image | [[image]] | “” | Ornate woodcut initial 'V' decorated with floral patterns |

**Reader notes-off vs parser notes-off** (`[-reader only-]` `{+parser only+}`): 

````text
{+-> ###+}
{+<-+}
````

## 4. Das Schach- oder König-Spiel — p. 151

https://sourcelibrary.org/book/the-game-of-chess-gustavus-selenus/page/699fcd499ff0f1d2c45180f9 · prompt none · syntaxes: [[notes:]], [[meta:]], [[summary:]], [[keywords:]], [[margin:]]

**Raw `translation.data`**

````text
[[meta: This page continues the definitions of tactical maneuvers in chess, moving from general attacks and pins to the specific mechanics of "discovered checks" and the nature of checkmate.]]

-># Of the Game of Chess.<-

[[margin: 1. cap:]]
This happens not openly, but only through the uncovering of a stone; namely, when that same stone—which stands between a King and another stone that could otherwise give Check if the line to the King were free and open—is moved forward, and thus uncovers the other stone so that it gives Check to the King, it is called a **Discovered Check.** [[notes: The author uses the term "Ab-Schach" (literally "off-check") for what modern players call a discovered check.]] If, however, the stone moved away reveals two stones against the King in such a manner (as an example can be found in the third book, chapter 4, number 16), it is called a double **Discovered Check.** Now, through this **Discovered Check**, one can often trap a good stone by moving the displaced stone onto it. For after the opponent’s King is forced to move out of the Check, one can, in the following move, obtain that good stone—which was trapped in the preceding move—without any resistance. If, however, Check is given simultaneously by the stone which was moved and the **Discovered Check** brought about by the other stone, it is called a **Double Check** or **Check and Discovered Check.**

A **Discovered Check** is given by all stones, even by the King himself (with the exception of the Queen), but not by all of them [[notes: This distinction refers to which piece is *moved* to reveal the check. The Queen is rarely the piece that moves "out of the way" to reveal another, as she is usually the most powerful piece being revealed.]]. Regarding the Queen, it happens through a so
… [2075 more characters]
````

**Clean `text` (annotation-layer/3)**

````text
-># Of the Game of Chess.<-

1. cap:
This happens not openly, but only through the uncovering of a stone; namely, when that same stone—which stands between a King and another stone that could otherwise give Check if the line to the King were free and open—is moved forward, and thus uncovers the other stone so that it gives Check to the King, it is called a **Discovered Check.** If, however, the stone moved away reveals two stones against the King in such a manner (as an example can be found in the third book, chapter 4, number 16), it is called a double **Discovered Check.** Now, through this **Discovered Check**, one can often trap a good stone by moving the displaced stone onto it. For after the opponent’s King is forced to move out of the Check, one can, in the following move, obtain that good stone—which was trapped in the preceding move—without any resistance. If, however, Check is given simultaneously by the stone which was moved and the **Discovered Check** brought about by the other stone, it is called a **Double Check** or **Check and Discovered Check.**

A **Discovered Check** is given by all stones, even by the King himself (with the exception of the Queen), but not by all of them. Regarding the Queen, it happens through a soldier when that same soldier, on the nearest line, captures another soldier or stone ahead of him to the right or left hand, and thus clears the line for her against the opponent's King. Likewise, an Archer, a Rider, a Rook, or even her own King can make a free path for her to the opposing King. In the same manner, one also uncovers a Rook and an Archer to give Check from them to the King of the other side. From the Rider, however, because he can neither be obstructed nor covered, such a **Discovered Check** is not given.

The **Checkmati
… [649 more characters]
````

**Annotations** (11)

| # | type | tag | anchor (exact) | body |
|---|---|---|---|---|
| 1 | meta | [[meta]] | *page* | This page continues the definitions of tactical maneuvers in chess, moving from general attacks and pins to the specific |
| 2 | meta | [[meta]] | *page* | Signature Q ij at the bottom of the page. The catchword "Mat/" indicates that the next page continues the discussion on  |
| 3 | summary | [[summary]] | *page* | This page defines the tactical concepts of discovered checks, double checks, and checkmate. It details how different pie |
| 4 | keywords | [[keywords]] | *page* | Discovered Check, Double Check, Checkmate, Blind Checkmate, Chess Tactics, Soldiers, Archer, Rider, Rook, King, Queen |
| 5 | note | [[notes]] | “King, it is called a **Discovered Check” | The author uses the term "Ab-Schach" (literally "off-check") for what modern players call a discovered check. |
| 6 | note | [[notes]] | “all of them” | This distinction refers to which piece is *moved* to reveal the check. The Queen is rarely the piece that moves "out of  |
| 7 | note | [[notes]] | “through a soldier” | "Soldaten" or soldiers refers to the pawns |
| 8 | note | [[notes]] | “Likewise, an Archer” | "Schütze," the historical name for the Bishop |
| 9 | note | [[notes]] | “Archer, a Rider” | "Reuter," the Knight |
| 10 | note | [[notes]] | “is not given” | Since the Knight leaps over other pieces, no piece can stand on a line "behind" it to be revealed when the Knight moves |
| 11 | margin | [[margin]] | “1. cap:” |  |

**Reader notes-off vs parser notes-off** (`[-reader only-]` `{+parser only+}`): 

````text
{+->#+}
[-.-]
{+.<-+}
[-\.-]
{+.+}
[--]
[--]
[--]
[--]
````

## 5. Utriusque Cosmi Historia Vol. 2 — p. 18

https://sourcelibrary.org/book/history-of-both-worlds-microcosm-fludd/page/6952dac977f38f6761bc6cc2 · prompt none · syntaxes: bracketed image paragraph, [interpolation]

**Raw `translation.data`**

````text
16

[Decorative woodcut headpiece with floral and scroll motifs]

# Contents

TREATISE I.

This treatise
on the microcosm
according to nature
is divided into two
sections, in
which
*   The first narrates the metaphysical & physical
    history of the Microcosm, in which three things
    are explained, namely its
    *   Internal or soul, whose
        essence is of a threefold
        disposition, inasmuch
        as it participates
        in the nature of heaven
        *   Empyrean, whence
            it is called
            *   Mind.
            *   Intellect.
            *   Reason.
        *   Ethereal, whence
            it is called
            *   Vegetative.
            *   Vital.
        *   Elementary,
            and for this
            reason it is called
            *   Animal.
            *   Sensitive.
            *   Idol.
    *   External or
        body, in
        which two things
        are explained,
        namely its
        *   Principle of Constitution.
        *   Harmony, by which its rebellious parts are bound together in concordant peace.
    *   The Internal in
        the External, that
        is, the operation
        of the soul in the
        body, both in
        *   Creation.
        *   Generation.
*   The second proposes the
    technical history of the
    microcosm, both
    internal and external
    nature, distributed
    into seven portions,
    namely in
    *   Divination or Prophecy, which is the science of the mind.
    *   Geometry, which is the elucidation of the intentions of the intellectual & rational soul.
    *   The Art of Memory, which is the operation of the memorative & imaginative soul.
    *   Genethlialogy or the inquiry into genius & nativity, which is the science pertaining to the vital soul.
    *   P
… [422 more characters]
````

**Clean `text` (annotation-layer/3)**

````text
16

# Contents

TREATISE I.

This treatise
on the microcosm
according to nature
is divided into two
sections, in
which
*   The first narrates the metaphysical & physical
    history of the Microcosm, in which three things
    are explained, namely its
    *   Internal or soul, whose
        essence is of a threefold
        disposition, inasmuch
        as it participates
        in the nature of heaven
        *   Empyrean, whence
            it is called
            *   Mind.
            *   Intellect.
            *   Reason.
        *   Ethereal, whence
            it is called
            *   Vegetative.
            *   Vital.
        *   Elementary,
            and for this
            reason it is called
            *   Animal.
            *   Sensitive.
            *   Idol.
    *   External or
        body, in
        which two things
        are explained,
        namely its
        *   Principle of Constitution.
        *   Harmony, by which its rebellious parts are bound together in concordant peace.
    *   The Internal in
        the External, that
        is, the operation
        of the soul in the
        body, both in
        *   Creation.
        *   Generation.
*   The second proposes the
    technical history of the
    microcosm, both
    internal and external
    nature, distributed
    into seven portions,
    namely in
    *   Divination or Prophecy, which is the science of the mind.
    *   Geometry, which is the elucidation of the intentions of the intellectual & rational soul.
    *   The Art of Memory, which is the operation of the memorative & imaginative soul.
    *   Genethlialogy or the inquiry into genius & nativity, which is the science pertaining to the vital soul.
    *   Physiognomy or the investigation of the vital & natural soul th
… [360 more characters]
````

**Annotations** (1)

| # | type | tag | anchor (exact) | body |
|---|---|---|---|---|
| 1 | image | [image] | “” | Decorative woodcut headpiece with floral and scroll motifs |

**Reader notes-off vs parser notes-off** (`[-reader only-]` `{+parser only+}`): same words

## 6. 新編直指算法統宗 (Suanfa Tongzong: Systematic Treatise on Arithmetic) Vol 3 — p. 26

https://sourcelibrary.org/book/suanfa-tongzong-systematic-treatise-on-arithmetic-vol-3-dawei/page/6992cbf3018b80967354c679 · prompt v2 · syntaxes: free-text Vocabulary section

**Raw `translation.data`**

````text
<warning>Image shows a grid of geometric diagrams with captions. Some characters are slightly faded or blurred, but identifiable through mathematical context. Captions within each box are read from right to left.</warning>
<meta>Continuity: Following the specific area calculations for hexagons and octagons on the previous page, this page provides a visual reference table for various geometric compositions. It catalogs how complex areas are derived by adding or subtracting basic shapes—triangles, rectangles, and circular segments—using the traditional "out-in complementary" (cut-and-paste) method.</meta>

<margin>Case <unclear>11</unclear></margin>

| | | | |
| :---: | :---: | :---: | :---: |
| <margin><term>Gui (圭): a pointed or isosceles triangle, named after a ceremonial jade tablet</term></margin> Triangle joined with the diagonal of a field | Triangle subtracted from the inner square | Three rectangles joined together | Triangle subtracted from a square field |
| <margin><term>Gougu (勾股): a right-angled triangle; "Gou" is the base and "Gu" is the height</term></margin> Two right triangles joined together | Right triangle joined with a rectangle | Two triangles joined together | Right triangle subtracted from a diagonal |
| <margin><term>Hushi (弧矢): "bow and arrow" geometry, referring to circular segments where "Hu" is the arc and "Shi" is the sagitta</term></margin> Triangle subtracted from a right triangle | Two right triangles joined | Sagitta-arc joined with a triangle | Sagitta-arc subtracted from a triangle |
| <margin>Square Fields</margin> Arc and triangle subtracted from a square | Sagitta-arc subtracted from a rectangle | Trapezoid subtracted from a square field | Two rectangles joined together |
| <margin><unclear>Section</unclear></margin> Crescent moon s
… [1604 more characters]
````

**Clean `text` (annotation-layer/3)**

````text
Case 11

| | | | |
| :---: | :---: | :---: | :---: |
| Gui (圭) Triangle joined with the diagonal of a field | Triangle subtracted from the inner square | Three rectangles joined together | Triangle subtracted from a square field |
| Gougu (勾股) Two right triangles joined together | Right triangle joined with a rectangle | Two triangles joined together | Right triangle subtracted from a diagonal |
| Hushi (弧矢) Triangle subtracted from a right triangle | Two right triangles joined | Sagitta-arc joined with a triangle | Sagitta-arc subtracted from a triangle |
| Square Fields Arc and triangle subtracted from a square | Sagitta-arc subtracted from a rectangle | Trapezoid subtracted from a square field | Two rectangles joined together |
| Section Crescent moon shape subtracted from a section | Sagitta-arc joined with a triangle | Slanted field subtracted from a square | Triangle subtracted from a triangular field |
````

**Annotations** (20)

| # | type | tag | anchor (exact) | body |
|---|---|---|---|---|
| 1 | warning | warning | *page* | Image shows a grid of geometric diagrams with captions. Some characters are slightly faded or blurred, but identifiable  |
| 2 | meta | meta | *page* | Continuity: Following the specific area calculations for hexagons and octagons on the previous page, this page provides  |
| 3 | margin |  | “Case 11” |  |
| 4 | unclear |  | “11” |  |
| 5 | margin |  | “Gui (圭)” |  |
| 6 | term |  | “Gui (圭)” |  |
| 7 | definition | note | “Gui (圭)” | a pointed or isosceles triangle, named after a ceremonial jade tablet |
| 8 | margin |  | “Gougu (勾股)” |  |
| 9 | term |  | “Gougu (勾股)” |  |
| 10 | definition | note | “Gougu (勾股)” | a right-angled triangle; "Gou" is the base and "Gu" is the height |
| 11 | margin |  | “Hushi (弧矢)” |  |
| 12 | term |  | “Hushi (弧矢)” |  |
| 13 | definition | note | “Hushi (弧矢)” | "bow and arrow" geometry, referring to circular segments where "Hu" is the arc and "Shi" is the sagitta |
| 14 | margin |  | “Square Fields” |  |
| 15 | margin |  | “Section” |  |
| 16 | unclear |  | “Section” |  |
| 17 | original | note | “from a section” | original: 覆月 (Fùyuè), literally "overturned moon," a term for a crescent-like segment. |
| 18 | summary | summary | *page* | This page serves as a visual glossary of geometric operations, illustrating twenty different ways to combine or subtract |
| 19 | keywords | keywords | *page* | geometry, area calculation, Gui triangle, Gougu theorem, circular segments, Hushi, mathematical diagrams, traditional Ch |
| 20 | vocab | vocab-section | *page* | ### Technical Vocabulary * **Triangle (Gui 圭):** A triangular shape, often isosceles. * **Right Triangle (Gougu 勾股):** T |

**Reader notes-off vs parser notes-off** (`[-reader only-]` `{+parser only+}`): 

````text
[-### Technical-]
````

## 7. Hypnerotomachie ou discours du songe de Poliphile — p. 18

https://sourcelibrary.org/book/the-strife-of-love-in-a-dream-or-the-discourse-of-the-dream-colonna/page/694c8114c38387390a89597c · prompt v2 · syntaxes: [[margin:]], [[gloss:]]

**Raw `translation.data`**

````text
<meta>This page serves as the opening of the manuscript, introducing the protagonist Poliphile and the beginning of his dream journey. It establishes the tone of courtly love and allegorical wandering.</meta>

# ->BOOK ONE<-

->## Of the sleep that took Poliphile, and how<-
->## IT SEEMED TO HIM WHILE SLEEPING THAT HE<-
*was in a deserted country, and a*
*dark forest.*

How Poliphile, not having...                                                                                                  149
martyrdom, and the content...                                                                                                      151
How Poliphile, why she sent him the...
her, whom he found alone...                                                                                                      152
discourse of her language...                                                                                                      154
revived.
How the soul of Poliphile...                                                                                                   156
his body, and of the accusations...                                                                                                     157
Cupid, and of the cruel...
How Poliphile said that...
arms of his best beloved...
friendship. Then Polia puts...
How Polia all in one...
on the head of Poliphile...
their pastimes taking in...
ble of their loves. S...
How Poliphile makes an end...
and of what the Sun...
among them of his felicity.

->END OF THE CHAPTERS OF POLIPHILE.<-

Of sleep

<insert>**A**</insert>S for a morning in the month of April around the dawn of [[margin: Agrypnia <note>original: "Agrypnie"</note> [[gloss: by sickness]]]] <note>Agrypnia is a Greek-derived term for sleeplessness or insomnia.<
… [2652 more characters]
````

**Clean `text` (annotation-layer/3)**

````text
# ->BOOK ONE<-

->## Of the sleep that took Poliphile, and how<-
->## IT SEEMED TO HIM WHILE SLEEPING THAT HE<-
*was in a deserted country, and a*
*dark forest.*

How Poliphile, not having...                                                                                                  149
martyrdom, and the content...                                                                                                      151
How Poliphile, why she sent him the...
her, whom he found alone...                                                                                                      152
discourse of her language...                                                                                                      154
revived.
How the soul of Poliphile...                                                                                                   156
his body, and of the accusations...                                                                                                     157
Cupid, and of the cruel...
How Poliphile said that...
arms of his best beloved...
friendship. Then Polia puts...
How Polia all in one...
on the head of Poliphile...
their pastimes taking in...
ble of their loves. S...
How Poliphile makes an end...
and of what the Sun...
among them of his felicity.

->END OF THE CHAPTERS OF POLIPHILE.<-

Of sleep

**A**S for a morning in the month of April around the dawn of Agrypnia by sickness
day, I, Poliphile, was in my bed, without other com-
pany than my loyal guard Agrypnia, who
had entertained me all this night in several
matters, and took pains to comfort me: for I
had declared to her the occasion of my sighs. At the end,
as the only remedy for these troubles, and ceasing for all
time, she advised me to forget all
my mourning: then kn
… [1845 more characters]
````

**Annotations** (9)

| # | type | tag | anchor (exact) | body |
|---|---|---|---|---|
| 1 | meta | meta | *page* | This page serves as the opening of the manuscript, introducing the protagonist Poliphile and the beginning of his dream  |
| 2 | insert |  | “**A**” |  |
| 3 | original | note | “dawn of Agrypnia” | original: "Agrypnie" |
| 4 | note | note | “Agrypnia by sickness” | Agrypnia is a Greek-derived term for sleeplessness or insomnia. |
| 5 | unclear |  | “my state” |  |
| 6 | summary | summary | *page* | Poliphile, suffering from unrequited love and insomnia, finally falls into a deep sleep where he begins a vivid dream jo |
| 7 | keywords | keywords | *page* | Poliphile, Polia, Agrypnia, insomnia, dream vision, April, courtly love, internal conflict, Jupiter, allegory |
| 8 | margin | [[margin]] | “Agrypnia by sickness” |  |
| 9 | gloss | [[gloss]] | “by sickness” |  |

**Reader notes-off vs parser notes-off** (`[-reader only-]` `{+parser only+}`): 

````text
{+# ->+}
{+<-+}
{+->##+}
{+<-+}
{+->##+}
{+<-+}
{+->+}
[-.-]
{+.<-+}
````

## 8. Le tres excellent et ancien Jeu Pythagorique, dit Rithmomachie — p. 100

https://sourcelibrary.org/book/le-tres-excellent-et-ancien-jeu-pythagorique-dit-boissiere/page/699fcd509ff0f1d2c45182e4 · prompt none · syntaxes: [[notes:]], [[meta:]], [[summary:]], [[keywords:]], [[other label:]]

**Raw `translation.data`**

````text
[[meta: This page continues the author’s introductory remarks, shifting from the specific mathematical rules of Rythmomachia to a moral and practical defense of the game as a "virtuous recreation" for the reader.]]

->DES PHILOSOPHES.<-
[[notes: "Of Philosophers" — this header likely refers to the "Philosophers' Game," a common alternative name for Rythmomachia during the Renaissance.]]

->G<-
[[notes: This letter "G" is a signature mark, used by early modern printers to keep the folded sheets of the book in the correct order.]]

this virtuous recreation will be more agreeable to him. And in the meantime, I would ask the kind reader that, before judging me for amusing myself with games rather than grave and useful things, he first gain an understanding of the said game and the profit to be gained from it. I am certain he will not consider such recreation useless; seeing even that many who enjoy this game may not only avoid other vain and vicious pastimes (where one can only lose), but can also acquire something of virtue. 

If you compare this recreation with common games [[notes: The author is likely contrasting this intellectual pursuit with gambling games involving dice or cards, which were frequently criticized by 16th-century moralists for ruining a person's character and wealth.]], you will find that it will bring you great profit, whereas from the others you will gain nothing but loss—not only of your goods, but what is worse, of irrecoverable time and, quite often, your friends. I hope, therefore, that the virtuous for whom I have prepared this work will not choose this recreation out of greedy covetousness, but rather to communicate and discuss the use and properties of such noble numbers [[notes: The "noble numbers" are the Pythagorean proportions that form th
… [1237 more characters]
````

**Clean `text` (annotation-layer/3)**

````text
->DES PHILOSOPHES.<-
->G<-
this virtuous recreation will be more agreeable to him. And in the meantime, I would ask the kind reader that, before judging me for amusing myself with games rather than grave and useful things, he first gain an understanding of the said game and the profit to be gained from it. I am certain he will not consider such recreation useless; seeing even that many who enjoy this game may not only avoid other vain and vicious pastimes (where one can only lose), but can also acquire something of virtue. 

If you compare this recreation with common games, you will find that it will bring you great profit, whereas from the others you will gain nothing but loss—not only of your goods, but what is worse, of irrecoverable time and, quite often, your friends. I hope, therefore, that the virtuous for whom I have prepared this work will not choose this recreation out of greedy covetousness, but rather to communicate and discuss the use and properties of such noble numbers, seizing the fruit and utility that come from them. 

Therefore, I do not believe I have worked in vain if some utility can come to anyone from my labor. It remains to be said that if I have used certain terms that are not elegant enough in the French language, or if I have sometimes shortened terms to fit the labels of the diagrams when expressing proportions—such as **multipl.** for *multiplice*, or perhaps **par-**

[[vocab: recreation, games, profit, numbers, utility, proportions, multiple, French]]
````

**Annotations** (8)

| # | type | tag | anchor (exact) | body |
|---|---|---|---|---|
| 1 | meta | [[meta]] | *page* | This page continues the author’s introductory remarks, shifting from the specific mathematical rules of Rythmomachia to  |
| 2 | summary | [[summary]] | *page* | The author defends Rythmomachia as a virtuous alternative to common gambling, arguing that it preserves time and friends |
| 3 | keywords | [[keywords]] | *page* | virtuous recreation, gambling vs. games, Pythagorean numbers, mathematical proportions, moral philosophy, French languag |
| 4 | note | [[notes]] | “” | "Of Philosophers" — this header likely refers to the "Philosophers' Game," a common alternative name for Rythmomachia du |
| 5 | note | [[notes]] | “” | This letter "G" is a signature mark, used by early modern printers to keep the folded sheets of the book in the correct  |
| 6 | note | [[notes]] | “with common games” | The author is likely contrasting this intellectual pursuit with gambling games involving dice or cards, which were frequ |
| 7 | note | [[notes]] | “such noble numbers” | The "noble numbers" are the Pythagorean proportions that form the basis of the game, which were believed to reflect the  |
| 8 | note | [[notes]] | “**multipl.** for *multiplice” | *Multiplice* (multiple) is a technical arithmetic term in the game's logic, referring to a number that contains another  |

**Reader notes-off vs parser notes-off** (`[-reader only-]` `{+parser only+}`): 

````text
{+->+}
[-.-]
{+.<-+}
{+->+}
{+<-+}
[--]
[--]
[-*-]
{+*,+}
[-,-]
````

## 9. Herbarum varias qui vis cognoscere vires — p. 276

https://sourcelibrary.org/book/herbarum-varias-qui-vis-cognoscere-vires-floridus/page/6958e011cf7070242ed42470 · prompt v2 · syntaxes: (Note: …)

**Raw `translation.data`**

````text
<meta>This page continues the discussion of Mallow (Malva), specifically moving from its general consumption as a vegetable to its specialized uses in treating pain, women's health, and internal blockages. It builds on the previous page's introduction of the plant as an "all-healing" remedy.</meta>

The root of a single stalk, when applied to a tooth-
Ache, calms it; it is also said to stimulate sexual desire.
If this same root is carried tied to the thigh with a linen cord,
Or if a woman carries it wrapped in black wool,
They say it overcomes diseases of the breasts.
Olympius of Thebes <note>A 4th-century Greek medical writer often cited in late Roman texts.</note> wrote that it is an abortifacient <note>original: "abortiuum"</note>
If melted goose fat is mixed with it
And if it is applied to the womb as a pessary <term>pessaria <note>a medicinal plug or suppository inserted into the vagina to deliver medication or induce a physiological effect.</note></term>.

---

¶ They said of mallow <note>original: "maluā"</note>, etc. Some have called mallow "all-healing" <note>original: "omnimodiam"</note>. If anyone daily drinks half a cup <term>cyathus <note>a small Roman liquid measure, approximately 1.5 fluid ounces.</note></term> of its juice, they will be free from all diseases. The ancients called it "malva" because it "softens" <gloss>that is, it re-softens a hard and constipated <note>original: "stipticū"; refers to a digestive system that is "stuck" or astringent.</note> belly</gloss>. Sextus Niger <note>An important 1st-century pharmacologist whose work influenced Dioscorides and Pliny.</note>, a most ancient physician, asserts that it is good for the stomach <gloss>that is, a remedy for a dull stomach and the "bad path" <note>referring to intestinal blockages or poor
… [1993 more characters]
````

**Clean `text` (annotation-layer/3)**

````text
The root of a single stalk, when applied to a tooth-
Ache, calms it; it is also said to stimulate sexual desire.
If this same root is carried tied to the thigh with a linen cord,
Or if a woman carries it wrapped in black wool,
They say it overcomes diseases of the breasts.
Olympius of Thebes wrote that it is an abortifacient
If melted goose fat is mixed with it
And if it is applied to the womb as a pessary pessaria.

---

¶ They said of mallow, etc. Some have called mallow "all-healing". If anyone daily drinks half a cup cyathus of its juice, they will be free from all diseases. The ancients called it "malva" because it "softens" that is, it re-softens a hard and constipated belly. Sextus Niger, a most ancient physician, asserts that it is good for the stomach that is, a remedy for a dull stomach and the "bad path". He asserts the same thing; nevertheless, both Niger and Dioscorides admit that when taken as a vegetable it is very beneficial to the internal organs of the belly. They say it treats the bladder in this way, namely for strangury strangurie and dysuria dysurie. They also say it counteracts poisonous—that is, toxic—potions. Furthermore, these authors confirm that a bloody that is, bleeding wound is healed better and more quickly with this than with expensive that is, very precious plasters emplastris. (Note: the word "precious" is used here as a superlative in the style of the orators). These are made from the leaves of mallow and willow ground in equal parts that is, in equal weight. The medical authors themselves add that is, join the fact that mallow mixed with old lard powerfully helps shattered bruised or severely shaken limbs. The root of a single mallow stalk (which, it is added, is also called by another name) settles the pain of a toothache when appli
… [39 more characters]
````

**Annotations** (30)

| # | type | tag | anchor (exact) | body |
|---|---|---|---|---|
| 1 | meta | meta | *page* | This page continues the discussion of Mallow (Malva), specifically moving from its general consumption as a vegetable to |
| 2 | note | note | “Olympius of Thebes” | A 4th-century Greek medical writer often cited in late Roman texts. |
| 3 | original | note | “is an abortifacient” | original: "abortiuum" |
| 4 | term |  | “pessaria” |  |
| 5 | note | note | “a pessary pessaria” | a medicinal plug or suppository inserted into the vagina to deliver medication or induce a physiological effect. |
| 6 | original | note | “said of mallow” | original: "maluā" |
| 7 | original | note | “called mallow "all-healing” | original: "omnimodiam" |
| 8 | term |  | “cyathus” |  |
| 9 | note | note | “a cup cyathus” | a small Roman liquid measure, approximately 1.5 fluid ounces. |
| 10 | gloss |  | “that is, it re-softens a hard and constipated belly” |  |
| 11 | original | note | “hard and constipated” | original: "stipticū"; refers to a digestive system that is "stuck" or astringent. |
| 12 | note | note | “belly. Sextus Niger” | An important 1st-century pharmacologist whose work influenced Dioscorides and Pliny. |
| 13 | gloss |  | “that is, a remedy for a dull stomach and the "bad path"” |  |
| 14 | note | note | “the "bad path” | referring to intestinal blockages or poor digestion. |
| 15 | original | note | “as a vegetable” | original: "olus" |
| 16 | term |  | “strangurie” |  |
| 17 | note | note | “for strangury strangurie” | a condition characterized by a painful, frequent urge to urinate, with the urine passed drop by drop. |
| 18 | term |  | “dysurie” |  |
| 19 | note | note | “and dysuria dysurie” | general term for painful or difficult urination. |
| 20 | gloss |  | “that is, bleeding” |  |
| 21 | gloss |  | “that is, very precious” |  |
| 22 | term |  | “emplastris” |  |
| 23 | note | note | “precious plasters emplastris” | a medicated paste or poultice spread on a cloth and applied to the skin. |
| 24 | original | note | “mallow and willow” | original: "salicis" |
| 25 | gloss |  | “that is, in equal weight” |  |
| 26 | gloss |  | “that is, join” |  |
| 27 | original | note | “with old lard” | original: "adipi uetusto" |
| 28 | gloss |  | “bruised or severely shaken” |  |
| 29 | summary | summary | *page* | This page describes the wide-ranging medicinal applications of mallow, including its use for toothaches, urinary issues  |
| 30 | keywords | keywords | *page* | Mallow, Sextus Niger, toothache, strangury, dysuria, wound healing, Olympius of Thebes, pessary, digestive health |

**Reader notes-off vs parser notes-off** (`[-reader only-]` `{+parser only+}`): 

````text
[-original: "stipticū"; refers to a digestive system that is "stuck" or astringent.-]
{+.+}
[-referring to intestinal blockages or poor digestion..-]
````

## 10. The Mahabharata of Krishna-Dwaipayana Vyasa, Vol. 8 (Shanti Parva) — p. 57

https://sourcelibrary.org/book/the-mahabharata-of-krishna-dwaipayana-vyasa-vol-8-shanti-ganguli/page/69925819ad311253224ccc4b · prompt v5.2026-02 · syntaxes: [interpolation], Translator's note:

**Raw `translation.data`**

````text
<meta>Continuing from page 40, Bhishma concludes his warning about the spiritual dangers of improper teaching and begins a new discourse on the qualities that attract prosperity.</meta>

<page-num>41</page-num>

the wise man who imparted the instruction.⁷³ Therefore, a man of wisdom who desires to earn spiritual merit should always act with wisdom. Instruction that is imparted in exchange for money <note>original: "Satyānrite"; a term for trade or commerce, literally meaning 'truth and falsehood'</note> always corrupts the teacher.⁷⁴ When asked for guidance by others, one should reflect carefully and speak only what is correct. One should impart instruction in such a way that, through the act of sharing knowledge, one earns merit.⁷⁵ I have thus told you everything regarding the subject of instruction. Very often, people fall into great suffering as a result of giving instruction poorly. Hence, it is appropriate that one should be cautious about giving instruction to others.' ”⁷⁶

---

### SECTION XI

“**Yudhishthira** <note>The eldest of the Pandava brothers and the seeker of wisdom in this dialogue</note> said, 'Tell me, O grandsire, in what kind of man or woman, O chief of the **Bharatas** <note>The royal lineage of the protagonists</note>, does the goddess of Prosperity always reside?'¹

“**Bhishma** said, 'In this regard, I shall narrate to you what occurred and what I have heard. Once, princess **Rukmini** <note>The principal wife of Krishna</note> asked this very question in the presence of **Devaki’s son** <note>A title for Krishna</note>.² Beholding the goddess of Prosperity, who was radiant with beauty and possessed the complexion of a lotus, the mother of **Pradyumna** <note>Krishna and Rukmini's son</note>—who carries the device of the **Makara** <term>Makara
… [1774 more characters]
````

**Clean `text` (annotation-layer/3)**

````text
the wise man who imparted the instruction.⁷³ Therefore, a man of wisdom who desires to earn spiritual merit should always act with wisdom. Instruction that is imparted in exchange for money always corrupts the teacher.⁷⁴ When asked for guidance by others, one should reflect carefully and speak only what is correct. One should impart instruction in such a way that, through the act of sharing knowledge, one earns merit.⁷⁵ I have thus told you everything regarding the subject of instruction. Very often, people fall into great suffering as a result of giving instruction poorly. Hence, it is appropriate that one should be cautious about giving instruction to others.' ”⁷⁶

---

### SECTION XI

“**Yudhishthira** said, 'Tell me, O grandsire, in what kind of man or woman, O chief of the **Bharatas**, does the goddess of Prosperity always reside?'¹

“**Bhishma** said, 'In this regard, I shall narrate to you what occurred and what I have heard. Once, princess **Rukmini** asked this very question in the presence of **Devaki’s son**.² Beholding the goddess of Prosperity, who was radiant with beauty and possessed the complexion of a lotus, the mother of **Pradyumna** —who carries the device of the **Makara** Makara on his banner—was filled with curiosity and said these words :³—"Who are the beings by whose side you stay and whom you serve? Who, again, are those whom you do not serve? O you who are dear to the lord of all creatures, tell me this truly, O you who are equal to a great **Rishi** Rishi in your penances and power!"⁴—Thus addressed by the princess, the goddess of Prosperity, with a face as beautiful as the moon and moved by grace, spoke these sweet and charming words in the presence of him who has **Garuda** Garuda on his banner.⁵

“ ' **Sree** Sree said, "O blessed lady, I
… [262 more characters]
````

**Annotations** (20)

| # | type | tag | anchor (exact) | body |
|---|---|---|---|---|
| 1 | meta | meta | *page* | Continuing from page 40, Bhishma concludes his warning about the spiritual dangers of improper teaching and begins a new |
| 2 | pagedata | page-num | *page* | 41 |
| 3 | original | note | “exchange for money” | original: "Satyānrite"; a term for trade or commerce, literally meaning 'truth and falsehood' |
| 4 | note | note | ““**Yudhishthira” | The eldest of the Pandava brothers and the seeker of wisdom in this dialogue |
| 5 | note | note | “of the **Bharatas” | The royal lineage of the protagonists |
| 6 | note | note | “Once, princess **Rukmini” | The principal wife of Krishna |
| 7 | note | note | “of **Devaki’s son” | A title for Krishna |
| 8 | note | note | “mother of **Pradyumna” | Krishna and Rukmini's son |
| 9 | term |  | “Makara” |  |
| 10 | definition | note | “Makara” | a mythical sea-monster, often depicted as a hybrid of a crocodile and a fish |
| 11 | term |  | “Rishi” |  |
| 12 | definition | note | “Rishi” | an enlightened sage or seer |
| 13 | term |  | “Garuda” |  |
| 14 | definition | note | “Garuda” | the divine king of birds and the mount of the god Krishna/Vishnu |
| 15 | term |  | “Sree” |  |
| 16 | definition | note | “Sree” | another name for Lakshmi, the goddess of wealth and good fortune |
| 17 | original | note | “---” | original: "Satyānrite" is equivalent to trade or barter.—Translator's Note. |
| 18 | pagedata | sig | *page* | [ 6 ] |
| 19 | summary | summary | *page* | Bhishma concludes a warning against selling spiritual knowledge for money and begins a new discourse on the virtues that |
| 20 | keywords | keywords | *page* | instruction, spiritual merit, Satyānrite, Yudhishthira, Bhishma, Rukmini, Krishna, Sree, Lakshmi, Prosperity, Makara, Ga |

**Reader notes-off vs parser notes-off** (`[-reader only-]` `{+parser only+}`): same words

## 11. Il nobilissimo et antiquissimo giuoco Pythagoreo nominato Rythmomachia — p. 46

https://sourcelibrary.org/book/il-nobilissimo-et-antiquissimo-giuoco-pythagoreo-nominato-barozzi/page/699fcd379ff0f1d2c4517fe9 · prompt none · syntaxes: [[notes:]], [[meta:]], [[summary:]], [[keywords:]], [[markup:]]

**Raw `translation.data`**

````text
<warning>Visible ghosting/bleed-through of text and tables from the reverse side of the page is present in the lower half.</warning>
[[meta: This page continues the systematic catalog of number sets required for the "Great Victory" in Rithmomachia. Having covered Arithmetic-Musical combinations on the previous page, the author now presents the Geometric-Musical combinations. The catchword "Tauo-" from page 90 correctly introduces the "Tauola" on this page.]]

## Table of all Geometric & Musical proportions that can occur in this game

| Geometric & Musical together | | | | Geometric alone | | | Musical alone | | |
|----------------------|---|---|---|-----------------|---|---|-------------|---|---|
| 2 | 3 | 6 | 12 | 3 | 6 | 12 | 2 | 3 | 6 |
| 3 | 4 | 6 | 9 | 4 | 6 | 9 | 3 | 4 | 6 |
| 3 | 4 | 6 | 12 | 3 | 6 | 12 | 4 | 6 | 12 |
| 3 | 6 | 8 | 12 | 3 | 6 | 12 | 6 | 8 | 12 |
| 4 | 6 | 12 | 36 | 4 | 12 | 36 | 4 | 6 | 12 |
| 5 | 9 | 45 | 225 | 9 | 45 | 225 | 5 | 9 | 45 |
| 9 | 15 | 25 | 45 | 9 | 15 | 25 | 9 | 15 | 45 |
| 9 | 25 | 45 | 225 | 9 | 45 | 225 | 25 | 45 | 225 |
| 9 | 12 | 16 | 72 | 9 | 12 | 16 | 9 | 16 | 72 |
| 9 | 15 | 45 | 225 | 9 | 45 | 225 | 9 | 15 | 45 |
| 15 | 20 | 30 | 45 | 20 | 30 | 45 | 15 | 20 | 30 |
| 20 | 30 | 36 | 45 | 20 | 30 | 45 | 30 | 36 | 45 |
| 25 | 45 | 81 | 225 | 25 | 45 | 81 | 25 | 45 | 225 |

---

The **Great Victory** [[notes: "Massima uittoria" is the highest win condition in Rithmomachia, requiring a player to arrange captured pieces in the opponent's side of the board to form mathematical progressions.]] is nothing other than to situate 4 pieces in the adversary's field in such a manner that their numbers contain all three of the aforementioned [[markup: proportioni]] (proportions): that is, the **Arithmetic**, the **Geometric**, and the **
… [1307 more characters]
````

**Clean `text` (annotation-layer/3)**

````text
## Table of all Geometric & Musical proportions that can occur in this game

| Geometric & Musical together | | | | Geometric alone | | | Musical alone | | |
|----------------------|---|---|---|-----------------|---|---|-------------|---|---|
| 2 | 3 | 6 | 12 | 3 | 6 | 12 | 2 | 3 | 6 |
| 3 | 4 | 6 | 9 | 4 | 6 | 9 | 3 | 4 | 6 |
| 3 | 4 | 6 | 12 | 3 | 6 | 12 | 4 | 6 | 12 |
| 3 | 6 | 8 | 12 | 3 | 6 | 12 | 6 | 8 | 12 |
| 4 | 6 | 12 | 36 | 4 | 12 | 36 | 4 | 6 | 12 |
| 5 | 9 | 45 | 225 | 9 | 45 | 225 | 5 | 9 | 45 |
| 9 | 15 | 25 | 45 | 9 | 15 | 25 | 9 | 15 | 45 |
| 9 | 25 | 45 | 225 | 9 | 45 | 225 | 25 | 45 | 225 |
| 9 | 12 | 16 | 72 | 9 | 12 | 16 | 9 | 16 | 72 |
| 9 | 15 | 45 | 225 | 9 | 45 | 225 | 9 | 15 | 45 |
| 15 | 20 | 30 | 45 | 20 | 30 | 45 | 15 | 20 | 30 |
| 20 | 30 | 36 | 45 | 20 | 30 | 45 | 30 | 36 | 45 |
| 25 | 45 | 81 | 225 | 25 | 45 | 81 | 25 | 45 | 225 |

---

The **Great Victory** is nothing other than to situate 4 pieces in the adversary's field in such a manner that their numbers contain all three of the aforementioned (proportions): that is, the **Arithmetic**, the **Geometric**, and the **Musical** together. But which numbers in this (game) are able to contain these three said proportions together, the following table demonstrates.

(proportions), (Arithmetic), (Geometric), (Musical/Harmonic), (Great Victory), (game), (Rithmomachia)
````

**Annotations** (16)

| # | type | tag | anchor (exact) | body |
|---|---|---|---|---|
| 1 | warning | warning | *page* | Visible ghosting/bleed-through of text and tables from the reverse side of the page is present in the lower half. |
| 2 | meta | [[meta]] | *page* | This page continues the systematic catalog of number sets required for the "Great Victory" in Rithmomachia. Having cover |
| 3 | pagedata | [[markup]] | *page* | proportioni |
| 4 | pagedata | [[markup]] | *page* | giuoco |
| 5 | pagedata | [[markup]] | *page* | proportioni |
| 6 | pagedata | [[markup]] | *page* | Arithmetica |
| 7 | pagedata | [[markup]] | *page* | Geometrica |
| 8 | pagedata | [[markup]] | *page* | Musica |
| 9 | pagedata | [[markup]] | *page* | Massima uittoria |
| 10 | pagedata | [[markup]] | *page* | giuoco |
| 11 | pagedata | [[markup]] | *page* | Rithmomachia |
| 12 | summary | [[summary]] | *page* | This page provides a reference table for number sets that satisfy both Geometric and Musical (Harmonic) proportions, ess |
| 13 | keywords | [[keywords]] | *page* | Rithmomachia, Great Victory, Geometric proportion, Musical proportion, Harmonic progression, mathematical games, Renaiss |
| 14 | note | [[notes]] | “The **Great Victory” | "Massima uittoria" is the highest win condition in Rithmomachia, requiring a player to arrange captured pieces in the op |
| 15 | note | [[notes]] | “the **Musical** together” | In this context, "Musical" refers to the Harmonic proportion, where the reciprocal of the numbers forms an arithmetic pr |
| 16 | note | [[notes]] | “” | The vocabulary terms below highlight the core concepts of Rithmomachia, often called the "Philosophers' Game," which was |

**Reader notes-off vs parser notes-off** (`[-reader only-]` `{+parser only+}`): same words

## 12. De consolatione philosophiae — p. 90

https://sourcelibrary.org/book/the-consolation-of-philosophy-boethius/page/6964ce524a0a952bda4cafeb · prompt none · syntaxes: [[language:]], [[vocabulary:]], [[other label:]], [interpolation]

**Raw `translation.data`**

````text
[[language: Latin original and English translation]]

[[original page: 68]] ->*The Consolation of Philosophy.*<-

**[Latin: Liber II, Prosa 5 cont.]**
*Quid autem tanto fortunae strepitu vobis expetitis? Inopiam, credo, reicere copiis nitimini. Atqui hoc vobis in contrarium cedit. Multis enim adminiculis opus est ad tuendam varietatem pretiosae supellectilis, verumque illud est multo indigere eos qui multa possideant, contraque minimum, qui abundantiam suam naturae mensura non superfluitatis ambitu metiantur. Itane autem vobis nullo proprio et insito bonum est, ut in externis sepositisque rebus bona vestra quaeratis? Rerumne condicio vertitur, ut animal divina rationis possessione magnificum non aliter sibi splendere videatur nisi vitreae supellectilis possessione? Et cetera quidem suis contenta sunt; vos autem deo mente similes ab rebus infimis petitis ornamenta naturae praestantissimae nec intellegitis quantam Conditori vestro faciatis iniuriam. Ille genus humanum terris omnibus praestare voluit; vos dignitatem vestram infra infima quaeque detruditis.*

**[English]**
in thy riches because they seemed to thee precious.
‘Then, what seek ye by all this noisy outcry about fortune? To chase away poverty, I ween, by means of abundance. And yet ye find the result just contrary. Why, this varied array of precious furniture needs more accessories for its protection; it is a true saying that they want most who possess most, and, conversely, they want very little who measure their abundance by nature’s requirements, not by the superfluity of vain display. Have ye no good of your own implanted within you, that ye seek your good in things external and separate? Is the nature of things so reversed that a creature divine by right of reason can in no other way be splendid in his own 
… [498 more characters]
````

**Clean `text` (annotation-layer/3)**

````text
[[original page: 68]] ->*The Consolation of Philosophy.*<-

**[Latin: Liber II, Prosa 5 cont.]**
*Quid autem tanto fortunae strepitu vobis expetitis? Inopiam, credo, reicere copiis nitimini. Atqui hoc vobis in contrarium cedit. Multis enim adminiculis opus est ad tuendam varietatem pretiosae supellectilis, verumque illud est multo indigere eos qui multa possideant, contraque minimum, qui abundantiam suam naturae mensura non superfluitatis ambitu metiantur. Itane autem vobis nullo proprio et insito bonum est, ut in externis sepositisque rebus bona vestra quaeratis? Rerumne condicio vertitur, ut animal divina rationis possessione magnificum non aliter sibi splendere videatur nisi vitreae supellectilis possessione? Et cetera quidem suis contenta sunt; vos autem deo mente similes ab rebus infimis petitis ornamenta naturae praestantissimae nec intellegitis quantam Conditori vestro faciatis iniuriam. Ille genus humanum terris omnibus praestare voluit; vos dignitatem vestram infra infima quaeque detruditis.*

**[English]**
in thy riches because they seemed to thee precious.
‘Then, what seek ye by all this noisy outcry about fortune? To chase away poverty, I ween, by means of abundance. And yet ye find the result just contrary. Why, this varied array of precious furniture needs more accessories for its protection; it is a true saying that they want most who possess most, and, conversely, they want very little who measure their abundance by nature’s requirements, not by the superfluity of vain display. Have ye no good of your own implanted within you, that ye seek your good in things external and separate? Is the nature of things so reversed that a creature divine by right of reason can in no other way be splendid in his own eyes save by the possession of lifeless chattels? Yet,
… [295 more characters]
````

**Annotations** (4)

| # | type | tag | anchor (exact) | body |
|---|---|---|---|---|
| 1 | pagedata | [[language]] | *page* | Latin original and English translation |
| 2 | vocab | [[vocabulary]] | *page* | abundance (copiis), accessories (adminiculis), nature's requirements (naturae mensura), chattels (supellectilis), intell |
| 3 | interp | interp | “[Latin: Liber II, Prosa 5 cont.]” |  |
| 4 | interp | interp | “[English]” |  |

**Reader notes-off vs parser notes-off** (`[-reader only-]` `{+parser only+}`): 

````text
{+->*+}
[-.-]
{+.*<-+}
````

## 13. Auctores Mythographi Latini (Hyginus, Fulgentius, Lactantius Placidus, Albricus) — p. 116

https://sourcelibrary.org/book/auctores-mythographi-latini-hyginus-fulgentius-lactantius-staveren/page/69942ce5b2f6748db4abee21 · prompt v1 · syntaxes: [interpolation], [Note: …]

**Raw `translation.data`**

````text
<language>Latin</language>
<page-type>text</page-type>
<columns>2</columns>
<page-num>48</page-num>
<header>HYGINUS’S FABLES.</header>

¹ some say [son] of Periclymenus; an Orchomenian. Meleager, son of Oeneus and Althaea, daughter of Thestius: ² some think [him the son] of Mars; a Calydonian. Laocoon, ³ son of Parthaon, brother of Oeneus, a Calydonian. Iphiclus, the other son of Thestius, his mother being Leucippe, brother of Althaea ⁴ by the same mother, a Lacedaemonian. ⁵ He was an Arcadian, ⁶ a runner and a javelin-thrower. ⁷ Iphitus, son of Naubolus, a Phocian; others say he was the son of Hippasus from the Peloponnese. ⁸ Zetes and Calais, sons of the wind Aquilo and Orithyia, ⁹ daughter of Erechtheus. These ¹⁰ are said to have had winged heads and feet, and dark-blue hair, and they traveled through the open air. These [drove away] the Harpy birds, the three daughters of Thaumas and ¹¹ Ozomene, ¹² Aël—

---

<margin></margin>
[Aelian] cap. 2. *And he settled Miletus in Asia, just as later the Ionians who set out from Athens with Neleus settled there, though at that time it was inhabited by Carians, a great nation living in villages.* Schol. Homer. ad Iliad. B. near the end: *The region of Caria around Miletus, etc. flowing through Caria into the sea near Miletus.* The mother of Miletus, if I may add this *in passing*, is called *Acacallis* by Pausanias and Antoninus Liberalis. *Acallis* is incorrectly printed in the Scholia to Theocritus ad Eid. VII. verse 11, and *Hecale* in Apollodorus book III. Furthermore, they recognize this Erginus among the Argonauts in Pindar, Schol. ad Olymp. IV, Apollonius book I. verse 185, as also Apollodorus book I, whom the most learned man who very recently edited the writers of poetic history intends to correct in vain. MUNCKER. The
… [3786 more characters]
````

**Clean `text` (annotation-layer/3)**

````text
¹ some say [son] of Periclymenus; an Orchomenian. Meleager, son of Oeneus and Althaea, daughter of Thestius: ² some think [him the son] of Mars; a Calydonian. Laocoon, ³ son of Parthaon, brother of Oeneus, a Calydonian. Iphiclus, the other son of Thestius, his mother being Leucippe, brother of Althaea ⁴ by the same mother, a Lacedaemonian. ⁵ He was an Arcadian, ⁶ a runner and a javelin-thrower. ⁷ Iphitus, son of Naubolus, a Phocian; others say he was the son of Hippasus from the Peloponnese. ⁸ Zetes and Calais, sons of the wind Aquilo and Orithyia, ⁹ daughter of Erechtheus. These ¹⁰ are said to have had winged heads and feet, and dark-blue hair, and they traveled through the open air. These [drove away] the Harpy birds, the three daughters of Thaumas and ¹¹ Ozomene, ¹² Aël—

---


[Aelian] cap. 2. *And he settled Miletus in Asia, just as later the Ionians who set out from Athens with Neleus settled there, though at that time it was inhabited by Carians, a great nation living in villages.* Schol. Homer. ad Iliad. B. near the end: *The region of Caria around Miletus, etc. flowing through Caria into the sea near Miletus.* The mother of Miletus, if I may add this *in passing*, is called *Acacallis* by Pausanias and Antoninus Liberalis. *Acallis* is incorrectly printed in the Scholia to Theocritus ad Eid. VII. verse 11, and *Hecale* in Apollodorus book III. Furthermore, they recognize this Erginus among the Argonauts in Pindar, Schol. ad Olymp. IV, Apollonius book I. verse 185, as also Apollodorus book I, whom the most learned man who very recently edited the writers of poetic history intends to correct in vain. MUNCKER. The city of Miletus in Ionia is said to have been founded, or colonies were led into this city, by Neleus the son of Codrus the Athenian; but not by Neleus,
… [3597 more characters]
````

**Annotations** (28)

| # | type | tag | anchor (exact) | body |
|---|---|---|---|---|
| 1 | pagedata | language | *page* | Latin |
| 2 | pagedata | page-type | *page* | text |
| 3 | pagedata | columns | *page* | 2 |
| 4 | pagedata | page-num | *page* | 48 |
| 5 | pagedata | header | *page* | HYGINUS’S FABLES. |
| 6 | margin |  | “” |  |
| 7 | margin (stray-close) |  | — |  |
| 8 | margin |  | “” |  |
| 9 | margin (stray-close) |  | — |  |
| 10 | interp | interp | “[son]” |  |
| 11 | interp | interp | “[him the son]” |  |
| 12 | interp | interp | “[drove away]” |  |
| 13 | interp | interp | “[Aelian]” |  |
| 14 | interp | interp | “[Note: typo in original Latin]” |  |
| 15 | interp | interp | “[sons]” |  |
| 16 | interp | interp | “[SON]” |  |
| 17 | interp | interp | “[a brother by the same mother]” |  |
| 18 | interp | interp | “[arte]” |  |
| 19 | interp | interp | “[sharp]” |  |
| 20 | interp | interp | “[sharp]” |  |
| 21 | interp | interp | “[sharpness]” |  |
| 22 | interp | interp | “[swift-footed]” |  |
| 23 | interp | interp | “[acrem]” |  |
| 24 | interp | interp | “[Acris]” |  |
| 25 | interp | interp | “[acer]” |  |
| 26 | interp | interp | “[terrible/wondrous]” |  |
| 27 | interp | interp | “[skilful]” |  |
| 28 | interp | interp | “[arte]” |  |

**Reader notes-off vs parser notes-off** (`[-reader only-]` `{+parser only+}`): same words

## 14. Morgenroete im Aufgang — p. 380

https://sourcelibrary.org/book/dawn-rising-boehme/page/6902efa3583dd7d264140a23 · prompt v2 · syntaxes: [[header:]]

**Raw `translation.data`**

````text
<meta>This page continues Böhme's exploration of the "birth-government" of human life, connecting the human microcosm to the macrocosmic "Being of all beings." Having previously discussed the spiritual qualities of the planets, Böhme now defines the relationship between the body (flesh) and the spirit, and introduces the concept of the "Great Depth" or "Chamber of Death" as the foundational, unmoving state of the universe before the divine light arises.</meta>

[[page 348]]
[[header: Aurora in Ascent. Ch. 26.]]

rise up, and within it the Heart of God or the holy clear Godhead is born in the middle <term>seat</term> <note>original: *Sede*, from Latin *sedes*</note>, above nature in the Center, where the light of life rises.

48. But now in the human body, in the <term>birth-government</term> <note>original: *Geburt Regiment*; the system or governing power by which life is generated</note>, there are three distinct things, where each is a particular thing, and yet they are not separated from each other, but all three together are only the one man, according to the manner and way of the Trinity in the divine Being.

49. The flesh is not the life, but it is a dead, <term>unreasoning</term> <note>original: *unverständiges*; lacking intellect or consciousness</note> being, which, as soon as the government of the spirit ceases to <term>in-qualify</term> <note>original: *qualificiren*; Böhme's term for two things interacting or sharing essential qualities</note> within it, immediately becomes a dead **What** <note>original: *Was*; Böhme uses the interrogative pronoun as a noun to signify a mere object without identity or life</note>, must rot and turn to dust.

50. But now no spirit can exist outside of the body in its perfection either; for as soon as it is separated from the
… [1864 more characters]
````

**Clean `text` (annotation-layer/3)**

````text
[[page 348]]
rise up, and within it the Heart of God or the holy clear Godhead is born in the middle seat, above nature in the Center, where the light of life rises.

48. But now in the human body, in the birth-government, there are three distinct things, where each is a particular thing, and yet they are not separated from each other, but all three together are only the one man, according to the manner and way of the Trinity in the divine Being.

49. The flesh is not the life, but it is a dead, unreasoning being, which, as soon as the government of the spirit ceases to in-qualify within it, immediately becomes a dead **What**, must rot and turn to dust.

50. But now no spirit can exist outside of the body in its perfection either; for as soon as it is separated from the body, it loses its government. For the body is the **mother** of the spirit, in which the spirit is born, and in which it takes its strength and power; it is and remains indeed the spirit when it is separated from the body, but it loses its government.

51. These three governments are the whole man with flesh and spirit, and have for their beginning and government especially a sevenfold form, according to the manner and way of the **7 Spirits of God** or the **7 planets**.

52. Just as God's eternal, beginningless birth-government is, so also is the beginning and outgoing of the 7 planets and stars, and so also is the outgoing of the human life.

->**Now take note.**<-

53. When you ponder and think what might be in this world and outside of this world, or the Being of all beings, then you speculate or ponder in the whole body of God, which is the Being of all beings, and He is a beginningless Being.

54. But He has in His own seat no mobility, rationality, or comprehensibility, but is a **dark Depth**,
… [276 more characters]
````

**Annotations** (15)

| # | type | tag | anchor (exact) | body |
|---|---|---|---|---|
| 1 | meta | meta | *page* | This page continues Böhme's exploration of the "birth-government" of human life, connecting the human microcosm to the m |
| 2 | term |  | “seat” |  |
| 3 | definition | note | “seat” | original: *Sede*, from Latin *sedes* |
| 4 | term |  | “birth-government” |  |
| 5 | definition | note | “birth-government” | original: *Geburt Regiment*; the system or governing power by which life is generated |
| 6 | term |  | “unreasoning” |  |
| 7 | definition | note | “unreasoning” | original: *unverständiges*; lacking intellect or consciousness |
| 8 | term |  | “in-qualify” |  |
| 9 | definition | note | “in-qualify” | original: *qualificiren*; Böhme's term for two things interacting or sharing essential qualities |
| 10 | original | note | “a dead **What” | original: *Was*; Böhme uses the interrogative pronoun as a noun to signify a mere object without identity or life |
| 11 | term |  | “Being of all beings” |  |
| 12 | definition | note | “Being of all beings” | original: *Wesen aller Wesen*; a central concept in Böhme’s theology referring to the totality of God as the ground of a |
| 13 | summary | summary | *page* | Böhme describes the triune nature of man (flesh, spirit, and their governing interaction) as a reflection of the Divine  |
| 14 | keywords | keywords | *page* | Trinity, birth-government, Seven Spirits of God, Being of all beings, dark depth, chamber of death, microcosm, macrocosm |
| 15 | pagedata | [[header]] | *page* | Aurora in Ascent. Ch. 26. |

**Reader notes-off vs parser notes-off** (`[-reader only-]` `{+parser only+}`): 

````text
[-\.-]
{+.+}
[-\.-]
{+.+}
[-\.-]
{+.+}
[-\.-]
{+.+}
[-\.-]
{+.+}
{+->**+}
[-.-]
{+.**<-+}
[-\.-]
{+.+}
[-\.-]
{+.+}
[-\.-]
{+.+}
[-\.-]
````

## 15. Epytoma in Almagestum Ptolemaei — p. 10

https://sourcelibrary.org/book/epitome-of-ptolemy-s-almagest-1496-1436-1476/page/694f8f40077e0c701da6446b · prompt v1 · syntaxes: [[insert:]]

**Raw `translation.data`**

````text
<meta>This page continues the dedication of the "Epitome of the Almagest" to Cardinal Bessarion. It details the history of the project, beginning with the dissatisfaction over existing Latin translations of Ptolemy and leading to the collaboration between Bessarion, the astronomer George von Peuerbach, and finally Regiomontanus himself.</meta>

...they might enjoy divine delights. For what is more pleasant, what more lovely, what, finally, can affect the eyes more sweetly than that series of so many and such great lights in its most beautiful and orderly arrangement? Indeed, if you are carried away in spirit by this sight, you will find that you have never felt anything more delightful in all your life. 

From this, a greater difficulty of this discipline hangs over us—though that difficulty is by no means small which the translators of foreign manuscripts have produced for us. It is truly difficult and arduous for things that were well-said in a foreign tongue to preserve the same beauty and the same ease in translation, even if they have been translated by eloquent men with the greatest zeal and diligence. But if the translator is insufficiently eloquent or careful, the speech overflows as something entirely rough and turbulent. 

This is clearly what I see happened to that most famous book of Ptolemy, which they call the *Great Construction* <note>original: "magnam compositionem". This refers to the *Almagest*, the foundation of medieval astronomy.</note>. Although among the Greeks it shines with marvelous ease and eloquence, among the Latins it is held to be so harsh and inept that not even Ptolemy himself, if he were to come back to life, would recognize it as his own. 

When you had pondered this in your mind for some time, most excellent Prince Bessarion, you wer
… [4080 more characters]
````

**Clean `text` (annotation-layer/3)**

````text
...they might enjoy divine delights. For what is more pleasant, what more lovely, what, finally, can affect the eyes more sweetly than that series of so many and such great lights in its most beautiful and orderly arrangement? Indeed, if you are carried away in spirit by this sight, you will find that you have never felt anything more delightful in all your life. 

From this, a greater difficulty of this discipline hangs over us—though that difficulty is by no means small which the translators of foreign manuscripts have produced for us. It is truly difficult and arduous for things that were well-said in a foreign tongue to preserve the same beauty and the same ease in translation, even if they have been translated by eloquent men with the greatest zeal and diligence. But if the translator is insufficiently eloquent or careful, the speech overflows as something entirely rough and turbulent. 

This is clearly what I see happened to that most famous book of Ptolemy, which they call the *Great Construction*. Although among the Greeks it shines with marvelous ease and eloquence, among the Latins it is held to be so harsh and inept that not even Ptolemy himself, if he were to come back to life, would recognize it as his own. 

When you had pondered this in your mind for some time, most excellent Prince Bessarion, you were affected by a distress beyond measure—not so much because that golden river of your countryman’s genius had fallen into such barbarity through the fault of translators, but because our Latins (whom you pursue with singular love and benevolence) lacked such an excellent and famous work. For we seemed to lack it enough, having only a translation so barbaric and inept. 

You then decided, as a man most skilled in both languages—being no less fluent in Latin th
… [2670 more characters]
````

**Annotations** (12)

| # | type | tag | anchor (exact) | body |
|---|---|---|---|---|
| 1 | meta | meta | *page* | This page continues the dedication of the "Epitome of the Almagest" to Cardinal Bessarion. It details the history of the |
| 2 | original | note | “the *Great Construction” | original: "magnam compositionem". This refers to the *Almagest*, the foundation of medieval astronomy. |
| 3 | note | note | “of your countryman’s” | Ptolemy was Greek; Bessarion was a Byzantine Greek scholar who became a Cardinal in the West. |
| 4 | note | note | “your native tongue” | Greek |
| 5 | note | note | “most pious Emperor” | Referring to Bessarion's diplomatic duties as a Cardinal-Legate. |
| 6 | note | note | “the Emperor’s astronomer” | George von Peuerbach (1423–1461), Regiomontanus's teacher. |
| 7 | note | note | “manner of geometers” | Peuerbach structured the text with clear geometric proofs and propositions to make it more logical. |
| 8 | original | note | “by your authority” | original: "numine", suggesting a divine-like will or command. |
| 9 | note | note | “DSI” | Printer's signature or mark. |
| 10 | summary | summary | *page* | Regiomontanus describes the poor state of existing Latin translations of Ptolemy's Almagest and explains how he came to  |
| 11 | keywords | keywords | *page* | Ptolemy, Almagest, George von Peuerbach, Johannes Regiomontanus, Cardinal Bessarion, translation, Vienna, astronomy, his |
| 12 | insert | [[insert]] | “DSI” |  |

**Reader notes-off vs parser notes-off** (`[-reader only-]` `{+parser only+}`): same words

## 16. Opera Omnia (Complete Works) — p. 601

https://sourcelibrary.org/book/complete-works-opera-omnia-translation/page/6951549fab34727b1f0412ec · prompt none · syntaxes: [[notes:]], [[meta:]], [[language:]], [[page number:]], [[abbrev:]], [[summary:]], [[keywords:]], [[vocabulary:]], [[margin:]], [[term:]], → in a term

**Raw `translation.data`**

````text
[[language: Latin with Greek passages]]

[[page number: 223]]

->centered<-
### Cratylus, or, On the Correctness of Names

...but he burns for the absent one. Whence [[abbrev: πόθος → pothos]] (longing) is said, as if it were [[abbrev: ἀπόθος → apothos]], that is, the concupiscence for what is absent. Similarly, that which is mixed into the soul's own self toward what is pleasing is called [[abbrev: ἵμερος → himeros]] (desire) when the thing desired is present; however, it is named [[abbrev: πόθος → pothos]] (longing) when the object is absent. 

Furthermore, [[abbrev: ἔρως → erōs]], that is, love, is so called because it [[abbrev: εἰσρῶ → eisrō]] (flows in) from the outside. This [[abbrev: ῥοή → rhoē]] (flux) is not inherent to the possessor, but is infused through the eyes. For this reason, [[abbrev: ἔρως → erōs]], that is, "influxion," was called "love" by our ancestors from the word [[abbrev: εἰσρῶ → eisrō]] (to flow in). For they used to use the letter [[abbrev: ο → o]] (omicron) in place of [[abbrev: ω → ō]] (omega). Now, however, it is spoken with an [[abbrev: η → ē]] (eta) in place of [[abbrev: ο → o]], with an [[abbrev: ω → ō]] (omega) having been placed between them. 

But what should we consider next? Chiefly [[abbrev: δόξα → doxa]] (opinion), and certain such things—from where do they take their name? 

**SOCRATES.** It is derived either from [[abbrev: δίωξις → diōxis]] (pursuit), or from [[abbrev: διώκειν → diōkein]], that is, from the "persecution" or "chase" by which the soul proceeds and follows after, investigating the condition of things. Or it may come from [[abbrev: τόξου → toxou]] [[abbrev: βολή → bolē]], that is, the "shot of a bow." It seems to depend more likely on this latter. 

The term [[abbrev: οἴησις → oiēsis]] (estimation) agrees with this.
… [16185 more characters]
````

**Clean `text` (annotation-layer/3)**

````text
->centered<-
### Cratylus, or, On the Correctness of Names

...but he burns for the absent one. Whence (longing) is said, as if it were , that is, the concupiscence for what is absent. Similarly, that which is mixed into the soul's own self toward what is pleasing is called (desire) when the thing desired is present; however, it is named (longing) when the object is absent. 

Furthermore, , that is, love, is so called because it (flows in) from the outside. This (flux) is not inherent to the possessor, but is infused through the eyes. For this reason, , that is, "influxion," was called "love" by our ancestors from the word (to flow in). For they used to use the letter (omicron) in place of (omega). Now, however, it is spoken with an (eta) in place of , with an (omega) having been placed between them. 

But what should we consider next? Chiefly (opinion), and certain such things—from where do they take their name? 

**SOCRATES.** It is derived either from (pursuit), or from , that is, from the "persecution" or "chase" by which the soul proceeds and follows after, investigating the condition of things. Or it may come from , that is, the "shot of a bow." It seems to depend more likely on this latter. 

The term (estimation) agrees with this. Indeed, it shows , that is, the "entry" of the soul into each thing to be considered, , that is, "of what quality" it might be. In the same way, (counsel/will) is named from (a shot or cast). And (to wish) signifies "to desire" because of that very effort of reaching out, as does (aiming/desire) and (to deliberate). 

All these things following after "opinion" seem to be images of that (shot), that is, of the cast and the effort. Just as the contrary, (misfortune/failure), appears as a privation of the will—a certain failure of the one
… [12896 more characters]
````

**Annotations** (89)

| # | type | tag | anchor (exact) | body |
|---|---|---|---|---|
| 1 | pagedata | [[language]] | *page* | Latin with Greek passages |
| 2 | pagedata | [[page number]] | *page* | 223 |
| 3 | abbrev | [[abbrev]] | *page* | πόθος → pothos |
| 4 | abbrev | [[abbrev]] | *page* | ἀπόθος → apothos |
| 5 | abbrev | [[abbrev]] | *page* | ἵμερος → himeros |
| 6 | abbrev | [[abbrev]] | *page* | πόθος → pothos |
| 7 | abbrev | [[abbrev]] | *page* | ἔρως → erōs |
| 8 | abbrev | [[abbrev]] | *page* | εἰσρῶ → eisrō |
| 9 | abbrev | [[abbrev]] | *page* | ῥοή → rhoē |
| 10 | abbrev | [[abbrev]] | *page* | ἔρως → erōs |
| 11 | abbrev | [[abbrev]] | *page* | εἰσρῶ → eisrō |
| 12 | abbrev | [[abbrev]] | *page* | ο → o |
| 13 | abbrev | [[abbrev]] | *page* | ω → ō |
| 14 | abbrev | [[abbrev]] | *page* | η → ē |
| 15 | abbrev | [[abbrev]] | *page* | ο → o |
| 16 | abbrev | [[abbrev]] | *page* | ω → ō |
| 17 | abbrev | [[abbrev]] | *page* | δόξα → doxa |
| 18 | abbrev | [[abbrev]] | *page* | δίωξις → diōxis |
| 19 | abbrev | [[abbrev]] | *page* | διώκειν → diōkein |
| 20 | abbrev | [[abbrev]] | *page* | τόξου → toxou |
| 21 | abbrev | [[abbrev]] | *page* | βολή → bolē |
| 22 | abbrev | [[abbrev]] | *page* | οἴησις → oiēsis |
| 23 | abbrev | [[abbrev]] | *page* | οἴσις → oisis |
| 24 | abbrev | [[abbrev]] | *page* | οἷον → oion |
| 25 | abbrev | [[abbrev]] | *page* | βουλή → boulē |
| 26 | abbrev | [[abbrev]] | *page* | βολή → bolē |
| 27 | abbrev | [[abbrev]] | *page* | βούλεσθαι → boulesthai |
| 28 | abbrev | [[abbrev]] | *page* | ἔφεσις → ephesis |
| 29 | abbrev | [[abbrev]] | *page* | βούλεσθαι → boulesthai |
| 30 | abbrev | [[abbrev]] | *page* | βολῆς → bolēs |

… 59 more

**Reader notes-off vs parser notes-off** (`[-reader only-]` `{+parser only+}`): 

````text
{+->+}
{+<-+}
[--]
{+->+}
{+<-+}
{+->+}
{+<-+}
{+->+}
{+<-+}
{+->+}
{+<-+}
{+->+}
{+<-+}
````

## 17. Pimander, Asclepius, Crater Hermetis — p. 48

https://sourcelibrary.org/book/complete-hermetica-1505-paris-edition-hermes-trismegistus/page/694f3d6fbe37f451a5324ec5 · prompt v2 · syntaxes: [[signature:]], [[vocabulary:]], [[header:]]

**Raw `translation.data`**

````text
<meta>This page continues the technical discussion between Hermes (Mercury) and his son Tatius from the beginning of Book VIII. Having established that nothing in the universe truly perishes, Hermes now distinguishes between the "eternal" nature of the Father and the "immortal" nature of the created Cosmos, explaining the mechanics of material dissolution and the unique status of Man.</meta>

[[header: I 18]]

...for it is indeed always living, and always immortal. Indeed, "always living" and "**eternal**" <note>original: "ſempiternum"</note> differ from one another. For that which is eternal has not been made by another; but if it was made by itself, it was not made by anyone else, because it is always. For the eternal is the whole, insofar as it is eternal; however, that Father is eternal of himself. But the **world** <note>In Hermetic thought, the "world" (*mundus* or *cosmos*) is often called the "second god."</note> was made ever-living and immortal by the Father.

And as much **matter** as had been subject to the Father, the Father himself, acting upon the corporeal and gathering it into a mass, rendered the whole **spherical** <note>The sphere was considered the most perfect and stable geometric form, reflecting the divine order of the universe.</note>, impressing quality upon matter that is immortal and possesses an eternal nature. 

Moreover, the Father, being full of all ideas, inserted qualities into the sphere: as if in a circle, he circumscribed it with every quality. He wished to adorn that which is after him <note>Referring to the created world as the successor or reflection of the divine.</note>, propping up every body with immortality, as it were, so that matter—should it wish to withdraw from this union—might not be dissolved again into its own **defor
… [1820 more characters]
````

**Clean `text` (annotation-layer/3)**

````text
...for it is indeed always living, and always immortal. Indeed, "always living" and "**eternal**" differ from one another. For that which is eternal has not been made by another; but if it was made by itself, it was not made by anyone else, because it is always. For the eternal is the whole, insofar as it is eternal; however, that Father is eternal of himself. But the **world** was made ever-living and immortal by the Father.

And as much **matter** as had been subject to the Father, the Father himself, acting upon the corporeal and gathering it into a mass, rendered the whole **spherical**, impressing quality upon matter that is immortal and possesses an eternal nature. 

Moreover, the Father, being full of all ideas, inserted qualities into the sphere: as if in a circle, he circumscribed it with every quality. He wished to adorn that which is after him, propping up every body with immortality, as it were, so that matter—should it wish to withdraw from this union—might not be dissolved again into its own **deformity**.

For when matter was incorporeal, O son, it was more deformed. This matter also possesses certain slight qualities, being subject to a revolving nature of growing and diminishing alike, which men call **death**. Confusion of this kind exists only around earthly living things. For the bodies of celestial beings preserve one and the same order, which they were assigned by their Father from the beginning. 

That order is preserved by the restitution of each indissoluble part. The restoration of the constitution of earthly bodies, and the dissolution itself, restores them into indissoluble and immortal bodies. And so there is a loss of sensation, not a destruction of bodies. 

The third living being is **man**, born in the image of the world, who, according 
… [230 more characters]
````

**Annotations** (13)

| # | type | tag | anchor (exact) | body |
|---|---|---|---|---|
| 1 | meta | meta | *page* | This page continues the technical discussion between Hermes (Mercury) and his son Tatius from the beginning of Book VIII |
| 2 | original | note | “living" and "**eternal” | original: "ſempiternum" |
| 3 | note | note | “But the **world” | In Hermetic thought, the "world" (*mundus* or *cosmos*) is often called the "second god." |
| 4 | note | note | “the whole **spherical” | The sphere was considered the most perfect and stable geometric form, reflecting the divine order of the universe. |
| 5 | note | note | “is after him” | Referring to the created world as the successor or reflection of the divine. |
| 6 | term |  | “restitution” |  |
| 7 | definition | note | “restitution” | The process of returning to a prior state or the cyclical renewal of form. |
| 8 | note | note | “the **second god” | The Cosmos or World-Spirit. |
| 9 | summary | summary | *page* | Hermes distinguishes between the self-existent eternal Father and the created immortal World, explaining that "death" is |
| 10 | keywords | keywords | *page* | eternity, immortality, cosmology, nature of matter, death as transformation, celestial order, Second God, human intellig |
| 11 | pagedata | [[header]] | *page* | I 18 |
| 12 | pagedata | [[signature]] | *page* | c ij |
| 13 | vocab | [[vocabulary]] | *page* | Eternal, World, Matter, Spherical, Quality, Deformity, Death, Restoration, Dissolution, Man, Second God, Intelligence |

**Reader notes-off vs parser notes-off** (`[-reader only-]` `{+parser only+}`): same words

## 18. Sylva Sylvarum, Sive Historia Naturalis — p. 715

https://sourcelibrary.org/book/sylva-sylvarum-latin-edition-bacon/page/69529544b184004c526a2f07 · prompt none · syntaxes: code fence

**Raw `translation.data`**

````text
```
      THE NEW ATLANTIS.          15
he led us back to the dining room, and raising his rod a little, (which was their custom, whenever Ministers report the commands of Superiors,) he spoke to us thus.
   I inform you that the custom of this Kingdom requires that after the present day and tomorrow, (which we permit you for transferring men and your goods from the ship) you keep yourselves within these doors for three days. However, let this not disturb you, nor on that account imagine yourselves to be confined within a prison: but rather that this is a privilege, by which you may refresh and restore your spirits from your journey, you will lack nothing: Indeed, six servants have also been assigned, who will minister to you, and attend to your affairs.
   We thanked him, with all affection and humility: and said: God is undoubtedly manifested in this land. We also offered him twenty gold pieces, but he also, smiling, said only this: What, do you wish me to be a man of double salary? Thus he departed. A little later, our dinner was brought: which certainly provided a sufficiently lavish and wholesome fare, both in respect of food and drink: certainly better and more abundant than according to the standard of any College, as far as I know, in Europe. The drink was of three
                               kinds
```
````

**Clean `text` (annotation-layer/3)**

````text
THE NEW ATLANTIS.          15
he led us back to the dining room, and raising his rod a little, (which was their custom, whenever Ministers report the commands of Superiors,) he spoke to us thus.
   I inform you that the custom of this Kingdom requires that after the present day and tomorrow, (which we permit you for transferring men and your goods from the ship) you keep yourselves within these doors for three days. However, let this not disturb you, nor on that account imagine yourselves to be confined within a prison: but rather that this is a privilege, by which you may refresh and restore your spirits from your journey, you will lack nothing: Indeed, six servants have also been assigned, who will minister to you, and attend to your affairs.
   We thanked him, with all affection and humility: and said: God is undoubtedly manifested in this land. We also offered him twenty gold pieces, but he also, smiling, said only this: What, do you wish me to be a man of double salary? Thus he departed. A little later, our dinner was brought: which certainly provided a sufficiently lavish and wholesome fare, both in respect of food and drink: certainly better and more abundant than according to the standard of any College, as far as I know, in Europe. The drink was of three
                               kinds
````

**Annotations** (2)

| # | type | tag | anchor (exact) | body |
|---|---|---|---|---|
| 1 | pagedata | fence | *page* | ```  |
| 2 | pagedata | fence | *page* |  ``` |

**Reader notes-off vs parser notes-off** (`[-reader only-]` `{+parser only+}`): same words

## 19. Liber [Hebrew: more nevuchim] doctor perplexorum — p. 486

https://sourcelibrary.org/book/the-guide-for-the-perplexed-moreh-nevukhim-maimon/page/697afc632e82a1f73a3f1c42 · prompt v5.2026-02 · syntaxes: plain Summary: line

**Raw `translation.data`**

````text
<meta>This page transitions from the general discussion of God's knowledge to the specific theories regarding Divine Providence. It concludes the critique of those who doubt God's oversight based on the perceived injustices of the world and introduces the five historical schools of thought on how God governs—or does not govern—the universe.</meta>

# THE GUIDE FOR THE PERPLEXED
### Part III. Chapter XVII.

...Aristotle, who believed as we do: namely, that God knows all things and nothing is hidden from Him. These thinkers are also mentioned by *Alexander* <note>Alexander of Aphrodisias, a famous commentator on Aristotle who lived around 200 AD.</note> in the book previously cited. However, Alexander does not agree with their opinion. He states that the primary evidence destroying their view is what we see with our own eyes: that many evils happen to good people, and many good things happen to evil people.

Summary: It has been shown to you thus far that if all these thinkers had found human affairs arranged and ordered in the way the common people imagine they should be, they would never have fallen into these skeptical opinions. The principal cause driving them toward this speculation is the trial and examination of the condition of good and evil things, which, in their opinion, appears confused and disordered. This is just as our own fools commonly say: *The Way of the Lord is not equal in all things.* <note>original: *Non est per omnia æqualis Via Domini*. This is a reference to Ezekiel 18:25, where the people complain that God's justice is not consistent.</note>

Since I have now explained that the **Knowledge** and **Providence** of God are joined together by an inseparable bond, I will now begin to review for you the various opinions concerning Providence and unta
… [2294 more characters]
````

**Clean `text` (annotation-layer/3)**

````text
# THE GUIDE FOR THE PERPLEXED
### Part III. Chapter XVII.

...Aristotle, who believed as we do: namely, that God knows all things and nothing is hidden from Him. These thinkers are also mentioned by *Alexander* in the book previously cited. However, Alexander does not agree with their opinion. He states that the primary evidence destroying their view is what we see with our own eyes: that many evils happen to good people, and many good things happen to evil people.

Since I have now explained that the **Knowledge** and **Providence** of God are joined together by an inseparable bond, I will now begin to review for you the various opinions concerning Providence and untangle the doubts that are raised regarding God’s knowledge of Particulars.

### Chapter XVII.
## ->On the Providence of God, and the five<-
## ->opinions concerning it.<-

Five opinions on Providence.
There are five opinions concerning the Providence of God, all of them ancient—that is, known and heard since the times of the Prophets and the revelation of our Law, which disperses and illuminates all these shadows of doubt.

The first opinion on Providence: Epicurus.
The *first opinion* is held by those who believe there is absolutely no Providence in this world. Instead, they believe everything happens and occurs by accident and by chance, and there is no one who rules, cares for, or governs the world.

This is the opinion of **Epicurus**, who is also the patron and defender of Atoms. He asserted that these atoms mingle by chance, and from their accidental mixture, all things are generated. There have even been certain heretics among the Israelites who seized upon this opinion: namely, those of whom it is said: *They have denied the Lord, and said, He does not exist.* Jeremiah 5:12

Aristotle himself alread
… [264 more characters]
````

**Annotations** (14)

| # | type | tag | anchor (exact) | body |
|---|---|---|---|---|
| 1 | meta | meta | *page* | This page transitions from the general discussion of God's knowledge to the specific theories regarding Divine Providenc |
| 2 | note | note | “mentioned by *Alexander” | Alexander of Aphrodisias, a famous commentator on Aristotle who lived around 200 AD. |
| 3 | term |  | “Particulars” |  |
| 4 | definition | note | “Particulars” | In philosophy, "particulars" refers to individual things and specific events, as opposed to "universals" like species or |
| 5 | margin |  | “Five opinions on Providence.” |  |
| 6 | margin |  | “The first opinion on Providence: Epicurus.” |  |
| 7 | term |  | “Atoms” |  |
| 8 | definition | note | “Atoms” | Epicurus was an ancient Greek philosopher who taught that the universe is made of tiny, indivisible particles called ato |
| 9 | margin |  | “Jeremiah 5:12” |  |
| 10 | original | note | “exist.* Jeremiah 5:12” | original: *Non est ipse*—literally "It is not He." |
| 11 | meta | meta | *page* | catchword: The second... (original Latin: Secun-) |
| 12 | summary | summary | *page* | Maimonides explains that doubts about God's providence arise from the apparent lack of justice in human life and introdu |
| 13 | keywords | keywords | *page* | Providence, Aristotle, Alexander of Aphrodisias, Epicurus, Atoms, Problem of Evil, Divine Knowledge, Justice |
| 14 | summary | Summary: | *page* | It has been shown to you thus far that if all these thinkers had found human affairs arranged and ordered in the way the |

**Reader notes-off vs parser notes-off** (`[-reader only-]` `{+parser only+}`): 

````text
{+## ->+}
{+<-+}
{+## ->+}
[-.-]
{+.<-+}
````

## 20. Book of Kells Latin Text with Variants (Codex Kenanensis) — p. 398

https://sourcelibrary.org/book/book-of-kells-latin-text-with-variants-codex-kenanensis-abbott/page/6953cc1077f38f6761be1127 · prompt v5.2026-02 · syntaxes: [interpolation]

**Raw `translation.data`**

````text
<meta>This page continues the Gospel of Mark, chapter 12. The previous page concluded with a scribe’s conversation with Jesus regarding the greatest commandment. This page picks up with the conclusion of that dialogue (verse 34) and moves into Jesus’s teaching in the Temple and his observation of the widow's offering.</meta>

[ACCORDING TO MARK] [Vulgate Version xii. 35-42]

...had answered, he said to him, "You are not far from the kingdom of God."
And no one dared to question him any longer.

35 And Jesus, responding, said as he was teaching in the temple, "How is it that the scribes <term>scribae</term> <note>The scribes were professional scholars and experts in Jewish Law.</note> say that the Christ is the son of David? 36 For David himself says by the Holy Spirit <term>spiritu sancto</term>: 'The Lord said to my Lord, "Sit at my right hand, until I make your enemies a footstool <term>scabellum</term> for your feet."' 37 Therefore, David himself calls him 'Lord'; so how is he his son?" And a large crowd listened to him gladly.

<margin>40</margin> 38 And he said to them in his teaching: "Beware of the scribes, who like to walk in long robes <term>stolis</term> <note>original: *stolis*. These were long, flowing garments that signified high social status and religious authority.</note> and to be greeted in the marketplace, 39 and to sit in the front seats in the synagogues and have the places of honor at banquets; 40 they devour the houses of widows under the pretext of long prayers; these will receive a more severe judgment."

<margin>41</margin> 41 And sitting opposite the treasury <term>gazophylacium</term> <note>original: *gazophylacium*. A term derived from Greek referring to the collection boxes in the Temple where offerings were placed.</note>, Jesus observed h
… [693 more characters]
````

**Clean `text` (annotation-layer/3)**

````text
[ACCORDING TO MARK] [Vulgate Version xii. 35-42]

...had answered, he said to him, "You are not far from the kingdom of God."
And no one dared to question him any longer.

35 And Jesus, responding, said as he was teaching in the temple, "How is it that the scribes scribae say that the Christ is the son of David? 36 For David himself says by the Holy Spirit spiritu sancto: 'The Lord said to my Lord, "Sit at my right hand, until I make your enemies a footstool scabellum for your feet."' 37 Therefore, David himself calls him 'Lord'; so how is he his son?" And a large crowd listened to him gladly.

40 38 And he said to them in his teaching: "Beware of the scribes, who like to walk in long robes stolis and to be greeted in the marketplace, 39 and to sit in the front seats in the synagogues and have the places of honor at banquets; 40 they devour the houses of widows under the pretext of long prayers; these will receive a more severe judgment."

41 41 And sitting opposite the treasury gazophylacium, Jesus observed how the crowd put copper coins into the treasury, and many wealthy people put in a great deal. 42 When a certain poor widow vidua pauper came, however, she put in...
````

**Annotations** (18)

| # | type | tag | anchor (exact) | body |
|---|---|---|---|---|
| 1 | meta | meta | *page* | This page continues the Gospel of Mark, chapter 12. The previous page concluded with a scribe’s conversation with Jesus  |
| 2 | term |  | “scribae” |  |
| 3 | definition | note | “scribae” | The scribes were professional scholars and experts in Jewish Law. |
| 4 | term |  | “spiritu sancto” |  |
| 5 | term |  | “scabellum” |  |
| 6 | margin |  | “40” |  |
| 7 | term |  | “stolis” |  |
| 8 | definition | note | “stolis” | original: *stolis*. These were long, flowing garments that signified high social status and religious authority. |
| 9 | margin |  | “41” |  |
| 10 | term |  | “gazophylacium” |  |
| 11 | definition | note | “gazophylacium” | original: *gazophylacium*. A term derived from Greek referring to the collection boxes in the Temple where offerings wer |
| 12 | original | note | “put copper coins” | original: *aes*, referring to bronze or copper money of low value. |
| 13 | term |  | “vidua pauper” |  |
| 14 | note | note | “she put in” | Technical Vocabulary: Jesus, David, scribes, treasury, poor widow, kingdom of God, Holy Spirit. |
| 15 | summary | summary | *page* | This page contains Jesus’s challenge to the scribes regarding the lineage of the Messiah and his condemnation of their h |
| 16 | keywords | keywords | *page* | Gospel of Mark, Jesus, David, Scribes, Temple teaching, hypocrisy, Temple treasury, poor widow |
| 17 | interp | interp | “[ACCORDING TO MARK]” |  |
| 18 | interp | interp | “[Vulgate Version xii. 35-42]” |  |

**Reader notes-off vs parser notes-off** (`[-reader only-]` `{+parser only+}`): same words

## 21. In Calumniatorem Platonis libri IV (1469 editio princeps) — p. 88

https://sourcelibrary.org/book/in-calumniatorem-platonis-libri-iv-1469-editio-princeps-bessarion/page/69942e11d607f8e57e4b747e · prompt v1 · syntaxes: [interpolation]

**Raw `translation.data`**

````text
<language>Latin</language>
<page-type>text</page-type>
<page-num>54</page-num>
<meta>catchword: Qui</meta>

it is necessary to distribute each thing in order; and after he has implored divine favor for the sake of this matter, he continues thus: "It must now be distributed: the first God, subsisting in Himself, is simple; who, being always joined to Himself in every part, cannot be disjoined or divided. But the second and third God is one; but adhering to matter, which is dyadic, He unifies it, and is Himself cut by it." And a little later: "For it is not fitting for the first God to create; and it must be thought that the first God is the father of the creator-god." He says many things similar to these about the same matter, which it would be long to relate. Does not Amelius indeed seem to follow the theology of John the Evangelist entirely when he says: "And this was that Word through which those things that were made came to be, although they always were; as Heraclitus also wished: and, by Jove, that barbarian judges that [the Word], established in the order and dignity of the principle, is with God, and is God, and through Him all things were made, and in Him that which was made was living and life and being," and other things of this kind? For there is no need to relate all things, since his books are ready at hand for those who wish to read them. Here truly, because he cannot deny the truth, even if unwilling, he approves the sentiment and accepts the faith of him whom, as if an enemy, he calls a barbarian.

But if the adversary—who interprets all things wrongly—calumniates those things which the most holy doctors took up as certain supports for our religion, claiming they were the cause of Origen, Arius, and others of this sort falling into most pernicious errors
… [1616 more characters]
````

**Clean `text` (annotation-layer/3)**

````text
it is necessary to distribute each thing in order; and after he has implored divine favor for the sake of this matter, he continues thus: "It must now be distributed: the first God, subsisting in Himself, is simple; who, being always joined to Himself in every part, cannot be disjoined or divided. But the second and third God is one; but adhering to matter, which is dyadic, He unifies it, and is Himself cut by it." And a little later: "For it is not fitting for the first God to create; and it must be thought that the first God is the father of the creator-god." He says many things similar to these about the same matter, which it would be long to relate. Does not Amelius indeed seem to follow the theology of John the Evangelist entirely when he says: "And this was that Word through which those things that were made came to be, although they always were; as Heraclitus also wished: and, by Jove, that barbarian judges that [the Word], established in the order and dignity of the principle, is with God, and is God, and through Him all things were made, and in Him that which was made was living and life and being," and other things of this kind? For there is no need to relate all things, since his books are ready at hand for those who wish to read them. Here truly, because he cannot deny the truth, even if unwilling, he approves the sentiment and accepts the faith of him whom, as if an enemy, he calls a barbarian.

But if the adversary—who interprets all things wrongly—calumniates those things which the most holy doctors took up as certain supports for our religion, claiming they were the cause of Origen, Arius, and others of this sort falling into most pernicious errors; since indeed he writes that Plato was the author of the various heresies that have sprouted among Christia
… [1324 more characters]
````

**Annotations** (12)

| # | type | tag | anchor (exact) | body |
|---|---|---|---|---|
| 1 | pagedata | language | *page* | Latin |
| 2 | pagedata | page-type | *page* | text |
| 3 | pagedata | page-num | *page* | 54 |
| 4 | meta | meta | *page* | catchword: Qui |
| 5 | margin |  | “ Amelius, the follower of Plato, [cites] John the Evangelist” |  |
| 6 | margin |  | “ The opinion of Arius. ” |  |
| 7 | margin |  | “ The opinion of Sabellius. ” |  |
| 8 | margin |  | “ Divine words badly interpreted by many heretics.” |  |
| 9 | vocab | vocab | *page* | Amelius, Heraclitus, Origenes, Arrius, Sabellius, Ioannes euangelista, Platonis, heresis, Trinitas |
| 10 | interp | interp | “[the Word]” |  |
| 11 | interp | interp | “[cites]” |  |
| 12 | interp | interp | “[from]” |  |

**Reader notes-off vs parser notes-off** (`[-reader only-]` `{+parser only+}`): same words

## 22. Lehigh Codex — p. 45

https://sourcelibrary.org/book/lehigh-codex-15th-c-naples-alchemical-ms-compiler/page/69500525f426a210d109ea1f · prompt v2 · syntaxes: [interpolation]

**Raw `translation.data`**

````text
<meta>This page continues the specific structural requirements for alchemy furnaces. While the previous page focused on the foundation and the "wheel" or grate system, this page moves into the construction of the upper walls, the ventilation system for smoke, and the chemical process of glazing vessels using lead-based compounds. It marks a transition from laboratory infrastructure to active chemical procedure.</meta>

<column-break/>

<margin>
For distillation:
Let the distillation
be done in this way
on the master furnace:
in this way let it be 
done on the ground. 
To... in another 
hand and so 
construct the vessels 
as they are fit. (Another)
for subliming <note>Sublimation: heating a solid until it turns into a gas and then back into a solid without becoming a liquid.</note>
... another for 
reforming positions 
in the place of the master.
</margin>
In the four walls, let the stones be placed in the middle of the wall in this manner. And let the wall be strengthened by them. Let it be made of clay as I said above: or in well-worked clay. Let the wall be round everywhere and have [proper] feet in length and width, or upon the ground where there is an empty space through the middle of the wall where the wood may be placed. Thus, let the wall be two feet in width, or a little less, and let it be closed. This is done with stones and good clay. And in the middle, let a hole be left through which the flame from below will enter above the furnace, half a foot in width. This being done, let a wall be made above it around the circumference the width of a small ell <note>original: "vlne". An ell is a traditional unit of measurement based on the length of a forearm.</note>, and so let it be closed.

<margin>
For the purifier:
of purification it is 
not to be sent: which is 

… [3263 more characters]
````

**Clean `text` (annotation-layer/3)**

````text
<column-break/>


For distillation:
Let the distillation
be done in this way
on the master furnace:
in this way let it be 
done on the ground. 
To... in another 
hand and so 
construct the vessels 
as they are fit. (Another)
for subliming
... another for 
reforming positions 
in the place of the master.

In the four walls, let the stones be placed in the middle of the wall in this manner. And let the wall be strengthened by them. Let it be made of clay as I said above: or in well-worked clay. Let the wall be round everywhere and have [proper] feet in length and width, or upon the ground where there is an empty space through the middle of the wall where the wood may be placed. Thus, let the wall be two feet in width, or a little less, and let it be closed. This is done with stones and good clay. And in the middle, let a hole be left through which the flame from below will enter above the furnace, half a foot in width. This being done, let a wall be made above it around the circumference the width of a small ell, and so let it be closed.


For the purifier:
of purification it is 
not to be sent: which is 
manifest to those who 
[do] not [have] 
glazed [vessels]. Which 
easily can 
be calcined. 
Moreover, let them 
be bent in [this] 
manner.

And let there be four or six small holes made at the top so that the smoke can exit freely from there. Also, let there be a large hole in the middle of the furnace where the vessels are placed for glazing and calcining. And thus it is blocked through the hole where the wood is placed, and let one part be higher than the other. Let the wood be placed in the front part, and in the larger part let the coals be drawn out into the mouth of the furnace: so that if the fire wanders, it can better enter beneath the upper furnace.

<column-bre
… [1438 more characters]
````

**Annotations** (22)

| # | type | tag | anchor (exact) | body |
|---|---|---|---|---|
| 1 | meta | meta | *page* | This page continues the specific structural requirements for alchemy furnaces. While the previous page focused on the fo |
| 2 | margin |  | “ For distillation: Let the distillation be done in this way ” |  |
| 3 | note | note | “for subliming” | Sublimation: heating a solid until it turns into a gas and then back into a solid without becoming a liquid. |
| 4 | original | note | “a small ell” | original: "vlne". An ell is a traditional unit of measurement based on the length of a forearm. |
| 5 | margin |  | “ For the purifier: of purification it is not to be sent: whi” |  |
| 6 | note | note | “be calcined” | Calcination: heating a substance to high temperatures to reduce it to a powder. |
| 7 | original | note | “placed for glazing” | original: "vitriandu", the process of applying a glass-like coating to pottery. |
| 8 | term |  | “minium” |  |
| 9 | definition | note | “minium” | red lead (lead tetroxide), used as a pigment and a flux to help glazes melt. |
| 10 | term |  | “ceruse” |  |
| 11 | definition | note | “ceruse” | white lead (basic lead carbonate), a traditional pigment used here as a glaze component. |
| 12 | original | note | “a large brush” | original: "patello", literally a small dish, but used here in the context of the application tool. |
| 13 | note | note | “are four spirits” | in alchemy, "spirits" are volatile substances that can be evaporated or sublimated, usually referring to mercury, sulfur |
| 14 | original | note | “bodies, namely Quicksilver” | original: "Argentum [vivum]". This refers to mercury. |
| 15 | summary | summary | *page* | This page details the structural measurements for building a circular furnace and the specific chemical procedure for gl |
| 16 | keywords | keywords | *page* | furnace construction, glazing, minium, ceruse, lead ore, alchemical spirits, laboratory equipment, vitrification |
| 17 | interp | interp | “[proper]” |  |
| 18 | interp | interp | “[do]” |  |
| 19 | interp | interp | “[have]” |  |
| 20 | interp | interp | “[vessels]” |  |
| 21 | interp | interp | “[this]” |  |
| 22 | interp | interp | “[holes]” |  |

**Reader notes-off vs parser notes-off** (`[-reader only-]` `{+parser only+}`): 

````text
[-Sublimation: heating a solid until it turns into a gas and then back into a solid without becoming a liquid.-]
{+.+}
[-Calcination: heating a substance to high temperatures to reduce it to a powder..-]
````

## 23. Aureum vellus oder guldin Schatz und Kunstkammer — p. 321

https://sourcelibrary.org/book/the-golden-fleece-aureum-vellus-trissmosin-2/page/69769568068a367bb16e4cf6 · prompt v2 · syntaxes: [interpolation]

**Raw `translation.data`**

````text
<meta>This page continues the Third Chapter, specifically identifying the correct "Matter" for the Philosopher's Stone. The previous page argued that metals are composed of Mercury and Sulphur and that the alchemist should look to mineral sources rather than "foreign" substances. This page details why organic sources (plants and animals) are inefficient compared to minerals.</meta>

Mirror of Alchemy.
I iij
<meta>catchword: teln [middle/intermediate substances]</meta>

...make, only that which has received its beginning from them,
and has sprung from these two; thus we must conduct ourselves
accordingly and must take for the **Matter** <note>original: "Materia"</note> of our **Stone**, **Mercury** [☿]
and **Sulphur**, and nothing else; and yet **metals** are not born from 
**Mercury** alone, nor from **Sulphur** alone, but from the 
mixture of the two, according to whether they are **Pure** and **Impure**; 
thus also all metals become different, one from
the other; out of them also come many other
and various contrary **minerals** and **ores**; therefore,
from the mixture of these two is the **Matter**
of our **Stone** to be chosen; but our ultimate
and most excellent secret and mystery is this:
from which **ore**, or from what thing exactly, our **Stone**
shall be made.

Therefore, it should be noted that it must be made
from that which is closest and most fitting to **Nature**; that 
same thing we should choose. So I propose this: if we wished to 
make it from **Vegetables** <note>original: "Vegetabilien"; refers to the plant kingdom.</note>, that is, from growing 
things, such as **plants** <note>original: "plantæ"</note>, herbs, grass, flowers, or everything 
that grows from the earth and thus has a **growing soul** <note>Referring to the "vegetative soul" in Aristo
… [1515 more characters]
````

**Clean `text` (annotation-layer/3)**

````text
Mirror of Alchemy.
I iij
...make, only that which has received its beginning from them,
and has sprung from these two; thus we must conduct ourselves
accordingly and must take for the **Matter** of our **Stone**, **Mercury** [☿]
and **Sulphur**, and nothing else; and yet **metals** are not born from 
**Mercury** alone, nor from **Sulphur** alone, but from the 
mixture of the two, according to whether they are **Pure** and **Impure**; 
thus also all metals become different, one from
the other; out of them also come many other
and various contrary **minerals** and **ores**; therefore,
from the mixture of these two is the **Matter**
of our **Stone** to be chosen; but our ultimate
and most excellent secret and mystery is this:
from which **ore**, or from what thing exactly, our **Stone**
shall be made.

Therefore, it should be noted that it must be made
from that which is closest and most fitting to **Nature**; that 
same thing we should choose. So I propose this: if we wished to 
make it from **Vegetables**, that is, from growing 
things, such as **plants**, herbs, grass, flowers, or everything 
that grows from the earth and thus has a **growing soul**; 
then we must first make **Mercury** and **Sulphur** out of them
through a long **cooking** decoction; 
we may well do without this, or find it superfluous,
and we may excuse ourselves from such cooking, since **Nature** 
has already prepared and made **Mercury** [☿] and **Sulphur** for us.

But if we now wished to choose our **Stone** from 
**Animals**, that is, from things that come from humans or 
from beasts—such as human blood, and hair,
or urine, thūn, and subtle and raw hen's eggs, or from
all other things that spring from animals; then **Mercury** [☿] 
and **Sulphur** must first be made from them, as was previously 
… [131 more characters]
````

**Annotations** (16)

| # | type | tag | anchor (exact) | body |
|---|---|---|---|---|
| 1 | meta | meta | *page* | This page continues the Third Chapter, specifically identifying the correct "Matter" for the Philosopher's Stone. The pr |
| 2 | meta | meta | *page* | catchword: teln [middle/intermediate substances] |
| 3 | original | note | “for the **Matter” | original: "Materia" |
| 4 | original | note | “it from **Vegetables” | original: "Vegetabilien"; refers to the plant kingdom. |
| 5 | original | note | “such as **plants” | original: "plantæ" |
| 6 | note | note | “a **growing soul” | Referring to the "vegetative soul" in Aristotelian biology, which governs growth and nutrition. |
| 7 | term |  | “decoction” |  |
| 8 | note | note | “long **cooking** decoction” | The process of heating a substance over a long period to refine or mature it. |
| 9 | original | note | “**Animals” | original: "Animalibus" |
| 10 | unclear |  | “thūn” |  |
| 11 | note | note | “or urine, thūn” | Likely "Dung" (manure) or "Thau" (dew), both common in alchemical experiments. |
| 12 | summary | summary | *page* | The author argues that the "Matter" of the Philosopher's Stone must be Mercury and Sulphur. He explains that while these |
| 13 | keywords | keywords | *page* | Mercury, Sulphur, Matter of the Stone, Alchemy, Minerals, Plant Kingdom, Animal Kingdom, Decoction, Nature, Growing Soul |
| 14 | interp | interp | “[☿]” |  |
| 15 | interp | interp | “[☿]” |  |
| 16 | interp | interp | “[☿]” |  |

**Reader notes-off vs parser notes-off** (`[-reader only-]` `{+parser only+}`): same words

## 24. De Occulta Philosophia Liber II — p. 10

https://sourcelibrary.org/book/agrippa-de-occulta-philosophia-book-ii-1531-nettesheim/page/69b4cc3dd2bf9b45ea479702 · prompt none · syntaxes: [interpolation]

**Raw `translation.data`**

````text
[Blank page — no translatable content]
````

**Clean `text` (annotation-layer/3)**

````text
[Blank page — no translatable content]
````

**Annotations** (1)

| # | type | tag | anchor (exact) | body |
|---|---|---|---|---|
| 1 | interp | interp | “[Blank page — no translatable content]” |  |

**Reader notes-off vs parser notes-off** (`[-reader only-]` `{+parser only+}`): same words

## 25. Procli Opera (Grec 1839) — p. 702

https://sourcelibrary.org/book/procli-opera-grec-1839-proclus/page/69a5e5e385fa13e734e41b52 · prompt v5.2026-02 · syntaxes: [interpolation]

**Raw `translation.data`**

````text
<meta>This page transitions from the general structural properties of the World Soul into the specific mathematical and harmonic ratios used by the Demiurge (the Creator) to "weave" the soul together. Proclus is here interpreting the middle section of the Timaeus where Plato describes the division of the soul's substance into harmonic intervals.</meta>

<margin>
Regarding the Demiurge of the *Timaeus*: he is the most supreme of all creators.
</margin>

And the other, the "whole before the parts," stood firm within her; nor is the "whole in the parts" established through the **generation of the soul** <note>*psychogonia*; the process by which the divine Creator brings the World Soul into existence</note>. Through specific declarations, the divisions of the demiurgic work are accomplished by means of **ratios** <note>*analogion*; mathematical proportions that create bond and harmony</note>. Through the circles, the totality of the parts is handed down in every instance. 

And it must be said that the Demiurge in the *Timaeus* is truly the most proportionate <note>original: *analogōtatē*; characterized by perfect mathematical ratio.</note> of all creators. For he performs the cuts—he himself being the Divider—and acts in the manner of **Apollo** <note>Apollo was often associated by Neoplatonists with the "Monad" and the principle of harmony and light that defines the limits of things.</note>. He creates the body, and he gives shape according to the ... visible appearance. He defines the hollows of the ages <note>original: *aionon*; referring to the vast spans of time or perhaps the "eons" of the intelligible world.</note> and to what extent they reach. He inscribes these things similarly to what has been fated, as if they possessed **Necessity** <note>original: *Anankēn*; 
… [3226 more characters]
````

**Clean `text` (annotation-layer/3)**

````text

Regarding the Demiurge of the *Timaeus*: he is the most supreme of all creators.


And the other, the "whole before the parts," stood firm within her; nor is the "whole in the parts" established through the **generation of the soul**. Through specific declarations, the divisions of the demiurgic work are accomplished by means of **ratios**. Through the circles, the totality of the parts is handed down in every instance. 

And it must be said that the Demiurge in the *Timaeus* is truly the most proportionate of all creators. For he performs the cuts—he himself being the Divider—and acts in the manner of **Apollo**. He creates the body, and he gives shape according to the ... visible appearance. He defines the hollows of the ages and to what extent they reach. He inscribes these things similarly to what has been fated, as if they possessed **Necessity**. 

Our purpose concerning the generation of the soul is to unfold what is said regarding its **essence**, or rather concerning the things governed by it—or even more immediately, the things in the world that exist through the essential qualities present within the soul itself. 

We must ask: 
* What are the **means**? 
* What are the multiple ratios? 
* What are the **superparticulars** and the **superpartients**? 
* What is the **remainder**? 
* What are the seven portions? 
* Why is the diagram encompassing the division like the fourfold **octaves** and the fifths?

For the cosmos is adorned by these three systems: **arithmetic, music, and geometry**. For our internal ratio is composed of these three. This is the equality of **Themis**, from whom all order arises. Her three daughters are: **Good Order** Good Order: *Eunomia*, **Justice** Justice: *Dikē*, and **Peace** Peace: *Eirēnē*. 

Arithmetic is characterized by th
… [825 more characters]
````

**Annotations** (24)

| # | type | tag | anchor (exact) | body |
|---|---|---|---|---|
| 1 | meta | meta | *page* | This page transitions from the general structural properties of the World Soul into the specific mathematical and harmon |
| 2 | margin |  | “ Regarding the Demiurge of the *Timaeus*: he is the most sup” |  |
| 3 | note | note | “**generation of the soul” | *psychogonia*; the process by which the divine Creator brings the World Soul into existence |
| 4 | note | note | “means of **ratios” | *analogion*; mathematical proportions that create bond and harmony |
| 5 | original | note | “the most proportionate” | original: *analogōtatē*; characterized by perfect mathematical ratio. |
| 6 | note | note | “manner of **Apollo” | Apollo was often associated by Neoplatonists with the "Monad" and the principle of harmony and light that defines the li |
| 7 | original | note | “of the ages” | original: *aionon*; referring to the vast spans of time or perhaps the "eons" of the intelligible world. |
| 8 | original | note | “they possessed **Necessity” | original: *Anankēn*; the cosmic force of constraint that works alongside the Demiurge's Persuasion. |
| 9 | original | note | “regarding its **essence” | original: *ousian*; the fundamental nature of the soul that sits between the eternal and the temporal. |
| 10 | note | note | “are the **means” | *mesotētes*; the mathematical averages (arithmetic, geometric, and harmonic) that bridge the gaps between numbers. |
| 11 | original | note | “are the **superparticulars” | original: *epimorioi*; ratios where the larger number contains the smaller plus one part of it, such as 3:2 or 4:3. |
| 12 | original | note | “and the **superpartients” | original: *epimereis*; ratios like 5:3 or 7:4. |
| 13 | note | note | “is the **remainder” | *lēmma*; in musical theory, the "leimma" or the small interval left over, roughly a semi-tone. |
| 14 | original | note | “the fourfold **octaves” | original: *dia pason*; literally "through all [notes]," the basic musical scale. |
| 15 | note | note | “music, and geometry” | Proclus sees these as the "cosmetic" or adorning sciences of the Demiurge. |
| 16 | note | note | “equality of **Themis” | The goddess of divine law and order; here representing the principle of cosmic equilibrium. |
| 17 | term |  | “Good Order: *Eunomia*” |  |
| 18 | term |  | “Justice: *Dikē*” |  |
| 19 | term |  | “Peace: *Eirēnē*” |  |
| 20 | unclear |  | “earth” |  |
| 21 | original | note | “totalities both **divisible” | original: *meristē* |
| 22 | original | note | “**divisible** and **indivisisible” | original: *ameristos* |
| 23 | summary | summary | *page* | Proclus explains how the Demiurge uses mathematical ratios (arithmetic, musical, and geometric) to construct the World S |
| 24 | keywords | keywords | *page* | Demiurge, Psychogony, Harmonic Ratios, Arithmetic Mean, Themis, Eunomia, Dike, Eirene, World Soul, Divisibility |

**Reader notes-off vs parser notes-off** (`[-reader only-]` `{+parser only+}`): same words

## 26. Opera Omnia Vol. 2 — p. 538

https://sourcelibrary.org/book/opera-omnia-vol-2-hippo/page/69b2ff4b5545150b61b477ce · prompt v1 · syntaxes: [interpolation]

**Raw `translation.data`**

````text
doctrine: for this reason, he says, "No one has ever seen God, unless the only-begotten Son who is in the bosom of the Father, He has made Him known." Let us notice the sense of the Evangelist, for in order to show that it is true that no one has ever seen God, he teaches that the Son has made Him known: whom it is impossible to be deceived, because He is in the bosom of the Father. But what is the bosom of the Father, if not the affection in the charity of the true Father through the unity of nature in the Son? Wherefore no one has seen God, unless the only Son; John the Apostle heard the Son of God saying this among other things, "Not that anyone has seen the Father, except he who is from God, he has seen the Father." Therefore, in order to profit toward the condemnation of the Jews, who did not wish to hear or believe Christ to be the Son of God, the Evangelist shows this to be Christ who had appeared to the fathers as God: but Him who is the Father, [he shows] to be never seen unless by the Son. For when He denies that God the Father was seen, and confesses that God appeared to the fathers, He wishes to manifest Himself as the Son of God, because He Himself was always seen as God by the fathers. Whence, among other things, He says to the Jews about the Father, "Neither have you heard His voice at any time, nor have you seen His figure." Behold, it is not contradictory that God is both seen and unseen.

<margin>LXXII</margin>
When it is read in the Apocalypse of John, "Go," he says, "and take the book from the hand of the angel and devour it, and it will make your belly bitter, but in your mouth it will be sweet as honey": What is this book that makes the belly bitter when it is sweet? All divine volumes are bitter, but to the faithless and carnal: For to idolaters i
… [3848 more characters]
````

**Clean `text` (annotation-layer/3)**

````text
doctrine: for this reason, he says, "No one has ever seen God, unless the only-begotten Son who is in the bosom of the Father, He has made Him known." Let us notice the sense of the Evangelist, for in order to show that it is true that no one has ever seen God, he teaches that the Son has made Him known: whom it is impossible to be deceived, because He is in the bosom of the Father. But what is the bosom of the Father, if not the affection in the charity of the true Father through the unity of nature in the Son? Wherefore no one has seen God, unless the only Son; John the Apostle heard the Son of God saying this among other things, "Not that anyone has seen the Father, except he who is from God, he has seen the Father." Therefore, in order to profit toward the condemnation of the Jews, who did not wish to hear or believe Christ to be the Son of God, the Evangelist shows this to be Christ who had appeared to the fathers as God: but Him who is the Father, [he shows] to be never seen unless by the Son. For when He denies that God the Father was seen, and confesses that God appeared to the fathers, He wishes to manifest Himself as the Son of God, because He Himself was always seen as God by the fathers. Whence, among other things, He says to the Jews about the Father, "Neither have you heard His voice at any time, nor have you seen His figure." Behold, it is not contradictory that God is both seen and unseen.

LXXII
When it is read in the Apocalypse of John, "Go," he says, "and take the book from the hand of the angel and devour it, and it will make your belly bitter, but in your mouth it will be sweet as honey": What is this book that makes the belly bitter when it is sweet? All divine volumes are bitter, but to the faithless and carnal: For to idolaters it is unpleasant w
… [3814 more characters]
````

**Annotations** (4)

| # | type | tag | anchor (exact) | body |
|---|---|---|---|---|
| 1 | margin |  | “LXXII” |  |
| 2 | margin |  | “LXXIII” |  |
| 3 | interp | interp | “[he shows]” |  |
| 4 | interp | interp | “[the one]” |  |

**Reader notes-off vs parser notes-off** (`[-reader only-]` `{+parser only+}`): same words

## 27. Geistliche Correspondentz — p. 792

https://sourcelibrary.org/book/spiritual-correspondence-schutz/page/697d10000394a373312e1855 · prompt v2 · syntaxes: [interpolation]

**Raw `translation.data`**

````text
<meta>This page continues the author’s devotional exercise on the surrender of the self to God. On the previous page, the author discussed losing one’s own will within the Divine Will; here, the focus shifts to the practical application of this union through prayer, the sanctification of suffering, and spiritual warfare against sin.</meta>

<page-num>743</page-num>
<page-type>text</page-type>
<sig>Aaa 4</sig>

as He desires them; indeed, I present to the eternal Father **JESUS** Christ praying within me / as the one whom the Father always hears / and this is perhaps / what Christ teaches us / when he says / that we should ask the Father in His name.

I sanctify my small sufferings <note>original: *Leyden*; in this context, it refers to both physical ailments and spiritual trials or "crosses" that a believer must bear.</note> / external and internal / bodily and spiritual in His suffering and pains / which He endured out of love for me. This occurs by viewing my sufferings as a fellowship <note>original: *Gemeinschafft*; a key Pietist term implying a mystical, shared participation in the experiences of Christ.</note> of His sufferings / which He sent to me out of pure love / and measured according to my meager strengths / as a small taste of the fruits of my sins to taste and to heal me from them. Therefore, I accept them humbly from the hand of my Father and Savior / I offer myself up to them / to suffer such things as long / as they shall see fit: and I thank Christ for His infinite love / that He took unutterably more upon Himself / thereby to redeem us from all misery.

I immerse my sins in His holy blood / in that I detest <note>original: *detestire*; from the Latin *detestari*, meaning to solemnly renounce or turn away from with loathing.</note> / reject, and conde
… [1065 more characters]
````

**Clean `text` (annotation-layer/3)**

````text
as He desires them; indeed, I present to the eternal Father **JESUS** Christ praying within me / as the one whom the Father always hears / and this is perhaps / what Christ teaches us / when he says / that we should ask the Father in His name.

I sanctify my small sufferings / external and internal / bodily and spiritual in His suffering and pains / which He endured out of love for me. This occurs by viewing my sufferings as a fellowship of His sufferings / which He sent to me out of pure love / and measured according to my meager strengths / as a small taste of the fruits of my sins to taste and to heal me from them. Therefore, I accept them humbly from the hand of my Father and Savior / I offer myself up to them / to suffer such things as long / as they shall see fit: and I thank Christ for His infinite love / that He took unutterably more upon Himself / thereby to redeem us from all misery.

I immerse my sins in His holy blood / in that I detest / reject, and condemn them all without any exception according to my free will / and long / that through the power of this most precious blood I may be truly and in deed so completely washed / and purified from them / that not even the slightest trace of any of them remains within me.

In Him I fight against my enemies / so that suddenly and immediately at the first sight of the rising lust / through which they lure me to consent / I turn my thoughts away from everything / and hide myself in the omnipotence of my Savior. Him I let fight in my place and for me / and my whole work is / [to turn] my thoughts from
````

**Annotations** (12)

| # | type | tag | anchor (exact) | body |
|---|---|---|---|---|
| 1 | meta | meta | *page* | This page continues the author’s devotional exercise on the surrender of the self to God. On the previous page, the auth |
| 2 | pagedata | page-num | *page* | 743 |
| 3 | pagedata | page-type | *page* | text |
| 4 | pagedata | sig | *page* | Aaa 4 |
| 5 | original | note | “my small sufferings” | original: *Leyden*; in this context, it refers to both physical ailments and spiritual trials or "crosses" that a believ |
| 6 | original | note | “as a fellowship” | original: *Gemeinschafft*; a key Pietist term implying a mystical, shared participation in the experiences of Christ. |
| 7 | original | note | “that I detest” | original: *detestire*; from the Latin *detestari*, meaning to solemnly renounce or turn away from with loathing. |
| 8 | original | note | “in the omnipotence” | original: *Allmacht* |
| 9 | meta | meta | *page* | catchword: the [den] |
| 10 | summary | summary | *page* | The author describes a mystical practice of "praying in Christ's name" by visualizing Christ praying within the soul and |
| 11 | keywords | keywords | *page* | Pietism, spiritual warfare, fellowship of suffering, blood of Christ, sanctification, internal prayer, omnipotence of th |
| 12 | interp | interp | “[to turn]” |  |

**Reader notes-off vs parser notes-off** (`[-reader only-]` `{+parser only+}`): same words

## 28. Gründliche chemische Anmerkungen über Herrn von Welling Opus Mago-Cabbalisticum — p. 282

https://sourcelibrary.org/book/grundliche-chemische-anmerkungen-uber-herrn-von-welling-linden/page/6991d6938c1030b12444beee · prompt v5.2026-02 · syntaxes: [interpolation]

**Raw `translation.data`**

````text
<meta>This page concludes Linden’s commentary on hydrophobia (rabies). It follows the previous discussion where Linden critiqued Dr. Richard Mead’s reliance on bloodletting, shifting now to a practical anatomical guide for assessing the urgency of treatment based on the location of the bite.</meta>

# Remarks on the Healing of Hydrophobia.

In conclusion, I must add one more circumstance here, which, it seems, has been forgotten by our Author <note>Georg von Welling, the author of the *Opus Mago-Cabbalisticum* which Linden is annotating</note>, but which must not be forgotten due to its importance. The evaluation of the <term>preventative remedies</term> <note>original: *Präservation*; treatments intended to stop the disease before symptoms appear</note> which are most suitable and necessary to take after the bite depends upon this: namely, recognizing the danger of the bite itself.

In these circumstances, one must judge according to the parts of the body where the bite from the <term>mad beast</term> <note>original: *tollen Bestien*; an animal infected with rabies</note> occurred. For if the bite is nearest to the <term>vena cava</term> <note>the primary vein that carries deoxygenated blood from the body back into the heart</note> or to such veins that have many obstructions—the so-called <term>valves and vents</term> <note>original: *Valvulen und Ventilen*; venous valves that prevent the backward flow of blood</note>—whereby the free and swift flow of the blood is considerably slowed down, then there is no such great haste required as when the bite occurs near the <term>arteries</term> <note>original: *Puls- und andern Adern*; literally "pulse-veins," referring to the arterial system where blood moves rapidly under pressure from the heart</note> and other vessels whe
… [990 more characters]
````

**Clean `text` (annotation-layer/3)**

````text
# Remarks on the Healing of Hydrophobia.

In conclusion, I must add one more circumstance here, which, it seems, has been forgotten by our Author, but which must not be forgotten due to its importance. The evaluation of the preventative remedies which are most suitable and necessary to take after the bite depends upon this: namely, recognizing the danger of the bite itself.

In these circumstances, one must judge according to the parts of the body where the bite from the mad beast occurred. For if the bite is nearest to the vena cava or to such veins that have many obstructions—the so-called valves and vents —whereby the free and swift flow of the blood is considerably slowed down, then there is no such great haste required as when the bite occurs near the arteries and other vessels where the blood has a freer and more unhindered course. 

In the former case, one can provide milder remedies that are not too harmful to the body's nature; in the latter, however, one must proceed more hastily and with greater intensity. If this is done, there will never be a failure to reach a desired and happy

->**E N D.**<-
````

**Annotations** (19)

| # | type | tag | anchor (exact) | body |
|---|---|---|---|---|
| 1 | meta | meta | *page* | This page concludes Linden’s commentary on hydrophobia (rabies). It follows the previous discussion where Linden critiqu |
| 2 | note | note | “by our Author” | Georg von Welling, the author of the *Opus Mago-Cabbalisticum* which Linden is annotating |
| 3 | term |  | “preventative remedies” |  |
| 4 | definition | note | “preventative remedies” | original: *Präservation*; treatments intended to stop the disease before symptoms appear |
| 5 | term |  | “mad beast” |  |
| 6 | definition | note | “mad beast” | original: *tollen Bestien*; an animal infected with rabies |
| 7 | term |  | “vena cava” |  |
| 8 | definition | note | “vena cava” | the primary vein that carries deoxygenated blood from the body back into the heart |
| 9 | term |  | “valves and vents” |  |
| 10 | definition | note | “valves and vents” | original: *Valvulen und Ventilen*; venous valves that prevent the backward flow of blood |
| 11 | term |  | “arteries” |  |
| 12 | definition | note | “arteries” | original: *Puls- und andern Adern*; literally "pulse-veins," referring to the arterial system where blood moves rapidly  |
| 13 | term |  | “remedies” |  |
| 14 | definition | note | “remedies” | original: *Erhaltungs-Mittel*; literally "preservation-means" |
| 15 | term |  | “intensity” |  |
| 16 | definition | note | “intensity” | original: *durchdringender*; literally "more penetratingly" |
| 17 | meta | meta | *page* | catchword: Regi- [Register / Index] |
| 18 | summary | summary | *page* | Linden concludes his remarks on rabies by explaining that the urgency of treatment depends on the bite's proximity to ar |
| 19 | keywords | keywords | *page* | hydrophobia, rabies, blood circulation, vena cava, venous valves, arteries, medical urgency, Georg von Welling, Dietrich |

**Reader notes-off vs parser notes-off** (`[-reader only-]` `{+parser only+}`): 

````text
{+->**+}
[-.-]
{+.**<-+}
````

## 29. Annotationes Magistri Peritissimi; Operationes Chymicae (Leiden VCF 24) — p. 530

https://sourcelibrary.org/book/annotationes-magistri-peritissimi-omnia-germanice-f-1-villanova/page/6991c5763074a1745a411812 · prompt v2 · syntaxes: [interpolation]

**Raw `translation.data`**

````text
<meta>This page continues the instructions for the alchemical process, shifting from the initial physical preparations to the spiritual and allegorical understanding of the substances, specifically focusing on the timing of the work and the roles of "Spirits" and "Bodies."</meta>

...buds, or when the Sun is in the heavenly sign of Aries <note>the Ram; marking the beginning of Spring</note>, at which time the trees sprout and meanwhile turn green; that will either change or remain. But when all this has happened, **this is in the beginning of the whole until the reddening or fermentation, honor the moistures.** <note>original Latin: "hoc est in principio totius usq ad rubificationem aut fermentationem veneramini humiditates"</note> That is, from the beginning until the <term>reddening; original: rubification; the final stage of the alchemical Great Work</term> or <term>fermentation; the stage where the "stone" is given the power to transform other metals</term>, hold the <term>moistures; original: humiditates</term> or fluids in honor and great value; for they are courageous and magnanimous Kings, and suffer no <term>injury; original: Iniuriam</term> or injustice. To use force against them or do them wrong causes resentment, so they will leave you or let you go, out of their own dignity. Hold the kings in honor, and their wives. <term>Geber; original: Esber; an influential 8th-century alchemist</term> said: Our art is divided into two parts; one part is of the <term>Spirits; original: Spiritibus; volatile substances that can evaporate or "fly"</term> or spirits, the other is of the <term>Bodies; original: Corporibus; the solid metals or residues</term>. And whoever knows how to prepare the <term>Spirits</term> and the <term>Bodies</term> well shall obtain every <term>Se
… [3157 more characters]
````

**Clean `text` (annotation-layer/3)**

````text
...buds, or when the Sun is in the heavenly sign of Aries, at which time the trees sprout and meanwhile turn green; that will either change or remain. But when all this has happened, **this is in the beginning of the whole until the reddening or fermentation, honor the moistures.** That is, from the beginning until the reddening; original: rubification; the final stage of the alchemical Great Work or fermentation; the stage where the "stone" is given the power to transform other metals, hold the moistures; original: humiditates or fluids in honor and great value; for they are courageous and magnanimous Kings, and suffer no injury; original: Iniuriam or injustice. To use force against them or do them wrong causes resentment, so they will leave you or let you go, out of their own dignity. Hold the kings in honor, and their wives. Geber; original: Esber; an influential 8th-century alchemist said: Our art is divided into two parts; one part is of the Spirits; original: Spiritibus; volatile substances that can evaporate or "fly" or spirits, the other is of the Bodies; original: Corporibus; the solid metals or residues. And whoever knows how to prepare the Spirits and the Bodies well shall obtain every Secret; original: Secretum or mystery and knowledge. The process; original: Experimentum destroys and annihilates the form; original: formam or nature; original: Specierum in the metals; everything, every metal that is a metal, whenever it is calcined; burned to a fine powder 

<column-break/>

calcined, and is turned and rotated; which body is then able to take into itself a white or red Tincture; original: Tincturen; the transformative substance that changes the color and nature of a metal. And such a thing can happen and be accomplished within three hours, and it is prepared
… [1440 more characters]
````

**Annotations** (45)

| # | type | tag | anchor (exact) | body |
|---|---|---|---|---|
| 1 | meta | meta | *page* | This page continues the instructions for the alchemical process, shifting from the initial physical preparations to the  |
| 2 | note | note | “sign of Aries” | the Ram; marking the beginning of Spring |
| 3 | note | note | “honor the moistures” | original Latin: "hoc est in principio totius usq ad rubificationem aut fermentationem veneramini humiditates" |
| 4 | term |  | “reddening; original: rubification; the final stage of the al” |  |
| 5 | term |  | “fermentation; the stage where the "stone" is given the power” |  |
| 6 | term |  | “moistures; original: humiditates” |  |
| 7 | term |  | “injury; original: Iniuriam” |  |
| 8 | term |  | “Geber; original: Esber; an influential 8th-century alchemist” |  |
| 9 | term |  | “Spirits; original: Spiritibus; volatile substances that can ” |  |
| 10 | term |  | “Bodies; original: Corporibus; the solid metals or residues” |  |
| 11 | term |  | “Spirits” |  |
| 12 | term |  | “Bodies” |  |
| 13 | term |  | “Secret; original: Secretum” |  |
| 14 | term |  | “process; original: Experimentum” |  |
| 15 | term |  | “form; original: formam” |  |
| 16 | term |  | “nature; original: Specierum” |  |
| 17 | term |  | “calcined; burned to a fine powder” |  |
| 18 | term |  | “Tincture; original: Tincturen; the transformative substance ” |  |
| 19 | term |  | “prepared” |  |
| 20 | term |  | “Arsenic; original: Arsenico” |  |
| 21 | term |  | “Sulfur; original: Sulphur” |  |
| 22 | term |  | “phosphorus; original: phosphor” |  |
| 23 | term |  | “separation” |  |
| 24 | term |  | “dissolution; original: dissolition” |  |
| 25 | term |  | “Senior; likely referring to the alchemist Zadith ben Hamuel” |  |
| 26 | term |  | “Body; original: Corpus” |  |
| 27 | term |  | “dissolved; original: solvinirt” |  |
| 28 | term |  | “manure; original: fimis” |  |
| 29 | term |  | “renewed; original: renovirt” |  |
| 30 | term |  | “renewal; original: renovatio” |  |

… 15 more

**Reader notes-off vs parser notes-off** (`[-reader only-]` `{+parser only+}`): 

````text
{+[m]+}
````

## 30. Het graf der valsche theologie — p. 363

https://sourcelibrary.org/book/the-grave-of-false-theology-bourignon/page/697dde9ad73bf91c6e715ae9 · prompt v2 · syntaxes: [interpolation]

**Raw `translation.data`**

````text
<meta>This page continues Bourignon’s response to the scholar Pieter Serrarius. She is addressing his wavering faith in her mission, specifically responding to the criticisms mentioned on the previous page regarding her title as "Mother" and her role as a female teacher.</meta>

-># God's Contradictions <note>The Dutch title "Godts tegen-spreken" refers to the act of speaking against or contradicting God's word or His chosen messengers.</note><-

you felt an impulse to come to me and to hear my writings; because of that, I doubt greatly whether that impulse came from God, or if this joy was caused only by having found a person who might support you in your own opinions. For if your pleasure had truly come from God showing mercy to the world by sending His light to humanity through a Daughter—just as He sent Abigail to King David to still his anger <note>A reference to 1 Samuel 25, where Abigail's wisdom and intervention prevented David from committing a massacre. Bourignon uses this biblical precedent to justify God using a woman to deliver a divine message to men.</note>—I believe that your joy would not have ended so quickly, for the reason that the same truth and consistency of my writings have in no way changed or diminished since I wrote them. What was a spirit of light and truth at that time cannot now be a spirit of error and lies, because God never changes. And the instrument <note>Bourignon frequently referred to herself as a "werktuig" (instrument or tool) through which God communicated His will, emphasizing her own passivity and God's agency.</note> through which He gave these lights has since changed in no way either; on the contrary, He sends new influences of His grace to that same instrument daily, yes, every hour and every moment. This assures me that wh
… [667 more characters]
````

**Clean `text` (annotation-layer/3)**

````text
-># God's Contradictions <-

you felt an impulse to come to me and to hear my writings; because of that, I doubt greatly whether that impulse came from God, or if this joy was caused only by having found a person who might support you in your own opinions. For if your pleasure had truly come from God showing mercy to the world by sending His light to humanity through a Daughter—just as He sent Abigail to King David to still his anger —I believe that your joy would not have ended so quickly, for the reason that the same truth and consistency of my writings have in no way changed or diminished since I wrote them. What was a spirit of light and truth at that time cannot now be a spirit of error and lies, because God never changes. And the instrument through which He gave these lights has since changed in no way either; on the contrary, He sends new influences of His grace to that same instrument daily, yes, every hour and every moment. This assures me that what was found so good in the beginning by so many different persons cannot have become bad without a change on the part of the master who brought it forth; but rather [the change is] on the side of the persons who saw and heard it, who
````

**Annotations** (8)

| # | type | tag | anchor (exact) | body |
|---|---|---|---|---|
| 1 | meta | meta | *page* | This page continues Bourignon’s response to the scholar Pieter Serrarius. She is addressing his wavering faith in her mi |
| 2 | note | note | “-># God's Contradictions” | The Dutch title "Godts tegen-spreken" refers to the act of speaking against or contradicting God's word or His chosen me |
| 3 | note | note | “still his anger” | A reference to 1 Samuel 25, where Abigail's wisdom and intervention prevented David from committing a massacre. Bourigno |
| 4 | note | note | “And the instrument” | Bourignon frequently referred to herself as a "werktuig" (instrument or tool) through which God communicated His will, e |
| 5 | meta | meta | *page* | catchword: as |
| 6 | summary | summary | *page* | Bourignon defends the consistency of her writings and her divine calling, arguing that if her followers now doubt her, t |
| 7 | keywords | keywords | *page* | Antoinette Bourignon, Pieter Serrarius, Abigail and David, divine instrument, spiritual consistency, doubt, religious au |
| 8 | interp | interp | “[the change is]” |  |

**Reader notes-off vs parser notes-off** (`[-reader only-]` `{+parser only+}`): 

````text
{+->#+}
{+<-+}
````
