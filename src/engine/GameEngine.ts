// GameEngine: the entire simulation lives here. No networking, no rendering —
// just pure functions over a GameState so it's easy to unit-test and to later
// wrap in a WebSocket loop untouched.

import { neighbors } from "./MapLoader.js";
import {
  AttackOrder,
  DEFAULT_CONFIG,
  EngineConfig,
  GameState,
  NEUTRAL_OWNER,
  Player,
} from "./types.js";

export class GameEngine {
  constructor(
    private state: GameState,
    private config: EngineConfig = DEFAULT_CONFIG,
  ) {}

  getState(): Readonly<GameState> {
    return this.state;
  }

  /** Adds a player and gives them a starting tile + garrison. Returns false if the game is full. */
  addPlayer(telegramId: number, name: string, color: string): Player | null {
    if (this.state.players.length >= this.config.maxPlayers) return null;

    const spawnTile = this.findSpawnTile();
    if (spawnTile === null) return null; // map full, shouldn't happen with maxPlayers sized maps

    const player: Player = {
      id: `p${this.state.players.length}`,
      telegramId,
      name,
      color,
      alive: true,
      troops: 20, // starting reserve
      tileCount: 1,
      attackGoal: null,
    };
    const playerIndex = this.state.players.length;
    this.state.players.push(player);
    this.state.owner[spawnTile] = playerIndex;
    this.state.garrison[spawnTile] = 10;

    return player;
  }

  /** Finds a passable, unowned tile reasonably far from existing players. */
  private findSpawnTile(): number | null {
    const { passable, owner } = this.state;
    const candidates: number[] = [];
    for (let i = 0; i < passable.length; i++) {
      if (passable[i] === 1 && owner[i] === NEUTRAL_OWNER) candidates.push(i);
    }
    if (candidates.length === 0) return null;
    // Pick the candidate farthest (roughly) from all existing player spawns,
    // approximated by just sampling a few random candidates and taking the
    // one with the largest min-distance. Cheap and good enough at this scale.
    if (this.state.players.length === 0) {
      return candidates[Math.floor(Math.random() * candidates.length)];
    }
    const spawns = this.playerTileSample();
    let best = candidates[0];
    let bestDist = -1;
    const sampleSize = Math.min(50, candidates.length);
    for (let s = 0; s < sampleSize; s++) {
      const idx = candidates[Math.floor(Math.random() * candidates.length)];
      const d = this.minDistToSpawns(idx, spawns);
      if (d > bestDist) {
        bestDist = d;
        best = idx;
      }
    }
    return best;
  }

  private playerTileSample(): number[] {
    const { owner } = this.state;
    const sample: number[] = [];
    for (let i = 0; i < owner.length; i++) {
      if (owner[i] !== NEUTRAL_OWNER) sample.push(i);
    }
    return sample;
  }

  private minDistToSpawns(tile: number, spawns: number[]): number {
    const { width } = this.state;
    const x = tile % width;
    const y = Math.floor(tile / width);
    let min = Infinity;
    for (const s of spawns) {
      const sx = s % width;
      const sy = Math.floor(s / width);
      const d = Math.abs(x - sx) + Math.abs(y - sy);
      if (d < min) min = d;
    }
    return min;
  }

  /**
   * Sets (or changes) a continuous attack goal — like holding a finger down
   * on the map in OpenFront. Troops keep flowing from the player's nearest
   * border toward this tile every tick, along the shortest open path, until
   * the player calls stopAttack(), the goal is captured, or they run out of
   * reserve troops.
   */
  setAttackGoal(playerId: string, targetTile: number): { ok: true } | { ok: false; reason: string } {
    const player = this.state.players.find((p) => p.id === playerId);
    if (!player || !player.alive) return { ok: false, reason: "player not found or dead" };
    if (this.state.passable[targetTile] !== 1) {
      return { ok: false, reason: "target is not land" };
    }
    const playerIndex = this.state.players.indexOf(player);
    if (this.state.owner[targetTile] === playerIndex) {
      return { ok: false, reason: "already owned by you" };
    }
    player.attackGoal = targetTile;
    return { ok: true };
  }

  /** Stops the continuous push (troops stay wherever they currently are). */
  stopAttack(playerId: string): void {
    const player = this.state.players.find((p) => p.id === playerId);
    if (player) player.attackGoal = null;
  }

  /** Advances the simulation by one tick: pushes active fronts, grows troops. */
  tick(): void {
    if (this.state.gameOver) return;

    const contributions = this.collectFlowContributions();
    this.resolveAttacks(contributions);
    this.growTroops();
    this.clearReachedGoals();
    this.checkWinCondition();
    this.state.tick += 1;
  }

  /**
   * For every player with an active attack goal, finds the single frontier
   * step (an owned border tile's non-owned neighbor) that is closest to the
   * goal, and commits a small flowRate chunk of troops there. Doing this
   * every tick — rather than once — is what gives the continuous "liquid"
   * push instead of a one-shot lump attack.
   */
  private collectFlowContributions(): AttackOrder[] {
    const contributions: AttackOrder[] = [];
    for (const player of this.state.players) {
      if (!player.alive || player.attackGoal === null || player.troops <= 0) continue;
      const playerIndex = this.state.players.indexOf(player);
      const step = this.findFrontierStepToward(playerIndex, player.attackGoal);
      if (!step) continue; // no reachable frontier (e.g. fully surrounded)
      const committed = Math.min(this.config.troopFlowRate, player.troops);
      if (committed <= 0) continue;
      player.troops -= committed;
      contributions.push({ playerId: player.id, targetTile: step, troopsCommitted: committed });
    }
    return contributions;
  }

  /**
   * BFS distance field from the goal tile over all passable tiles (ownership
   * ignored — troops path through anyone's territory, matching OpenFront's
   * "the front moves toward where you're pushing" feel). Then picks the
   * player's frontier tile (owned tile bordering non-owned land) whose
   * non-owned neighbor has the smallest distance to the goal.
   * Recomputed every tick per unique goal tile — fine at this map scale
   * (a few thousand tiles) and tick rate (10/s).
   */
  private findFrontierStepToward(playerIndex: number, goalTile: number): number | null {
    const dist = this.bfsDistance(goalTile);
    const { owner, passable } = this.state;

    let best: number | null = null;
    let bestDist = Infinity;

    for (let i = 0; i < owner.length; i++) {
      if (owner[i] !== playerIndex) continue;
      for (const n of neighbors(this.state, i)) {
        if (owner[n] === playerIndex) continue;
        if (passable[n] !== 1) continue;
        const d = dist[n];
        if (d < bestDist) {
          bestDist = d;
          best = n;
        }
      }
    }
    return best;
  }

  private bfsDistance(startTile: number): Int32Array {
    const { width, height, passable } = this.state;
    const dist = new Int32Array(width * height).fill(-1);
    if (passable[startTile] !== 1) return dist;
    const queue: number[] = [startTile];
    dist[startTile] = 0;
    let head = 0;
    while (head < queue.length) {
      const current = queue[head++];
      for (const n of neighbors(this.state, current)) {
        if (passable[n] === 1 && dist[n] === -1) {
          dist[n] = dist[current] + 1;
          queue.push(n);
        }
      }
    }
    return dist;
  }

  /** Auto-clears a player's attack goal once they've captured it. */
  private clearReachedGoals(): void {
    for (const player of this.state.players) {
      if (player.attackGoal === null) continue;
      const playerIndex = this.state.players.indexOf(player);
      if (this.state.owner[player.attackGoal] === playerIndex) {
        player.attackGoal = null;
      }
    }
  }

  private resolveAttacks(attacks: AttackOrder[]): void {
    if (attacks.length === 0) return;

    // Group simultaneous attacks on the same tile so multiple players fighting
    // over one tile resolve fairly (largest committed force wins, survivors
    // become the new garrison).
    const byTile = new Map<number, AttackOrder[]>();
    for (const atk of attacks) {
      const list = byTile.get(atk.targetTile) ?? [];
      list.push(atk);
      byTile.set(atk.targetTile, list);
    }

    for (const [tile, orders] of byTile) {
      const defenderIndex = this.state.owner[tile];
      let defense = this.state.garrison[tile];

      // Combine attackers from the same player, keep others separate.
      const byAttacker = new Map<string, number>();
      for (const o of orders) {
        byAttacker.set(o.playerId, (byAttacker.get(o.playerId) ?? 0) + o.troopsCommitted);
      }

      // Sort attackers by committed strength, strongest first.
      const attackers = [...byAttacker.entries()].sort((a, b) => b[1] - a[1]);

      let remainingDefense = defense;
      let winner: string | null = null;
      let winnerLeftoverTroops = 0;

      for (const [playerId, committed] of attackers) {
        if (committed > remainingDefense) {
          winner = playerId;
          winnerLeftoverTroops = committed - remainingDefense;
          remainingDefense = 0;
          break;
        } else {
          remainingDefense -= committed;
        }
      }

      if (winner) {
        const winnerIndex = this.state.players.findIndex((p) => p.id === winner);
        this.captureTile(tile, winnerIndex, Math.max(1, Math.floor(winnerLeftoverTroops)));
        void defenderIndex; // defender's garrison already zeroed via captureTile
      } else {
        // Defense held; reduce garrison by total damage taken.
        const totalCommitted = attackers.reduce((sum, [, c]) => sum + c, 0);
        this.state.garrison[tile] = Math.max(0, defense - totalCommitted);
      }
    }
  }

  private captureTile(tile: number, newOwnerIndex: number, newGarrison: number): void {
    const oldOwnerIndex = this.state.owner[tile];
    if (oldOwnerIndex !== NEUTRAL_OWNER && this.state.players[oldOwnerIndex]) {
      this.state.players[oldOwnerIndex].tileCount -= 1;
    }
    this.state.owner[tile] = newOwnerIndex;
    this.state.garrison[tile] = newGarrison;
    if (newOwnerIndex !== NEUTRAL_OWNER && this.state.players[newOwnerIndex]) {
      this.state.players[newOwnerIndex].tileCount += 1;
    }
    this.checkElimination(oldOwnerIndex);
  }

  private checkElimination(playerIndex: number): void {
    if (playerIndex === NEUTRAL_OWNER) return;
    const player = this.state.players[playerIndex];
    if (player && player.alive && player.tileCount <= 0) {
      player.alive = false;
    }
  }

  private growTroops(): void {
    for (const player of this.state.players) {
      if (!player.alive) continue;
      player.troops += player.tileCount * this.config.troopGrowthPerTileServer;
    }
  }

  private checkWinCondition(): void {
    const alive = this.state.players.filter((p) => p.alive);
    if (alive.length === 1 && this.state.players.length > 1) {
      this.state.gameOver = true;
      this.state.winnerId = alive[0].id;
    }
  }
}
