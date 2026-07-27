// Lobby: a single running match. Wraps a GameEngine with connected sockets,
// a tick loop, and join rules (group-locked vs open/random).

import { WebSocket } from "ws";
import { GameEngine } from "../engine/GameEngine.js";
import { generateTestMap } from "../engine/MapLoader.js";
import { DEFAULT_CONFIG, GameState } from "../engine/types.js";

export type LobbyMode = "group" | "random";

interface Connection {
  ws: WebSocket;
  playerId: string;
  telegramId: number;
}

export class Lobby {
  readonly id: string;
  readonly mode: LobbyMode;
  readonly groupId: number | null; // Telegram chat id, only set for mode="group"
  readonly engine: GameEngine;
  private connections: Connection[] = [];
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private started = false;

  constructor(id: string, mode: LobbyMode, groupId: number | null = null, width = 60, height = 40) {
    this.id = id;
    this.mode = mode;
    this.groupId = groupId;
    const state: GameState = generateTestMap(width, height);
    this.engine = new GameEngine(state, DEFAULT_CONFIG);
  }

  playerCount(): number {
    return this.connections.length;
  }

  isFull(): boolean {
    return this.playerCount() >= DEFAULT_CONFIG.maxPlayers;
  }

  /** Registers a new socket connection and spawns them a starting territory. */
  join(ws: WebSocket, telegramId: number, name: string, color: string): { ok: true; playerId: string } | { ok: false; reason: string } {
    if (this.isFull()) return { ok: false, reason: "lobby full" };
    if (this.started && this.mode === "group") {
      // Group games lock once started; random games allow late joins into
      // remaining neutral land until full.
      return { ok: false, reason: "game already started" };
    }

    const player = this.engine.addPlayer(telegramId, name, color);
    if (!player) return { ok: false, reason: "could not spawn (map full)" };

    this.connections.push({ ws, playerId: player.id, telegramId });

    ws.on("close", () => this.handleDisconnect(player.id));
    ws.on("message", (raw) => this.handleMessage(player.id, raw.toString()));

    if (!this.tickTimer) this.startLoop();

    return { ok: true, playerId: player.id };
  }

  private handleDisconnect(playerId: string): void {
    this.connections = this.connections.filter((c) => c.playerId !== playerId);
    // Note: we intentionally don't remove the player's territory on
    // disconnect — it just sits undefended, matching how OpenFront treats
    // AFK players. Reconnection support can be added later via a resume token.
  }

  private handleMessage(playerId: string, raw: string): void {
    let msg: { type: string; targetTile?: number };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const conn = this.connections.find((c) => c.playerId === playerId);

    // Client holds a finger/mouse down on the map -> startAttack toward that
    // tile. Troops flow continuously each tick until stopAttack, the goal is
    // captured, or reserves run out.
    if (msg.type === "startAttack" && typeof msg.targetTile === "number") {
      this.started = true;
      const result = this.engine.setAttackGoal(playerId, msg.targetTile);
      if (!result.ok) conn?.ws.send(JSON.stringify({ type: "error", reason: result.reason }));
      return;
    }

    // Client releases -> stop pushing (troops stay wherever the front currently is).
    if (msg.type === "stopAttack") {
      this.engine.stopAttack(playerId);
      return;
    }
  }

  private startLoop(): void {
    const intervalMs = 1000 / DEFAULT_CONFIG.ticksPerSecond;
    this.tickTimer = setInterval(() => {
      this.engine.tick();
      this.broadcastState();
      if (this.engine.getState().gameOver) {
        this.stopLoop();
      }
    }, intervalMs);
  }

  private stopLoop(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  /** Sends the current state to all connected sockets. Sent as a compact diff-free snapshot for now (fine at this scale/tick rate). */
  private broadcastState(): void {
    const s = this.engine.getState();
    const payload = JSON.stringify({
      type: "state",
      tick: s.tick,
      owner: Array.from(s.owner),
      garrison: Array.from(s.garrison),
      players: s.players.map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        alive: p.alive,
        troops: Math.floor(p.troops),
        tileCount: p.tileCount,
      })),
      gameOver: s.gameOver,
      winnerId: s.winnerId,
    });
    for (const conn of this.connections) {
      if (conn.ws.readyState === WebSocket.OPEN) conn.ws.send(payload);
    }
  }

  destroy(): void {
    this.stopLoop();
    for (const conn of this.connections) conn.ws.close();
    this.connections = [];
  }
}
