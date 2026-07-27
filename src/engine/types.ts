// Core types for the lightweight territory-conquest engine.
// Kept intentionally simple: no per-tile terrain modifiers, no naval combat,
// no nukes/units — just land, troops, and attacks. Real map geometry can be
// swapped in later via MapLoader without touching this file.

export const NEUTRAL_OWNER = -1;

export interface Player {
  id: string; // internal lobby-scoped id
  telegramId: number;
  name: string;
  color: string; // hex color for rendering
  alive: boolean;
  troops: number; // reserve pool, not yet placed on the front
  tileCount: number; // cached count of owned tiles (perf: avoid recount each tick)
  attackGoal: number | null; // tile the player is continuously pushing toward, like holding a finger down in OpenFront
}

// A pending attack order queued by a player, resolved on the next tick.
export interface AttackOrder {
  playerId: string;
  targetTile: number; // tile index being attacked
  troopsCommitted: number;
}

export interface GameState {
  width: number;
  height: number;
  // Flat arrays sized width*height for cache-friendly iteration.
  owner: Int16Array; // NEUTRAL_OWNER or index into players[]
  garrison: Uint32Array; // troops currently defending each tile
  passable: Uint8Array; // 1 = land tile (buildable/attackable), 0 = water/impassable
  players: Player[];
  tick: number;
  pendingAttacks: AttackOrder[];
  gameOver: boolean;
  winnerId: string | null;
}

export interface EngineConfig {
  maxPlayers: number; // hard cap, e.g. 20
  ticksPerSecond: number; // e.g. 10
  troopGrowthPerTileServer: number; // manpower gained per owned tile per tick
  minGarrisonPerTile: number; // baseline defense every owned tile keeps
  troopFlowRate: number; // troops/tick pushed toward an active attack goal (the "fluid" feel)
}

export const DEFAULT_CONFIG: EngineConfig = {
  maxPlayers: 20,
  ticksPerSecond: 10,
  troopGrowthPerTileServer: 0.02,
  minGarrisonPerTile: 1,
  troopFlowRate: 3,
};
