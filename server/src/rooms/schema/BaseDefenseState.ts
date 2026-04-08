import { Schema, type, MapSchema, ArraySchema } from "@colyseus/schema";

export class BaseDefensePlayer extends Schema {
  @type("string") id: string = "";
  @type("string") name: string = "";
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("boolean") isAlive: boolean = true;
  @type("number") speed: number = 140;
  @type("number") kills: number = 0;
  @type("number") deaths: number = 0;
  @type("number") score: number = 0;
  @type("number") invulnerableUntil: number = 0;
  @type("string") team: string = "A";
  @type("number") resources: number = 30;
  @type("number") buildKits: number = 0;
  @type("number") coreHp: number = 260;
  @type("number") coreHpMax: number = 260;
  @type("boolean") isCoreAnchored: boolean = false;
  @type("number") coreX: number = 0;
  @type("number") coreY: number = 0;
  @type("number") powerProduced: number = 0;
  @type("number") powerUsed: number = 0;
  @type("number") buildCooldownUntil: number = 0;
  @type("number") unitCooldownUntil: number = 0;
  @type("boolean") devMode: boolean = false;
}

export class BaseCore extends Schema {
  @type("string") id: string = "";
  @type("string") team: string = "A";
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") hp: number = 300;
  @type("number") maxHp: number = 300;
}

export class ResourceNode extends Schema {
  @type("string") id: string = "";
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") value: number = 25;
}

export class Structure extends Schema {
  @type("string") id: string = "";
  @type("string") ownerId: string = "";
  @type("string") team: string = "A";
  @type("string") type: string = "wall"; // wall | turret | war_factory | ore_refinery | solar_panel | barracks | base
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") hp: number = 120;
  @type("number") maxHp: number = 120;
  @type("number") buildStartedAt: number = 0;
  @type("number") buildCompleteAt: number = 0;
  @type("boolean") harvesterSpawned: boolean = false;
  @type("number") produceCooldownUntil: number = 0;
}

export class BaseUnit extends Schema {
  @type("string") id: string = "";
  @type("string") team: string = "A";
  @type("string") type: string = "soldier";
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") hp: number = 60;
  @type("number") maxHp: number = 60;
  @type("number") speed: number = 100;
  @type("number") damage: number = 8;
  @type("number") range: number = 24;
  @type("number") targetX: number = 0;
  @type("number") targetY: number = 0;
  @type("string") ownerId: string = "";
  @type("string") homeStructureId: string = "";
  @type("number") cargo: number = 0;
  @type("number") cargoMax: number = 0;
  @type("string") aiState: string = "idle";
  @type("number") manualUntil: number = 0;
  @type("number") dir: number = 1; // Default to 1 (Southeast) for 8 directions
}

export class BaseDefenseState extends Schema {
  @type("string") mode: string = "base_defense";
  @type("number") mapWidth: number = 35;
  @type("number") mapHeight: number = 35;
  @type("string") phase: string = "build"; // build | battle
  @type("number") phaseEndsAt: number = 0;
  @type(["number"]) map = new ArraySchema<number>();
  @type({ map: BaseDefensePlayer }) players = new MapSchema<BaseDefensePlayer>();
  @type({ map: BaseCore }) cores = new MapSchema<BaseCore>();
  @type({ map: ResourceNode }) resources = new MapSchema<ResourceNode>();
  @type({ map: Structure }) structures = new MapSchema<Structure>();
  @type({ map: BaseUnit }) units = new MapSchema<BaseUnit>();
  @type("boolean") roundActive: boolean = true;
  @type("string") winnerTeam: string = "";
}
