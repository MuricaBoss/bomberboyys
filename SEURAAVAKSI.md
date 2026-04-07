# Bomber Boys - seuraava kehityssuunnitelma

## Tavoite

Viedään nykyinen Base Defense / RTS -pelimoodi siihen pisteeseen, että yksi matsi tuntuu selkeältä, taktisesti kiinnostavalta ja teknisesti vakaalta useammalla samanaikaisella yksiköllä.

Nykyinen prioriteetti ei ole uusien irrallisten ominaisuuksien määrä, vaan nämä kolme asiaa:

- taistelulooppi on ymmärrettävä ja toimii automaattisesti
- yksiköiden liike, valinta ja fog of war eivät riko pelitilannetta
- pelaajalla on selkeä syy rakentaa erilaisia rakennuksia ja yksiköitä

## Nykyinen tila lyhyesti

Pelissä on jo:

- C&C-tyylinen rakentaminen: Ore Refinery, Solar Panel, Barracks, War Factory
- yksiköt: Soldier, Tank, Harvester
- resurssin keruu ja sähkön käyttö
- hiiriohjaus, ryhmävalinta, muodostelmaslotit ja path-preview
- fog of war
- vihollistiimit ja rakennusten/yksiköiden tuhoaminen
- Docker-deploy Hetzner-palvelimelle

Selvät kipupisteet juuri nyt:

- tankin auto-aggro/chase ja näkyvän vihollisen seuranta ei vielä tunnu riittävän luotettavalta
- unit formation / slotitus voi edelleen tuottaa huonoja targetteja ahtaissa kohdissa
- fog of warin "näkyy hetken / katoaa vasta kun tumma" -logiikka on vasta puolivalmis pelidesignin kannalta
- UI ei vielä selitä yksiköiden tilaa, hyökkäyskäskyä, jonotusta, eikä tuotantoketjua tarpeeksi hyvin
- vanha `DOKUMENTAATIO.md` kuvaa osittain vielä Bomberman-peliä, ei nykyistä RTS-moodia

## Ehdotettu toteutusjärjestys

## 1. Taistelun peruslooppi kuntoon

### 1.1 Tankkien ja sotilaiden automaattinen vihollisen jahtaaminen

Toteutetaan selkeä AI-sääntö:

- jos yksiköllä on manuaalinen attack target, se menee sitä kohti ja ampuu kun range riittää
- jos manuaalista targettia ei ole ja näkyvissä on vihollinen aggro-rangella, yksikkö valitsee lähimmän järkevän kohteen
- jos kohde pakenee mutta pysyy näkyvissä, tankki seuraa
- jos kohde katoaa fogiin, yksikkö joko jatkaa viimeiseen nähtyyn paikkaan tai palaa idleen

Lisättävät asiat:

- erillinen `chaseTargetId` / `lastSeenEnemyPos` -malli tankille ja soldierille
- suurempi tankin havainto- ja ampumaetäisyys kuin soldierilla
- prioriteettisääntö: ensin vihollisyksiköt lähellä, sitten rakennukset, sitten core

Hyväksymiskriteeri:

- jos vihollinen on näkyvissä lähistöllä, tankki ei jää paikalleen vaan ajaa kohti ja alkaa ampua automaattisesti

### 1.2 Attack-move-käsky

Lisätään varsinainen RTS-tyylinen attack-move:

- normaali klikkaus = liiku
- `A + click` tai `Shift + click` = liiku, mutta pysähdy ampumaan jos matkalla tulee vihollinen näkyviin

Tämä kannattaa erottaa tavallisesta move-komennosta, ettei kaikki liike muutu liian aggressiiviseksi.

## 2. Liike ja muodostelmat vakaiksi

### 2.1 Slotitus ei saa koskaan valita rakennuksen sisäistä tai liian lähellä kulmaa olevaa paikkaa

Nyt korjataan muodostelmat yhdellä yhteisellä säännöllä:

- slotin paikka hyväksytään vain jos koko unitin body + turvamarginaali mahtuu vapaaseen tilaan
- rakennuksen ja coren ympärille lasketaan explicit clearance-alue
- preview-slotit ja oikeat `targetX/targetY` käyttävät täsmälleen samaa validointia

Tekninen suositus:

- tee yksi yhteinen funktio tyyliin `canReserveFormationSlot(worldX, worldY, unitRadius)`
- käytä sitä sekä client previewssä että server target-slotituksessa
- poista kaikki fallbackit, jotka lopulta hyväksyvät alkuperäisen blocked slotin

### 2.2 Pathfindingin vastuut selkeiksi

Päätetään yksi arkkitehtuuri ja pidetään siitä kiinni:

- client laskee oman pelaajan valittujen yksiköiden liikeradan ja lähettää pose/target-päivitykset
- server validoi kevyesti ja synkkaa muille
- server ei saa samaan aikaan ajaa omaa kilpailevaa liikettä samoille tankeille/sotilaille
- harvesterin automaattinen työkierto voi edelleen olla server-vetoinen, jos se on helpompi pitää yhtenäisenä

Tärkeä tarkistus:

- käy `BaseDefenseRoom.tickUnits()` ja clientin `updateUnitRenderPos()` läpi niin, ettei samalle unitille ole kahta eri "totuutta"

### 2.3 Ryhmän liikkuminen ilman kasaan painumista

Tavoite:

- jos 20 tankkia klikataan yhteen paikkaan, ne jakautuvat siististi alueelle eivätkä yritä kaikki täsmälleen samaan pisteeseen

Ehdotus:

- valittu click-point on muodostelman keskipiste
- lähin tankki saa lähimmän slotin
- slot-gridin koko määräytyy unit-countin ja unit-radiusin mukaan
- jos slotteja ei löydy vapaina tarpeeksi, kasvatetaan muodostelman aluetta, ei pakoteta niitä esteen viereen

## 3. Fog of war pelidesigniksi, ei vain efektiksi

### 3.1 Kolme näkyvyystilaa

Selkeytetään fog näin:

- **Visible now**: alueella on oma yksikkö/rakennus, viholliset näkyvät ja päivittyvät
- **Explored but not visible**: maasto jää näkyviin tummennettuna, mutta viholliset eivät päivity reaaliajassa
- **Unexplored**: täysin pimeä / tuntematon

Nykyinen ongelma on, että vihollisen renderöinti ja fogin tummuus eivät vielä ole samaa pelisääntöä.

### 3.2 Vihollisen viimeinen nähty sijainti

Kun vihollinen katoaa näkyvyydestä:

- näytä hetken aikaa "last seen" ghost tai jätä vanha positio paikoilleen harmaana
- älä teleporttaa vihollista näkymättömiin samalla hetkellä, jos fog ei vielä ole kunnolla tumma

Tämä tekee scouttaamisesta ja jahtaamisesta loogisempaa.

### 3.3 Suorituskyky

Fog pitää pitää client-puolella.

Jos FPS laskee:

- pidä fog-grid erillisessä matalampiresoluutioisessa bufferissa
- renderöi pehmeät reunat shaderilla tai bluratulla render texturella
- päivitä fogia throttlatusti, mutta niin että kameran liike ei aiheuta näkyvää viivettä

## 4. Economy ja tech tree kiinnostavammaksi

### 4.1 Selkeä rakennusketju

Nykyinen ketju on jo olemassa, mutta siitä voi tehdä paremman:

- Ore Refinery = avaa perustulon ja harvesterin
- Solar Panel = kasvattaa power budgetia
- Barracks = infantry
- War Factory = tankit ja advanced harvesters

Seuraavat lisäykset:

- rakennuksen tooltip näyttää mitä se avaa
- jos jotain ei voi rakentaa, kortti kertoo yhden yksiselitteisen syyn
- power shortage vaikuttaa selkeästi vain tuotantoon tai myös rakennusten toimintaan, mutta sääntö pitää olla pelaajalle näkyvä

### 4.2 Uudet unitit

Kun peruslooppi toimii, seuraavat yksiköt olisivat luontevia:

- **Scout Buggy**: nopea, heikko, iso vision radius
- **Rocket Soldier**: hidas, hyvä rakennuksia ja tankkeja vastaan
- **Repair Vehicle**: korjaa omia tankkeja ja rakennuksia
- **Artillery Tank**: pitkä range, huono lähitaistelussa

Tärkeysjärjestys:

1. Scout Buggy, koska se vahvistaa fog of war -peliä
2. Rocket Soldier, koska tankki vs tankki -meta kaipaa vastayksikön
3. Repair Vehicle, jos halutaan pidempiä base-sotia

## 5. Parempi UI ja palaute

### 5.1 Yksikön ja ryhmän komentotila näkyviin

Kun unitteja on valittu, näytä:

- onko niillä move, attack-move, attack target vai idle
- mikä kohde on lukittuna
- miksi jokin unit ei liiku, jos se ei voi toteuttaa käskyä

### 5.2 Tuotantojonot

War Factory ja Barracks tarvitsevat näkyvän tuotantojonon:

- mitä valmistuu
- paljonko aikaa jäljellä
- mihin rakennukseen tuotanto on sidottu

Jos useampi factory/barracks on olemassa, pelaajan pitää nähdä nopeuttaako se oikeasti tuotantoa.

### 5.3 Ilmoitukset

Nykyisiä combat-ilmoituksia voi parantaa:

- "Base under attack"
- "Harvester under attack"
- "Unit lost"
- "Building lost"

Lisäys:

- ilmoituksesta klikkaamalla kamera hyppää tapahtumapaikkaan

## 6. Sisältö ja visuaalinen identiteetti

### 6.1 Sprite pipeline kuntoon

Nykyiset tankkispritet ovat jo erillisinä assetteina, joten seuraava askel:

- yhtenäinen kansiorakenne kaikille uniteille ja rakennuksille
- jokaiselle yksikölle vähintään 8 suunnan sprite tai selkeä topdown/iso-perspektiivin sääntö
- buildingit omiksi spriteiksi, ei pelkkinä värilaatikoina

### 6.2 Taistelu-efektit

Lisää kevyet mutta luettavat efektit:

- tankin muzzle flash
- projectile/tracer
- impact hit spark
- building damage smoke kun HP laskee alle tietyn rajan

## 7. Tekninen velka ja refaktorointi

### 7.1 `client/src/main.ts` pitää jakaa osiin

Tiedosto on nyt liian iso ja sisältää monta vastuuta.

Ehdotettu jako:

- `BaseDefenseScene.ts`
- `fogOfWar.ts`
- `formation.ts`
- `rtsInput.ts`
- `buildPanel.ts`
- `unitRendering.ts`

Tämä kannattaa tehdä ennen kuin lisätään iso määrä uusia unitteja.

### 7.2 `server/src/rooms/BaseDefenseRoom.ts` pienempiin kokonaisuuksiin

Sama ongelma serverillä.

Ehdotettu jako:

- combat targetointi ja damage
- economy ja tuotanto
- harvester AI
- unit movement / client pose sync
- map/resource spawning

### 7.3 Pelin nimi ja dokumentaatio ajan tasalle

Jos RTS-moodi on nyt pääsuunta, `DOKUMENTAATIO.md` kannattaa päivittää vastaamaan nykyistä peliä. Tällä hetkellä nimi ja kuvaus painottavat vielä Bomberman-vaihetta.

## 8. Ehdotettu seuraava sprintti

Jos tehdään yksi käytännöllinen työpaketti seuraavaksi, ottaisin tämän:

### Sprintti 1: RTS-taistelun minimi valmiiksi

1. Tankkien ja sotilaiden auto-chase + auto-fire kun vihollinen näkyy
2. Attack-move-komento
3. Preview-slotit ja server-slotit samaan validointisääntöön
4. Fog of war: visible / explored / unseen -erottelu ja last-seen viholliset
5. Yksinkertainen unit command UI, joka kertoo onko ryhmä moving / attacking / idle

Tämän jälkeen peli alkaa todennäköisesti tuntua selvästi enemmän oikealta RTS:ltä eikä tekniseltä prototyypiltä.

## 9. Mobile-first RTS selaimessa

## Verrokit ja UX-havainnot

Katsoin mobiili-RTS-verrokkeja ja niistä toistuu käytännössä sama ohjausmalli:

- **Clash of Clans / Boom Beach -tyyli**: yksi sormi tekee pääaktion, kamera liikkuu dragilla, zoom pinchillä, ja UI-toiminnot ovat isoina alareunan nappeina. Monimutkainen drag-box select on usein korvattu ryhmäpainikkeilla tai moodikytkimellä.
- **Rusted Warfare -tyyli**: toimii kosketuksella lähempänä klassista RTS:ää, eli karttaa voi panoroida ja zoomata, ja yksiköt komennetaan valinnan jälkeen tapilla. Tämä malli sopii paremmin meidän C&C-moodiin kuin Bomberman.
- **C&C-henkiset mobile RTS:t** yleensä välttävät hiiren oikean napin kaltaisia piiloehtoja ja tekevät komennon tilan näkyväksi UI:ssa, koska kosketuksella "mikä moodi nyt on päällä" pitää nähdä koko ajan.

Johtopäätös tälle pelille:

- mobiilissa kannattaa valita oletuksena Base Defense / C&C-moodi, ei Bomberman
- yksi sormi ensisijaisesti unit-valintaan ja move/attack-komentoon
- kaksi sormea kameran siirtoon ja pinch zoomiin
- monivalinta tehdään joko erillisellä "Select mode" -napilla tai paina-ja-vedä -lassolla, ei oletuksena joka dragista
- valittujen joukkojen komento pitää näkyä selvästi ruudulla, koska kosketuksessa ei ole hoveria

## Suositeltu mobiiliohjaus tähän peliin

### Kamera

- **Yksi sormi tyhjään maahan drag**: panoroi karttaa
- **Pinch**: zoom sisään/ulos
- **Kaksoistap valittuun unit-ryhmään**: keskitä kamera ryhmään
- **Kaksoistap minimappiin**, jos minimap palautetaan myöhemmin: hyppää siihen kohtaan

### Valinta

- **Tap unitin päälle**: valitse yksi unit
- **Tap omaan rakennukseen**: valitse rakennus / tuotantolähde
- **Select mode -nappi pohjassa + drag**: piirrä lassovalinta joukoille
- **Tap tyhjään maahan ilman Select modea**: jos unitteja on valittuna, anna move-komento; jos ei ole valintaa, liikuta kameraa dragilla

Tämä on käytännössä tärkeä jako:

- normaali drag = kamera
- erillinen valintamoodi = ryhmävalinta

Muuten mobiilissa kamera ja box-select tappelevat helposti keskenään.

### Hyökkäyskomennot

Koska mobiilissa ei ole Shift+clickiä luontevasti:

- lisää alareunaan **Move / Attack / Attack-Move** -moodipainike
- jos Attack mode on päällä ja tapataan vihollista, valitut unitit saavat attack-targetin
- jos Attack-Move on päällä ja tapataan maata, unitit liikkuvat sinne mutta pysähtyvät ampumaan matkalla näkyvät viholliset

### Rakentaminen

- rakennuskortit pidetään alhaalla kuten nyt
- kortin tap = valitse rakennus
- sen jälkeen kartalla näkyy ghost-preview
- toinen tap karttaan = rakenna siihen
- jos paikka ei kelpaa, ruutu punaiseksi ja lyhyt syyteksti

Drag-and-drop kortista karttaan toimii desktopilla, mutta mobiilissa tap -> place on yleensä luotettavampi kuin pitkä drag.

## Tekninen toteutussuunnitelma mobiilille

### 9.1 Mobiilidetektointi ja oletusmoodi

Toteutettu ensimmäinen askel:

- jos laite näyttää kosketuslaitteelta, MenuScene valitsee oletuksena `base_defense_room`
- mobiilissa liittyminen onnistuu myös tapilla, ei vain Space-näppäimellä

### 9.2 Touch camera controller

Seuraava tekninen työ:

- erottele touch-input kahteen moodiin: camera gesture vs unit command
- yksi sormi drag tyhjällä maalla liikuttaa kameraa
- pinch muuttaa kameran zoomia kameran keskipisteen sijasta pinch-fokuksen ympäriltä
- jos sormi alkaa unitin tai UI:n päältä, sitä ei tulkita kameradragiksi

### 9.3 Mobiilivalinta

Lisää ruudulle pieni tilaohjain:

- `Select`
- `Move`
- `Attack`
- `Attack-Move`

Mahdollinen ensimmäinen versio:

- yksi tap unit = single select
- Select-nappi aktiivisena drag = rectangle select
- Move/Attack mode aktiivisena tap maahan/kohteeseen = käsky valituille

### 9.4 Responsiivinen UI

Nykyinen alareunan build-panel pitää muuttaa mobiilissa:

- kortit vaakasuuntaiseen scrollattavaan riviin
- fontit isommiksi
- HP/selected labelit vähemmän päällekkäin ruudun pienellä leveydellä
- tärkeät napit vähintään noin 44x44 CSS px kosketusalueella

### 9.5 Fullscreen ja selainkäytös

Lisättävä:

- fullscreen-painike mobiiliin
- estä selaimen oma scroll/overscroll pelicanvaksen päällä
- varmista että pinch-zoom ohjaa peliä eikä selaimen sivuzoomia

Todennäköisesti tarvitaan ainakin:

- `touch-action: none` pelicanvakselle
- oma pinch-handler Phaser inputista
- UI-layerille silti normaalit tapit

## Suositeltu toteutusjärjestys mobiilille

1. Mobiilioletus Base Defenseen ja tap-to-join
2. Kamera: yhden sormen pan + kahden sormen pinch zoom
3. Select/Move/Attack/Attack-Move -moodinapit mobiiliin
4. Tap-to-place rakentamiseen drag-and-dropin rinnalle
5. Fullscreen-nappi ja responsiivinen build-panel

Tämän jälkeen peliä voi realistisesti alkaa testata puhelimella ilman näppäimistöä/hiirtä.
