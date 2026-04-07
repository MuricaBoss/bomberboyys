import { Schema, type, MapSchema, ArraySchema } from "@colyseus/schema";

export class Player extends Schema {
  @type("string") id: string = "";
  @type("string") name: string = "";
  @type("number") x: number = 0; 
  @type("number") y: number = 0; 
  @type("boolean") isAlive: boolean = true;
  @type("number") bombs: number = 1;
  @type("number") bombRadius: number = 2;
  @type("number") speed: number = 150;
  @type("number") kills: number = 0;
  @type("number") deaths: number = 0;
  @type("number") score: number = 0;
  @type("number") invulnerableUntil: number = 0;
}

export class Bomb extends Schema {
  @type("string") id: string = "";
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("string") ownerId: string = "";
  @type("number") radius: number = 2;
}

export class PowerUp extends Schema {
  @type("string") id: string = "";
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") type: number = 0; 
}

export class BomberState extends Schema {
  @type("number") mapWidth: number = 31;
  @type("number") mapHeight: number = 31;
  @type("string") hostId: string = "";
  @type("number") matchDurationSec: number = 180;
  @type("number") matchEndsAt: number = 0;
  @type("boolean") roundActive: boolean = false;
  @type(["number"]) map = new ArraySchema<number>();
  @type({ map: Player }) players = new MapSchema<Player>();
  @type({ map: Bomb }) bombs = new MapSchema<Bomb>();
  @type({ map: PowerUp }) powerups = new MapSchema<PowerUp>();
}
