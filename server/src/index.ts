import http from "http";
import express from "express";
import cors from "cors";
import { Server } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { Encoder } from "@colyseus/schema";
import { BomberRoom } from "./rooms/BomberRoom";
import { BaseDefenseRoom } from "./rooms/BaseDefenseRoom";

const port = Number(process.env.PORT || 2567);
const app = express();

// Needed for larger RTS states (many units/structures).
Encoder.BUFFER_SIZE = 512 * 1024;

app.use(cors());
app.use(express.json());
app.get("/healthz", (_req, res) => {
  res.status(200).json({ ok: true });
});

const server = http.createServer(app);
server.on("upgrade", (req) => {
  console.log(`[WS upgrade] ${req.url || ""}`);
});
const gameServer = new Server({
  transport: new WebSocketTransport({
    server,
    maxPayload: 1024 * 1024,
    pingInterval: 5000,
    pingMaxRetries: 4,
  })
});

// Rekisteröidään pelihuone
gameServer.define("bomber_room", BomberRoom);
gameServer.define("base_defense_room", BaseDefenseRoom);

gameServer.listen(port).then(() => {
  console.log(`[GameServer] Listening on Port: ${port}`);
});
