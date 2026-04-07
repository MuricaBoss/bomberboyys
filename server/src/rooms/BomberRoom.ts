import { Room, Client } from "colyseus";
import { BomberState, Player, Bomb, PowerUp } from "./schema/BomberState";

const TILE_SIZE = 32;
const PLAYER_RADIUS = 10;
const PLAYER_MIN_DISTANCE = TILE_SIZE * 1.2;
const RESPAWN_DELAY_MS = 3000;
const RESPAWN_INVULNERABILITY_MS = 1500;
const WIN_SCORE = 10;
const MIN_MATCH_DURATION_SEC = 60;
const MAX_MATCH_DURATION_SEC = 900;
const POWERUP_SPAWN_INTERVAL_MS = 8000;
const MAX_POWERUPS_ON_MAP = 10;
const MAP_WIDTH = 39;
const MAP_HEIGHT = 39;

export class BomberRoom extends Room<BomberState> {
  maxClients = 1000;
  joinOrder: string[] = [];
  playerBombPass: Map<string, Set<string>> = new Map();
  roundStartScheduled = false;

  onCreate (options: any) {
    this.setState(new BomberState());
    this.state.mapWidth = MAP_WIDTH;
    this.state.mapHeight = MAP_HEIGHT;
    this.state.matchDurationSec = 180;
    this.generateMap();

    this.clock.setInterval(() => {
      if (!this.state.roundActive || this.state.matchEndsAt <= 0) return;
      if (Date.now() >= this.state.matchEndsAt) {
        this.finishRound("time");
      }
    }, 250);
    this.clock.setInterval(() => {
      if (this.state.players.size > 0 && !this.state.roundActive) {
        this.scheduleRoundStart(50);
      }
    }, 500);
    this.clock.setInterval(() => {
      if (!this.state.roundActive) return;
      this.spawnRandomPowerUp();
    }, POWERUP_SPAWN_INTERVAL_MS);

    this.onMessage("move", (client, data) => {
      if (!this.state.roundActive) return;
      const player = this.state.players.get(client.sessionId);
      if (player && player.isAlive) {
        this.pruneBombPassForPlayer(client.sessionId, player);
        const nextX = typeof data.x === "number" ? data.x : player.x;
        const nextY = typeof data.y === "number" ? data.y : player.y;

        if (this.canOccupy(nextX, nextY, PLAYER_RADIUS, client.sessionId)) {
          player.x = nextX;
          player.y = nextY;
        } else {
          // Allow sliding along obstacles.
          if (this.canOccupy(nextX, player.y, PLAYER_RADIUS, client.sessionId)) {
            player.x = nextX;
          }
          if (this.canOccupy(player.x, nextY, PLAYER_RADIUS, client.sessionId)) {
            player.y = nextY;
          }
        }

        this.collectPowerups(player);
      }
    });

    this.onMessage("move_grid", (client, data) => {
      if (!this.state.roundActive) return;
      const player = this.state.players.get(client.sessionId);
      if (!player || !player.isAlive) return;

      const rawDx = Number(data?.dx);
      const rawDy = Number(data?.dy);
      if (!Number.isFinite(rawDx) || !Number.isFinite(rawDy)) return;

      const dx = Math.max(-1, Math.min(1, Math.trunc(rawDx)));
      const dy = Math.max(-1, Math.min(1, Math.trunc(rawDy)));
      if ((dx === 0 && dy === 0) || (dx !== 0 && dy !== 0)) return;

      this.pruneBombPassForPlayer(client.sessionId, player);
      this.movePlayerByGrid(player, dx, dy, client.sessionId);
      this.collectPowerups(player);
    });

    this.onMessageSetups();
  }

  collectPowerups(player: Player) {
    const hitDist = TILE_SIZE * 0.7;
    this.state.powerups.forEach((pu, id) => {
      const dx = pu.x - player.x;
      const dy = pu.y - player.y;
      if (Math.sqrt(dx * dx + dy * dy) < hitDist) {
        if (pu.type === 1) player.bombs++;
        else if (pu.type === 2) player.bombRadius++;
        else if (pu.type === 3) player.speed += 25;
        this.state.powerups.delete(id);
      }
    });
  }

  movePlayerByGrid(player: Player, dx: number, dy: number, playerId?: string) {
    const gridX = Math.floor(player.x / TILE_SIZE);
    const gridY = Math.floor(player.y / TILE_SIZE);
    const targetX = gridX + dx;
    const targetY = gridY + dy;
    if (!this.isWalkableTile(targetX, targetY)) return;
    if (this.isBombBlockingAt(targetX, targetY, playerId)) return;

    player.x = targetX * TILE_SIZE + TILE_SIZE / 2;
    player.y = targetY * TILE_SIZE + TILE_SIZE / 2;
  }

  onMessageSetups() {
    this.onMessage("set_name", (client, data) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      const nextName = typeof data?.name === "string" ? data.name.trim() : "";
      if (!nextName) return;
      const safeName = nextName.slice(0, 16).replace(/\s+/g, " ");
      if (!safeName) return;
      player.name = safeName;
    });

    this.onMessage("set_match_duration", (client, data) => {
      if (client.sessionId !== this.state.hostId) return;
      const rawSeconds = Number(data?.seconds);
      if (!Number.isFinite(rawSeconds)) return;
      const seconds = Math.max(MIN_MATCH_DURATION_SEC, Math.min(MAX_MATCH_DURATION_SEC, Math.floor(rawSeconds)));
      this.state.matchDurationSec = seconds;
      if (this.state.roundActive) {
        this.state.matchEndsAt = Date.now() + seconds * 1000;
      }
    });

    this.onMessage("place_bomb", (client) => {
      if (!this.state.roundActive) return;
      const player = this.state.players.get(client.sessionId);
      if (!player || !player.isAlive) return;

      let activeBombs = 0;
      this.state.bombs.forEach((b) => {
        if (b.ownerId === client.sessionId) activeBombs++;
      });
      if (activeBombs >= player.bombs) return;

      const gridX = Math.floor(player.x / TILE_SIZE);
      const gridY = Math.floor(player.y / TILE_SIZE);
      const bombId = `bomb_${Date.now()}_${Math.random()}`;

      let spotTaken = false;
      this.state.bombs.forEach((b) => {
        if (Math.floor(b.x / TILE_SIZE) === gridX && Math.floor(b.y / TILE_SIZE) === gridY) spotTaken = true;
      });
      if (spotTaken) return;

      const bomb = new Bomb();
      bomb.id = bombId;
      bomb.ownerId = client.sessionId;
      bomb.x = gridX * TILE_SIZE + TILE_SIZE / 2;
      bomb.y = gridY * TILE_SIZE + TILE_SIZE / 2;
      bomb.radius = player.bombRadius;
      
      this.state.bombs.set(bombId, bomb);
      if (!this.playerBombPass.has(client.sessionId)) {
        this.playerBombPass.set(client.sessionId, new Set<string>());
      }
      this.playerBombPass.get(client.sessionId)!.add(bombId);

      this.clock.setTimeout(() => this.explodeBomb(bombId), 3000);
    });
  }

  explodeBomb(bombId: string) {
    const bomb = this.state.bombs.get(bombId);
    if (!bomb) return;
    if (!this.state.roundActive) {
      this.state.bombs.delete(bombId);
      return;
    }

    const rootGridX = Math.floor(bomb.x / TILE_SIZE);
    const rootGridY = Math.floor(bomb.y / TILE_SIZE);
    const radius = bomb.radius;

    this.state.bombs.delete(bombId);
    this.playerBombPass.forEach((set) => set.delete(bombId));

    const explosionTiles: {x: number, y: number}[] = [{x: rootGridX, y: rootGridY}];

    // Tuhoaa myös räjähdysalueelle osuvat powerupit
    const processExplosionTile = (checkX: number, checkY: number) => {
      const pX = checkX * TILE_SIZE + TILE_SIZE / 2;
      const pY = checkY * TILE_SIZE + TILE_SIZE / 2;
      
      this.state.powerups.forEach((pu, id) => {
        if (Math.abs(pu.x - pX) < 5 && Math.abs(pu.y - pY) < 5) {
          this.state.powerups.delete(id);
        }
      });
    };
    processExplosionTile(rootGridX, rootGridY);

    const processDirection = (dx: number, dy: number) => {
      for (let i = 1; i <= radius; i++) {
        const checkX = rootGridX + dx * i;
        const checkY = rootGridY + dy * i;
        const index = checkY * this.state.mapWidth + checkX;
        
        const tile = this.state.map[index];
        if (tile === 1) break; // Seinä estää

        explosionTiles.push({x: checkX, y: checkY});
        processExplosionTile(checkX, checkY);
        
        if (tile === 2) {
          this.state.map[index] = 0; // Puulaatikko tuhoutuu
          
          // 30% todennäköisyys dropata power-up
          if (Math.random() < 0.3) {
             const type = Math.floor(Math.random() * 3) + 1;
             const puId = `pu_${Date.now()}_${Math.random()}`;
             const pu = new PowerUp();
             pu.id = puId;
             pu.x = checkX * TILE_SIZE + TILE_SIZE / 2;
             pu.y = checkY * TILE_SIZE + TILE_SIZE / 2;
             pu.type = type;
             this.state.powerups.set(puId, pu);
          }
          break;
        }
      }
    };

    processDirection(1, 0);
    processDirection(-1, 0);
    processDirection(0, 1);
    processDirection(0, -1);

    // Osumat pelaajiin
    this.state.players.forEach((player) => {
      if (!player.isAlive) return;
      if (Date.now() < player.invulnerableUntil) return;
      const pGridX = Math.floor(player.x / TILE_SIZE);
      const pGridY = Math.floor(player.y / TILE_SIZE);
      const hit = explosionTiles.find(t => t.x === pGridX && t.y === pGridY);
      if (hit) {
        this.killPlayer(player.id, bomb.ownerId);
      }
    });

    this.broadcast("explosion", explosionTiles);
  }

  onJoin (client: Client, options: any) {
    console.log(client.sessionId, "joined!");
    this.joinOrder.push(client.sessionId);
    const player = new Player();
    player.id = client.sessionId;
    player.name = `Player-${client.sessionId.slice(0, 4)}`;
    player.isAlive = true;
    player.bombs = 1;
    player.bombRadius = 2;
    player.speed = 150;
    player.kills = 0;
    player.deaths = 0;
    player.score = 0;
    player.invulnerableUntil = Date.now() + RESPAWN_INVULNERABILITY_MS;
    const spawn = this.findSpawnPosition();
    this.ensureSpawnEscape(spawn.x, spawn.y);
    player.x = spawn.x;
    player.y = spawn.y;
    this.state.players.set(client.sessionId, player);
    this.playerBombPass.set(client.sessionId, new Set<string>());

    if (!this.state.hostId) {
      this.state.hostId = client.sessionId;
    }
    this.scheduleRoundStart(80);
  }

  onLeave (client: Client, consented?: boolean) {
    console.log(client.sessionId, "left!");
    this.state.players.delete(client.sessionId);
    this.playerBombPass.delete(client.sessionId);
    this.joinOrder = this.joinOrder.filter((id) => id !== client.sessionId);
    if (this.state.hostId === client.sessionId) {
      this.state.hostId = this.joinOrder[0] || "";
    }

    // Reset room to idle when empty so next join starts cleanly without refresh.
    if (this.state.players.size === 0) {
      this.state.roundActive = false;
      this.state.matchEndsAt = 0;
      this.state.bombs.clear();
      this.state.powerups.clear();
      this.playerBombPass.clear();
      this.roundStartScheduled = false;
    }
  }

  onDispose() {
    console.log("room", this.roomId, "disposing...");
  }

  generateMap() {
    const width = this.state.mapWidth;
    const height = this.state.mapHeight;
    this.state.map.clear();

    const centerX = Math.floor(width / 2);
    const centerY = Math.floor(height / 2);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let tile = 0;

        const border = x === 0 || y === 0 || x === width - 1 || y === height - 1;
        const pillar = x % 2 === 1 && y % 2 === 1;
        if (border || pillar) {
          tile = 1;
        } else if (Math.random() < 0.45) {
          tile = 2;
        }

        // Keep center area open for reliable spawning.
        if (Math.abs(x - centerX) <= 2 && Math.abs(y - centerY) <= 2) {
          tile = 0;
        }

        this.state.map.push(tile);
      }
    }
  }

  isInsideMap(gridX: number, gridY: number) {
    return gridX >= 0 && gridY >= 0 && gridX < this.state.mapWidth && gridY < this.state.mapHeight;
  }

  tileAt(gridX: number, gridY: number) {
    if (!this.isInsideMap(gridX, gridY)) return 1;
    const index = gridY * this.state.mapWidth + gridX;
    return this.state.map[index] ?? 1;
  }

  isWalkableTile(gridX: number, gridY: number) {
    return this.tileAt(gridX, gridY) === 0;
  }

  canOccupy(worldX: number, worldY: number, radius: number, playerId?: string) {
    const samples = [
      { x: worldX, y: worldY },
      { x: worldX - radius, y: worldY - radius },
      { x: worldX + radius, y: worldY - radius },
      { x: worldX - radius, y: worldY + radius },
      { x: worldX + radius, y: worldY + radius },
    ];

    for (const point of samples) {
      const gridX = Math.floor(point.x / TILE_SIZE);
      const gridY = Math.floor(point.y / TILE_SIZE);
      if (!this.isWalkableTile(gridX, gridY)) {
        return false;
      }
      if (this.isBombBlockingAt(gridX, gridY, playerId)) {
        return false;
      }
    }

    return true;
  }

  isBombBlockingAt(gridX: number, gridY: number, playerId?: string) {
    let blocked = false;
    this.state.bombs.forEach((bomb, bombId) => {
      if (blocked) return;
      const bGridX = Math.floor(bomb.x / TILE_SIZE);
      const bGridY = Math.floor(bomb.y / TILE_SIZE);
      if (bGridX !== gridX || bGridY !== gridY) return;

      if (!playerId) {
        blocked = true;
        return;
      }
      const passSet = this.playerBombPass.get(playerId);
      if (passSet && passSet.has(bombId)) {
        return;
      }
      blocked = true;
    });
    return blocked;
  }

  pruneBombPassForPlayer(playerId: string, player: Player) {
    const passSet = this.playerBombPass.get(playerId);
    if (!passSet || passSet.size === 0) return;
    const playerGridX = Math.floor(player.x / TILE_SIZE);
    const playerGridY = Math.floor(player.y / TILE_SIZE);

    for (const bombId of Array.from(passSet)) {
      const bomb = this.state.bombs.get(bombId);
      if (!bomb) {
        passSet.delete(bombId);
        continue;
      }
      const bombGridX = Math.floor(bomb.x / TILE_SIZE);
      const bombGridY = Math.floor(bomb.y / TILE_SIZE);
      if (bombGridX !== playerGridX || bombGridY !== playerGridY) {
        passSet.delete(bombId);
      }
    }
  }

  isSpawnFree(worldX: number, worldY: number, reserved: { x: number; y: number }[] = []) {
    for (const existing of this.state.players.values()) {
      if (!existing.isAlive) continue;
      const dx = existing.x - worldX;
      const dy = existing.y - worldY;
      if (Math.sqrt(dx * dx + dy * dy) < PLAYER_MIN_DISTANCE) {
        return false;
      }
    }
    for (const spot of reserved) {
      const dx = spot.x - worldX;
      const dy = spot.y - worldY;
      if (Math.sqrt(dx * dx + dy * dy) < PLAYER_MIN_DISTANCE) {
        return false;
      }
    }
    return true;
  }

  findSpawnPosition(reserved: { x: number; y: number }[] = []) {
    const centerX = Math.floor(this.state.mapWidth / 2);
    const centerY = Math.floor(this.state.mapHeight / 2);
    type SpawnCandidate = { x: number; y: number; score: number };
    const candidates: SpawnCandidate[] = [];

    for (let gridY = 1; gridY < this.state.mapHeight - 1; gridY++) {
      for (let gridX = 1; gridX < this.state.mapWidth - 1; gridX++) {
        if (!this.isWalkableTile(gridX, gridY)) continue;

        const worldX = gridX * TILE_SIZE + TILE_SIZE / 2;
        const worldY = gridY * TILE_SIZE + TILE_SIZE / 2;
        if (!this.canOccupy(worldX, worldY, PLAYER_RADIUS)) continue;
        if (!this.isSpawnFree(worldX, worldY, reserved)) continue;
        if (!this.hasSpawnEscapePotential(gridX, gridY)) continue;

        let nearestDist = Number.POSITIVE_INFINITY;
        for (const existing of this.state.players.values()) {
          if (!existing.isAlive) continue;
          const dx = existing.x - worldX;
          const dy = existing.y - worldY;
          nearestDist = Math.min(nearestDist, Math.sqrt(dx * dx + dy * dy));
        }
        for (const spot of reserved) {
          const dx = spot.x - worldX;
          const dy = spot.y - worldY;
          nearestDist = Math.min(nearestDist, Math.sqrt(dx * dx + dy * dy));
        }
        if (!Number.isFinite(nearestDist)) nearestDist = TILE_SIZE * 8;

        const centerDx = gridX - centerX;
        const centerDy = gridY - centerY;
        const centerDist = Math.sqrt(centerDx * centerDx + centerDy * centerDy) * TILE_SIZE;

        // Favor positions far from existing players and away from map center.
        const score = nearestDist * 1.0 + centerDist * 0.35 + Math.random() * TILE_SIZE * 0.5;
        candidates.push({ x: worldX, y: worldY, score });
      }
    }

    if (candidates.length > 0) {
      candidates.sort((a, b) => b.score - a.score);
      const topN = Math.min(12, candidates.length);
      const pick = candidates[Math.floor(Math.random() * topN)];
      return { x: pick.x, y: pick.y };
    }

    // Crowded fallback: any walkable tile.
    for (let gridY = 0; gridY < this.state.mapHeight; gridY++) {
      for (let gridX = 0; gridX < this.state.mapWidth; gridX++) {
        if (!this.isWalkableTile(gridX, gridY)) continue;
        const worldX = gridX * TILE_SIZE + TILE_SIZE / 2;
        const worldY = gridY * TILE_SIZE + TILE_SIZE / 2;
        if (this.canOccupy(worldX, worldY, PLAYER_RADIUS)) return { x: worldX, y: worldY };
      }
    }

    return {
      x: centerX * TILE_SIZE + TILE_SIZE / 2,
      y: centerY * TILE_SIZE + TILE_SIZE / 2,
    };
  }

  hasSpawnEscapePotential(gridX: number, gridY: number) {
    const dirs = [
      { dx: 1, dy: 0 },
      { dx: -1, dy: 0 },
      { dx: 0, dy: 1 },
      { dx: 0, dy: -1 },
    ];
    for (const d of dirs) {
      const nx = gridX + d.dx;
      const ny = gridY + d.dy;
      if (!this.isInsideMap(nx, ny)) continue;
      // Box is fine (we can clear it), but hard wall is not.
      if (this.tileAt(nx, ny) !== 1) return true;
    }
    return false;
  }

  ensureSpawnEscape(worldX: number, worldY: number) {
    const gridX = Math.floor(worldX / TILE_SIZE);
    const gridY = Math.floor(worldY / TILE_SIZE);
    const indexAt = (x: number, y: number) => y * this.state.mapWidth + x;
    const setOpen = (x: number, y: number) => {
      if (!this.isInsideMap(x, y)) return false;
      const tile = this.tileAt(x, y);
      if (tile === 1) return false;
      this.state.map[indexAt(x, y)] = 0;
      return true;
    };

    // Always keep spawn tile open.
    setOpen(gridX, gridY);

    const dirs = [
      { dx: 1, dy: 0 },
      { dx: -1, dy: 0 },
      { dx: 0, dy: 1 },
      { dx: 0, dy: -1 },
    ];

    let openNeighbors = 0;
    for (const d of dirs) {
      if (setOpen(gridX + d.dx, gridY + d.dy)) openNeighbors++;
    }

    // Guarantee at least 2 usable exits by opening one more step if needed.
    if (openNeighbors < 2) {
      for (const d of dirs) {
        const nx = gridX + d.dx;
        const ny = gridY + d.dy;
        const fx = gridX + d.dx * 2;
        const fy = gridY + d.dy * 2;
        if (!this.isInsideMap(nx, ny) || !this.isInsideMap(fx, fy)) continue;
        if (this.tileAt(nx, ny) === 1 || this.tileAt(fx, fy) === 1) continue;
        setOpen(nx, ny);
        setOpen(fx, fy);
        openNeighbors++;
        if (openNeighbors >= 2) break;
      }
    }
  }

  spawnRandomPowerUp() {
    if (this.state.powerups.size >= MAX_POWERUPS_ON_MAP) return;

    const candidates: { x: number; y: number }[] = [];
    for (let gridY = 1; gridY < this.state.mapHeight - 1; gridY++) {
      for (let gridX = 1; gridX < this.state.mapWidth - 1; gridX++) {
        if (!this.isWalkableTile(gridX, gridY)) continue;

        const worldX = gridX * TILE_SIZE + TILE_SIZE / 2;
        const worldY = gridY * TILE_SIZE + TILE_SIZE / 2;

        let blocked = false;
        this.state.bombs.forEach((b) => {
          if (Math.abs(b.x - worldX) < 5 && Math.abs(b.y - worldY) < 5) blocked = true;
        });
        this.state.powerups.forEach((p) => {
          if (Math.abs(p.x - worldX) < 5 && Math.abs(p.y - worldY) < 5) blocked = true;
        });
        this.state.players.forEach((p) => {
          if (!p.isAlive) return;
          if (Math.abs(p.x - worldX) < TILE_SIZE * 0.75 && Math.abs(p.y - worldY) < TILE_SIZE * 0.75) blocked = true;
        });

        if (!blocked) {
          candidates.push({ x: worldX, y: worldY });
        }
      }
    }

    if (candidates.length === 0) return;
    const spot = candidates[Math.floor(Math.random() * candidates.length)];
    const pu = new PowerUp();
    const puId = `pu_${Date.now()}_${Math.random()}`;
    pu.id = puId;
    pu.x = spot.x;
    pu.y = spot.y;
    pu.type = Math.floor(Math.random() * 3) + 1;
    this.state.powerups.set(puId, pu);
  }

  killPlayer(victimId: string, killerId: string) {
    const victim = this.state.players.get(victimId);
    if (!victim || !victim.isAlive) return;

    victim.isAlive = false;
    victim.deaths += 1;
    this.broadcast("player_died", { id: victim.id });

    const killer = this.state.players.get(killerId);
    if (killer) {
      if (killerId !== victimId) {
        killer.kills += 1;
        killer.score += 1;
      } else {
        killer.score = Math.max(0, killer.score - 1);
      }
    }

    if (killer && killer.score >= WIN_SCORE) {
      this.finishRound("score", killer.id);
    }

    this.clock.setTimeout(() => {
      const player = this.state.players.get(victimId);
      if (!player) return;

      const spawn = this.findSpawnPosition();
      this.ensureSpawnEscape(spawn.x, spawn.y);
      player.x = spawn.x;
      player.y = spawn.y;
      player.isAlive = true;
      player.invulnerableUntil = Date.now() + RESPAWN_INVULNERABILITY_MS;
      this.broadcast("player_respawned", { id: player.id });
    }, RESPAWN_DELAY_MS);
  }

  startRound() {
    this.roundStartScheduled = false;
    if (this.state.players.size === 0) {
      this.state.roundActive = false;
      this.state.matchEndsAt = 0;
      return;
    }
    this.resetArenaForNewRound();
    this.state.roundActive = true;
    this.state.matchEndsAt = Date.now() + this.state.matchDurationSec * 1000;
  }

  scheduleRoundStart(delayMs = 50) {
    if (this.roundStartScheduled) return;
    if (this.state.roundActive) return;
    this.roundStartScheduled = true;
    this.clock.setTimeout(() => {
      this.roundStartScheduled = false;
      if (this.state.players.size === 0) return;
      if (this.state.roundActive) return;
      this.startRound();
    }, delayMs);
  }

  resetArenaForNewRound() {
    this.state.bombs.clear();
    this.state.powerups.clear();
    this.generateMap();

    this.playerBombPass.clear();
    const reservedSpawns: { x: number; y: number }[] = [];
    this.state.players.forEach((player, playerId) => {
      const spawn = this.findSpawnPosition(reservedSpawns);
      reservedSpawns.push(spawn);
      this.ensureSpawnEscape(spawn.x, spawn.y);
      player.bombs = 1;
      player.bombRadius = 2;
      player.speed = 150;
      player.x = spawn.x;
      player.y = spawn.y;
      player.isAlive = true;
      player.invulnerableUntil = Date.now() + RESPAWN_INVULNERABILITY_MS;
      this.playerBombPass.set(playerId, new Set<string>());
    });
  }

  getLeaderId() {
    let best: Player | null = null;
    this.state.players.forEach((p) => {
      if (!best) {
        best = p;
        return;
      }
      if (p.score > best.score) {
        best = p;
        return;
      }
      if (p.score === best.score && p.kills > best.kills) {
        best = p;
      }
    });
    return best?.id || "";
  }

  finishRound(reason: "time" | "score", winnerId?: string) {
    if (!this.state.roundActive) return;
    this.state.roundActive = false;
    this.state.matchEndsAt = 0;
    this.state.bombs.clear();
    this.state.powerups.clear();

    const resolvedWinnerId = winnerId || this.getLeaderId();
    const winner = resolvedWinnerId ? this.state.players.get(resolvedWinnerId) : undefined;
    this.broadcast("game_over", {
      reason,
      winnerId: winner?.id || "",
      winnerName: winner?.name || "No winner",
      score: winner?.score ?? 0,
    });

    this.clock.setTimeout(() => {
      if (this.state.players.size === 0) return;
      this.startRound();
    }, 5000);
  }
}
