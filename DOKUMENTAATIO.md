# Bomber Boys - Dokumentaatio

## 1. Yleiskuva

Tämä projekti on selainpohjainen moninpelattava Bomberman-tyylinen peli.

- Client: Phaser + Colyseus.js
- Server: Colyseus (Node.js + TypeScript)
- Deploy: Docker Compose
- Julkinen osoite: `http://46.224.175.9:4173`

## 2. Projektirakenne

- `client/` = selainpeli (renderöinti, input, UI)
- `server/` = pelilogiikka (huone, spawnit, pommit, pisteet, kierrokset)
- `docker-compose.yml` = client + server kontit
- `Caddyfile` = mahdollinen reverse-proxy/domain-käyttö

## 3. Käynnistys lokaalisti

### Server

```bash
cd server
npm install
npm run dev
```

Server kuuntelee portissa `2567`.

### Client

```bash
cd client
npm install
npm run dev
```

Client pyörii Viten dev-serverillä (oletusportti Viten mukaan).

## 4. Tuotantodeploy (nykyinen tapa)

Tällä hetkellä tuotantojulkaisu tehdään lähdekoodista palvelimelle, eikä paikallista `dist/`-kansiota kopioida sellaisenaan tuotantoon.

Suositeltu julkaisujärjestys:

1. Tee koodimuutokset.
2. Nosta clientin näkyvä build-numero.
3. Aja paikalliset tarkistukset.
4. Synkkaa repo palvelimelle `rsync`:llä.
5. Rakenna ja käynnistä kontit palvelimella.
6. Tarkista konttien tila.
7. Commitoi ja puske git-repoon.

### 4.1 Version nosto

Clientin näkyvä build-numero tulee tiedostosta `client/src/build-meta.ts`.

Helpoin tapa nostaa numero yhdellä pykälällä:

```bash
cd client
node scripts/bump-build-number.mjs
```

Esimerkki: `192 -> 193`

`client`-Dockerfile ajaa tuotantobuildin komennolla `npm run build:ci`, joten palvelimelle riittää että päivitetty lähdekoodi ja build-numero ovat mukana.

### 4.2 Paikalliset tarkistukset ennen deployta

Client:

```bash
cd client
npm run build:ci
```

Server:

```bash
cd server
npx tsc --noEmit -p tsconfig.json
```

### 4.3 Synkkaa koodi palvelimelle

```bash
rsync -az --delete \
  --exclude 'node_modules' \
  --exclude 'dist' \
  --exclude '.DS_Store' \
  /Volumes/munapelilevy/_AntiGravity/Projektit/bomber-boys/ \
  root@46.224.175.9:/opt/bomber-boys/
```

Huomio: `--delete` poistaa palvelimelta tiedostoja, joita ei enää ole lokaalissa repossa. Komentoa kannattaa käyttää vain oikeasta projektihakemistosta.

### 4.3.1 Nopea deploy-komento

Nopein vakiojulkaisu client-muutoksille:

```bash
./scripts/deploy-fast.sh
```

Tama:

- nostaa build-numeron
- buildaa clientin lokaalisti
- tarkistaa serverin TypeScriptin
- synkkaa repoon kuuluvat tiedostot palvelimelle
- rebuildaa vain `client`-kontin
- tulostaa lyhyet statusrivit ja lopuksi julkisen version

Jos haluat pakottaa myos server-kontin rebuildin:

```bash
./scripts/deploy-fast.sh full
```

### 4.4 Rakenna ja käynnistä kontit

```bash
ssh root@46.224.175.9 'cd /opt/bomber-boys && docker compose up -d --build server client'
```

Tämä rebuildaa ainakin `client`-kontin aina kun sen lähdekoodi muuttuu. `server` voi jäädä ennalleen jos Docker-kerrokset cachettuvat eikä sisältö muuttunut.

### 4.5 Tarkista konttien tila

```bash
ssh root@46.224.175.9 'docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | grep bomber-'
```

Odotettu lopputulos:

- `bomber-client` näkyy tilassa `Up`
- `bomber-server` näkyy tilassa `Up`

### 4.6 Git commit ja push

Kun deploy on onnistunut, pidä repo samassa tilassa kuin tuotanto:

```bash
git add client/src/build-meta.ts client/src/BaseDefenseInput.ts
git commit -m "Add two-finger camera drag to base defense"
git push origin main
```

Jos muutoksia on enemmän, lisää commitiin kaikki julkaisuun kuuluvat tiedostot.

## 5. Nykyinen pelikonfiguraatio

- Huoneen `maxClients`: `1000` (tekninen raja, ei suorituskykysuositus)
- Kartan koko: `39 x 39`
- Match duration: säädettävä hostille (`M`)
- Spawnit:
  - Hajautettu spawn-valinta (ei keskikasautumista)
  - Spawnille avataan ulospääsy (ei vangiksi laatikoihin)
- Round reset:
  - Matsin lopussa uusi kenttä
  - Pommit nollataan
  - Powerupit nollataan

## 6. Inputit

- Liike: nuolinäppäimet + `WASD`
- Pommi: `SPACE`
- Nimen vaihto: `N`
- Matsin keston vaihto hostina: `M`

## 7. Safari/cache-huomiot

Client palvellaan omalla `preview-server.mjs`-palvelimella:

- `index.html`: `Cache-Control: no-store, no-cache`
- Assetit (`/assets/*.js`): `immutable`

Tämä vähentää Safarin vanhan `index.html`:n cacheongelmaa.

## 8. Yleinen vianhaku

### Ongelma: musta ruutu joinin jälkeen

1. Tarkista että serveri on ylhäällä portissa `2567`.
2. Tarkista client-kontti (`bomber-client`) ja logit.
3. Varmista että selain sai uuden `index.html`:n (hard reload).

### Ongelma: peli ei käynnisty kun huone oli tyhjä

Serverissä on automaattinen round-start:
- jos huoneessa on pelaajia mutta round ei aktiivinen, serveri käynnistää kierroksen.

### Lokit

```bash
ssh root@46.224.175.9 'docker logs --tail 200 bomber-server'
ssh root@46.224.175.9 'docker logs --tail 200 bomber-client'
```

### Ongelma: uusi versio ei näy selaimessa

1. Tarkista että `bomber-client` on oikeasti rebuildattu ja käynnistynyt uudelleen.
2. Tarkista `client/src/build-meta.ts`:n build-numero commitissa.
3. Varmista että selain haki uuden `index.html`:n eikä käytä vanhaa cachea.
4. Tarvittaessa tee hard reload mobiilissa tai Safarissa.

## 9. Suorituskyvystä (CX33 / 4 vCPU / 8 GB)

Käytännön arvio nykyiselle toteutukselle:

- sujuva: noin 60-120 samanaikaista pelaajaa
- riskialue: 150+ pelaajaa

Jos tavoite on selvästi yli 120, suositellaan kuormatestibotteja + huoneiden shardausta.
