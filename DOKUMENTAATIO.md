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

### 1) Synkkaa koodi palvelimelle

```bash
rsync -az --delete \
  --exclude 'node_modules' \
  --exclude 'dist' \
  --exclude '.DS_Store' \
  /Volumes/munapelilevy/_AntiGravity/Projektit/bomber-boys/ \
  root@46.224.175.9:/opt/bomber-boys/
```

### 2) Rakenna ja käynnistä kontit

```bash
ssh root@46.224.175.9 'cd /opt/bomber-boys && docker compose up -d --build server client'
```

### 3) Tarkista konttien tila

```bash
ssh root@46.224.175.9 'docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | grep bomber-'
```

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

## 9. Suorituskyvystä (CX33 / 4 vCPU / 8 GB)

Käytännön arvio nykyiselle toteutukselle:

- sujuva: noin 60-120 samanaikaista pelaajaa
- riskialue: 150+ pelaajaa

Jos tavoite on selvästi yli 120, suositellaan kuormatestibotteja + huoneiden shardausta.

