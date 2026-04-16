import { Room, Client } from "colyseus";
import { BaseDefenseState, BaseDefensePlayer, BaseUnit, Structure, BaseCore, ResourceNode } from "./schema/BaseDefenseState";

const TILE_SIZE = 32;
const PLAYER_RADIUS = 10;
const PRODUCED_UNIT_EXIT_GRACE_MS = 1500;

export class BaseDefenseRoom extends Room<BaseDefenseState> {
  maxClients = 8;
  unitPoseAudit = new Map<string, { x: number; y: number; at: number }>();
  lastPoseDebugAt = 0;
  unitPaths = new Map<string, { x: number; y: number }[]>();
  lastAvoidIntentSentAt = 0;
  nextTeam: "A" | "B" = "A";
  unitDestroyedAt = new Map<string, number>();

  onCreate(options: any) {
    console.log("BaseDefenseRoom Phase 1 created!", options);
    this.setState(new BaseDefenseState());
    this.generateMap();
    this.spawnResourceNodes();
    this.logStateSummary("onCreate");
    this.clock.setInterval(() => {
      if (this.clients.length <= 0) return;
      this.logStateSummary("heartbeat");
    }, 5000);

    // Build 282: Throttled Economy (1Hz) - Passive income from refineries
    this.clock.setInterval(() => {
        const now = Date.now();
        this.state.players.forEach((player) => {
            let refineryCount = 0;
            this.state.structures.forEach(s => {
                if (s.ownerId === player.id && s.type === "ore_refinery" && now >= s.buildCompleteAt) {
                    refineryCount++;
                }
            });
            if (refineryCount > 0) {
                // deltaTime for 1 second is 1000ms
                player.resources += (refineryCount * 2);
            }
        });
    }, 1000);

    // Ghost Buster: Periodic Sanity Check (2Hz)
    this.clock.setInterval(() => {
      const now = Date.now();
      const activePlayerIds = new Set(Array.from(this.state.players.keys()));

      // 1. Cleanup Units
      this.state.units.forEach((u, id) => {
        const hasOwner = activePlayerIds.has(u.ownerId);
        const isDead = (u.hp <= 0);
        const audit = this.unitPoseAudit.get(id);
        const isStale = audit && (now - audit.at > 90000); // Increased from 60s to 90s for mobile lag safety

        if (!hasOwner || isDead || isStale) {
          if (!this.unitDestroyedAt.has(id)) {
            this.unitDestroyedAt.set(id, now);
          } else if (now - (this.unitDestroyedAt.get(id) || 0) > 1500) {
            this.state.units.delete(id);
            this.unitDestroyedAt.delete(id);
            this.unitPoseAudit.delete(id);
            this.unitPaths.delete(id);
          }
        }
      });

      // 2. Cleanup Structures
      this.state.structures.forEach((s, id) => {
        const hasOwner = activePlayerIds.has(s.ownerId);
        const isDead = (s.hp <= 0);
        if (!hasOwner || isDead) {
          if (!this.unitDestroyedAt.has(id)) {
            this.unitDestroyedAt.set(id, now);
          } else if (now - (this.unitDestroyedAt.get(id) || 0) > 1500) {
            this.state.structures.delete(id);
            this.unitDestroyedAt.delete(id);
          }
        }
      });

      // 3. Cleanup Cores
      this.state.cores.forEach((c, id) => {
        if (c.hp <= 0) {
          if (!this.unitDestroyedAt.has(id)) {
            this.unitDestroyedAt.set(id, now);
          } else if (now - (this.unitDestroyedAt.get(id) || 0) > 1500) {
            this.state.cores.delete(id);
            this.unitDestroyedAt.delete(id);
          }
        }
      });
    }, 500);

    // Build 100: Removed client_performance telemetry to save mobile overhead

    this.onMessage("move", (client, data) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || !player.isAlive || player.isCoreAnchored) return;

      const nextX = typeof data?.x === "number" ? data.x : player.x;
      const nextY = typeof data?.y === "number" ? data.y : player.y;

      if (this.canOccupy(nextX, nextY, PLAYER_RADIUS)) {
        player.x = nextX;
        player.y = nextY;
      } else {
        if (this.canOccupy(nextX, player.y, PLAYER_RADIUS)) player.x = nextX;
        if (this.canOccupy(player.x, nextY, PLAYER_RADIUS)) player.y = nextY;
      }
    });

    this.onMessage("move_unit", (client, data) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      if (data.unitIds && Array.isArray(data.unitIds)) {
        data.unitIds.forEach((uid: string) => {
          const unit = this.state.units.get(uid);
          if (unit && unit.ownerId === client.sessionId) {
            unit.targetX = Number(data.targetX ?? data.x);
            unit.targetY = Number(data.targetY ?? data.y);
            unit.aiState = "walking";
            unit.manualUntil = 0; // Clear exit grace period gracefully
            this.unitPaths.delete(uid); // Clear old path so a new one is calculated if needed
          }
        });
      }
    });

    this.onMessage("anchor_base", (client) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || player.isCoreAnchored) return;

      player.isCoreAnchored = true;
      player.coreX = player.x;
      player.coreY = player.y;

      const core = new BaseCore();
      core.id = `core_${client.sessionId}`;
      core.team = player.team;
      core.x = player.x;
      core.y = player.y;
      this.state.cores.set(core.id, core);

      console.log(`Player ${client.sessionId} anchored base at ${core.x}, ${core.y}`);
    });

    this.onMessage("build_structure", (client, data) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || !player.isCoreAnchored) return;
      const buildType = String(data?.type || "");
      const gridX = Number(data.gridX);
      const gridY = Number(data.gridY);
      if (!Number.isFinite(gridX) || !Number.isFinite(gridY)) return;
      if (!this.canPlaceStructureAt(buildType, gridX, gridY)) return;

      const costs: { [key: string]: number } = {
        "ore_refinery": 300,
        "solar_panel": 150,
        "barracks": 200,
        "war_factory": 500
      };

      const cost = costs[buildType] || 50;
      if (player.resources < cost && !player.devMode) return;

      if (!player.devMode) player.resources -= cost;

      const structure = new Structure();
      structure.id = `struct_${client.sessionId}_${Date.now()}`;
      structure.ownerId = client.sessionId;
      structure.team = player.team;
      structure.type = buildType;
      structure.x = gridX * TILE_SIZE + TILE_SIZE / 2;
      structure.y = gridY * TILE_SIZE + TILE_SIZE / 2;
      structure.buildStartedAt = Date.now();
      structure.buildCompleteAt = Date.now() + 5000; // 5 second build time for all for now
      
      this.state.structures.set(structure.id, structure);
      console.log(`Player ${client.sessionId} building ${data.type} at ${structure.x}, ${structure.y}`);
    });

    this.onMessage("toggle_dev_mode", (client, data) => {
      const player = this.state.players.get(client.sessionId);
      if (player) {
          player.devMode = !player.devMode;
          if (player.devMode) player.resources += 5000;
          this.broadcast("dev_mode", { playerId: client.sessionId, enabled: player.devMode });
      }
    });

    this.onMessage("produce_unit", (client, data) => {
        const player = this.state.players.get(client.sessionId);
        if (!player) return;
        this.spawnUnit(client.sessionId, "soldier");
    });

    this.onMessage("produce_tank", (client, data) => {
        const player = this.state.players.get(client.sessionId);
        if (!player) return;
        this.spawnUnit(client.sessionId, "tank");
    });

    this.onMessage("produce_harvester", (client, data) => {
        const player = this.state.players.get(client.sessionId);
        if (!player) return;
        this.spawnUnit(client.sessionId, "harvester");
    });

    this.onMessage("unit_client_pose_batch", (client, data) => {
        if (!Array.isArray(data?.poses)) return;
        const now = Date.now();
        if (data.poses.length > 0 && now - this.lastPoseDebugAt >= 2000) {
          this.lastPoseDebugAt = now;
          console.log(
            `[BaseDefenseRoom:${this.roomId}] pose-batch client=${client.sessionId} count=${data.poses.length} clients=${this.clients.length} units=${this.state.units.size}`,
          );
        }
        data.poses.slice(0, 256).forEach((p: any) => {
            const unitId = String(p?.unitId || p?.id || "");
            const unit = this.state.units.get(unitId);
            if (!unit || unit.ownerId !== client.sessionId) return;
            if (!this.isClientAuthoritativeUnit(unit)) return;

            const nextXRaw = Number(p?.x);
            const nextYRaw = Number(p?.y);
            if (!Number.isFinite(nextXRaw) || !Number.isFinite(nextYRaw)) return;

            const audit = this.unitPoseAudit.get(unitId) || {
              x: Number(unit.x),
              y: Number(unit.y),
              at: now,
            };
            const dtSec = Math.max(0.016, Math.min(0.25, (now - audit.at) / 1000));
            const maxStep = Math.max(TILE_SIZE * 0.8, Number(unit.speed || 0) * dtSec * 2.5 + 20);
            const dx = nextXRaw - audit.x;
            const dy = nextYRaw - audit.y;
            const dist = Math.hypot(dx, dy);
            let nextX = nextXRaw;
            let nextY = nextYRaw;
            if (dist > maxStep && dist > 0.001) {
              const scale = maxStep / dist;
              nextX = audit.x + dx * scale;
              nextY = audit.y + dy * scale;
            }

            if (p.dir !== undefined) unit.dir = Number(p.dir);
            unit.x = nextX;
            unit.y = nextY;
            if (Number.isFinite(Number(p?.tx))) unit.targetX = Number(p.tx);
            if (Number.isFinite(Number(p?.ty))) unit.targetY = Number(p.ty);

            if (p.final) {
              // Build 153: Client signalled arrival at slot. Enforce idle state and snap.
              unit.x = nextX;
              unit.y = nextY;
              unit.targetX = nextX;
              unit.targetY = nextY;
              unit.aiState = "idle";
              unit.manualUntil = 0;
            } else {
              const radius = this.getUnitBodyRadius(String(unit.type || ""));
              const canExitStructure = this.canOccupyProducedUnitExit(unit, nextX, nextY, radius, now);
              // Relaxed collision for client-auth units to avoid "sticking" due to slight client/server mismatches
              if (!this.canOccupy(nextX, nextY, radius * 0.6) && !canExitStructure) return;

              unit.x = nextX;
              unit.y = nextY;
              if (Number.isFinite(Number(p?.tx))) unit.targetX = Number(p.tx);
              if (Number.isFinite(Number(p?.ty))) unit.targetY = Number(p.ty);
              const distToTarget = Math.hypot(Number(unit.targetX) - nextX, Number(unit.targetY) - nextY);
              unit.aiState = distToTarget > 5 ? "walking" : "idle";
              if (distToTarget <= TILE_SIZE * 0.65 || now >= Number(unit.manualUntil || 0)) {
                unit.manualUntil = 0;
              }
            }
            this.unitPoseAudit.set(unitId, { x: nextX, y: nextY, at: now });
        });
    });

    this.onMessage("command_attack", (client, data) => {
        const player = this.state.players.get(client.sessionId);
        if (!player) return;
        // Broadcast the attack command so all clients see the effect/intent
        this.broadcast("unit_shot", {
            fromX: data.targetX, // Simple mockup: mirror the hit
            fromY: data.targetY,
            toX: data.targetX,
            toY: data.targetY,
            team: player.team,
            unitType: "tank"
        });
    });

    this.onMessage("projectile_hit", (client, data) => {
        const shooter = this.state.units.get(data.shooterId);
        const victimId = String(data.victimId || "");
        if (!shooter || !victimId) return;

        let victim: any = this.state.units.get(victimId) 
                       || this.state.structures.get(victimId)
                       || this.state.cores.get(victimId);

        if (!victim || (victim.hp ?? 0) <= 0) return;
        if (victim.team === shooter.team) return;

        // --- Distance Verification ---
        const dist = Math.hypot(Number(shooter.x) - Number(victim.x), Number(shooter.y) - Number(victim.y));
        const maxAllowed = shooter.type === "tank" ? 680 : 480; // Buffer over client ranges (492 and 364)
        if (dist > maxAllowed) {
            console.log(`[BaseDefenseRoom] REJECTED hit: distance ${dist.toFixed(1)} > ${maxAllowed} (shooter:${data.shooterId} type:${shooter.type})`);
            return;
        }

        const damage = Number(shooter.damage || 8);
        victim.hp -= damage;
        if (victim.hp < 0) victim.hp = 0;

        // Authoritative Orientation: shooter faces victim (ONLY IF NOT WALKING/MOVING)
        const isWalking = (shooter.aiState === "walking" || shooter.aiState === "moving");
        const dx = Number(victim.x) - Number(shooter.x);
        const dy = Number(victim.y) - Number(shooter.y);
        const distToTgt = Math.hypot(Number(shooter.targetX) - Number(shooter.x), Number(shooter.targetY) - Number(shooter.y));

        if (isWalking && distToTgt > 4.0) {
            // Priority: Facing movement direction (already handled by movement loop)
        } else if (Math.hypot(dx, dy) > 0.1) {
            // Facing target (only when stationary or at target)
            shooter.dir = this.angleToDir8(Math.atan2(dy, dx));
        }

        this.broadcast("unit_damaged", { victimId, shooterId: data.shooterId });

        if (victim.hp <= 0) {
            console.log(`Victim ${victimId} destroyed by ${data.shooterId}`);
        }
    });

    this.onMessage("unit_avoid_intent", (client, data) => {
        // Simple storage or broadcast of avoidance intent if needed
    });

    this.onMessage("command_units", (client, data) => {
        const player = this.state.players.get(client.sessionId);
        if (!player) return;
        if (data.unitIds && Array.isArray(data.unitIds)) {
            data.unitIds.forEach((uid: string) => {
                const unit = this.state.units.get(uid);
                if (unit && unit.ownerId === client.sessionId) {
                    unit.targetX = data.targetX;
                    unit.targetY = data.targetY;
                    unit.aiState = "walking";
                    this.unitPaths.delete(uid);
                }
            });
        }
    });

    this.onMessage("produce_build_kit", (client, data) => {
        const player = this.state.players.get(client.sessionId);
        if (player && (player.resources >= 50 || player.devMode)) {
            if (!player.devMode) player.resources -= 50;
            player.buildKits++;
        }
    });

    this.onMessage("base_attack", (client, data) => {
        // Manual base attack trigger (dev tool or special ability)
        this.broadcast("base_attacked", { ownerId: client.sessionId });
    });

    this.onMessage("set_name", (client, data) => {
      const player = this.state.players.get(client.sessionId);
      if (player) player.name = data.name;
    });

    this.setSimulationInterval((deltaTime) => this.update(deltaTime));
  }

  onJoin(client: Client, options: any) {
    console.log(client.sessionId, "joined BaseDefenseRoom!");
    const player = new BaseDefensePlayer();
    player.id = client.sessionId;
    player.name = options.name || `Player ${this.clients.length}`;
    player.team = this.pickJoinTeam();
    console.log(`Assigned player ${client.sessionId} to team ${player.team}`);
    player.resources = 1000; // Starting resources

    const spawn = this.findSpawnPosition(player.team);
    player.x = spawn.x;
    player.y = spawn.y;
    player.coreX = spawn.x;
    player.coreY = spawn.y;
    
    this.state.players.set(client.sessionId, player);
    this.logStateSummary("onJoin", `client=${client.sessionId} team=${player.team}`);
  }

  async onLeave(client: Client, consented: boolean) {
    console.log(client.sessionId, consented ? "consented leave" : "accidental disconnect");
    
    // Build 257: Allow 20 seconds for reconnection if disconnect was accidental
    if (!consented) {
      try {
        await this.allowReconnection(client, 20);
        console.log(`[BaseDefense] client RECONNECTED: ${client.sessionId}`);
        return; 
      } catch (e) {
        console.log(`[BaseDefense] client reconnection TIMED OUT: ${client.sessionId}`);
      }
    }

    this.state.players.delete(client.sessionId);
    
    // Clean up units, structures, cores
    const toDeleteUnits: string[] = [];
    this.state.units.forEach((u, id) => {
        if (u.ownerId === client.sessionId) toDeleteUnits.push(id);
    });
    toDeleteUnits.forEach(id => this.state.units.delete(id));
    toDeleteUnits.forEach(id => this.unitPoseAudit.delete(id));

    const toDeleteStructures: string[] = [];
    this.state.structures.forEach((s, id) => {
        if (s.ownerId === client.sessionId) toDeleteStructures.push(id);
    });
    toDeleteStructures.forEach(id => this.state.structures.delete(id));

    const toDeleteCores: string[] = [];
    this.state.cores.forEach((c, id) => {
        if (id === `core_${client.sessionId}`) toDeleteCores.push(id);
    });
    toDeleteCores.forEach(id => this.state.cores.delete(id));
    this.logStateSummary("onLeaveFinal", `client=${client.sessionId} consented=${consented}`);
  }

  update(deltaTime: number) {
    const now = Date.now();

    // Economy now handled by 1Hz throttled loop in onCreate

    // (Cleanup now handled by 2Hz Ghost Buster loop)

    // Unit movement
    this.state.units.forEach((unit, id) => {
      const isAuth = this.isClientAuthoritativeUnit(unit);
      if (isAuth) {
          // Movement fallback: if owner client isn't sending poses (e.g. backgrounded),
          // let the server roughly move it towards the current target.
          const audit = this.unitPoseAudit.get(id);
          const now = Date.now();
          const inactiveMs = now - (audit?.at ?? 0);
          
          if (inactiveMs > 500 && unit.aiState === "walking" && unit.hp > 0) {
              const dx = (unit.targetX ?? unit.x) - unit.x;
              const dy = (unit.targetY ?? unit.y) - unit.y;
              const dist = Math.hypot(dx, dy);
              if (dist > 5) {
                  const speed = (unit.speed * deltaTime) / 1000;
                  unit.x += (dx / dist) * speed;
                  unit.y += (dy / dist) * speed;
                  unit.dir = this.angleToDir8(Math.atan2(dy, dx));
              } else {
                  unit.aiState = "idle";
              }
          }
          return;
      }
      
      if (unit.aiState === "walking") {
        let path = this.unitPaths.get(id);
        
        // Routinely challenge the path so units can discover straight empty routes or recalculate blocked paths
        if (path && Math.random() < 0.05) {
          this.unitPaths.delete(id);
          path = undefined;
        }

        if (!path) {
          const sgx = Math.floor(unit.x / TILE_SIZE);
          const sgy = Math.floor(unit.y / TILE_SIZE);
          const egx = Math.floor(unit.targetX / TILE_SIZE);
          const egy = Math.floor(unit.targetY / TILE_SIZE);
          
          // Check if straight line is blocked
          let blocked = false;
          const distGrid = Math.hypot(egx - sgx, egy - sgy);
          if (distGrid > 1.5) {
            for (let i = 1; i < distGrid; i++) {
              const testX = Math.floor(sgx + (egx - sgx) * (i / distGrid));
              const testY = Math.floor(sgy + (egy - sgy) * (i / distGrid));
              if (this.isTileBlocked(testX, testY, id, unit.team, egx, egy)) {
                blocked = true;
                break;
              }
            }
          }

          if (blocked) {
            path = this.findPathGrid(sgx, sgy, egx, egy, id, unit.team);
            if (path) this.unitPaths.set(id, path);
          }
        }

        const nextTargetX = path && path.length > 0 ? path[0].x : unit.targetX;
        const nextTargetY = path && path.length > 0 ? path[0].y : unit.targetY;

        const dx = nextTargetX - unit.x;
        const dy = nextTargetY - unit.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        if (dist > 5) {
          const speed = (unit.speed * deltaTime) / 1000;
          unit.x += (dx / dist) * speed;
          unit.y += (dy / dist) * speed;
          unit.dir = this.angleToDir8(Math.atan2(dy, dx));
        } else {
          if (path && path.length > 0) {
            path.shift();
            if (path.length === 0) this.unitPaths.delete(id);
          } else {
            unit.x = unit.targetX;
            unit.y = unit.targetY;
            unit.aiState = "idle";
          }
        }
      }
    });
  }

  onDispose() {
    console.log("room", this.roomId, "disposing...");
  }

  logStateSummary(context: string, extra = "") {
    const mapLen = typeof (this.state.map as { length?: number })?.length === "number"
      ? Number((this.state.map as { length?: number }).length)
      : 0;
    const suffix = extra ? ` ${extra}` : "";
    console.log(
      `[BaseDefenseRoom:${this.roomId}] ${context}${suffix} clients=${this.clients.length} players=${this.state.players.size} cores=${this.state.cores.size} resources=${this.state.resources.size} structures=${this.state.structures.size} units=${this.state.units.size} map=${this.state.mapWidth}x${this.state.mapHeight} mapLen=${mapLen}`,
    );
  }

  isClientAuthoritativeUnit(unit: BaseUnit) {
    const type = String(unit?.type || "");
    return type === "tank" || type === "harvester" || type === "soldier";
  }

  getUnitBodyRadius(type: string) {
    if (type === "tank") return TILE_SIZE * 0.31;
    if (type === "harvester") return TILE_SIZE * 0.27;
    return TILE_SIZE * 0.17;
  }

  findOwnedReadyStructure(ownerId: string, type: string, now: number) {
    let found: Structure | null = null;
    this.state.structures.forEach((s) => {
      if (found) return;
      if (s.ownerId !== ownerId) return;
      if (s.type !== type) return;
      if ((s.hp ?? 0) <= 0) return;
      if (Number(s.buildCompleteAt || 0) > now) return;
      if (Number(s.produceCooldownUntil || 0) > now) return;
      found = s;
    });
    return found;
  }

  isSpawnPointFree(worldX: number, worldY: number, radius: number) {
    if (!this.canOccupy(worldX, worldY, radius)) return false;
    const gx = Math.floor(worldX / TILE_SIZE);
    const gy = Math.floor(worldY / TILE_SIZE);
    if (this.hasResourceAt(gx, gy)) return false;

    let blocked = false;
    this.state.players.forEach((p) => {
      if (blocked || !p?.isAlive) return;
      if (Math.hypot(Number(p.x) - worldX, Number(p.y) - worldY) < radius + TILE_SIZE * 0.34) blocked = true;
    });
    this.state.units.forEach((u) => {
      if (blocked || (u.hp ?? 0) <= 0) return;
      if (Math.hypot(Number(u.x) - worldX, Number(u.y) - worldY) < radius + this.getUnitBodyRadius(String(u.type || "")) + 4) {
        blocked = true;
      }
    });
    return !blocked;
  }

  getProducedUnitExitCellOrder(structure: Structure, team: string) {
    const centerGX = Math.floor(Number(structure.x) / TILE_SIZE);
    const centerGY = Math.floor(Number(structure.y) / TILE_SIZE);
    const footprint = this.getStructureFootprint(String(structure.type || ""));
    const halfW = Math.floor(footprint.width / 2);
    const halfH = Math.floor(footprint.height / 2);
    const sideDir = team === "B" ? -1 : 1;
    const cells: Array<{ gx: number; gy: number }> = [];
    const seen = new Set<string>();
    const pushCell = (gx: number, gy: number) => {
      const key = `${gx},${gy}`;
      if (seen.has(key)) return;
      seen.add(key);
      cells.push({ gx, gy });
    };
    if (String(structure.type || "") === "war_factory") {
      pushCell(centerGX, centerGY + halfH + 2);
      pushCell(centerGX - 1, centerGY + halfH + 2);
      pushCell(centerGX + 1, centerGY + halfH + 2);
      pushCell(centerGX, centerGY + halfH + 3);
      pushCell(centerGX - 1, centerGY + halfH + 3);
      pushCell(centerGX + 1, centerGY + halfH + 3);
      pushCell(centerGX, centerGY + halfH + 4);
      pushCell(centerGX + sideDir * (halfW + 2), centerGY);
      pushCell(centerGX + sideDir * (halfW + 2), centerGY + 1);
      pushCell(centerGX + sideDir * (halfW + 2), centerGY - 1);
      pushCell(centerGX - sideDir * (halfW + 2), centerGY);
      pushCell(centerGX, centerGY - (halfH + 2));
      pushCell(centerGX, centerGY + halfH + 1);
      for (let extra = 5; extra <= 12; extra++) {
        pushCell(centerGX, centerGY + halfH + extra);
        pushCell(centerGX - 1, centerGY + halfH + extra);
        pushCell(centerGX + 1, centerGY + halfH + extra);
        if (extra >= 7) {
          pushCell(centerGX - 2, centerGY + halfH + extra);
          pushCell(centerGX + 2, centerGY + halfH + extra);
        }
      }
      for (let extra = 3; extra <= 7; extra++) {
        pushCell(centerGX + sideDir * (halfW + extra), centerGY);
        pushCell(centerGX + sideDir * (halfW + extra), centerGY + 1);
        pushCell(centerGX + sideDir * (halfW + extra), centerGY - 1);
      }
      return cells;
    }
    pushCell(centerGX, centerGY + halfH + 1);
    pushCell(centerGX - 1, centerGY + halfH + 1);
    pushCell(centerGX + 1, centerGY + halfH + 1);
    pushCell(centerGX + sideDir * (halfW + 1), centerGY);
    pushCell(centerGX + sideDir * (halfW + 1), centerGY + 1);
    pushCell(centerGX + sideDir * (halfW + 1), centerGY - 1);
    pushCell(centerGX - sideDir * (halfW + 1), centerGY);
    pushCell(centerGX, centerGY - (halfH + 1));
    pushCell(centerGX - 1, centerGY - (halfH + 1));
    pushCell(centerGX + 1, centerGY - (halfH + 1));
    pushCell(centerGX, centerGY + halfH + 2);
    pushCell(centerGX + sideDir * (halfW + 2), centerGY);
    pushCell(centerGX - sideDir * (halfW + 2), centerGY);
    for (let extra = 3; extra <= 12; extra++) {
      pushCell(centerGX, centerGY + halfH + extra);
      pushCell(centerGX - 1, centerGY + halfH + extra);
      pushCell(centerGX + 1, centerGY + halfH + extra);
      if (extra >= 5) {
        pushCell(centerGX - 2, centerGY + halfH + extra);
        pushCell(centerGX + 2, centerGY + halfH + extra);
      }
    }
    for (let extra = 2; extra <= 6; extra++) {
      pushCell(centerGX + sideDir * (halfW + extra), centerGY);
      pushCell(centerGX + sideDir * (halfW + extra), centerGY + 1);
      pushCell(centerGX + sideDir * (halfW + extra), centerGY - 1);
    }
    return cells;
  }

  isProducedUnitExitPointClaimed(worldX: number, worldY: number, radius: number, now: number) {
    let claimed = false;
    this.state.units.forEach((u) => {
      if (claimed || (u.hp ?? 0) <= 0) return;
      const currentX = Number(u.x);
      const currentY = Number(u.y);
      const targetX = Number(u.targetX ?? u.x);
      const targetY = Number(u.targetY ?? u.y);
      const targetDist = Math.hypot(targetX - worldX, targetY - worldY);
      const currentDist = Math.hypot(currentX - worldX, currentY - worldY);
      const claimRadius = Math.max(TILE_SIZE * 0.42, radius + this.getUnitBodyRadius(String(u.type || "")) + 4);
      if (targetDist > claimRadius && currentDist > claimRadius) return;
      claimed = true;
    });
    return claimed;
  }

  findProducedUnitExitPoint(structure: Structure, team: string, radius: number, now: number) {
    for (const cell of this.getProducedUnitExitCellOrder(structure, team)) {
      const wx = cell.gx * TILE_SIZE + TILE_SIZE / 2;
      const wy = cell.gy * TILE_SIZE + TILE_SIZE / 2;
      if (this.isProducedUnitExitPointClaimed(wx, wy, radius, now)) continue;
      if (this.isSpawnPointFree(wx, wy, radius)) return { x: wx, y: wy };
    }
    return null;
  }

  getProducedUnitStartPoint(structure: Structure, exitPoint: { x: number; y: number }) {
    const dirX = Math.sign(exitPoint.x - Number(structure.x));
    const dirY = Math.sign(exitPoint.y - Number(structure.y));
    const baseYOffset = String(structure.type || "") === "war_factory" ? -TILE_SIZE * 0.32 : -TILE_SIZE * 0.22;
    return {
      x: Number(structure.x) + dirX * TILE_SIZE * 0.34,
      y: Number(structure.y) + baseYOffset + dirY * TILE_SIZE * 0.12,
    };
  }

  spawnUnit(ownerId: string, type: string) {
    const player = this.state.players.get(ownerId);
    if (!player) return;
    const now = Date.now();
    const producerType = type === "soldier" ? "barracks" : "war_factory";
    const producer = this.findOwnedReadyStructure(ownerId, producerType, now);
    if (!producer) return;
    
    // Just find a simple fixed exit point adjacent to the producer
    const footprint = this.getStructureFootprint(String(producer.type || ""));
    const halfH = Math.floor(footprint.height / 2);
    const centerGX = Math.floor(Number(producer.x) / TILE_SIZE);
    const centerGY = Math.floor(Number(producer.y) / TILE_SIZE);
    
    // Default exit: right under the building
    const exitPoint = { x: centerGX * TILE_SIZE + TILE_SIZE / 2, y: (centerGY + halfH + 1) * TILE_SIZE + TILE_SIZE / 2 };
    const startPoint = this.getProducedUnitStartPoint(producer, exitPoint);

    const unit = new BaseUnit();
    unit.id = `unit_${ownerId}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    unit.ownerId = ownerId;
    unit.team = player.team;
    unit.type = type;
    unit.homeStructureId = producer.id;
    unit.x = startPoint.x;
    unit.y = startPoint.y;
    unit.targetX = startPoint.x;
    unit.targetY = startPoint.y;
    unit.aiState = "idle";
    this.unitPaths.delete(unit.id);
    unit.manualUntil = now + PRODUCED_UNIT_EXIT_GRACE_MS;
    unit.hp = type === "tank" ? 150 : 60;
    unit.maxHp = unit.hp;
    if (type === "tank") unit.speed = 140;
    else if (type === "harvester") unit.speed = 150;
    else if (type === "soldier") unit.speed = 120;
    producer.produceCooldownUntil = now + (type === "soldier" ? 800 : 1100);
    this.state.units.set(unit.id, unit);
    this.unitPoseAudit.set(unit.id, { x: unit.x, y: unit.y, at: now });
  }

  generateMap() {
    const width = this.state.mapWidth;
    const height = this.state.mapHeight;
    const centerX = Math.floor(width / 2);
    const centerY = Math.floor(height / 2);
    this.state.map.clear();

    const spawnSlots = [
      { gx: 4, gy: centerY },
      { gx: 4, gy: centerY - 5 },
      { gx: 4, gy: centerY + 5 },
      { gx: 4, gy: centerY - 9 },
      { gx: width - 5, gy: centerY },
      { gx: width - 5, gy: centerY - 5 },
      { gx: width - 5, gy: centerY + 5 },
      { gx: width - 5, gy: centerY - 9 },
    ];
    const keepOpen = new Set<string>();
    const markOpen = (gx: number, gy: number, radius: number) => {
      for (let oy = -radius; oy <= radius; oy++) {
        for (let ox = -radius; ox <= radius; ox++) {
          const x = gx + ox;
          const y = gy + oy;
          if (x >= 0 && y >= 0 && x < width && y < height) keepOpen.add(`${x},${y}`);
        }
      }
    };
    spawnSlots.forEach((slot) => markOpen(slot.gx, slot.gy, 2));
    markOpen(centerX, centerY, 3);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let tile = 0;
        const border = x === 0 || y === 0 || x === width - 1 || y === height - 1;
        if (border) {
          tile = 1;
        } else if (!keepOpen.has(`${x},${y}`)) {
        const symmetricBlock = ((x % 6 === 0) && (y % 4 === 0)) || ((x % 6 === 3) && (y % 5 === 2));
        const centerCover = Math.abs(x - centerX) <= 6 && Math.abs(y - centerY) <= 6 && ((x + y) % 4 === 0);
        if (symmetricBlock || centerCover) tile = 1;
      }
      this.state.map.push(tile);
    }
  }
}

  spawnResourceNodes() {
    this.state.resources.clear();
    const width = this.state.mapWidth;
    const height = this.state.mapHeight;
    const nodes = [
      { gx: 9, gy: 7 },
      { gx: 9, gy: height - 8 },
      { gx: width - 10, gy: 7 },
      { gx: width - 10, gy: height - 8 },
      { gx: Math.floor(width / 2), gy: 6 },
      { gx: Math.floor(width / 2), gy: height - 7 },
    ];
    nodes.forEach((node, index) => {
      if (!this.isInsideMap(node.gx, node.gy) || this.tileAt(node.gx, node.gy) !== 0) return;
      const res = new ResourceNode();
      res.id = `res_${index}`;
      res.x = node.gx * TILE_SIZE + TILE_SIZE / 2;
      res.y = node.gy * TILE_SIZE + TILE_SIZE / 2;
      res.value = 25;
      this.state.resources.set(res.id, res);
    });
  }

  isInsideMap(gridX: number, gridY: number) {
    return gridX >= 0 && gridY >= 0 && gridX < this.state.mapWidth && gridY < this.state.mapHeight;
  }

  tileAt(gridX: number, gridY: number) {
    if (!this.isInsideMap(gridX, gridY)) return 1;
    return this.state.map[gridY * this.state.mapWidth + gridX] ?? 1;
  }

  getStructureFootprint(type: string) {
    if (
      type === "ore_refinery"
      || type === "solar_panel"
      || type === "barracks"
      || type === "war_factory"
      || type === "factory"
    ) {
      return { width: 3, height: 3 };
    }
    return { width: 1, height: 1 };
  }

  forEachStructureFootprintCell(
    centerGX: number,
    centerGY: number,
    type: string,
    visitor: (gridX: number, gridY: number) => boolean | void,
  ) {
    const footprint = this.getStructureFootprint(type);
    const halfW = Math.floor(footprint.width / 2);
    const halfH = Math.floor(footprint.height / 2);
    for (let gridY = centerGY - halfH; gridY <= centerGY + halfH; gridY++) {
      for (let gridX = centerGX - halfW; gridX <= centerGX + halfW; gridX++) {
        if (visitor(gridX, gridY)) return;
      }
    }
  }

  canPlaceStructureAt(type: string, centerGX: number, centerGY: number) {
    const validType = type === "ore_refinery" || type === "solar_panel" || type === "barracks" || type === "war_factory";
    if (!validType) return false;
    let blocked = false;
    this.forEachStructureFootprintCell(centerGX, centerGY, type, (gridX, gridY) => {
      if (!this.isInsideMap(gridX, gridY)) {
        blocked = true;
        return true;
      }
      if (this.tileAt(gridX, gridY) !== 0 || this.hasStructureAt(gridX, gridY) || this.hasCoreAt(gridX, gridY) || this.hasResourceAt(gridX, gridY)) {
        blocked = true;
        return true;
      }
      return false;
    });
    return !blocked;
  }

  hasStructureAt(gridX: number, gridY: number) {
    let found = false;
    this.state.structures.forEach((s) => {
      if (found || (s.hp ?? 0) <= 0) return;
      const centerGX = Math.floor(s.x / TILE_SIZE);
      const centerGY = Math.floor(s.y / TILE_SIZE);
      this.forEachStructureFootprintCell(centerGX, centerGY, String(s.type || ""), (cellGX, cellGY) => {
        if (cellGX === gridX && cellGY === gridY) {
          found = true;
          return true;
        }
        return false;
      });
    });
    return found;
  }

  hasStructureAtExcept(gridX: number, gridY: number, ignoredStructureId: string) {
    let found = false;
    this.state.structures.forEach((s, id) => {
      if (found || id === ignoredStructureId || (s.hp ?? 0) <= 0) return;
      const centerGX = Math.floor(s.x / TILE_SIZE);
      const centerGY = Math.floor(s.y / TILE_SIZE);
      this.forEachStructureFootprintCell(centerGX, centerGY, String(s.type || ""), (cellGX, cellGY) => {
        if (cellGX === gridX && cellGY === gridY) {
          found = true;
          return true;
        }
        return false;
      });
    });
    return found;
  }

  hasCoreAt(gridX: number, gridY: number) {
    let found = false;
    this.state.cores.forEach((c) => {
      if (found || (c.hp ?? 0) <= 0) return;
      if (Math.floor(c.x / TILE_SIZE) === gridX && Math.floor(c.y / TILE_SIZE) === gridY) found = true;
    });
    return found;
  }

  hasResourceAt(gridX: number, gridY: number) {
    let found = false;
    this.state.resources.forEach((r) => {
      if (found) return;
      if (Math.floor(r.x / TILE_SIZE) === gridX && Math.floor(r.y / TILE_SIZE) === gridY) found = true;
    });
    return found;
  }

  canOccupy(worldX: number, worldY: number, radius: number) {
    const samples = [
      { x: worldX, y: worldY },
      { x: worldX - radius, y: worldY - radius },
      { x: worldX + radius, y: worldY - radius },
      { x: worldX - radius, y: worldY + radius },
      { x: worldX + radius, y: worldY + radius },
    ];
    for (const p of samples) {
      const gx = Math.floor(p.x / TILE_SIZE);
      const gy = Math.floor(p.y / TILE_SIZE);
      if (this.tileAt(gx, gy) !== 0) return false;
      if (this.hasStructureAt(gx, gy)) return false;
      if (this.hasCoreAt(gx, gy)) return false;
    }
    return true;
  }

  canOccupyIgnoringStructure(worldX: number, worldY: number, radius: number, ignoredStructureId: string) {
    const samples = [
      { x: worldX, y: worldY },
      { x: worldX - radius, y: worldY - radius },
      { x: worldX + radius, y: worldY - radius },
      { x: worldX - radius, y: worldY + radius },
      { x: worldX + radius, y: worldY + radius },
    ];
    for (const p of samples) {
      const gx = Math.floor(p.x / TILE_SIZE);
      const gy = Math.floor(p.y / TILE_SIZE);
      if (this.tileAt(gx, gy) !== 0) return false;
      if (this.hasStructureAtExcept(gx, gy, ignoredStructureId)) return false;
      if (this.hasCoreAt(gx, gy)) return false;
    }
    return true;
  }

  canOccupyProducedUnitExit(unit: BaseUnit, nextX: number, nextY: number, radius: number, now: number) {
    if (now > Number(unit.manualUntil || 0)) return false;
    const homeStructureId = String(unit.homeStructureId || "");
    if (!homeStructureId) return false;
    const structure = this.state.structures.get(homeStructureId);
    if (!structure || (structure.hp ?? 0) <= 0) return false;
    const currentDist = Math.hypot(Number(unit.targetX) - Number(unit.x), Number(unit.targetY) - Number(unit.y));
    const nextDist = Math.hypot(Number(unit.targetX) - nextX, Number(unit.targetY) - nextY);
    if (nextDist > currentDist + TILE_SIZE * 0.2) return false;
    const maxHomeDist = String(structure.type || "") === "war_factory" ? TILE_SIZE * 4.4 : TILE_SIZE * 3.2;
    if (Math.hypot(nextX - Number(structure.x), nextY - Number(structure.y)) > maxHomeDist) return false;
    return this.canOccupyIgnoringStructure(nextX, nextY, radius, homeStructureId);
  }

  pickJoinTeam() {
    const t = this.nextTeam;
    this.nextTeam = (t === "A") ? "B" : "A";
    return t;
  }

  findSpawnPosition(team: string) {
    const width = this.state.mapWidth;
    const height = this.state.mapHeight;
    const centerY = Math.floor(height / 2);
    const slots = team === "A"
      ? [
          { gx: 4, gy: centerY },
          { gx: 4, gy: centerY - 5 },
          { gx: 4, gy: centerY + 5 },
          { gx: 4, gy: centerY - 9 },
        ]
      : [
          { gx: width - 5, gy: centerY },
          { gx: width - 5, gy: centerY - 5 },
          { gx: width - 5, gy: centerY + 5 },
          { gx: width - 5, gy: centerY - 9 },
        ];

    const occupied = new Set<string>();
    this.state.players.forEach((p) => {
      occupied.add(`${Math.floor(p.x / TILE_SIZE)},${Math.floor(p.y / TILE_SIZE)}`);
    });
    this.state.structures.forEach((s) => {
      if ((s.hp ?? 0) > 0) {
        const gx = Math.floor(s.x / TILE_SIZE);
        const gy = Math.floor(s.y / TILE_SIZE);
        const isLarge = ["barracks", "war_factory", "ore_refinery", "power_plant", "hq"].includes(String(s.type));
        if (isLarge) {
          for (let x = gx - 1; x <= gx + 1; x++) {
            for (let y = gy - 1; y <= gy + 1; y++) {
              occupied.add(`${x},${y}`);
            }
          }
        } else {
          occupied.add(`${gx},${gy}`);
        }
      }
    });
    this.state.units.forEach((u) => {
      if ((u.hp ?? 0) > 0) occupied.add(`${Math.floor(u.x / TILE_SIZE)},${Math.floor(u.y / TILE_SIZE)}`);
    });

    const slot = slots.find((s) => this.tileAt(s.gx, s.gy) === 0 && !occupied.has(`${s.gx},${s.gy}`)) || slots[0];
    return {
      x: slot.gx * TILE_SIZE + TILE_SIZE / 2,
      y: slot.gy * TILE_SIZE + TILE_SIZE / 2,
    };
  }

  angleToDir8(angle: number): number {
    let deg = angle * (180 / Math.PI);
    deg = (deg + 360) % 360;
    return Math.round(deg / 45) % 8;
  }

  isTileBlocked(gx: number, gy: number, ignoreUnitId?: string, team?: string, targetGX?: number, targetGY?: number) {
    if (gx < 0 || gy < 0 || gx >= this.state.mapWidth || gy >= this.state.mapHeight) return true;
    if (this.tileAt(gx, gy) !== 0) return true;
    for (const [id, s] of this.state.structures) {
      if (s.hp <= 0) continue;
      const sgx = Math.floor(s.x / TILE_SIZE);
      const sgy = Math.floor(s.y / TILE_SIZE);
      const isLarge = ["barracks", "war_factory", "ore_refinery", "power_plant", "hq"].includes(String(s.type));
      if (isLarge) {
        if (gx >= sgx - 1 && gx <= sgx + 1 && gy >= sgy - 1 && gy <= sgy + 1) return true;
      } else {
        if (gx === sgx && gy === sgy) return true;
      }
    }
    
    // Check for friendly units blocking the path
    if (team) {
      // GHOST MODE: if we are close to the target slot, we ignore our own units
      if (targetGX !== undefined && targetGY !== undefined) {
        if (Math.hypot(gx - targetGX, gy - targetGY) <= 3) {
           return false;
        }
      }

      for (const [uid, u] of this.state.units) {
        if (uid === ignoreUnitId || (u.hp ?? 0) <= 0 || u.team !== team) continue;
        if (u.aiState !== "idle") continue; // Do not detour around moving friendlies
        const ugx = Math.floor(Number(u.x) / TILE_SIZE);
        const ugy = Math.floor(Number(u.y) / TILE_SIZE);
        if (ugx === gx && ugy === gy) {
          return true; // Path is blocked by a friendly unit
        }
      }
    }
    
    return false;
  }

  findPathGrid(sgx: number, sgy: number, egx: number, egy: number, ignoreUnitId?: string, team?: string): { x: number, y: number }[] | null {
    if (sgx === egx && sgy === egy) return null;
    const dxInit = Math.abs(egx-sgx);
    const dyInit = Math.abs(egy-sgy);
    const hInit = dxInit + dyInit + (1.4 - 2) * Math.min(dxInit, dyInit);
    const openSet: any[] = [{ x: sgx, y: sgy, g: 0, f: hInit, parent: null }];
    const closedSet = new Set<string>();
    let count = 0;

    while (openSet.length > 0 && count < 250) {
      count++;
      openSet.sort((a, b) => a.f - b.f);
      const current = openSet.shift();
      const key = `${current.x},${current.y}`;
      if (current.x === egx && current.y === egy) {
        const path = [];
        let temp = current;
        while (temp) {
          path.push({ x: temp.x * TILE_SIZE + TILE_SIZE/2, y: temp.y * TILE_SIZE + TILE_SIZE/2 });
          temp = temp.parent;
        }
        return path.reverse();
      }
      closedSet.add(key);

      const neighbors = [
        { x: current.x + 1, y: current.y, d: false }, { x: current.x - 1, y: current.y, d: false },
        { x: current.x, y: current.y + 1, d: false }, { x: current.x, y: current.y - 1, d: false },
        { x: current.x + 1, y: current.y + 1, d: true }, { x: current.x - 1, y: current.y - 1, d: true },
        { x: current.x + 1, y: current.y - 1, d: true }, { x: current.x - 1, y: current.y + 1, d: true }
      ];

      for (const n of neighbors) {
        if (n.x < 0 || n.x >= this.state.mapWidth || n.y < 0 || n.y >= this.state.mapHeight) continue;
        if (closedSet.has(`${n.x},${n.y}`)) continue;
        
        // Prevent corner cutting: if diagonal, check if adjacent straight tiles are blocked
        if (n.d) {
          if (this.isTileBlocked(current.x, n.y, ignoreUnitId, team, egx, egy)) continue;
          if (this.isTileBlocked(n.x, current.y, ignoreUnitId, team, egx, egy)) continue;
        }

        if (this.isTileBlocked(n.x, n.y, ignoreUnitId, team, egx, egy)) {
          // Allow the final destination to be occupied to prevent target unreachability,
          // but completely avoid routing through occupied intermediate tiles.
          if (n.x !== egx || n.y !== egy) continue;
        }

        const g = current.g + (n.d ? 1.4 : 1);
        const dx = Math.abs(egx - n.x);
        const dy = Math.abs(egy - n.y);
        const h = dx + dy + (1.4 - 2) * Math.min(dx, dy);
        const f = g + h;
        const existing = openSet.find(o => o.x === n.x && o.y === n.y);
        if (!existing) {
          openSet.push({ ...n, g, f, parent: current });
        } else if (g < existing.g) {
          existing.g = g;
          existing.f = f;
          existing.parent = current;
        }
      }
    }
    return null;
  }
}
