// Server entrypoint. Two responsibilities:
//   1. HTTP: small REST surface the Telegram bot calls to create/lookup lobbies,
//      plus serving the static mini-app client.
//   2. WebSocket: game connections. Players connect to /ws?lobbyId=...&telegramId=...&name=...
//
// NOTE on auth: this phase trusts telegramId/name query params directly for
// simplicity while we're building. Before going live, replace this with
// verifying Telegram WebApp `initData` (HMAC-SHA256 signed with the bot
// token) so players can't spoof someone else's Telegram id. That's a
// small, isolated change — see verifyInitData() stub below.

import express from "express";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocketServer } from "ws";
import { LobbyManager } from "./LobbyManager.js";
import { startBot } from "../bot/bot.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json());

const manager = new LobbyManager();
setInterval(() => manager.sweep(), 60_000);

// Serve the mini-app client (built separately, see src/client).
app.use(express.static(path.join(__dirname, "../../public")));

/**
 * Called by the Telegram bot when someone runs /newgame in a group.
 * Body: { groupId: number }
 * Returns: { lobbyId } so the bot can build the WebApp deep link.
 */
app.post("/api/lobby/group", (req, res) => {
  const groupId = Number(req.body?.groupId);
  if (!Number.isFinite(groupId)) {
    res.status(400).json({ error: "groupId required" });
    return;
  }
  const lobby = manager.createGroupLobby(groupId);
  res.json({ lobbyId: lobby.id });
});

/**
 * Called by the bot (or directly by the client) when someone wants to join
 * the random matchmaking pool from a private chat with the bot.
 */
app.post("/api/lobby/random", (_req, res) => {
  const lobby = manager.getOrCreateRandomLobby();
  res.json({ lobbyId: lobby.id });
});

app.get("/api/health", (_req, res) => res.json({ ok: true }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws, req) => {
  const url = new URL(req.url ?? "", "http://localhost");
  const lobbyId = url.searchParams.get("lobbyId");
  const telegramId = Number(url.searchParams.get("telegramId"));
  const name = url.searchParams.get("name") ?? "Player";
  const color = url.searchParams.get("color") ?? randomColor();

  if (!lobbyId || !Number.isFinite(telegramId)) {
    ws.close(4000, "missing lobbyId or telegramId");
    return;
  }

  const lobby = manager.get(lobbyId);
  if (!lobby) {
    ws.close(4004, "lobby not found (may have expired)");
    return;
  }

  // TODO before going live: for mode === "group", verify via Telegram Bot API
  // (getChatMember) that telegramId is actually a member of lobby.groupId.
  // That check belongs here, not on the client, since the client is untrusted.

  const result = lobby.join(ws, telegramId, name, color);
  if (!result.ok) {
    ws.close(4009, result.reason);
    return;
  }

  ws.send(JSON.stringify({ type: "joined", playerId: result.playerId, width: lobby.engine.getState().width, height: lobby.engine.getState().height }));
});

function randomColor(): string {
  const palette = ["#e63946", "#457b9d", "#2a9d8f", "#f4a261", "#9d4edd", "#ffbe0b", "#06d6a0", "#ef476f"];
  return palette[Math.floor(Math.random() * palette.length)];
}

const PORT = Number(process.env.PORT ?? 3000);
server.listen(PORT, () => {
  console.log(`openfront-lite server listening on port ${PORT}`);

  const botToken = process.env.BOT_TOKEN;
  const publicUrl = process.env.PUBLIC_URL; // e.g. https://your-service.up.railway.app
  if (botToken && publicUrl) {
    startBot(botToken, manager, publicUrl);
  } else {
    console.log("BOT_TOKEN or PUBLIC_URL not set — bot not started (server-only mode).");
  }
});
