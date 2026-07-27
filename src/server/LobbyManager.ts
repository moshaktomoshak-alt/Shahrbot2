// LobbyManager: the only place that creates/destroys Lobby instances.
// Two flows:
//   1. Group flow: bot calls createGroupLobby(groupId) when someone runs
//      /newgame in a group chat. Returns a lobbyId embedded in the WebApp link.
//      Anyone who opens that link must belong to that Telegram group (the
//      bot's HTTP layer checks membership before minting a join token).
//   2. Random flow: joinRandom() puts the player into the newest
//      not-yet-full "random" lobby, or creates one if none exists/all are full
//      or already started.

import { randomUUID } from "crypto";
import { Lobby, LobbyMode } from "./Lobby.js";

export class LobbyManager {
  private lobbies = new Map<string, Lobby>();

  createGroupLobby(groupId: number): Lobby {
    const id = randomUUID();
    const lobby = new Lobby(id, "group", groupId);
    this.lobbies.set(id, lobby);
    return lobby;
  }

  /** Returns an open random lobby, creating a new one if needed. */
  getOrCreateRandomLobby(): Lobby {
    for (const lobby of this.lobbies.values()) {
      if (lobby.mode === "random" && !lobby.isFull()) {
        return lobby;
      }
    }
    const id = randomUUID();
    const lobby = new Lobby(id, "random", null);
    this.lobbies.set(id, lobby);
    return lobby;
  }

  get(id: string): Lobby | undefined {
    return this.lobbies.get(id);
  }

  remove(id: string): void {
    const lobby = this.lobbies.get(id);
    lobby?.destroy();
    this.lobbies.delete(id);
  }

  /** Call periodically to clean up finished/empty lobbies so memory doesn't grow forever. */
  sweep(): void {
    for (const [id, lobby] of this.lobbies) {
      if (lobby.engine.getState().gameOver || (lobby.playerCount() === 0)) {
        this.remove(id);
      }
    }
  }
}

export type { LobbyMode };
